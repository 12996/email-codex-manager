# 2026-07-20 Gmail-IMAP 协议补号操作

## 目标

为补号管理页接入已完成的独立 CPA 2FA 协议，并将“协议注册”“协议补号”调整到操作菜单最前面。

## 实现

- 新增 `src/auto/protocol_cpa_replacement.py`，按 `REPLACEMENT_ACCOUNT_ID` 获取当前账号，调用 `protocol_cpa_auth.py`。
- 新增 `POST /replacement-accounts/:id/replace-2fa-protocol`。
- CPA worker 新增 `2fa-protocol` 模式，成功后沿用 CPA 上传和健康复查。
- 前端新增“协议补号”，菜单顺序为“协议注册”→“协议补号”→其他操作。
- 点击“协议补号”后前端立即写入操作记录并显示启动提示，不再因等待后端完成 CPA 生成、上传和健康复查而看起来无响应。
- 协议补号现在使用 SSE 实时流：补号列表下方新增“当前协议补号日志”，显示 Roxy/子进程 stdout/stderr、CPA JSON 读取、上传、健康复查和成功/失败步骤；历史“补号子进程日志”页面不变。
- 注册状态机和原 DOM 2FA 补号未修改。

## 点击无反应排查

- 首次排查确认 `13100` 仍由旧 Node 进程提供服务；旧进程未加载 `POST /replacement-accounts/:id/replace-2fa-protocol`，请求会返回旧路由的 `404 Cannot POST`。
- 已重启 `start:home-proxy`，当前 `node src/server.js` PID 为 `33588`，启动时间为 `2026-07-20 16:25:22`。
- 旧前端实现只等待一个长时间同步 POST 完成后才写入成功/失败记录；点击时菜单关闭且无即时提示，容易被误判为没有反应。已补充启动记录和 toast。
- 页面模板未对 `web/app.js` 做版本化；重启服务后必须重新打开页面或执行 `Ctrl+F5`，确保浏览器加载当前脚本。
- `.env` 已配置账号 109 既有 Auth 凭证中的 OpenAI workspace；协议补号、普通补号和 2FA 登录均已统一定位到 Roxy `617-3/test`。不要重复触发已完成过 add-phone/SMS 的账号 109。

## 配置

```env
OPENAI_WORKSPACE_ID=<已配置账号级 OpenAI workspace id>
```

不要使用 Roxy `ROXY_WORKSPACE_ID=111070` 作为 OpenAI workspace ID。

## 验证

- Python 协议补号专项：2/2。
- `test/replacementServices.test.js`：37/37。
- `test/cpaRepairWorker.test.js`：8/8。
- `test/replacementAccountsApi.test.js`：36/36。
- `test/replacementAccountsWeb.test.js`：16/16。
- Python 注册协议回归：47/47；CPA 相关专项：8/8。
- 全量 Node：403 个测试中 402 通过，唯一失败为未启动 `localhost:3100` 的 `test/test-verification-code.mjs`，与本次协议补号改动无关。
- `node --check`、Python 编译检查和 `git diff --check` 通过；`src/auto/protocol_registration/main.py` 未修改。
- 前端回归：`node --test test/replacementAccountsWeb.test.js` 16/16 通过，覆盖实时日志面板位置、SSE 调用和协议补号按钮顺序。

## 协议补号实时日志实现（当前阶段）

- `POST /replacement-accounts/:id/replace-2fa-protocol` 在请求 `Accept: text/event-stream` 时返回 SSE；不带该请求头仍返回原 JSON 响应。
- `cpaRepairWorker.repair()` 接收 `onLog`，向前端转发子进程输出以及 CPA 读取、上传、复查、成功/失败步骤。
- `web/index.html` 将协议补号日志面板放在补号账号列表后、协议注册日志前；协议注册日志和历史自动化日志保持独立。
- 回归：web 16/16、API 36/36、worker 8/8；`web/app.js`、`src/server.js` 语法检查和改动范围 `git diff --check` 通过。

尚未用新的后台按钮对新账号执行真实协议补号；配置已完成，下一次真实运行使用新的测试账号。

## ID 116 点击排查（17:10）

- 点击请求已经到达后端，并创建运行记录 `run_id=582`；日志文件为 `data/automation-logs/replacement-2fa-protocol-116-2026-07-20T09-10-39-175Z.log`。
- 子进程已收到 `OPENAI_WORKSPACE_ID` 和同一 Roxy 目标环境，但在创建 Roxy 会话前因账号 `116` 缺少 `codex_2fa` 退出。
- 账号 116 当前有密码、手机号和 SMS API，但没有 TOTP/2FA secret；因此浏览器不打开是前置校验的预期结果，不是 Roxy 窗口定位失败。
- 当时前端只增加了启动 toast，没有为协议补号接入协议注册专用的实时日志面板；该次运行日志需从 `/replacement-automation-logs` 查看。

## 账号 108 运行失败排查（17:25）

- `replacement-2fa-protocol-108-2026-07-20T09-25-12-215Z.log` 已通过登录、2FA、手机号阶段，失败点明确为 `sign-in-with-chatgpt/codex/consent.data`。
- 原因一：`response_json()` 只接受 `dict`，而该 endpoint 在部分已具备/无需 challenge 的状态下返回 JSON 数组；`extract_consent_challenge()` 原本已经支持数组，解析层与提取层不一致。
- 原因二：该次日志中 `ROXY_CDP_ENDPOINT=unset` 且没有 `prepare-roxy`，证明 13100 使用的是重启前旧 Node 进程，未加载协议补号的 Roxy 刷新前置逻辑。
- 修复：`protocol_cpa_auth.py` 对 `consent.data` 使用允许 `dict/list` 的解析入口；`replacementServices.js` 在协议补号 spawn 前强制刷新动作级 Roxy profile，并把新 CDP 注入子进程、设置 `ROXY_CDP_PREPARE=0` 防止二次刷新。
- 验证：CPA Python 测试 5/5；replacement services Node 测试 37/37；Python 编译、Node 语法和 `git diff --check` 通过。13100 已重启，新的 `node src/server.js` 启动时间为 17:29:54。
- 账号 108 尚未在修复后重新触发，避免在未确认用户意图时重复发送短信；下一次真实日志应包含刷新后的 CDP 状态，且不应再出现 `non-object JSON`。

## Run 590 / 账号 111 workspace 401 排查（17:34）

- 本次日志已证明 Roxy 刷新逻辑生效：ROXY_CDP_ENDPOINT=set，不是旧服务进程或未创建 CDP 的问题。
- 失败阶段为 POST /api/accounts/workspace/select -> HTTP 401。账号 111 的现有注册 token 是 free 计划，没有账号 109 的组织 poid；其 personal workspace 为 7e2e668c-cd6a-4eb6-9a44-297691e39323。
- 历史 Roxy 被动录制对同一邮箱的真实请求体也是 {"workspace_id":"7e2e668c-cd6a-4eb6-9a44-297691e39323"}。原独立 CPA 入口却把 .env 中账号 109 的组织 workspace 传给账号 111，导致 401；同时原请求没有录制中出现的 x-access-flow-invocation-id。
- 修复：Roxy CDP bridge 新增 auth_workspaces，只解析 oai-client-auth-session cookie 中的 id/kind/name；CPA 在 MFA 后优先使用当前会话匹配值或 personal workspace，并为 workspace/select 增加 invocation header。
- 自动验证：CPA Python 6/6、Roxy CDP Node 10/10、Roxy bridge Python 23/23 通过；尚未对账号 111 再次真实触发，避免未经确认重复发送短信。
