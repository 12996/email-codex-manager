# 2026-06-03 补号列表完整显示关键字段

## 背景

补号管理前端列表未完整展示补号账号运行字段，且手机号存在脱敏显示。用户明确要求关键字段必须完整显示，宽度不足时通过水平滚动查看。

## 完成内容

- 补号列表表头新增 `SMS API`、`SMS 错误`、`开通时间`、`状态更新时间`、`公开验证码 Key`。
- 列表行完整渲染 `email`、`phone`、`sms_api`、`sms_last_error`、`activation_method`、`activated_at`、`status`、`status_updated_at`、`public_code_key`、`replacement_count`。
- 移除列表手机号脱敏调用。
- 表格最小宽度调整为 `2600px`，继续使用 `.table-wrap { overflow: auto; }` 提供水平滚动。
- 新增 `replacement account table fully displays required runtime fields` 测试。

## 验证

- `npm test -- test/replacementAccountsWeb.test.js`

## 后续

- 若后续字段继续增加，优先追加表格列并保留水平滚动，不要重新引入省略显示。
