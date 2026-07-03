# CHG-057 iCloud 验证码 Gmail 收件 API

状态：implemented

创建日期：2026-07-02

关联 PRD：PRD-003

## 背景

后续 iCloud 邮箱验证码会统一投递到 Gmail 收件箱。现有 `/api/verification-code/latest` 会把请求邮箱当作 Gmail 主账号或 Gmail `+tag` 别名路由，无法直接处理 `@icloud.com` 目标邮箱。

## 目标

- 新增专用 API，从指定 Gmail 收件箱读取 iCloud 验证码。
- 默认 Gmail 收件箱为 `rosannathornton1@gmail.com`。
- 调用方可在请求体中指定 Gmail 收件箱，便于未来更换。
- 调用方可传入目标 iCloud 邮箱；系统优先选择收件人元数据匹配该 iCloud 邮箱的验证码邮件。
- 注册、OAuth 补号和 2FA 补号遇到 `@icloud.com` 邮箱且未配置账号级 `email_code_api` 时，默认走本地 iCloud 验证码 API。
- 本机调用免后台登录态，远程调用仍要求 `admin_auth`。

## 验收标准

- [x] `POST /api/icloud-verification-code/latest` 默认使用 `rosannathornton1@gmail.com`。
- [x] 请求体 `gmailAccount` / `mailbox` / `gmail` 可覆盖默认 Gmail 收件箱。
- [x] 请求体 `account` / `icloudAccount` 可指定目标 iCloud 邮箱。
- [x] 当邮件收件人元数据匹配目标 iCloud 邮箱时，优先返回匹配目标的 6 位验证码。
- [x] 未匹配目标但存在验证码时，回退返回 Gmail 收件箱内最新 6 位验证码，并在响应中标记 `targetMatched: false`。
- [x] `@icloud.com` 补号/注册账号未填写 `email_code_api` 时，自动化脚本会按邮箱类型选择 `/api/icloud-verification-code/latest`。

## 实现记录

实现日期：2026-07-02

- `src/config.js` 新增 `icloudCodeDefaultGmailAccount`，读取 `ICLOUD_CODE_GMAIL_ACCOUNT`，默认 `rosannathornton1@gmail.com`。
- `src/server.js` 新增 `POST /api/icloud-verification-code/latest`。
- 新增目标邮箱优先匹配逻辑：先筛选 `toAddresses`、`ccAddresses`、`deliveredToAddresses` 等收件人元数据，再复用现有 6 位验证码提取规则。
- `src/auto/roxy_oauth_login.js` 和 `src/auto/roxy_register_openai.js` 对 `@icloud.com` 邮箱默认构造 `/api/icloud-verification-code/latest`。
- `src/replacementServices.js` 对 `@icloud.com` 补号/注册账号在 `email_code_api` 为空时不注入外部地址，由自动化脚本默认选择本地 iCloud API。
- `test/verificationCodeApi.test.js` 增加默认 Gmail、指定 Gmail 和目标 iCloud 匹配回归测试。
- `test/roxyOauthLogin.test.js`、`test/roxyRegisterOpenai.test.js`、`test/replacementServices.test.js` 增加 iCloud 自动化路由回归测试。

后续 `CHG-058` 已明确：`@icloud.com` 账号若配置了 `email_code_api`，仍应和 Gmail 一样优先使用账号级外部 API。

## 回滚

删除 `POST /api/icloud-verification-code/latest` 路由、`ICLOUD_CODE_GMAIL_ACCOUNT` 配置、相关测试和文档即可。
