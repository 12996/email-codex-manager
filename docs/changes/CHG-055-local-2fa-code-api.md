# CHG-055 本地 2FA 验证码 API

状态：implemented

创建日期：2026-07-02

关联 PRD：PRD-003

## 背景

Roxy 2FA 补号已经支持使用 `codex_2fa` 作为 TOTP secret 本地生成验证码，但外部自动化程序仍缺少一个项目内 HTTP API 来按需获取当前 2FA code。对 `2fa.fun` 的运行时观察表明，其验证码由前端 `otplib.authenticator.generate(secret)` 本地生成，没有业务网络接口。

## 目标

- 在项目 API 中新增本地 TOTP 生成接口，供自动化程序调用。
- 默认参数与 Google Authenticator/`2fa.fun` 一致：`sha1`、6 位、30 秒周期。
- 本机自动化调用免后台登录态，远程调用仍要求后台登录态。

## 验收标准

- [x] `POST /api/2fa-code` 接收 JSON 请求体 `{ "secret": "<base32>" }`。
- [x] 成功响应包含 `code`、`expiresIn`、`step`、`digits` 和 `algorithm`。
- [x] 本机 `127.0.0.1` 请求不需要 `admin_auth`。
- [x] 缺少 secret 返回 `TOTP_SECRET_REQUIRED`。
- [x] 非法 Base32 secret 返回 `TOTP_SECRET_INVALID`。
- [x] 算法结果与 `2fa.fun` 同一 secret、同一时间戳下的结果一致。

## 实现记录

实现日期：2026-07-02

- 新增 `src/totpService.js`，实现 Base32 解码、HOTP、TOTP 和响应信息计算。
- `src/server.js` 新增 `POST /api/2fa-code`。
- 新增 `test/totpService.test.js`，并扩展 `test/replacementAccountsApi.test.js` 覆盖 API。
- 更新 `docs/project/api.md` 记录接口、请求体、响应和错误码。

验证：

```powershell
node --test test\totpService.test.js test\replacementAccountsApi.test.js
node --check src\totpService.js
node --check src\server.js
```

结果：相关定向测试通过，语法检查通过。

## 回滚

删除 `src/totpService.js`、移除 `src/server.js` 中 `/api/2fa-code` 路由，并删除相关测试和文档即可恢复。
