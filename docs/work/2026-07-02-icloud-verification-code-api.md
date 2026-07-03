# 2026-07-02 iCloud 验证码 Gmail 收件 API

## 背景

用户确认后续 iCloud 邮箱验证码会统一发到 `rosannathornton1@gmail.com`，并要求提供一个 API 读取该 Gmail 下的验证码；同时考虑后续可能更换收件 Gmail，需要调用时能指定。

## 实现

- `src/config.js`
  - 新增 `ICLOUD_CODE_GMAIL_ACCOUNT` 配置，默认 `rosannathornton1@gmail.com`。
- `src/server.js`
  - 新增 `POST /api/icloud-verification-code/latest`。
  - 请求体支持：
    - `account` / `icloudAccount`：目标 iCloud 邮箱。
    - `gmailAccount` / `mailbox` / `gmail`：实际接收验证码的 Gmail。
  - 本机请求免后台登录态；远程请求仍需 `admin_auth`。
  - 当目标 iCloud 邮箱存在时，优先从收件人元数据匹配该邮箱的邮件中提取 6 位验证码；匹配不到时回退到收件箱最新 6 位验证码并返回 `targetMatched: false`。
- `src/auto/roxy_oauth_login.js`
  - `@icloud.com` 邮箱默认使用本地 `/api/icloud-verification-code/latest`。
- `src/auto/roxy_register_openai.js`
  - 注册验证码阶段对 `@icloud.com` 邮箱默认使用本地 `/api/icloud-verification-code/latest`。
- `src/replacementServices.js`
  - `@icloud.com` 补号/注册账号在账号行 `email_code_api` 为空时默认走本地 iCloud 验证码 API。
- `.env.example`
  - 新增 `ICLOUD_CODE_GMAIL_ACCOUNT` 示例。

## 验证

RED：

```powershell
node --test test\verificationCodeApi.test.js
```

结果：新增测试失败于 `/api/icloud-verification-code/latest` 路由不存在，返回 HTML 404。

GREEN：

```powershell
node --test test\verificationCodeApi.test.js
node --test test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js test\replacementServices.test.js
```

结果：iCloud 验证码 API 测试 7/7 pass；自动化路由定向测试全部通过。

最终完成前还需跑语法检查和 diff 检查。

## 待办

- 重启 `node src/server.js` 后新接口生效。
- 确认后台邮箱账号中已配置 `rosannathornton1@gmail.com` 的 Gmail App Password。
- 实机调用一次 `POST /api/icloud-verification-code/latest`，确认真实 Apple/iCloud 邮件的收件人元数据能命中目标邮箱；若 `targetMatched: false`，说明邮件头未保留目标 iCloud，需要依赖最新邮件回退或后续扩展正文匹配。
