# Issue-016 补号协议混用 Roxy 与 OpenAI workspace ID

状态：fixed

## 现象

补号 2FA 协议完成 Auth 登录后，`workspace/select` 返回 HTTP 401。

## 根因

协议把 `ROXY_WORKSPACE_ID=111070` 同时作为 OpenAI 的
`workspace_id`。两者属于不同系统：

- `111070`：Roxy API workspace
- OpenAI workspace：登录会话中的账号级 UUID

录制的真实流程中，`workspace/select` 使用的是当前 Auth 会话返回的账号 workspace，
不是 Roxy workspace。

## 修复

- Roxy CDP bridge 只提取当前 Auth 会话中的非敏感 workspace 元数据。
- 协议优先选择 `kind=personal` 的 OpenAI workspace。
- `OAuthConsentProtocol` 不再默认读取 `ROXY_WORKSPACE_ID`。
- 短信 transport 和原 DOM 状态机均保持不变。

## 验证

- OAuth consent 单元测试通过。
- Roxy bridge 单元测试通过。
- `workspace/select` 的请求参数不再使用 Roxy workspace ID。

## 2026-07-20 账号 111 复现与修复补充

- 账号 `111` 的注册 token 显示为 `free`，当前 Auth session 的 personal workspace 是 `7e2e668c-cd6a-4eb6-9a44-297691e39323`；历史浏览器录制的 `workspace/select` 也使用该值。
- 独立 `protocol_cpa_auth.py` 当时仍无条件使用 `.env` 的账号 109 组织 workspace，因此再次出现 `workspace/select HTTP 401`；同时遗漏了录制请求中的 `x-access-flow-invocation-id`。
- 已将动态 workspace 解析接入独立 CPA 入口，并让 `BrowserSession`/Roxy bridge 只返回脱敏 workspace 元数据；`workspace/select` 现在补齐 invocation header。
- 不应把账号 109 的 `OPENAI_WORKSPACE_ID` 当作所有补号账号的固定值；账号 111 需在当前 Auth session 中选择自己的 personal workspace。

后续真实重试若出现 MFA 403，应单独按风控/重复登录问题排查，不能与本 issue 的 workspace 401 混为一谈。
