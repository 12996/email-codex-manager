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

### POST `/api/icloud-verification-code/latest`

从指定 Gmail 收件箱读取 iCloud 邮箱验证码。该接口用于所有 iCloud 验证码统一转发或投递到一个 Gmail 后，由自动化程序按需读取最近 6 位验证码。

该接口复用后台登录态，非本机调用前需要先登录后台并携带 `admin_auth` cookie。本机请求免后台登录态。

默认 Gmail 收件箱：

```env
ICLOUD_CODE_GMAIL_ACCOUNT=rosannathornton1@gmail.com
```

如果 `.env` 未配置 `ICLOUD_CODE_GMAIL_ACCOUNT`，系统默认使用 `rosannathornton1@gmail.com`。该 Gmail 必须已在邮箱账号管理中配置 IMAP App Password。

请求类型：

```text
application/json
```

请求体：

```json
{
  "account": "target-user@icloud.com",
  "gmailAccount": "rosannathornton1@gmail.com"
}
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `account` / `icloudAccount` | 否 | 目标 iCloud 邮箱。传入后会优先查找收件人元数据匹配该邮箱的验证码邮件。 |
| `gmailAccount` / `mailbox` / `gmail` | 否 | 实际接收验证码的 Gmail。为空时使用 `ICLOUD_CODE_GMAIL_ACCOUNT` 或默认值。 |

后台行为：

1. 确定 Gmail 收件账号：优先使用请求体指定值，否则使用 `ICLOUD_CODE_GMAIL_ACCOUNT`，最后默认 `rosannathornton1@gmail.com`。
2. 从数据库查找该 Gmail 账号的 App Password。
3. 使用该 Gmail 连接 IMAP 收件箱。
4. 如果请求传入目标 iCloud 邮箱，则优先在 `To`、`Cc`、`Delivered-To` 等收件人元数据匹配该邮箱的邮件中提取 6 位验证码。
5. 如果目标邮箱未匹配到验证码，但收件箱内存在 6 位验证码，则回退返回最新验证码，并返回 `targetMatched: false`。

成功响应：

```json
{
  "ok": true,
  "account": "target-user@icloud.com",
  "gmailAccount": "rosannathornton1@gmail.com",
  "mainAccount": "rosannathornton1@gmail.com",
  "code": "123456",
  "targetMatched": true,
  "from": "Apple <noreply@apple.com>",
  "subject": "Your Apple Account code",
  "date": "2026-07-02T10:00:00.000Z"
}
```

指定 Gmail 未配置：

```json
{
  "ok": false,
  "account": "target-user@icloud.com",
  "gmailAccount": "rosannathornton1@gmail.com",
  "mainAccount": "rosannathornton1@gmail.com",
  "error": "GMAIL_ACCOUNT_NOT_FOUND",
  "message": "数据库中没有配置用于接收 iCloud 验证码的 Gmail 账号"
}
```

未找到验证码：

```json
{
  "ok": false,
  "account": "target-user@icloud.com",
  "gmailAccount": "rosannathornton1@gmail.com",
  "mainAccount": "rosannathornton1@gmail.com",
  "code": null,
  "error": "CODE_NOT_FOUND",
  "message": "未找到最近的 6 位 iCloud 验证码邮件"
}
```

自动化接入规则：

- `email_code_api` 优先级对 iCloud 和 Gmail 一致：账号行 `email_code_api` 有值时，`POST /replacement-accounts/:id/register`、`/replace`、`/replace-2fa` 启动子进程都会优先注入该外部接口。
- `email_code_api` 为空时，`src/auto/roxy_oauth_login.js` 和 `src/auto/roxy_register_openai.js` 会按邮箱域名选择默认本地接口：`@icloud.com` 使用 `http://127.0.0.1:${PORT}/api/icloud-verification-code/latest`，其他邮箱使用 `/api/verification-code/latest`。
- 直接运行自动化脚本时，显式传入 `verificationApiUrl` 或设置 `VERIFICATION_CODE_API_URL` 也会优先于默认本地接口。

### POST `/api/2fa-code`

根据 TOTP secret 生成当前 2FA 验证码。该接口用于本地自动化程序获取 OpenAI/Codex 2FA code，不会请求第三方站点；算法与 Google Authenticator/`2fa.fun` 默认参数一致：`sha1`、6 位、30 秒周期。

该接口复用后台登录态，非本机调用前需要先登录后台并携带 `admin_auth` cookie。

本机请求免后台登录态，允许 `127.0.0.1`、`::1`、`::ffff:127.0.0.1` 调用本接口时不携带 `admin_auth`。

请求类型：

```text
application/json
```

请求体：

```json
{
  "secret": "ANA6DKOETWQDNSF2O6UGJ6VNJI2WYBSJ"
}
```

可选调试参数：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `timestampMs` | 当前时间 | 指定用于生成验证码的毫秒时间戳，主要用于测试或复现。 |
| `step` | `30` | TOTP 周期秒数。 |
| `digits` | `6` | 验证码位数。 |
| `algorithm` | `sha1` | HMAC 算法，支持 `sha1`、`sha256`、`sha512`。 |

成功响应：

```json
{
  "ok": true,
  "code": "454976",
  "expiresIn": 11,
  "step": 30,
  "digits": 6,
  "algorithm": "sha1"
}
```

缺少 secret：

```json
{
  "ok": false,
  "error": "TOTP_SECRET_REQUIRED",
  "message": "TOTP secret is required"
}
```

secret 不是合法 Base32：

```json
{
  "ok": false,
  "error": "TOTP_SECRET_INVALID",
  "message": "TOTP secret is not valid Base32"
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
补号管理页主表会压缩显示除邮箱、备注和开通时间外的长字段：默认只展示前 6 位并提供“复制”按钮复制完整原始值；邮箱、备注和开通时间完整显示，并按约 12 个字符宽度换行，避免被压成几字符一行或把操作列挤出可视区域。主表不显示“状态更新时间”“最后操作”“更新时间”三列，这些信息仍可通过详情查看。
补号管理页提供“一键验活”按钮，会批量检查 `registered`、`plus_active`、`cpa_mounted`、`for_sale`、`sold` 状态账号最近 5 封邮件中的 ChatGPT deactivation 通知；命中后自动将账号状态改为 `banned`。

补号管理页支持直接配置公开验证码接口：

- 新增或编辑补号账号时，可勾选“允许公开验证码接口”，对应 `public_code_enabled = 1`。
- “公开验证码 Key” 对应 `public_code_key`；留空时由后端自动生成，也可以手动覆盖为不可猜测字符串。
- 补号列表会在邮箱下方显示公开验证码启用状态和 key。
- 操作菜单中的“复制公开验证码 URL”会生成：

```text
<当前站点>/api/verification-code/public/latest?key=<public_code_key>
```

### 开通方式目录与行内修改

补号管理页的“开通方式”列使用行内下拉框。方式目录存储在 SQLite 的
`replacement_activation_methods` 表中，后台登录后可以通过页面“管理开通方式”新增方式；当前只允许新增，不提供删除，避免历史账号出现无效方式。

初始方式：

```text
越南直卡
upi
ideal
波兰
瑞士
pix 直卡
```

#### GET `/replacement-activation-methods`

返回按创建顺序排列的开通方式。

成功响应：

```json
{
  "ok": true,
  "methods": [
    {
      "id": 1,
      "name": "越南直卡",
      "created_at": "2026-07-14T00:00:00.000Z",
      "updated_at": "2026-07-14T00:00:00.000Z"
    }
  ]
}
```

#### POST `/replacement-activation-methods`

新增开通方式。请求体：

```json
{
  "name": "银行卡直卡"
}
```

后端会去除首尾空格，并按大小写不敏感规则去重。

错误：

| 错误码 | HTTP 状态 | 说明 |
|---|---:|---|
| `ACTIVATION_METHOD_REQUIRED` | 400 | 名称为空 |
| `ACTIVATION_METHOD_DUPLICATE` | 409 | 名称已存在 |

#### PATCH `/replacement-accounts/:id/activation-method`

只更新账号的 `activation_method` 字段，不覆盖账号其他字段。

请求体：

```json
{
  "activation_method": "upi"
}
```

空字符串表示清空开通方式；非空值必须已经存在于方式目录中。账号列表下拉框修改和账号详情页的直接修改均使用此接口。

如果历史账号的方式不在当前目录中，前端会保留并显示为“历史值”，不会自动覆盖或删除。

### 字段说明

SQLite 表：`replacement_accounts`

| 字段 | 说明 |
|---|---|
| `id` | 主键 |
| `email` | 补号邮箱，必填，大小写不敏感唯一 |
| `phone` | 手机号，可为空，可重复 |
| `sms_api` | SMS 验证码接口地址 |
| `email_code_api` | 账号级外部邮箱验证码接口地址 |
| `codex_2fa` | Codex/OpenAI 账号 2FA 密钥；前端展示列名为 `2fa-codex` |
| `password` | 补号账号密码；创建时为空则由系统随机生成 12-16 位字符 |
| `sms_last_error` | 最近一次 SMS 获取失败原因 |
| `activation_method` | 开通方式；值来自 `replacement_activation_methods.name`，允许为空，历史值保留 |
| `activated_at` | 开通时间；创建补号账号时为空则由系统写入当前时间 |
| `status` | 账号状态 |
| `status_updated_at` | 最近状态更新时间 |
| `status_note` | 状态备注 |
| `replacement_count` | 成功补号次数 |
| `consecutive_replace_failures` | 连续补号失败次数 |
| `circuit_breaker_at` | 连续失败触发熔断时间 |
| `circuit_breaker_reason` | 连续失败触发熔断原因 |
| `json_payload` | 最近一次获取的 JSON 原文 |
| `json_fetched_at` | 最近一次 JSON 获取时间 |
| `last_replace_at` | 最近一次成功补号时间 |
| `last_error` | 最近一次操作错误；内容带有操作前缀，状态失败不写入账号状态 |
| `remark` | 管理员备注 |
| `public_code_enabled` | 是否允许使用公开 GET 接口获取该邮箱验证码，`1` 为允许，默认 `0` |
| `public_code_key` | 公开 GET 接口使用的随机访问 key；创建补号账号时自动生成，也可手动覆盖为不可猜测字符串 |
| `deleted_at` | 软删除时间 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

验证码不入库；SMS 原始响应不入库；补号失败不增加 `replacement_count`，但会递增 `consecutive_replace_failures`。连续补号失败达到 5 次时，账号保持原业务状态并写入熔断字段；补号成功会清零连续失败计数和熔断字段。`failed` 不是补号账号状态，操作失败原因复用 `last_error` 展示。`remark` 仅用于人工标注来源或用途，不参与公开验证码接口的权限判断。

管理员不能在普通编辑表单中直接修改连续失败和熔断字段；解除熔断必须使用专用接口，避免误清系统字段。

### 状态枚举

| 状态 | 中文含义 | 说明 |
|---|---|---|
| `unregistered` | 未注册 | 账号尚未完成注册 |
| `registered` | 已注册 | OpenAI 注册已完成，尚未进入 Plus/CPA 后续阶段 |
| `pending_activation` | 待开通 | 等待开通 Plus |
| `plus_active` | 开通 plus | Plus 已开通 |
| `cpa_mounted` | CPA 挂载 | CPA 凭证已挂载或上传成功 |
| `for_sale` | 待出售 | 可出售库存；旧 `pending` 兼容映射到该状态 |
| `sold` | 已售出 | 已出售账号 |
| `banned` | 账号封禁 | 账号本身被封禁；不等同熔断 |
| `replacing` | 处理中 | 系统自动状态，不允许手动设置 |

兼容旧状态输入：`pending -> for_sale`、`active -> plus_active`、`replaced -> cpa_mounted`、`failed -> banned`。历史数据库中的 `failed` 行启动时统一迁移为 `banned`。

补号、注册、2FA 登录、JSON 获取、Plus 查询和一键验活等操作失败时，不修改账号业务状态。失败原因写入现有错误字段，状态旁显示简短红字（如“补号失败”或“查询 Plus 失败”）；不新增操作记录字段。

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
| `REPLACE_2FA_NOT_CONFIGURED` | 502 | 2FA 补号适配器尚未配置 |
| `REGISTER_FAILED` | 502 | OpenAI 注册自动化失败 |
| `PROTOCOL_REGISTER_FAILED` | 502 | 协议注册或 Roxy 指纹刷新失败 |
| `PROTOCOL_REGISTER_NOT_CONFIGURED` | 502 | 协议注册适配器尚未配置 |
| `PROTOCOL_REGISTER_BUSY` | 409 | 共享 Roxy profile 已有协议注册任务运行 |
| `PROTOCOL_REPLACE_FAILED` | 502 | 独立 CPA 协议补号、CPA 上传或健康复查失败 |
| `NOTIFICATION_NOT_FOUND` | 404 | 通知不存在 |

### GET `/replacement-accounts`

获取未软删除的补号账号列表。支持服务端分页、状态筛选、熔断筛选和关键词搜索。

查询参数：

```text
page      可选，页码，默认 1
pageSize  可选，每页条数，默认 10，最大 100
status    可选，按补号账号状态精确筛选
circuit_breaker 可选，传 1 时只返回已触发熔断的账号
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

### GET `/replacement-accounts/:id/registration-token`

读取该补号账号协议注册或普通注册后保存的本地 access token 文件。接口要求管理员登录，按账号邮箱从 `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt` 读取并返回纯 token；文件不存在或为空时返回 `404 REGISTRATION_TOKEN_NOT_FOUND` 和“AT 未找到”。

成功：

```json
{
  "ok": true,
  "token": "eyJ..."
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
  "email_code_api": "https://example.invalid/email-code",
  "codex_2fa": "JBSWY3DPEHPK3PXP",
  "password": "",
  "activation_method": "manual",
  "activated_at": "2026-06-01T00:00:00.000Z",
  "status": "unregistered",
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

字段说明：

- `sms_api`：补号/OAuth 手机短信验证码接口。
- `email_code_api`：OpenAI 注册阶段的账号级外部邮箱验证码接口。配置后，注册子进程优先通过 GET 请求该 URL 获取 HTML/text/JSON payload，并从清理后的正文或常见 JSON code 字段提取 6 位验证码。
- `codex_2fa`：Codex/OpenAI 账号 2FA 密钥。接口也兼容请求体字段名 `2fa-codex` 和 `2fa_codex`，保存后统一以 `codex_2fa` 返回。
- `password`：补号账号密码。新增账号时为空会自动生成 12-16 位随机密码，字符集为大小写字母、数字和常见特殊字符 `!@#$%^&*_-`；编辑账号时不传或传空会保留原密码，传入非空值则更新。

### DELETE `/replacement-accounts/:id`

软删除补号账号。

成功：

```json
{
  "ok": true
}
```

### PATCH `/replacement-accounts/:id/status`

手动修改状态。允许状态：`unregistered`、`registered`、`pending_activation`、`plus_active`、`cpa_mounted`、`for_sale`、`sold`、`banned`。`replacing` 是系统自动状态，不允许手动设置；传入旧状态 `failed` 时按 `banned` 处理。

请求体：

```json
{
  "status": "sold",
  "status_note": "管理员手动标记已售出"
}
```

### PATCH `/replacement-accounts/:id/public-code`

启用或停用补号账号的公开验证码接口，不需要提交完整账号资料。

### PATCH `/replacement-accounts/:id/circuit-breaker/reset`

管理员手动解除补号熔断。该接口会执行以下状态修复：

- `status` 保持解除前业务状态，不强制改回待出售
- `status_note = 管理员手动解除熔断`
- `consecutive_replace_failures = 0`
- `circuit_breaker_at = NULL`
- `circuit_breaker_reason = NULL`

成功：

```json
{
  "ok": true,
  "account": {
    "id": 7,
    "status": "unregistered",
    "status_note": "管理员手动解除熔断",
    "consecutive_replace_failures": 0,
    "circuit_breaker_at": null,
    "circuit_breaker_reason": null
  }
}
```

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

### POST `/replacement-accounts/healthcheck-banned`

手动批量验活补号账号封禁状态。该接口复用后台登录态。

后端行为：

1. 筛选未软删除且状态为 `registered`、`plus_active`、`cpa_mounted`、`for_sale`、`sold` 的补号账号。
2. 只处理配置了非空 `email_code_api` 的账号；没有配置的账号直接跳过，不读取 IMAP 或默认 Gmail 收件箱。
3. 对每个可查询账号 GET 请求其 `email_code_api`，读取接口返回的完整邮件内容。
4. 邮件正文、摘要或主题同时包含目标账号邮箱、`Your account has been deactivated`，以及 `violated our Terms and Usage Policies` 或 `This means your account can no longer be used` 时，判定账号已封禁。
5. 命中后写入 `status = banned`，并将 `status_note` 写为“一键验活检测到 ChatGPT deactivation 邮件”。
6. 单个账号邮箱 API 失败或未返回完整邮件只计入失败结果，不影响其他账号，不会改变该账号状态，也不会回退到 IMAP。

成功响应：

```json
{
  "ok": true,
  "result": {
    "checked": 2,
    "skipped": 1,
    "banned": 1,
    "clean": 1,
    "failed": 0,
    "bannedAccounts": [
      {
        "id": 1,
        "email": "user@example.com",
        "subject": "Important update about your ChatGPT account",
        "date": "2026-07-10T01:00:00.000Z"
      }
    ],
    "cleanAccounts": [
      {
        "id": 2,
        "email": "clean@example.com"
      }
    ],
    "failedAccounts": [],
    "skippedAccounts": [
      { "id": 3, "email": "no-api@example.com" }
    ]
  }
}
```

实时进度：请求头增加 `Accept: text/event-stream` 时，接口返回 SSE 流，不改变状态处理逻辑。每条事件格式为 `data: <JSON>\n\n`，事件类型包括：

- `start`：任务开始和候选账号数量。
- `account-start`：某个账号开始处理。
- `account-step`：正在读取邮箱 API 或匹配邮件。
- `account-result`：该账号命中、未命中、跳过或失败；包含 `email`、`outcome`、`status` 和 `message`。
- `complete`：任务完成，`result` 字段与普通 JSON 响应相同。
- `error`：服务级错误。

### POST `/replacement-accounts/check-plus-status`

手动批量查询补号账号的 ChatGPT Plus 状态。该接口复用后台登录态，只处理未软删除且当前状态为 `registered` 的账号。

后端行为：

1. 只查询未软删除且当前状态为 `registered`、并配置非空 `email_code_api` 的账号；没有配置的账号直接跳过，不读取 IMAP 或默认 Gmail 收件箱。
2. 每个可查询账号 GET 请求自己的 `email_code_api`，读取接口返回的完整邮件内容；`targetEmail` 用于目标收件人校验。
3. 主题、预览、正文或 HTML 同时包含 `You've successfully subscribed to ChatGPT Plus`、`ChatGPT Plus Subscription` 和 `The OpenAI Team` 时，判定为 Plus 订阅邮件。
4. 如果邮件包含收件人地址，则还必须包含目标账号邮箱，避免共享 iCloud 收件箱串号。
5. 命中后写入 `status = plus_active`、`status_updated_at` 和 `status_note = Plus 状态查询命中订阅邮件`，并清空 `last_error`。
6. 未命中时状态保持 `registered`。
7. 单个账号邮箱 API 失败或未返回完整邮件时状态保持 `registered`，并将失败原因写入 `last_error`；单个失败不影响其他账号，也不回退到 IMAP。
8. 没有 `email_code_api` 的账号状态保持 `registered`，计入 `skipped`，不计入 `checked`。

邮箱 API 响应要求：

- 请求方式为 `GET`，URL 使用补号账号行中保存的完整 `email_code_api`，保留既有 query 参数并追加或覆盖 `limit=5`，以读取最近 5 封邮件；系统不会再为该 URL 拼接邮箱参数。进度窗口为避免把 query 中的其他参数写入日志，只展示去掉 query/hash 的接口基址，并追加当前数据库账号邮箱；这不改变除 `limit` 外的实际请求 URL。
- 响应可以是完整邮件 JSON 对象、邮件数组、HTML 或纯文本；JSON 对象至少应包含 `subject`、`body`、`bodyHtml`、`bodyText`、`html`、`text`、`content` 中的一个字段。
- 例如：`{"email":"user@icloud.com","subject":"ChatGPT - Your new plan","received_at":"2026-07-14T10:23:21Z","body":"<html>...</html>"}`。
- 只有 `{ "code": "123456" }` 这类验证码-only 响应不能用于 Plus 状态判断，会计入失败，不会回退到 IMAP。

成功响应：

```json
{
  "ok": true,
  "result": {
    "checked": 2,
    "skipped": 1,
    "plus": 1,
    "registered": 1,
    "failed": 0,
    "plusAccounts": [
      {
        "id": 1,
        "email": "user@example.com",
        "subject": "You've successfully subscribed to ChatGPT Plus.",
        "date": "2026-07-14T01:00:00.000Z"
      }
    ],
    "registeredAccounts": [
      { "id": 2, "email": "clean@example.com" }
    ],
    "failedAccounts": [],
    "skippedAccounts": [
      { "id": 3, "email": "no-api@example.com" }
    ]
  }
}
```

该接口同样支持上方说明的 `Accept: text/event-stream` 实时进度响应。

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
5. 若账号配置 `email_code_api`，后端向子进程注入 `REGISTRATION_EMAIL_CODE_API_URL`，注册脚本优先 GET 该外部接口获取邮箱验证码；该规则对 Gmail 和 iCloud 一致。
6. 若账号未配置 `email_code_api`，注册脚本按邮箱域名选择本地 POST 验证码接口：iCloud 使用 `/api/icloud-verification-code/latest`，其他邮箱使用 `/api/verification-code/latest`，请求体均为 `{ "account": "<email>" }`。
7. 邮箱验证码提取会先移除 HTML `script/style` 和标签，再匹配独立 6 位数字，避免 CSS 色值误匹配；JSON payload 支持 `code`、`otp`、`verification_code`、`verificationCode` 等字段。
8. 注册成功后，脚本会从 `https://chatgpt.com/api/auth/session` 读取 `accessToken`，并将纯 token 值保存到本地注册产物目录；默认文件为 `src/auto/product_files/registration/<email>.txt`，文件名直接使用补号邮箱号。
9. 默认继续在同一个 Roxy/ChatGPT 页面上下文中启用 TOTP MFA：调用 `/backend-api/accounts/mfa/enroll` 获取 `secret`，本地生成当前 TOTP code，再调用 `/backend-api/accounts/mfa/user/activate_enrollment` 激活。成功后后端会把返回的 `secret` 写入该补号账号的 `codex_2fa` 字段，供后续“2FA补号”使用。
10. 日志写入 `data/automation-logs/registration-<id>-<timestamp>.log`，包含 `step=...` 阶段日志。日志只记录注册 token 文件保存路径和 MFA 是否成功，不记录验证码、Cookie、access token、TOTP secret 或代理密码明文。

注册成功后的 access token 文件内容：

```text
eyJ...
```

实际产物为纯文本，不包含 JSON 字段。

保存目录可通过环境变量覆盖：

```env
REGISTRATION_TOKEN_OUTPUT_DIR=src/auto/product_files/registration
```

该文件包含敏感 access token，只用于无头注册完成后的本地查看和排查，不应提交或公开。

注册后自动启用 TOTP MFA 可通过环境变量关闭：

```env
ROXY_REGISTER_ENABLE_MFA=0
```

默认值等同 `1`，即注册成功后自动开启 MFA 并保存 `codex_2fa`。

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

### POST `/replacement-accounts/:id/register-protocol`

按当前补号列表行启动协议注册，不调用旧的 DOM 注册脚本。后端先使用 RoxyBrowser 目标窗口完成 close（可配置跳过）、本地/服务端缓存清理、随机指纹、重新开窗和 CDP 地址读取，再在 `tilian` Python 环境中执行 `src/auto/protocol_registration/main.py --count 1 --workers 1`。协议 bridge 使用同一个 Roxy BrowserContext 下的 ChatGPT、Auth、Sentinel 三个后台页面，分别承载 API Cookie/OAuth 状态、OAuth 注册请求和 Sentinel SDK，不进行可见 DOM 操作。

协议注册顺序固定为：`authorize` → `GET /create-account/password` → Sentinel `username_password_create` → `POST /api/accounts/user/register` 提交当前补号账号的 `username/password` → `GET /api/accounts/email-otp/send` → 邮箱 OTP → `about-you` → OAuth callback/session。密码阶段失败时不会继续取或提交邮箱验证码。

协议子进程使用当前账号 ID 获取邮箱和验证码，环境变量包括：

- `OTP_PROVIDER=replacement`、`EMAIL_SOURCE=replacement`
- `REPLACEMENT_ACCOUNT_ID=<当前账号 ID>`
- `ROXY_CDP_ENABLED=1` 和刷新后的 `ROXY_CDP_ENDPOINT`
- `ROXY_REGISTER_PASSWORD=<当前补号账号 password>`；仅记录环境变量是否设置，不写入日志
- `ROXY_IP_CHECK_ENABLED=1`（默认）：每次关键 CDP 请求前核对目标 profile 的 `proxyInfo.lastIp`；IP 变化时本次注册立即失败，避免继续复用旧 OAuth state/验证码

协议注册默认使用 Roxy 窗口序号 `3`、名称 `test`，可通过 `ROXY_PROTOCOL_BROWSER_DIR_ID`、`ROXY_PROTOCOL_BROWSER_SORT_NUM`、`ROXY_PROTOCOL_BROWSER_WINDOW_NAME` 覆盖。共享 Roxy profile 只允许一个协议注册任务运行，第二个并行请求返回 `PROTOCOL_REGISTER_BUSY`。

成功后将账号状态更新为 `registered`，并将纯 `access_token` 值以 `<email>.txt` 写入 `src/auto/product_files/registration`；可通过 `REGISTRATION_TOKEN_OUTPUT_DIR` 覆盖产物目录。失败只在 `last_error` 写入“协议注册失败”，不改变原业务状态。运行记录和 stdout/stderr 仍通过 `replacement_automation_runs` 提供。

成功响应结构与 `/register` 一致：

```json
{
  "ok": true,
  "account": {},
  "run": { "id": 12, "status": "succeeded" }
}
```

前端实时日志：

- 当请求头包含 `Accept: text/event-stream` 时，接口返回 SSE，而不是等待协议子进程结束后一次性返回 JSON。
- 事件包括 `start`、`protocol-step`、`protocol-log`、`account-result`、`complete` 和 `error`。
- `protocol-log` 携带 `stream=stdout|stderr` 及当前文本块；后台仍同步写入现有运行日志文件。
- `/replacement-ui` 只在当前页面的“当前协议注册日志”面板中临时展示这些事件，不写入浏览器历史或“最近操作记录”。刷新页面或下一次启动时清空。
- 不带 SSE 请求头的客户端继续使用上面的 JSON 响应格式。

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
5. 自动化成功后，后端将账号标记为 `cpa_mounted` 并增加成功次数。
6. 自动化失败后，后端恢复操作开始前的业务状态，并在 `last_error` 写入带“补号失败”前缀的错误。

自动化脚本需要的数据来源：

| 脚本数据 | 来源 | 说明 |
|---|---|---|
| `email` / `ROXY_OAUTH_EMAIL` | `replacement_accounts.email` | OpenAI 登录邮箱；默认适配器会覆盖子进程 env 中的 `ROXY_OAUTH_EMAIL`；也用于邮箱验证码接口的 `account` 参数。 |
| `smsApiUrl` / `PHONE_VERIFICATION_SMS_API_URL` | `replacement_accounts.sms_api` | 手机短信验证码接口；存在时默认适配器会覆盖子进程 env 中的 `PHONE_VERIFICATION_SMS_API_URL`；脚本会从响应文本或 JSON 中提取 6 位验证码。 |
| `phone` | `replacement_accounts.phone` | 当前脚本不直接填写手机号；仅作为补号账号记录和人工排查信息。 |
| `publicCodeKey` | `replacement_accounts.public_code_key` | 当前 OAuth 补号脚本不需要该字段；外部公开取邮箱验证码时才使用。 |
| `emailCodeApi` / `VERIFICATION_CODE_API_URL` | `replacement_accounts.email_code_api` | 存在时默认适配器会覆盖子进程 env 中的 `VERIFICATION_CODE_API_URL`，OAuth 邮箱验证码阶段通过 GET 读取该外部接口并提取 6 位码；该规则对 Gmail 和 iCloud 一致。为空时脚本按邮箱域名选择本地 POST 接口：iCloud 使用 `/api/icloud-verification-code/latest`，其他邮箱使用 `/api/verification-code/latest`。 |
| Roxy API 地址 | `.env` / 运行配置 | `ROXY_API_BASE_URL` 或 `ROXY_API_PORT`，由子进程继承，不来自补号表。 |
| Roxy API Token | `.env` / 运行配置 | `ROXY_API_TOKEN`，不来自补号表。 |
| Roxy 工作区 | `.env` / 运行配置 | `ROXY_WORKSPACE_ID`，不来自补号表。 |
| Roxy 窗口定位 | `.env` / 运行配置 | 默认使用 `ROXY_BROWSER_DIR_ID`、`ROXY_BROWSER_SORT_NUM`、`ROXY_BROWSER_WINDOW_NAME` 三者之一；也可按动作覆盖：注册用 `ROXY_REGISTER_BROWSER_*`，协议注册和协议补号用 `ROXY_PROTOCOL_BROWSER_*`（默认 `3/test`），普通补号用 `ROXY_REPLACE_BROWSER_*`，2FA 补号用 `ROXY_REPLACE_2FA_BROWSER_*`，2FA 登录用 `ROXY_2FA_LOGIN_BROWSER_*`。 |
| 复用 CDP | `.env` / 运行配置 | 默认使用 `ROXY_CDP_ENDPOINT`；动作级可用 `ROXY_REGISTER_CDP_ENDPOINT`、`ROXY_REPLACE_CDP_ENDPOINT`、`ROXY_REPLACE_2FA_CDP_ENDPOINT`、`ROXY_2FA_LOGIN_CDP_ENDPOINT`。配置动作级窗口但未配置动作级 CDP 时，会清除全局 `ROXY_CDP_ENDPOINT`。 |
| 出口 IP 一致性 | `.env` / 运行配置 | `ROXY_IP_CHECK_ENABLED=1` 时，协议 bridge 通过 Roxy `/browser/list` 读取目标 profile 的 `proxyInfo.lastIp`；sticky 代理在注册中途换 IP 会立即终止当前流程。Roxy 版本不提供该字段时可显式设为 `0`，但不再具备换 IP 防护。 |
| 邮箱验证码接口 | `.env` / 运行配置 | `VERIFICATION_CODE_API_URL`；补号账号未配置 `email_code_api` 时留空并按邮箱域名自动选择本地接口：iCloud 使用 `http://127.0.0.1:${PORT}/api/icloud-verification-code/latest`，其他邮箱使用 `/api/verification-code/latest`。 |
| OAuth 邮箱验证码提交 | `.env` / 运行配置 | `ROXY_EMAIL_OTP_PROTOCOL=1` 时，在同一 Roxy 页面上下文 POST `/api/accounts/email-otp/validate`，成功后按响应的 `continue_url` 导航；HTTP 4xx 直接失败，不重复提交 DOM；页面上下文不可用或网络异常时回退 DOM。 |
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
| 导出文件 | `src/auto/product_files/` | 默认写入 `sub2api/邮箱.json` 和 `cpa/邮箱.json`；手动补号和自动补号生产链路都会在成功后上传 CPA JSON 并复查。上传到 CPA 的 auth file 名称使用 `codex-邮箱-plus.json`，本地文件名保持 `cpa/邮箱.json`。 |

成功响应：

```json
{
  "ok": true,
  "account": {
    "id": 1,
    "email": "jregkolpig+s2@gmail.com",
    "status": "cpa_mounted",
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

- `status = cpa_mounted`
- `replacement_count + 1`
- `last_replace_at = 当前时间`
- `last_error = null`
- 生产注入 CPA repair worker 时，会上传 `src/auto/product_files/cpa/<email>.json` 到 CPA 并确认该邮箱凭证恢复健康。

失败时：

- `status` 恢复为操作开始前的业务状态，不写入 `failed`
- `last_error = 补号失败：错误信息`
- `replacement_count` 不变

### POST `/replacement-accounts/:id/replace-2fa`

执行“2FA补号”。该接口与普通 `/replace` 使用同一套补号账号、运行日志和状态流转，但默认运行密码 + 2FA 登录脚本：

```text
src/auto/roxy_2fa_auth_login.js
```

生产注入 `cpaRepairWorker` 时，后端通过 `cpaRepairWorker.repair({ mode: '2fa' })` 统一串接 2FA 自动化、本地 CPA JSON 读取、CPA 上传和上传后健康复查。未注入 worker 的测试/本地模式会 fallback 为直接调用 `replacementServices.replaceAccountWith2FA(account)`。前端补号管理页的行操作和快捷操作名称均为“2FA补号”。

请求体：

```json
{}
```

后端行为：

1. 根据路径参数 `id` 读取 `replacement_accounts` 中未软删除账号。
2. 生产注入 CPA repair worker 时，将账号状态置为 `replacing`，调用 `replacementServices.replaceAccountWith2FA(account, { cpaTriggerDetails })`。
3. 默认适配器启动子进程调用 `src/auto/roxy_2fa_auth_login.js`。
4. 自动化成功后，worker 读取 `src/auto/product_files/cpa/<email>.json` 并上传为 `codex-<email>-plus.json`。
5. 上传后复查 CPA auth file；同邮箱任一凭证健康即通过。
6. 上传和复查均成功后，后端将账号标记为 `cpa_mounted` 并增加成功次数。
7. 自动化、上传或复查失败后，后端恢复操作开始前的业务状态，并在 `last_error` 写入带“2FA补号失败”前缀的错误。

2FA 补号脚本额外使用的数据来源：

| 脚本数据 | 来源 | 说明 |
|---|---|---|
| `password` / `ROXY_OAUTH_PASSWORD` | `replacement_accounts.password` | OpenAI password 页使用的账号密码；有值时默认适配器注入子进程 env。 |
| `codex_2fa` / `ROXY_OAUTH_2FA_CODE` | `replacement_accounts.codex_2fa` | 当 `codex_2fa` 为 6-8 位数字时，作为一次性 2FA 验证码注入。 |
| `codex_2fa` / `ROXY_OAUTH_TOTP_SECRET` | `replacement_accounts.codex_2fa` | 当 `codex_2fa` 不是 6-8 位数字时，作为 TOTP secret 注入，由脚本本地生成当前验证码。 |

其余邮箱、手机、SMS API、邮箱验证码 API、Roxy 配置、callback、token 导出和日志规则同 `/replacement-accounts/:id/replace`。运行日志 `kind` 为 `replacement-2fa`，日志只记录相关 env 是否设置，不记录密码、2FA code、TOTP secret、验证码或 token 明文。

2FA 页面状态判定规则：

- 邮箱提交、password 提交和 MFA 提交后的等待窗口结束时，会再做一次即时阶段复查，避免页面在最后一次等待期间完成导航却被归类为 `unknown`。
- password/MFA 阶段要求对应输入框可见且可操作；Playwright 环境优先检查 `isEnabled()` 和 `isEditable()`，disabled/readOnly 过渡控件不会触发填写动作。
- 状态仍未知时，运行日志会输出 URL、标题和截断页面摘要用于诊断，但不会输出密码、验证码或 token 明文。

成功响应格式同 `/replacement-accounts/:id/replace`：

```json
{
  "ok": true,
  "account": {},
  "run": {}
}
```

失败响应：

```json
{
  "ok": false,
  "error": "REPLACE_FAILED",
  "message": "2FA补号失败原因"
}
```

### POST `/replacement-accounts/:id/replace-2fa-protocol`

执行独立 CPA“协议补号”。该接口不调用注册状态机，也不调用 `roxy_2fa_auth_login.js`；默认启动 `src/auto/protocol_cpa_replacement.py`，由该入口读取当前账号并调用独立 `src/auto/protocol_cpa_auth.py`。

协议链路为：

```text
已有账号登录 -> TOTP 2FA -> 可选 add-phone -> SMS API 轮询
-> phone-otp/validate -> Codex consent -> workspace/select
-> OAuth token -> CPA JSON
```

`OPENAI_WORKSPACE_ID` 必须配置为真实 OpenAI workspace ID，不能使用 Roxy API 的 `ROXY_WORKSPACE_ID`（例如 `111070`）。短信验证码使用当前账号的 `sms_api`，`SMS_API_PROXY` 仅作为独立 SMS transport 代理，不经过 Roxy 页面。

生产注入 CPA repair worker 时，后端调用 `cpaRepairWorker.repair({ mode: '2fa-protocol' })`，只有 CPA JSON 上传并通过健康复查后才标记 `cpa_mounted` 并增加 `replacement_count`。失败时恢复操作前业务状态，并记录“协议补号失败”操作错误。未注入 worker 的测试/本地模式直接调用 `replacementServices.replaceAccountWith2FAProtocol(account)`。

请求头包含 `Accept: text/event-stream` 时，接口返回 SSE 流而不是 JSON，事件包括：

```text
start           开始协议补号
protocol-step   Roxy、CPA 读取/上传/复查等步骤
protocol-log    子进程 stdout/stderr
account-result  本次协议补号成功或失败
complete        执行完成
error           执行异常
```

不带该请求头时保持原 JSON 响应，历史 `/replacement-automation-runs` 日志接口和页面不变。

协议补号子进程默认使用 Roxy 窗口 `3/test`；启动前会刷新动作级 profile（关闭窗口、清理缓存、刷新指纹、重新打开并取得 CDP），再将新的 `ROXY_CDP_ENDPOINT` 注入子进程。运行日志 `kind` 为 `replacement-2fa-protocol`，不记录密码、TOTP、短信验证码或 token 明文。

成功响应格式同 `/replacement-accounts/:id/replace`；失败响应的 `error` 为 `PROTOCOL_REPLACE_FAILED`。

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
3. 将凭证分类为 `healthy`、`banned`、`disabled`、`auth_expired`、`quota_limited` 或 `unknown_error`；同一邮箱存在多个 CPA 凭证时，只要任一凭证健康，该邮箱整体视为健康，不再因其他旧异常凭证触发补号。
4. 只有 `auth_expired` 会按邮箱匹配 `replacement_accounts.email`。
5. 匹配到且账号未处于 `replacing`/`banned` 且未熔断时，加入单并发补号队列并触发队列执行；`banned` 账号跳过原因为 `account_banned`，`circuit_breaker_at` 非空账号跳过原因为 `account_circuit_breaker`。
6. 自动补号运行日志会写入 `step=cpa-trigger`，记录触发补号的 CPA provider、email、status、unavailable、disabled、reasons 和截断后的 `status_message`，用于排查为什么本次执行补号。
7. 补号子进程成功后，上传本地 `src/auto/product_files/cpa/<email>.json` 到 CPA，并再次检查该邮箱凭证是否恢复健康；同一邮箱任一凭证健康即复查通过。
8. 同一账号连续补号失败达到 5 次时，账号保持原业务状态，并写入 `circuit_breaker_at` / `circuit_breaker_reason`；后续 CPA 监控按 `account_circuit_breaker` 跳过，并创建站内通知提醒管理员。

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

## 管理员站内通知 API

通知接口复用后台登录态，调用前需要先登录后台并携带 `admin_auth` cookie。当前主要用于 CPA 自动补号连续失败熔断告警。

### SQLite 表：`admin_notifications`

| 字段 | 说明 |
|---|---|
| `id` | 通知 ID |
| `type` | 通知类型，如 `cpa_repair_circuit_breaker` |
| `severity` | 严重级别，如 `warning`、`critical` |
| `title` | 通知标题 |
| `message` | 通知正文 |
| `account_id` | 关联补号账号 ID |
| `email` | 关联补号邮箱 |
| `read_at` | 已读时间，未读为 `NULL` |
| `created_at` | 创建时间 |

### GET `/admin-notifications`

获取最近通知和未读数量。

查询参数：

```text
limit  可选，默认 10，最大 50
```

成功：

```json
{
  "ok": true,
  "unreadCount": 1,
  "notifications": [
    {
      "id": 1,
      "type": "cpa_repair_circuit_breaker",
      "severity": "critical",
      "title": "账号已触发补号熔断",
      "message": "user@example.com 连续自动补号失败 5 次，已触发自动熔断，不再进入 CPA 自动补号队列。",
      "account_id": 7,
      "email": "user@example.com",
      "read_at": null,
      "created_at": "2026-06-07T00:00:00.000Z"
    }
  ]
}
```

### PATCH `/admin-notifications/:id/read`

将单条通知标记为已读。

成功：

```json
{
  "ok": true,
  "notification": {},
  "unreadCount": 0
}
```

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
- 自动化脚本输出：`src/auto/roxy_oauth_login.js`、`src/auto/roxy_2fa_auth_login.js` 或 `src/auto/roxy_register_openai.js` 输出的 `stdout/stderr`，包括 Roxy 准备、页面状态识别、填写邮箱、密码/2FA、请求/填写邮箱验证码、选择短信验证、请求/填写手机验证码、Codex 授权、callback 和 token 导出等阶段日志。
- `src/auto/roxy_2fa_login.js` 的 ChatGPT session 登录状态规则：只有页面内 `/api/auth/session` 返回 `accessToken` 才判定 `chatgpt-home`；动作后等待窗口结束会再次复查阶段；登录按钮、邮箱、密码、MFA 和 Continue 控件必须可操作，并排除 `aria-disabled` / `inert`；callback 必须匹配 `https://chatgpt.com/api/auth/callback/openai`。页面已有 `evaluate` 能力时，session 请求失败不会导航当前页面到 session API。
- 2FA 状态识别失败时，脚本会额外输出当前页面 URL、标题和截断 body 摘要，便于区分 loading、相邻阶段和真实未知页；该摘要不包含密码、验证码或 token 明文。

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
| 新增账号 | `POST /replacement-accounts` | 创建补号账号，默认 `unregistered` |
| 修改账号 | `PUT /replacement-accounts/:id` | 修改基础信息 |
| 删除账号 | `DELETE /replacement-accounts/:id` | 软删除 |
| 修改状态 | `PATCH /replacement-accounts/:id/status` | 更新状态和备注 |
| 启用/停用公开验证码 | `PATCH /replacement-accounts/:id/public-code` | 只更新 `public_code_enabled` 和必要的 `public_code_key` |
| 一键验活 | `POST /replacement-accounts/healthcheck-banned` | 检测封禁邮件并自动标记 `banned`，支持 SSE 进度 |
| 查询 Plus 状态 | `POST /replacement-accounts/check-plus-status` | 只查询 `registered` 账号，命中订阅邮件后标记 `plus_active`，支持 SSE 进度 |
| 获取验证码 | `POST /replacement-accounts/:id/fetch-sms-code` | 实时返回验证码，不入库 |
| 获取 JSON | `POST /replacement-accounts/:id/fetch-json` | 保存 JSON 原文 |
| 复制注册 AT | `GET /replacement-accounts/:id/registration-token` | 读取已保存的本地 token 文件；不存在时返回“AT 未找到” |
| 注册 OpenAI | `POST /replacement-accounts/:id/register` | 启动注册自动化子进程，邮箱验证码走 POST 内部接口 |
| 协议注册 | `POST /replacement-accounts/:id/register-protocol` | 加入 FIFO 单并发协议注册队列，返回 `202`；成功标记 `registered` |
| 协议注册队列 | `GET /protocol-registration-queue` | 返回当前任务、等待任务、最近结果及每个任务的实时子进程日志；前端只在当前协议注册日志面板显示细节 |
| 清空协议注册队列 | `DELETE /protocol-registration-queue` | 只清空尚未开始的等待任务，不中断当前任务 |
| 自动补号 | `POST /replacement-accounts/:id/replace` | 成功后补号次数加一 |
| 2FA补号 | `POST /replacement-accounts/:id/replace-2fa` | 启动密码 + 2FA 补号自动化，成功后补号次数加一 |
| 协议补号 | `POST /replacement-accounts/:id/replace-2fa-protocol` | 启动独立 CPA 2FA 协议，上传并复查 CPA 后成功 |
| 查看补号日志 | `GET /replacement-automation-runs` / `GET /replacement-automation-runs/:id` | 查看运行记录和 stdout/stderr |
| 停止子进程 | `POST /replacement-automation-runs/:id/stop` | 停止当前服务会话内仍在运行的 child |

## 数据库字段

当前 SQLite 表：`email_accounts`、`replacement_accounts`、`replacement_activation_methods`、`replacement_automation_runs`

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
- 自动补号运行时代码已在 `src/auto/roxy_oauth_login.js`；`POST /replacement-accounts/:id/replace` 默认通过子进程调用该脚本，仍需要 `.env` 中配置有效 RoxyBrowser/API 运行参数。2FA补号运行时代码已在 `src/auto/roxy_2fa_auth_login.js`，由 `POST /replacement-accounts/:id/replace-2fa` 调用。
