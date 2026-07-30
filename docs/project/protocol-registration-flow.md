# 协议注册流程与接口指导

状态：active guidance  
最后验证：2026-07-30（Roxy `617-3` 手动端到端成功，已完成 TOTP 2FA）

本文是 `src/auto/protocol_registration/` 的实现与排错指导，不保存验证码、密码、access token、
Cookie、CDP endpoint 或真实邮箱地址。

## 1. 已验证的状态机

```text
ChatGPT OAuth 初始化
  -> /email-verification（页面过渡，不提交 OTP）
  -> username_password_create（密码页）
  -> user/register
  -> email_otp_send（第二次邮箱验证码）
  -> about_you（姓名、年龄、生日）
  -> create_account
  -> OAuth callback / ChatGPT session
  -> accessToken
  -> TOTP enroll / activate / mfa_info 确认
```

2026-07-30 录制的关键响应：

| 调用 | HTTP | `page.type` | 后续动作 |
|---|---:|---|---|
| `POST /api/accounts/user/register` | 200 | `email_otp_send` | 跟随 `continue_url` 触发第二封邮件 |
| `POST /api/accounts/email-otp/validate`（第二次） | 200 | `about_you` | 跟随 `continue_url` 到资料页 |
| `POST /api/accounts/create_account` | 200 | `external_url` | 跟随 `continue_url` 完成 OAuth callback |

页面 URL 只能用于观察，不是阶段成功条件。所有自动状态转换必须同时验证：HTTP 成功、响应
`page.type`、`method=GET`、非空 `continue_url`，然后才跟随 continuation。

## 2. 会话和不变量

- 全程复用一个 `BrowserSession`、同一个 Roxy CDP profile、同一出口 IP、同一 UA 和同一
  cookie 上下文；不要在中途新建 HTTP 会话。
- `device_id`（`ext-oai-did` / `oai-device-id`）和 `auth_session_logging_id` 每次注册生成
  一次后全程复用。
- Roxy CDP 模式使用浏览器页面上下文请求，Sentinel token 和 SO token 由该页面的 Sentinel SDK
  生成；不得把另一个 profile 或旧会话的 token 混入。
- `x-access-flow-invocation-id` 每个 Auth API 请求生成一个新的 UUID。
- 所有密码、OTP、token、Cookie、Sentinel 原文和回调 query 都只能存在于内存或受控运行产物，
  日志仅记录字段名、阶段和脱敏状态。

## 3. OAuth 初始化

### 3.1 ChatGPT 预备接口

| 步骤 | 方法和路径 | 必要输入 | 成功条件 |
|---|---|---|---|
| Providers | `GET https://chatgpt.com/api/auth/providers` | ChatGPT 浏览器头 | HTTP 200 |
| CSRF | `GET https://chatgpt.com/api/auth/csrf` | ChatGPT 浏览器头 | JSON 含 `csrfToken` |
| Signin | `POST https://chatgpt.com/api/auth/signin/openai?...` | 表单 `callbackUrl=https://chatgpt.com/login`、`csrfToken`、`json=true` | JSON 含 Auth authorize URL |

Signin URL 查询参数：

| 参数 | 值/来源 |
|---|---|
| `ext-oai-did` | 本次会话 `device_id` |
| `auth_session_logging_id` | 本次会话 ID |
| `ext-passkey-client-capabilities` | `1111` |
| `screen_hint` | `login_or_signup` |
| `prompt` | `login` |
| `login_hint` | 当前注册邮箱 |

从 Signin 返回的 URL 进入：

```text
GET https://auth.openai.com/api/accounts/authorize?... 
-> /email-verification
-> /create-account/password
```

授权 URL 中保留服务端返回的 `client_id`、`scope`、`response_type=code`、`redirect_uri`、
`audience` 和 `state`，不得自行拼接、复用或记录 `state`。

## 4. Auth 接口

### 4.1 Sentinel

| flow | 使用阶段 | 随后的接口 |
|---|---|---|
| `authorize_continue` | 每次邮箱 OTP validate 前 | `email-otp/validate` |
| `username_password_create` | 密码提交前 | `user/register` |
| `oauth_create_account` | 资料提交前 | `create_account` |

Auth 请求的共同要求：

```text
accept: application/json
content-type: application/json
origin: https://auth.openai.com
referer: 当前真实 Auth 页面
x-access-flow-invocation-id: <新的 UUID>
openai-sentinel-token: <同一会话、同一 flow 的 token>
openai-sentinel-so-token: <仅 SDK 返回且接口要求时携带>
```

### 4.2 密码提交

```http
POST https://auth.openai.com/api/accounts/user/register
Referer: https://auth.openai.com/create-account/password

{"username":"<email>","password":"<ROXY_REGISTER_PASSWORD>"}
```

前置条件：当前服务端阶段已经是 `username_password_create`，并刚生成对应 Sentinel token。
成功后必须要求：`page.type=email_otp_send`、`method=GET`、存在 `continue_url`。

### 4.3 密码后的邮箱 OTP

```text
GET <user/register 响应的 continue_url>
  典型路径：/api/accounts/email-otp/send
-> /email-verification

POST https://auth.openai.com/api/accounts/email-otp/validate
Referer: https://auth.openai.com/email-verification
Body: {"code":"<6 digits>"}
```

`email-otp/validate` 成功后必须要求 `page.type=about_you`，再跟随其 `continue_url`。
`wrong_email_otp_code`、HTTP 401、仍在验证码页或无 continuation 都不能当作成功。

### 4.4 资料提交与回调

```http
POST https://auth.openai.com/api/accounts/create_account
Referer: https://auth.openai.com/about-you

{"name":"<仅英文和空格>","birthdate":"YYYY-MM-DD"}
```

该请求需要 `oauth_create_account` Sentinel token 和 SO token。成功响应应为
`page.type=external_url`，跟随其 `continue_url`，最终会到：

```text
https://chatgpt.com/api/auth/callback/openai?code=<redacted>&state=<redacted>
```

回调后调用 `GET https://chatgpt.com/api/auth/session`；只有 JSON 中出现 `accessToken` 才表示
登录态建立完成。

## 5. TOTP 2FA

复用注册后 `accessToken`，不要重新走 password re-auth 或邮箱 OTP：

| 顺序 | 方法和路径 | JSON 请求体 | 成功条件 |
|---|---|---|---|
| 1 | `GET /backend-api/accounts/mfa_info` | 无 | `mfa_enabled_v2` 为 false |
| 2 | `POST /backend-api/accounts/mfa/enroll` | `{"factor_type":"totp"}` | 返回 `secret`、`session_id` |
| 3 | `POST /backend-api/accounts/mfa/user/activate_enrollment` | `{"code":"<TOTP>","factor_type":"totp","session_id":"..."}` | `success=true` |
| 4 | `GET /backend-api/accounts/mfa_info` | 无 | `mfa_enabled_v2=true` |

MFA 请求带 `Authorization: Bearer <accessToken>`、`oai-device-id`、`oai-language` 和当前会话的
ChatGPT 请求头。

## 6. 双 OTP 与旧码防护

一次注册只在 `user/register` 成功并执行 `email-otp/send` 后读取验证码；初始
`/email-verification` 是页面过渡，不能调用 `email-otp/validate`。验证码读取需按此唯一阶段隔离：

1. 在执行 `email-otp/send` 前保存 `otp_started_at`、已尝试验证码、邮件 `message_id` 与
   `received_at`；不得使用 OAuth 开始时间作为验证码时间下界。
2. 轮询上限为 120 秒，间隔为 5 秒；“120 秒”是最大等待窗口，不是拿到新码后固定延迟
   120 秒。
3. 只接受有可解析 `received_at`、且严格晚于本阶段 `otp_started_at` 的邮件。
   外部 `email_code_api` 返回纯文本或没有时间戳时不得直接提交。
4. 接口返回 `wrong_email_otp_code` 时，不要退出：记录该码及其邮件标识，继续轮询，直到
   出现不同验证码且邮件时间晚于已尝试邮件，或本阶段 120 秒窗口耗尽。
5. 日志只能记录“新邮件/旧邮件/重复码/错码重试/超时”等分类，不记录 6 位验证码本身。

外部邮箱 API 已观察到 JSON 字段：`email`、`from`、`code`、`subject`、`received_at`、
`message_id`、`body*`。自动读取只应使用 `code`、`received_at`、`message_id` 和必要的发件人/
主题筛选；不得把邮件正文写入运行日志。

## 7. 失败分类与处理

| 现象 | 处理 |
|---|---|
| `wrong_email_otp_code` | 继续本阶段 5 秒轮询，忽略已提交码，等待更新邮件；不能标记为注册成功 |
| `invalid_auth_step` / `invalid_state` | 停止当前会话；采集当前 Auth 响应 `page.type` 与 continuation，不能通过访问密码页 URL 强行推进 |
| `user/register` 非 200 | 未创建账号；保留为 `unregistered`，不复用当前 OAuth transaction |
| `create_account` 成功后回调或 session 失败 | 远端账号已创建；保留账号结果并按后续恢复策略处理，禁止再次注册相同邮箱 |
| TOTP 激活失败 | 保存已建立的 accessToken，但不要将补号账号状态同步为 `registered`；先人工排查 MFA 状态 |

## 8. 实施检查清单

- [ ] 每个阶段使用对应的 Sentinel flow，且令牌来自当前 Roxy 页面上下文。
- [ ] `user/register` 前已证实 `username_password_create`，不是仅发现密码页 URL。
- [ ] `user/register` 后的 `email_otp_send` 已触发第二封邮件。
- [ ] 两次 OTP 的时间下界、邮件 ID 和已尝试码彼此隔离。
- [ ] `wrong_email_otp_code` 有有限重试，且只接受更新邮件。
- [ ] `create_account` 后已跟随 callback，并以 `/api/auth/session.accessToken` 验证。
- [ ] `mfa_info` 二次确认 TOTP 已启用后才同步为 `registered`。

## 9. 证据与代码入口

- 手动录制：`src/auto/roxy_register_openai.cdp_network_recording.jsonl`（本地调试产物，含脱敏字段）。
- 运行入口：`src/auto/protocol_registration/main.py`。
- Auth 请求：`src/auto/protocol_registration/core/openai_auth.py`。
- OAuth 与 TOTP：`src/auto/protocol_registration/core/account_export.py`。
- 外部验证码轮询：`src/auto/protocol_registration/core/replacement_client.py`。
- 已确认规则：`docs/changes/CHG-100-protocol-registration-response-driven-navigation.md`、
  `docs/issues/issue-020-protocol-registration-cdp-navigate-timeout-budget.md`。
