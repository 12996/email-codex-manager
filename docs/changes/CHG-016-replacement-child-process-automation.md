# CHG-016 补号接口接入 Roxy OAuth 子进程自动化

状态：merged

创建日期：2026-06-02

关联 PRD：PRD-002

影响范围：`src/replacementServices.js`, `test/replacementServices.test.js`, `.env.example`, `docs/project/api.md`, `docs/work/`

## 背景

`src/auto/roxy_oauth_login.js` 已能完成 RoxyBrowser OpenAI/Codex OAuth 自动化。补号接口需要从补号账号表读取邮箱和短信接口，并通过正式后端入口触发该自动化。

## 变更

- `createReplacementServices()` 默认创建 Roxy OAuth 子进程适配器。
- `replaceAccount(account)` 默认使用 `child_process` 执行 `src/auto/roxy_oauth_login.js`。
- 子进程继承当前 `.env` / `process.env`，并用数据库账号行覆盖：
  - `replacement_accounts.email` -> `ROXY_OAUTH_EMAIL`
  - `replacement_accounts.sms_api` -> `PHONE_VERIFICATION_SMS_API_URL`
- 子进程退出码为 `0` 时，补号接口沿用现有逻辑标记 `replaced`。
- 子进程退出码非 `0` 或启动失败时，抛出 `REPLACE_FAILED`，补号接口沿用现有逻辑标记 `failed`。
- `.env.example` 补充 Roxy OAuth 自动化相关配置项。

## 验收标准

- [x] 不注入测试适配器时，`replacementServices.replaceAccount(account)` 会启动子进程。
- [x] 子进程 env 包含数据库账号邮箱和短信接口。
- [x] 子进程失败会转为 `REPLACE_FAILED`。
- [x] 已有注入式 `replacementAutomation` 仍可覆盖默认适配器，便于测试。

## 验证

- `node --test test\replacementServices.test.js` 通过。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入补号接口默认通过子进程执行 Roxy OAuth 自动化的要求。
