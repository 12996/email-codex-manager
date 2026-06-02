# CHG-004 新增补号账号前端页面

状态：merged
创建日期：2026-06-01
关联 PRD：PRD-002
关联 Issue：
影响范围：`web/`、`src/server.js`、`test/replacementAccountsWeb.test.js`、`docs/project/api.md`、`docs/work/`

## 背景

补号账号后端 API 已完成，需要按用户提供的管理后台截图实现补号列表前端页面，并将前端文件放在 `web/` 目录下。

## 变更内容

- 新增：`web/index.html` 补号管理页面。
- 新增：`web/styles.css`，实现侧边栏、统计卡片、筛选栏、表格、操作菜单、快捷操作、状态分布和弹窗样式。
- 新增：`web/app.js`，调用 `/replacement-accounts*` API 完成列表刷新、新增账号、获取验证码、获取 JSON、执行补号、状态设置、删除账号和详情查看。
- 修改：`src/server.js` 新增 `/replacement-ui` 页面入口，并通过 `/web/*` 受登录保护地提供静态资源。
- 新增：前端入口和关键操作文案测试。

## 验收标准

- [x] 前端文件位于 `web/` 目录。
- [x] `/replacement-ui` 需要登录后访问。
- [x] 页面包含补号列表、统计卡片、筛选、表格和操作菜单。
- [x] 截图中的“刷新”位置实现为“一键补号”。
- [x] 截图中的“列设置”位置实现为“新增账号”。
- [x] 操作菜单支持获取验证码、获取 JSON、执行补号、状态设置、删除账号。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-01
- 备注：已成功合并入 PRD-002。
