# 2026-06-05 Roxy token exchange 浏览器上下文重试

- 目标：移除正式 token exchange 默认 request/fetch fallback，避免页面上下文失败后切换到非 Roxy 浏览器出口 IP。
- 关联 issue：`docs/issues/issue-005-roxy-token-fallback-exit-ip.md`
- 关联 change：`docs/changes/CHG-035-roxy-token-page-context-retry.md`
- 修改文件：`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`docs/issues/`、`docs/changes/`、`docs/work/`
- 结果：
  - `exchangeToken()` 默认只走 Roxy 浏览器页面上下文，不再默认回退 Playwright `request` / Node `fetch`。
  - 页面上下文 token exchange 改为最多 3 次重试，单次默认 10000ms。
  - 页面上下文 `fetch` 增加浏览器内 `AbortController`，单次超时会 abort 当前请求，避免上一轮迟到请求和后续 retry 产生一次性 authorization code 重复兑换竞态。
  - token attempt/failure 日志包含 attempt、maxAttempts、timeoutMs、当前 URL、origin、token URL 和诊断。
  - 当前页为 Chrome error、空白页或非 `auth.openai.com` origin 时，使用同一 browser context 新建或复用 auth 页面，并通过 `fetch('/oauth/token', ...)` 发起同源请求。
  - request/fetch helper 保留为显式诊断路径，默认关闭。
- 验证：
  - RED：`npm test -- test/roxyOauthLogin.test.js` 失败 4 项，证明旧逻辑仍使用 request/fetch fallback、无三次失败错误、Chrome error 页未切到 auth 页面。
  - GREEN：`npm test -- test/roxyOauthLogin.test.js` 通过，59/59 pass。
  - `node --check .\src\auto\roxy_oauth_login.js` 通过。
- 未完成 / 风险：
  - 尚未重新执行完整 `/replace` 实机链路；`issue-005` 保持 `active`，待实机验证 `Codex/callback -> auth token exchange -> CPA JSON` 后关闭。
