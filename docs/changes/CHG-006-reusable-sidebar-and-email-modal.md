# CHG-006 导航栏复用与邮箱详情弹窗优化

状态：merged
创建日期：2026-06-01
关联 PRD：PRD-002
关联 Issue：
影响范围：`web/sidebar.html`、`web/accounts.html`、`web/accounts.js`、`web/index.html`、`web/styles.css`、`src/server.js`、`test/accountsWebApi.test.js`

## 背景

1. 当前前端页面中，`accounts.html` 和 `index.html` 的侧边导航栏代码完全重复。如果需要修改导航栏，必须同时修改两个文件，维护非常不便。
2. 邮箱页面（`accounts.html`）在获取邮件后，邮件内容以 `details`/`summary` 折叠行的形式展示在列表中。用户希望点击邮件摘要后弹出一个模态框展示邮件的详细内容，而列表的获取样式和结构保持不变。

## 变更内容

- 新增：`web/sidebar.html` 公共导航栏 HTML 模板，移除无用的“系统设置”。
- 修改：`web/index.html`，移除了硬编码的侧边导航栏，改为使用 `<!-- SIDEBAR_PLACEHOLDER -->` 占位符。
- 修改：`web/accounts.html`，移除了硬编码的侧边导航栏并使用占位符，同时在页面中添加了邮件详情弹窗的 `<dialog id="mailDetailDialog">` 结构。
- 修改：`src/server.js`，在加载 `/accounts` 和 `/replacement-ui` 路由时，动态读取 `web/sidebar.html` 插入占位符处，并根据请求的路由高亮对应的导航链接（即通过向标签注入 `class="active"` 实现），确保导航栏的可复用性。
- 修改：`web/accounts.js`，修改邮件列表渲染，将 `details`/`summary` 结构更换为 `div` 结构，并且在点击行摘要时，通过 `state.fetchedMessages` 将邮件详情填充进 `mailDetailDialog`，然后以 `.showModal()` 弹出模态框展示。
- 修改：`web/styles.css`，添加了邮件详情弹窗 `#mailDetailDialog` 的 premium 样式，使其具备更宽的版面、平滑的滚动区域和磨砂玻璃背景。

## 验收标准

- [x] `/accounts` 和 `/replacement-ui` 使用同一个 `web/sidebar.html` 渲染侧边栏。
- [x] 当前所处的页面链接在侧边栏中正确显示 active 高亮。
- [x] 邮箱页面中获取邮件后的列表项样式不变，但点击后不再展开折叠行，而是弹出一个遮罩模态框显示邮件正文（包含 HTML 渲染）。
- [x] 点击模态框底部的“关闭”按钮或按下 Esc 键可正常关闭弹窗。
- [x] 所有单元测试均通过。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-01
- 备注：已成功合并入 PRD-002。
