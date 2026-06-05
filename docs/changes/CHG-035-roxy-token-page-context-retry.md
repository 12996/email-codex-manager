# CHG-035 Roxy token exchange 浏览器上下文重试

状态：merged
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：`docs/issues/issue-005-roxy-token-fallback-exit-ip.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

实机日志显示，Roxy OAuth token exchange 在页面上下文 6 秒超时后默认回退到 Playwright `request`，OpenAI 返回 `unsupported_country_region_territory`。该 fallback 可能没有复用 Roxy 浏览器代理出口，导致正式换 token 的出口 IP 与登录浏览器出口不一致。

## 变更内容

- 正式 `exchangeToken()` 默认只走 Roxy 浏览器页面上下文。
- 页面上下文 token exchange 支持最多 3 次重试，单次默认 10000ms。
- 每次尝试记录 `attempt`、`maxAttempts`、`timeoutMs`、当前 URL、origin 与 token URL；失败日志记录同样上下文和诊断。
- 页面上下文 `fetch` 使用浏览器内 `AbortController` 按单次超时主动 abort，避免超时请求继续占用一次性 authorization code。
- 当前页面为 Chrome error、空白页或非 `auth.openai.com` origin 时，在同一 Roxy browser context 中复用或新建 `https://auth.openai.com/` 页面，并在该页面上下文发起同源 token 请求。
- `exchangeTokenWithRequest()` / `exchangeTokenWithFetch()` 保留为显式诊断能力；默认 `exchangeToken()` 不调用。诊断路径日志标记 `diagnosticOnly=true notBrowserProxy=true`。

## 验收标准

- [x] 页面上下文第一次、第二次超时，第三次成功时不会调用 request/fetch fallback。
- [x] 页面上下文三次失败后抛出明确错误，错误信息包含“浏览器上下文换取 Token 多次失败”。
- [x] 当前页为 `chrome-error://chromewebdata/` 时，会使用 `auth.openai.com` 页面上下文发起 token 请求。
- [x] 页面上下文单次 token fetch 超时时会收到 AbortSignal 并被 abort。
- [x] 默认单次页面上下文 token exchange 超时为 10000ms。
- [x] 现有 Roxy OAuth 回归测试保持通过。

## 验证

- RED：新增/调整测试在旧逻辑下失败，关键失败包含 `request fallback should not be used`、错误 code 未实现、Chrome error 页仍走 request fallback。
- GREEN：`npm test -- test/roxyOauthLogin.test.js`
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js`

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路；`issue-005` 保持 `active`，待实机验证后关闭。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-05
- 备注：已合并到正式 Token 交换默认仅使用 Roxy 浏览器页面上下文、重试、单次超时 abort 和诊断 fallback 非默认路径要求。
