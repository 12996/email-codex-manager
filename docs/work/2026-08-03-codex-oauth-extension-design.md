# 2026-08-03 Codex OAuth Chrome 扩展设计

## 已确认需求

- 目标平台为 Windows Chrome/Edge，用户手动允许扩展在无痕模式运行。
- 不执行、读取或改写本机 Codex CLI；不安装 Native Messaging Host，不启动本机监听端口。
- 输入 AT 时只做本地预检；不把它当作网页 Cookie 或独立在线校验依据，预检失败也不阻止独立网页登录。
- 用户触发网页登录后，扩展使用 PKCE，观察到 `localhost:1455/auth/callback` 的回调请求并在扩展内兑换 token。
- 成功必须以匹配 `state` 的 callback 和非空 RT 为准，不能以 click、页面消失或 1455 连接错误为准。
- 登录结果显示可从 token claim 获取的邮箱和套餐类型；用户可主动下载仅含 RT 的文本文件。
- 所有凭据只保留在短暂内存中；下载是用户选择的唯一落盘动作。

## 设计产物

- 设计说明：`docs/superpowers/specs/2026-08-03-codex-oauth-extension-design.md`
- Change：`docs/changes/CHG-108-codex-oauth-extension.md`（accepted）

## 下一步

- 用户审核设计文件后，先编写详细实现计划，再进行浏览器回调可观测性和 token exchange 的最小验证。
