# 2026-08-03 Codex JWT AT 直连扩展设计

- 状态：设计已获口头确认，等待书面设计审核。
- 目标：将独立扩展从 OAuth/RT 流程改为仅校验 JWT AT，并显示已登录、邮箱、套餐和清除。
- 修改文件：新增 `docs/superpowers/specs/2026-08-03-codex-jwt-at-extension-design.md`；新增 `docs/changes/CHG-109-codex-jwt-at-extension.md`。
- 验证结果：已核对当前安装 Codex CLI `0.144.1` 对应公开源码；非 `at-` token 走 Agent Identity JWT 分支，使用固定 ChatGPT JWKS 进行签名验证。
- 未完成 / 风险：尚未以真实 JWT 验证服务端 JWKS 与扩展运行时兼容性；不得把真实 JWT 写入测试、日志、文档或聊天。
- 下一步：用户审核设计文档后，编写测试优先的实现计划，再替换扩展代码。
- 日终交接：完成后更新 `handoff.md`。
