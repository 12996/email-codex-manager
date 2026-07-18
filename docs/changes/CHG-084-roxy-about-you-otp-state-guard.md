# CHG-084 Roxy /about-you OTP 状态误判修复

状态：implemented
创建日期：2026-07-16
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-014-roxy-about-you-age-misclassified-as-otp.md`
影响范围：`src/auto/roxy_register_openai.js`、`test/roxyRegisterOpenai.test.js`

## 背景

OpenAI 注册 OTP 提交后可能直接进入 `/about-you`。该页面的 Age 输入框使用 `inputmode="numeric"`，旧 OTP 选择器把它误认为验证码输入框。

## 变更内容

- 收紧 `isUsableOtpInput()`，不再单独信任 `inputmode=numeric`。
- `findVisibleOtpSelector()` 在 `/about-you` 页面直接停止寻找 OTP。
- `classifyRegistrationPage()` 优先返回 `profile`。
- OTP 等待和填码前识别 profile/session，避免对资料字段填验证码。
- 新增 `/about-you` Age 误判回归测试。
- 初始 OTP 等待也消费 `OTP_ALREADY_COMPLETED` 终态信号，避免主流程在已进入资料页时把状态异常抛出。
- 资料页已到达时跳过重复验证码读取和提交，继续执行资料填写与主站成功判定。

## 验收标准

- [x] Age 数字输入框不会返回 OTP selector。
- [x] `/about-you` 被识别为 profile，而不是 otp。
- [x] OTP 等待已到达资料页时立即结束，不再读取验证码或填入 Age。
- [x] 主流程消费 OTP 已完成信号并继续 Step 6 资料填写。
- [x] `node --test test/roxyRegisterOpenai.test.js` 32/32 通过。
- [x] Roxy 实机 run `511` 完成资料页、主站、Session、MFA，账号 `105` 状态更新为 `registered`。

## 回滚

回滚 `src/auto/roxy_register_openai.js`、`test/roxyRegisterOpenai.test.js` 及本 change 文档即可；不涉及数据库迁移或凭证格式变化。
