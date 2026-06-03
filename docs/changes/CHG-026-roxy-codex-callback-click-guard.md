# CHG-026 Roxy Codex 授权 callback 竞态守卫

状态：implemented
创建日期：2026-06-03
关联 PRD：PRD-002
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 自动化在 Codex 授权确认页点击 `Continue` 后，页面可能已经触发 `http://localhost:1455/auth/callback`，但 Playwright 的 `locator.click()` 仍等待导航或页面稳定，直到默认超时才进入成功兜底逻辑。该行为会让日志停在“点击授权继续”较长时间，并可能出现重复点击 Codex 授权页。

## 变更

- `codex_login` 在点击 `Continue` 前开始监听 OAuth callback 请求，同时轮询当前 URL。
- 当前 URL 如果相对点击前已变化，且 URL query/hash 中包含匹配本次 `state` 的 `code/state`，也判定为 OAuth callback 成功。
- Codex 授权点击使用独立短超时 `codexClickTimeoutMs`，默认不超过 8 秒。
- callback 等待使用 `codexCallbackWaitMs`，默认不超过 10 秒。
- 若点击过程中捕获 callback，请立即返回 `callbackReached: true`，不再等待 `click()` 走到长超时。
- 外层 `processOAuthLoginFlow` 在 Codex 点击后短暂等待页面阶段变化，降低重复点击概率。
- 新增日志：监听 callback、点击授权继续、点击完成、等待授权跳转、URL 变化但未含 `code/state`、URL 变化且包含 `code/state`、捕获 callback、等待超时交回状态机。

## 验收

- Codex 点击前会先启动 callback 监听。
- 点击过程中如果捕获 `localhost:1455/auth/callback` 请求，立即判定授权提交成功。
- 如果 callback 请求未被捕获，但页面 URL 已变化且包含匹配本次 `state` 的 `code/state`，也会判定授权提交成功。
- `chrome-error://chromewebdata/` 场景仍可通过 callback 请求提取授权码。
- 日志能定位 Codex 授权点击、callback 监听和捕获状态。
- 现有 Roxy OAuth 单元测试保持通过。

## 验证

- `node --check .\src\auto\roxy_oauth_login.js`
- `node --test .\test\roxyOauthLogin.test.js`
