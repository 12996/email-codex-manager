# CHG-088 补号协议动态解析 OpenAI workspace

状态：implemented

创建日期：2026-07-20

## 背景

补号 2FA 协议需要调用 OpenAI `workspace/select`。Roxy API workspace ID 与 OpenAI
账号 workspace ID 不同，不能复用同一个配置字段。

## 变更

- 新增 Roxy CDP bridge 的 Auth workspace 元数据读取命令。
- `BrowserSession` 从当前 Auth 会话解析 OpenAI workspace ID。
- OAuth consent 在未显式传入 workspace 时使用当前会话值。
- 移除 2FA 协议对 `ROXY_WORKSPACE_ID` 作为 OpenAI workspace 的错误依赖。

## 影响范围

- `src/auto/protocol_registration/core/roxy_cdp.py`
- `src/auto/protocol_registration/core/session.py`
- `src/auto/protocol_registration/core/oauth_consent_protocol.py`
- `src/auto/protocol_registration/core/replacement_2fa_protocol.py`
- `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- 对应 Python 单元测试
