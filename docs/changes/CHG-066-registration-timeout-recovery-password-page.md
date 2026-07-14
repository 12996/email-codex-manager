# CHG-066 注册超时恢复兼容回到密码页

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

Roxy OpenAI 注册 run `351` 在密码提交后进入邮箱验证码阶段时命中 OpenAI `Operation timed out`。脚本点击“重试”后，页面没有回到邮箱输入页或 OTP 输入页，而是回到 `Create a password` 页。

旧逻辑假设“重试”后只需要继续等 OTP，并且 OTP selector 的兜底 `input[type="text"]` 会误命中只读邮箱输入框，导致 `locator.fill` 因元素不可编辑超时。

## 决策

- OTP 阶段的超时恢复不能假设回到固定页面，必须重新识别当前页面状态。
- 如果恢复后回到创建密码页，脚本要再次填写补号账号数据库密码并提交。
- 由于再次提交密码可能触发新的邮箱验证码，已获取的验证码视为作废，重新轮询邮箱验证码。
- OTP 输入框识别必须排除 `readonly`、`disabled`、email/password/search 等不可用输入框，避免误填只读邮箱字段。

## 实现

- `src/auto/roxy_register_openai.js`
  - 新增可复用 `submitRegistrationPassword()`。
  - `waitForOtpInputReady()` 支持在 OTP 等待期间处理 password 页，并按需触发重新拉取验证码。
  - `findVisibleOtpSelector()` 改为检查候选输入框是否可编辑、是否像 OTP/code 字段；不再把只读邮箱文本框当 OTP。
  - OTP 阶段预等待和正式提交流程都接入“回到密码页后重填密码”的恢复逻辑。
- `test/roxyRegisterOpenai.test.js`
  - 增加只读邮箱文本框不应被识别为 OTP 的回归测试。
  - 增加 OTP 等待期间回到密码页会触发重新拉取验证码的回归测试。

## 验证

- `node --test test\roxyRegisterOpenai.test.js` 通过，13/13。

## PRD 合并

尚未合并。
