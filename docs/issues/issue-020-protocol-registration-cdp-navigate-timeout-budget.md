# issue-020 协议注册 CDP 导航重试超时预算不足

状态：active

## 现象

2026-07-27，补号账号 `211` 的协议注册在步骤 5 后失败：

- Auth 已返回 `page=email_otp_verification` 和可用 `continue_url`。
- Roxy CDP 随后导航 `GET /api/accounts/email-otp/send`，页面保持在
  `https://auth.openai.com/create-account/password`。
- Playwright 的单次 `page.goto()` 在 60 秒后超时；桥接开始第 2 次重试时，Python 客户端同时因等待 bridge 响应超过 60 秒而退出。

## 根因

桥接层的每次导航使用 60 秒超时且最多重试 3 次，但 Python
`RoxyCdpClient._call()` 的外层等待也固定为 60 秒。外层没有覆盖首个导航的
页面准备时间、单次 60 秒等待或任一次重试，因此在 bridge 尚未返回最终结果前
就终止了子进程。

这不是邮箱验证码、密码、Sentinel 或 OpenAI 业务 HTTP 错误；日志中未出现
HTTP 4xx/5xx 或 `user/register`，失败发生在密码提交之前的 Auth 页面导航层。

## 影响

- 已启用的导航重试实际无法生效，慢网络/代理场景会在第一次超时后直接失败。
- 账号 `211` 当前仍为 `unregistered`；本次未执行远端 `user/register`，未达到账号创建步骤。

## 影响范围

该问题不只存在于 `email-otp/send`。协议注册中所有通过
`session.navigate()` 进入 Roxy bridge `page.goto(..., waitUntil:
'domcontentloaded')` 的阶段都有同一风险：

- 步骤 4 `follow_authorize()`：建立 Auth cookies 的 authorize 重定向链。
- `follow_auth_continue()`：初始 `email-otp/send`、密码提交后的 OTP 跳转、OTP
  校验后的 `about-you` 跳转。
- 步骤 6 `get_create_account_page()`：进入密码页。
- 步骤 12.5 `follow_oauth_callback()`：OAuth callback 到 ChatGPT session 的重定向链。
- 进入新 origin 前的 bridge warm-up：即使后续业务调用使用浏览器 `fetch` 并按
  HTTP 响应处理，也可能先被 warm-up 的页面加载超时阻断。

其中 OAuth callback 的最终真正确认应是后续 `/api/auth/session` 返回
`accessToken`；当前仍可能因 callback 页面 `domcontentloaded` 超时而提前失败。

## 建议修复

- 将 Python bridge 等待预算按命令传入的 `timeout_ms` 和最大重试次数计算，并留出页面准备与退避缓冲；或让桥接在单次 60 秒超时后立即返回可分类错误，改由 Python 负责重试。
- 添加回归测试：bridge 在首个导航超时后发起第二次尝试时，外层客户端不得先超时。
- 修复并验证后，再重试账号 `211` 的协议注册。

## 证据

- `data/automation-logs/protocol-registration-211-2026-07-27T15-44-44-120Z.log`
- `src/auto/protocol_registration/core/roxy_cdp.py:70-80,214-221`
- `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs:379-400`

## 2026-07-28 阶段错配复现

账号 `210` 的 run `692` 未触发导航超时：步骤 5 在约 10 秒后已继续到步骤 7，但
`POST /api/accounts/user/register` 返回 HTTP 400 `invalid_auth_step`。步骤 5 的
Auth JSON 为 `page=email_otp_verification`，而当前代码仅通过访问
`/create-account/password` 的 URL 来认定已进入 `username_password_create`，随后直接
提交 `user/register`。这不能证明服务端 Auth 状态已经切换；本次服务端明确拒绝了该
密码提交。

因此，修复范围还必须包括：以步骤 5 的 JSON 和后续接口响应决定是否能进入密码提交，
不得把密码页 URL 当作 Auth 阶段转换成功的依据。
