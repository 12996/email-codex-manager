# 无 2FA Roxy 注册：接口证据与执行边界

状态：active guidance  
证据来源：2026-08-02 Roxy CDP 手动流程录制  
关联实现：`src/auto/protocol_no_2fa_registration.py`（已实现）

本文只列出录制实际出现、或由现有 Roxy 客户端直接定义的接口。Token、Cookie、OTP、
代理密码、CDP 地址和 OAuth query 值均只能在运行内存中使用，不能进入日志、测试夹具或本文档。

## 1. 已确认的 ChatGPT / Auth 请求链

| 顺序 | 方法与路径 | 录制到的请求参数 | 成功判定 | 下一步 |
|---:|---|---|---|---|
| 1 | `GET https://chatgpt.com/api/auth/providers` | 无 | HTTP 200，响应含 `openai` provider | 读取 CSRF |
| 2 | `GET https://chatgpt.com/api/auth/csrf` | 无 | HTTP 200，响应含 `csrfToken` | 发起 signin |
| 3 | `POST https://chatgpt.com/api/auth/signin/openai` | query: `ext-oai-did`、`auth_session_logging_id`、`screen_hint=login_or_signup`、`prompt=login`、`login_hint`；form: `callbackUrl=https://chatgpt.com/login`、`csrfToken`、`json=true` | HTTP 200，JSON 返回 Auth authorize URL | 只跟随该 URL |
| 4 | `GET https://auth.openai.com/api/accounts/authorize?...` | 步骤 3 返回的完整 URL；不得自行构造 `state`、`client_id`、`scope` 或 callback 参数 | HTTP 200，Auth 会话建立且运行态到达 `email-verification` | 单次重发 OTP |
| 5 | `POST https://auth.openai.com/api/accounts/email-otp/resend` | 无请求体 | HTTP 200，JSON `success=true` | 开始本阶段 OTP 轮询 |
| 6 | `POST https://auth.openai.com/api/accounts/email-otp/validate` | JSON `{ "code": "<6-digit OTP>" }` | HTTP 200，`page.type=about_you`、`method=GET`、非空 `continue_url` | 跟随 continuation |
| 7 | `GET <步骤 6 的 continue_url>` | 步骤 6 原样提供 | HTTP 成功并进入资料页 | 提交资料 |
| 8 | `POST https://auth.openai.com/api/accounts/create_account` | JSON `{ "name": "<ASCII letters/spaces>", "birthdate": "YYYY-MM-DD" }` | HTTP 200，`page.type=external_url`、`method=GET`、非空 `continue_url` | 跟随 continuation |
| 9 | `GET <步骤 8 的 continue_url>` | 步骤 8 原样提供，最终重定向到 ChatGPT OAuth callback | HTTP 成功；浏览器同一上下文接收 session Cookie | 轮询 session |
| 10 | `GET https://chatgpt.com/api/auth/session` | 无 | HTTP 200 且 JSON 有非空 `accessToken` | 保存 AT，结束 |

本次录制未出现以下请求，因此无 2FA 协议不得调用它们：

```text
POST /api/accounts/user/register
POST /backend-api/accounts/mfa/enroll
POST /backend-api/accounts/mfa/user/activate_enrollment
```

### 1.1 本地完成状态回写

第 10 步得到 AT 后，脚本先以原始文本写入
`src/auto/product_files/registration/<email>.txt`，随后复用本地补号服务：

```text
PATCH /replacement-accounts/:id/status
{ "status": "registered", "status_note": "协议注册成功" }
```

该请求不携带 AT、OTP、Cookie 或 Roxy 数据。只有 AT 文件已成功落盘时才允许回写；本地状态请求
失败会使脚本失败并保留 AT 文件，且不得重新发起 Auth、OTP 或建号请求。

### 1.2 补号管理操作接口

```text
POST /replacement-accounts/:id/register-no2fa
```

该接口仅接受当前状态为 `unregistered` 的补号账号，返回 `202` 和队列快照。它与原有
`register-protocol` 共用单线程协议注册队列，避免共享 Roxy profile 并发。队列 worker 启动
`src/auto/protocol_no_2fa_registration.py --email <account.email>`，并在子进程返回后复查该账号已由
脚本回写为 `registered`；不要求或生成 TOTP secret。

补号管理还提供独立的浏览器操作：

```text
POST /replacement-accounts/:id/register-no2fa-browser
```

该接口同样仅接受 `unregistered` 账号，并与上述接口共用同一单线程队列。worker 启动
`src/auto/roxy_no_2fa_register.js --email <account.email>`；该 runner 在可见 Roxy tab 顶层导航到
`https://chatgpt.com/api/auth/session` 后读取 AT，先落盘、再回写 `registered`。队列和前端显示操作名为
“自动化无2FA注册”，它不替换已有的 Python 协议“无2FA注册”操作。

服务进程必须具备可用的 Roxy 准备配置：优先使用数据库 profile 代理绑定/模板；若尚未配置，需在
服务启动环境中显式设置 `ROXY_NO_2FA_PREPARER` 指向已验证的手动刷新脚本。不得在接口请求体、
前端响应或运行日志中传递 AT、代理凭据、Cookie 或 CDP endpoint。

## 2. Auth 请求头和 Sentinel 约束

以下不是固定值，必须由当前同一 Roxy 页面上下文生成：

| 接口 | 必需动态头 | 来源与约束 |
|---|---|---|
| `email-otp/validate` | `openai-sentinel-token`、`openai-sentinel-so-token`、`x-access-flow-invocation-id` | 当前 Roxy 页面 Sentinel SDK 的 `authorize_continue` flow；每次 API 调用生成新的 invocation ID |
| `create_account` | `openai-sentinel-token`、`openai-sentinel-so-token`、`x-access-flow-invocation-id` | 当前 Roxy 页面 Sentinel SDK 的 `oauth_create_account` flow；缺 SO token 时停止，不降级伪造 |
| `email-otp/resend` | 录制只出现浏览器默认头和 Auth Cookie，没有请求体或 Sentinel 头 | 只在当前 Auth 会话内调用一次；不得因超时盲目重发 |

Cookie、`User-Agent`、`sec-*`、Datadog trace 头、OAuth `state` 和 callback `code` 均由
浏览器自动管理，不能人工复制。现有 `RoxyCdpClient` 应在同一浏览器 context 中通过
`fetch` / `navigate` 发出请求。

## 3. Roxy 本地 API 准备顺序

本节对应 `test/manual-roxy-proxy-refresh.cjs`，不是 OpenAI API。所有接口以
`ROXY_API_BASE_URL` 为前缀；请求带 JSON `Content-Type`，配置存在时才带 Roxy API `token` 头。

| 顺序 | Roxy 接口 | 请求体/查询参数 |
|---:|---|---|
| 1 | `GET /browser/list` | `workspaceId`、`pageIndex=1`、`pageSize=100`；确认目标 `dirId` 存在 |
| 2 | `GET /proxy/list` | `workspaceId`、`pageIndex=1`、`pageSize=100`；确认目标 `proxyId` 存在且有 `checkChannel`、`ipType`、`protocol` |
| 3 | `POST /proxy/modify` | `id`、`workspaceId`、`checkChannel`、`ipType`、`protocol`、`host`、`port`、`proxyUserName`、`proxyPassword`、`refreshUrl`、`remark`；用户名使用新的随机 SID |
| 4 | `POST /browser/close` | `{ "dirId": "..." }` |
| 5 | `POST /browser/clear_local_cache` | `{ "dirIds": ["..."] }` |
| 6 | `POST /browser/clear_server_cache` | `{ "workspaceId": 123, "dirIds": ["..."] }` |
| 7 | `POST /browser/random_env` | `{ "workspaceId": 123, "dirId": "..." }` |
| 8 | `POST /browser/open` | `{ "workspaceId": 123, "dirId": "...", "dirIds": ["..."], "args": [] }`；无头模式时才加 browser args |
| 9 | `GET /browser/connection_info` | `dirIds=<dirId>`；响应中的 `ws` 只在内存使用 |

任何 Roxy 接口失败都应在进入 OAuth 前停止；不能拿旧 CDP endpoint 继续运行。代理密码与
CDP endpoint 不得打印到 stdout 或运行日志。

### 3.1 当前准备器配置边界

默认 `prepare_roxy_no_2fa.cjs` 从本地数据库读取目标 profile 的代理绑定和代理模板，再调用
既有 Roxy proxy service 完成上述刷新顺序。profile 没有绑定代理或绑定代理不可用时，准备器会在
任何 Roxy 修改前失败，不能自动猜测或复用其他 profile 的代理。

当现有 profile 尚未配置到该数据库，但用户已提供同等刷新顺序的手动准备脚本时，可显式设置
`ROXY_NO_2FA_PREPARER` 指向该脚本。主脚本只解析其多行 JSON 输出中的 `dirId`，并连接这次
新鲜打开的同一 Roxy profile；这不是默认降级路径，也不能用于转发代理凭据、Cookie、CDP endpoint
或其他敏感值。

## 4. 错误分类和重试规则

| 情况 | 动作 |
|---|---|
| Roxy API、CDP 或首次页面请求的临时网络错误 | 使用既有 CDP bridge 的有限重试；若同 origin 页面已变成 `chrome-error://`，丢弃该页并在同一 context 新建页面后重试；耗尽后停止 |
| `providers` 或 `csrf` 的临时连接错误 | 这两个幂等请求最多有限重试；其余 Auth 写入请求不因网络错误盲目重放 |
| `email-otp/resend` 已收到 HTTP 响应 | 不再次发送，开始等待当前阶段的新邮件 |
| OTP 返回 `wrong_email_otp_code` | 排除当前 code，按 5 秒间隔等待新 code；总窗口 120 秒 |
| Auth HTTP 4xx、`page.type` 不匹配、缺 continuation、缺 Sentinel SO token | 停止本次 OAuth transaction；不靠 URL/DOM 猜测推进 |
| `create_account` 已返回 200，callback/session 失败 | 远端账号可能已创建；仅重试 callback/session，不重发 create_account |
| session HTTP 200 但没有 `accessToken` | 有限退避轮询 session；耗尽后失败且不写 AT 文件 |
| AT 已落盘但本地 `registered` 状态回写失败 | 停止，不删除 AT，也不重放 Auth 请求；修复本地服务后仅补做状态回写 |

## 5. 浏览器自动化兜底

当前网络录制足以实现协议路径，但不包含 DOM selector、可访问性树或用户操作事件。若线上
Auth 契约变化，浏览器自动化可作为兜底，但必须先对新的未注册邮箱重新启动
`src/auto/roxy_register_openai_recorder.cjs` 进行 DOM 录制，再依据真实录制生成 Playwright
步骤代码和回归测试；不得从当前网络记录猜测 selector。

浏览器兜底仍复用本节的 Roxy 准备顺序和同一 CDP profile，且必须以阶段专用状态机判断
结果，不能仅以 click 成功、URL 改变或元素消失判定注册完成。

已新增独立浏览器 runner：

```powershell
node .\src\auto\roxy_no_2fa_register.js --email <unregistered-email>
```

它只允许邮箱、OTP、资料页和 session 阶段；遇到密码页、CAPTCHA、已注册邮箱、不可操作控件或未确认的
下一阶段时停止。`ROXY_NO_2FA_PREPARER` 可指定手动刷新脚本，runner 只从其 stdout 读取新 profile 的
`dirId`，不会转发准备器原始输出。AT 落盘后才回写 `registered`。该 runner 当前用于浏览器实机验证，
不会替换 `POST /replacement-accounts/:id/register-no2fa` 的 Python 协议 runner；补号管理的
`POST /replacement-accounts/:id/register-no2fa-browser` 会显式调用它。

外部邮箱验证码 API 的瞬时读取错误在既有轮询上限内重试；旧 OTP 被拒绝且未出现新码时，runner 会点击
`Resend email` 后继续等待。`chatgpt.com/auth/error` 或 session 未返回 `accessToken` 都是失败终态，
不会生成 AT 文件或回写 `registered`。

about-you 不能以 click、URL 变化或表单消失判定成功：runner 在点击前监听
`POST /api/accounts/create_account`，仅当该请求包含 `name`、`birthdate`，响应为 2xx 且
`page.type=external_url` 时才等待 ChatGPT callback。
