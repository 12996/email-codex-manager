# 2026-06-03 Roxy token 交换页面上下文优先与短超时

状态：done

## 背景

token 交换改为 request context 优先后，OpenAI token endpoint 返回 `unsupported_country_region_territory`。判断原因是 request/fetch 可能没有走 Roxy 浏览器代理出口。需要改回依赖页面上下文换 token，但移除 60 秒级等待。

## 修改内容

- 修改 `src/auto/roxy_oauth_login.js`：
  - `exchangeToken` 优先使用页面上下文 `page.evaluate(fetch(...))`。
  - 页面换 token 前默认等待 6 秒。
  - 页面上下文换 token 默认 6 秒短超时。
  - 页面上下文失败时才回退 request 或 fetch。
  - 增加 token 阶段日志，用于确认等待、页面上下文换 token、回退路径。
- 修改 `test/roxyOauthLogin.test.js`：
  - token 交换测试改为页面上下文优先。
  - 保留页面上下文失败后回退 fetch 的测试。
- `CHG-027` 标记为 `superseded`，新增 `CHG-028` 记录当前方案。

## 验证

- `node --check .\src\auto\roxy_oauth_login.js` 通过。
- `node --test .\test\roxyOauthLogin.test.js` 通过，52/52 pass。
