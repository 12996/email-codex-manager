# Issue-017 Roxy CPA Auth 出口被重置或拒绝

状态：resolved
发现日期：2026-07-20

## 现象

使用账号 `109`、Roxy workspace `111070` 的窗口 `3/test` 继续独立 CPA 测试时，协议在首个 Auth 导航前失败：

- `https://auth.openai.com/`：`ERR_CONNECTION_RESET`
- 修复独立 CPA 跳过 ChatGPT 预热后，完整 `https://auth.openai.com/oauth/authorize?...` 仍为 `ERR_CONNECTION_RESET`。
- 早先直接手动探测 OAuth URL 时曾返回 HTTP `403`，页面标题为 `Just a moment...`。

同一 profile 的 Roxy API 查询显示当前 `proxyInfo.lastIp` 为 `220.96.77.3`，连续四次查询保持不变。之前成功走到 `add-phone/send` 的运行使用过 `61.114.197.9`。

## 排查结论

- `src/auto/roxy_2fa_auth_login.js` 的 `buildOAuthAuthorizeUrl()` 和 `src/auto/protocol_cpa_auth.py` 的 `build_authorize_url()` 都直接构造 `auth.openai.com/oauth/authorize`。
- `BrowserSession` 对 `chatgpt.com` 的导航是指纹预热；它不会替代后续 Auth 导航，也没有把 CPA 流程改成官网登录。
- 按 `close -> clear local cache -> clear server cache -> random fingerprint -> open` 重新准备 Roxy profile 后，出口仍为 `220.96.77.3`，Auth 根页仍重置连接。
- 因此当前证据指向 Roxy 出口/上游风控状态，不指向注册状态机或 CPA endpoint 顺序。
- 后续复用同一已打开 Roxy CDP 会话时，完整 `/oauth/authorize` 可以到达 Auth；因此“Auth 域名始终不可达”不是稳定结论，需要保留出口、会话状态和 URL 参数三个变量。

## 关联阻塞

本次复测在 Auth 首页就失败，没有执行 `add-phone/send`，因此本次不能用 SMS API 的空结果判断 OpenAI 是否发送验证码。此前另一轮完整运行已经到达 `add-phone/send`（HTTP 400，随后按协议进入手机验证码阶段）；只有那一轮的后续 SMS 轮询结果才可作为短信证据。

## 2026-07-20 账号 109 重跑证据

- 已实际调用 `src/auto/roxy_2fa_auth_login.js`，账号字段从 `replacement_accounts.id=109` 注入，目标固定为 `3/test` / `dirId=4c83715f6713db30c9baf9bfbc5086d3`。
- Roxy API 返回 `proxyInfo.lastIp=220.96.77.3`；Roxy 准备和 CDP 连接均成功。
- 脚本首跳日志明确为 `https://auth.openai.com/oauth/authorize?...&prompt=login`，随后 `page.goto` 报 `net::ERR_CONNECTION_RESET`。
- 通过 CDP 检查到页面为 `chrome-error://chromewebdata/`，正文为连接已重置；因此本轮没有任何 Auth 接口可供采集，也没有执行手机号或 SMS 阶段。
- 该证据排除了“脚本误打开官网”以及“add-phone 代码未执行”作为本轮失败原因；当前阻塞仍在 Auth 出口可达性。

## 后续监控

1. 若再次出现连接重置，记录当次 Roxy 出口、是否复用 CDP、完整 authorize URL 参数和首个失败请求；不要打开 Auth 根页替代流程。
2. 不重复触发已经完成过一次的 add-phone；只有新的干净账号或明确需要重新补号时才验证 SMS API。

## 2026-07-20 正确 authorize URL 成功证据

- Roxy API 重新打开 `3/test`，`dirId=4c83715f6713db30c9baf9bfbc5086d3`，实时出口为 `98.206.61.108`。
- 直接复用现有 `roxy_2fa_auth_login.js` 状态机，但将 URL builder 临时设置为 `oauth_login.js` 的完整 authorize URL 形态（不加 `prompt=login`）。
- 首跳成功进入 `https://auth.openai.com/log-in`，随后完整通过 password、MFA、phone-add、SMS、phone-otp、Codex consent、callback 和 token exchange。
- 因此此前失败不能再简单归因于“Auth 域名不可达”；至少需要区分 Roxy 出口变化和 `prompt=login` URL 差异。当前尚未在同一出口对默认 `prompt=login` 做 A/B 验证。
- 本次未走后台 `/replace-2fa` worker，未执行 CPA 上传和健康复查；不把本次文件生成等同于后台业务状态已完成。

## 2026-07-20 13:45 已打开 CDP 复跑证据

- 连接用户指定的 `617-3 / 3/test` 已打开浏览器，复用其 CDP，不清缓存、不重开 profile。
- 已将 `src/auto/roxy_2fa_auth_login.js` 默认 authorize builder 改为与 `oauth_login.js` 同形态；生产 runner 实际目标为 `/oauth/authorize`，不含 `prompt=login`。
- 选择账号点击后通过新增等待守卫离开 `choose-account`，没有重复点击或触发状态机轮次超时。
- 网络结果：`/api/accounts/workspace/select` HTTP 200，`/oauth/token` HTTP 200；runner 返回 `oauth-completed`，CPA 文件三类 token 字段均非空。
- 本轮复用已认证会话，未再次触发 add-phone/SMS；不能把本轮当成新的手机验证码证据。此前干净流程已记录 `add-phone/send` 4xx 后继续 SMS 轮询并完成 phone-otp。
- 本轮仍绕过 `/replace-2fa` worker；随后已由 CPA worker 完成上传、auth-health 和数据库状态回写。

## 解决记录

- 账号 109 后续通过动作级 CDP 复用用户指定的 `617-3 / 3/test`，并使用与 `oauth_login.js` 同形态、无 `prompt=login` 的完整 authorize URL。
- 生产 2FA runner 成功返回 `oauth-completed`，`oauth/token` 返回 HTTP 200；随后 CPA worker 上传并复查为 `active`，账号状态更新为 `cpa_mounted`。
- 因此本 issue 不再阻塞账号 109 流程。旧出口连接重置作为环境风险保留；若复现，需重新记录出口和首个失败请求。此次验证调用了生产 worker 代码路径，未额外通过 HTTP 管理页面触发。
