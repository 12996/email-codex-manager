# 2026-06-25 注册 token 保存与列表空态

## 目标

- OpenAI 注册自动化成功后，在无头模式下保存最后 session 页面里的 `accessToken`，让管理员可在本地查看。
- 修复 `/accounts` 邮箱账号页和 `/replacement-automation-logs` 补号日志页列表为空时看起来“不显示”的问题。

## 变更

- `src/auto/roxy_register_openai.js`
  - 新增 `saveRegistrationAccessTokenFile()`。
  - 注册成功拿到 `sessionData.accessToken` 后，写入 `src/auto/product_files/registration/<email>.json`。
  - 文件名默认使用邮箱号；只替换 Windows 不允许的文件名字符。
  - 日志只输出保存路径，不输出 token 明文。
- `web/accounts.js`
  - 邮箱账号列表为空或筛选无结果时显示空态行。
- `web/automation-logs.js`
  - 补号运行日志列表为空或筛选无结果时显示空态行。
- `web/accounts.html`
  - 改为复用统一 sidebar，补号日志入口在邮箱账号页可见。
- `docs/project/api.md`
  - 补充注册成功后的 access token 产物路径、格式和敏感信息约束。
- `.env.example`
  - 补充 `REGISTRATION_TOKEN_OUTPUT_DIR`，用于覆盖注册 token 产物目录。
- 新增 change：`docs/changes/CHG-046-registration-token-output-and-list-empty-state.md`。

## 验证

```powershell
node --test test\roxyRegisterOpenai.test.js
node --test test\replacementAccountsWeb.test.js
```

结果：均通过。

## 注意

`src/auto/product_files/registration/<email>.json` 包含敏感 access token，已被 `.gitignore` 覆盖，不应提交或公开。
