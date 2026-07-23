# 2026-07-20 独立 CPA 2FA 补号真实测试

## 目标

使用 replacement account `109`（`19_immoral.bitmap@icloud.com`）和 Roxy `3/test`，验证独立 `src/auto/protocol_cpa_auth.py` 的 CPA 生成链路；不接入注册入口。

## 当前工作目标（用户确认）

- 先完成账号 109 的既有 2FA 补号自动化调试，再考虑独立 CPA 协议；当前不修改注册状态机，不先编码 CPA 协议。
- 严格使用 `src/auto/oauth_login.js:916-919` 生成的完整 `https://auth.openai.com/oauth/authorize?...` 链接；不把 `https://auth.openai.com/` 根页当成流程入口。
- 继续核对 `src/auto/roxy_2fa_auth_login.js` 与服务 `/replacement-accounts/:id/replace-2fa` 的真实链路，逐阶段记录 password、TOTP、phone、SMS、Codex consent、callback、token 和 CPA 文件证据。
- 用户指定 Roxy `617-3` 浏览器；当前 Roxy API 按窗口 `3/test` 解析到 `dirId=4c83715f6713db30c9baf9bfbc5086d3`。本次重新查询出口为 `98.206.61.108`。

## 正确 authorize URL 调试结果（2026-07-20）

- 通过 Roxy API 打开并复用 `3/test` / `dirId=4c83715f6713db30c9baf9bfbc5086d3`，没有打开 `https://auth.openai.com/` 根页。
- 首轮临时调用现有 `roxy_2fa_auth_login.js`，将 URL builder 切换为 `oauth_login.js` 的完整 authorize URL 形态（不加 `prompt=login`）。后续已将该形态固化为 2FA runner 默认行为，详见 `CHG-090`。
- 页面首跳成功进入 `https://auth.openai.com/log-in`，标题为 `Welcome back - OpenAI`。
- 实际阶段完整通过：

  ```text
  email → password → mfa → phone-add → phone-code
  → SMS 第 4 次轮询取到验证码 → phone-otp
  → Codex consent → OAuth callback → oauth/token
  ```

- 已生成并核验 CPA 文件：`src/auto/product_files/cpa/19_immoral.bitmap@icloud.com.json`，包含 `access_token`、`refresh_token`、`id_token`；同时生成 sub2api 文件。
- 本次是直接调试 Node 自动化，绕过了 `/replace-2fa` 后台 worker，因此没有执行 CPA 上传、auth-health 复查和数据库状态回写；账号数据库仍为 `plus_active`、`replacement_count=0`。
- 这证明完整 authorize URL 和后续 2FA/手机补号链路可用；下一步是单独验证后台 `/replace-2fa` worker 的 CPA 上传与健康复查。

## 干净流程的阶段/接口证据

首轮干净会话的直接 Node 调试输出与浏览器网络记录按以下顺序完成，敏感值未写入文档：

```text
GET  /oauth/authorize
POST /api/accounts/authorize/continue
POST /api/accounts/password/verify
POST /api/accounts/mfa/issue_challenge
POST /api/accounts/mfa/verify
POST /api/accounts/add-phone/send       -> 4xx（手机号已存在分支，继续）
SMS API polling                         -> 第 4 次取得新验证码
POST /api/accounts/phone-otp/validate
GET  /sign-in-with-chatgpt/codex/consent.data
POST /api/accounts/consent
POST /api/accounts/workspace/select
GET  /oauth2/auth
POST /oauth/token
```

对应页面阶段为：`/log-in -> password -> mfa -> phone-add -> phone-code -> phone-otp -> Codex consent -> callback`。
最新的生产 worker 日志只复用已认证会话验证 Codex/token/upload；不将它重复计入 password/TOTP/SMS 阶段。

## 代码对比

- `src/auto/roxy_2fa_auth_login.js` 现在直接复用 `roxy_oauth_login.js` 的 `buildOAuthAuthorizeUrl()`，首跳为 `https://auth.openai.com/oauth/authorize`，不追加 `prompt=login`。
- `src/auto/protocol_cpa_auth.py` 通过 `build_authorize_url()` 使用相同的 Auth Codex OAuth 首跳。
- 注册协议仍可使用 `chatgpt.com` 预热；独立 CPA 已禁用该预热，并由 bridge 直接导航完整 Auth authorize URL，Auth、Sentinel 和 ChatGPT 仍使用独立页面。
- `add-phone/send` 返回 4xx 时继续手机阶段；现在成功调用后会按配置轮询 SMS API，而不是只读取一次。
- 新协议没有修改 `protocol_registration/main.py` 或注册状态机。

## 已打开 Roxy 会话继续重跑（2026-07-20 13:45 左右）

- 连接用户指定的 Roxy `617-3 / 3/test` 已打开 CDP；没有重新打开 Auth 根页、没有清缓存、没有更换窗口。
- 实际调用的是生产 `src/auto/roxy_2fa_auth_login.js` 默认 runner；目标 URL 解析为 `/oauth/authorize`，`prompt=login=false`。
- 选择账号点击后页面存在异步跳转；新增等待守卫只点击一次，随后交接到原 OAuth 状态机。
- 页面网络证据：`POST /api/accounts/workspace/select` 返回 200，`POST /oauth/token` 返回 200；本地 callback 仍因 `localhost:1455` 未监听而显示 Chrome `ERR_CONNECTION_REFUSED`，不影响页面上下文 token exchange。
- 运行结果为 `oauth-completed`。CPA JSON 和 sub2api JSON 均存在；CPA JSON 的 `access_token`、`refresh_token`、`id_token` 均非空。
- 本轮复用的是前一轮已完成登录的浏览器会话，因此没有再次触发 add-phone/SMS；完整 `password -> TOTP -> phone-add -> SMS -> phone-otp` 证据仍以本文件前面的干净流程为准。

## 后台 CPA worker 验证（2026-07-20 13:54 左右）

- 使用账号 109 的真实数据库记录启动 `cpaRepairWorker.repair({ mode: '2fa' })`。
- 2FA 子进程通过动作级 CDP 复用当前 `617-3 / 3/test`，清除了 `.env` 中旧的 `ROXY_REPLACE_2FA_BROWSER_SORT_NUM=10` 影响。
- 本地 CPA JSON 读取成功，上传文件名为 `codex-19_immoral.bitmap@icloud.com-plus.json`。
- CPA auth-files 复查匹配到该文件，状态为 `active`。
- worker 返回成功；账号 109 已更新为 `cpa_mounted`，`replacement_count=1`，`last_error=null`。
- 运行日志：`data/automation-logs/replacement-2fa-109-2026-07-20T05-54-14-373Z.log`。
- 本次直接调用与生产入口相同的 `cpaRepairWorker.repair`，未额外通过 HTTP 管理页面触发；HTTP 路由只负责传入账号和 worker。

## 实测

- Roxy API 定位到 `dirId=4c83715f6713db30c9baf9bfbc5086d3`，窗口 `3/test`。
- 首次查询出口为 `61.114.197.9`；复测时出口变为 `220.96.77.3`。
- 当前出口连续四次查询保持 `220.96.77.3`。
- 修复后独立 CPA 已直接导航 `auth.openai.com/oauth/authorize`，但当前 Roxy 出口仍返回 `ERR_CONNECTION_RESET`。
- 按 Roxy 标准准备序列重新打开 profile，出口未改变，Auth 仍失败。
- 本次复测在 Auth 首页失败，未执行 `add-phone/send`；因此没有把发送前 SMS API 空结果作为验证码失败证据。
- 此前完整运行已执行 `add-phone/send`（HTTP 400）并进入手机验证码阶段；本次没有继续提交错误 OTP，没有执行 workspace/select、oauth/token，也没有生成账号 109 的 CPA 文件。

## 账号 109 本轮重跑（2026-07-20）

- 直接调用 `src/auto/roxy_2fa_auth_login.js`，环境来自数据库账号 109：邮箱、密码、TOTP secret、手机号和 SMS API 均已注入；Roxy 目标强制为 `3/test`、`dirId=4c83715f6713db30c9baf9bfbc5086d3`。
- Roxy API 实时查询出口为 `220.96.77.3`（`proxyInfo.lastIp`）；准备序列完成并取得 CDP endpoint。
- 脚本实际导航目标为 `https://auth.openai.com/oauth/authorize?...&prompt=login`，不是 `chatgpt.com` 官网；首个 `page.goto` 即报 `net::ERR_CONNECTION_RESET`。
- 页面随后为 Chrome `chrome-error://chromewebdata/`，标题为 `auth.openai.com`，正文为“无法访问此网站 / 连接已重置”。本轮没有产生新的 Auth API 请求，未到达 `add-phone/send`。
- 账号 109 状态仍为 `plus_active`，`replacement_count` 和 `last_replace_at` 未改变，CPA 输出目录没有生成该账号的新文件。

## 自动验证

- `npm test -- test/roxy2FAAuthLogin.test.js`：14/14 通过（含延迟 choose-account 导航和默认 URL 回归）。
- 注册协议 Python 全量测试：42/42 通过。
- CPA 专项测试：5/5 通过。
- CPA 新增 `add-phone/send` 4xx 后 SMS 轮询和直接 Auth 导航回归后：5/5 通过。
- Python 语法、Node bridge 语法和 `git diff --check` 通过。
- 当前关联 Node 回归（2FA runner、OAuth runner、CPA worker、replacement services）：136/136 通过。
- 使用 `F:\\anaconda\\anaconda3\\envs\\tilian\\python.exe` 重跑注册协议测试 42/42、CPA 专项测试 5/5，均通过。
- 仓库默认 `npm test` 为 390/391；唯一失败是依赖未启动本地服务的 `test/test-verification-code.mjs`，不属于本次改动。

## 结果边界

账号 109 的既有 2FA 补号、CPA 文件生成、CPA 上传、健康复查和数据库状态回写均已完成验证。不要重复发送已补号手机号验证码；若继续做回归，只使用新的测试账号或复用已认证会话。workspace ID 仍需使用 OpenAI 会话值，不能使用 Roxy `111070`。

## 后续发现：phone-code 阶段未发送 add-phone（2026-07-20）

- 复查协议代码发现 `_complete_phone_stage()` 在 `next_stage == "phone-code"` 时跳过了 `add-phone/send`，直接进入 SMS polling。
- 这与当前规则不符：手机号只成功绑定一次，但 `add-phone/send` 的 4xx 可表示手机号已存在或已有待处理请求，仍应继续验证码阶段。
- 已改为所有手机阶段先请求 `add-phone/send`，再轮询 SMS；新增阶段日志避免把“等待短信”误认为“已发送手机号请求”。
- 新增 `phone-code` 顺序回归测试；CPA Auth 8/8、CPA replacement 2/2、Python 编译检查通过。

## 真实管理接口复测（Run 612，账号 76）

- 通过 `POST /replacement-accounts/76/replace-2fa-protocol` 真实触发，HTTP SSE 返回 200。
- 实际 MFA 响应阶段为：

  ```text
  next_stage=sign-in-with-chatgpt-codex-consent
  continue_path=/sign-in-with-chatgpt/codex/consent
  ```

- 本轮没有调用 `add-phone/send`，也没有进入 SMS polling；这是因为 Auth 明确返回 Codex consent，而不是手机阶段。
- 后续失败点为 `accounts/consent did not return OAuth location`，与手机号绑定逻辑无关。
- 数据库账号 76 存在手机号字段和 SMS API 配置，但字段存在不能作为 OpenAI 本轮已绑定手机号的证据。
