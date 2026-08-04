# 2026-08-03 Codex JWT AT 直连扩展设计

- 状态：JWT AT 扩展实现已完成自动化验证，等待用户控制的真实浏览器验收。
- 目标：将独立扩展从 OAuth/RT 流程改为仅校验 JWT AT，并显示已登录、邮箱、套餐和清除。
- 修改文件：新增 JWT 验签核心和 session controller；替换 Manifest、后台、页面和 README；删除 OAuth/PKCE/1455/RT/download/offscreen 代码及测试。
- 验证结果：改造后 `npm test` 为 83/83；JWT 聚焦测试为 12/12；脚本语法、Manifest JSON 和 `git diff --check` 已通过。当前执行环境无法连接公开 JWKS URL，尚无真实网络成功证据。
- 未完成 / 风险：需要用户在已加载扩展的浏览器中输入真实 JWT；不得把 JWT 写入测试、日志、文档或聊天。若 JWT 不属于 Agent Identity 合约或 JWKS 校验失败，保持 CHG-109 为 `accepted`。
- 下一步：用户手动重新加载未打包扩展并在扩展页面输入 JWT；只反馈“已登录”或通用失败状态，不发送凭证。
- 日终交接：完成后更新 `handoff.md`。
