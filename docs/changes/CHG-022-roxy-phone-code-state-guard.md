# CHG-022 Roxy 手机验证码阶段状态守卫

状态：merged
创建日期：2026-06-03
关联 PRD：PRD-002
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 自动化在手机验证码阶段获取短信验证码时，页面可能已经跳转到 Codex 授权确认页。旧逻辑在取到验证码后仍继续查找 `Code` 输入框，导致 `locator.click` / `locator.waitFor` 超时。

## 变更

- 将手机验证码获取拆出单次请求能力，`openAi_phone_code` 在轮询过程中可重新审查页面状态。
- 在手机验证码填写前检查是否已进入 OAuth callback 或 Codex 授权确认页。
- 如果已进入 Codex 授权确认页，返回 `next-stage: codex-login`，由外层状态机下一轮处理。
- 验证码为空时只等待下一轮，不填写、不点击 `Continue`。

## 验收

- 手机验证码为空时不会点击页面提交按钮。
- 手机验证码轮询期间若页面跳到 Codex 授权确认页，不再查找 `Code` 输入框。
- 现有邮箱验证码、手机验证码、Codex 授权和 OAuth callback 流程测试保持通过。

## 验证

- `npm test -- test/roxyOauthLogin.test.js`

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的 OpenAI/Codex OAuth 自动化状态守卫要求。
