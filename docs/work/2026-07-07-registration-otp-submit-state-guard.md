# 2026-07-07 注册 OTP 提交后状态判定守卫

## 背景

注册 run `418`、`419` 在邮箱验证码阶段只提交了一次验证码，随后直接进入 Step 6 并最终报“注册后未能成功进入主站页面”。失败截图显示真实页面仍在 `auth.openai.com/email-verification`，并提示 `Incorrect code`。

## 根因

`submitOtpWithRetry()` 在 OTP 提交后依赖通用 `clickContinueButtonReliably()` 的点击结果。该通用函数把 `input[type="email"]` 消失视为 `formGone`，但 OTP 页本来就没有邮箱输入框，因此点击后立即被误判为生效。随后脚本只等待 2 秒检查 `Incorrect code`，若错误提示晚于该窗口出现，就把“没看到错误”当作成功，进入 Step 6。

## 本次修改

- 新增 `waitForOtpSubmitResult()`：
  - `Incorrect code` -> 返回 `incorrect`，进入下一轮轮询。
  - `/about-you`、资料页、`chatgpt.com` 或主站 session -> 返回 `success`。
  - 用户已存在、密码错误 -> 直接抛对应错误。
  - 超时仍未进入下一阶段 -> 返回 `pending`，由调用方抛明确错误。
- `submitOtpWithRetry()` 改为以 OTP 专用状态判定决定是否成功，不再信任 `formGone`。
- `findVisiblePasswordSelector()` 增加 Playwright `isEnabled()` 判断，并排除 disabled/inert 容器内的 password input，避免 OpenAI 过渡态 disabled password DOM 被当成可重填密码页。
- 新增回归测试覆盖第一次验证码错误、错误提示延迟出现、第二次验证码成功的场景。
- 新增回归测试覆盖 password input 可见但 Playwright 判定未启用时应忽略的场景。

## 验证

```powershell
node --test .\test\roxyRegisterOpenai.test.js
node --check .\src\auto\roxy_register_openai.js
git diff --check
```

结果：28/28 pass；语法检查和 diff 空白检查通过。

## 后续

- 下一次实机注册时观察日志是否出现 `验证码被判定为错误，等待新验证码后重试`，并确认第二轮验证码会继续轮询。
- 当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
