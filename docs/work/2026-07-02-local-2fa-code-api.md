# 2026-07-02 本地 2FA 验证码 API

## 背景

用户希望将 2FA 验证码生成能力封装成项目 API，供自动化程序直接调用。通过 `js-reverse-mcp` 观察 `https://2fa.fun/` 后确认页面没有业务网络接口，验证码由前端 `otplib.authenticator.generate(secret)` 本地生成，默认参数为 `sha1`、6 位、30 秒周期。

## 实现

- 新增 `src/totpService.js`：
  - Base32 secret 解码。
  - HOTP/TOTP 标准算法。
  - `getTotpCodeInfo(secret)` 返回 `code`、`expiresIn`、`step`、`digits`、`algorithm`。
- 新增 `POST /api/2fa-code`：
  - 请求体 `{ "secret": "<base32>" }`。
  - 本机调用免 `admin_auth`，远程调用仍复用后台登录态。
  - 支持 `timestampMs`、`step`、`digits`、`algorithm` 调试参数。
- 新增测试：
  - `test/totpService.test.js`
  - `test/replacementAccountsApi.test.js` 中补充 API 路由测试。
- 更新：
  - `docs/project/api.md`
  - `docs/changes/CHANGE_REGISTRY.md`
  - `docs/changes/CHG-055-local-2fa-code-api.md`

## 验证

RED：

```powershell
node --test test\totpService.test.js test\replacementAccountsApi.test.js
```

结果：新增服务模块缺失、`/api/2fa-code` 路由不存在导致测试失败。

GREEN：

```powershell
node --test test\totpService.test.js test\replacementAccountsApi.test.js
```

结果：21/21 pass。

后续完成前还需跑最终语法检查和定向回归。

## 待办

- 重启当前 `node src/server.js` 服务后，运行中的项目实例才会暴露 `/api/2fa-code`。
- 外部自动化调用时建议用 POST body 传 secret，不要把 secret 放到 URL query 中。
