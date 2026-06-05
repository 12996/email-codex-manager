# CHG-032 Roxy 添加手机号后跳转竞态守卫

状态：merged
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：`docs/issues/issue-002-roxy-add-phone-transition-race.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

完整 `/replace` 实机日志显示，Roxy OAuth 在 `Add your phone number` 页成功填写手机号并点击 `Continue` 后，页面短暂仍能识别为添加手机号页，随后进入 `Check your phone`。旧等待逻辑把同阶段 `phone-add` 当作阶段跳转成功，外层状态机下一轮重复执行 `openAi_phone_add()`，最终操作到 disabled/detached 的旧手机号输入框。

## 变更内容

- `phone-add` 提交后等待阶段跳转时忽略当前 `phone-add` 阶段。
- 只有检测到 `phone-code`、`phone-verify`、`codex` 或 OAuth callback 时才视为有效后续阶段。
- 如果提交后一直未离开添加手机号页，抛出 `OPENAI_PHONE_ADD_TRANSITION_TIMEOUT`，避免重复填写同一个手机号输入框。
- 新增回归测试覆盖“提交后短暂停留 add-phone，随后进入 phone-code，不重复填手机号”的竞态场景。

## 验收标准

- [x] 添加手机号提交后不会把同阶段 `phone-add` 当作成功跳转。
- [x] 页面延迟切换到 `phone-code` 时不会第二次填写手机号。
- [x] 持续停留在添加手机号页时以明确错误失败，而不是重复操作旧组件。
- [x] 现有邮箱验证码、手机验证码、Codex callback 流程测试保持通过。

## 验证

- RED：新增测试在旧逻辑下复现第二次 `phone.fill`。
- GREEN：`npm test -- test/roxyOauthLogin.test.js`
- 语法检查：`node --check .\src\auto\roxy_oauth_login.js`

## 未完成 / 风险

- 尚未重新执行完整 `/replace` 实机链路；`issue-002` 保持 `active`，待实机验证后关闭。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-05
- 备注：已合并到添加手机号提交后的阶段跳转守卫和明确超时失败要求。
