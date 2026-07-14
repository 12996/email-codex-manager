# CHG-065 2FA补号接入 CPA 上传复查链路

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

`POST /replacement-accounts/:id/replace-2fa` 只调用 2FA 自动化并标记补号成功，绕过了 `cpaRepairWorker`。因此 2FA 补号生成本地 CPA JSON 后不会上传到 CPA，也不会复查凭证健康，和普通 `/replace` 的生产链路不一致。

## 变更内容

- `/replacement-accounts/:id/replace-2fa` 在注入 `cpaRepairWorker` 时改走 `cpaRepairWorker.repair({ account, source: 'manual', mode: '2fa' })`。
- `cpaRepairWorker.repair()` 支持 `mode: '2fa'`，先调用 `replacementServices.replaceAccountWith2FA(account, { cpaTriggerDetails })`，再读取本地 CPA JSON、上传到 CPA、复查健康。
- 未注入 `cpaRepairWorker` 时，`replace-2fa` 保持旧 fallback：直接调用 `replacementServices.replaceAccountWith2FA(account)` 并由路由更新状态。
- worker 失败时，`replace-2fa` 与普通 `/replace` 一样返回 `REPLACE_FAILED`，并带回失败后的账号状态。
- worker 成功时返回自动化 run 信息，便于前端继续跳转查看日志。

## 验收标准

- [x] 2FA 补号在生产注入 CPA worker 时必须上传 `src/auto/product_files/cpa/<email>.json`。
- [x] 2FA 补号上传后必须复查 CPA auth file 健康，健康后才标记 `cpa_mounted`。
- [x] 无 CPA worker 的测试/本地模式保留直接 2FA 自动化 fallback。
- [x] 失败时沿用普通补号的失败返回和熔断/通知链路。

## 实现记录

实现日期：2026-07-03

- `src/cpaRepairWorker.js` 新增 `mode` 分支，支持普通补号和 2FA 补号共用 CPA 上传/复查尾段。
- `src/server.js` 的 `replace-2fa` 路由接入 CPA repair worker。
- `test/cpaRepairWorker.test.js` 增加 2FA worker 上传链路覆盖。
- `test/replacementAccountsApi.test.js` 增加 `replace-2fa` worker 成功、worker 失败和无 worker fallback 覆盖。
- `docs/project/api.md` 更新 `replace-2fa` 后端行为说明。

## 回滚

恢复 `replace-2fa` 路由为直接调用 `replacementServices.replaceAccountWith2FA()`，并移除 `cpaRepairWorker.repair()` 的 `mode: '2fa'` 分支即可回滚；回滚后 2FA 补号不会自动上传 CPA。
