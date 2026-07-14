# 2026-07-03 2FA补号接入 CPA 上传复查链路

## 目标

补齐 `POST /replacement-accounts/:id/replace-2fa` 成功后的 CPA 上传与健康复查链路，使 2FA 补号和普通 `/replace` 在生产环境下使用同一套 worker 收尾逻辑。

## 根因

- `src/auto/roxy_2fa_auth_login.js` 与普通 OAuth 脚本一样只负责完成登录、换 token、生成本地 `src/auto/product_files/cpa/<email>.json`。
- CPA 上传、`codex-<email>-plus.json` 命名、上传后健康复查和成功状态写入都在 `src/cpaRepairWorker.js`。
- `/replacement-accounts/:id/replace-2fa` 之前直接调用 `replacementServices.replaceAccountWith2FA()` 并立刻 `markReplacementSuccess()`，没有进入 worker。

## 实现

- `src/cpaRepairWorker.js`
  - `repair()` 新增 `mode` 参数。
  - `mode === '2fa'` 时调用 `replacementServices.replaceAccountWith2FA(account, { cpaTriggerDetails })`。
  - 默认仍调用 `replacementServices.replaceAccount(account, { cpaTriggerDetails })`。
  - 自动化 run 信息会随 worker 成功结果返回。
- `src/server.js`
  - `/replacement-accounts/:id/replace-2fa` 在有 `cpaRepairWorker` 时调用 `repair({ account, source: 'manual', mode: '2fa' })`。
  - worker 返回 `ok: false` 时按普通 `/replace` 返回 `REPLACE_FAILED`。
  - 没有 worker 时保留旧 fallback。
- `docs/project/api.md`
  - 更新 `replace-2fa` 的生产链路说明。

## 验证

- RED：`node --test test\cpaRepairWorker.test.js` 失败于 worker 固定调用普通 `replaceAccount()`。
- RED：`node --test test\replacementAccountsApi.test.js` 失败于 `/replace-2fa` 有 worker 时仍绕过 worker。
- GREEN：`node --test test\cpaRepairWorker.test.js` 通过 6/6。
- GREEN：`node --test test\replacementAccountsApi.test.js` 通过 21/21。
- 回归：`node --test test\cpaRepairWorker.test.js test\replacementAccountsApi.test.js test\replacementServices.test.js` 通过 52/52。
- 语法/空白：`node --check src\cpaRepairWorker.js`、`node --check src\server.js`、`git diff --check` 均通过。

## 待办

- 重启当前 `node src/server.js` 后，新路由逻辑才会在正在运行的后台服务生效。
- 可用真实账号从 UI 点击“2FA补号”验证：自动化完成后 CPA 后台出现 `codex-<email>-plus.json`，账号状态变为 `cpa_mounted`。
- 当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
