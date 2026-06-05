# CHG-037 账号列表服务端分页

状态：merged
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/accounts.js`, `src/replacementAccounts.js`, `src/server.js`, `web/accounts.html`, `web/accounts.js`, `web/index.html`, `web/app.js`, `.gitignore`, `test/`, `docs/project/api.md`, `docs/work/`

## 背景

邮箱账号列表和补号账号列表此前都由后端一次性返回全部记录，前端只在浏览器内筛选并显示静态分页文案。数据量增长后会造成接口返回过大、页面渲染过多，并且用户看到的分页不是实际分页。

## 变更内容

- 新增：`GET /api/accounts` 支持 `page`、`pageSize`、`status`、`keyword` 查询参数，并返回 `pagination` 元数据。
- 新增：`GET /replacement-accounts` 支持 `page`、`pageSize`、`status`、`keyword` 查询参数，并返回 `pagination` 元数据。
- 修改：邮箱账号页面和补号管理页面通过服务端分页请求列表，分页控件支持每页 10/20/50 条、上一页和下一页。
- 保留：单条详情、创建、编辑、删除、测试连接、获取邮件、补号和注册接口行为不变。
- 保留：列表默认排序仍为 `id DESC`。

## 验收标准

- [x] `/api/accounts?page=2&pageSize=1` 返回第二页数据和分页元数据。
- [x] `/api/accounts` 可按 `status` 和 `keyword` 在服务端过滤后分页。
- [x] `/replacement-accounts?page=2&pageSize=1` 返回第二页数据和分页元数据。
- [x] `/replacement-accounts` 可按 `status` 和 `keyword` 在服务端过滤后分页。
- [x] 两个前端页面都有真实分页控件，并用 `page/pageSize/status/keyword` 查询列表接口。
- [x] API 文档说明分页参数和响应结构。

## 验证

- `npm test` 通过，194/194 pass。
- `node --check .\src\accounts.js` 通过。
- `node --check .\src\replacementAccounts.js` 通过。
- `node --check .\src\server.js` 通过。
- `node --check .\web\accounts.js` 通过。
- `node --check .\web\app.js` 通过。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-05
- 备注：已合并到 Gmail 邮箱账号列表和补号账号列表的服务端分页、服务端筛选和关键词搜索要求。
