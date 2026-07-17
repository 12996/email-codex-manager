# 补号协议注册实时日志设计

## 目标

在 `/replacement-ui` 的补号管理页中，实时显示当前单账号协议注册的执行日志，让管理员无需切换到独立日志页即可看到当前步骤、子进程输出和最终结果。

## 范围与约束

- 本次只处理单账号“协议注册”操作，不实现批量队列。
- 网页日志只保留当前页面生命周期内的当前任务内容：刷新页面或开始下一次协议注册时清空。
- 不写入 `localStorage`，不追加到“最近操作记录”。
- 后台 `data/automation-logs/` 和 `replacement_automation_runs` 继续使用现有逻辑，保留上限仍由 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS` 控制，默认 30。
- 保持现有 JSON API 调用兼容：非 SSE 客户端仍获得原有 JSON 响应。

## 当前问题

- `web/app.js` 的 `registerProtocolAccount` 使用普通 JSON 请求，必须等待子进程结束后才能更新页面。
- `src/server.js` 的单账号协议注册路由只返回最终结果，没有实时输出通道。
- `src/replacementServices.js` 已在接收子进程 stdout/stderr，但只写入后台日志文件，未向调用方转发。
- 现有 `progressDialog` 只用于验活和 Plus 状态查询的 SSE 进度，不在补号列表下方常驻显示。

## 方案

采用现有 SSE 模式，不引入 WebSocket 或新依赖。

1. 前端在账号列表面板和快捷操作面板之间加入内嵌的“当前协议注册日志”区域。
2. 点击行操作中的“协议注册”时，前端清空旧内容、显示目标邮箱和“准备中”状态，然后以 `Accept: text/event-stream` 请求现有协议注册路由。
3. 后端根据 `Accept` 头选择 SSE 响应；普通请求仍走原有 JSON 响应。
4. `replacementServices.registerProtocolAccount` 接受可选的日志回调，将 Roxy 准备阶段和协议子进程 stdout/stderr 转成结构化事件。
5. SSE 事件至少包含：
   - `start`：账号、任务开始；
   - `step`：Roxy 准备或服务阶段变化；
   - `log`：stdout/stderr 文本块及来源；
   - `complete`：成功及账号状态；
   - `error`：失败原因。
6. 前端只把这些事件追加到当前日志面板，不写入历史活动列表；任务结束后保留最后状态，下一次任务开始时清空。

## 错误与连接处理

- 如果协议注册被共享 Roxy profile 的 single-flight 锁拒绝，面板显示明确的忙碌错误。
- 浏览器断开 SSE 后，服务端不额外创建新任务；子进程继续按现有逻辑运行并写入后台日志。
- 子进程失败时同时保留现有运行记录/日志文件，并向网页发送失败事件。
- 页面只显示当前任务，不负责恢复历史任务；历史查看继续使用 `/replacement-automation-logs`。

## 变更文件

- 修改 `src/replacementServices.js`：增加日志回调透传和 Roxy 准备阶段事件。
- 修改 `src/server.js`：为单账号协议注册增加 SSE 响应分支。
- 修改 `web/index.html`：增加内嵌实时日志区域。
- 修改 `web/app.js`：使用 SSE 启动协议注册、渲染日志、清理临时状态。
- 修改 `web/styles.css`：增加日志区域布局和 stdout/stderr 样式。
- 修改 `test/replacementServices.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`：覆盖日志回调、SSE 事件和页面入口。

## 验收标准

1. 点击单账号“协议注册”后，日志区域立即显示目标邮箱和开始状态。
2. 协议执行期间，Roxy 准备步骤和协议子进程 stdout/stderr 能持续显示。
3. 成功、失败、忙碌和子进程异常均能在日志区域看到明确结果。
4. 页面刷新后不显示上一轮网页日志；再次启动时不会混入上一轮内容。
5. “最近操作记录”不新增协议注册原始日志。
6. 后台运行记录与日志文件仍按现有 30 条保留配置工作。
7. 原有 JSON API、独立自动化日志页和其他批量 SSE 操作不回归。

## 回滚

只需回滚本次前端 SSE、后端日志回调和测试/文档 diff；不涉及数据库迁移，不需要清理既有运行记录或日志文件。
