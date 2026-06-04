# CHG-023 Roxy 邮箱验证码阶段状态守卫

状态：merged
创建日期：2026-06-03
关联 PRD：PRD-002
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 自动化在邮箱验证码阶段获取验证码后，页面可能已经跳转到 Codex 授权确认页或后续验证页。旧逻辑仍继续等待邮箱验证码输入框或 fallback 输入框，导致 `locator.waitFor` 超时。

## 变更

- 新增邮箱验证码单次请求能力，`openAi_email_code` 改为“取一次码 + 审查一次页面状态”的短循环。
- 在邮箱验证码轮询前和填写前检查 OAuth callback、Codex 授权确认页、手机验证方式页和手机验证码页。
- 如果已进入后续页面，返回 `next-stage`，由外层状态机下一轮继续处理。
- 验证码为空时只等待下一轮，不填写、不点击 `Continue`。

## 验收

- 邮箱验证码为空时不会点击提交按钮。
- 邮箱验证码轮询期间若页面跳到 Codex 授权确认页，不再等待 `Code` 输入框或 fallback 输入框。
- 现有邮箱验证码、手机验证码、Codex 授权和 OAuth callback 流程测试保持通过。

## 验证

- `npm test -- test/roxyOauthLogin.test.js`

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的 OpenAI/Codex OAuth 自动化状态守卫要求。
