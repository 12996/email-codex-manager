# 2026-06-05 Roxy 手机验证码后跳转竞态修复

- 目标：修复完整 `/replace` 中手机验证码提交后因页面跳转延迟导致重复填写/点击 `Code` 输入框的问题。
- 关联 issue：`docs/issues/issue-004-roxy-phone-code-transition-race.md`
- 关联 change：`docs/changes/CHG-034-roxy-phone-code-transition-guard.md`
- 修改文件：`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`docs/issues/`、`docs/changes/`、`docs/work/`
- 结果：
  - 记录 issue-004，保留失败日志入口。
  - 新增回归测试：`phone-code` 提交后短暂仍识别为 `phone-code`，随后进入 Codex consent，状态机不应第二次填写/点击 `Code`。
  - `phone-code` 提交后等待阶段跳转时忽略当前 `phone-code` 阶段，避免重复操作 disabled/detached 旧输入框。
  - `openAi_phone_code()` 在输入框 wait/click/fill 和 Continue click 失败后复检 Codex/callback，命中则返回 `next-stage`。
  - 外层状态机记录并消费 `openAi_phone_code()` 返回的 `next-stage`。
- 验证：
  - RED：新增测试在旧逻辑下失败，错误为 `Code input should not be clicked again during phone-code transition`。
  - `npm test -- test/roxyOauthLogin.test.js` 通过，58/58 pass。
  - `node --check .\src\auto\roxy_oauth_login.js` 通过。
- 未完成 / 风险：
  - 尚未重新执行完整 `/replace` 实机链路；`issue-004` 保持 `active`，待实机验证 `Add your phone number -> Check your phone -> Codex/callback -> token exchange` 后关闭。
