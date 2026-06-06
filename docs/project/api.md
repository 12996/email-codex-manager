# Gmail IMAP Service API 文档

本文档描述当前服务已实现的页面接口。当前项目主要是服务端渲染页面，不是纯 JSON API；大多数接口接收 `application/x-www-form-urlencoded` 表单并返回 HTML 或重定向。

## 基础信息

默认地址：

```text
http://localhost:3100
```

认证方式：

```text
Cookie: admin_auth
```

登录成功后服务会写入签名 Cookie：

```text
admin_auth=1
有效期：30 天
httpOnly=true
sameSite=lax
signed=true
```

除 `/login` 外，其余后台接口都需要先登录。

## 状态码约定

```text
200  成功，返回 HTML
302  重定向
400  表单参数错误、IMAP 连接失败、Gmail 认证失败
401  后台密码错误
404  账号不存在
```

## 页面接口

### GET `/login`

显示后台登录页。

响应：

```text
HTML
```

### POST `/login`

提交后台密码。

请求类型：

```text
application/x-www-form-urlencoded
```

字段：

```text
password  必填，后台密码，对应 .env 里的 ADMIN_PASSWORD
```

示例：

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:3100/login" `
  -Method Post `
  -Body @{ password = "admin" } `
  -SessionVariable session
```

成功：

```text
302 -> /accounts
Set-Cookie: admin_auth=...
```

失败：

```text
401
返回登录页，并显示“后台密码不正确”
```

### POST `/logout`

退出登录并清除 Cookie。

成功：

```text
302 -> /login
```

### GET `/`

后台首页入口。

成功：

```text
302 -> /accounts
```

### GET `/accounts`

显示新版邮箱账号管理页。页面文件位于 `web/accounts.html`，并复用 `web/styles.css` 的后台管理风格。

页面包含：

- 新增邮箱弹窗
- 邮箱账号列表
- 邮箱账号分页控件，支持每页 10/20/50 条、上一页和下一页
- 获取邮件结果区域，只有执行获取操作后显示
- 统计卡片、快捷操作、状态分布和最近操作记录

成功：

```text
200 HTML
```

未登录：

```text
302 -> /login
```

前端脚本：

```text
web/accounts.js
```

## 邮箱账号接口

新版邮箱账号页面优先使用 `/api/accounts*` JSON API。以下旧表单接口仍保留兼容。

## 邮箱账号 JSON API

所有接口都需要后台登录态。

### GET `/api/accounts`

获取邮箱账号列表。支持服务端分页、状态筛选和关键词搜索。

查询参数：

```text
page      可选，页码，默认 1
pageSize  可选，每页条数，默认 10，最大 100
status    可选，按账号状态精确筛选
keyword   可选，按 Gmail、备注、状态或最近错误模糊搜索
```

成功：

```json
{
  "ok": true,
  "accounts": [],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 0,
    "totalPages": 1
  }
}
```

### GET `/api/accounts/:id`

获取单个邮箱账号。

### POST `/api/accounts`

新增 Gmail 邮箱账号。

请求体：

```json
{
  "display_name": "main",
  "gmail_email": "user@gmail.com",
  "gmail_password": "your-google-password",
  "gmail_2fa": "your-2fa",
  "gmail_app_password": "abcdefghijklmnop"
}
```

成功状态码：`201`。

### PUT `/api/accounts/:id`

更新 Gmail 邮箱账号。请求字段同新增账号。

### DELETE `/api/accounts/:id`

删除 Gmail 邮箱账号。

成功：

```json
{
  "ok": true
}
```

### POST `/api/accounts/:id/test`

测试 Gmail IMAP 连接。成功后更新：

```text
status = active
last_fetch_status = success
last_error = null
```

### POST `/api/accounts/:id/fetch`

实时获取 Gmail 邮件。

请求体：

```json
{
  "readLocation": "inbox",
  "limit": 30
}
```

成功：

```json
{
  "ok": true,
  "account": {},
  "result": {
    "title": "user@gmail.com 获取结果",
    "messages": []
  },
  "messages": []
}
```

### POST `/accounts`

新增 Gmail 邮箱账号。

请求类型：

```text
application/x-www-form-urlencoded
```

字段：

```text
display_name          可选，备注
gmail_email           必填，Gmail 邮箱号
gmail_password        必填，Gmail 登录密码，明文保存
gmail_2fa             必填，2FA，明文保存
gmail_app_password    必填，Gmail App Password，明文保存
```

注意：

实际 IMAP 获取邮件只使用：

```text
gmail_email + gmail_app_password
```

`gmail_password` 和 `gmail_2fa` 只用于本地后台展示/存档。

示例：

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:3100/accounts" `
  -Method Post `
  -WebSession $session `
  -Body @{
    display_name = "main"
    gmail_email = "user@gmail.com"
    gmail_password = "your-google-password"
    gmail_2fa = "your-2fa"
    gmail_app_password = "abcd efgh ijkl mnop"
  }
```

成功：

```text
302 -> /accounts
```

失败：

```text
400 HTML
```

### GET `/accounts/:id/edit`

显示编辑邮箱账号页面。

路径参数：

```text
id  邮箱账号 ID
```

成功：

```text
200 HTML
```

账号不存在：

```text
404 Account not found
```

### POST `/accounts/:id`

更新邮箱账号。

请求类型：

```text
application/x-www-form-urlencoded
```

字段同新增账号：

```text
display_name
gmail_email
gmail_password
gmail_2fa
gmail_app_password
```

成功：

```text
302 -> /accounts
```

失败：

```text
400 HTML
```

### POST `/accounts/:id/delete`

删除邮箱账号。

路径参数：

```text
id  邮箱账号 ID
```

成功：

```text
302 -> /accounts
```

## Gmail IMAP 操作接口

### POST `/accounts/:id/test`

测试 Gmail IMAP 连接。

后端行为：

1. 读取账号。
2. 使用 `gmail_email + gmail_app_password` 连接 Gmail IMAP。
3. 成功则更新账号状态。
4. 失败则记录错误。

成功时更新：

```text
status = active
last_fetch_status = success
last_error = null
```

失败时：

```text
Gmail 认证失败：
status = auth_failed
last_fetch_status = failed

其他 IMAP/网络错误：
status = error
last_fetch_status = failed
```

成功响应：

```text
200 HTML
```

失败响应：

```text
400 HTML
```

### POST `/accounts/:id/fetch`

实时获取 Gmail 邮件。

请求类型：

```text
application/x-www-form-urlencoded
```

字段：

```text
readLocation  必填/可选，读取位置，默认 inbox
limit         必填/可选，读取数量，默认 5，最大 50
```

`readLocation` 可选值：

```text
inbox   收件箱，映射到 INBOX
all     全部邮件，映射到 [Gmail]/All Mail，并过滤自己发出的邮件
trash   垃圾箱，合并 [Gmail]/Spam 和 [Gmail]/Trash
```

示例：

```powershell
Invoke-WebRequest `
  -Uri "http://localhost:3100/accounts/1/fetch" `
  -Method Post `
  -WebSession $session `
  -Body @{
    readLocation = "inbox"
    limit = "5"
  }
```

成功：

```text
200 HTML
```

页面会在邮箱列表下方显示 Gmail 风格邮件列表。

邮件默认只显示：

```text
发件人
主题
摘要
来源邮箱夹
时间
```

点击邮件行后展开：

```text
标题
发件人
时间
来源邮箱夹
HTML 正文或纯文本正文
```

失败：

```text
400 HTML
```

常见错误：

```text
Gmail 认证失败：请确认 Gmail 邮箱号正确、App Password 没有填错或被撤销，并确认 Gmail 已允许 IMAP。
```

## 验证码 JSON API

### POST `/api/verification-code/latest`

根据传入的 Gmail 主账号或 `+tag` 别名，返回最近邮件中的 6 位验证码。

该接口复用后台登录态，非本机调用前需要先登录后台并携带 `admin_auth` cookie。

本机请求免后台登录态，允许 `127.0.0.1`、`::1`、`::ffff:127.0.0.1` 调用本接口时不携带 `admin_auth`，用于本地自动化脚本直接获取验证码。

请求类型：

```text
application/json
```

请求体：

```json
{
  "account": "jregkolpig+s2@gmail.com"
}
```

后台行为：

1. 将 `jregkolpig+s2@gmail.com` 路由到主账号 `jregkolpig@gmail.com`。
2. 从数据库查找主账号 `jregkolpig@gmail.com` 的 App Password。
3. 使用主账号连接 Gmail IMAP。
4. 只匹配投递到请求别名的邮件。
5. 从最新邮件的正文或标题中提取独立的 6 位数字验证码。

成功响应：

```json
{
  "ok": true,
  "account": "jregkolpig+s2@gmail.com",
  "mainAccount": "jregkolpig@gmail.com",
  "code": "123456",
  "from": "Google <no-reply@google.com>",
  "subject": "Verification",
  "date": "2026-06-01T10:00:00.000Z"
}
```

主账号未配置：

```json
{
  "ok": false,
  "account": "jregkolpig+s2@gmail.com",
  "mainAccount": "jregkolpig@gmail.com",
  "error": "ACCOUNT_NOT_FOUND",
  "message": "数据库中没有配置主 Gmail 账号"
}
```

未找到验证码：

```json
{
  "ok": false,
  "account": "jregkolpig+s2@gmail.com",
  "mainAccount": "jregkolpig@gmail.com",
  "code": null,
  "error": "CODE_NOT_FOUND",
  "message": "未找到最近的 6 位验证码邮件"
}
```

### GET `/api/verification-code/public/latest`

根据补号账号表中放权的公开验证码 key，返回该行邮箱最近邮件中的 6 位验证码。

该接口不需要 `admin_auth`，但不会接收邮箱明文；外部调用方只能传入数据库中配置的 `public_code_key`。

请求：

```text
GET /api/verification-code/public/latest?key=vc_8Jf3qP9xK2mN7rT6sL4aBcDeFgHi
```

后台行为：

1. 使用 `key` 查找 `replacement_accounts.public_code_key`。
2. 只允许 `public_code_enabled = 1` 且未软删除的补号账号。
3. 使用该补号账号行的 `email` 作为目标邮箱。
4. 后续复用 `POST /api/verification-code/latest` 的主账号路由、IMAP 读取、别名匹配和 6 位验证码提取逻辑。

成功响应同 `POST /api/verification-code/latest`：

```json
{
  "ok": true,
  "account": "jregkolpig+s2@gmail.com",
  "mainAccount": "jregkolpig@gmail.com",
  "code": "123456",
  "from": "Google <no-reply@google.com>",
  "subject": "Verification",
  "date": "2026-06-01T10:00:00.000Z"
}
```

缺少 key：

```json
{
  "ok": false,
  "error": "KEY_REQUIRED",
  "message": "key is required"
}
```

key 无效、未启用或账号已删除：

```json
{
  "ok": false,
  "error": "PUBLIC_ACCESS_DENIED",
  "message": "验证码访问 key 无效或未启用"
}
```

主账号未配置、未找到验证码、IMAP 失败等响应同 `POST /api/verification-code/latest`。

## 补号账号 JSON API

补号账号接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。接口请求和响应均为 JSON。

补号账号前端页面：

```text
GET /replacement-ui
```

补号子进程日志页面：

```text
GET /replacement-automation-logs
```

静态前端文件位于：

```text
web/index.html
web/styles.css
web/app.js
web/automation-logs.html
web/automation-logs.js
```

页面入口需要后台登录态，前端通过 `/replacement-accounts*` JSON API 读取和操作数据。
日志页面同样需要后台登录态，前端通过 `/replacement-automation-runs*` JSON API 读取运行记录、查看日志和停止运行中的子进程。

补号管理页账号列表支持服务端分页、状态筛选和关键词搜索；前端分页控件支持每页 10/20/50 条、上一页和下一页。

补号管理页支持直接配置公开验证码接口：

- 新增或编辑补号账号时，可勾选“允许公开验证码接口”，对应 `public_code_enabled = 1`。
- “公开验证码 Key” 对应 `public_code_key`；留空时由后端自动生成，也可以手动覆盖为不可猜测字符串。
- 补号列表会在邮箱下方显示公开验证码启用状态和 key。
- 操作菜单中的“复制公开验证码 URL”会生成：

```text
<当前站点>/api/verification-code/public/latest?key=<public_code_key>
```

### 字段说明

SQLite 表：`replacement_accounts`

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `email` | 补号邮箱，必填，大小写不敏感唯一 |
| `phone` | 手机号，可为空，可重复 |
| `sms_api` | SMS 验证码接口地址 |
| `sms_last_error` | 最近一次 SMS 获取失败原因 |
| `activation_method` | 开通方式 |
| `activated_at` | 开通时间；创建补号账号时为空则由系统写入当前时间 |
| `status` | 账号状态 |
| `status_updated_at` | 最近状态更新时间 |
| `status_note` | 状态备注 |
| `replacement_count` | 成功补号次数 |
| `json_payload` | 最近一次获取的 JSON 原文 |
| `json_fetched_at` | 最近一次 JSON 获取时间 |
| `last_replace_at` | 最近一次成功补号时间 |
| `last_error` | 最近一次 JSON 或补号错误 |
| `remark` | 管理员备注 |
| `public_code_enabled` | 是否允许使用公开 GET 接口获取该邮箱验证码，`1` 为允许，默认 `0` |
| `public_code_key` | 公开 GET 接口使用的随机访问 key；创建补号账号时自动生成，也可手动覆盖为不可猜测字符串 |
| `deleted_at` | 软删除时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

验证码不入库；SMS 原始响应不入库；补号失败不增加 `replacement_count`。`remark` 仅用于人工标注来源或用途，不参与公开验证码接口的权限判断。

### 状态枚举

| 状态 | 中文含义 | 说明 |
|---|---|---|
| `pending` | 待处理 | 新增默认状态 |
| `active` | 正常 | 账号可用 |
| `banned` | 已封禁 | 账号不可用，需要补号 |
| `replacing` | 补号中 | 系统自动状态，不允许手动设置 |
| `replaced` | 已补号 | 自动补号成功 |
| `failed` | 失败 | 自动补号失败或手动标记失败 |

### 通用错误响应

```json
{
  "ok": false,
  "error": "EMAIL_DUPLICATE",
  "message": "email already exists"
}
```

常见错误码：

| 错误码 | HTTP 状态 | 说明 |
|---|---:|---|
| `EMAIL_REQUIRED` | 400 | 缺少邮箱 |
| `EMAIL_DUPLICATE` | 409 | 邮箱重复 |
| `ACCOUNT_NOT_FOUND` | 404 | 补号账号不存在或已删除 |
| `STATUS_INVALID` | 400 | 状态不允许 |
| `SMS_API_REQUIRED` | 400 | 缺少 SMS API 地址 |
| `SMS_FETCH_FAILED` | 502 | SMS 接口请求或解析失败 |
| `JSON_URL_REQUIRED` | 400 | 缺少 JSON URL |
| `JSON_FETCH_FAILED` | 502 | JSON 请求或解析失败 |
| `REPLACE_FAILED` | 502 | 自动补号失败 |
| `REPLACE_NOT_CONFIGURED` | 502 | 自动补号适配器尚未配置 |
| `REGISTER_FAILED` | 502 | OpenAI 注册自动化失败 |

### GET `/replacement-accounts`

获取未软删除的补号账号列表。支持服务端分页、状态筛选和关键词搜索。

查询参数：

```text
page      可选，页码，默认 1
pageSize  可选，每页条数，默认 10，最大 100
status    可选，按补号账号状态精确筛选
keyword   可选，按邮箱、手机号、备注或状态模糊搜索
```

成功：

```json
{
  "ok": true,
  "accounts": [],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "total": 0,
    "totalPages": 1
  }
}
```

### GET `/replacement-accounts/:id`

获取单个补号账号。

成功：

```json
{
  "ok": true,
  "account": {}
}
```

### POST `/replacement-accounts`

新增补号账号。

请求体：

```json
{
  "email": "user@example.com",
  "phone": "13800000000",
  "sms_api": "https://example.invalid/sms",
  "activation_method": "manual",
  "activated_at": "2026-06-01T00:00:00.000Z",
  "status": "pending",
  "status_note": "optional",
  "remark": "optional"
}
```

成功：

```json
{
  "ok": true,
  "account": {}
}
```

### PUT `/replacement-accounts/:id`

修改补号账号基础信息。请求字段同新增账号。`email` 仍按大小写不敏感规则校验唯一。

### DELETE `/replacement-accounts/:id`

软删除补号账号。

成功：

```json
{
  "ok": true
}
```

### PATCH `/replacement-accounts/:id/status`

手动修改状态。允许状态：`pending`、`active`、`banned`、`replaced`、`failed`。

请求体：

```json
{
  "status": "banned",
  "status_note": "管理员手动标记封禁"
}
```

### PATCH `/replacement-accounts/:id/public-code`

启用或停用补号账号的公开验证码接口，不需要提交完整账号资料。

请求体：

```json
{
  "enabled": true
}
```

也可以显式传入 `public_code_key`；未传时保留已有 key，缺失时自动生成：

```json
{
  "enabled": true,
  "public_code_key": "vc_..."
}
```

成功：

```json
{
  "ok": true,
  "account": {
    "id": 1,
    "email": "user@example.com",
    "public_code_enabled": 1,
    "public_code_key": "vc_..."
  }
}
```

停用时设置：

```json
{
  "enabled": false
}
```

停用后同一 `public_code_key` 不再允许访问 `GET /api/verification-code/public/latest?key=...`。

### POST `/replacement-accounts/:id/fetch-sms-code`

实时请求账号配置的 `sms_api` 并返回验证码。验证码只在响应中返回，不写入数据库。

成功：

```json
{
  "ok": true,
  "code": "123456"
}
```

### POST `/replacement-accounts/:id/fetch-json`

从外部 URL 获取 JSON，并将 JSON 原文写入 `json_payload`。

请求体：

```json
{
  "url": "https://example.invalid/account.json"
}
```

成功：

```json
{
  "ok": true,
  "account": {}
}
```

### POST `/replacement-accounts/:id/register`

管理员手动触发 OpenAI 注册自动化。这里的“手动”仅指后台按钮/API 手动触发；网页注册流程仍由后端子进程自动执行。

自动化运行时代码位于：

```text
src/auto/roxy_register_openai.js
```

后端通过 `replacementServices.registerAccount(account)` 启动独立 Node 子进程，并复用 `replacement_automation_runs` 记录运行日志。注册脚本复用与 OAuth 补号一致的 RoxyBrowser 开窗/CDP 接管流程。该阶段只获取邮箱验证码，不使用 `replacement_accounts.sms_api`，也不会向子进程注入 `PHONE_VERIFICATION_SMS_API_URL`。

请求体：

```json
{}
```

后端行为：

1. 根据路径参数 `id` 读取 `replacement_accounts` 中未软删除账号。
2. 默认适配器启动子进程调用 `src/auto/roxy_register_openai.js`。
3. 子进程 env 使用 `replacement_accounts.email` 覆盖 `ROXY_REGISTER_EMAIL` 和 `ROXY_OAUTH_EMAIL`。
4. 注册脚本从 `https://chatgpt.com/` 进入注册流程。
5. 注册脚本通过 `POST /api/verification-code/latest`、请求体 `{ "account": "<email>" }` 获取邮箱验证码。
6. 日志写入 `data/automation-logs/registration-<id>-<timestamp>.log`，包含 `step=...` 阶段日志，不记录验证码、Cookie、token 或代理密码明文。

成功响应：

```json
{
  "ok": true,
  "account": {},
  "run": {
    "id": 12,
    "account_id": 1,
    "email": "jregkolpig+s2@gmail.com",
    "status": "succeeded"
  }
}
```

账号不存在：

```json
{
  "ok": false,
  "error": "ACCOUNT_NOT_FOUND",
  "message": "replacement account not found"
}
```

失败响应：

```json
{
  "ok": false,
  "error": "REGISTER_FAILED",
  "message": "注册自动化失败原因",
  "account": {}
}
```

### POST `/replacement-accounts/:id/replace`

执行自动补号。自动化运行时代码位于：

```text
src/auto/roxy_oauth_login.js
```

后端通过 `replacementServices.replaceAccount(account)` 适配边界接入真实自动化。默认适配器会使用 `child_process` 启动独立 Node 子进程运行 `roxy_oauth_login.js`，避免 Playwright/Roxy 自动化长流程直接占用主 Express 进程运行态。

请求体：

```json
{}
```

后端行为：

1. 根据路径参数 `id` 读取 `replacement_accounts` 中未软删除账号。
2. 将账号状态置为 `replacing`。
3. 调用 `replacementServices.replaceAccount(account)`。
4. 默认适配器启动子进程调用 `src/auto/roxy_oauth_login.js`，并把补号账号字段写入子进程 env，完成 RoxyBrowser 开窗、OpenAI/Codex OAuth 登录、邮箱验证码、手机验证码和 token 导出。
5. 自动化成功后，后端将账号标记为 `replaced` 并增加成功次数。
6. 自动化失败后，后端将账号标记为 `failed` 并记录错误。

自动化脚本需要的数据来源：

| 脚本数据 | 来源 | 说明 |
|---|---|---|
| `email` / `ROXY_OAUTH_EMAIL` | `replacement_accounts.email` | OpenAI 登录邮箱；默认适配器会覆盖子进程 env 中的 `ROXY_OAUTH_EMAIL`；也用于邮箱验证码接口的 `account` 参数。 |
| `smsApiUrl` / `PHONE_VERIFICATION_SMS_API_URL` | `replacement_accounts.sms_api` | 手机短信验证码接口；存在时默认适配器会覆盖子进程 env 中的 `PHONE_VERIFICATION_SMS_API_URL`；脚本会从响应文本或 JSON 中提取 6 位验证码。 |
| `phone` | `replacement_accounts.phone` | 当前脚本不直接填写手机号；仅作为补号账号记录和人工排查信息。 |
| `publicCodeKey` | `replacement_accounts.public_code_key` | 当前脚本默认走本地 `POST /api/verification-code/latest`，不需要该字段；外部公开取邮箱验证码时才使用。 |
| Roxy API 地址 | `.env` / 运行配置 | `ROXY_API_BASE_URL` 或 `ROXY_API_PORT`，由子进程继承，不来自补号表。 |
| Roxy API Token | `.env` / 运行配置 | `ROXY_API_TOKEN`，不来自补号表。 |
| Roxy 工作区 | `.env` / 运行配置 | `ROXY_WORKSPACE_ID`，不来自补号表。 |
| Roxy 窗口定位 | `.env` / 运行配置 | `ROXY_BROWSER_DIR_ID`、`ROXY_BROWSER_SORT_NUM`、`ROXY_BROWSER_WINDOW_NAME` 三者至少配置一种；不来自补号表。 |
| 复用 CDP | `.env` / 运行配置 | `ROXY_CDP_ENDPOINT`；配置后脚本跳过 Roxy 准备流程并直接连接现有浏览器。 |
| 邮箱验证码接口 | `.env` / 运行配置 | `VERIFICATION_CODE_API_URL`；留空时自动使用 `http://127.0.0.1:${PORT}/api/verification-code/latest`。 |
| 后台 Cookie | `.env` / 运行配置 | `ADMIN_AUTH_COOKIE`；非本机调用邮箱验证码接口时使用。 |
| 浏览器关闭/有头无头策略 | `.env` / 运行配置 | `ROXY_KEEP_OPEN`、`ROXY_HEADLESS`、`ROXY_ENSURE_CLOSED`。`ROXY_HEADLESS=auto` 时，`ROXY_KEEP_OPEN=1` 默认有头并保留窗口，`ROXY_KEEP_OPEN=0` 默认无头并关闭窗口。 |
| 代理提示 | `.env` / 运行配置 | `ROXY_PROXY`；当前 token 请求阶段仅记录提示，浏览器代理由 Roxy 窗口自身配置决定。 |

脚本生成的数据：

| 数据 | 来源 | 说明 |
|---|---|---|
| OAuth `state` | 脚本运行时生成 | 用于校验 callback。 |
| PKCE `verifier` / `challenge` | 脚本运行时生成 | 用于授权码换 token。 |
| OAuth callback `code` | OpenAI/Codex OAuth 回调 | 脚本从当前页面或网络请求捕获。 |
| `access_token`、`refresh_token`、`id_token` | OpenAI token endpoint | 脚本使用 callback code 换取。 |
| `chatgpt_account_id`、`chatgpt_user_id`、`plan_type` | access token payload | 写入导出的账号 JSON。 |
| 导出文件 | `src/auto/product_files/` | 默认写入 `sub2api/邮箱.json` 和 `cpa/邮箱.json`；手动补号和自动补号生产链路都会在成功后上传 CPA JSON 并复查。 |

成功响应：

```json
{
  "ok": true,
  "account": {
    "id": 1,
    "email": "jregkolpig+s2@gmail.com",
    "status": "replaced",
    "replacement_count": 1,
    "last_replace_at": "2026-06-02T10:00:00.000Z",
      "last_error": null
  },
  "run": {
    "id": 12,
    "account_id": 1,
    "email": "jregkolpig+s2@gmail.com",
    "status": "succeeded",
    "pid": 1234,
    "log_path": "data/automation-logs/replacement-1-2026-06-02T10-00-00-000Z.log",
    "started_at": "2026-06-02T10:00:00.000Z",
    "finished_at": "2026-06-02T10:05:00.000Z",
    "exit_code": 0,
    "error_message": null
  }
}
```

失败响应：

```json
{
  "ok": false,
  "error": "REPLACE_FAILED",
  "message": "自动补号失败原因"
}
```

成功时：

- `status = replaced`
- `replacement_count + 1`
- `last_replace_at = 当前时间`
- `last_error = null`
- 生产注入 CPA repair worker 时，会上传 `src/auto/product_files/cpa/<email>.json` 到 CPA 并确认该邮箱凭证恢复健康。

失败时：

- `status = failed`
- `last_error = 错误信息`
- `replacement_count` 不变

## CPA 凭证健康检测 API

CPA 凭证健康检测接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。

### 配置

```env
CPA_URL=http://localhost:8317
CPA_MANAGEMENT_KEY=
CPA_HEALTH_MONITOR_ENABLED=false
CPA_HEALTH_MONITOR_INTERVAL_MS=600000
```

`CPA_URL` 可以是 CPA 服务根地址，也可以直接指向 `/v0/management`。`CPA_MANAGEMENT_KEY` 只用于后端请求 CPA 管理接口，不会出现在接口响应中。

### GET `/cpa/auth-health`

手动执行一次 CPA auth-files 健康检测。

后端行为：

1. 请求 CPA `GET /v0/management/auth-files`。
2. 按 `provider + email` 生成凭证 key。
3. 将凭证分类为 `healthy`、`banned`、`disabled`、`auth_expired`、`quota_limited` 或 `unknown_error`。
4. 只有 `auth_expired` 会按邮箱匹配 `replacement_accounts.email`。
5. 匹配到且账号未处于 `replacing`/`banned` 时，加入单并发补号队列并触发队列执行；`banned` 账号跳过原因为 `account_banned`。
6. 补号子进程成功后，上传本地 `src/auto/product_files/cpa/<email>.json` 到 CPA，并再次检查该邮箱凭证是否恢复健康。

成功响应示例：

```json
{
  "ok": true,
  "result": {
    "checked": 1,
    "unhealthy": [
      {
        "key": "claude:user@example.com",
        "provider": "claude",
        "email": "user@example.com",
        "category": "auth_expired",
        "reasons": ["unavailable", "status:error", "message:auth_expired"]
      }
    ],
    "enqueued": [
      {
        "key": "claude:user@example.com",
        "provider": "claude",
        "email": "user@example.com",
        "category": "auth_expired",
        "reasons": ["unavailable", "status:error", "message:auth_expired"],
        "account_id": 7
      }
    ],
    "skipped": []
  }
}
```

未配置 monitor：

```json
{
  "ok": false,
  "error": "CPA_MONITOR_NOT_CONFIGURED",
  "message": "CPA credential monitor is not configured"
}
```

敏感信息约束：响应和日志不得输出 `CPA_MANAGEMENT_KEY`。

## 补号子进程运行日志 API

补号运行日志接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。

### SQLite 表：`replacement_automation_runs`

| 字段 | 说明 |
|---|---|
| `id` | 运行记录 ID |
| `account_id` | 对应 `replacement_accounts.id` |
| `email` | 运行时使用的补号邮箱快照 |
| `status` | `running`、`succeeded`、`failed`、`stopped` |
| `pid` | 子进程 PID；仅用于展示和当前服务会话内 child 关联，不用于盲杀历史进程 |
| `log_path` | stdout/stderr 日志文件路径 |
| `started_at` | 开始时间 |
| `finished_at` | 结束时间 |
| `exit_code` | 子进程退出码 |
| `error_message` | 失败或停止摘要 |

日志文件默认写入：

```text
data/automation-logs/
```

日志保留数量可通过 `.env` 配置，默认保留最近 30 条运行记录：

```env
REPLACEMENT_AUTOMATION_LOG_MAX_RUNS=30
```

后端每次创建新的补号或注册自动化运行记录后，会按开始时间倒序保留最近配置数量内的记录；超过范围的非 `running` 旧记录会从 `replacement_automation_runs` 删除，并同步删除其 `log_path` 指向的本地日志文件。`running` 记录不会被自动清理，避免影响仍在执行的子进程排查。

日志内容包含两类信息：

- 服务侧编排步骤：形如 `step=<步骤> action=<动作>`，覆盖账号校验、子进程环境准备、启动 child、创建 run、绑定 stdout/stderr、等待结束和最终状态标记。
- 自动化脚本输出：`src/auto/roxy_oauth_login.js` 或 `src/auto/roxy_register_openai.js` 输出的 `stdout/stderr`，包括 Roxy 准备、页面状态识别、填写邮箱、请求/填写邮箱验证码、选择短信验证、请求/填写手机验证码、Codex 授权、callback 和 token 导出等阶段日志。

敏感信息约束：日志只记录验证码是否已获取/已填写、Cookie 是否配置和 token 解析/保存状态，不记录验证码、`admin_auth` Cookie、access token、refresh token 或完整短信响应。

验证码轮询策略：

- 邮箱验证码 API：默认每 5 秒请求一次，最多请求 12 次；仍未返回有效 6 位验证码时失败。
- 手机短信验证码 API：默认每 5 秒请求一次，最多请求 12 次；仍未返回连续 6 位验证码时失败。
- 日志会记录 `attempt=当前次数/总次数`，但不记录验证码明文。

### GET `/replacement-automation-runs`

获取最近的补号自动化运行记录，默认最多返回 100 条，`limit` 最大 500。

成功：

```json
{
  "ok": true,
  "runs": []
}
```

### GET `/replacement-automation-runs/:id`

获取单次运行记录和日志文本。

成功：

```json
{
  "ok": true,
  "run": {},
  "log": "stdout/stderr log text"
}
```

不存在：

```json
{
  "ok": false,
  "error": "RUN_NOT_FOUND",
  "message": "automation run not found"
}
```

### POST `/replacement-automation-runs/:id/stop`

停止仍在运行的补号子进程。

安全约束：

- 只停止当前 Express 服务进程内仍被追踪的 child process。
- 如果服务已重启、运行记录仍为 `running` 但内存中没有 child 句柄，则返回 `RUN_NOT_ACTIVE`。
- 不根据历史 PID 直接杀系统进程，避免 PID 复用导致误杀。

成功：

```json
{
  "ok": true,
  "runId": 12
}
```

常见错误：

| 错误码 | HTTP 状态 | 说明 |
|---|---:|---|
| `RUN_NOT_FOUND` | 404 | 运行记录不存在 |
| `RUN_NOT_RUNNING` | 400 | 运行记录不是 running |
| `RUN_NOT_ACTIVE` | 502 | 当前服务会话中没有可停止的活跃 child |
| `RUN_STOP_FAILED` | 502 | child kill 调用失败 |

### 用户操作与接口映射

| 用户操作 | 接口 | 后端影响 |
|---|---|---|
| 新增账号 | `POST /replacement-accounts` | 创建补号账号，默认 `pending` |
| 修改账号 | `PUT /replacement-accounts/:id` | 修改基础信息 |
| 删除账号 | `DELETE /replacement-accounts/:id` | 软删除 |
| 修改状态 | `PATCH /replacement-accounts/:id/status` | 更新状态和备注 |
| 启用/停用公开验证码 | `PATCH /replacement-accounts/:id/public-code` | 只更新 `public_code_enabled` 和必要的 `public_code_key` |
| 获取验证码 | `POST /replacement-accounts/:id/fetch-sms-code` | 实时返回验证码，不入库 |
| 获取 JSON | `POST /replacement-accounts/:id/fetch-json` | 保存 JSON 原文 |
| 注册 OpenAI | `POST /replacement-accounts/:id/register` | 启动注册自动化子进程，邮箱验证码走 POST 内部接口 |
| 自动补号 | `POST /replacement-accounts/:id/replace` | 成功后补号次数加一 |
| 查看补号日志 | `GET /replacement-automation-runs` / `GET /replacement-automation-runs/:id` | 查看运行记录和 stdout/stderr |
| 停止子进程 | `POST /replacement-automation-runs/:id/stop` | 停止当前服务会话内仍在运行的 child |

## 数据库字段

当前 SQLite 表：`email_accounts`、`replacement_accounts`、`replacement_automation_runs`

```sql
CREATE TABLE email_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT,
  gmail_email TEXT NOT NULL,
  gmail_password TEXT NOT NULL,
  gmail_2fa TEXT NOT NULL,
  gmail_app_password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_fetch_at TEXT,
  last_fetch_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 邮件数据说明

邮件内容不会保存到数据库。

每次点击“获取邮件”时：

1. 后端实时连接 Gmail IMAP。
2. 拉取指定读取位置的最新邮件。
3. 返回 HTML 页面展示。
4. 只更新账号的状态和最近错误，不保存邮件正文。

## 当前限制

- 邮箱账号管理接口主要面向浏览器表单，不返回 JSON。
- 补号账号已提供 JSON 接口，但仍复用后台 Cookie 登录态。
- 邮件详情只存在于本次响应页面，刷新后需要重新获取。
- App Password 明文保存，符合当前本地使用需求，但不适合公开部署。
- 自动补号运行时代码已在 `src/auto/roxy_oauth_login.js`；`POST /replacement-accounts/:id/replace` 默认通过子进程调用该脚本，仍需要 `.env` 中配置有效 RoxyBrowser/API 运行参数。
