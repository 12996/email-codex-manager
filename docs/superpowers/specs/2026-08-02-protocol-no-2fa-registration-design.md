# 无 2FA 协议注册设计

日期：2026-08-02

## 目标

新增 `src/auto/protocol_no_2fa_registration.py`，以 Roxy 的同一浏览器、指纹、
代理和 Cookie 上下文完成本次录制验证过的 OTP-first 注册流程。成功标准是
`GET https://chatgpt.com/api/auth/session` 返回非空 `accessToken`，并将纯 AT 写入
`src/auto/product_files/registration/<email>.txt`。该脚本不启用或写入 TOTP 2FA。

## 已确认的实际流程

2026-08-02 的 Roxy CDP 网络录制显示：

```text
signin/openai
-> auth /email-verification
-> POST /api/accounts/email-otp/resend
-> POST /api/accounts/email-otp/validate (page.type=about_you)
-> POST /api/accounts/create_account (page.type=external_url)
-> ChatGPT OAuth callback
-> GET /api/auth/session (accessToken)
```

本次流程没有 `user/register`，也没有密码阶段。因此新脚本不得访问密码页、
不得调用 `user/register`，且不修改现有 `protocol_registration/main.py` 的密码/2FA 流程。

## 设计

### Roxy 准备和连接

新增一个仅供该脚本调用的 Node 准备器，复用 `RoxyBrowserClient` 与
`createRoxyProxyService`，按 `test/manual-roxy-proxy-refresh.cjs` 的实际顺序执行：

```text
校验目标 profile / proxy
-> 修改代理会话 SID
-> 关闭浏览器
-> 清本地缓存
-> 清服务端缓存
-> 随机指纹
-> 打开浏览器
-> 读取 CDP connection_info
```

Python 只接收准备成功信号后，使用配置好的目标 profile 通过现有
`RoxyCdpClient` 连接 CDP；CDP endpoint、代理密码、Cookie、Token 不写入日志或
stdout。准备器从显式环境变量读取 profile 和代理模板，不复用测试文件中的硬编码
手工配置。

### Auth 状态机

每一步只在前一步 HTTP 状态、`page.type`、`method` 和 `continue_url` 明确匹配时推进：

1. 建立 ChatGPT OAuth 会话并进入 Auth `email-verification`；
2. 记录 OTP 时间下界，仅调用一次 `email-otp/resend`，要求 `200` 与
   `success=true`；
3. 取得当前会话的 `authorize_continue` Sentinel/SO token，提交 OTP；只有
   `200 + page.type=about_you + method=GET + continue_url` 才进入资料页；
4. 取得 `oauth_create_account` Sentinel/SO token，提交姓名和生日；只有
   `200 + page.type=external_url + method=GET + continue_url` 才执行 OAuth callback；
5. callback 成功后按有限退避轮询 `/api/auth/session`；仅非空 `accessToken` 为成功。

网络传输错误沿用 CDP bridge 的有限重试；`4xx`、阶段不匹配、重复/过期 OTP 与
不确定的非幂等请求结果均停止当前 OAuth transaction，不通过 URL 或 DOM 猜测强推。

### 产物和边界

- 复用 `save_registration_access_token_file()`，将纯 AT 原子地写入
  `REGISTRATION_TOKEN_OUTPUT_DIR`；默认目录为
  `src/auto/product_files/registration`。
- 不调用 `setup_2fa()`、不保存 TOTP secret、不将无 2FA 结果标记为现有补号流程的
  `registered` 状态。
- 运行日志只记录阶段、脱敏 URL、HTTP 状态和重试分类；不得输出 AT、OTP、密码、
  Cookie、CDP endpoint 或代理凭据。

## CLI 与配置

脚本是单账号工具，使用显式 `--email`、`--name`、`--birthday` 参数；未提供时依次回退到
`ROXY_REGISTER_EMAIL`、`ROXY_REGISTER_NAME`、`ROXY_REGISTER_BIRTHDAY`。验证码仍使用
既有 `REGISTRATION_EMAIL_CODE_API_URL` / replacement 邮箱读取配置。Roxy 目标和代理模板
采用专用 `ROXY_NO_2FA_*` 配置，缺失时以明确错误退出，避免意外选中其他 profile。

## 测试与验收

1. Python 单元测试验证录制的 OTP-first 请求顺序，且断言绝不调用密码/2FA API。
2. 回归测试覆盖：OTP 阶段短暂停留、`page.type` 不匹配、延迟错码、`accessToken` 延迟出现、
   无 token 的 session 响应。
3. Node 测试验证 Roxy 准备器按手动刷新顺序调用并且不向输出写入 endpoint 或密码。
4. 使用新的未注册邮箱和单一 Roxy profile 实机验证：AT 文件存在、内容仅为 AT，且没有
   TOTP/补号状态写入。

## 非目标

- 不改造、删除或回归现有密码 + 2FA 协议注册。
- 不通过普通 HTTP 客户端绕过 Roxy 页面上下文。
- 不把录制中的敏感请求值写入测试夹具或文档。
