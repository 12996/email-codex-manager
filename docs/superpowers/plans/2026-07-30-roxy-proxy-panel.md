# Roxy 代理配置面板实施计划

**目标：** 在补号管理页提供 Roxy 代理模板、Roxy proxyId 列表、窗口绑定和“刷新代理 + 指纹 + 浏览器”的受控操作；协议注册只复用准备完成后的 CDP endpoint。

## 固定规则

- 代理用户名：`{account_prefix}-region-{country}-sid-{random8}-t-{ttl_minutes}`。
- 当前账号前缀由用户配置，完整用户名与该前缀一致。
- 代理密码仅写入服务端持久化配置；API 和页面只返回 `passwordConfigured`，绝不回显明文。
- 一个窗口绑定一个 Roxy `proxyId`；窗口以 `dirId` 为稳定主键，`sortNum`/名称仅用于显示和初次选择。
- 切换代理只能在新任务启动前执行：修改 proxy resource -> close -> 清缓存 -> random fingerprint -> open -> connection_info。
- 不允许在运行中的 OAuth、协议注册或 CDP 会话里切换代理。

## 执行顺序

### Task 1：Roxy 客户端能力

**文件：** `src/auto/roxy-browser-client.cjs`  
**测试：** `test/roxyBrowserClient.test.js`

新增并测试：

1. `listProxies()`：读取 Roxy proxy list，返回 `id`、协议、host、port、用户名、备注等脱敏字段。
2. `detectProxyChannels()`：读取 `/proxy/detect_channel`，供前端选择 `checkChannel`。
3. `createProxy(payload)`：调用 `/proxy/create`，校验必填的 workspace、channel、协议、host、port、用户名和密码。
4. `modifyProxy(proxyId, payload)`：调用 `/proxy/modify`，每次刷新只更新当前绑定 proxyId 的用户名与必要代理字段。
5. `getBrowserProfile(dirId)` / `listBrowsers()`：返回目标窗口 `dirId`、sortNum、windowName 和可识别的当前代理关联信息；若官方 API 返回没有 proxyId，明确报错而不是猜测绑定关系。

**验收：** 单元测试精确断言 HTTP 方法、路径、token header、请求体字段与 response parsing。

### Task 2：数据库与配置仓储

**文件：** `src/db.js`、新增 `src/roxyProxySettings.js`  
**测试：** 新增 `test/roxyProxySettings.test.js`

新增表：

1. `roxy_proxy_templates`：保存 host、port、account_prefix、encrypted/protected password、country、ttl、protocol、ip_type、check_channel、refresh_url、remark、workspace_id。
2. `roxy_browser_proxy_bindings`：保存 `dir_id`、`proxy_id`、可显示的 sort_num/window_name、template_id、最后生成用户名、最近刷新 IP/时间。

仓储接口：

```text
getRoxyProxyTemplate()
saveRoxyProxyTemplate(input)
listRoxyProxyBindings()
upsertRoxyProxyBinding(input)
deleteRoxyProxyBinding(dirId)
recordRoxyProxyRefresh(dirId, result)
```

**验收：** 密码不出现在列表返回值；绑定按 `dir_id` 唯一；更新只影响目标窗口。

### Task 3：代理刷新服务

**文件：** 新增 `src/roxyProxyService.js`、`src/replacementServices.js`  
**测试：** 新增 `test/roxyProxyService.test.js`、修改 `test/replacementServices.test.js`

实现：

1. 生成 8 位字母数字 SID 和代理用户名。
2. 读取窗口绑定与模板，调用 `modifyProxy(proxyId, ...)`。
3. 串行执行 `closeBrowser -> clearLocalCache -> clearServerCache -> randomFingerprint -> openBrowser -> getConnectionInfo`。
4. 持久化新用户名、刷新时间、CDP endpoint 状态和出口 IP（仅保存 IP，不保存密码）。
5. 协议注册/协议补号准备流程按窗口绑定调用该服务；没有绑定时维持当前 Roxy 准备逻辑，不擅自切代理。
6. 运行中队列、当前浏览器连接或刷新失败时拒绝执行并返回可读错误。

**验收：** 调用顺序严格固定；仅刷新绑定的 proxyId；新子进程只收到刷新后的 `ROXY_CDP_ENDPOINT`。

### Task 4：服务端 API

**文件：** `src/server.js`  
**测试：** 修改 `test/replacementAccountsApi.test.js`

新增管理员 API：

```text
GET  /roxy-proxy-config
PUT  /roxy-proxy-config
GET  /roxy-proxies
GET  /roxy-proxy-channels
GET  /roxy-browser-proxy-bindings
PUT  /roxy-browser-proxy-bindings/:dirId
DELETE /roxy-browser-proxy-bindings/:dirId
POST /roxy-browser-proxy-bindings/:dirId/refresh
```

API 约束：配置读取不返回密码；写入密码留空代表保留旧值；refresh 需要确认该窗口没有运行中的协议任务。

**验收：** 非管理员拒绝；密码永不出现在响应或日志；错误状态正确映射为 4xx/5xx。

### Task 5：`web/index.html` 配置面板结构

**文件：** `web/index.html`  
**测试：** 修改 `test/replacementAccountsWeb.test.js`

在补号列表和协议日志区域之间新增 `#roxyProxyPanel`：

1. 代理模板表单：workspace、host、port、账号前缀、密码、国家、TTL、协议、IP 类型、查询渠道、刷新 URL、备注。
2. Roxy proxy 列表容器：显示 proxyId、地址、协议、当前用户名、备注。
3. 浏览器窗口绑定表格：窗口名、sortNum、dirId、绑定 proxyId、最近用户名、最近刷新时间、操作按钮。
4. 操作按钮：保存模板、创建代理、保存绑定、刷新并重开窗口、刷新列表。
5. 密码输入仅使用 `type=password`，不包含任何回显字段。

**验收：** 所有控件有稳定 id、label 和禁用态；页面无后端时显示“尚未配置/暂无窗口”，不出现伪成功。

### Task 6：`web/app.js` 状态、渲染与交互

**文件：** `web/app.js`  
**测试：** 修改 `test/replacementAccountsWeb.test.js`

新增：

1. `state.roxyProxyConfig`、`state.roxyProxies`、`state.roxyProxyChannels`、`state.roxyBrowserBindings`。
2. `loadRoxyProxyConfiguration()` 并接入 `loadInitialData()`。
3. `renderRoxyProxyPanel()`：渲染模板、脱敏密码状态、代理列表和窗口绑定下拉框。
4. 表单提交：`saveRoxyProxyConfig()`；密码空值不提交覆盖。
5. `saveRoxyBrowserBinding(dirId)`、`refreshRoxyBrowserProxy(dirId)`；刷新期间禁用同窗口按钮并显示当前阶段。
6. 所有 API 错误使用现有 `toast()` 和 `addActivity()` 记录，不泄漏代理密码。

**验收：** 前端请求体不携带旧密码；绑定成功后列表就地刷新；刷新失败恢复按钮可用态。

### Task 7：文档、回归与真实验证

**文件：** `docs/project/roxy-proxy-operation.md`、`docs/project/document-architecture.md`、`docs/changes/`、`docs/work/`  
**测试：** Task 1-6 的全量前端/服务端/协议专项测试。

记录：代理模板字段、proxyId 与 dirId 绑定、刷新顺序、回滚、禁止 OAuth 中切换代理，以及实际验证使用的非生产窗口。

**验收：** 所有新增 API 与配置字段有文档；变更记录状态为 `implemented`；真实验证不使用正在进行 OAuth 的窗口。

## 文件改动总表

```text
Modify  src/auto/roxy-browser-client.cjs
Modify  test/roxyBrowserClient.test.js
Modify  src/db.js
Create  src/roxyProxySettings.js
Create  src/roxyProxyService.js
Modify  src/replacementServices.js
Modify  src/server.js
Modify  web/index.html
Modify  web/app.js
Create/Modify corresponding test/*.test.js
Create/Modify docs/project, docs/changes, docs/work
```

前端的 Task 5 与 Task 6 可以先完成静态结构和 API 调用适配，但“创建/刷新”按钮必须在 Task 4 API 完成前保持禁用或显示“后端未实现”。
