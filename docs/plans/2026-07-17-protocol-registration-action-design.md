# 补号列表协议注册操作设计

## 目标

在补号列表每行的“操作”菜单增加“协议注册”。点击后只使用当前行账号，启动 `src/auto/protocol_registration/main.py` 的单次 CLI 流程；流程开始前通过 RoxyBrowser 关闭目标窗口、清理缓存、随机指纹并重新打开，再把新的 CDP 地址交给协议进程。

## 方案

- `gmail_IMAP` 新增 `POST /replacement-accounts/:id/register-protocol`。
- 后端复用现有自动化运行日志、子进程停止和失败记录链路，但使用 `tilian` 环境的 Python 可执行文件、协议项目目录和 `main.py`。
- 子进程环境显式传入 `OTP_PROVIDER=replacement`、`REPLACEMENT_ACCOUNT_ID=<当前账号 ID>`、`ROXY_CDP_ENABLED=1` 和刷新后的 `ROXY_CDP_ENDPOINT`，协议项目不再按列表首个账号选择。
- 协议 Roxy 目标默认使用窗口序号 `3` / 名称 `test`，可由 `ROXY_PROTOCOL_BROWSER_*` 覆盖；与现有 DOM 注册的 `ROXY_REGISTER_*` 窗口隔离。
- Roxy CDP 只允许单线程；协议注册进行中拒绝第二个并行任务，避免共享 profile。
- 协议成功后由 `gmail_IMAP` 将当前账号标记为 `registered`；失败只记录“协议注册失败”，不改变原业务状态。

## 验收

1. API 将当前行账号 ID 传给协议服务，成功/失败状态和运行日志符合现有注册操作约定。
2. 协议客户端按指定 ID读取账号并获取该账号验证码，不能回退到其他 `unregistered` 账号。
3. Roxy 刷新调用顺序为 close（可配置跳过）→ clear local → clear server → random fingerprint → open → connection info。
4. 默认单线程，Node/Python 专项测试与全量回归通过。
