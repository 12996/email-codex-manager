# issue-002 Roxy OAuth 添加手机号后跳转竞态

状态：active
发现日期：2026-06-05
关联文件：`src/auto/roxy_oauth_login.js`
关联日志：`data/automation-logs/replacement-9-2026-06-05T02-40-45-946Z.log`
关联截图：`debug_image/20260605-104204-168-openAi_phone_add.png`

## 现象

完整 `/replace` 实机运行中，OAuth 状态机识别到 `Add your phone number` 并成功填写手机号、点击 `Continue` 后，又第二次进入添加手机号分支，最终在点击 `Phone number` 输入框时报错：

```text
locator.click: Timeout 30000ms exceeded.
element is not enabled
element was detached from the DOM
```

失败截图实际已经进入 `Check your phone` 手机验证码页，说明页面已跳转，但自动化仍在操作上一阶段组件。

## 初步根因

`openAi_phone_add()` 点击 `Continue` 后，OpenAI 前端会短暂停留在添加手机号页或处于 disabled/loading/React 重建状态。当前 `waitForStageTransition()` 把仍可识别到的 `phone-add` 也当作阶段到达并立即返回，导致外层状态机下一轮再次执行 `openAi_phone_add()`。

## 预期行为

- 添加手机号提交后，应等待页面离开当前 `phone-add` 阶段。
- 跳转期间应重新检测当前页面，再进入后续流程：
  - `phone-code`
  - `phone-verify`
  - `codex-login`
  - OAuth callback
- 如果仍停留在 `phone-add`，应继续等待或最终带诊断超时，不应重复填写同一个手机号输入框。

## 验证建议

- 新增回归测试：`phone-add` 提交后，页面短暂仍显示 add-phone，随后切到 phone-code；状态机不应第二次调用手机号填写。
- 运行：`npm test -- test/roxyOauthLogin.test.js`
- 后续实机：重新执行 `/replace`，确认 `Add your phone number -> Check your phone -> Codex/callback` 链路通过。

## 修复记录（2026-06-05）

状态保持：`active`（自动化回归测试已覆盖，仍待 `/replace` 实机链路复验）。

- 新增回归测试：`processOAuthLoginFlow does not refill phone while phone-add is transitioning to phone-code`。
- `phone-add` 提交后调用 `waitForStageTransition()` 时忽略当前 `phone-add` 阶段，等待进入 `phone-code` / `phone-verify` / `codex` / callback。
- 如果提交后一直未离开 `phone-add`，抛出 `OPENAI_PHONE_ADD_TRANSITION_TIMEOUT`，避免外层状态机再次填写同一手机号输入框。

## 自动化验证（2026-06-05）

```text
npm test -- test/roxyOauthLogin.test.js
# tests 56
# pass 56
# fail 0
```
