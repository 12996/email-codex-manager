# 2026-06-03 公开验证码启用/停用专用操作

## 背景

用户反馈补号管理前端无法启用账号公开验证码功能。对照 PRD 与 CHG-015/CHG-018 后，确认预期是补号账号可启用 `public_code_enabled`，启用后公开 GET 接口按 key 获取验证码。

## 排查

- 实际数据库中 `jregkolpig+s3@gmail.com` 的 `public_code_enabled = 0`，`public_code_key` 已存在。
- 后端完整账号更新接口可以保存启用状态，但该路径依赖完整编辑表单。
- 为降低操作耦合，新增专用启用/停用接口和前端操作按钮。

## 完成内容

- 新增 `replacementAccounts.updatePublicCodeAccess`。
- 新增 `PATCH /replacement-accounts/:id/public-code`。
- 补号管理操作菜单新增 `启用公开验证码` / `停用公开验证码`。
- 新增 API 测试覆盖启用后 key 可命中、停用后 key 不命中。
- 新增前端静态测试覆盖专用操作入口。

## 验证

- `npm test -- test/replacementAccountsApi.test.js`
- `npm test -- test/replacementAccountsWeb.test.js`
- `npm test -- test/replacementAccounts.test.js`

## 后续

- 当前实际数据库中的 `jregkolpig+s3@gmail.com` 尚未自动改值；可以通过页面操作菜单点击“启用公开验证码”，或调用新接口启用。
