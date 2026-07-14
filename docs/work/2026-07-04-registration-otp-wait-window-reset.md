# 2026-07-04 注册 OTP 等待窗口按阶段重置

## 目标

修复注册流程中 OpenAI 超时恢复后，验证码输入框等待仍沿用旧 deadline，导致恢复成功后也很快报 OTP 超时的问题。

## 根因

`waitForOtpInputReady()` 原来只有一个固定 `deadline`。这个 deadline 从密码提交后开始计时，但中间可能发生：

1. OpenAI `Operation timed out`；
2. 点击“重试”；
3. 回到创建密码页；
4. 重新填写数据库密码并提交；
5. 再等待邮箱验证码输入页。

这些恢复动作都消耗同一个 deadline，因此恢复后即使页面能继续跳转，也可能已经没有足够时间等 OTP 页出现。

## 修改

- `src/auto/roxy_register_openai.js`
  - `waitForOtpInputReady()` 改用可重置 deadline。
  - 超时恢复后若重新提交密码，调用 `resetOtpWaitWindow('timeout-recovery-returned-password-page')`。
  - OTP 等待阶段若稳定停留在密码页，延迟确认后重新提交密码，并调用 `resetOtpWaitWindow('password-page-during-otp-wait')`。
  - 保留 `recoverPasswordPage=false` 的短暂防抖，避免密码提交后旧 DOM 瞬态导致重复填密码。
- `test/roxyRegisterOpenai.test.js`
  - 增加“超时恢复提交密码后重置 OTP 等待窗口”的回归测试。
  - 增加“初始阶段禁用立即恢复时，稳定密码页仍会重试提交”的回归测试。

## 验证

- `node --test test\roxyRegisterOpenai.test.js` 通过，25/25。
- `node --check src\auto\roxy_register_openai.js` 通过。
- `node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，71/71。
- `git diff --check` 通过。

## 后续观察

下次实机注册如果再遇到 OpenAI 超时页，日志应出现：

`[OTP] 已重置验证码页等待窗口 reason=timeout-recovery-returned-password-page ...`

之后才重新等待邮箱验证码输入页并拉取邮箱验证码。
