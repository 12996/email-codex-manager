# Codex JWT AT Login Chrome Extension

此目录是一个独立的 Manifest V3 Chrome/Edge 扩展。它在本地验证符合当前 Codex
Agent Identity 合约的 JWT AT，并显示脱敏的登录状态、邮箱和套餐。它不会调用、读取或
修改本机 Codex CLI，也不安装 Native Messaging Host 或启动本机服务。

## 安装与无痕模式

1. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
2. 开启 **开发者模式**。
3. 选择 **加载已解压的扩展程序**，并选择此目录：
   `extensions/codex-oauth-login`。
4. 打开扩展的 **详细信息**，开启 **在无痕模式下允许**。
5. 新开无痕窗口，点击工具栏中的 `Codex JWT AT Login` 扩展图标，打开扩展页面。
6. 在扩展页面本地输入自己的 JWT AT，然后点击 **使用 JWT 登录**。
7. 成功后确认“已登录（JWT AT 已验证）”及邮箱/套餐；完成后可点击 **清除**。

## 行为与隐私

- 仅接受三段 `RS256` JWT，并使用固定 ChatGPT JWKS 在本地校验签名、issuer、audience、
  过期时间和 Agent Identity claim。任意 JWT 不会只因格式正确而被视为已登录。
- JWT 不会发送到网络；扩展只请求公开 JWKS。输入框在点击登录后立即清空，JWT 不写入
  `storage.local`、`storage.sync`、`storage.session`、日志、URL、下载文件或状态消息。
- 成功状态只在当前浏览器会话中保存“已登录”、邮箱和套餐。清除或浏览器会话结束后，这些
  脱敏状态会消失。
- 本扩展**不会**让 `chatgpt.com` 网页获得登录 Cookie，不执行 OAuth/1455 callback，不创建
  refresh token (RT)，也不提供 Codex 对话或代码调用。

## 验证要点

在真实浏览器中验证时，确认以下顺序成立：

```text
扩展页面输入 JWT -> 本地格式检查 -> 固定 JWKS 获取 -> 本地 RS256 验签
-> 显示已登录/邮箱/套餐 -> 清除回到等待登录
```

格式无效、JWKS 获取失败、签名不匹配、issuer/audience 不匹配、过期或缺少必要 claim 时，扩展不应
显示成功，也不得显示账户信息。
