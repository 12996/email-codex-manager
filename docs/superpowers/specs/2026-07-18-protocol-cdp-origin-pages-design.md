# 协议注册 CDP 分域后台页面设计

## 目标

保留 Roxy 浏览器提供的 IP、指纹、Cookie 和浏览器生成 token 能力，但不再让同一个 CDP 页面在 ChatGPT、Auth 和 Sentinel 三个域名之间来回导航，避免 OAuth `state` 被破坏。

## 约束

- Roxy profile 仍由服务侧按账号准备；本次不改变指纹/IP 刷新策略。
- 邮箱验证码服务继续使用本机直连，不经过 Roxy。
- 不增加 DOM 点击、填表或可见页面交互。
- API 请求继续通过浏览器页面上下文执行，以保留 Cookie、浏览器凭据和 Roxy 网络环境。
- 注册期间记录 Roxy API 返回的 `proxyInfo.lastIp`；关键请求前发现出口 IP 变化时立即终止当前 OAuth 会话。
- 失败时不得把账号提前标记为 `registered`，也不得生成伪造 token。

## 方案

同一个 BrowserContext 内按 origin 维护后台页面：

```text
Roxy BrowserContext
├── chatgpt.com 页面：providers、csrf、signin、OAuth callback、session
├── auth.openai.com 页面：authorize 重定向、OTP validate、create_account
└── sentinel.openai.com 页面：Sentinel SDK 和浏览器生成 token
```

`ensureOrigin()` 不再把当前页面导航到目标域名，而是取得该 origin 对应的页面；页面不存在时才创建并完成一次 origin warmup。`navigate()` 也按目标 URL 的 origin 选择页面，然后在 Auth 或 ChatGPT 页面上执行真实 OAuth 导航。

## 数据流

1. 首次 ChatGPT API 请求创建并预热 ChatGPT 页面。
2. `signin` 返回 authorize URL 后，Auth 页面执行完整重定向链并保留其会话状态。
3. Sentinel 页面加载 SDK，使用同一 BrowserContext 的 Cookie 和浏览器环境生成 Sentinel headers。
4. Auth 页面提交邮箱验证码和注册资料，不受 Sentinel 页面导航影响。
5. ChatGPT 页面执行 OAuth callback 和 `/api/auth/session`，读取最终 access token。
6. 每次关键 CDP 请求前检查 Roxy profile 的当前出口 IP；IP 变化时不再提交旧验证码或旧 OAuth `state`。

## 错误处理

- 页面 API 的瞬时 `Failed to fetch` 继续使用现有短延迟重试。
- 导航和 API 请求日志记录脱敏 URL、当前页面 URL、页面关闭状态和错误摘要。
- 页面关闭时优先重新获取同一 BrowserContext 中的可用页面；若 CDP 已断开，则让本次账号失败并保留原业务状态。
- IP 变化时让本次账号失败并保留 `unregistered`，不刷新指纹/IP 后继续使用旧 OAuth 会话。
- HTTP 4xx/5xx 仍按业务错误处理，不对验证码或 OAuth state 盲目重复提交。

## 验收标准

- ChatGPT、Auth、Sentinel 三个 origin 使用不同页面对象。
- Sentinel 调用前后，Auth 页面仍保持原页面 URL 和导航历史上下文。
- Auth OTP validate 使用原 Auth 页面，不导航到 `auth.openai.com/` 根路径。
- OAuth callback 使用原 ChatGPT 页面。
- 现有 bridge 重试测试和协议 Python 测试全部通过。
- 真实单账号流程至少能稳定通过首个 providers 请求，并能明确记录后续失败阶段。
