# CHG-075 短信 API 访问受限时使用 Roxy 浏览器兜底

状态：implemented
创建日期：2026-07-07
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-010-sms-api-direct-request-region-restricted.md`
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/issues/`, `docs/work/`

## 背景

2FA 补号进入手机验证码页后，用户侧能访问短信 API 并看到验证码，但自动化子进程用 Node 直连同一 URL 时返回 `访问受限 / Access Restricted` HTML。真实 Roxy 浏览器新标签导航同一 URL 可以返回短信 JSON。

## 变更内容

- 新增：
  - 短信 API 直连访问受限时，使用当前 Roxy 浏览器上下文打开临时页面读取短信 API。
- 修改：
  - 手机验证码提取跳过 `<style>` 内容和 CSS 颜色值，避免把访问受限页里的色值误当验证码。
  - `openAi_phone_add()` 的发送前旧码快照和 `openAi_phone_code()` 的轮询都传入当前 Playwright `page`，让短信读取可用 Roxy browser fallback。

## 验收标准

- [x] Node 直连短信 API 返回访问受限 HTML 时，不提取 CSS 数字。
- [x] 当前有 Roxy `page` 时，可通过 Roxy 浏览器临时页读取短信 JSON。
- [x] 临时页读取完成后关闭，不影响 OpenAI 验证码页。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：尚未合并。
