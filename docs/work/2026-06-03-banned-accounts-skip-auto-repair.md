# 2026-06-03 banned 账号不触发自动补号

## 背景

用户要求设置为 `banned` 的号不要触发自动补号。

## 完成内容

- `src/cpaCredentialHealth.js` 将 CPA auth file 的 `status=banned` 分类为 `banned`，即使 `status_message` 中包含 token/refresh 失效关键词，也不会归类为 `auth_expired`。
- `src/cpaCredentialMonitor.js` 匹配到本地补号账号后，如果账号状态为 `banned`，跳过自动补号入队。
- 自动监控结果中使用 `skipped.reason=account_banned` 表示“账号已封禁，不自动补号”。
- 新增 `CHG-025` 记录该长期行为变更。

## 验证

- `npm test -- test/cpaCredentialHealth.test.js`
- `npm test -- test/cpaCredentialMonitor.test.js`

## 后续

- 线上服务需要重启后才会加载该逻辑。
