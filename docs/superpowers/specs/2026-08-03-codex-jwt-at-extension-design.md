# Codex JWT AT 直连 Chrome 扩展设计

## 目标

将现有扩展从 OAuth/RT 流程改为 JWT AT 直连校验。用户在扩展页面输入自己的 JWT 后，扩展在本地完成
Codex Agent Identity JWT 的签名和 claim 校验；成功时仅显示“已登录”、邮箱和套餐，并提供清除按钮。

## 范围

- 目标平台为 Windows Chrome/Edge；用户可手动开启无痕模式权限。
- 仅支持符合当前 Codex CLI 非 `at-` 分支定义的 Agent Identity JWT：三段 JWT、`RS256`、受信任的 `kid`、
  指定 issuer/audience、未过期，且包含账户、用户、套餐和 agent identity 所需 claim。
- 扩展固定从 `https://chatgpt.com/backend-api/wham/agent-identities/jwks` 获取公开 JWKS，并使用
  Web Crypto 在本地验签；JWT 不会发往网络。
- 校验成功后只在 `chrome.storage.session` 保存脱敏公共状态：`phase`、`message`、`email`、`plan`。
- 用户点击清除或浏览器会话结束后，公共状态消失。

## 非目标

- 不调用、读取或改写 Codex CLI，也不安装 Native Messaging Host 或本机服务。
- 不建立、注入或导入 ChatGPT/Codex 网页 Cookie，不让 `chatgpt.com` 页面变成已登录状态。
- 不执行 OAuth、1455 callback、token exchange、RT 下载、手机号/密码/验证码流程。
- 不支持任意 JWT、OpenAI API key 或 `at-` personal access token；不匹配 Agent Identity JWT 合约的输入安全失败。
- 不提供 Codex 对话、代码生成或其他持久化凭证功能。

## 官方兼容边界

当前 Codex CLI `0.144.1` 的公开源码把非 `at-` 的 access token 归类为 `AgentIdentityJwt`，并要求使用
ChatGPT JWKS 校验签名、issuer、audience 和标准过期时间。扩展只复用这一公开校验语义，不能把它解释为
OpenAI 网页登录 API。若服务端 JWKS 或 JWT 合约发生变化，扩展应以脱敏失败状态结束，不回退到 Cookie 注入、
OAuth 或其他未定义流程。

来源：

- `codex-rs/login/src/auth/access_token.rs`（`rust-v0.144.1`）
- `codex-rs/login/src/auth/agent_identity.rs`（`rust-v0.144.1`）
- `codex-rs/agent-identity/src/lib.rs`（`rust-v0.144.1`）

## 架构

```text
扩展页面
  |- password 输入框：JWT AT，仅在本页面内存中存在
  |- “使用 JWT 登录” / “清除”
  v
Service Worker
  |- 生成无凭证 attemptId，写入 chrome.storage.session
  |- 获取固定 JWKS
  |- 调用 Web Crypto 验证 RS256 签名与受限 claim
  |- 仅发布邮箱、套餐和静态状态文案
```

可见页面仅在用户主动输入的 password 控件运行时值中短暂持有原始 JWT；点击登录后立刻清空该控件，且不再
渲染完整 JWT payload、签名或私钥 claim。Service Worker 也不把它们写入 `storage.local`、`storage.sync`、
URL、文件、日志、错误文本或远程服务。

## 状态模型

```text
idle
  -> validating
  -> authenticated
  -> failed

validating | authenticated | failed
  -> idle (用户清除)
```

- `idle`：尚未完成 JWT 校验；邮箱和套餐为空。
- `validating`：仅 session 中保存随机 attemptId，JWT 仍只在当前异步调用内存中。
- `authenticated`：JWKS 获取成功、签名有效、issuer/audience/过期时间/必要 claim 均通过；保存脱敏结果。
- `failed`：格式、JWKS、签名、claim、网络或响应失败；删除 attemptId 和公共账户信息，展示通用失败文案。
- 清除操作会删除 attemptId 和公共状态。任何晚到的异步结果必须先比较 attemptId；不匹配时直接丢弃，不能覆盖
  清除后的 `idle`。

## JWT 验证规则

1. 输入必须是单行、三段 base64url JWT；否则本地失败，不发网络请求。
2. Header 必须声明 `alg: "RS256"` 且有非空 `kid`。
3. 仅从固定 ChatGPT JWKS URL 选择同一 `kid`、RSA、签名用途的 JWK；不接受 token 自带的 URL、issuer 或 JWK。
4. 用 `crypto.subtle.importKey("jwk", ...)` 和 `RSASSA-PKCS1-v1_5` 验证签名。
5. 已验签 payload 必须满足：
   - `iss === "https://chatgpt.com/codex-backend/agent-identity"`
   - `aud === "codex-app-server"`
   - `exp` 是未来的 Unix 秒时间戳，`iat` 是数值时间戳
   - `agent_runtime_id`、`agent_private_key`、`account_id`、`chatgpt_user_id`、`plan_type` 为非空字符串
   - `chatgpt_account_is_fedramp` 为布尔值；`email` 可选，缺失时显示“未提供”
6. 只从已验证 payload 提取 `email` 和 `plan_type`；其他 claim 永不跨模块返回。

## 文件边界

| 路径 | 责任 |
|---|---|
| `extensions/codex-oauth-login/lib/jwt-auth-core.js` | JWT 解析、受限 claim 验证、JWK 选择和 Web Crypto 验签纯逻辑。 |
| `extensions/codex-oauth-login/lib/jwt-auth-controller.js` | session attempt、JWKS 获取、脱敏公共状态和清除竞态。 |
| `extensions/codex-oauth-login/background.js` | 扩展 action、消息转发；不处理 OAuth 或下载。 |
| `extensions/codex-oauth-login/app.html` / `app.js` / `app.css` | JWT 输入、登录和清除界面；不渲染或保存原始 JWT。 |
| `extensions/codex-oauth-login/manifest.json` | 最小权限：`storage` 和 ChatGPT JWKS host permission。 |
| `test/codexJwtExtensionCore.test.js` | RS256、issuer/audience、过期、缺失 kid、伪造签名和 claim 边界测试。 |
| `test/codexJwtExtensionController.test.js` | 成功脱敏、失败清理、清除竞态和不存 JWT 测试。 |

旧的 OAuth/PKCE、callback、RT 下载和 offscreen 文件及对应测试会在替换完成后删除，避免保留误导性的登录入口。

## 权限和数据生命周期

新的 Manifest 只保留：

```json
{
  "permissions": ["storage"],
  "host_permissions": ["https://chatgpt.com/*"],
  "incognito": "split"
}
```

不再需要 `alarms`、`downloads`、`offscreen`、`tabs` 或 `webNavigation`。JWT 只在用户主动输入的 password 控件、
一次 runtime message 和单次校验函数中短暂存在；请求结束后不保留。公共状态只存当前浏览器会话，且不会包含
账户 ID、用户 ID、签名、私钥 claim 或 JWT。

## 错误与用户体验

| 情况 | 页面行为 |
|---|---|
| 空值、多行或非 JWT | 显示“请输入有效的 JWT AT”，不发网络请求。 |
| JWKS 网络或响应异常 | 显示“AT 校验失败，请检查凭证或稍后重试”。 |
| 签名、issuer、audience、过期或必要 claim 不符 | 显示同一通用失败文案。 |
| 成功 | 显示“已登录（JWT AT 已验证）”、邮箱和套餐。 |
| 请求期间清除 | 立即回到“等待登录”，晚到结果不改变页面。 |

所有错误均不得回显 JWT、header、payload、账户 ID 或网络响应。

## 验收标准

- [ ] 用户输入有效测试 JWT 并点击登录后，只有在固定 JWKS 的 RS256 验签及所有受限 claim 成功时显示已登录。
- [ ] 成功页面只显示状态、邮箱和套餐；除用户主动输入期间的 password 控件运行时值外，session、日志、URL、
  错误、下载、页面文本和 HTML 属性中不含完整 JWT 或敏感 claim。
- [ ] 伪造签名、错误 `kid`、错误 issuer/audience、过期 JWT、缺失必要 claim、JWKS 失败及输入格式错误均不显示登录成功。
- [ ] 清除与异步请求竞态不会让晚到的成功结果恢复为已登录。
- [ ] Manifest 没有 OAuth/RT 所需权限；扩展不调用 Codex CLI、OAuth callback 或本机端口。

## 回滚

本次改动不迁移持久化数据。回滚只需还原扩展目录和本 change 对应提交；当前会话中没有持久 JWT 可清理。
