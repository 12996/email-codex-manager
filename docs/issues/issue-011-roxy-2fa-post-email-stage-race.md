# issue-011 Roxy 2FA 邮箱提交后阶段识别竞态

状态：resolved

## 现象

- 2FA 补号提交 OpenAI 邮箱后，日志连续记录 `next=unknown`，随后直接失败。
- 失败运行：`data/automation-logs/replacement-2fa-87-2026-07-14T14-51-29-644Z.log`，run `465`。

## 复现

1. 触发补号账号的 2FA OAuth 登录。
2. 邮箱页点击 Continue，OpenAI 页面在 loading 状态期间渲染 password 页。
3. 页面刚好在阶段等待窗口的最后一次等待期间完成导航。

## 期望 / 实际

- 期望：邮箱提交后识别到可用 password 页，继续填写密码和 MFA。
- 实际：阶段等待函数在超时边界直接返回 `unknown`，2FA 状态机没有最终复查就抛出 `OPENAI_2FA_POST_EMAIL_STAGE_UNKNOWN`。

## 排查

- 失败后保留的 Roxy 页面实时证据：URL 为 `https://auth.openai.com/log-in/password`，标题为 `Enter your password - OpenAI`。
- 页面密码输入框实际可见、可用；因此不是 OpenAI 没有进入 password 页，而是状态判断错过了最后一次渲染。
- 旧 2FA 检测只判断输入框可见，不排除 disabled/readOnly 过渡控件，存在相邻阶段误判风险。

## 修复

- `src/auto/roxy_2fa_auth_login.js`：邮箱提交、密码提交和 MFA 提交的等待窗口结束后增加一次最终即时阶段复查。
- password/MFA 阶段只接受可见且可用的输入框：检查 `isEnabled()` 和 `isEditable()`（测试替身未提供时保持兼容）。
- 2FA 失败日志增加 URL、标题和截断页面摘要，方便从进度窗口定位实际阶段。

## 验证

- RED：临界等待竞态测试失败于 `OPENAI_2FA_POST_EMAIL_STAGE_UNKNOWN`。
- RED：disabled password 输入框测试失败于 `true !== false`。
- GREEN：`node --test test/roxy2FAAuthLogin.test.js` 通过，13/13。
- GREEN：全量 JavaScript 测试 `node --test test/*.test.js` 通过，346/346。
- `node --check src/auto/roxy_2fa_auth_login.js`、`node --check test/roxy2FAAuthLogin.test.js` 和 `git diff --check` 通过。
