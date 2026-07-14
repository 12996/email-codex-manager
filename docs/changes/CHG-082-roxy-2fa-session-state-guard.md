# CHG-082 Roxy 2FA ChatGPT session 状态判定加固

状态：implemented
创建日期：2026-07-15
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-012-roxy-2fa-session-state-guard.md`
影响范围：`src/auto/roxy_2fa_login.js`、`test/roxy2FALogin.test.js`、2FA 登录运行状态和 session 获取

## 背景

`src/auto/roxy_2fa_login.js` 负责 ChatGPT 入口、OpenAI password/MFA 和 ChatGPT session 凭证保存。现有代码与 OAuth 主状态机的稳态判定规则不完全一致，在页面竞态、控件过渡态和 session 请求失败时可能误判。

## 变更内容

- 阶段等待结束后增加一次最终即时复查。
- 登录按钮、邮箱、密码、MFA 和 Continue 控件在操作前检查可见和可用状态；输入框额外检查 `isEditable()`，并排除 `aria-disabled` / `inert`。
- OpenAI 邮箱阶段检测改用可用输入框判定，避免 disabled 邮箱控件触发填写动作。
- page 已支持 `evaluate` 时，session 请求失败不再导航当前页面到 `/api/auth/session`；无 `evaluate` 时才保留旧 fallback。
- callback URL 从字符串包含判断改为严格匹配 ChatGPT origin/path。
- 导出 `waitForKnownStage` 和 `isChatGptLoginEntryPage` 供状态机回归测试直接验证。

## 验收标准

- [x] 阶段在等待窗口最后一次等待期间完成导航时，不返回过时的 `unknown`。
- [x] disabled/readOnly/不可编辑的登录控件不会触发点击或填写。
- [x] page-context session 无 token 时不导航可视页面。
- [x] 非 `https://chatgpt.com/api/auth/callback/openai` 的 URL 不会被识别为 ChatGPT callback。
- [x] 原有 ChatGPT -> OpenAI email -> password -> MFA -> session 路径保持通过。

## 实现记录

- 参考 `src/auto/roxy_oauth_login.js` 的阶段轮询、提交后重新识别和页面上下文请求原则。
- 新增回归测试覆盖超时边界、session 导航、disabled 控件和 callback origin。

## 回滚

回滚 `src/auto/roxy_2fa_login.js`、`test/roxy2FALogin.test.js` 及本 change 文档即可；不涉及数据库迁移或凭证数据格式变化。
