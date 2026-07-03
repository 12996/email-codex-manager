# CHG-052 补号账号状态模型与行内编辑

状态：implemented

创建日期：2026-06-30

关联 PRD：PRD-003

## 背景

补号账号当前复用 `pending / active / banned / replacing / replaced / failed` 作为状态枚举，其中 `banned` 同时表达账号封禁和自动化连续失败熔断，导致业务状态与系统保护状态混在一起。前端状态设置也需要打开弹窗，批量整理账号库存时操作成本较高。

用户确认：旧 `pending` 语义迁移为“待出售”；熔断不再占用账号状态字段。

## 目标

- 将补号账号状态扩展为更贴近库存与开通流程的业务状态。
- 前端补号列表状态列直接使用下拉框修改账号状态。
- 前端状态筛选按新状态显示中文并筛选账号。
- 熔断只由连续失败和 `circuit_breaker_*` 字段表达，不再写成 `status=banned`。

## 状态模型

| 内部值 | 前端显示 | 说明 |
|---|---|---|
| `unregistered` | 未注册 | 账号尚未完成注册 |
| `pending_activation` | 待开通 | 等待开通 Plus |
| `plus_active` | 开通 plus | Plus 已开通 |
| `cpa_mounted` | CPA 挂载 | CPA 凭证已挂载/上传成功 |
| `for_sale` | 待出售 | 可出售库存；旧 `pending` 迁移目标 |
| `sold` | 已售出 | 已出售账号 |
| `banned` | 账号封禁 | 账号本身被封禁，不等同熔断 |
| `replacing` | 处理中 | 自动化执行中，系统状态，不允许人工手动选择 |
| `failed` | 失败 | 自动化失败或人工标记失败 |

旧状态兼容映射：

| 旧值 | 新值 |
|---|---|
| `pending` | `for_sale` |
| `active` | `plus_active` |
| `replaced` | `cpa_mounted` |
| `banned` | `banned` |
| `replacing` | `replacing` |
| `failed` | `failed` |

## 熔断规则

- 连续补号失败达到阈值时，账号 `status` 保持或变为 `failed`。
- 熔断状态由 `circuit_breaker_at IS NOT NULL` 判断。
- 熔断原因写入 `circuit_breaker_reason`，连续失败次数写入 `consecutive_replace_failures`。
- 解除熔断只清空熔断字段和连续失败次数，不强制把账号状态改回 `for_sale`。
- 前端列表在状态下拉旁显示“已熔断”徽标。
- 状态筛选保留业务状态筛选，并新增“已熔断”筛选项。

## 验收标准

- [ ] 新建补号账号默认状态为 `for_sale`，前端显示“待出售”。
- [ ] 后端接受新状态枚举，并拒绝手动设置 `replacing`。
- [ ] 旧状态输入兼容映射：`pending -> for_sale`、`active -> plus_active`、`replaced -> cpa_mounted`。
- [ ] 自动补号开始仍写入 `replacing`。
- [ ] 自动补号成功写入 `cpa_mounted`。
- [ ] 连续补号失败 5 次后状态为 `failed`，同时写入熔断字段，不再写入 `banned`。
- [ ] 解除熔断后状态保持解除前业务状态，不强制回到旧 `pending`。
- [ ] 补号列表状态列为中文下拉框，选择后调用状态 API 更新。
- [ ] 顶部状态筛选显示中文新状态，并支持“已熔断”筛选。
- [ ] `banned` 账号仍不进入 CPA 自动补号队列；已熔断账号也不进入自动补号队列。

## 回滚

可通过回滚本 change 涉及的代码和文档恢复旧状态模型。若生产数据库已有新状态值，回滚前需要将新状态按兼容映射反向转换为旧枚举。

## 实现记录

实现日期：2026-06-30

- 后端仓储和新库表结构默认状态改为 `for_sale`，并兼容旧状态输入和旧数据库行展示。
- 补号成功状态改为 `cpa_mounted`。
- 连续失败触发熔断时状态保持 `failed`，熔断由 `circuit_breaker_at` / `circuit_breaker_reason` 表达。
- `GET /replacement-accounts?circuit_breaker=1` 支持筛选已熔断账号。
- CPA 自动监控跳过已封禁账号和已熔断账号，跳过原因分别为 `account_banned` / `account_circuit_breaker`。
- 前端状态列改为行内下拉编辑，状态筛选显示中文新状态并支持“已熔断”。
- 状态行内下拉控件放大，并按当前账号状态显示不同背景色；切换下拉项时控件立即切换为对应状态色，保存失败则回滚。

验证：

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

结果：68/68 pass；所有 `node --check` 通过。

补充前端样式验证：`node --test test\replacementAccountsWeb.test.js` 通过，12/12 pass；`node --check .\web\app.js` 通过。
