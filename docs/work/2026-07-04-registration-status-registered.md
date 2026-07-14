# 2026-07-04 注册成功状态与新增默认状态

## 目标

让后台补号账号状态准确表达注册阶段：

- 新增账号默认是“未注册”。
- OpenAI 注册成功后自动变成“已注册”。

## 修改

- `src/replacementAccounts.js`
  - 新增手动业务状态 `registered`。
  - `createAccount()` 默认状态从 `for_sale` 改为 `unregistered`。
  - 新增 `markRegistrationSuccess()`，注册成功后统一写 `status=registered`、`codex_2fa`、`status_updated_at`。
- `src/db.js`
  - 新库表默认状态从 `for_sale` 改为 `unregistered`。
- `src/server.js`
  - `POST /replacement-accounts/:id/register` 成功后调用 `markRegistrationSuccess()`。
- `web/`
  - 状态筛选、编辑弹窗、行内状态下拉、图例和颜色增加 `registered/已注册`。
- `docs/project/api.md`
  - 更新状态枚举、新增账号默认状态和注册接口语义。

## 验证

- `node --test test\replacementAccounts.test.js` 通过，32/32。
- `node --test test\replacementAccountsApi.test.js` 通过，21/21。
- `node --test test\replacementAccountsWeb.test.js` 通过，12/12。

## 注意

- 旧数据不会自动批量迁移；本次只按用户当前调试上下文把已成功注册的 account `60` 补写为 `registered`。
- 旧状态 `pending` 仍兼容映射为 `for_sale`，不改变历史导入兼容逻辑。
