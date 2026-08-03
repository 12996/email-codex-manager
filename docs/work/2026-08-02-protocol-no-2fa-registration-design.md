# 2026-08-02 无 2FA 协议注册设计

## 已完成

- 使用用户已打开的 Roxy profile 启动 CDP 网络录制并安全停止。
- 录制确认实际注册为 OTP-first：`email-otp/resend`、`email-otp/validate`、
  `create_account`、OAuth callback、`/api/auth/session.accessToken`。
- 确认当前密码协议在该 transaction 上会错误调用 `user/register`，造成
  `invalid_auth_step`。
- 已实现独立的 `protocol_no_2fa_registration.py`、Roxy 准备器和 OTP-first 核心状态机。
- 已根据网络录制整理实际 API 参数、动态请求头、Roxy 准备顺序和浏览器自动化兜底条件：
  `docs/project/protocol-no-2fa-registration-api.md`。
- 已用新的未注册邮箱完成一次实机端到端验证；session 返回 AT 后先写入
  `src/auto/product_files/registration/<email>.txt`，再将对应补号账号回写为 `registered`。未调用
  密码、`user/register` 或 TOTP 接口。
- 临时连接重置会由 CDP bridge 恢复 `chrome-error://` 页面，幂等的预认证请求另有有限重试。
- 已补专项 Python/Node 回归测试和 CSRF 日志脱敏测试。

## 下一步

- 将 Roxy profile 的代理绑定和模板配置落库后，可直接使用默认准备器运行。
- 若暂时没有这两项数据库配置，只能显式指定已验证的 `ROXY_NO_2FA_PREPARER`；不得把其中的
  代理凭据或 CDP endpoint 写入项目配置、日志或文档。
