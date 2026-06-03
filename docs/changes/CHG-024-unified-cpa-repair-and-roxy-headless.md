# CHG-024 手动补号统一 CPA 上传链路与 Roxy 有头/无头策略

- 状态：implemented
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

手动补号接口此前只运行 Roxy OAuth 子进程并生成本地 CPA JSON；CPA 上传和上传后复查只存在于 CPA 健康监控自动补号链路中。用户要求手动补号和自动补号走同一条链路，确保补号完成后都会上传 CPA。

同时，Roxy 自动化需要区分调试和上线运行：调试时有头运行并保留浏览器，上线时无头运行并关闭浏览器。

## 变更

- `POST /replacement-accounts/:id/replace` 在配置了 `cpaRepairWorker` 时改走 CPA repair worker。
- 手动补号和 CPA 自动补号统一执行：Roxy OAuth、读取本地 CPA JSON、上传 CPA、上传后健康复查、状态落库。
- `roxy_oauth_login.js` 新增 Roxy 开窗参数推导：
  - `ROXY_KEEP_OPEN=1` 默认有头运行并保留窗口。
  - `ROXY_KEEP_OPEN=0` 默认无头运行并关闭窗口。
  - `ROXY_HEADLESS=true/false` 可显式覆盖，`auto` 表示按 `ROXY_KEEP_OPEN` 推导。
- CPA 上传后复查兼容 CPA 返回的 `status=active`，不再只把 `ready` 当作健康状态。
- CPA repair worker 会把读取本地 CPA JSON、上传 CPA、复查 CPA 和成功/失败步骤追加写入同一个补号运行日志。
- `.env.example` 增加关键 Roxy/CPA 配置说明。

## 验收

- [x] 手动补号在生产注入 `cpaRepairWorker` 后不再直接调用裸 `replacementServices.replaceAccount()`。
- [x] 自动补号继续通过 `cpaRepairWorker.repair()` 上传 CPA 并复查。
- [x] `ROXY_KEEP_OPEN=1` 时默认不开启 `--headless=new`。
- [x] `ROXY_KEEP_OPEN=0` 时默认传入 `--headless=new`。
- [x] CPA 返回 `active` 时上传后复查通过。
- [x] 补号运行日志能看到 CPA 上传和复查步骤。
