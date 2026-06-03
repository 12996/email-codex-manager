# 2026-06-03 CPA 凭证健康检测与自动补号

## 背景

CPA 已暴露 `/v0/management/auth-files`，可读取运行时 auth file 状态。本次实现本地健康检测、失效分类、按邮箱匹配补号账号、单并发补号、CPA JSON 上传和复查。

## 完成内容

- 新增 `normalizeCpaConfig`，支持 `CPA_URL`、`CPA_MANAGEMENT_KEY`、`CPA_HEALTH_MONITOR_ENABLED`、`CPA_HEALTH_MONITOR_INTERVAL_MS`。
- 新增 `src/cpaClient.js`，封装 CPA `GET /auth-files` 与 `POST /auth-files?name=...`。
- 新增 `src/cpaCredentialHealth.js`，按状态、错误消息、quota 和 disabled 信号分类凭证健康。
- 新增 `src/cpaRepairQueue.js`，按补号账号 id 去重并保证 single-flight。
- 新增 `src/cpaRepairWorker.js`，串接补号子进程、本地 CPA JSON 读取、CPA 上传和上传后健康复查。
- 新增 `src/cpaCredentialMonitor.js`，执行一次 auth-files 检测，只有 `auth_expired` 才自动入队补号。
- 新增 `src/cpaCredentialMonitorRunner.js`，支持可选 interval daemon。
- 新增 `GET /cpa/auth-health`，后台登录后可手动触发检测。
- 更新 `.env.example`、`docs/project/api.md`、`docs/changes/CHG-019-cpa-auth-health-monitor.md`。

## 验证

- `npm test -- test/cpaConfig.test.js`
- `npm test -- test/cpaClient.test.js`
- `npm test -- test/cpaCredentialHealth.test.js`
- `npm test -- test/replacementAccounts.test.js`
- `npm test -- test/cpaRepairQueue.test.js`
- `npm test -- test/cpaRepairWorker.test.js`
- `npm test -- test/cpaCredentialMonitor.test.js`
- `npm test -- test/cpaCredentialMonitorApi.test.js`
- `npm test -- test/cpaCredentialMonitorRunner.test.js`

## 后续

- CPA 管理密钥修复后，先用后台登录态手动请求 `GET /cpa/auth-health`。
- 手动检测通过后，再设置 `CPA_HEALTH_MONITOR_ENABLED=true` 启用 10 分钟轮询。
- 实机验证时重点确认 CPA 上传接口接受 `POST /v0/management/auth-files?name=<email>.json` 的请求格式。
