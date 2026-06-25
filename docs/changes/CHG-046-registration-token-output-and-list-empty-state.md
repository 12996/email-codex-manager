# CHG-046 注册 access token 产物与列表空态显示

状态：implemented

日期：2026-06-25

关联 PRD：PRD-002

影响范围：`src/auto/roxy_register_openai.js`, `web/accounts.html`, `web/accounts.js`, `web/automation-logs.js`, `web/styles.css`, `.env.example`, `test/`, `docs/project/api.md`

## 背景

无头注册成功后，管理员无法看到最后的 `chatgpt.com/api/auth/session` 页面内容，需要把注册成功拿到的 `accessToken` 保存为本地产物，便于查看和排查。同时 `/accounts` 和 `/replacement-automation-logs` 在列表为空或筛选无结果时表格主体为空，容易误判为列表未显示。

## 变更

- `src/auto/roxy_register_openai.js` 在注册成功并拿到 `sessionData.accessToken` 后，保存本地 JSON 文件。
- 默认保存路径为 `src/auto/product_files/registration/<email>.json`；文件名使用补号邮箱号，仅替换 Windows 不允许的文件名字符。
- 支持 `REGISTRATION_TOKEN_OUTPUT_DIR` 覆盖注册 token 产物目录。
- 注册日志只输出 token 文件路径，不输出 access token 明文。
- 邮箱账号列表和补号日志列表在无数据时显示空态行。
- `/accounts` 页面改为复用统一 sidebar，使补号日志入口在邮箱账号页可见。

## 验收

- [x] 注册成功后能在本地看到 `<email>.json`，其中包含 `access_token`。
- [x] 子进程日志能看到 token 文件保存路径，但不包含 token 明文。
- [x] 邮箱账号列表为空或筛选无结果时显示“暂无邮箱账号”。
- [x] 补号日志列表为空或筛选无结果时显示“暂无补号运行日志”。
- [x] `/accounts` 页面 sidebar 显示补号日志入口。

## 验证

```powershell
node --test test\roxyRegisterOpenai.test.js
node --test test\replacementAccountsWeb.test.js
```

均通过。
