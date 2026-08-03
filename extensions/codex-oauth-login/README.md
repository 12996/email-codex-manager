# Codex OAuth Login Chrome Extension

此目录是一个独立的 Manifest V3 Chrome/Edge 扩展。它只负责用户手动触发的 OAuth
登录和一次性 RT 下载；不会调用、读取或修改本机 Codex CLI，也不安装 Native
Messaging Host 或启动本机服务。

## 安装与无痕模式

1. 在 Chrome 打开 `chrome://extensions`，或在 Edge 打开 `edge://extensions`。
2. 开启 **开发者模式**。
3. 选择 **加载已解压的扩展程序**，并选择此目录：
   `extensions/codex-oauth-login`。
4. 打开扩展的 **详细信息**，开启 **在无痕模式下允许**。
5. 新开无痕窗口，点击工具栏中的 `Codex OAuth Login` 扩展图标，打开扩展页面。
6. 点击 **网页登录 Codex**；只在实际出现的 OpenAI 页面中由用户自行完成邮箱、密码、
   手机号、验证码和授权步骤。
7. 扩展显示“登录成功”后，确认邮箱/套餐信息，并按需点击 **下载 RT**。

## 行为与隐私

- AT 输入框仅做本地格式、JWT 可解析性和 `exp` 声明预检，不发送 AT，也不阻止
  后续网页登录。发起 OAuth 前会清空该输入框。
- OAuth 回调固定为 `http://localhost:1455/auth/callback`。扩展观察浏览器跳转 URL，
  但**不监听** 1455 端口；该地址之后出现的本机连接错误不等于登录失败。
- 只有原认证标签页、精确回调路径、单个 `code`、匹配的 `state`、成功的 token exchange
  和非空 RT 同时满足时，扩展才显示登录成功。
- AT、RT、授权码和 PKCE verifier 仅保存在 `chrome.storage.session` 的短暂会话中，不写入
  `local`/`sync` storage、日志、URL 或可见页面。
- RT 只会在用户点击 **下载 RT** 后作为纯文本文件落盘。无痕窗口关闭后，该下载文件仍由
  浏览器下载目录保留，需要用户自行妥善保管或删除。

## 验证要点

在真实浏览器中验证时，确认以下顺序成立：

```text
扩展页面 -> 授权标签页 -> 用户完成实际认证阶段 -> localhost:1455 callback
-> state 校验 -> token exchange -> 显示邮箱/套餐 -> 下载 RT 可用
```

取消认证、关闭授权标签页、回调参数无效、`state` 不匹配、兑换失败或缺少 RT 时，扩展不应
显示成功，也不应启用下载按钮。
