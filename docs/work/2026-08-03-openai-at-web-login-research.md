# OpenAI AT 与网页登录研究

**日期**：2026-08-03<br>
**范围**：只查阅 OpenAI 官方公开文档与 `openai/codex` 公开源码；未接触、请求或使用任何真实 AT、RT、Cookie 或账号。

## 结论

1. **Codex CLI 当前确实有官方公开的 AT 直连模式**：官方源码把它称为
   `personalAccessToken`，并明确列出 `codex login --with-access-token` 与
   `CODEX_ACCESS_TOKEN`。这会让 **Codex 本地客户端** 使用该凭证，不是让
   ChatGPT/Codex 网页获得登录态。
2. **未找到受支持的 “AT -> ChatGPT/Codex 网页会话（Cookie）” 流程**。已查的
   官方公开材料只记录浏览器 OAuth / device-code 登录来建立 Codex 的 ChatGPT
   managed 登录；没有记录扩展或网页可提交 AT 来创建网页会话的接口。
3. **未找到受支持的 “AT -> refresh token” 交换流程**。当前官方源码的 AT 分支
   明确只保存 AT；只有 ChatGPT OAuth 分支持有并刷新 refresh token。

因此，若目标是“输入 AT 后让 `codex` 可用”，官方公开实现支持的是 **Codex CLI
凭证模式**；若目标是“输入 AT 后让无痕浏览器的 ChatGPT/Codex 网页免输账号密码”，
本次未发现官方支持路径。两者不是同一件事。

## 已验证的官方证据

### 1. Codex 的 AT 直连仅是客户端认证模式

OpenAI 官方 `codex` 公开源码的 app-server 认证说明将以下模式分开列出：

- `chatgpt`：Codex 托管 ChatGPT OAuth 与 refresh token；可从浏览器 OAuth 或
  device-code 登录开始。
- `personalAccessToken`：从 app-server 登录 RPC **之外**加载的 ChatGPT-backed
  personal access token，示例为 `codex login --with-access-token` 或
  `CODEX_ACCESS_TOKEN`。

来源：[OpenAI Codex app-server authentication modes（源码固定提交）](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/app-server/README.md#L2130-L2148)。

CLI 入口也公开声明 `--with-access-token` 从 stdin 读取 token；这说明“AT 直连
Codex”是 CLI 的本地凭证配置动作，而不是网页表单登录：

- [参数声明](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/cli/src/main.rs#L459-L474)
- [读取与执行路径](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/cli/src/main.rs#L1375-L1404)
- [官方文档入口](https://developers.openai.com/codex/auth)

### 2. AT 分支不会产出或保存 RT

在当前源码中，`login_with_access_token` 的注释是“写入只含 access token 的
`auth.json`”。其 personal-access-token 分支设置 `tokens: None`，仅保存
`personal_access_token`；没有 refresh token 字段或交换步骤。

来源：[AT 保存实现](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/login/src/auth/manager.rs#L930-L979)。

相反，刷新逻辑仅对 `CodexAuth::Chatgpt` 使用已有的
`token_data.refresh_token`；`CodexAuth::PersonalAccessToken` 在该分支中直接返回，
不执行 refresh。来源：[刷新分支](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/login/src/auth/manager.rs#L2421-L2453)。

这证明“AT 用于 Codex”与“由 AT 换出 RT”在官方实现中是两个不同的概念；不能把前者
当成后者。

### 3. 官方网页 OAuth 流程是独立的

官方 app-server 文档对 ChatGPT 浏览器登录的描述是：启动 `type: "chatgpt"`，获得
`authUrl`，由浏览器打开并完成 OAuth，再由本地 callback / 登录完成通知结束流程。
device-code 也同样要求用户在验证页面完成授权。

来源：[浏览器 OAuth 与 device-code 流程](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/app-server/README.md#L2201-L2257)。

在这些公开的支持模式中，没有“将 AT 写入浏览器 Cookie”“AT 换网页 session”或“AT
换 RT”的登录类型。因此不能把 OAuth callback、CLI `auth.json` 和浏览器网页登录态
混为一谈。

## 凭证与状态的边界

| 名称 | 官方材料中的用途 | 不代表什么 |
|---|---|---|
| OpenAI API key | 独立的 `apiKey` 模式，用于 API 请求。 | 不是 ChatGPT 网页会话，也不是 ChatGPT OAuth RT。 |
| Codex AT / `personalAccessToken` | 由 Codex CLI 作为本地客户端凭证使用；源码将 `at-` 前缀归为该类型，并单独验证/保存。 | 不是已登录浏览器的 Cookie，不能据此推导网页已经登录。 |
| ChatGPT OAuth access/refresh token | 正常浏览器 OAuth 或 device-code 成功后由 Codex 托管；其中 refresh token 只存在于此类 OAuth 凭证链。 | 不等于网页 Cookie，也不是从任意 AT 自动派生。 |
| 浏览器网页 session / Cookie | 浏览器持有的站点登录状态，用于网页 UI。 | 不是公开文档中可由 AT 导入或由扩展自行构造的对象。 |

AT 的前缀与具体可用性仍由服务端决定；不要把任意叫作“AT”的字符串当成可用于 Codex
或 API 的凭证，也不要在网页、扩展存储、日志或聊天中泄露它。

当前源码中 `at-` 仅是 Codex 用于识别 personal access token 的实现细节，不能据此
推断其他 token 格式或其他产品的登录能力。来源：[token 分类实现](https://github.com/openai/codex/blob/7750465934d97dd3cbcb3b1655d2f622744010d3/codex-rs/login/src/auth/access_token.rs#L1-L14)。

## 对当前扩展方向的影响

- 若保留“纯扩展、不要 Codex CLI、不要本地服务”的约束，扩展不能走当前官方的
  `codex login --with-access-token` 客户端入口。
- 若产品要求“AT 输入后网页免登录”，本次研究没有官方受支持实现，不能通过 Cookie
  注入、私有端点或伪造网页登录态补齐。
- 若产品要求“下载 RT”，AT 直连模式不满足；应保留用户完成官方 OAuth 的路径，或取消
  RT 功能。是否会出现邮箱、密码、MFA、短信码或授权确认，由认证服务端在该 OAuth
  会话中决定。

## 研究限制

“未找到”仅表示截至本文件日期、在所查官方公开资料中没有该受支持接口；它不是对内部
接口或未来产品变化的断言。官方文档的产品入口应优先于任何第三方教程、抓包结果或旧版
实现。
