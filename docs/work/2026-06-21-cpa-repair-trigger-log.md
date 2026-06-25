# 2026-06-21 CPA 自动补号触发原因日志

## 背景

用户反馈补号成功后仍然持续补号，希望下次能直接从日志判断为什么执行了补号。

## 本次处理

- `src/cpaRepairWorker.js`
  - 接收自动巡检入队时携带的 `credential` 和 `reasons`。
  - 整理 provider、email、CPA status、unavailable、disabled、reasons、`status_message`。
  - 对未提前写入触发原因的 replacement service 做 fallback 日志补写。
- `src/replacementServices.js`
  - `replaceAccount(account, options)` 支持 `cpaTriggerDetails`。
  - 真实 Roxy OAuth 子进程 run log 在 `validate-account` 后写入 `step=cpa-trigger`，即使后续 OAuth 自动化失败也保留触发原因。
- `test/cpaRepairWorker.test.js`
  - 新增测试覆盖 CPA trigger reason 写入 run log。
- `docs/project/api.md`
  - 补充 CPA 自动补号运行日志中的 `cpa-trigger` 诊断字段。

## 验证

- RED：新增测试先失败，日志缺少 `step=cpa-trigger`。
- GREEN：`node --test test\cpaRepairWorker.test.js` 通过，5/5 pass。
- 回归：`node --test test\replacementServices.test.js` 通过，15/15 pass。

## 结果

后续自动补号日志中可直接搜索：

```text
step=cpa-trigger action=记录 CPA 自动补号触发原因
```

用于确认本次是 CPA 返回 `auth_expired`、`status:error`、`unavailable` 等原因触发，还是其他状态导致。
