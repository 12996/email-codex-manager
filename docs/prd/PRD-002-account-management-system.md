# PRD-002 账号管理系统需求文档

状态：active
创建日期：2026-06-01
最近基线合并：2026-06-05

## 1. 背景与目标

为了有效管理大量的 Gmail IMAP 邮箱账号，并支持下游账号的“补号”（即账号状态失效时通过短信验证码和自动化浏览器自动重新开通/替换）流程，需要建立一个账号管理系统。

系统核心目标：
- 统一管理主 Gmail IMAP 邮箱配置，支持在线连通性测试和邮件内容按需获取。
- 统一管理下游补号账号及其对应的开通方式、SMS API、JSON 元数据和补号状态。
- 提供基于指纹浏览器（RoxyBrowser）、Playwright、OpenAI 注册和 Codex OAuth 的自动化补号链路。
- 提供风格一致、高内聚且具备重用组件（如通用侧边栏、详情模态框）的响应式后台管理界面。

---

## 2. 功能范围与细则

### 2.1 Gmail 邮箱账号管理 (Gmail IMAP)

#### 数据模型
- `id`: 账号唯一标识 (自增整型)
- `display_name`: 备注/显示名称
- `gmail_email`: Gmail 邮箱号 (唯一，大小写不敏感)
- `gmail_password`: 登录密码 (密文显示)
- `gmail_2fa`: 2FA 密匙
- `gmail_app_password`: 应用专用密码
- `status`: 状态 (`active` 正常, `auth_failed` 授权失败, `error` 其他连接错误)
- `last_fetch_at`: 上次获取时间
- `last_fetch_status`: 上次获取状态 (`success` 成功, `failed` 失败, `idle` 未开始)
- `last_error`: 上次错误详情 (可点击打开详情弹窗)

#### 功能细则
- **账号操作**: 支持新增、编辑、删除。
- **列表分页与筛选**: 邮箱账号列表必须通过服务端分页加载，支持 `page`、`pageSize`、`status`、`keyword` 查询；页面支持每页 10/20/50 条、上一页、下一页和当前页显示，筛选状态或搜索关键词时回到第 1 页。
- **连通性测试**: 支持对单账号进行 IMAP 连通性测试，实时反馈 Loading 并更新最后状态。
- **邮件获取**:
  - 支持选择读取位置（收件箱 `inbox`、全部邮件 `all`、垃圾箱 `trash`）。
  - 支持限制获取数量（默认 5，范围 1 - 50）。
  - 邮件获取结果以列表展示在页面下方，默认最多显示 5 条可视内容并支持内部滚动。
  - 点击列表中的邮件摘要行，将弹出一个遮罩模态框 (`#mailDetailDialog`)，在其中渲染邮件主题、发件人、日期、文件夹以及纯文本或 HTML 富文本邮件内容。

---

### 2.2 补号账号管理 (Replacement Accounts)

#### 数据模型
- `id`: 账号唯一标识 (自增整型)
- `email`: 绑定邮箱 (大小写不敏感唯一)
- `phone`: 手机号
- `sms_api`: 短信验证码获取 API
- `activation_method`: 开通方式/渠道 (如 manual, auto)
- `activated_at`: 开通激活时间；新增补号账号时为空则由系统自动写入当前时间
- `status`: 状态 (`pending` 待补号, `active` 正常, `banned` 被封禁, `replacing` 补号中, `replaced` 补号成功, `failed` 补号失败)
- `status_note`: 状态变更备注
- `replacement_count`: 累计成功补号次数
- `json_payload`: 抓取成功的 JSON 原文内容
- `json_fetched_at`: 最近一次 JSON 抓取成功时间
- `last_replace_at`: 最近一次补号成功时间
- `last_error`: 最近一次 JSON 或补号错误
- `sms_last_error`: 最近一次短信验证码获取失败原因
- `public_code_enabled`: 是否允许通过公开验证码 key 获取该邮箱验证码
- `public_code_key`: 公开验证码接口使用的随机访问 key
- `remark`: 管理员备注
- `deleted_at`: 软删除时间

#### 功能细则
- **账号 CRUD**: 支持新增、编辑、软删除；新增时如果管理员未填写开通时间，系统自动补当前时间，显式填写时保留管理员输入值。
- **状态手动修改**: 支持管理员手动调整状态与状态备注，但不能手动调整为系统控制状态（如 `replacing`）。
- **获取验证码**: 手动触发向 `sms_api` 请求提取 6 位短信验证码，成功后以 Toast 提示并生成操作记录，验证码不落库。
- **公开验证码 key**:
  - 系统为补号账号生成不可猜测的 `public_code_key`。
  - 只有 `public_code_enabled = 1` 且未删除的补号账号，才允许通过公开 GET 接口按 key 获取邮箱验证码。
  - 公开接口不接收邮箱明文，避免外部系统枚举任意邮箱验证码。
  - 补号管理页必须展示公开验证码启用状态和 key。
  - 新增/编辑补号账号时，管理员可配置是否启用公开验证码，并可查看或覆盖 `public_code_key`。
  - 操作菜单应提供复制公开验证码 URL 的入口。
  - 操作菜单应提供一键启用和一键停用公开验证码入口；启用时保留已有 key，缺失时自动生成。
- **本机验证码获取**:
  - 本机自动化脚本调用 `POST /api/verification-code/latest` 可免后台登录态。
  - 非本机请求仍需要后台 Cookie 登录态。
- **获取 JSON**: 支持通过输入的 URL 抓取账号配置 JSON 信息并持久化于 `json_payload`，获取成功后清除最近错误。
- **注册 OpenAI**:
  - 支持管理员在补号管理页手动点击“注册”，调用 `POST /replacement-accounts/:id/register` 启动注册自动化。
  - 这里的“手动”仅指后台按钮或 API 手动触发；网页注册流程仍由后端子进程自动执行。
  - 注册脚本必须复用 RoxyBrowser 开窗和 Playwright CDP 接管流程，不允许主流程裸启动普通 Chromium。
  - 注册脚本从 `https://chatgpt.com/` 进入注册流程。
  - 注册阶段只使用邮箱验证码，通过 `POST /api/verification-code/latest` 和请求体 `{ "account": "<email>" }` 获取。
  - 注册阶段不得使用 `replacement_accounts.sms_api`，也不得向子进程注入 `PHONE_VERIFICATION_SMS_API_URL`。
  - 注册运行必须复用补号自动化运行记录和日志能力，日志以 `registration` 或 `[roxy-register-openai]` 区分。
  - 注册日志不得输出验证码、Cookie、token、代理密码等敏感明文。
- **一键补号 / 批量补号**: 
  - 支持单账号点击补号或多选批量补号。
  - 补号开始时状态流转为 `replacing`，执行 RoxyBrowser + Playwright + OpenAI/Codex OAuth 自动化流程。
  - 补号成功后，状态流转为 `replaced`，`replacement_count` 自动累加 1。
  - 补号失败后，状态流转为 `failed`，计数值不累加，将错误信息记录在最后操作信息中。
  - 正式补号入口默认以子进程执行自动化脚本，避免长流程直接占用主 Express 进程运行态。
  - 子进程补号必须创建运行记录，记录账号、状态、PID、日志路径、开始/结束时间、退出码和错误摘要。
  - 子进程 stdout/stderr 必须写入本地日志文件，并在补号日志页面可查看。
  - 补号和注册自动化运行记录及日志文件必须支持通过 `.env` 配置最大保留数量，默认保留最近 30 条；超过范围时自动清理旧数据库记录和日志文件，但不得清理仍在运行中的记录。
  - 运行中的子进程可从日志页面停止；服务只能停止当前进程内启动且仍被追踪的 child，不按历史 PID 盲杀系统进程。
  - 手动补号和 CPA 自动补号在配置 CPA repair worker 时必须统一执行：Roxy OAuth、读取本地 CPA JSON、上传 CPA、上传后健康复查和状态落库。
  - 设置为 `banned` 的本地补号账号不得触发 CPA 自动补号。
- **补号列表展示**:
  - 补号列表主表必须展示 `email`、`phone`、`sms_api`、`sms_last_error`、`activation_method`、`activated_at`、`status`、`status_updated_at`、`public_code_key` 和 `replacement_count`。
  - `phone` 在补号列表中显示原文，不做脱敏。
  - 长字段不得省略为 `...`；页面宽度不足时，通过表格外层水平滚动查看所有列。
  - 补号列表必须通过服务端分页加载，支持 `page`、`pageSize`、`status`、`keyword` 查询；页面支持每页 10/20/50 条、上一页、下一页和当前页显示，筛选状态或搜索关键词时回到第 1 页。

---

### 2.3 CPA 凭证健康检测与自动补号

#### 功能细则
- 系统支持通过 CPA 管理接口读取 `/v0/management/auth-files`，检查运行时凭证状态。
- CPA 管理密钥不得出现在日志或接口响应中。
- 凭证健康状态按 `provider + email` 分类聚合。
- 健康凭证不触发补号。
- `auth_expired` 凭证会按邮箱匹配本地补号账号并触发补号。
- 已处于 `replacing` 的账号不得重复触发补号。
- `disabled`、`quota_limited`、`banned` 和未分类异常只报告，不自动补号。
- CPA auth file 自身 `status=banned` 时分类为 `banned`，不因 status_message 中的 token/refresh 关键词提升为 `auth_expired`。
- 自动监控匹配到本地 `replacement_accounts.status = banned` 的账号时，必须跳过入队，并记录跳过原因 `account_banned`。
- 可选启用周期性 CPA 健康监控；默认间隔为 10 分钟。
- 补号成功后读取 `src/auto/product_files/cpa/<email>.json` 上传到 CPA，并再次检查凭证健康状态。
- CPA 上传后复查时，`status=ready` 和 `status=active` 均视为健康状态。

---

### 2.4 浏览器自动化适配 (RoxyBrowser & Playwright)

#### 功能细则
- 提供 RoxyBrowser 连接控制器，自动化流程必须按以下步骤执行：
  `关闭旧窗口 → 清理本地缓存 → 清理服务器缓存 → 刷新随机浏览器指纹 → 打开新窗口 → 查询 CDP 端口 → 使用 Playwright 接管 CDP`。
- 支持通过以下优先级解析定位指纹浏览器目标窗口：
  1. 环境变量/参数指定的目录 ID (`dirId`)。
  2. 窗口序号 (`sortNum`)。
  3. 窗口名称 (`windowName`)。
- Roxy 接口返回失败时应抛出包含明确 API 路径的描述性错误。
- CLI 应输出完整 CDP WebSocket 地址，并输出可直接复制到环境变量的 `ROXY_CDP_ENDPOINT=...` 复用提示。
- `ROXY_KEEP_OPEN` 和 `ROXY_ENSURE_CLOSED` 等关闭策略应在 `.env` 加载后生效。
- 支持复用已有 CDP；复用失败时可回退到正常 Roxy 开窗流程。
- Roxy 开窗有头/无头策略：
  - `ROXY_KEEP_OPEN=1` 默认有头运行并在流程结束后保留窗口。
  - `ROXY_KEEP_OPEN=0` 默认无头运行并在流程结束后关闭窗口。
  - `ROXY_HEADLESS=true/false` 可显式覆盖，`auto` 表示按 `ROXY_KEEP_OPEN` 推导。

#### OpenAI/Codex OAuth 自动化
- 自动化运行时代码归属 `src/auto/roxy_oauth_login.js`。
- 手动验证入口归属 `src/auto/roxy_oauth_steps_manual_test.js`。
- 当用户明确要求 Playwright codegen/录制并亲自走流程时，必须先启动 recorder/codegen；录制完成后再整理 selector、流程函数和测试。
- OAuth 自动化状态机应覆盖：
  1. OpenAI 邮箱登录页：填写目标邮箱并点击 `Continue`。
  2. 邮箱验证码页：调用验证码接口获取 6 位验证码并提交。
  3. 可选添加手机号页：从补号账号手机号或运行参数中读取手机号，填写 `Phone number` 并点击 `Continue`。
  4. 可选手机验证方式页：选择 `Text Message` 并继续。
  5. 可选手机验证码页：从 SMS API 响应中提取 6 位验证码并提交。
  6. Codex/ChatGPT 授权确认页：点击 `Continue`。
  7. OAuth callback：捕获 `code/state`，校验 state，并使用授权码换取 token bundle。
- 页面判断应优先使用稳定文本、ARIA role 和可见控件，不依赖易变 class。
- 自动化应输出可识别错误码，并在超时或页面不匹配时附带当前 URL、title 和 body 摘要。
- 自动化日志应记录关键页面动作，包括填写邮箱、请求/填写邮箱验证码、填写添加手机号、选择短信验证、请求/填写手机验证码、Codex 授权继续、callback 监听、callback 捕获和 token 交换路径；日志不得输出验证码、Cookie 或 token 明文。
- 页面步骤失败时默认截图到 `debug_image/`，截图文件名不得包含邮箱、验证码、API key 或 URL 等敏感信息。
- 邮箱验证码和手机验证码获取应支持轮询；验证码为空时只等待下一轮，不填写、不点击提交。
- 邮箱验证码轮询期间若页面已进入添加手机号、手机验证、Codex 授权确认或 OAuth callback 等后续阶段，应交回外层状态机继续，不再等待旧输入框。
- 添加手机号提交后等待阶段跳转时不得把仍停留在 `phone-add` 当作成功跳转；只有进入手机验证码、手机验证方式、Codex 授权确认或 OAuth callback 才视为有效后续阶段，持续停留应以明确超时错误失败。
- 手机验证码轮询或提交期间若页面已进入 Codex 授权确认或 OAuth callback，应交回外层状态机继续，不再等待旧输入框或重复点击旧组件。
- Codex 授权确认页点击 `Continue` 前应先监听 OAuth callback 请求并轮询当前 URL。
- 如果点击过程中捕获 `localhost:1455/auth/callback` 请求，应立即判定授权提交成功。
- 如果 callback 请求未被捕获，但页面 URL 已变化且 query/hash 中包含匹配本次 `state` 的 `code/state`，也应判定授权提交成功。
- 如果 OAuth callback 后页面变为 `chrome-error://chromewebdata/`，应通过 CDP navigation history 或 target URL 提取匹配本次 `state` 的 callback URL，并继续 token 交换。
- Codex 授权点击应使用独立短超时，避免长时间卡在 Playwright click 等待。
- Token 交换优先在浏览器页面上下文发起请求，以复用真实 Roxy 网络环境。
- 正式 Token 交换默认只走 Roxy 浏览器页面上下文，最多 3 次重试，单次默认 10000ms；每次页面上下文 fetch 应按单次超时主动 abort，避免迟到请求继续占用一次性 authorization code。
- 当前页面为 Chrome error、空白页或非 `auth.openai.com` origin 时，应在同一 Roxy browser context 中复用或新建 `https://auth.openai.com/` 页面，并在该页面上下文发起同源 token 请求。
- Playwright request 或 Node fetch 只保留为显式诊断能力，不作为正式 Token 交换默认 fallback，避免出口网络环境脱离 Roxy 浏览器代理。
- Token 交换成功后，应在本地生成账号认证 JSON：
  - `src/auto/product_files/sub2api/<email>.json`
  - `src/auto/product_files/cpa/<email>.json`
- `src/auto/product_files/` 下的认证文件包含敏感 token，禁止提交或公开。
- `POST /replacement-accounts/:id/replace` 默认通过子进程运行 `src/auto/roxy_oauth_login.js`：
  - 子进程继承 `.env` / `process.env` 中的 Roxy 配置。
  - `replacement_accounts.email` 覆盖子进程 `ROXY_OAUTH_EMAIL`。
  - `replacement_accounts.phone` 覆盖子进程 `ROXY_OAUTH_PHONE`。
  - `replacement_accounts.sms_api` 覆盖子进程 `PHONE_VERIFICATION_SMS_API_URL`。
  - 子进程退出码为 `0` 时视为补号成功；非 `0` 或启动失败时视为 `REPLACE_FAILED`。
- `POST /replacement-accounts/:id/register` 默认通过子进程运行 `src/auto/roxy_register_openai.js`：
  - 子进程继承 `.env` / `process.env` 中的 Roxy 配置。
  - `replacement_accounts.email` 覆盖子进程 `ROXY_REGISTER_EMAIL` 和 `ROXY_OAUTH_EMAIL`。
  - 子进程不得接收 `PHONE_VERIFICATION_SMS_API_URL`。
  - 子进程使用内部 POST 邮箱验证码接口获取注册验证码。
  - 子进程退出码为 `0` 时视为注册自动化成功；非 `0` 或启动失败时视为 `REGISTER_FAILED`。

---

### 2.5 后台系统界面规范

- **单页静态结构**: 前端页面位于 `web/` 下，通过统一路由 `/accounts` 和 `/replacement-ui` 加载。
- **通用侧边栏**: 
  - 导航栏 HTML 位于 `web/sidebar.html`。
  - 服务端在输出 HTML 时，读取该侧边栏模板，将其注入到 `<aside class="sidebar">` 内，并根据访问的路由自动为对应的导航项高亮 `active` 样式。
  - 页面包括：仪表盘、邮箱账号、补号管理。
- **弹窗展示**: 所有的操作详情（如账号 JSON、邮件内容、编辑表单）必须使用 HTML5 原生 `<dialog>` 以模态遮罩弹窗（Modal）形式呈现，并具备磨砂玻璃半透明质感，支持 Esc 键快捷关闭。
- **性能与排版**: 所有的长列表和操作记录面板最高显示 5 条可见行，超出后在容器内自动生成垂直滚动条，防止页面垂直拉升。
- **补号日志页面**: 后台应提供补号自动化运行列表、日志详情和运行中停止操作入口，方便定位长流程卡点。

---

## 3. 验收标准

- [x] 邮箱账号连通性测试和邮件获取工作正常，操作具备 Loading 即时反馈。
- [x] 获取邮件的详情以弹窗显示，能正确解析和滚动展示 HTML 格式邮件正文。
- [x] 邮箱账号列表支持服务端分页、服务端状态筛选和关键词搜索。
- [x] 补号账号在数据库和业务层强制校验邮箱唯一性并做去空和转小写处理。
- [x] 新增补号账号未填写开通时间时，系统自动写入当前时间；显式填写时不覆盖。
- [x] 补号流程的状态流转与计数规则严谨无误（成功加 1，失败不加）。
- [x] 公开验证码接口只通过启用的 `public_code_key` 定位补号邮箱，不暴露邮箱明文。
- [x] 补号管理页支持展示、配置、复制、启用和停用公开验证码 key。
- [x] 本机自动化脚本可免登录调用邮箱验证码接口。
- [x] Roxy API 连接错误能暴露请求 URL 和底层网络原因。
- [x] Roxy OAuth 自动化可完成邮箱验证码、可选手机验证、Codex 授权确认、OAuth callback 捕获、token 交换和本地认证 JSON 生成。
- [x] Roxy OAuth 自动化可识别并提交添加手机号页，补号子进程会注入补号账号手机号。
- [x] 邮箱验证码、添加手机号、手机验证码和 Codex 授权阶段具备页面状态守卫，避免页面已跳转后仍等待旧输入框或旧点击。
- [x] Chrome error 页下仍可通过 CDP fallback 捕获 OAuth callback。
- [x] Token 交换默认只使用 Roxy 浏览器页面上下文，并具备重试、单次超时 abort 和 auth 页面上下文兜底。
- [x] 自动化失败时可生成失败截图，且截图文件名不泄露敏感信息。
- [x] 正式补号入口通过子进程执行自动化，成功/失败结果能驱动补号账号状态流转。
- [x] 管理员可手动触发 OpenAI 注册自动化，注册流程只使用邮箱验证码且不使用 SMS API。
- [x] 补号子进程运行记录、日志查看和停止操作可用。
- [x] CPA 凭证健康检测、失效分类、自动补号、CPA 上传和上传后复查可用。
- [x] 本地 `banned` 补号账号不会触发 CPA 自动补号。
- [x] 手动补号和 CPA 自动补号统一走 CPA repair worker。
- [x] 补号列表完整显示关键字段，并支持水平滚动查看长字段。
- [x] 补号账号列表支持服务端分页、服务端状态筛选和关键词搜索。
- [x] 侧边栏为统一模板加载，能够随当前路由自动匹配高亮。
- [x] 整个系统的 UI 展现一致，符合现代磨砂透明和卡片化美学。
