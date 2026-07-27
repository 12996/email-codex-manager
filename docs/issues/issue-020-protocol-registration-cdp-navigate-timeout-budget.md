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

## 建议修复

- 将 Python bridge 等待预算按命令传入的 `timeout_ms` 和最大重试次数计算，并留出页面准备与退避缓冲；或让桥接在单次 60 秒超时后立即返回可分类错误，改由 Python 负责重试。
- 添加回归测试：bridge 在首个导航超时后发起第二次尝试时，外层客户端不得先超时。
- 修复并验证后，再重试账号 `211` 的协议注册。

## 证据

- `data/automation-logs/protocol-registration-211-2026-07-27T15-44-44-120Z.log`
- `src/auto/protocol_registration/core/roxy_cdp.py:70-80,214-221`
- `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs:379-400`
