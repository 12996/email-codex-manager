# 2026-08-03 无 2FA Roxy OTP-first 协议注册

## 完成内容

- 新增 `src/auto/protocol_no_2fa_registration.py`、
  `src/auto/prepare_roxy_no_2fa.cjs` 和
  `src/auto/protocol_registration/core/no_2fa_registration.py`。
- 状态机严格按录制的 HTTP 响应、`page.type`、`method` 和 `continue_url` 推进：
  `providers -> csrf -> signin/openai -> authorize -> email-otp/resend ->
  email-otp/validate -> about_you -> create_account -> OAuth callback -> session`。
- 成功唯一以 `/api/auth/session` 返回的非空 `accessToken` 为准，并写入
  `src/auto/product_files/registration/<email>.txt`；不输出或读取 AT 内容。
- AT 文件写入成功后，复用补号服务将对应账号回写为 `registered`；状态回写失败会令命令失败，
  但不会删除 AT 或重放 Auth 请求。
- 无 2FA 分支不调用 password、`user/register` 或 TOTP API。
- 补号管理操作列已新增“无2FA注册”，对应
  `POST /replacement-accounts/:id/register-no2fa`。该动作仅接受 `unregistered` 账号，并与原协议
  注册共用单线程队列；服务端在子进程结束后复查状态已为 `registered`。

## Roxy 与网络恢复

- 默认准备器仅使用数据库中明确绑定到目标 profile 的代理和模板。缺失绑定时在修改 Roxy 前停止。
- `ROXY_NO_2FA_PREPARER` 是无数据库绑定时的显式覆盖，只解析手动刷新准备器输出的 `dirId`。
- 实机遇到过短暂连接重置。bridge 已在同 origin 页面变为 `chrome-error://` 时丢弃该页并新建页面；
  幂等的 `providers`、`csrf` 请求有有限重试。OTP 重发、验证和建号请求不盲目重放。

## 验证

- 使用新的未注册邮箱完成了一次端到端实机验证。AT 文件已写入，文件非空且无换行；未记录邮箱、
  OTP、AT、Cookie、CDP endpoint 或代理凭据。
- 首次实机成功记录已补回 `registered`；后续运行会在 AT 文件写入成功后自动完成同一状态回写。
- `python -m unittest tests.test_no_2fa_registration tests.test_no_2fa_cli
  tests.test_password_registration tests.test_registration_token_export tests.test_roxy_bridge
  tests.test_chatgpt_auth`：52/52 通过。
- `node --test test/prepareRoxyNo2FA.test.js test/roxyCdpBridge.test.js`：3/3 通过。
- CSRF 获取日志已脱敏，测试确认日志不包含 token 的任何片段。
- 新增 Node 回归覆盖操作服务、队列 operation 标记、前端操作项和路由暴露。

## 后续运行

先配置 profile 的代理绑定和模板，再直接运行默认准备器。未配置时，显式设置
`ROXY_NO_2FA_PREPARER` 为已验证的手动刷新脚本；不要把准备器输出、代理凭据、Cookie、OTP 或
AT 写入任何持久化日志。
