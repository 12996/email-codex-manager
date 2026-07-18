# 2026-07-16 Roxy run 511 OTP 终态消费与注册实机验收

- 目标：重跑 account `105`（`dopier13.helical@icloud.com`），验证 `/about-you` OTP 误判修复。
- 关联日志：`data/automation-logs/registration-105-2026-07-16T04-00-03-559Z.log`
- 关联 change：`docs/changes/CHG-084-roxy-about-you-otp-state-guard.md`
- 关联 issue：`docs/issues/issue-014-roxy-about-you-age-misclassified-as-otp.md`

## run 510 结果

- 浏览器实时页面已是 `https://auth.openai.com/about-you`，但主流程前置的 `waitForOtpInputReady()` 没有消费 `OTP_ALREADY_COMPLETED`。
- 结果：run `510` 返回 `REGISTER_FAILED`；没有再次读取验证码，也没有把验证码写入 Age 字段。

## 修复

- 新增 `waitForOtpStageOrCompleted()`，将 profile/session 终态转换为可消费的 `already-completed` 状态。
- 主流程在该状态下跳过重复 OTP 获取和提交，继续 Step 6 资料填写。
- 新增回归测试覆盖初始 OTP 等待已到资料页的场景。

## run 511 实机结果

- run `511` 成功，HTTP `200`，账号状态为 `registered`。
- 页面链路：密码页 -> OTP 阶段回到密码页恢复 -> `/about-you` -> `https://chatgpt.com/`。
- 资料页成功填写姓名和年龄；主站聊天输入框出现；Session 获取成功；MFA 启用成功；注册 token 产物已保存。
- Roxy 保持打开，当前已回到 ChatGPT 主页面。

## 自动验证

- `node --test test/roxyRegisterOpenai.test.js`：32/32 通过。
- `node --check src/auto/roxy_register_openai.js`：通过。
- `git diff --check`：通过。
