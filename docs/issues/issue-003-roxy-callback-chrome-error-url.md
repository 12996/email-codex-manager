# issue-003 Roxy OAuth callback 在 Chrome error 页下未被识别

状态：active
发现日期：2026-06-05
关联文件：`src/auto/roxy_oauth_login.js`
关联日志：`data/automation-logs/replacement-9-2026-06-05T02-58-20-694Z.log`

## 现象

完整 `/replace` 实机运行中，Codex 授权点击完成后，浏览器地址栏已经进入：

```text
http://localhost:1455/auth/callback?code=...&state=...
```

页面显示 `localhost refused to connect`，但脚本日志显示：

```text
phase=codex-login action=授权跳转等待超时，交回状态机继续识别
phase=oauth-flow action=等待 Codex 授权后页面跳转
roxy_oauth_login 失败: OAuth 登录状态机未在限定轮次内完成
```

## 根因

Chrome 导航到未监听的 `localhost:1455/auth/callback` 后会显示错误页。此时：

- 地址栏 / CDP navigation history / CDP target URL 保留完整 callback URL。
- Playwright `page.url()` 返回 `chrome-error://chromewebdata/`。

旧逻辑只通过 callback request 与 `page.url()` 识别 OAuth callback，没有读取 Chrome error 页下的 CDP 导航历史或 target URL，因此漏掉已经完成的 OAuth callback。

## 预期行为

当 `page.url()` 是 `chrome-error://chromewebdata/` 时，脚本应通过 CDP fallback 读取：

- `Page.getNavigationHistory()`
- `Target.getTargets()`

并从中提取匹配本次 `state` 的 `localhost:1455/auth/callback?...code=...&state=...`，继续 token exchange。

## 修复记录（2026-06-05）

状态保持：`active`（自动化回归测试已覆盖，仍待 `/replace` 实机链路复验）。

- 新增 CDP callback fallback：
  - 优先读取当前 navigation history entry。
  - 再倒序检查 navigation history entries。
  - 最后检查 page target URL。
- 新增日志：
  - 检测到 Chrome error 页时记录正在尝试 CDP fallback。
  - 从 CDP navigation history 或 target URL 捕获 callback 时记录来源。
- 新增回归测试：`processOAuthLoginFlow extracts callback code from CDP navigation history on chrome-error page`。

## 自动化验证（2026-06-05）

```text
npm test -- test/roxyOauthLogin.test.js
# tests 57
# pass 57
# fail 0

node --check .\src\auto\roxy_oauth_login.js
```

## 待办

- 重新执行完整 `/replace` 实机链路，确认 Codex callback 进入 token exchange 并成功生成 CPA JSON 后关闭本 issue。
