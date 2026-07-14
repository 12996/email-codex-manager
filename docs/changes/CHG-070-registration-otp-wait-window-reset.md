# CHG-070 注册 OTP 等待窗口按阶段重置

状态：implemented

创建日期：2026-07-04

关联 PRD：PRD-003

影响范围：`src/auto/roxy_register_openai.js`, `test/roxyRegisterOpenai.test.js`, `docs/work/`

## 背景

实机注册中，密码提交后进入 OTP 等待时如果遇到 OpenAI `Operation timed out`，脚本会点击“重试”并可能回到创建密码页。旧实现使用一个固定 OTP deadline，从最初点击密码 Continue 后就开始计时；超时恢复、重填密码、再次提交密码都会消耗同一个 OTP 等待窗口。

结果是：即使恢复后密码页可以正常输入和跳转，脚本也可能因为原始 OTP deadline 已耗尽而报“未找到验证码输入框”，日志看起来像邮箱验证码超时。

## 决策

- `waitForOtpInputReady()` 改为阶段化等待：
  - OTP 等待窗口只用于“当前阶段等待验证码输入页”；
  - 超时恢复后如果重新提交了密码，重置 OTP 等待窗口；
  - OTP 阶段若稳定停留在密码页，延迟确认后允许重新提交密码并重置等待窗口；
  - 仍保留短暂等待，避免把密码提交后的旧 DOM 瞬态误判为需要重填。
- 新增日志 `已重置验证码页等待窗口 reason=... timeoutMs=...`，便于确认计时重置发生在恢复动作之后。

## 验收

- [x] OpenAI 超时页恢复后回到密码页并重新提交密码，不再消耗原始 OTP deadline。
- [x] 初始 OTP 等待阶段如果密码页稳定停留，会重新提交密码，而不是一直等到 OTP 超时。
- [x] 密码错误页仍立即失败，不循环重填。
- [x] 仍然只有确认 OTP 输入框后才拉取邮箱验证码。

## 回滚

将 `waitForOtpInputReady()` 的 `deadline` 恢复为固定 `const deadline = Date.now() + timeout`，移除 `resetOtpWaitWindow()` 和稳定密码页延迟恢复逻辑。
