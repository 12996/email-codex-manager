# CHG-027 Roxy token 交换优先使用 request context

状态：superseded
创建日期：2026-06-03
关联 PRD：PRD-002
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 自动化在捕获授权码后，`exchangeToken` 优先通过 `page.evaluate()` 在页面上下文中发起 token 请求。OAuth callback 触发后页面可能仍在导航，导致 Playwright 报错：`Execution context was destroyed, most likely because of a navigation`，使 token 交换失败。

## 变更

- `exchangeToken` 优先使用 Playwright `request.post` 换取 token。
- 仅在没有 request context 时才使用 `page.evaluate()`。
- 如果 `page.evaluate()` 遇到页面上下文销毁、页面关闭或 frame detached，自动回退到 request/fetch 链路。
- 新增 token 阶段日志：
  - `使用 Playwright request 换 Token`
  - `使用页面上下文换 Token`
  - `page.evaluate 上下文销毁，回退 request/fetch`
  - `使用 Node fetch 换 Token`

## 验收

- 有 Playwright request context 时，不再使用 `page.evaluate()` 换 token。
- 页面上下文销毁时，可以回退到 fetch 并继续完成 token 交换。
- token 交换路径有明确日志可定位。
- 现有 Roxy OAuth 单元测试保持通过。

## 验证

- `node --test .\test\roxyOauthLogin.test.js`

## 替代记录

- 替代 change：`CHG-028-roxy-token-exchange-page-context-short-timeout.md`
- 替代日期：2026-06-03
- 原因：request context 可能不走 Roxy 浏览器代理出口，导致 OpenAI token endpoint 返回 `unsupported_country_region_territory`。后续改为页面上下文优先，并使用短等待/短超时避免长时间卡住。
