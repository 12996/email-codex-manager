# 2026-07-30 协议注册状态机恢复

## 结果

- `src/auto/protocol_registration/` 曾恢复到 `ab37db5`，覆盖了 2026-07-28
  尚未提交的 CHG-100 实现。
- 当前已恢复正确顺序：真实 OAuth 参数 -> `authorize_continue` Sentinel -> 邮箱 OTP
  validate -> `username_password_create` continuation -> 密码 Sentinel -> `user/register`。

## 证据

- 恢复前账号 210 调用 `user/register` 返回 HTTP 409 `invalid_state`；该调用发生在
  前置 OTP 验证缺失的情况下。
- Git 中最接近的历史提交均不完整：`7401ca6` 是 OTP-only，`070f06e`/`7d58c6d`
  在 OTP 验证前提交密码，`ab37db5` 直接提交密码。
- `CHG-100` 和 `issue-020` 记录了被覆盖代码的实际接口顺序和验收条件。

## 验证

- `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge tests.test_password_registration`：33/33 通过。
- `F:\anaconda\anaconda3\envs\tilian\python.exe -m py_compile main.py core\openai_auth.py`：通过。

## 真实验收

- 已在 Roxy `617-3` 手动完成一枚新账号的全链路：前置邮箱验证、密码提交、密码后的
  邮箱 OTP、姓名/年龄/生日、OAuth callback、ChatGPT 主站和 TOTP 2FA 均成功。
- 录制确认密码提交 `user/register` 返回 `email_otp_send`，密码后的 OTP validate 返回
  `about_you`，资料提交后 `create_account` 返回 OAuth callback continuation。
- 已新增 `docs/project/protocol-registration-flow.md`，记录接口参数、阶段响应判定、
  双 OTP 隔离和错码后等待新邮件的实现规则。
- 已将 `wrong_email_otp_code` 改为可恢复分类：自动流程会用新的时间下界继续轮询；
  补号邮箱默认轮询间隔已改为 5 秒，最大等待为 120 秒。
- 错码重试会将已提交验证码加入排除集合；邮箱接口重复返回同一码时必须继续等待，
  不会再次提交并触发 OpenAI 的 `max_check_attempts`。

## 后续

- 自动协议注册仍需修复外部 `email_code_api` 在首次轮询返回旧码后立即提交的问题；该问题
  不属于 Auth 状态机。
