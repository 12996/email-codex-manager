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

后续真实重试若出现 MFA 403，应单独按风控/重复登录问题排查，不能与本 issue 的 workspace 401 混为一谈。
