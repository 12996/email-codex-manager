# CHG-033 Roxy OAuth callback CDP fallback

状态：implemented
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：`docs/issues/issue-003-roxy-callback-chrome-error-url.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

Roxy OAuth 在 Codex 授权后会跳转到 `localhost:1455/auth/callback`。由于本地通常没有服务监听该端口，Chrome 会显示 `ERR_CONNECTION_REFUSED` 错误页。此时 Playwright `page.url()` 可能变成 `chrome-error://chromewebdata/`，但 CDP navigation history 和 target URL 仍保存完整 callback URL。旧逻辑没有读取这些 CDP 元数据，导致状态机超时。

## 变更内容

- 新增 `getCurrentOAuthCallback()` 的 CDP fallback：
  - 保留原有 `page.url()` 解析。
  - 当 `page.url()` 为 Chrome error 页时，尝试读取 `Page.getNavigationHistory()`。
  - 如果 navigation history 未命中，再读取 `Target.getTargets()`。
- 新增安全解析：仅接受包含 `localhost:1455/auth/callback`、存在 `code/state` 且 `state` 匹配本次请求的 URL。
- 新增日志：
  - `检测到 Chrome error 页，尝试 CDP callback fallback`
  - `通过 CDP navigation history 捕获 OAuth callback`
  - `通过 CDP target URL 捕获 OAuth callback`
- 新增回归测试覆盖 Chrome error 页下从 CDP navigation history 提取 callback。

## 验收标准

- [x] `page.url()` 为 `chrome-error://chromewebdata/` 时仍能从 CDP navigation history 提取 callback。
- [x] 提取 callback 后继续执行 token exchange。
- [x] callback `state` 必须匹配本次 OAuth 请求。
- [x] 现有 request callback、URL callback、Codex 授权流程不受影响。

## 验证

- RED：新增测试在旧逻辑下失败为 `OAUTH_FLOW_TIMEOUT`。
- GREEN：`npm test -- test/roxyOauthLogin.test.js`
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js`

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路；`issue-003` 保持 `active`，待实机验证后关闭。
