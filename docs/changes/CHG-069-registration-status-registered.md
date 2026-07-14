# CHG-069 注册成功状态与新增默认状态

状态：implemented

创建日期：2026-07-04

关联 PRD：PRD-003

影响范围：`src/db.js`, `src/replacementAccounts.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md`, `docs/work/`

## 背景

注册自动化成功后，补号账号只写入 `codex_2fa`，业务状态仍可能停留在 `unregistered`，导致后台列表无法区分“未注册”和“已注册但未开通 Plus”的账号。同时新增补号账号默认状态此前为 `for_sale`，与“先注册后进入后续阶段”的流程不一致。

## 决策

- 新增业务状态 `registered`，前端显示为“已注册”。
- 新增补号账号默认状态改为 `unregistered`。
- `POST /replacement-accounts/:id/register` 成功后调用仓储方法把账号状态改为 `registered`，并继续写入注册后 2FA secret。
- 手动状态编辑允许选择 `registered`。

## 验收

- [x] 新增账号默认返回 `status=unregistered`。
- [x] 注册接口成功返回 `status=registered`。
- [x] 注册成功后 `codex_2fa` 写库逻辑保持不变。
- [x] 前端状态筛选、行内状态下拉、编辑弹窗均包含“已注册”。

## 回滚

将 `registered` 从状态枚举和前端选项中移除；注册接口恢复为只写 `codex_2fa`；新增账号默认状态恢复为 `for_sale`。
