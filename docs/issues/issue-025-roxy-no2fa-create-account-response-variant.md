# issue-025 Roxy 无 2FA browser runner 误拒绝 create_account 响应变体

状态：active
发现日期：2026-08-03
关联 Change：`CHG-104-roxy-no2fa-browser-registration.md`

## 现象

一枚新的未注册账号在 browser runner 中完成邮箱、OTP、资料页填写和 `Finish creating account` 提交后，
`POST /api/accounts/create_account` 已满足 HTTP 2xx 及请求字段 `name`、`birthdate`，但响应 body 未被识别为
`page.type=external_url`，runner 以 `NO2FA_PROFILE_RESPONSE_INVALID` 停止。

该次停止后，同一 Roxy 页实际已位于 ChatGPT 首页。将可见页面导航到
`https://chatgpt.com/api/auth/session` 后，session 的邮箱归属与当前补号账号匹配，且存在非空 AT；AT 已先落盘，
随后状态回写为 `registered`。敏感值未记录。

## 影响

- 当前 browser runner 会把已完成的资料提交误判为失败，无法自行执行最终 session 导航、AT 落盘和状态回写。
- 不能仅因 URL 为 ChatGPT 首页放宽 guard；必须保留请求字段校验，并以可见 session 页的非空 AT 和邮箱归属作为
  额外终态证据。

## 下一步

1. 使用新的 `unregistered` 测试账号，在资料页提交前启动 schema-only network recorder，保存 `create_account`
   响应的非敏感结构（页面类型字段、响应 body 是否可读、状态码）。
2. 对比历史 `external_url` 响应与本次变体，确定是服务端响应形状变化还是 Playwright response body 读取竞态。
3. 先写“2xx + 正确字段 + 响应 body 不可读/变体，但随后 session 邮箱和 AT 均有效”的回归测试，再以最小改动
   调整状态机；不得仅按 ChatGPT URL 判定成功。
