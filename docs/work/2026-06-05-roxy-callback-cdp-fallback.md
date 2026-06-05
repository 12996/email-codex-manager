# 2026-06-05 Roxy OAuth callback CDP fallback

- 目标：修复 Codex 授权后浏览器已到 callback 地址栏但 Playwright `page.url()` 返回 `chrome-error://chromewebdata/`，导致 OAuth 状态机超时的问题。
- 关联 issue：`docs/issues/issue-003-roxy-callback-chrome-error-url.md`
- 关联 change：`docs/changes/CHG-033-roxy-callback-cdp-fallback.md`
- 修改文件：`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`docs/issues/`、`docs/changes/`、`docs/work/`
- 结果：
  - 新增 CDP fallback：Chrome error 页下读取 `Page.getNavigationHistory()` 和 `Target.getTargets()`。
  - 仅接受包含 `localhost:1455/auth/callback` 且 `state` 匹配本次 OAuth 的 URL。
  - 新增日志记录 fallback 尝试与捕获来源。
  - 新增回归测试覆盖 `chrome-error://chromewebdata/` 下从 CDP navigation history 提取 callback。
- 验证：
  - RED：新增测试在旧逻辑下失败为 `OAUTH_FLOW_TIMEOUT`。
  - `npm test -- test/roxyOauthLogin.test.js` 通过，57/57 pass。
  - `node --check .\src\auto\roxy_oauth_login.js` 通过。
- 未完成 / 风险：
  - 尚未重新执行完整 `/replace` 实机链路；`issue-003` 保持 `active`，待确认 token exchange 和 CPA JSON 生成后关闭。
