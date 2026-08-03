# 无 2FA 协议注册调试断点设计

日期：2026-08-03

## 目标

为 `src/auto/protocol_no_2fa_registration.py` 的无 2FA 协议注册增加可配置的调试断点。
断点命中后停止后续协议请求，安全断开 CDP bridge 但保留脚本创建的 Roxy Tab，且不读取、保存或回写 AT。

首个实际断点是 `after-oauth-callback-before-at`：OAuth callback 已完成并已导航到 ChatGPT，
但 `GET /api/auth/session` 尚未发出。

## 设计

### 断点模型

CLI 接受 `--debug-stop-at <checkpoint>`；未传时保持既有注册行为。断点名称由核心状态机显式调用，
而不是通过注释或捕获任意异常实现。初始可用名称为：

```text
after-authorize
after-email-otp
after-profile-submit
after-oauth-callback-before-at
after-session-at
after-at-save
```

命中断点时抛出带断点名称的受控结果，调用方将其识别为 `debug-stopped`，而非注册成功或失败。

### AT 前断点

无 2FA 核心流程在 `finalize_session()` 中依次执行：

```text
follow_oauth_callback
-> after-oauth-callback-before-at
-> fetch_session
-> accessToken
```

因此首个断点放在 callback 成功后、`fetch_session()` 前。命中时不调用 session AT 接口，
也不执行 AT 文件保存与 `registered` 状态回写。

### 页面保留与清理

现有 `BrowserSession.close()` 会通过 CDP bridge 关闭本次 bridge 创建的页面。
增加显式的 `preserve_owned_pages` 关闭选项：仍断开 Playwright/CDP 连接并结束 bridge 子进程，
但不调用 `page.close()`。普通调用继续使用默认关闭语义。

调试停止路径只使用该选项；普通成功和失败路径不改变清理行为。

### 队列和 UI 可见性

队列 worker 识别 `debug-stopped` 结果，将任务记录为该状态并附带无敏感值的断点名称。
不会把补号账号标记为 `registered`，也不会把预期调试停止记录为失败。前端将该终态显示为
“调试已停在 <checkpoint>”。

调试停止是一次性结束：进程退出，页面留给人工观察。后续若需要从同一进程继续流程，
再单独设计 pause/resume 控制 API；不能使用 stdin，因为注册由服务子进程启动。

## 非目标

- 不启用、读取或保存 TOTP/2FA。
- 不输出 AT、OTP、Cookie、CDP endpoint 或代理凭据。
- 不改变未启用调试参数时的无 2FA 注册路径。
- 不在本次实现 pause/resume。

## 测试与验收

- 断点命中前已完成 OAuth callback，且 `fetch_session()` 未被调用。
- 调试停止不写 AT、不回写 `registered`，但返回可识别的 `debug-stopped` 结果。
- bridge 在保留模式下断开连接而不关闭其拥有的页面；默认模式仍关闭页面。
- 队列与前端将调试停止展示为独立终态。
- 常规无 2FA 注册回归保持通过。
