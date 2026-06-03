# 2026-06-03 Roxy Codex callback 点击守卫

状态：done

## 背景

补号自动化日志显示 Codex 授权确认页点击 `Continue` 后，会停在“点击授权继续”较长时间。排查后确认原因是 `locator.click()` 等待导航或页面稳定，而 OAuth callback 指向本机 `localhost:1455`，可能已经触发 callback 请求但页面进入本机不可达或 chrome error 状态。

## 修改内容

- 修改 `src/auto/roxy_oauth_login.js`：
  - 新增 callback 信号等待逻辑，同时支持 `waitForRequest` 和当前 URL 轮询。
  - `codex_login` 点击前先监听 callback，点击时与 callback 捕获竞态。
  - 当前 URL 相对点击前发生变化，且 query/hash 中包含匹配本次 `state` 的 `code/state` 时，也判定为授权提交成功。
  - Codex 点击使用独立短超时，避免继续依赖默认 60 秒点击超时。
  - 点击后如果未捕获 callback，记录等待授权跳转并交回状态机继续识别。
  - `processOAuthLoginFlow` 在 Codex 点击后等待一次阶段变化，降低重复点击。
- 修改 `test/roxyOauthLogin.test.js`：
  - 新增 callback 请求先于点击完成被捕获的回归测试。
  - 新增 URL 变化且包含 `code/state` 时判定成功的回归测试。
  - 验证 Codex 阶段新增日志不泄露验证码。
- 新增 change：`docs/changes/CHG-026-roxy-codex-callback-click-guard.md`。

## 验证

- `node --check .\src\auto\roxy_oauth_login.js` 通过。
- `node --test .\test\roxyOauthLogin.test.js` 通过，51/51 pass。

## 后续

- 当前 `CHANGE_REGISTRY.md` 中 `implemented` 且未合并的 change 已超过 5 个，后续应合并到 `PRD-002` 基线。
