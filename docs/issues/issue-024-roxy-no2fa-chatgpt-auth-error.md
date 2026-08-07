# issue-024 Roxy 无 2FA 浏览器 runner 在 ChatGPT callback 落入 auth/error

状态：resolved
创建日期：2026-08-03
关联 Change：`CHG-104-roxy-no2fa-browser-registration.md`

## 现象

一次新的浏览器 runner 实机验证已自动完成 Roxy 准备、邮箱 OTP、错码后的 `Resend email`、资料页填写及
`Finish creating account` 提交，但 ChatGPT callback 最终进入 `/auth/error`。

当前页面显示通用登录失败提示；同一浏览器上下文的 `/api/auth/session` 返回 HTTP 200，但不含
`accessToken`。因此不满足成功条件。

## 已确认事实

- Roxy CDP transport 和 Playwright 附着在本次页面操作期间正常。
- OTP 输入框、资料页姓名/年龄输入框及提交按钮均可操作；未进入 password、TOTP 或 `user/register` 分支。
- 历史成功录制显示 about-you 的实际请求为 `POST /api/accounts/create_account`，字段为 `name`、`birthdate`，
  成功响应 `page.type=external_url`。本次失败运行未在 callback 前开启 recorder，因此不能由输入框填写或按钮
  消失推断该请求契约已满足。
- 外部邮箱验证码 API 可访问。首次读取的瞬时异常已复现为 runner 缺少重试；旧码被拒绝后已复现为缺少
  `Resend email` 分支，二者均已修复并有回归测试。
- 修复前，通用的 `chatgpt.com` 判断会把 `/auth/error` 误分类为 `chatgpt-session`；现已改为
  `auth-error` 并以 `NO2FA_AUTH_ERROR` 终止。
- 最新测试账号未生成 AT 文件，补号状态仍为 `unregistered`；未伪造成功或补写状态。

## 待排查

1. 用新的未注册账号在 runner 启动前重新开启 CDP network recorder，记录 callback 前后的请求路径、状态码和
   非敏感响应分类。
2. 对比成功的手动 run 与失败 run 的 Roxy 代理刷新结果、callback 前页面 origin 及 cookie 名称集合；不记录
   Cookie 值、AT、OTP、CDP endpoint 或代理凭据。
3. 仅在得到可复现差异后决定是修正浏览器状态机还是将其记录为上游 ChatGPT/Roxy 网络失败。

## 已实施防护

- AT 仅在 `/api/auth/session.accessToken` 非空时落盘。
- about-you 提交前监听并校验 `create_account` 的 2xx 响应、字段名和 `external_url` 页面类型；任一缺失即在
  callback 前失败，不再继续读取 session。
- 任何 `auth-error`、session 空响应或状态机未确认都会保留补号 `unregistered`。
- 不重放当前失败账号的 OAuth 交易；后续验证使用新的未注册账号。

## 解决结果

在新的未注册账号上，以相同 Roxy 准备顺序启动 schema-only network recorder 后，browser runner 已完成
OTP、about-you、`create_account`、callback 和 session。录制确认 `create_account` 请求字段为
`name`、`birthdate`，响应 HTTP 200 且 `page.type=external_url`；浏览器 session 返回非空 AT，随后 AT
文件落盘并将补号回写为 `registered`。此前的 callback 错误未在干净账号和新增 profile guard 下复现。
