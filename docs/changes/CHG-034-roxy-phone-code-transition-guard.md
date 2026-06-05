# CHG-034 Roxy 手机验证码后跳转竞态守卫

状态：merged
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：`docs/issues/issue-004-roxy-phone-code-transition-race.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

完整 `/replace` 实机日志显示，Roxy OAuth 在 `Check your phone` 页成功填写手机验证码并点击 `Continue` 后，真实页面已经进入 Codex consent；但外层状态机下一轮短暂仍将旧 `phone-code` 页识别为可操作页，导致第二次执行 `openAi_phone_code()` 并点击 disabled/detached 的旧 `Code` 输入框。

## 变更内容

- `phone-code` 提交后等待阶段跳转时忽略当前 `phone-code` 阶段。
- 如果 `openAi_phone_code()` 返回 `{ status: 'next-stage', next: 'codex-login' | 'callback' }`，外层状态机记录并交回后续流程。
- 验证码输入框 wait/click/fill 或 Continue click 失败后，先复检 Codex/callback；已进入后续阶段时返回 `next-stage`，避免把旧组件异常当作真实失败。
- 新增回归测试覆盖“提交手机验证码后短暂仍识别为 phone-code，随后进入 Codex，不重复填写/点击 Code”的竞态场景。

## 验收标准

- [x] 手机验证码提交后不会把同阶段 `phone-code` 当作成功跳转。
- [x] 页面延迟切换到 Codex consent 时不会第二次填写或点击 `Code` 输入框。
- [x] `openAi_phone_code()` 捕获到 Codex/callback 时，外层状态机能继续处理后续流程。
- [x] 输入框或 Continue 操作失败时，若页面已进入 Codex/callback，则返回 `next-stage` 而不是直接抛错。
- [x] 现有 Roxy OAuth 回归测试保持通过。

## 验证

- RED：新增测试在旧逻辑下失败，错误为 `Code input should not be clicked again during phone-code transition`。
- GREEN：`npm test -- test/roxyOauthLogin.test.js`
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js`

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路；`issue-004` 保持 `active`，待实机验证后关闭。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-05
- 备注：已合并到手机验证码提交期间的页面状态守卫和避免重复操作旧组件要求。
