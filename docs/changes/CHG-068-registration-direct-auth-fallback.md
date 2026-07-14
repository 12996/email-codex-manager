# CHG-068 注册入口直连 Auth 兜底

状态：implemented

创建日期：2026-07-04

关联 PRD：PRD-003

影响范围：`src/auto/roxy_register_openai.js`, `test/roxyRegisterOpenai.test.js`, `docs/work/`

## 背景

实机注册 account `60` 时，ChatGPT 首页邮箱 modal 提交邮箱后，`/api/auth/signin/openai?...login_hint=...` 返回 403 HTML，页面停留在邮箱弹窗 loading 状态。旧逻辑没有识别该入口卡死状态，继续进入 OTP 等待，最终误报“未找到验证码输入框/邮箱 API 接不到码”。

另一个实机失败 run `358` 暴露出：在 OTP 预等待阶段触发超时恢复后，如果恢复回密码页并重新提交密码，旧逻辑会抛出内部 `OTP_REFETCH_AFTER_RECOVERY`，导致尚未真正开始接码就失败。

## 决策

- 注册邮箱提交后如果仍停留在 ChatGPT 邮箱输入页，视为入口链路异常，自动切换到 `https://auth.openai.com/log-in` 直连登录页重新提交邮箱。
- 直连登录页若先出现 “Your session has ended”，点击页面 `Log in` 继续进入 OpenAI 邮箱登录页。
- 如果兜底后仍未进入密码页、邮箱验证页或 OTP 页，给出明确入口阶段错误，不再误判为邮箱接码失败。
- OTP 预等待阶段的超时恢复如果已经重新提交密码，且当前还没有拉取邮箱验证码，则继续确认页面状态，不抛出“重新拉码”内部错误。

## 验收

- [x] `node --check src\auto\roxy_register_openai.js` 通过。
- [x] `node --test test\roxyRegisterOpenai.test.js` 通过，23/23。
- [x] 实机 account `60` 注册 run `359` 成功。
- [x] run `359` 注册完成后自动启用 2FA，`replacement_accounts.codex_2fa` 已写入，日志不输出验证码、密码、access token 或完整 2FA secret。

## 回滚

移除 `prepareDirectAuthEmailEntry()` 和邮箱提交后 `state=email-entry` 的直连 Auth 兜底分支；同时将 `waitForOtpInputReady()` 超时恢复分支恢复为无条件抛出 `OTP_REFETCH_AFTER_RECOVERY`。
