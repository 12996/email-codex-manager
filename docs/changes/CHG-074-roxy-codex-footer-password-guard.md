# CHG-074 Roxy Codex 页脚密码页误判防护

状态：implemented
创建日期：2026-07-07
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-009-roxy-codex-footer-password-misclassification.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

OpenAI 新版 password 页页脚包含 Codex 相关说明。旧的 Codex consent 判断只看 `codex`、`chatgpt` 和 `Continue`，导致 2FA 补号邮箱提交后把 password 页误判为 `codex-login`，没有进入密码填写阶段。

## 变更内容

- 修改：
  - Codex consent 判定必须匹配授权确认语义：`sign in to codex`、`continue to codex` 或 `authorize codex`。
  - Codex consent 判定显式排除 `/log-in/password`、`Enter your password`、`Forgot password?`。
  - 新增回归测试覆盖 password 页页脚包含 Codex 文案时不能命中 Codex consent。

## 验收标准

- [x] password 页页脚包含 Codex 文案时，不得被识别为 Codex consent。
- [x] 真实 Codex consent 页仍可被识别并点击 Continue。
- [x] 2FA 专用状态机在当前 password 页仍能识别密码阶段。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：尚未合并。
