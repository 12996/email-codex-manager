# 补号账号开通方式下拉与页面维护 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `/replacement-ui` 增加可扩展的开通方式目录、行内下拉修改和页面新增方式能力。

**Architecture:** 新增 `replacement_activation_methods` SQLite 目录表并幂等种子写入 6 个初始方式；账号继续保存字符串 `activation_method` 以兼容历史数据。Express 提供目录查询/新增和账号开通方式 PATCH 接口，前端复用状态下拉的乐观更新与失败回滚模式。

**Tech Stack:** Node.js、Express、SQLite/better-sqlite3、原生 HTML/CSS/JavaScript、Node test runner。

---

### Task 1: 建立开通方式目录仓储和数据库初始化

**Files:**
- Create: `src/replacementActivationMethods.js`
- Modify: `src/db.js`
- Test: `test/replacementActivationMethods.test.js`

**Step 1: Write the failing tests**

覆盖以下行为：

- 新数据库自动包含“越南直卡、upi、ideal、波兰、瑞士、pix 直卡”。
- 新增方式会 trim 并按创建顺序返回。
- 空值和大小写不敏感重复值分别返回 `ACTIVATION_METHOD_REQUIRED` 和 `ACTIVATION_METHOD_DUPLICATE`。

**Step 2: Run tests to verify they fail**

Run: `node --test test/replacementActivationMethods.test.js`

Expected: FAIL because the repository module and table do not exist.

**Step 3: Write minimal implementation**

- 导出 `DEFAULT_ACTIVATION_METHODS`。
- 在 `initializeSchema` 中创建目录表和大小写不敏感唯一索引，并使用 `INSERT OR IGNORE` 写入初始方式。
- 新仓储提供 `listMethods()`、`createMethod(input)`、`hasMethod(name)`。
- 使用现有 `codedError` 风格返回明确错误码。

**Step 4: Run tests to verify they pass**

Run: `node --test test/replacementActivationMethods.test.js`

Expected: PASS。

### Task 2: 增加账号开通方式仓储更新能力

**Files:**
- Modify: `src/replacementAccounts.js`
- Test: `test/replacementAccounts.test.js`

**Step 1: Write the failing test**

新增测试验证 `updateActivationMethod`：

- 能保存 `upi`。
- trim 输入。
- 空值能清空。
- 不存在账号返回 `ACCOUNT_NOT_FOUND`。

**Step 2: Run test to verify it fails**

Run: `node --test test/replacementAccounts.test.js`

Expected: FAIL because `updateActivationMethod` 不存在。

**Step 3: Write minimal implementation**

在账号仓储中新增独立更新方法，只更新 `activation_method`、`updated_at`，不覆盖其他字段。

**Step 4: Run test to verify it passes**

Run: `node --test test/replacementAccounts.test.js`

Expected: PASS。

### Task 3: 增加目录和账号 PATCH API

**Files:**
- Modify: `src/server.js`
- Test: `test/replacementAccountsApi.test.js`

**Step 1: Write the failing tests**

验证：

- `GET /replacement-activation-methods` 返回 6 个初始方式。
- `POST /replacement-activation-methods` 可新增方式，空值/重复值被拒绝。
- `PATCH /replacement-accounts/:id/activation-method` 可更新并持久化。
- 非目录方式被拒绝，空值可清空。

**Step 2: Run tests to verify they fail**

Run: `node --test test/replacementAccountsApi.test.js`

Expected: FAIL because routes are not registered。

**Step 3: Write minimal implementation**

- `createApp` 注入 `replacementActivationMethods = createReplacementActivationMethodRepository(db)`。
- 添加后台认证保护的 GET/POST 目录路由。
- 添加后台认证保护的账号 PATCH 路由。
- 扩展错误码推断和状态码映射：重复值返回 409，非法方式返回 400。
- PATCH 非空值先由目录仓储校验，空字符串转换为 `NULL`。

**Step 4: Run tests to verify they pass**

Run: `node --test test/replacementAccountsApi.test.js`

Expected: PASS。

### Task 4: 将补号页面改为动态开通方式下拉和管理弹窗

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Test: `test/replacementAccountsWeb.test.js`

**Step 1: Write the failing tests**

增加静态回归断言：

- 页面存在开通方式下拉和“管理开通方式”入口。
- `app.js` 加载目录、渲染下拉、调用两个新 API、处理失败回滚。
- CSS 为开通方式下拉提供与状态控件一致的尺寸和可操作样式。

**Step 2: Run tests to verify they fail**

Run: `node --test test/replacementAccountsWeb.test.js`

Expected: FAIL because the new controls and API strings do not exist。

**Step 3: Write minimal implementation**

- `state` 增加 `activationMethods`。
- 页面初始化先加载方式目录，再加载账号列表。
- `renderActivationMethodSelect(account)` 生成“未设置”、目录方式和必要的历史值临时选项。
- `changeActivationMethod` 复用状态下拉的乐观更新、PATCH、成功刷新和失败恢复。
- 账号新增/编辑弹窗使用动态 `<select>`。
- 增加管理弹窗和新增方式表单，新增成功后刷新目录。
- CSS 抽取与 `.status-select` 一致的基础尺寸到 `.activation-method-select`，不为动态名称硬编码颜色。

**Step 4: Run tests to verify they pass**

Run: `node --test test/replacementAccountsWeb.test.js`

Expected: PASS。

### Task 5: 更新 API、Change 和工作文档

**Files:**
- Modify: `docs/project/api.md`
- Create: `docs/changes/CHG-077-replacement-activation-method-catalog.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create: `docs/work/2026-07-14-replacement-activation-method.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Step 1: Write documentation**

- 记录数据表、初始方式、目录 API、账号 PATCH API 和页面新增方式流程。
- Change 初始状态为 `draft`，实现完成并验证后改为 `implemented`。
- 工作记录写明修改文件、测试命令、结果和遗留风险。
- 更新工作索引和交接文档。

**Step 2: Verify documentation references**

Run: `rg -n "CHG-077|replacement-activation-methods|activation-method" docs`

Expected: API、Change、工作记录和交接文档都能定位到同一行为。

### Task 6: Run focused regression tests

**Files:**
- Test: `test/replacementActivationMethods.test.js`
- Test: `test/replacementAccounts.test.js`
- Test: `test/replacementAccountsApi.test.js`
- Test: `test/replacementAccountsWeb.test.js`

**Step 1: Run focused suite**

Run: `node --test test/replacementActivationMethods.test.js test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js`

Expected: all tests pass。

**Step 2: Run full test suite**

Run: `npm test`

Expected: all existing and new tests pass；若仓库没有 `npm test` 脚本，则使用 `node --test test/*.test.js` 并记录实际命令。

**Step 3: Manually verify the local page**

- 打开 `http://localhost:13100/replacement-ui`。
- 确认六个方式出现在每行下拉框。
- 修改一个账号后刷新页面，确认值保持。
- 通过“管理开通方式”新增一个测试方式，确认它出现在下拉框。
- 确认状态下拉仍可正常修改。

