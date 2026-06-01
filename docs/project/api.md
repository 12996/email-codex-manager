# Gmail IMAP Service API 文档

本文档描述当前服务已实现的页面接口。当前项目主要是服务端渲染页面，不是纯 JSON API；大多数接口接收 `application/x-www-form-urlencoded` 表单并返回 HTML 或重定向。

## 基础信息

默认地址：

```text
http://localhost:3000
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
  -Uri "http://localhost:3000/login" `
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

获取邮箱账号列表。

成功：

```json
{
  "ok": true,
  "accounts": []
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
  -Uri "http://localhost:3000/accounts" `
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
  -Uri "http://localhost:3000/accounts/1/fetch" `
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

该接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。

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

## 补号账号 JSON API

补号账号接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。接口请求和响应均为 JSON。

补号账号前端页面：

```text
GET /replacement-ui
```

静态前端文件位于：

```text
web/index.html
web/styles.css
web/app.js
```

页面入口需要后台登录态，前端通过 `/replacement-accounts*` JSON API 读取和操作数据。

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
| `activated_at` | 开通时间 |
| `status` | 账号状态 |
| `status_updated_at` | 最近状态更新时间 |
| `status_note` | 状态备注 |
| `replacement_count` | 成功补号次数 |
| `json_payload` | 最近一次获取的 JSON 原文 |
| `json_fetched_at` | 最近一次 JSON 获取时间 |
| `last_replace_at` | 最近一次成功补号时间 |
| `last_error` | 最近一次 JSON 或补号错误 |
| `remark` | 管理员备注 |
| `deleted_at` | 软删除时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

验证码不入库；SMS 原始响应不入库；补号失败不增加 `replacement_count`。

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

### GET `/replacement-accounts`

获取未软删除的补号账号列表。

成功：

```json
{
  "ok": true,
  "accounts": []
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

### POST `/replacement-accounts/:id/replace`

执行自动补号。当前真实自动化补号接口尚未完成，后端已预留 `replacementServices.replaceAccount` 适配边界，后续封装到独立 JS 文件后接入。

成功时：

- `status = replaced`
- `replacement_count + 1`
- `last_replace_at = 当前时间`
- `last_error = null`

失败时：

- `status = failed`
- `last_error = 错误信息`
- `replacement_count` 不变

### 用户操作与接口映射

| 用户操作 | 接口 | 后端影响 |
|---|---|---|
| 新增账号 | `POST /replacement-accounts` | 创建补号账号，默认 `pending` |
| 修改账号 | `PUT /replacement-accounts/:id` | 修改基础信息 |
| 删除账号 | `DELETE /replacement-accounts/:id` | 软删除 |
| 修改状态 | `PATCH /replacement-accounts/:id/status` | 更新状态和备注 |
| 获取验证码 | `POST /replacement-accounts/:id/fetch-sms-code` | 实时返回验证码，不入库 |
| 获取 JSON | `POST /replacement-accounts/:id/fetch-json` | 保存 JSON 原文 |
| 自动补号 | `POST /replacement-accounts/:id/replace` | 成功后补号次数加一 |

## 数据库字段

当前 SQLite 表：`email_accounts`、`replacement_accounts`

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
- 自动补号真实适配器尚未接入，当前通过后端服务边界预留。
