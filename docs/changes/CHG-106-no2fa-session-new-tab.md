# CHG-106 无 2FA 注册 Session 新标签页读取

状态：implemented
创建日期：2026-08-03
关联 PRD：PRD-003
关联 Issue：`issue-025-roxy-no2fa-create-account-response-variant.md`

## 背景

无 2FA browser runner 为读取 AT 会将完成注册的可见 ChatGPT 主页面导航到
`/api/auth/session`。用户要求保留主页面，改由同一 Roxy 浏览器上下文的独立标签页读取 session。

## 变更内容

- `readSessionAccessToken()` 必须通过当前主页面的 BrowserContext 新开标签页读取
  `https://chatgpt.com/api/auth/session`。
- session 标签页复用当前 Roxy 的 Cookie/登录态，重试仅在该标签页中进行。
- 成功读取后保留 session 标签页，使浏览器可见地停在 session JSON 页面；主页面不导航到 session URL。
- 未成功创建或无法导航的 session 标签页立即关闭；可导航的 session 标签页在读取失败时也保留，便于观察失败响应。
- 无法创建 session 标签页时返回明确错误，不得退回使用主页面。

## 验收标准

- [x] 注册完成后的主页面 URL 和内容不会因读取 AT 被替换。
- [x] session 读取、空响应重试、临时网络错误重试均只操作新标签页。
- [x] 成功读取后 session 标签页保持打开；不可用标签页被关闭。
- [x] 日志、stdout 和测试输出不包含 AT、OTP、Cookie、CDP endpoint 或代理凭据。

## 实现记录

- `readSessionAccessToken()` 只调用同一 BrowserContext 的 `newPage()` 和该页的顶层 `goto()`；不调用主页面
  `goto()` 或 `evaluate(fetch())`。
- 默认 `ROXY_KEEP_OPEN=1` 时，runner 断开而不关闭 Roxy，因此成功 session 标签页会保留供人工核验。
- 验证：`node --test test/roxyNo2FaRegister.test.js` 28/28 通过；`npm test` 71/71 通过。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
