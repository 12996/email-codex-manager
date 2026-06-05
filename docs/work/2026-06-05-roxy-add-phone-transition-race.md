# 2026-06-05 Roxy 添加手机号后跳转竞态修复

- 目标：修复完整 `/replace` 中 `Add your phone number` 提交后因页面跳转延迟导致重复填写手机号的问题。
- 关联 issue：`docs/issues/issue-002-roxy-add-phone-transition-race.md`
- 关联 change：`docs/changes/CHG-032-roxy-add-phone-transition-guard.md`
- 修改文件：`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`、`docs/issues/`、`docs/changes/`、`docs/work/`
- 结果：
  - 记录 issue-002，保留失败日志和截图入口。
  - 新增回归测试：`phone-add` 提交后短暂仍是 `phone-add`，随后进入 `phone-code`，状态机不应第二次填写手机号。
  - `waitForStageTransition()` 支持忽略当前阶段；`phone-add` 提交后忽略同阶段 `phone-add`，等待有效后续阶段。
  - 若提交后一直未离开添加手机号页，抛出 `OPENAI_PHONE_ADD_TRANSITION_TIMEOUT`，避免重复操作 disabled/detached 旧组件。
- 验证：
  - RED：新增测试在旧逻辑下出现两次 `phone.fill`。
  - `npm test -- test/roxyOauthLogin.test.js` 通过，56/56 pass。
  - `node --check .\src\auto\roxy_oauth_login.js` 通过。
- 未完成 / 风险：
  - 尚未重新执行完整 `/replace` 实机链路；`issue-002` 保持 `active`，待实机验证 `Add your phone number -> Check your phone -> Codex/callback` 后关闭。
