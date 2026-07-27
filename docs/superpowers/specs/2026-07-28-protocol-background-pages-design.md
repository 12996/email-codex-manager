# 协议注册后台页与响应判定设计

日期：2026-07-28

## 目标

协议注册继续使用 Roxy 浏览器会话、指纹和 Cookie，但不再将业务页面的
DOM 加载或渲染状态作为协议成功条件。每个协议状态转换以 HTTP 响应、重定向链、
最终 URL 和必要 Cookie/后续 API 响应判定。

## 范围

覆盖 `src/auto/protocol_registration/` 中的：

- `follow_authorize()`；
- `follow_auth_continue()` 的全部调用；
- `get_create_account_page()`；
- `follow_oauth_callback()`；
- Roxy CDP bridge 的跨 origin 后台页初始化和导航等待。

不修改 OpenAI 的协议顺序、邮箱验证码来源、Sentinel 生成方式或账号状态模型。

## 设计

### 后台页模型

- Roxy browser context 按 `auth.openai.com`、`chatgpt.com`、`sentinel.openai.com`
  延迟创建并复用后台页。
- 后台页仅提供同源浏览器网络上下文；不读取业务页面 DOM、不等待表单或可见元素，
  也不将页面文案作为成功条件。
- 每次首次进入一个 origin 的初始化只等待网络响应已提交（Playwright
  `waitUntil: 'commit'`），不等待 `domcontentloaded` 或 `load`。

### 文档导航协议结果

保留 document navigation 语义，避免将 Auth 请求改成可能不同的 `fetch/cors` 语义。

bridge 的导航命令应返回可用于判定的脱敏结果：

- 初始请求和重定向链的 HTTP 状态、URL；
- 最终 URL；
- 是否已收到 document response；
- 已知的网络错误分类。

收到 document response 后，页面后续资源或 DOM 加载超时不影响本次协议结果。
响应尚未提交时发生连接、代理或超时错误，才按临时网络错误处理。

### 阶段判定

- `authorize`：请求提交且没有 HTTP 业务错误；下一次 Auth JSON 调用继续验证会话。
- Auth `continue_url`：前置 JSON 的 `page.type`/`method` 必须匹配；导航响应和
  重定向目标必须属于预期 Auth 阶段。页面 DOM 不参与判定。
- 密码页：只验证预期的 Auth 路径已经到达，随后由 `user/register` 的 HTTP JSON
  响应确认密码阶段是否有效。
- OAuth callback：导航只负责让浏览器接收 callback Cookie；最终成功必须由
  `GET /api/auth/session` 返回 `accessToken` 确认。

### 重试与幂等性

- Python 外层等待时间必须覆盖 bridge 的单次请求超时、最大重试次数和退避时间。
- 已收到 document response 的 `email-otp/send` 不得因后续页面加载失败而重发，
  防止刷新验证码。
- 未收到 response 的临时网络失败才允许重试；HTTP 4xx/5xx 业务错误不重试。

### 可观测性

每次后台导航记录：协议步骤、尝试次数、初始/最终 URL（脱敏）、HTTP 状态链、
response 是否已提交、是否进入重试。不得记录 Cookie、授权码、Token 或验证码。

## 测试与验收

1. bridge 单元测试：document response 已提交但 `domcontentloaded` 不发生时，导航仍返回成功结果。
2. bridge 单元测试：未收到 response 的超时可重试；Python 外层不会在 bridge 第 2 次尝试前超时。
3. 协议调用方测试：各 `continue_url` 阶段只按协议响应/重定向判断，不依赖 DOM。
4. OAuth callback 测试：只有 `/api/auth/session` 含 `accessToken` 才算完成。
5. 实机验收：在用户提供的 Roxy 环境中，以
   `billows_whine_4y@icloud.com` 执行一次协议注册；验证不会因页面资源加载而中断，
   并保留完整脱敏运行日志。

## 非目标

- 不将协议改为脱离 Roxy 的 Node/curl 请求。
- 不删除 Sentinel 浏览器执行上下文。
- 不依据 UI 截图、元素可见性或 `domcontentloaded` 判定协议阶段成功。
