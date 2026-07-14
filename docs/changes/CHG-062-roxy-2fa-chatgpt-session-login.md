# CHG-062 Roxy 2FA ChatGPT session 登录脚本

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

实录的 2FA 登录成功路径不是 Codex OAuth callback，而是 ChatGPT 登录入口：`chatgpt.com` 登录后跳转到 OpenAI password 页，提交 MFA 后直接回到 `chatgpt.com`。该路径不需要手机号接码，也不应复用注册脚本的大段流程。

## 变更内容

- 新增 `src/auto/roxy_2fa_login.js`。
- 新脚本使用 Roxy profile 打开 `https://chatgpt.com/`，处理 ChatGPT 登录入口、OpenAI 邮箱页、密码页、MFA 页。
- MFA 通过后等待 `chatgpt.com` 登录成功，再请求 `https://chatgpt.com/api/auth/session` 获取 `accessToken`。
- 将 session access token 保存为独立凭证文件，默认目录为 `src/auto/product_files/2fa_login/`。
- 仅复用已有 Roxy 开窗/关闭能力和必要的 2FA 检测/验证码生成能力，不复制注册脚本的完整注册流程。
- 新增 `test/roxy2FALogin.test.js` 覆盖真实录制得到的 ChatGPT 2FA session 路径。

## 验收标准

- [x] 新脚本名为 `src/auto/roxy_2fa_login.js`。
- [x] 登录路径走 ChatGPT session 登录，不走 Codex OAuth authorize 协议。
- [x] 密码页后进入 MFA，MFA 后直接以 ChatGPT 首页作为成功状态。
- [x] 不进入手机号添加、短信验证码或 Codex consent 流程。
- [x] 获取 `/api/auth/session` 后保存 access token，日志不输出 token 明文。

## 实现记录

实现日期：2026-07-03

- 新增 `processChatGpt2FALoginFlow()` 状态机。
- 新增 `fetchChatGptSession()` 和 `save2FALoginCredentialFile()`。
- 新增 CLI `run()` / `runCli()`，可直接运行 `node src/auto/roxy_2fa_login.js`。

补充实现日期：2026-07-07

- 修复 ChatGPT 游客首页误判登录态：只有 `/api/auth/session` 返回 `accessToken` 才判定 `chatgpt-home`。
- `Log in` 按钮存在时优先判定 `chatgpt-entry`；多个 `Log in` 按钮时点击第一个可见按钮。
- 每次页面动作完成后记录下一阶段：`动作后阶段识别 from=... stage=... url=...`。
- `fetchChatGptSession()` 改为优先页面内 `fetch()` 获取 session，避免成功后把可视页面导航到 `/api/auth/session`。
- 实机 run `431` 已完成 `chatgpt-entry -> openai-email -> openai-password -> openai-mfa -> chatgpt-home -> session saved`，最终页面保持在 `https://chatgpt.com/`。

## 回滚

删除 `src/auto/roxy_2fa_login.js` 和 `test/roxy2FALogin.test.js`，并从 change/work 索引移除本记录即可回滚。
