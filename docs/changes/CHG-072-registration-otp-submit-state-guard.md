# CHG-072 注册 OTP 提交后状态判定守卫

状态：implemented

创建日期：2026-07-07

关联 PRD：PRD-003

## 背景

实机注册 run `418`、`419` 在邮箱验证码阶段失败。日志显示脚本只拉取并提交了一次邮箱验证码：

```text
[roxy-register-openai] step=email-code-request action=code-received attempt=1/24 code=received
🔑 [OTP] 第 1 次提交验证码: [redacted-code]
✅ [Continue] 第 1 次点击生效（formGone）
📝 [Step 6] 正在完善个人资料（如果需要）...
ℹ️  [Step 6] 当前 URL = https://auth.openai.com/email-verification
```

失败截图显示页面仍停留在 `https://auth.openai.com/email-verification`，并出现 `Incorrect code`。根因是 OTP 提交复用了通用 `clickContinueButtonReliably()` 的 `formGone` 判定；OTP 页本来就没有 `input[type="email"]`，因此点击后被误判为“点击生效”。随后 `submitOtpWithRetry()` 只等待 2 秒，若此时错误提示尚未渲染，就把“没看到错误”误当成验证码成功。

## 目标

- OTP 提交后必须重新判断页面状态，不允许仅凭通用按钮点击结果进入 Step 6。
- 错码提示出现时排除旧验证码并继续轮询新验证码。
- OTP 页长时间未离开且未出现明确成功状态时，明确报错，不再误判注册成功。
- OTP 等待阶段不能把 Playwright 判定为未启用的过渡态 password input 当成可填写密码页。

## 验收标准

- [x] OTP 提交后持续检查 `Incorrect code`、`/about-you`、`chatgpt.com`、资料页、用户已存在和密码错误等状态。
- [x] 错码时进入下一轮 `submitOtpWithRetry()`，并把旧码作为 `excludeCode` 传给邮箱验证码轮询。
- [x] 仍停留在 OTP 页且没有成功状态时，抛出明确的“邮箱验证码提交后未进入下一阶段”错误。
- [x] 回归测试覆盖“第一次验证码提交后仍在 OTP 页，错误提示延迟出现，随后拉取第二个验证码成功”的场景。
- [x] 回归测试覆盖“password input 可见但 Playwright 判定未启用”时不进入密码重填分支。

## 实现记录

实现日期：2026-07-07

- `src/auto/roxy_register_openai.js`
  - 新增 `waitForOtpSubmitResult()`，OTP 提交后按页面状态返回 `success`、`incorrect` 或 `pending`。
  - `submitOtpWithRetry()` 不再把 `clickContinueButtonReliably()` 的 `formGone` 当作成功依据；只有进入 `/about-you`、`chatgpt.com`、资料页或主站 session 状态才返回成功。
  - 错码时继续下一轮验证码轮询，旧验证码通过 `lastCode` 排除。
  - `findVisiblePasswordSelector()` 现在要求 password input 同时满足可见、`isEnabled()` 为真、且不在 disabled/inert 容器中，避免把 OpenAI 过渡态 disabled password DOM 当成可重填密码页。
- `test/roxyRegisterOpenai.test.js`
  - 新增 `submitOtpWithRetry does not treat a still-visible OTP page as success before checking for incorrect code`，复现本次错误路径。
  - 新增 `findVisiblePasswordSelector ignores password input that Playwright does not consider enabled`，覆盖 run `421` 的 disabled password input 误判。

验证：

```powershell
node --test .\test\roxyRegisterOpenai.test.js
node --check .\src\auto\roxy_register_openai.js
git diff --check
```

结果：`test\roxyRegisterOpenai.test.js` 28/28 pass；语法检查和 diff 空白检查通过。

## 回滚

移除 `waitForOtpSubmitResult()` 并恢复 `submitOtpWithRetry()` 中“等待 2 秒后未检测到错误即返回成功”的旧逻辑即可回滚；回滚后验证码错误提示延迟渲染时会再次误入 Step 6。
