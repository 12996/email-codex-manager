# CHG-059 注册流程先设置数据库密码再提交邮箱验证码

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

用户手动演示 OpenAI 注册流程后确认：注册链路中即使先进入 `auth.openai.com/email-verification`，也必须先推进到创建密码页，使用补号账号数据库中的 `password` 设置账号密码，然后再提交邮箱验证码。此前自动化在检测到 OTP 输入框时可能直接提交第一次邮箱验证码，顺序不符合真实流程。

## 目标

- 注册子进程使用补号账号数据库 `password`，不再生成随机密码。
- 密码提交前遇到 `email-verification` 时，不论是否可见 OTP 输入框，都先点击页面主按钮推进到 `create-account/password`。
- 密码提交前只要检测到 OTP/验证码输入框，即使当前 URL 还不是 `/email-verification`，也必须先推进到 `create-account/password`，不能进入接码填码。
- 密码提交后才把 `email-verification` 视为邮箱验证码输入页。
- 邮箱验证码填错后继续排除旧码并轮询新码，每轮最多 24 次、间隔 5 秒。
- 注册成功后的自动启用 2FA 和 `codex_2fa` 写库链路保持不变。

## 验收标准

- [x] `registerAccount()` 将补号账号 `password` 注入为 `ROXY_REGISTER_PASSWORD`。
- [x] `roxy_register_openai.js` 缺少 `ROXY_REGISTER_PASSWORD` / `ROXY_OAUTH_PASSWORD` 时拒绝继续创建密码。
- [x] 密码未提交前，`/email-verification` 即使有 OTP 输入框也返回“先进入密码页”的状态。
- [x] 密码未提交前，非 `/email-verification` URL 上只要出现 OTP 输入框，也返回“先进入密码页”的状态。
- [x] 密码提交后，`/email-verification` 才识别为 OTP 输入页。
- [x] OTP 重试每轮按 24 次、5 秒间隔轮询，并排除上次失败码。
- [x] 注册完成后的 `registrationMfa.secret` 输出与服务端写入 `codex_2fa` 的测试仍通过。

## 实现记录

实现日期：2026-07-03

- `src/replacementServices.js` 在注册子进程环境中注入 `ROXY_REGISTER_PASSWORD`，并在环境摘要中只记录是否 set。
- `src/auto/roxy_register_openai.js` 新增 `resolveRegistrationPassword()`、`detectNextRegistrationStep()` 和 `advanceEmailVerificationToPassword()`。
- `src/auto/roxy_register_openai.js` 主流程新增 `registrationPasswordSubmitted` 状态，密码未提交前遇到 `email-verification` 一律先推进密码页。
- 二次修正：实机 run `350` 暴露出 URL 未落到 `/email-verification` 但 OTP 输入框已可见时，旧判断会直接进入 Step 5 接码。现已改为 password 未提交前只要 OTP 可见就返回 `email-verification-before-password`，并由 `advanceEmailVerificationToPassword()` 优先点击 password 入口、再兜底进入 `create-account/password`。
- `src/auto/roxy_register_openai.js` 创建密码页使用数据库密码，不再随机生成密码。
- `submitOtpWithRetry()` 每次提交前固定使用 24 次验证码轮询，并把旧码排除、无新码回调和页面恢复回调传入邮箱验证码轮询函数。
- 更新 `test/replacementServices.test.js` 和 `test/roxyRegisterOpenai.test.js` 覆盖新流程。

## 回滚

恢复 `registerAccount()` 不注入 `ROXY_REGISTER_PASSWORD`，并将 `roxy_register_openai.js` 的 password 分支恢复为随机密码生成；同时移除 password 前 `email-verification` 的强制跳转状态即可回滚。
