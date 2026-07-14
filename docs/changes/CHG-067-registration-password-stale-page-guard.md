# CHG-067 注册 OTP 阶段密码页误判防护

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

Roxy OpenAI 注册 run `354` 在初次提交数据库密码后进入邮箱验证码阶段。运行日志显示脚本连续判断“OTP 阶段回到了创建密码页”，并再次调用密码填写逻辑；第三次填写时 Playwright 等待 `input[name="new-password"]` 超时，同时页面已经导航到 `https://auth.openai.com/email-verification`。

当前浏览器现场和异常截图均显示页面实际停在 `Check your inbox` 的 OTP 输入页。因此根因不是页面缺少 OTP 输入框，而是密码提交后的导航/接口请求仍在进行时，旧 DOM 中的 `new-password` 输入框被短暂误判为可恢复密码页。

同时，旧密码输入逻辑使用逐字符 `type()`，没有先清空输入框；如果恢复逻辑误触发或页面保留旧值，会把数据库密码追加到已有内容后面，看起来比数据库密码更长。

后续 run `355` 又出现新的顺序问题：页面实际停在 `https://auth.openai.com/log-in/password`，标题为 `Enter your password`。旧逻辑只识别注册创建密码页 `input[name="new-password"]`，没有把 OpenAI 登录密码页 `input[type="password"]` 视为必须先处理的 password gate，因此跳过密码输入，直接进入 OTP 阶段并开始拉取邮箱验证码。

进一步确认后，注册脚本的页面判断仍然分散在多个函数中。虽然能补单个 selector，但只要 OpenAI 增加页面变体，就可能再次把 password / timeout / unknown 页面当成 OTP 阶段。更稳定的做法是每个关键动作前先统一分类当前页面状态。

实机复测 account `57` 时，脚本已能先识别 `log-in/password` 并填写数据库密码，但 OpenAI 返回 `Incorrect email address or password`。旧恢复逻辑在错误提示出现前仍可能把仍停留的密码页当作“OTP 阶段回到密码页”，重复填写同一个密码。

## 决策

- OTP 等待期间发现 `new-password` 输入框时，先短暂等待页面稳定，并优先检查 OTP 输入框是否已经出现；出现 OTP 时不再重填密码。
- 只有确认当前仍是稳定的 `create-account/password` 页面，才允许执行密码页恢复。
- `log-in/password` 登录密码页也属于 password gate，必须先填写补号账号数据库密码，再进入后续邮箱验证码或 MFA 阶段。
- 进入邮箱验证码轮询前必须先确认当前页面确实是 OTP 输入页；不能在 password / unknown / timeout 页面提前拉取邮箱验证码。
- 页面判断统一走状态分类器，返回状态和证据，便于日志排查。
- `Incorrect email address or password` 必须识别为 `password-error` 并立即失败，不能重复提交相同数据库密码。
- 初次提交密码后的 OTP 预等待阶段只等待页面跳转或错误提示，不自动重填密码；真正的密码页恢复只保留给后续已确认需要恢复的场景。
- 填写数据库密码前必须清空输入框，并校验写入长度，避免追加旧值。
- 密码日志只输出长度和短哈希指纹，不输出明文密码。

## 实现

- `src/auto/roxy_register_openai.js`
  - 新增 `isCreatePasswordPageReady()`，要求页面不是 email-verification 且没有可用 OTP 输入框。
  - 新增 `classifyRegistrationPage()`，统一识别 `email-entry`、`password-create`、`password-login`、`password-error`、`email-verification-before-password`、`otp`、`captcha`、`timeout`、`connection-closed`、`user-exists`、`profile`、`chatgpt-session`、`unknown`。
  - 新增密码输入框候选识别，兼容 `input[name="new-password"]` 和登录页 `input[type="password"]` / `input[name="password"]`。
  - `detectNextRegistrationStep()` 改为使用统一状态分类器。
  - `waitForOtpInputReady()` 遇到密码输入框后先等待稳定，再判断 OTP 或稳定密码页。
  - `waitForOtpInputReady()` 支持 `recoverPasswordPage: false`，用于初次密码提交后的预等待阶段，避免重复填同一密码。
  - `submitOtpWithRetry()` 改为先等待 OTP 输入框，再拉取邮箱验证码，避免密码页提前消耗验证码。
  - `submitRegistrationPassword()` 改为先确认密码页就绪，再清空输入框后写入数据库密码，并记录 `len` 与 `sha256` 短指纹。
  - 密码恢复处理改为复用稳定密码页判断，避免在正在跳转到 OTP 页时误重填密码。
- `test/roxyRegisterOpenai.test.js`
  - 增加“旧密码页 DOM 稳定后出现 OTP 时不触发密码恢复”的回归测试。
  - 增加“提交数据库密码前清空已有输入”的回归测试。
  - 增加 OpenAI `log-in/password` 页面必须先填数据库密码的回归测试。
  - 增加统一页面状态分类器测试。
  - 增加 `submitOtpWithRetry()` 必须先确认 OTP 输入框再 fetch 邮箱验证码的回归测试。
  - 增加 `password-error` 分类测试。
  - 增加 OTP 预等待阶段禁用密码恢复时不重复填写密码的回归测试。

## 验证

- `node --check src\auto\roxy_register_openai.js` 通过。
- `node --test test\roxyRegisterOpenai.test.js` 通过，22/22。
- `node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，68/68。
- `git diff --check` 通过。

实机验证：

- account `57` 真实运行会进入 `log-in/password`，脚本先填写数据库密码，未提前拉取邮箱验证码。
- OpenAI 返回 `Incorrect email address or password` 后，脚本识别为 `password-error` 并失败，不再循环重复填写密码。

## PRD 合并

尚未合并。
