# `src/auto`：OAuth 登录与 2FA 补号流程梳理

- 当前对象：`oauth_login.js`、`roxy_2fa_auth_login.js` 及 `/replace-2fa` 服务链路
- 当前文档类型：功能拆解文档
- 上级文档路径：`docs/source-guides/gmail-imap-auto/00-project-map.md`
- 当前进入这一层的原因：确认“生成授权链接的旧 OAuth 流程”和“服务实际调用的 2FA 补号流程”是否是同一条链路
- 下一步阅读目标：授权 URL 差异、Roxy 2FA 页面状态机、CPA worker 的上传与状态回写

## 结论先行

项目中存在三条容易混淆但不同的链路：

1. `src/auto/oauth_login.js`：旧的独立 OAuth 自动化。它自己启动 Playwright、自己取代理、打开完整 OAuth authorize URL，随后走“邮箱验证码 → 授权确认 → callback → token”。它不处理已有账号的密码 + TOTP MFA。
2. `src/auto/roxy_2fa_auth_login.js`：服务默认使用的“密码 + 2FA OAuth”脚本。它复用 `roxy_oauth_login.js` 的 Roxy 开窗、页面状态机、手机号、Codex consent、callback 和 token 导出能力，只把 password/MFA 阶段替换为密码 + TOTP。
3. `/replacement-accounts/:id/replace-2fa`：后台业务入口。生产模式先进入 `cpaRepairWorker`，再启动 `roxy_2fa_auth_login.js`；成功后才读取 CPA JSON、上传并复查健康状态。

## 1. 授权 URL：不能把 Auth 根页当成目标页

`oauth_login.js` 在 `src/auto/oauth_login.js:916-919` 运行时生成完整链接：

```text
https://auth.openai.com/oauth/authorize?
  client_id=...
  &code_challenge=...
  &code_challenge_method=S256
  &codex_cli_simplified_flow=true
  &id_token_add_organizations=true
  &redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback
  &response_type=code
  &scope=openid+profile+email+offline_access
  &state=...
```

它在 `src/auto/oauth_login.js:961` 直接 `page.goto(authUrl)`。流程目标是完整的 `/oauth/authorize?...`，不是 `https://auth.openai.com/` 根页。

`roxy_oauth_login.js:1353-1368` 生成基础 URL；`roxy_2fa_auth_login.js` 现在直接复用该 builder，不再额外增加 `prompt=login`。当前两者的首跳 URL 形态一致：

```text
oauth_login.js              -> 完整 /oauth/authorize URL，无 prompt 参数
roxy_2fa_auth_login.js      -> 同形态完整 /oauth/authorize URL，无 prompt 参数
```

此前把“能否打开 `https://auth.openai.com/` 根页”当作前置验证是不正确的；后续只验证代码实际生成的完整 authorize URL。旧的 `prompt=login` 差异已由 CHG-090 消除。

## 2. `oauth_login.js` 的实际自动化流程

入口：`src/auto/oauth_login.js:891-1041`。

1. `store.getActiveProxy()` 取独立代理，并用 `httpbin.org/ip` / `api.ipify.org` 做代理探针（`oauth_login.js:895-914`、`oauth_login.js:320-374`）。
2. 生成 PKCE `verifier/challenge` 和 OAuth `state`（`oauth_login.js:916-919`）。
3. 使用 `playwright-extra` 启动独立 Chromium，应用代理和 California fingerprint（`oauth_login.js:922-954`）。这条链路不是 Roxy CDP profile。
4. 导航完整 authorize URL；填写邮箱并提交（`oauth_login.js:961-970`）。
5. 从邮箱/邮箱池获取 OpenAI 邮箱验证码，填写并重试错误码（`oauth_login.js:770-849`）。
6. 点击授权确认按钮，等待 `localhost:1455/auth/callback` 请求（`oauth_login.js:973-990`）。
7. 使用 Axios `POST https://auth.openai.com/oauth/token` 换 Token，并写入 `product_files/sub2api` 和 `product_files/cpa`（`oauth_login.js:438-497`、`oauth_login.js:123-154`）。

因此，不能直接把 `oauth_login.js` 当作已有密码 + TOTP 账号的 2FA 补号脚本：它默认走邮箱 OTP，不会提交账号密码和 TOTP。

## 3. `roxy_2fa_auth_login.js` 的实际流程

### 3.1 Runner 和页面入口

- `roxy_2fa_auth_login.js:511-518` 把自定义 `process2FAOAuthLoginFlow` 和自定义授权 URL builder 注入 `roxy_oauth_login.js` 的通用 runner。
- `roxy_oauth_login.js:1484-1545` 负责解析 Roxy profile、关闭旧窗口、清本地/服务端缓存、随机指纹、开窗、取得 CDP 并连接 Playwright。
- `roxy_oauth_login.js:2265-2309` 生成 PKCE/state，生成完整 target URL，并在 `src/auto/roxy_oauth_login.js:2288` 导航该 target URL。

### 3.2 密码 + TOTP 阶段

`roxy_2fa_auth_login.js:406-466` 的状态机顺序是：

```text
choose-account（可选）
→ email login
→ password
→ MFA/TOTP
→ 交回原 OAuth 状态机
```

- 邮箱页复用 `roxy_oauth_login.js:415-449` 的 role selector，提交后等待后续阶段。
- password 页由 `roxy_2fa_auth_login.js:322-354` 填密码并点击 Continue。
- MFA 页由 `roxy_2fa_auth_login.js:365-397` 生成/读取 TOTP，并点击 Continue。
- password/MFA 阶段要求控件可见且可操作，避免把过渡态 DOM 当成真实阶段。

### 3.3 手机补号与短信阶段

MFA 后交给 `roxy_oauth_login.js:2070-2210` 的原 OAuth 状态机：

```text
phone-add
→ phone-verify（选择 Text Message）
→ phone-code（读取 SMS API、填写验证码）
→ codex-login
→ callback
```

- 手机页识别和点击在 `roxy_oauth_login.js:1022-1058`；脚本本身是填写手机号后点击 Continue，不直接调用名为 `add-phone/send` 的 HTTP 函数。真正的 `add-phone/send` 请求由 OpenAI 页面前端在点击后发出。
- 手机方式选择在 `roxy_oauth_login.js:873-898`。
- 手机验证码读取在 `roxy_oauth_login.js:1087-1131`，提交在 `roxy_oauth_login.js:1133-1218`。
- SMS API 读取只应发生在进入手机验证码阶段之后；发送前的空 SMS 结果不能证明 OpenAI 没有发码。

### 3.4 Codex consent、callback、Token

- Codex consent 页识别/点击在 `roxy_oauth_login.js:1233-1328`。
- callback 由请求监听、URL 变化和 CDP fallback 共同捕获，要求 state 匹配。
- 正式 token exchange 在 `roxy_oauth_login.js:1569-1650`，优先使用 Roxy 页面上下文；页面内 `fetch('/oauth/token')` 的具体实现位于 `roxy_oauth_login.js:1737-1797`。
- Token 解析后写入 CPA/sub2api 文件，入口为 `roxy_oauth_login.js:123-154`。

## 4. 服务的 2FA 补号链路

### 4.1 后台入口

`src/server.js:480-508` 注册 `POST /replacement-accounts/:id/replace-2fa`：

```text
读取 replacement_accounts
→ 生产模式调用 cpaRepairWorker.repair({ mode: '2fa' })
→ 非 worker 模式直接调用 replaceAccountWith2FA
```

### 4.2 子进程配置注入

`src/replacementServices.js:261-315` 默认启动 `DEFAULT_ROXY_2FA_AUTH_SCRIPT`，即 `src/auto/roxy_2fa_auth_login.js`，并注入：

```text
ROXY_OAUTH_EMAIL       <- replacement_accounts.email
ROXY_OAUTH_PASSWORD    <- replacement_accounts.password
ROXY_OAUTH_2FA_CODE    <- codex_2fa（如果是 6-8 位数字）
ROXY_OAUTH_TOTP_SECRET <- codex_2fa（否则按 TOTP secret）
ROXY_OAUTH_PHONE       <- replacement_accounts.phone
PHONE_VERIFICATION_SMS_API_URL <- replacement_accounts.sms_api
VERIFICATION_CODE_API_URL      <- replacement_accounts.email_code_api（可选）
```

Roxy 目标通过 `ROXY_REPLACE_2FA_*` 动作配置选择；它不是 `oauth_login.js` 的独立代理获取逻辑。

### 4.3 CPA 上传和业务状态

生产模式的 `src/cpaRepairWorker.js:14-52` 在自动化子进程成功后继续执行：

```text
读取 src/auto/product_files/cpa/<email>.json
→ 上传 codex-<email>-plus.json
→ CPA auth-health 复查
→ 成功才 markReplacementSuccess
```

自动化失败、文件不存在、上传失败或健康复查失败，都会恢复原业务状态并记录失败；不会因为只打开了授权页就认为 2FA 补号成功。

## 5. 当前需要保持的判断边界

- 现在还没有进入协议编码阶段。
- 后续真实验证必须打开“代码生成的完整 authorize URL”，不能先打开 Auth 根页，也不能用 `chatgpt.com` 官网首页替代。
- 2FA runner 已与 `oauth_login.js` 使用同形态完整 authorize URL；不打开 Auth 根页，也不以 ChatGPT 官网首页替代入口。
- 账号 109 的完整 password/MFA、add-phone、SMS、phone-otp 链路已有同日干净流程证据；后续重点是通过后台 worker 验证 CPA 上传和健康复查。

## 6. 实测校正（2026-07-20）

在 Roxy `3/test` / `dirId=4c83715f6713db30c9baf9bfbc5086d3`、出口 `98.206.61.108` 上，临时把 2FA runner 的 URL builder 设置为 `oauth_login.js` 的完整 authorize URL 形态（不加 `prompt=login`），实际跑通：

```text
authorize → /log-in → password → mfa → phone-add
→ phone-code/SMS → phone-otp → Codex consent
→ OAuth callback → oauth/token → CPA/sub2api 文件
```

这次调试证明：

- 正确入口是完整 `/oauth/authorize?...`，不是 Auth 根页；
- 2FA 状态机、手机补号、短信轮询和 Token exchange 代码可以端到端衔接；
- 这次绕过了后台 `/replace-2fa` worker，所以不能据此确认 CPA 上传、健康复查或数据库状态回写；
- 后续已将 2FA runner 默认 URL 改为同形态无 `prompt=login` URL，并在已打开 Roxy CDP 上复跑到 `oauth/token` HTTP 200。

## Unconfirmed Points

- `/replace-2fa` 使用的生产 worker 代码路径已在账号 109 上完成 CPA 上传、auth-health 复查和数据库 `cpa_mounted` 状态回写；本次未额外通过 HTTP 管理页面触发。
- Roxy 出口可能再次出现连接重置；当前已打开 CDP 会话可达 Auth，若复现应单独记录出口和完整 authorize URL 结果。
