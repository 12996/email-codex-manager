# issue-005 Roxy token exchange fallback 出口 IP 不一致

状态：active
发现日期：2026-06-05
关联文件：`src/auto/roxy_oauth_login.js`
关联日志：实机 Roxy OAuth token exchange 日志

## 现象

完整 Roxy OAuth 实机链路中，`exchangeToken()` 先在页面上下文调用 `https://auth.openai.com/oauth/token`。页面上下文 6 秒超时后，旧逻辑默认回退到 Playwright `request` 或 Node `fetch`。

回退请求收到 OpenAI 返回：

```text
unsupported_country_region_territory
```

## 根因

页面上下文请求走 Roxy 浏览器出口；Playwright `request` / Node `fetch` 不一定复用同一 Roxy 浏览器代理出口。默认 fallback 可能把 token exchange 从浏览器出口切到本机或其他网络出口，触发 OpenAI 地区限制。

## 预期行为

- 正式 token exchange 默认只使用 Roxy 浏览器页面上下文。
- 页面上下文失败时不要默认回退 Playwright `request` 或 Node `fetch`。
- 页面上下文 token exchange 最多重试 3 次，单次默认 10000ms。
- 当前页为 `chrome-error://chromewebdata/`、空白页或非 `auth.openai.com` origin 时，使用同一 Roxy browser context 新建或复用 `https://auth.openai.com/` 页面，再在浏览器上下文执行同源 token 请求。
- 每次尝试和失败日志包含 attempt、maxAttempts、timeoutMs、当前 URL/origin/token URL 与诊断信息。

## 修复记录（2026-06-05）

状态保持：`active`（自动化回归测试已覆盖，仍待完整 `/replace` 实机链路复验）。

- `exchangeToken()` 默认路径改为浏览器页面上下文，不再默认调用 `exchangeTokenWithRequest()` / `exchangeTokenWithFetch()`。
- 新增页面上下文 token exchange 重试，默认 `maxAttempts=3`、`timeoutMs=10000`。
- 页面上下文 `fetch` 现在使用浏览器内 `AbortController`，单次超时时会 abort 当前 token 请求，避免上一轮迟到请求与后续 retry 重复兑换同一个 authorization code。
- 非 `auth.openai.com` 页面会在同一 browser context 中复用或新建 auth 页面，并通过 `fetch('/oauth/token', ...)` 发起同源请求。
- 非浏览器上下文 request/fetch 仅保留为显式诊断开关，默认关闭，并记录 `diagnosticOnly=true notBrowserProxy=true`。
- 新增回归测试覆盖两次超时第三次成功、三次失败抛错、页面 fetch timeout abort、Chrome error 页切换到 auth 页面上下文。

## 自动化验证（2026-06-05）

```text
RED: npm test -- test/roxyOauthLogin.test.js
# fail 4
# 关键失败：request fallback should not be used；OPENAI_TOKEN_PAGE_EXCHANGE_FAILED 尚未实现；chrome-error 页仍走 request fallback。

GREEN: npm test -- test/roxyOauthLogin.test.js
# tests 59
# pass 59
# fail 0
```

## 待办

- 重新执行完整 `/replace` 实机链路，确认 `Codex/callback -> auth.openai.com 页面上下文 token exchange -> CPA JSON` 通过后关闭本 issue。
