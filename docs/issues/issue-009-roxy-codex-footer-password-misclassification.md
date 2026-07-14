# issue-009 Roxy 2FA 补号密码页被 Codex 页脚误判

状态：resolved

## 现象

- 用户保留的 Roxy `mac` 窗口停在 `https://auth.openai.com/log-in/password`，标题为 `Enter your password - OpenAI`。
- 页面中密码输入框可见且可用，但 2FA 补号自动化没有进入填写密码动作，前一次运行在邮箱输入阶段超时。

## 复现

1. 触发 `replacement-2fa` 账号 `78`。
2. OpenAI 邮箱提交后页面进入新版 password 页。
3. password 页页脚包含 `Your ChatGPT training controls apply to Codex` 和 `data Codex receives`。

## 期望 / 实际

- 期望：password 页必须被识别为密码阶段，填写补号账号数据库密码并继续 MFA。
- 实际：通用 `is_codex_login_page()` 只要求页面包含 `codex`、`chatgpt` 和 `Continue`，把 password 页页脚误判为 Codex consent，导致状态机没有进入密码填写。

## 排查

- 当前页面证据：URL 为 `/log-in/password`，body 主体为 `Enter your password / Email address / Password / Continue`，输入框元数据显示 `input[type=password][name=current-password]` 可见、非 disabled、非 readonly。
- 日志证据：`data/automation-logs/replacement-2fa-78-2026-07-07T10-31-07-375Z.log` 中邮箱提交后记录 `next=codex-login`，随后误回到邮箱登录分支并尝试填 readonly 邮箱字段。
- 根因：Codex consent 检测匹配了 password 页脚中的通用 Codex 文案，没有要求页面主体出现 `Sign in to Codex` 等授权确认语义，也没有排除 password 页。

## 修复

- `src/auto/roxy_oauth_login.js` 的 `is_codex_login_page()`：
  - 显式排除 `/log-in/password`、`Enter your password`、`Forgot password?`。
  - 要求标题或正文出现 `sign in to codex` / `continue to codex` / `authorize codex`，且包含 `chatgpt`。
- `test/roxyOauthLogin.test.js` 新增 password 页脚包含 Codex 文案时不能识别为 Codex consent 的回归测试。

## 验证

- RED：新增测试先失败于 `true !== false`。
- GREEN：
  - `node --test test\roxyOauthLogin.test.js` 通过，76/76。
  - `node --test test\roxy2FAAuthLogin.test.js` 通过，11/11。
  - `node --check src\auto\roxy_oauth_login.js` 通过。
- 实机状态复检：当前 Roxy password 页上，修复后 `is_codex_login_page=false`，2FA 专用 `is_openai_password_page=true`。
