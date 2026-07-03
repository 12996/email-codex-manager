# 2026-06-30 补号账号状态模型与行内编辑

## 目标

将补号账号状态从旧的自动化状态枚举，调整为更贴近库存/开通/CPA 挂载流程的业务状态；同时把熔断从 `status=banned` 中拆出，使用独立熔断字段表达。

## 已确认设计

- 旧 `pending` 迁移为 `for_sale`（前端显示“待出售”）。
- `active` 迁移为 `plus_active`（前端显示“开通 plus”）。
- `replaced` 迁移为 `cpa_mounted`（前端显示“CPA 挂载”）。
- `banned` 只代表“账号封禁”，不再代表熔断。
- 连续补号失败 5 次时，`status=failed`，并写入 `circuit_breaker_at` / `circuit_breaker_reason`。
- 前端表格状态列改为下拉框，直接 PATCH 状态接口。
- 状态筛选显示中文状态，并新增“已熔断”筛选。

## 文档

- 新增 change：`docs/changes/CHG-052-replacement-account-status-model-and-inline-edit.md`，状态 `accepted`。
- 新增实施计划：`docs/plans/2026-06-30-replacement-account-status-model-and-inline-edit.md`。

## 已实现

- 仓储状态枚举、新库默认状态与旧状态兼容映射。
- API 熔断筛选参数与自动补号跳过规则。
- 前端行内状态下拉、中文标签和熔断徽标。
- 前端行内状态下拉已放大，并按状态显示不同颜色；切换状态时下拉框会立即换成对应状态色，保存失败则回滚。
- 项目 API 文档已更新。
- `CHG-052` 状态已更新为 `implemented`。

## 修改文件

- 后端：`src/db.js`、`src/replacementAccounts.js`、`src/server.js`、`src/cpaCredentialMonitor.js`、`src/cpaRepairWorker.js`
- 前端：`web/index.html`、`web/app.js`、`web/styles.css`
- 测试：`test/replacementAccounts.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`、`test/cpaCredentialMonitor.test.js`、`test/cpaRepairWorker.test.js`
- 文档：`docs/changes/CHG-052-replacement-account-status-model-and-inline-edit.md`、`docs/changes/CHANGE_REGISTRY.md`、`docs/project/api.md`、`docs/plans/2026-06-30-replacement-account-status-model-and-inline-edit.md`、`docs/work/2026-06-30-replacement-account-status-model.md`

## 验证

```powershell
node --test test\replacementAccounts.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js test\cpaCredentialMonitor.test.js test\cpaRepairWorker.test.js
node --test test\replacementAccountsWeb.test.js
node --check .\src\db.js
node --check .\src\replacementAccounts.js
node --check .\src\server.js
node --check .\src\cpaCredentialMonitor.js
node --check .\src\cpaRepairWorker.js
node --check .\web\app.js
```

结果：68/68 pass；所有语法检查通过。

补充前端样式验证：`node --test test\replacementAccountsWeb.test.js` 通过，12/12 pass；`node --check .\web\app.js` 通过。

## 后续

- 需要重启当前 `node src/server.js` 服务后，运行中的 `/replacement-ui` 才会加载新的状态下拉和接口逻辑。
- 当前未合并 PRD 的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`，未达到 5 个提醒阈值。
