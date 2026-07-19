# 协议自动化健全性与低侵入录制方案

## 目标

将页面自动化改造成可验证、可恢复、低侵入的协议流程：

```text
被动录制
  -> 脱敏接口轨迹
  -> 请求参数构造器
  -> 状态机执行器
  -> 响应校验器
  -> 持久化成功结果
```

重点不是增加重试次数，而是保持正确的会话上下文、请求顺序和状态边界。

## 一、请求参数的拼接方式

所有请求参数应由统一的 `RequestContext` 提供，不要在业务函数中散落拼接。

### 参数生命周期

| 生命周期 | 典型参数 | 处理方式 |
| --- | --- | --- |
| Profile 级 | UA、设备 ID、Cookie、IP、浏览器指纹 | 同一 profile 内复用 |
| 流程级 | CSRF、Sentinel、`continue_url` | 从当前流程响应中更新 |
| 请求级 | request ID、OTP、重试序号 | 每次请求单独生成 |
| 资源级 | `accessToken`、`session_id`、TOTP secret | 由接口响应产生并校验 |

### 参数来源原则

- `continue_url` 必须使用上一个接口返回值，不能自行拼接。
- `session_id` 必须使用 `mfa/enroll` 返回值。
- `accessToken` 必须使用最终 OAuth 回调后的 `/api/auth/session` 返回值。
- Sentinel 必须按当前 flow 生成；验证码重试时重新生成，不重建整个浏览器会话。
- Cookie、设备 ID、UA、出口 IP 不得从其他账号或其他 profile 复制。
- 密码、验证码、Token、Cookie、TOTP secret 不进入普通日志。

### Origin 专用 Header Builder

建议至少拆分以下构造器：

```text
buildChatGptHeaders(context)
buildAuthHeaders(context)
buildSentinelHeaders(context)
buildMfaHeaders(context)
```

不要用一个全局 Header 字典覆盖所有域名。不同 origin 的 `origin`、`referer`、`sec-fetch-*` 和 Cookie 上下文应保持隔离。

## 二、2FA 直接协议调用模型

注册完成并取得 `accessToken` 后，直接执行：

```text
GET  /backend-api/accounts/mfa_info
POST /backend-api/accounts/mfa/enroll
     { "factor_type": "totp" }
本地根据 enroll 返回的 secret 生成 TOTP
POST /backend-api/accounts/mfa/user/activate_enrollment
     {
       "code": "<current-totp>",
       "factor_type": "totp",
       "session_id": "<enroll-session-id>"
     }
GET  /backend-api/accounts/mfa_info
```

2FA 主流程不应再触发：

```text
reauth
第二次邮箱验证码
换取新 accessToken
```

只有最终 `mfa_info` 确认启用后，才允许把账号写成 `registered`。

## 三、状态机与错误处理

每一步都应明确输入、输出和失败分类：

```text
unregistered
  -> registering
  -> account-created
  -> token-ready
  -> mfa-enabled
  -> registered
```

### 重试规则

- 网络超时、连接重置、临时 5xx：有限重试。
- 邮箱验证码提交失败：只等待新的不同验证码，不重复提交旧码。
- 4xx、密码错误、风控、人机验证：立即停止，不盲目重试。
- 已创建账号但后续失败：记录为失败或待恢复，不能重新注册同一个邮箱。
- 同一个 Roxy profile 不允许并发注册。

### 响应校验

不要只判断 HTTP 200。应同时校验：

- 必要字段是否存在；
- URL 是否落在预期 origin 和页面；
- `accessToken` 是否存在；
- `mfa_enabled_v2` 是否为 `true`；
- 业务响应中的 `success` 是否为 `true`。

## 四、如何降低自动化引入的异常特征

- 同一流程复用同一个 Roxy profile、IP、UA、Cookie 和设备 ID。
- 保持真实页面导航和接口顺序，不做无意义的探测请求。
- 不主动刷新页面，不重复发送相同注册或验证码请求。
- 使用条件等待，避免高频轮询和固定的快速请求脉冲。
- 邮箱验证码服务与 ChatGPT 页面请求分离；邮箱 API 不经过 Roxy 页面。
- 失败时保留原始运行状态和日志，优先恢复当前流程，不重新创建账号。
- 发现风控页、人机验证或页面 origin 异常时立即停止。

这里的目标是减少自动化自身造成的异常行为，不是伪造或篡改浏览器身份。

## 五、低侵入网络监听方案

### 默认录制级别

使用外部 CDP/Playwright 连接现有 Roxy 浏览器，只监听浏览器外部网络事件：

```text
requestWillBeSent
responseReceived
frameNavigated
```

默认只保存：

```text
method
resourceType
status
脱敏后的 URL
页面标题
主 frame URL
```

### 默认禁止

- `page.evaluate` 注入 hook；
- `page.addInitScript`；
- hook `fetch` 或 `XMLHttpRequest`；
- DOM click/input/change/keydown 监听；
- localStorage、sessionStorage、Cookie、Token 读取；
- 请求拦截、mock、篡改响应；
- 自动点击、自动输入真实密码或验证码。

### 确需查看请求体时

只在一次明确的手动操作期间采集，并且优先保存：

```text
字段名
字段类型
字段长度
是否为空
值的哈希或 <redacted>
```

不要把真实密码、OTP、Authorization、Cookie 或 TOTP secret 写入录制文件。录制应有明确的 `start` 和 `stop` 标记，只分析标记后的事件。

## 六、下一项自动化的改造清单

1. 确认真实入口按钮和最终成功状态。
2. 先被动记录一次手动流程，不注入页面脚本。
3. 从源码和网络轨迹提取请求 method、URL、headers 和 body schema。
4. 建立 `RequestContext`，集中管理 Token、设备 ID、origin 和 flow 状态。
5. 为每个 origin 编写独立请求构造器。
6. 为每个接口添加响应字段校验。
7. 增加状态机、有限重试和断点日志。
8. 先跑 fake response/单元测试，再使用一个新的测试账号做真实验证。
9. 验证数据库状态、远端状态和浏览器是否仍保持打开。

## 七、补号 2FA 协议边界

补号 2FA 协议复用 `roxy_2fa_auth_login.js` 已验证的请求顺序，但不改动原有
DOM 状态机：

```text
OAuth authorize
  -> authorize/continue
  -> password/verify
  -> mfa/issue_challenge
  -> mfa/verify
  -> add-phone/send（可选；4xx 不直接终止）
  -> phone-otp/validate
  -> workspace/select
  -> accounts/consent
  -> oauth2/auth
  -> oauth/token
```

`add-phone/send` 返回 4xx 时，只有在后续手机验证码上下文可继续且
`phone-otp/validate` 成功后，才认定手机号阶段完成；否则保留原始失败原因。

短信验证码请求使用独立 transport：

```text
OpenAI/Auth/OAuth -> Roxy CDP 页面上下文
SMS API           -> 本地 HTTP transport -> SMS_API_PROXY（可选）
```

短信接口不读取 Roxy Cookie、不会调用 `page.request`，也不参与 OpenAI 会话的
出口 IP/UA 绑定。协议模式通过 `REPLACEMENT_2FA_PROTOCOL_ENABLED=1` 显式启用，
默认保留旧自动化作为回退。

## 验收标准

- 真实流程不需要无意义的第二次邮箱验证码。
- 失败不会重复注册或错误标记账号成功。
- 所有动态参数均来自当前会话或上一个响应。
- 日志和录制文件不包含敏感明文。
- 同一 profile、IP、UA 和 session 在一次流程内保持一致。
- 最终状态有远端接口和本地数据库双重证据。
