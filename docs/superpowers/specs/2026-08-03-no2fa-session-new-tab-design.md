# 无 2FA 注册 Session 新标签页设计

## 目标

无 2FA 浏览器注册在不改变完成注册主页面的前提下，从同一 Roxy 浏览器上下文的新标签页读取 ChatGPT session AT。

## 设计

- `readSessionAccessToken(page)` 从 `page.context()` 取得当前 Roxy BrowserContext，并调用 `context.newPage()` 创建 session 标签页。
- 仅 session 标签页导航到 `https://chatgpt.com/api/auth/session`；重试也复用该标签页。
- 成功读取 AT 后保持 session 标签页打开，供用户核验顶层 session JSON 页面；主 ChatGPT 页面保持不变。
- 无法导航的空白标签页立即关闭；已导航的失败 session 页面保留供排查。
- 如果无法创建同一上下文的标签页，返回明确的 `NO2FA_SESSION_TAB_UNAVAILABLE`，不允许回退导航主页面。

## 验收

- 主页面不调用 `goto('/api/auth/session')`。
- session 标签页在当前 BrowserContext 内创建、读取 AT，并在成功后保持可见。
- 临时 session 导航失败仍在 session 标签页重试。
- 日志、stdout、测试断言均不包含 AT 明文。
