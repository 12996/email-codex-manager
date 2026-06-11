# 2026-06-08 补号列表长字段截断与复制

## 背景

补号管理主表长字段过多，尤其 SMS API 和邮箱验证码 API 会把列表横向撑得很长。用户要求每个字段限制显示长度，超出时提供复制按钮复制完整字段值。

## 实现

- `web/app.js`
  - 新增 `tableFieldLimits`。
  - 新增 `renderLimitedField()` 统一截断渲染长字段。
  - 新增 `copyAccountField()` 复制完整字段值。
  - 将主表中的邮箱、手机号、API、备注、开通信息、状态时间、公开验证码 Key、更新时间等字段接入统一渲染。
- `web/styles.css`
  - 新增 `.limited-field`、`.limited-field-text` 和 `.copy-field-button` 样式。
  - 使用 `text-overflow: ellipsis` 控制视觉截断。
- `test/replacementAccountsWeb.test.js`
  - 新增长字段截断与复制入口回归测试。

## 验证

- `node --check .\web\app.js` 通过。
- `node --test .\test\replacementAccountsWeb.test.js` 通过，9/9 pass。

## Change

- `docs/changes/CHG-043-replacement-table-limited-field-copy.md`
