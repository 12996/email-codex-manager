# issue-004 Roxy OAuth 手机验证码后跳转竞态

状态：active
发现日期：2026-06-05
关联文件：`src/auto/roxy_oauth_login.js`
关联日志：`data/automation-logs/replacement-10-2026-06-05T03-35-00-932Z.log`

## 现象

完整 `/replace` 实机运行中，`add-phone` 已成功进入 `phone-code`，脚本获取手机验证码、填写 `Code` 并点击 `Continue` 后，真实页面已经进入 Codex consent，但状态机下一轮仍短暂把旧 `phone-code` 页识别为可操作页。

随后脚本第二次执行 `openAi_phone_code()`，继续点击旧 `Code` 输入框，最终失败：

```text
locator.click: Timeout 30000ms exceeded.
element is not enabled
element was detached from the DOM
```

## 根因

`processOAuthLoginFlow()` 的 `phone-code` 分支只执行：

```text
await openAi_phone_code(page, actionOptions)
```

提交后没有像 `phone-add` 一样等待离开当前阶段，也没有消费 `openAi_phone_code()` 已支持返回的 `{ status: 'next-stage', next: ... }`。当 OpenAI 前端短暂保留旧验证码输入框或处于 disabled/loading/React 重建状态时，外层状态机会重复进入 `phone-code` 分支。

## 预期行为

- 手机验证码提交后，应等待页面离开当前 `phone-code` 阶段。
- 如果进入 `codex-login` 或 OAuth callback，应交回状态机继续后续流程。
- 如果输入框 wait/click/fill 或 Continue click 失败，但页面已经进入 Codex/callback，应复检并返回 `next-stage`，不要直接报错。
- 如果提交后持续停留在 `phone-code`，应以明确 transition timeout 失败，不应重复操作同一旧输入框。

## 修复记录（2026-06-05）

状态保持：`active`（自动化回归测试已覆盖，仍待完整 `/replace` 实机链路复验）。

- 新增回归测试：`processOAuthLoginFlow does not refill phone code while transitioning to Codex consent`。
- `phone-code` 提交后调用 `waitForStageTransition()` 时忽略当前 `phone-code` 阶段，等待 Codex/callback 等有效后续阶段。
- `processOAuthLoginFlow()` 现在记录并消费 `openAi_phone_code()` 返回的 `next-stage`。
- `openAi_phone_code()` 在验证码输入框 wait/click/fill 和 Continue click 失败时，会复检是否已进入 Codex/callback；命中则返回 `next-stage`。
- 新增日志标识手机验证码提交后等待跳转、捕获下一阶段和跳转检测结果。

## 自动化验证（2026-06-05）

```text
RED: npm test -- test/roxyOauthLogin.test.js
# fail 1
# error: Code input should not be clicked again during phone-code transition

GREEN: npm test -- test/roxyOauthLogin.test.js
# tests 58
# pass 58
# fail 0
```

## 待办

- 重新执行完整 `/replace` 实机链路，确认 `Add your phone number -> Check your phone -> Codex/callback -> token exchange` 通过后关闭本 issue。
