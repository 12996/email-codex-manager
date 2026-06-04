# document-architecture.md

记录本项目的文档结构、代码目录职责和主要运行链路。

## 1. 项目概览

本项目是一个本地 Gmail IMAP 管理与补号自动化服务：后端使用 Express + SQLite 管理 Gmail 账号、补号账号、验证码读取和 CPA 凭证健康检测；前端提供后台管理页面；RoxyBrowser/Playwright 自动化用于 OpenAI/Codex OAuth 登录与补号产物生成。

## 2. 本次扫描范围

- 扫描范围：整个项目根目录 `F:\work\email\gmail_IMAP`
- 扫描方式：使用 `rg --files` 建立文件清单，只读取关键入口、配置、仓储、服务、自动化和文档索引文件。
- 未展开范围：`node_modules/`、运行期数据库、运行期日志、截图产物和本地 `.env`。

## 3. 文档目录结构

| 目录 | 放什么 | 承载功能 | 入口 |
|---|---|---|---|
| `docs/prd/` | PRD 和 PRD 索引 | 需求真相源 | `docs/prd/PRD_REGISTRY.md` |
| `docs/changes/` | 日常需求、规则、结构或长期行为变更 | 变更闭环 | `docs/changes/CHANGE_REGISTRY.md` |
| `docs/project/` | 文档结构、API、部署等项目级说明 | 项目说明 | `docs/project/document-architecture.md` |
| `docs/templates/` | PRD、issue、work、handoff、test、decision 模板 | 格式复用 | `docs/templates/README.md` |
| `docs/memories/` | 项目风格、长期经验、重要决策 | 长期记忆 | `docs/memories/README.md` |
| `docs/issues/` | 缺陷、风险、排查和修复记录 | 问题追踪 | `docs/issues/README.md` |
| `docs/work/` | 工作索引、每日工作文档、日终交接 | 过程追踪 | `docs/work/handoff.md` |

## 4. 项目根目录结构

| 路径 | 职责 | 备注 |
|---|---|---|
| `src/` | 后端服务、数据仓储、IMAP、CPA、补号业务和自动化入口 | 主要运行时代码 |
| `src/auto/` | RoxyBrowser / Playwright 自动化脚本与客户端 | `roxy_oauth_login.js` 是补号 OAuth 核心脚本 |
| `web/` | 后台 Web 页面、补号页面、自动化日志页面及前端脚本 | 由 `/web` 静态挂载和部分服务端路由注入 sidebar |
| `public/` | 公共静态资源 | 当前主要是公共样式 |
| `test/` | Node 内置 test runner 测试 | 覆盖 API、仓储、IMAP、CPA、Roxy 自动化等 |
| `scripts/` | 辅助脚本 | 当前包含 Roxy codegen 脚本 |
| `docs/` | 项目文档体系 | 见第 3 节 |
| `html/` | 页面选择器或录制辅助资料 | 当前包含 `login_selector` |
| `data/` | 运行期数据库与自动化日志 | 本地生成，不作为需求/架构真相源 |
| `debug_image/` | 自动化失败截图 | 本地调试产物 |
| `package.json` | Node 项目元信息和脚本 | `npm start`、`npm test` |
| `.env.example` | 环境变量模板 | 不记录真实凭据 |
| `AGENTS.md` | AI 接手项目时的文档导航和工作规则 | 项目级硬约束 |

## 5. 主要入口与运行链路

### 5.1 启动入口

```text
npm start
  -> node src/server.js
  -> createDatabase(config.databasePath)
  -> createAccountRepository / createReplacementAccountRepository
  -> createReplacementServices
  -> createCpaCredentialMonitor + repair queue/worker
  -> Express 路由与静态页面
```

关键文件：

- `src/server.js`：Express app、页面路由、API 路由、鉴权中间件挂载。
- `src/config.js`：环境变量规范化与默认值。
- `src/db.js`：SQLite 表结构初始化与轻量迁移。
- `.env.example`：运行配置模板。

### 5.2 后台登录与页面

```text
/login
  -> src/views.js 渲染登录页
  -> POST /login 校验 ADMIN_PASSWORD
  -> src/auth.js 写入签名 Cookie
  -> /accounts 或 /replacement-ui
```

页面入口：

- `/accounts`：Gmail 账号管理，服务端渲染 HTML。
- `/replacement-ui`：补号账号管理，读取 `web/index.html` 并注入 `web/sidebar.html`。
- `/replacement-automation-logs`：补号自动化日志页面，读取 `web/automation-logs.html` 并注入侧边栏。
- `/web/*`：登录后访问的静态前端资源。

### 5.3 Gmail IMAP 与验证码链路

```text
账号配置
  -> src/accounts.js 持久化到 email_accounts
  -> src/imapService.js 使用 ImapFlow 拉取邮件
  -> findLatestVerificationCode 提取 6 位验证码
  -> /api/verification-code/latest 或 /api/verification-code/public/latest 返回验证码
```

关键规则：

- Gmail 登录使用 `gmail_app_password`。
- Gmail plus alias 会通过 `deriveMainGmailAccount` 还原主账号登录，同时保留 alias 收件匹配。
- 本机请求 `/api/verification-code/latest` 可免后台登录；公网公开接口使用补号账号的 `public_code_key`。

### 5.4 补号账号与 Roxy OAuth 自动化链路

```text
web/app.js
  -> /replacement-accounts CRUD
  -> /replacement-accounts/:id/replace
  -> src/replacementAccounts.js 标记 replacing
  -> src/replacementServices.js 启动 Node 子进程
  -> src/auto/roxy_oauth_login.js
  -> RoxyBrowser CDP + Playwright 执行 OpenAI/Codex OAuth
  -> 生成 sub2api/cpa JSON
  -> 回写补号状态和自动化日志
```

关键文件：

- `src/replacementAccounts.js`：补号账号仓储、状态流转、公开验证码 key。
- `src/replacementServices.js`：短信验证码获取、JSON 获取、补号子进程调度、日志写入、停止运行。
- `src/replacementAutomationRuns.js`：自动化运行记录仓储。
- `src/auto/roxy-browser-client.cjs`：RoxyBrowser 本地 API 客户端。
- `src/auto/roxy_oauth_login.js`：OpenAI/Codex 登录、邮箱/手机验证码、token 交换、CPA JSON 输出。
- `scripts/roxy-codegen.cjs`：录制/调试辅助脚本。

### 5.5 CPA 凭证健康检测与自动补号链路

```text
CPA_HEALTH_MONITOR_ENABLED=true
  -> src/cpaCredentialMonitorRunner.js 定时触发
  -> src/cpaClient.js 拉取 CPA auth-files
  -> src/cpaCredentialHealth.js 分类凭证健康状态
  -> src/cpaCredentialMonitor.js 将过期凭证加入 repairQueue
  -> src/cpaRepairQueue.js / src/cpaRepairWorker.js 执行补号
```

关键规则：

- 只对可自动处理的过期认证类问题入队。
- `banned` 补号账号不会触发自动补号。
- 队列用于避免同账号重复补号。

## 6. 关键配置与存储

### 6.1 环境变量

| 变量 | 用途 |
|---|---|
| `ADMIN_PASSWORD` | 后台登录密码 |
| `SESSION_SECRET` | 后台 Cookie 签名密钥 |
| `DATABASE_PATH` | SQLite 数据库路径，默认 `./data/app.db` |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_SECURE` | Gmail IMAP 连接配置 |
| `MAIL_FETCH_LIMIT` | 默认邮件读取数量 |
| `DEFAULT_READ_LOCATION` | 默认读信位置 |
| `ROXY_API_BASE_URL` / `ROXY_API_PORT` / `ROXY_API_TOKEN` | RoxyBrowser 本地 API 连接配置 |
| `ROXY_WORKSPACE_ID` / `ROXY_BROWSER_DIR_ID` / `ROXY_BROWSER_SORT_NUM` / `ROXY_BROWSER_WINDOW_NAME` | RoxyBrowser 目标窗口定位 |
| `ROXY_CDP_ENDPOINT` | 复用已有 Roxy CDP 端点 |
| `ROXY_OAUTH_EMAIL` | 当前自动化登录邮箱，补号接口会按账号行注入 |
| `PHONE_VERIFICATION_SMS_API_URL` | 手机验证码 SMS API，补号接口会按账号行注入 |
| `VERIFICATION_CODE_API_URL` | 邮箱验证码读取 API |
| `ADMIN_AUTH_COOKIE` | 调用验证码 API 的后台 Cookie，本机请求通常可留空 |
| `ROXY_KEEP_OPEN` / `ROXY_HEADLESS` / `ROXY_ENSURE_CLOSED` / `ROXY_PROXY` | Roxy 自动化运行策略 |
| `CPA_URL` / `CPA_MANAGEMENT_KEY` | CPA 管理接口配置 |
| `CPA_HEALTH_MONITOR_ENABLED` / `CPA_HEALTH_MONITOR_INTERVAL_MS` | CPA 凭证健康监控开关与间隔 |

### 6.2 SQLite 表

| 表 | 职责 | 初始化位置 |
|---|---|---|
| `email_accounts` | Gmail 账号、IMAP app password、抓取状态和错误 | `src/db.js` |
| `replacement_accounts` | 补号账号、手机号/SMS API、状态、JSON、公开验证码 key | `src/db.js` |
| `replacement_automation_runs` | 补号自动化子进程运行记录和日志路径 | `src/db.js` |

### 6.3 运行期产物

| 路径 | 内容 |
|---|---|
| `data/app.db` | 默认 SQLite 数据库 |
| `data/automation-logs/` | 补号子进程日志 |
| `debug_image/` | Roxy OAuth 失败截图 |
| `src/auto/product_files/` | 自动化生成的 sub2api/cpa JSON（由脚本按需创建，未确认是否纳入版本管理） |

## 7. 代码目录与文件说明

### 7.1 `src/`

| 文件 | 职责 |
|---|---|
| `server.js` | Express app 工厂、页面路由、API 路由、鉴权与静态资源挂载 |
| `config.js` | 环境变量读取、默认值和 CPA 配置规范化 |
| `db.js` | SQLite 初始化、表结构和增量列迁移 |
| `auth.js` | 后台登录 Cookie 设置、清除和鉴权中间件 |
| `views.js` | 服务端渲染的登录页、账号页、编辑页 |
| `accounts.js` | Gmail 账号仓储与 IMAP 抓取状态更新 |
| `imapService.js` | Gmail IMAP 连接、邮件解析、验证码提取 |
| `readLocations.js` | 读信位置解析、自发邮件过滤规则 |
| `replacementAccounts.js` | 补号账号仓储、状态流转、公开验证码 key 管理 |
| `replacementServices.js` | SMS/JSON 拉取、补号自动化子进程调度、运行停止 |
| `replacementAutomationRuns.js` | 自动化运行记录与日志读取 |
| `cpaClient.js` | CPA 管理接口客户端 |
| `cpaCredentialHealth.js` | CPA 凭证健康分类 |
| `cpaCredentialMonitor.js` | CPA 凭证巡检与补号入队 |
| `cpaCredentialMonitorRunner.js` | 后台定时巡检启动器 |
| `cpaRepairQueue.js` | 自动补号队列与去重 |
| `cpaRepairWorker.js` | 自动补号执行器 |

### 7.2 `src/auto/`

| 文件 | 职责 |
|---|---|
| `roxy_oauth_login.js` | Roxy + Playwright OpenAI/Codex OAuth 主流程 |
| `roxy_oauth_steps_manual_test.js` | 手动验证入口 |
| `roxy-browser-client.cjs` | RoxyBrowser API 客户端 |
| `roxy_env_debug.js` | Roxy 环境诊断 |
| `oauth_login.js` | 可能为早期 OAuth 自动化脚本 |
| `creat_autn_url.js` | 可能为早期 auth URL 生成脚本，文件名疑似历史拼写 |
| `package.json` | `src/auto` 局部 CommonJS 配置 |

### 7.3 `web/`

| 文件 | 职责 |
|---|---|
| `index.html` / `app.js` / `styles.css` | 补号账号管理页面 |
| `automation-logs.html` / `automation-logs.js` | 补号自动化运行日志页面 |
| `accounts.html` / `accounts.js` | Gmail 账号管理前端页面 |
| `sidebar.html` | 复用导航栏 |
| `补号界面.png` | UI 截图/设计参考 |

### 7.4 `test/`

测试使用 Node 内置 test runner（`npm test` -> `node --test`）。主要覆盖：

- 后台登录与鉴权：`auth.test.js`
- Gmail 账号 API / 页面：`accounts*.test.js`
- IMAP 与读信规则：`imapService.test.js`、`readLocations.test.js`
- 验证码接口：`verificationCodeApi.test.js`
- 补号账号仓储/API/前端：`replacementAccounts*.test.js`
- 补号服务与自动化日志：`replacementServices.test.js`、`replacementAutomationLogPage` 相关测试
- RoxyBrowser 与 OAuth 自动化：`roxyBrowserClient.test.js`、`roxyOauthLogin.test.js`、`roxyCodegenFlow.test.js`
- CPA 健康检测与自动补号：`cpa*.test.js`

## 8. 文档维护规则

- 需求、验收标准和用户故事写入 `docs/prd/`。
- 日常需求、规则、结构或长期行为变更先写入 `docs/changes/`，并在实现后按状态推进。
- API 和部署说明写入 `docs/project/api.md`、`docs/project/deployment.md`。
- 每日过程记录写入 `docs/work/YYYY-MM-DD-主要工作内容.md`，索引更新到 `docs/work/work-log.md`，日终交接写入 `docs/work/handoff.md`。
- 长期经验写入 `docs/memories/`，缺陷排查写入 `docs/issues/`。
- 可执行代码不要放入 `docs/`。

## 9. 风险、遗留与不确定点

- `data/`、`debug_image/`、`src/auto/product_files/` 属于运行期或调试产物，文档只描述职责，不应作为需求或行为真相源。
- `src/auto/oauth_login.js`、`src/auto/creat_autn_url.js` 从命名看可能是早期脚本；未确认是否仍被运行链路引用。
- `README.md` 中仍指向旧路径 `docs/gmail-account-setup.md`、`docs/api.md`，当前文件清单显示对应内容已在 `docs/memories/gmail-account-setup.md` 和 `docs/project/api.md`；这是可能的文档链接遗留。
- `.env` 已存在但未读取；真实凭据和本地配置不应写入文档。

## 10. 本次更新

- 日期：2026-06-04
- 范围：整个项目根目录。
- 变更点：
  - 在既有文档目录表基础上补充项目级目录地图。
  - 增加启动、登录、IMAP 验证码、补号自动化、CPA 健康检测的运行链路。
  - 增加环境变量、SQLite 表、运行期产物和关键文件职责说明。
  - 标注可能遗留或未确认事项。
