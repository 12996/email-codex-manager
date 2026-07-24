# 2026-07-24 协议注册日志面板缓存修复

- 运行态核对：`GET /protocol-registration-queue` 已返回当前任务的 Roxy 准备和子进程日志，后端日志链路正常。
- 根因：浏览器仍加载旧版 `web/app.js`，旧版将任务明细渲染在协议注册队列中。
- 修复：`web/index.html` 对 `web/app.js` 使用 `protocol-queue-status-only` 版本参数；`renderProtocolRegistrationQueue()` 不再拼接 `job.error`，队列仅显示状态和顺序，完整失败明细保留在“当前协议注册日志”面板。
- 验证：`replacementAccountsWeb.test.js` 18/18 通过；`node --check web/app.js` 通过。

## 协议注册 Roxy 无头配置

- 根因：协议注册的 `prepareProtocolRoxy()` 直接调用 Roxy `/browser/open`，未传递 `ROXY_HEADLESS` 推导出的启动参数。
- 修复：协议注册与其他 Roxy 流程统一读取 `.env`：`ROXY_HEADLESS=true/false` 显式覆盖；`auto` 时由 `ROXY_KEEP_OPEN=0` 推导无头。
- 验证：`replacementServices.test.js` 38/38 通过，覆盖 `ROXY_KEEP_OPEN=0` 传入 `--headless=new`。

## 补号账号注册 AT 快速复制

- 补号列表邮箱下方新增“复制 AT”按钮，通过已登录的本地管理接口读取 `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt`。
- token 文件不存在或为空时前端提示“AT 未找到”；token 不写入页面或数据库，只在用户点击时返回并复制。
- 验证：`replacementAccountsApi.test.js` 38/38、`replacementAccountsWeb.test.js` 19/19 通过。
