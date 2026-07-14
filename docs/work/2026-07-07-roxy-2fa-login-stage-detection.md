# 2026-07-07 Roxy 2FA 登录阶段识别修复

## 目标

修复 `src/auto/roxy_2fa_login.js` 在 ChatGPT 游客首页误判登录态的问题，并让每次页面动作完成后都记录下一阶段识别结果。

## 过程

- 连接当前未关闭的 Roxy `cli` 窗口，确认页面为 `https://chatgpt.com/` 游客页。
- 页面证据：
  - 有多个 `Log in` 按钮。
  - 有 `#prompt-textarea` 和 `Message ChatGPT` 类文案。
  - `/api/auth/session` 返回 200，但没有 `accessToken`。
- 根因：
  - 旧的 `isChatGptLoggedInPage()` 只要看到 prompt 或 `message chatgpt/new chat` 就判定 `chatgpt-home`。
  - `fetchChatGptSession()` 通过 `page.goto('/api/auth/session')` 获取 session，成功后会把可视页面停在 session JSON 页面。
- 修复：
  - `chatgpt-home` 只有在页面内请求 `/api/auth/session` 且存在 `accessToken` 时才成立。
  - `Log in` 按钮存在时优先判定为 `chatgpt-entry`。
  - 多个 `Log in` 按钮时点击第一个可见按钮，避免 strict locator 问题。
  - 每次 `chatgpt-entry`、`openai-email`、`openai-password`、`openai-mfa`、`choose-account`、`chatgpt-callback` 动作完成后，日志记录 `动作后阶段识别 from=... stage=... url=...`。
  - `fetchChatGptSession()` 改为优先页面内 `fetch()` 获取 session，不再把浏览器导航到 `/api/auth/session`；只有无 `evaluate` 能力时才回退旧 `goto` 方式。

## 验证

- RED：新增游客页 prompt 误判、无 accessToken 不算登录、多 Log in 按钮、动作后阶段日志、session 获取不导航等回归测试，先失败于旧行为。
- GREEN：
  - `node --test test\roxy2FALogin.test.js` 通过，6/6。
  - `node --test test\roxy2FALogin.test.js test\replacementServices.test.js` 通过，31/31。
  - `node --check src\auto\roxy_2fa_login.js` 通过。
- 实机：
  - 通过账号 `75` 触发 `login-2fa`，run `431` 成功。
  - 日志确认路径：`chatgpt-entry -> openai-email -> openai-password -> openai-mfa -> chatgpt-home -> session saved`。
  - 结束后 Roxy 页面保持在 `https://chatgpt.com/`，不再停在 `/api/auth/session`。

## 注意

- 实机日志中有一次 `openai-password -> unknown` 后再次识别并提交密码，最终成功进入 MFA。后续如果该现象频繁出现，可继续调长 password 后阶段等待窗口或增加按钮启用/提交成功判定。
