# CHG-044 CPA 同邮箱多凭证任一健康即视为正常

- 状态：merged
- 创建日期：2026-06-11
- 关联 PRD：PRD-003
- 影响范围：`src/cpaCredentialMonitor.js`, `src/cpaRepairWorker.js`, `test/cpaCredentialMonitor.test.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/`

## 背景

CPA `/auth-files` 可能同时返回同一邮箱的多个凭证记录，其中部分旧凭证已经 `auth_unavailable`，但另一个凭证为 `ready` 或 `active`。此前巡检和补号后复查只要看到同邮箱任一异常记录，就会继续判定该邮箱异常，导致补号后仍报：

`uploaded CPA credential is still unhealthy`

## 变更

- CPA 健康巡检按邮箱归并状态：同一邮箱只要存在一个健康凭证，就不再把该邮箱的其他异常凭证加入 `unhealthy` 或触发补号。
- CPA repair worker 上传后复查按邮箱判断：同一邮箱只要存在一个健康凭证，补号复查即通过。
- 若同邮箱没有任何健康凭证，仍按原逻辑报错或触发补号。

## 验收

- 同一邮箱同时存在 `auth_unavailable` 旧凭证和 `active` 凭证时，`/cpa/auth-health` 不再对该邮箱入队补号。
- 同一邮箱同时存在 `auth_unavailable` 旧凭证和 `active` 凭证时，补号后 CPA 复查成功，不再因为旧异常凭证失败。

## 验证

- `node --test test\cpaRepairWorker.test.js test\cpaCredentialMonitor.test.js` 通过，8/8 pass。

## 合并记录

- 合并目标：PRD-003
- 合并日期：2026-06-25
