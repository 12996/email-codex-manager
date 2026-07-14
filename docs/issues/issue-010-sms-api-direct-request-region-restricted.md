# issue-010 短信 API 直连访问受限导致 2FA 补号拿不到手机验证码

状态：resolved

## 现象

- 2FA 补号 run `433` 已完成邮箱、密码、MFA，并进入 `Check your phone`。
- 页面显示已向 `+1 (515) 403-3090` 发送验证码。
- 用户侧能直接 GET 到短信验证码，但自动化连续轮询 13 次后失败。

## 复现

1. 触发 account `78` 的 `replacement-2fa`。
2. 运行日志进入 `openai-phone-code`，连续请求 `smscloud.sbs/api/system/get_sms/...`。
3. 子进程最终报 `手机验证码必须是 6 位数字`。

## 期望 / 实际

- 期望：自动化能读取短信平台返回的 6 位 OpenAI 验证码并填入页面。
- 实际：Node 子进程直连短信 API 拿到的是 `访问受限 / Access Restricted` HTML，不是短信 JSON。

## 排查

- 同一 URL，用 Node 默认请求、Chrome UA 请求、API Accept 请求，均返回 `text/html`，标题 `访问受限 / Access Restricted`，正文说明服务不向当前国家或地区提供。
- 同一 URL，用当前 Roxy `mac` 真实浏览器新标签导航，返回 JSON：`code=0`、`message=操作成功`、`data.isReceived=yes`、`phoneNumber=15154033090`、`text=Your OpenAI verification code is: ******`。
- 页面内 `fetch()` 从 `auth.openai.com` 发起会因跨域/CORS 失败；但真实浏览器导航短信 URL 可以成功。
- 旧解析还会从访问受限 HTML 的 CSS 色值中匹配到 6 位十六进制片段，导致“发送前旧码”基线记录错误。

结论：问题是短信 API 对自动化子进程的直连出口做了地区限制；用户/Roxy 浏览器出口可以访问。不是 OpenAI 未发送，也不是短信平台未收到。

## 修复

- 短信验证码解析不再从 `<style>` / CSS 颜色值里提取 6 位数字。
- 检测到 `Access Restricted` / `访问受限` 时，若当前有 Roxy Playwright `page`，自动新开 Roxy 浏览器临时页导航短信 API，用真实 Roxy 浏览器出口读取响应。
- 临时页读取后关闭，不填 OpenAI 页面。
- 无 Roxy page fallback 时，明确抛 `OPENAI_PHONE_CODE_ACCESS_RESTRICTED`，并只记录脱敏响应预览。

## 验证

- RED：新增 `fetchPhoneVerificationCode falls back to Roxy browser navigation when direct request is access restricted`，先失败于 `OPENAI_PHONE_CODE_ACCESS_RESTRICTED`。
- GREEN：
  - `node --test test\roxyOauthLogin.test.js` 通过，78/78。
  - `node --test test\roxy2FAAuthLogin.test.js` 通过，11/11。
  - `node --check src\auto\roxy_oauth_login.js` 通过。
  - `git diff --check` 通过。
- 实机：修复后连接当前 Roxy CDP，用 `fetchPhoneVerificationCode({ page, smsApiUrl })` 通过 Roxy browser fallback 读取到 6 位验证码，未提交 OpenAI 表单。
