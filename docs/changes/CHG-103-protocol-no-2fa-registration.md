# CHG-103 无 2FA 的 Roxy OTP-first 协议注册

状态：implemented
创建日期：2026-08-02
关联 PRD：PRD-003

## 变更

新增 `src/auto/protocol_no_2fa_registration.py`，以 Roxy 浏览器上下文执行本次手动录制
确认的 OTP-first 注册状态机，并在 ChatGPT session 返回 `accessToken` 后写入
`src/auto/product_files/registration/<email>.txt`，再将对应补号账号回写为 `registered`。

脚本启动时按 `test/manual-roxy-proxy-refresh.cjs` 的顺序刷新绑定代理、关闭并清理浏览器、
随机指纹、打开 Roxy 及获取 CDP 连接；不沿用测试脚本中的硬编码凭据。

该流程不提交密码、不调用 `user/register`、不执行 TOTP 2FA，也不修改现有密码 + 2FA
协议注册的行为。

## 原因

2026-08-02 的真实 Roxy 网络录制显示当前 Auth transaction 走
`email-verification -> email-otp -> about_you -> create_account`，不存在密码阶段。原协议
强制 `user/register` 会收到 `400 invalid_auth_step`。将该已验证分支独立为无 2FA 脚本，
可以避免页面网络波动造成手动注册中断，同时不影响既有流程。

接口与参数证据见 `docs/project/protocol-no-2fa-registration-api.md`。若运行时 Auth
契约不再符合该文档，先使用 DOM recorder 重新录制，再选择浏览器自动化兜底；不得猜测
selector 或继续强推协议请求。

## 实施与验证

- 已实现 `src/auto/protocol_no_2fa_registration.py`、
  `src/auto/prepare_roxy_no_2fa.cjs` 与
  `src/auto/protocol_registration/core/no_2fa_registration.py`。
- 标准准备器要求目标 Roxy profile 已在本地数据库配置代理绑定及代理模板；缺少绑定时会在
  修改 Roxy 前停止。仅在这种环境配置尚未落库时，可显式设置
  `ROXY_NO_2FA_PREPARER` 指向已验证的手动刷新脚本。该覆盖只读取新鲜 profile 的 `dirId`，
  不输出或持久化代理凭据、CDP endpoint、Cookie、OTP 或 AT。
- 实机过程中曾遇到临时连接重置，bridge 现会丢弃被映射为 `chrome-error://` 的同 origin 页面
  并新建页面重试；幂等的 `providers` 与 `csrf` 请求有有限重试。非幂等的 OTP 重发、验证和
  建号请求不盲目重放。
- AT 文件落盘成功后，脚本复用现有补号服务的 `PATCH /replacement-accounts/:id/status`，只回写
  `registered` 和状态说明；不发送 AT，不写入 TOTP。状态回写失败会令本次命令失败，但不会删除
  已写入的 AT 或重放 Auth 写请求。
- 已将首次实机验证产生的本地未同步记录补回 `registered`；未调用 password、`user/register` 或
  TOTP 接口。
- 已新增 CSRF 日志脱敏回归测试；日志只记录获取成功，不含 token 的任何片段。
- 补号管理操作列新增“无2FA注册”，请求
  `POST /replacement-accounts/:id/register-no2fa`。该操作与既有协议注册共用 FIFO 队列和 Roxy
  互斥，且仅接受 `unregistered` 账号；子进程成功后会复查本地状态已为 `registered`。

## 验收标准

- Roxy 生命周期与手动刷新脚本一致，且凭据、Cookie、CDP endpoint 不进入日志或 stdout。
- 每个 Auth 状态转换均由 HTTP 响应和 `page.type`/continuation 判定。
- `/api/auth/session.accessToken` 是远端成功条件；AT 文件落盘后必须同步本地 `registered` 状态。
- “无2FA注册”操作仅在 Roxy profile 已配置数据库代理绑定/模板，或服务进程显式配置
  `ROXY_NO_2FA_PREPARER` 时可运行。
- 流程不触发 password、`user/register` 或 TOTP API。
- 专项 Python/Node 回归测试通过，并以新的未注册邮箱完成一次实机验证。
