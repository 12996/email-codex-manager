# CHG-088 补号协议动态解析 OpenAI workspace

状态：implemented

创建日期：2026-07-20

## 背景

补号 2FA 协议需要调用 OpenAI `workspace/select`。Roxy API workspace ID 与 OpenAI
账号 workspace ID 不同，不能复用同一个配置字段。

## 变更

- 新增 Roxy CDP bridge 的 Auth workspace 元数据读取命令，只返回 workspace 的 `id/kind/name`，不返回 Cookie 或 Token。
- `BrowserSession` 从当前 Auth 会话解析 OpenAI workspace 列表；协议优先使用当前会话中匹配的显式值，否则选择 `kind=personal` 的 workspace。
- OAuth consent 在显式 workspace 不属于当前会话时改用当前会话值，并为 `workspace/select` 补齐 `x-access-flow-invocation-id`。
- 移除 2FA 协议对 `ROXY_WORKSPACE_ID` 作为 OpenAI workspace 的错误依赖。

## 影响范围

- `src/auto/protocol_registration/core/roxy_cdp.py`
- `src/auto/protocol_registration/core/session.py`
- `src/auto/protocol_cpa_auth.py`
- `src/auto/protocol_cpa_replacement.py`
- `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- 对应 Python 单元测试
