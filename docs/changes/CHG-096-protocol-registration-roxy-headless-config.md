# CHG-096 协议注册继承 Roxy 无头配置

状态：implemented
创建日期：2026-07-24
关联 PRD：PRD-003

协议注册准备 Roxy CDP 环境时，读取全局 `ROXY_HEADLESS` 和 `ROXY_KEEP_OPEN`。`ROXY_HEADLESS=true` 强制无头，`false` 强制有头，`auto` 按 `ROXY_KEEP_OPEN=0` 推导为无头，方便通过 `.env` 在运行和调试之间切换。
