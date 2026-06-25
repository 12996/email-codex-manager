# CHG-045 CPA 自动补号触发原因写入运行日志

- 状态：implemented
- 创建日期：2026-06-21
- 关联 PRD：PRD-002
- 影响范围：`src/cpaRepairWorker.js`, `src/replacementServices.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/`

## 背景

排查 CPA 自动补号反复执行时，历史运行日志只能看到 OAuth 自动化、CPA 上传和复查结果，无法直接看到本次为什么被 CPA 巡检判定为需要补号。

## 变更

- CPA 自动补号入队携带的 `credential` 和 `reasons` 会被整理成触发原因。
- 真实 Roxy OAuth 子进程运行日志会在自动化启动前写入 `step=cpa-trigger`。
- 日志包含 provider、email、CPA status、unavailable、disabled、分类 reasons 和截断后的 status_message。
- 如果使用测试或旧式 replacement service 未提前写入，CPA repair worker 会在拿到 run log 后补写同样的 `cpa-trigger` 记录。

## 验收

- 自动补号运行日志中能看到 `step=cpa-trigger action=记录 CPA 自动补号触发原因`。
- 自动化子进程失败时，真实运行日志仍应包含触发原因，便于判断是 `auth_expired`、`quota_limited` 还是其他 CPA 状态导致。
- 管理密钥、验证码和 token 类敏感信息仍不得写入日志。

## 验证

- RED：新增 `repair worker appends CPA trigger reason to replacement run log`，失败于日志中缺少 `cpa-trigger`。
- GREEN：`node --test test\cpaRepairWorker.test.js` 通过，5/5 pass。
- 回归：`node --test test\replacementServices.test.js` 通过，15/15 pass。
