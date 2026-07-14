# CHG-081 Roxy 2FA 邮箱提交后阶段判定竞态修复

状态：implemented
创建日期：2026-07-14
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-011-roxy-2fa-post-email-stage-race.md`
影响范围：`src/auto/roxy_2fa_auth_login.js`、`test/roxy2FAAuthLogin.test.js`、2FA 补号运行日志

## 背景

OpenAI 页面可能在阶段等待窗口的最后一次等待期间才完成导航。旧 2FA 状态机在等待超时后直接把页面归类为 `unknown`，导致已经进入 password 页的账号被错误终止。

## 变更内容

- 修改邮箱提交、password 提交和 MFA 提交后的等待逻辑：超时边界增加一次即时状态复查，避免漏掉刚完成的页面导航。
- 修改 password/MFA 页面判定：输入框除可见外，还必须可用；优先检查 Playwright `isEnabled()` 和 `isEditable()`。
- 修改 2FA 失败日志：输出 URL、标题和最多 300 个字符的页面摘要，不输出密码、验证码或 token。
- 新增临界竞态和 disabled 输入框回归测试。

## 验收标准

- [x] 邮箱提交后在最后一次等待期间进入 password 页时，继续 2FA 状态机而不是抛出 `OPENAI_2FA_POST_EMAIL_STAGE_UNKNOWN`。
- [x] password/MFA 阶段不会把 visible 但 disabled/readOnly 的过渡输入框当成可操作阶段。
- [x] password、MFA、邮箱验证码、手机号和 Codex 后续流程的既有测试保持通过。
- [x] 失败日志能提供页面状态证据，且不记录密码、验证码或 token 明文。
- [x] 全量 JavaScript 测试通过。

## 实现记录

- 根因证据：run `465` 失败后 Roxy 页面实际位于 `https://auth.openai.com/log-in/password`，页面标题为 `Enter your password - OpenAI`。
- 回归测试先验证失败，再实现最终复查和输入可用性守卫。

## 回滚

回滚 `src/auto/roxy_2fa_auth_login.js`、`test/roxy2FAAuthLogin.test.js` 和本 change 对应文档即可；不涉及数据库迁移或账号状态数据。
