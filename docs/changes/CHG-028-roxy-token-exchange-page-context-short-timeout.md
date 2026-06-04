# CHG-028 Roxy token 交换页面上下文优先与短超时

状态：merged
创建日期：2026-06-03
关联 PRD：PRD-002
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

`CHG-027` 将 token 交换优先切到 Playwright request context 后，token 请求可能不走 Roxy 浏览器代理出口，OpenAI 返回 `unsupported_country_region_territory`。实际需要让 token 请求继续依赖浏览器页面上下文，以复用 Roxy 代理出口；同时避免原先页面导航导致的长时间等待。

## 变更

- `exchangeToken` 重新优先使用页面上下文 `page.evaluate(fetch(...))` 换 token。
- 页面换 token 前默认等待 6 秒，让 OAuth callback 导航稳定。
- 页面上下文换 token 使用 6 秒短超时，不再依赖 60 秒级等待。
- 页面上下文失败时才回退 request 或 fetch。
- 新增/保留日志：
  - `等待页面导航稳定后换 Token settleMs=...`
  - `使用页面上下文换 Token timeoutMs=...`
  - `页面上下文换 Token 失败，回退 request`
  - `页面上下文换 Token 失败，回退 fetch`

## 验收

- 有页面上下文时，token 交换优先使用页面上下文。
- 页面上下文换 token 前会短暂等待，默认 6 秒。
- 页面上下文换 token 自身有短超时，默认 6 秒。
- request/fetch 只作为页面上下文不可用或失败后的兜底。
- 现有 Roxy OAuth 单元测试保持通过。

## 验证

- `node --check .\src\auto\roxy_oauth_login.js`
- `node --test .\test\roxyOauthLogin.test.js`

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的 token 交换页面上下文优先、短等待和短超时要求。
