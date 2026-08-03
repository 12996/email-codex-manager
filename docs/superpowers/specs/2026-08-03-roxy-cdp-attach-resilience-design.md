# Roxy CDP Attach Resilience Design

日期：2026-08-03

状态：已确认

## 目标

让 Roxy profile 刚打开、CDP 尚未就绪或单次附着超时时，浏览器自动化以有限、
可诊断的重试恢复，而不是让 `playwright-core` 调用无界卡住。该变更不导航页面、
不填写表单，也不改变无 2FA 注册状态机。

## 运行态证据

- 刷新前，Roxy `/browser/connection_info` 返回空数组：没有活动 CDP 可供附着。
- 使用 `test/manual-roxy-proxy-refresh.cjs` 打开相同 profile 后，原生 CDP 的
  `Browser.getVersion`、`Target.getTargets`、`Target.setAutoAttach` 和
  `Target.getTargetInfo` 均可响应。
- 同一运行态下，`playwright-core@1.60.0` 对 Chrome 149 连续附着五次均成功，
  单次约 380--430ms。

因此，不将 Chrome 149 / Playwright 1.60 视为已证实的不兼容；要解决的是 Roxy
浏览器生命周期与当前连接代码没有就绪等待、超时和重新取得 endpoint 的问题。

## 方案

### 1. 在 Roxy client 中建立单一连接入口

`RoxyBrowserClient` 新增：

- `waitForConnectionInfo(options)`：轮询现有 `getConnectionInfo()`；默认最多 12 次、
  间隔 500ms。成功时返回当前 connection info，耗尽时抛出
  `ROXY_CDP_CONNECTION_INFO_TIMEOUT`。
- `connectPlaywright(cdpEndpoint, options)`：一次 Playwright 附着使用显式的
  10 秒 timeout；不自行输出或返回 endpoint。
- `connectReadyPlaywright(options)`：每次尝试均先通过
  `waitForConnectionInfo()` 取得新的 endpoint，再调用 `connectPlaywright()`；默认最多
  3 次，尝试之间等待 750ms。最终抛出 `ROXY_CDP_ATTACH_FAILED`，错误文本不含 endpoint、
  Cookie、代理凭据或 token。

`launchAndConnect()` 及无 2FA runner 都改用该入口。这样连接失败不会复用一次取到的
陈旧 endpoint。

### 2. 失败边界

- 任一次 `connection_info` 为空，只在有限窗口内继续轮询。
- 每次 Playwright 超时或连接错误后，下一次必须重新读取 connection info。
- 达到上限后停止在 Roxy 连接阶段；不得继续进入邮箱、OTP、资料页或 session 获取阶段。
- 已经连接到的 browser 在后续 context/page 初始化失败时必须断开，避免残留客户端连接。

### 3. 可观测性与安全

- 日志和最终错误只包含阶段、尝试次数及错误分类。
- 不写入或输出 CDP endpoint、Cookie、OTP、AT、代理账号或代理密码。
- `test/manual-roxy-cdp-attach-probe.cjs` 保持为手动、只读诊断工具：不导航、不填表、
  不输出敏感连接信息。

## 测试与验收

1. `connection_info` 第一次为空、第二次可用时，client 会轮询后返回可用连接信息。
2. 单次 Playwright 附着必须接收 10 秒 timeout。
3. 首次附着失败时，client 必须重新读取 endpoint 后成功附着；不能复用旧 endpoint。
4. 所有尝试耗尽时，错误有稳定 code，且序列化后的错误不包含 endpoint。
5. 无 2FA runner 必须调用新的就绪连接入口；连接失败时不开始页面注册流程。
6. 实机只读 probe 在已打开的手动 Roxy profile 上可附着；不执行注册。

## 非目标

- 不升级或替换 Playwright。
- 不改 OpenAI 注册 selector、OTP、资料页或 token 落盘逻辑。
- 不用裸 CDP 替换现有 Playwright 自动化。
