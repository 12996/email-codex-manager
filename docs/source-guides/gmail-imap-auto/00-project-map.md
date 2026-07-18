# `src/auto` 项目地图

## 简短介绍
- 项目类型：Node.js + Playwright Core + RoxyBrowser 本地 API。
- 主要职责：连接/启动 Roxy profile，使用真实浏览器上下文完成 OpenAI OAuth/注册/验证码/Session/MFA 流程，并把结果导出为账号 Token 文件。
- 本次检查范围：`F:\\work\\email\\gmail_IMAP\\src\\auto`，以及其父项目的验证码服务接口。
- 建议最先阅读的功能：Roxy CDP 连接层，其它注册和 OAuth 流程都建立在它返回的 `page/context/browser` 之上。

## 功能分组
### Roxy API 与 CDP 连接
- 它做什么：调用 `/browser/list`、`/browser/open`、`/browser/connection_info` 等接口，清理缓存、随机指纹、打开 profile，再通过 CDP 接入 Playwright。
- 入口证据：
  - `src/auto/roxy-browser-client.cjs:78-328`
  - `src/auto/roxy_oauth_login.js:1288-1383`
- 置信度：high

### OpenAI OAuth / 注册自动化
- 它做什么：导航 ChatGPT/OpenAI 页面，填写邮箱/密码，识别 OTP、密码、资料页和异常页，完成注册后访问 `/api/auth/session` 获取 access token。
- 入口证据：
  - `src/auto/roxy_register_openai.js:2060-2169`
  - `src/auto/roxy_register_openai.js:2413-2649`
  - `src/auto/roxy_register_openai.js:2651-2706`
- 置信度：high

### 浏览器上下文 Token 交换
- 它做什么：优先在 `auth.openai.com` 的 Roxy 页面上下文中调用 OAuth token endpoint，而不是默认使用 Node request/fetch。
- 入口证据：
  - `src/auto/roxy_oauth_login.js:1407-1483`
  - `src/auto/roxy_oauth_login.js:1530-1650`
- 置信度：high

### Gmail/IMAP 验证码服务
- 它做什么：父项目提供 `POST /api/verification-code/latest`，按邮箱获取最新验证码；验证码解析逻辑集中在 `verificationCodeCore.cjs`。
- 入口证据：
  - `src/server.js:90-102`
  - `src/verificationCodeCore.cjs:11-100`
  - `src/auto/roxy_register_openai.js:894-968`
- 置信度：high

### 异常恢复与诊断
- 它做什么：处理连接关闭、Operation timed out、空白页、auth/error、截图和 CDP 复用。
- 入口证据：
  - `src/auto/roxy_register_openai.js:2171-2410`
  - `src/auto/roxy_oauth_login.js:1322-1401`
- 置信度：high

## 推荐阅读顺序
1. `roxy-browser-client.cjs`：确认 Roxy API、profile 和 CDP 的边界。
2. `roxy_oauth_login.js`：确认浏览器上下文中的 OAuth 与 Token 交换。
3. `roxy_register_openai.js`：确认注册页状态机、OTP 和 Session 提取。
4. 父项目验证码服务：确认 Python 协议项目如何复用 OTP。

## Unconfirmed Points
- `roxy_register_openai.js` 通过 `optionalRequire` 引用了多个当前目录中不存在的模块，例如 `imap-auth.js`、`pool-email-imap.js`、`inbox-email.js`、`local-proxy-bridge.js`、`mysql-store.js` 和 `lib/california-fingerprint`；缺失时会静默使用 fallback，可能是自动化不稳定的原因之一。
- 父项目 `package.json` 明确依赖 `playwright-core`，但没有明确声明部分可选的 stealth/fingerprint/代理模块；需要以实际运行日志确认当前走的是完整实现还是 fallback。
- 实测 Roxy API `http://127.0.0.1:50000` 与窗口序号 `8` 的 profile 可以正常通过 CDP 连接，并能读取真实页面指纹和出口 IP；Roxy API 返回的 `proxyInfo` 直接交给 `curl_cffi` 会出现 SOCKS5 握手失败，因此当前协议项目不直接复用该字段作为代理。
