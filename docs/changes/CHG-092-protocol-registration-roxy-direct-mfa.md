# CHG-092 协议注册直接启用 MFA

状态：implemented
创建日期：2026-07-20
关联 PRD：PRD-003
影响范围：`src/auto/protocol_registration/main.py`、`src/auto/protocol_registration/core/account_export.py`、`src/auto/protocol_registration/tests/`、`docs/issues/`、`docs/work/`

## 背景

协议注册取得注册后的 `accessToken` 后，旧实现仍执行 password re-auth 和第二次邮箱 OTP。
账号 162 的真实运行在 `email-otp/validate` 返回 401，未进入 ChatGPT MFA 接口。
现有 `src/auto/roxy_register_openai.js` 已证明同一注册态可以直接调用 ChatGPT MFA 协议。

## 变更内容

- 所有协议注册模式直接复用注册阶段的 `accessToken`。
- 按 `roxy_register_openai.js` 的顺序执行 `mfa_info`、`mfa/enroll`、`activate_enrollment` 和最终 `mfa_info`。
- 所有模式都不再触发第二封邮箱验证码、password re-auth 或 `email-otp/validate` 回调。
- 2FA 启用失败且没有 secret 时，不再提前把 replacement 账号同步为 `registered`。

## 验收

- [x] 回归测试覆盖 Roxy 直接 MFA 请求顺序和授权头。
- [x] 协议注册不会进入二次邮箱重认证。
- [x] 2FA 失败时不会提前回写 replacement `registered` 状态。
- [x] 注册协议 Python 测试 47/47 通过。
- [x] Python 语法检查通过。
- [ ] 使用新的 `unregistered` 账号完成真实 Roxy 注册验证。

## 回滚

回滚 `setup_2fa()` 的直接 MFA 流程和 `main.py` 的 accessToken 传递；保留新增测试和问题记录，直到确认旧重认证分支不再使用。
