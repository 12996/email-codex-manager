# 2026-06-03 手动补号统一 CPA 上传链路与 Roxy 有头/无头策略

## 背景

手动补号成功生成本地 CPA JSON 后没有上传 CPA，因为手动接口直接调用 `replacementServices.replaceAccount()`；CPA 上传只在 `cpaRepairWorker.repair()` 自动补号链路中执行。

## 完成内容

- `POST /replacement-accounts/:id/replace` 在注入 `cpaRepairWorker` 时改走统一 repair worker。
- 生产启动链路已把同一个 `cpaRepairWorker` 注入手动补号接口和 CPA 自动监控。
- `src/auto/roxy_oauth_login.js` 新增 Roxy 开窗 headless 推导：
  - `ROXY_KEEP_OPEN=1` 默认有头并保留窗口。
  - `ROXY_KEEP_OPEN=0` 默认无头并关闭窗口。
  - `ROXY_HEADLESS=auto/true/false` 支持自动推导或显式覆盖。
- 修复 CPA 上传后复查：CPA 实际返回的 `status=active` 现在视为健康状态。
- CPA repair worker 现在会把 `cpa-read-file`、`cpa-upload`、`cpa-verify`、`cpa-success/cpa-failure` 追加写入同一个补号运行日志。
- `.env.example` 增加 Roxy/CPA 配置项说明。

## 验证

- `npm test -- test/replacementAccountsApi.test.js`
- `npm test -- test/roxyOauthLogin.test.js`
- `npm test -- test/cpaCredentialHealth.test.js`
- `npm test -- test/cpaRepairWorker.test.js`
- 真实 CPA 调用：`uploadAuthFile()` 返回 `{"status":"ok"}`，`listAuthFiles()` 可查到 `jregkolpig+s4@gmail.com` 为 `provider=codex,status=active`。
- 真实 repair worker 核心链路：跳过 OAuth、使用现有 CPA JSON 上传并复查，返回 `ok=true`，日志包含 CPA 上传/复查/成功步骤。

## 后续

- 实机运行手动补号时确认日志中出现 CPA 上传与上传后复查行为。
- 上线配置建议使用 `ROXY_KEEP_OPEN=0`、`ROXY_HEADLESS=auto`。
