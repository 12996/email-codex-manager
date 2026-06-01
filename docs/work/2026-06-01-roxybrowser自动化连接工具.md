# 2026-06-01-RoxyBrowser 自动化连接工具

- 状态：done
- 目标：为后续自动化页面提供 RoxyBrowser 指纹浏览器连接工具。
- 修改文件：`src/auto/roxy-browser-client.cjs`、`src/auto/roxy_oauth_login.js`、`src/auto/package.json`、`test/roxyBrowserClient.test.js`、`test/roxyOauthLogin.test.js`、`.env.example`、`package.json`、`package-lock.json`、`docs/changes/`、`docs/work/`
- 验证结果：`npm test -- test/roxyBrowserClient.test.js`、`node --test test\roxyOauthLogin.test.js`、`npm test` 通过。
- 补充：未配置 `ROXY_BROWSER_DIR_ID` 时，可通过 `ROXY_BROWSER_SORT_NUM` 或 `ROXY_BROWSER_WINDOW_NAME` 自动查找窗口。
- 补充：新增 `src/auto/roxy_oauth_login.js`，用于复用 RoxyBrowser 客户端打开目标窗口并导航到 `https://chatgpt.com/`；可用命令行第一个参数覆盖 URL，默认断开 Playwright 连接但保持 Roxy 窗口打开。
- 未完成 / 风险：需要本机 RoxyBrowser API 服务、有效 `ROXY_API_BASE_URL`、`ROXY_API_TOKEN`、`ROXY_WORKSPACE_ID`，以及 `ROXY_BROWSER_DIR_ID` / `ROXY_BROWSER_SORT_NUM` / `ROXY_BROWSER_WINDOW_NAME` 三者之一才能连接真实窗口。
- 下一步：在具体补号自动化脚本中复用 `launchRoxyBrowser()`，拿到 `page` 后执行登录/验证码等业务步骤。
