# CHG-005 合并邮箱账号页面到 web 前端

状态：implemented
创建日期：2026-06-01
关联 PRD：
关联 Issue：
影响范围：`web/accounts.html`、`web/accounts.js`、`web/styles.css`、`src/server.js`、`test/accountsWebApi.test.js`、`docs/project/api.md`、`docs/work/`

## 背景

原邮箱账号管理页面由 `src/views.js` 服务端渲染，风格与新增补号账号页面不一致。用户要求将该页面合并到 `web/` 文件夹下，并适配当前后台管理系统风格。

## 变更内容

- 新增：`web/accounts.html` 新版邮箱账号管理页面。
- 新增：`web/accounts.js`，通过 JSON API 完成账号列表、新增、编辑、删除、测试连接和获取邮件。
- 修改：恢复获取邮件时的读取位置和数量控件，支持 `收件箱`、`全部邮件`、`垃圾箱`，并增加测试连接/获取邮件的即时 loading 反馈。
- 修复：补回邮箱账号表格中的 `Gmail 密码`、`2FA`、`App Password` 三列显示。
- 修改：邮箱账号列表和邮件结果区域固定显示 5 条可视内容，超出后在区域内滚动，避免页面被长列表撑高。
- 修改：邮件结果默认只展示邮件摘要行，点击邮件行后再展开完整邮件内容；结果面板保留 5px 内边距。
- 修改：获取邮件默认数量从 30 调整为 5，保持页面稳定。
- 修改：`src/server.js` 中 `GET /accounts` 改为返回 `web/accounts.html`。
- 新增：`/api/accounts*` JSON API，供新版前端调用。
- 保留：旧表单接口和 `src/views.js`，用于登录页和兼容旧 POST 表单流程。
- 更新：API 文档、change 记录和工作记录。

## 验收标准

- [x] `/accounts` 需要登录后访问，并返回 `web/accounts.html`。
- [x] 邮箱账号前端文件位于 `web/` 目录。
- [x] 页面风格与补号管理页面保持一致。
- [x] 页面支持新增、编辑、删除、测试连接和获取邮件。
- [x] 获取邮件保留读取位置和数量选择，避免固定只读收件箱。
- [x] 测试连接和获取邮件点击后立即显示操作反馈。
- [x] 邮箱账号列表保留 Gmail 密码、2FA 和 App Password 显示。
- [x] 邮箱账号列表和邮件结果区域默认只展示 5 条可视内容，超出内容通过滚动查看。
- [x] 邮件内容默认折叠为摘要行，点击后才展开完整内容。
- [x] 获取邮件默认数量为 5。
- [x] JSON API 测试覆盖创建、列表、更新、测试连接、获取邮件和删除。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：当前 change 已实现。未合并的 implemented change 已达到 5 个，应安排 PRD 基线合并。
