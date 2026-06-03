# 2026-06-03 Roxy token 交换 request context 优先

状态：done

## 背景

Roxy OAuth 自动化在 Codex 授权后已捕获 callback code，但 token 交换阶段通过 `page.evaluate()` 发请求。此时页面仍可能处于 callback 导航或 chrome error 导航过程中，导致浏览器执行上下文销毁并失败。

## 修改内容

- 修改 `src/auto/roxy_oauth_login.js`：
  - `exchangeToken` 优先使用 Playwright `request.post`。
  - 没有 request context 时才使用页面上下文。
  - 页面上下文销毁时回退到 fetch。
  - token 交换路径补充日志，明确当前使用 request、page context 还是 Node fetch。
- 修改 `test/roxyOauthLogin.test.js`：
  - 更新 token 交换优先级测试，确保 request context 优先于 page evaluate。
  - 新增页面上下文销毁后回退 fetch 的回归测试。
- 新增 change：`docs/changes/CHG-027-roxy-token-exchange-request-context-first.md`。

## 验证

- `node --test .\test\roxyOauthLogin.test.js` 通过，52/52 pass。

## 后续

- 当前 `CHANGE_REGISTRY.md` 中 `implemented` 且未合并的 change 已超过 5 个，后续应合并到 `PRD-002` 基线。
