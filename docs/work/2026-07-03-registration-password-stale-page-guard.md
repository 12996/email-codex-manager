# 2026-07-03 注册 OTP 阶段密码页误判防护

## 背景

用户反馈 run `354` 在 OTP 阶段提示“回到了创建密码页”后再次填写数据库密码，随后报错：

- `page.type: Timeout 30000ms exceeded`
- 等待 `input[name="new-password"]`
- 同时 Playwright call log 显示页面正在完成 `https://auth.openai.com/api/accounts/email-otp/send` 后跳转到 `https://auth.openai.com/email-verification`

现场 Roxy 页面未关闭。连接 `617-8 gpt` 对应 CDP 后确认当前页面为：

- URL：`https://auth.openai.com/email-verification`
- 标题：`Check your inbox - OpenAI`
- 可见输入框：`input[name="code"]`，`autocomplete="one-time-code"`

## 根因

密码提交后 OpenAI 页面会经历一段导航/接口请求过渡期。旧逻辑在 OTP 等待阶段看到旧 DOM 中短暂存在的 `input[name="new-password"]`，立即判定“回到创建密码页”并二次提交密码。

第二次提交后又重复进入同样竞态，第三次尝试填写时页面已跳到 OTP 页，`new-password` 输入框不存在，最终 `page.type()` 超时。

用户观察到“密码比数据库密码更长”的合理原因是：旧密码输入逻辑只 `focus + type()`，没有先清空输入框；一旦误触发恢复或页面保留旧值，就会把数据库密码追加到已有内容。

随后检查 run `355`：

- 日志在邮箱提交后直接进入 `[Step 5] 正在从邮箱获取验证码...`
- 页面实际是 `https://auth.openai.com/log-in/password`
- 页面正文为 `Enter your password / Email address / Password / Continue / Log in with a one-time code`

这说明当前状态机只识别 `create-account/password` 的 `input[name="new-password"]`，没有识别 `log-in/password` 登录密码页，导致跳过“先输入数据库密码”步骤，错误地开始等待 OTP 输入框。

进一步按用户要求梳理后，确认注册流程需要在每个关键动作前统一判断页面状态，而不是在不同函数里分别猜 selector。尤其是 OTP 阶段必须先确认当前页已经是验证码输入页，再去邮箱拉码。

实机测试 account `57` 后又确认一个运行态问题：脚本已能先识别 `log-in/password` 并填写数据库密码，但 OpenAI 返回 `Incorrect email address or password`。在错误提示出现前页面仍短暂保持 `password-login`，旧 OTP 恢复逻辑会重复提交同一个数据库密码。

## 实现

- `src/auto/roxy_register_openai.js`
  - 新增稳定密码页判断：不是 `email-verification`，且没有可用 OTP 输入框，才算真正的 `create-account/password`。
  - 新增 `classifyRegistrationPage()`，统一识别注册流程里的关键状态：邮箱输入、创建密码、登录密码、密码错误、邮箱验证但密码未提交、OTP、人机、超时、连接关闭、已注册、资料页、ChatGPT session、unknown。
  - 将 `log-in/password` 也纳入 password gate，兼容 `input[type="password"]`、`input[name="password"]`、`input[autocomplete="current-password"]`。
  - `detectNextRegistrationStep()` 和 `waitForOtpInputReady()` 改为优先走统一页面状态分类。
  - `submitOtpWithRetry()` 改为先等待 OTP 输入框，再轮询邮箱验证码，避免在密码页提前消耗验证码。
  - `waitForOtpInputReady()` 支持初次密码提交后的预等待阶段禁用自动重填密码；遇到 `Incorrect email address or password` 直接报 `password-error`。
  - `waitForOtpInputReady()` 遇到密码输入框后先等待页面稳定，并优先返回已出现的 OTP 输入框。
  - `submitRegistrationPassword()` 填写前清空输入框，填写后记录实际长度。
  - 密码调试日志只输出长度和短 SHA-256 指纹，不输出明文。
- `test/roxyRegisterOpenai.test.js`
  - 增加 OTP 导航稳定后不误触发密码恢复的回归测试。
  - 增加密码填写前清空旧值的回归测试。
  - 增加 OpenAI 登录密码页必须先填数据库密码的回归测试。
  - 增加页面状态分类器覆盖关键页面的回归测试。
  - 增加 OTP 输入框确认必须发生在 fetch 邮箱验证码之前的回归测试。
  - 增加 password-error 分类和禁用密码恢复时不重复填写密码的回归测试。

## 验证

- `node --check src\auto\roxy_register_openai.js` 通过。
- `node --test test\roxyRegisterOpenai.test.js` 通过，22/22。
- `node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，68/68。
- `git diff --check` 通过。
- 实机测试 account `57`：脚本先填数据库密码，不提前拉邮箱验证码；OpenAI 返回密码错误后失败退出，不再循环重复填写密码。页面密码框已手动清空。

## 后续

- 本次只修改注册子进程脚本，下一次注册自动化 spawn 新进程时会读取当前文件；无需仅为本次修复重启 `node src/server.js`。
- 用下一个未注册且数据库密码正确的账号再实机验证：如果落到 `log-in/password` 或 `create-account/password`，都应先填数据库密码；只有进入 OTP 页后才拉取/提交邮箱验证码。
- 当前未合并 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
