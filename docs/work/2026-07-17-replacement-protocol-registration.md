# 2026-07-17 补号列表协议注册操作

## 目标

在 `http://127.0.0.1:13100/replacement-ui` 的补号账号行操作菜单中增加“协议注册”，按当前行账号刷新 Roxy 指纹后启动 `src/auto/protocol_registration` 的单次协议流程。

## 已完成

- 新增 `POST /replacement-accounts/:id/register-protocol`。
- 前端操作菜单增加“协议注册”，成功后刷新列表；失败显示“协议注册失败”，不把账号状态改成失败状态。
- 默认使用 Roxy 窗口序号 `3`、名称 `test`，启动前执行关闭（可配置跳过）、清理本地/服务端缓存、随机指纹、重新打开和读取 CDP。
- 使用 `F:\anaconda\anaconda3\envs\tilian\python.exe` 执行：
  `F:\work\email\gmail_IMAP\src\auto\protocol_registration\main.py --count 1 --workers 1`
- 通过 `REPLACEMENT_ACCOUNT_ID` 固定当前账号；协议项目的外部邮箱验证码请求在 `ROXY_CDP_ENABLED=1` 时改为 Roxy 页面上下文。
- 协议成功后会将只含 token 值的 `<email>.txt` 写入 `F:\work\email\gmail_IMAP\src\auto\product_files\registration`；也支持 `REGISTRATION_TOKEN_OUTPUT_DIR` 覆盖。
- 增加 Node/Python 专项回归测试和 API/前端测试。

## 验证

- 服务：`127.0.0.1:13100` 正在监听，PID `30208`；登录页和账号 `178` 查询均返回 200。
- Node：`node --test test/*.test.js`，370/370 通过。
- Python：`F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest discover -s tests -v`，37/37 通过。
- 真实触发账号 `178`：Roxy 指纹刷新后已进入 OpenAI OTP 阶段，但 `http://5.253.38.136:8080/code?...` 从 Windows 直连和 Roxy 页面 `fetch`/导航均超时，最终保持 `unregistered`，错误只记录在 `last_error`。

## 当前阻塞

- 账号 `178` 的外部邮箱验证码 API 当前不可达，不能据此判断协议注册主流程失败。
- Roxy `3/test` profile 曾有残留 `RoxyChrome` 进程导致首次启动异常；已只清理该 profile 的残留进程，未清理其他 profile。
- 重新测试前先确认该邮箱 API 可访问，或在数据库中配置可用的 `email_code_api`；不要并行使用共享的 `3/test` profile。

## 关键证据

- 运行日志：`data/automation-logs/protocol-registration-178-2026-07-17T07-48-18-539Z.log`
- API：`docs/project/api.md` 中的 `POST /replacement-accounts/:id/register-protocol`
- 代码：`src/replacementServices.js`、`src/server.js`、`web/app.js`
