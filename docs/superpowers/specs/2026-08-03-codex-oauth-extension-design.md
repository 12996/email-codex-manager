# Codex OAuth 纯 Chrome 扩展设计

## 目标

提供一个面向 Windows Chrome/Edge 用户的纯 Chrome 扩展。在无痕窗口中，用户可手动触发
Codex OAuth 网页登录；扩展不执行 Codex CLI、不安装 Native Messaging Host、不启动本地回调服务。

登录完成后，扩展在浏览器尝试跳转 `http://localhost:1455/auth/callback` 时捕获 OAuth 授权码，
验证 PKCE 事务并兑换 token bundle。用户可一次性下载仅包含 refresh token (RT) 的文本文件。

## 范围与非目标

### 范围

- 默认对输入的 AT 做纯本地预检：格式、JWT 可解析性和声明的过期时间；不发送独立在线校验请求。该预检是
  辅助信息，AT 缺失、无法解析或已过期都不得阻止用户另行发起网页登录。
- 用户点击“网页登录 Codex”后，扩展生成独立的 PKCE `state`/`verifier` 并打开授权页。
- 用户自行完成实际网页上的邮箱、密码、手机号、验证码和授权确认步骤。
- 扩展在同一次认证事务中捕获精确的 `localhost:1455/auth/callback` URL，校验 `state` 后兑换授权码。
- 兑换成功且返回非空 RT 后，显示从 token claim 提取的邮箱和套餐类型；claim 缺失时显示“未提供”。
- 用户可下载仅含原始 RT 的 `.txt` 文件。下载完成、取消、超时或手动清除后删除本次敏感内存。

### 非目标

- 不把 AT 转换或写入 ChatGPT/OpenAI 的浏览器 Cookie，不尝试绕过服务端要求的重新认证、手机号或 MFA。
- 不自动填写、点击或判定邮箱、密码、手机验证码等 OAuth 页面控件。
- 不调用 `codex login`、`codex logout` 或读取/改写现有 Codex CLI 凭据。
- 不启动本机端口监听服务；`localhost:1455` 仅是浏览器尝试跳转的虚拟回调目标。
- 不持久保存 AT、RT、授权码、PKCE verifier、Cookie 或完整认证响应。
- 不在首版中提供 Codex 对话、代码生成或任意 API 调用能力。

## 方案选择

首版采用纯扩展的“虚拟回调”方案。

1. 扩展页面创建 OAuth 事务，并将 `state`、PKCE verifier 和认证 tab 标识关联。
2. 扩展打开 OAuth 授权页，等待用户在真实页面完成其账户需要的步骤。
3. 后台 Service Worker 监听该认证 tab 的导航。在浏览器因没有本机服务而出现连接失败前，捕获发往
   `http://localhost:1455/auth/callback` 的完整 URL。
4. 只接受路径、认证 tab、`state` 均匹配且包含单个 `code` 的回调；随后用 code 和 PKCE verifier 兑换 token。
5. 仅当兑换成功且 RT 非空时标记登录成功；回调到达、按钮点击或页面元素消失都不能单独构成成功。

此方案避免 Native Messaging 和 loopback listener。它的前置验证是 Chrome 扩展能在无痕窗口中捕获
1455 导航，且 OAuth token endpoint 接受该扩展发起的兑换请求；实现时必须以真实运行态验证这两个条件。

## 组件与数据流

```text
扩展页面
  |- AT 本地预检（不保存）
  |- “网页登录 Codex” / “下载 RT” / “清除”操作
  v
Extension Service Worker
  |- PKCE 事务与严格状态机
  |- 认证 tab 导航监听
  |- 授权码兑换与结果脱敏
  v
OpenAI OAuth 授权页 -> localhost:1455/auth/callback?code=...&state=...
```

建议目录为 `extensions/codex-oauth-login/`，包含 Manifest V3、扩展页面、Service Worker、纯函数 OAuth
核心模块和独立 Node 测试。扩展仅请求完成本流程必需的最小权限，包括 OAuth/localhost 导航观察、认证端
host permission 和用户触发下载所需的下载权限。用户仍需在 Chrome 扩展详情页启用“在无痕模式下允许”。

## 状态机

```text
idle
  -> prechecking_at
  -> ready
  -> authorizing
  -> callback_observed
  -> exchanging
  -> authenticated
  -> rt_downloaded

authorizing/callback_observed/exchanging
  -> cancelled | failed | expired
```

- `prechecking_at` 只解析用户输入，不把可解析 JWT 当作在线有效凭据。
- `authorizing` 只表示网页已打开；邮箱、密码、手机或授权页的存在不是成功或失败结论。
- `callback_observed` 要求精确 callback path 和匹配 `state`；浏览器随后显示的 `ERR_CONNECTION_REFUSED`
  不改变已捕获 URL 的事实。
- `exchanging` 只可消费授权码一次。
- `authenticated` 要求 token exchange 成功并提供非空 RT；缺少 RT 是失败，不显示下载按钮。

## 凭据生命周期与下载

- AT 输入值不写入任何 Chrome storage、Cookie、URL、日志或远程服务。
- OAuth 事务的 `state` 和 verifier 仅存在于内存型 `chrome.storage.session`，并在完成、取消、错误或 15 分钟
  超时后删除。
- 兑换得到的 token bundle 仅暂存至用户下载 RT 或主动清除为止；下载窗口最长 60 秒。不得使用 `local`、`sync`
  或磁盘持久化。
- `下载 RT` 由用户明确点击触发，文件正文仅为 RT 本身，不含邮箱、AT、ID token、JSON 或元数据；文件名不得
  包含凭据或邮箱。
- 下载是用户选择的唯一落盘动作。无痕窗口关闭不会删除已下载文件。

## 错误处理

| 情况 | 行为 |
|---|---|
| AT 格式不完整或 JWT 声明过期 | 显示本地预检结果；不发起独立在线校验，但不得阻止用户开始网页登录。 |
| 用户关闭认证 tab 或点击取消 | 取消事务并清除内存。 |
| callback 缺少 `code`、包含 OAuth `error`、路径不匹配或 `state` 不匹配 | 拒绝回调、清除事务、显示脱敏错误。 |
| 1455 导航后本机连接失败 | 若完整 URL 已被捕获且 state 匹配，继续 token exchange；否则失败。 |
| token exchange 网络错误、非成功响应或 RT 缺失 | 不标记成功，不显示下载按钮，清除敏感值。 |
| 下载被浏览器取消或失败 | 显示下载失败；用户可在短暂有效窗口内重试，超时后清除敏感值。 |

所有错误文本都不得包含 AT、RT、authorization code、PKCE verifier、Cookie 或完整响应体。

## 验收与测试

自动化测试至少覆盖：

- AT 本地预检的正常、无法解析和已过期路径。
- PKCE/state 创建、精确 callback 解析、错误 query、缺少 code、state 不匹配和重复 code。
- 1455 callback 捕获与后续连接失败的独立处理。
- token exchange 成功、失败和 RT 缺失；只有成功且 RT 非空时进入 `authenticated`。
- 下载内容仅为 RT，且下载完成、取消、错误、超时均清除敏感内存。
- 日志、错误对象、DOM 和测试断言不包含凭据明文。

手动验收应在已启用无痕权限的 Windows Chrome/Edge 中完成：真实用户走完实际出现的认证阶段，确认扩展只在
捕获匹配 callback 并完成 token exchange 后显示成功；确认 1455 没有监听服务时仍不会把连接错误误判为登录失败。
