# CHG-020 补号列表完整显示关键字段

- 状态：implemented
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

补号管理列表原先只展示部分字段，手机号会脱敏，长字段不适合在当前列宽内查看。用户要求关键字段必须在列表中完整显示，不允许省略；宽度不足时使用水平滚动。

## 变更

- 补号列表新增独立列展示：
  - `email`
  - `phone`
  - `sms_api`
  - `sms_last_error`
  - `activation_method`
  - `activated_at`
  - `status`
  - `status_updated_at`
  - `public_code_key`
  - `replacement_count`
- 手机号在补号列表中显示原文，不再脱敏。
- 表格最小宽度扩大，依赖外层 `.table-wrap` 水平滚动查看长字段。
- 新增长字段显示回归测试。

## 验收

- 指定字段在补号列表主表中均可见。
- `phone` 显示原文。
- `sms_api` 与 `public_code_key` 不被省略成 `...`。
- 页面宽度不足时，可通过水平滚动查看所有列。
