# CHG-025 banned 账号不触发自动补号

- 状态：merged
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

用户要求：设置为 `banned` 的号不要触发自动补号。此前 CPA 凭证如果出现 token 失效信息，即使对应补号账号已被手动标记为 `banned`，自动健康监控仍会进入补号队列。

## 变更

- CPA auth file 自身 `status=banned` 时分类为 `banned`，不再被 `status_message` 中的 token/refresh 关键词提升为 `auth_expired`。
- CPA 自动健康监控匹配到本地补号账号后，如果 `replacement_accounts.status=banned`，直接跳过入队。
- 跳过原因记录为 `account_banned`，便于区分“未匹配账号”和“已封禁账号不补”。

## 验收

- [x] `classifyCpaAuthFile()` 将 `status=banned` 分类为 `banned`。
- [x] 自动监控遇到本地 `banned` 补号账号时不会调用 `repairQueue.enqueue()`。
- [x] 自动监控结果中返回 `skipped.reason=account_banned`。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的 CPA 凭证健康检测与自动补号章节。
