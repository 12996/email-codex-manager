# CHG-058 iCloud 邮箱验证码 API 优先级对齐

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

iCloud 验证码默认 API 已接入，但自动化子进程曾对 `@icloud.com` 账号强制忽略补号账号行的 `email_code_api`。用户要求 iCloud 与 Gmail 逻辑一致：账号级邮箱验证码 API 不为空时优先使用该 API；为空时才走默认 iCloud 验证码 API。

## 目标

- iCloud 账号与 Gmail 账号统一遵循 `email_code_api` 优先规则。
- `email_code_api` 有值时，注册、普通补号和 2FA 补号均注入外部邮箱验证码 API。
- `email_code_api` 为空时，iCloud 账号默认使用本地 `/api/icloud-verification-code/latest`。
- 直接运行自动化脚本时，显式传入 `verificationApiUrl` 或 `VERIFICATION_CODE_API_URL` 也能覆盖 iCloud 默认 API。

## 验收标准

- [x] `registerAccount()` 对 iCloud 账号保留并注入 `REGISTRATION_EMAIL_CODE_API_URL`。
- [x] `replaceAccount()` 对 iCloud 账号保留并注入 `VERIFICATION_CODE_API_URL`。
- [x] `replaceAccountWith2FA()` 对 iCloud 账号保留并注入 `VERIFICATION_CODE_API_URL`。
- [x] `openAi_email_code()` 对 iCloud 邮箱传入显式 `verificationApiUrl` 时走外部 GET API。
- [x] 未配置显式 API 时，iCloud 邮箱仍默认走本地 `/api/icloud-verification-code/latest`。

## 实现记录

实现日期：2026-07-03

- `src/replacementServices.js` 移除 iCloud 账号忽略 `email_code_api` 的特殊分支。
- `src/auto/roxy_oauth_login.js` 调整验证码 API 解析顺序：显式 `verificationApiUrl` / `VERIFICATION_CODE_API_URL` 优先，缺省时按邮箱域名选择默认本地 API。
- `src/auto/roxy_register_openai.js` 同步验证码 API 解析顺序，保持直接运行脚本时的覆盖能力。
- 更新 `test/replacementServices.test.js`、`test/roxyOauthLogin.test.js` 覆盖 iCloud 账号外部 API 优先级。

## 回滚

恢复 `src/replacementServices.js` 中 iCloud 忽略 `email_code_api` 的特殊分支，并恢复自动化脚本中 iCloud 强制使用默认本地 API 的逻辑即可。
