# PRD-003 账号管理系统需求文档（2026-06-25 基线）

状态：active
创建日期：2026-06-25
最近基线合并：2026-06-25
继承基线：`PRD-002-account-management-system.md`

## 1. 基线说明

PRD-003 是 PRD-002 的 2026-06-25 基线升级版。除本文明确固化的需求外，PRD-002 中未被覆盖的需求继续有效。

本次基线合并范围：

- `CHG-044` CPA 同邮箱多凭证任一健康即视为正常
- `CHG-045` CPA 自动补号触发原因写入运行日志
- `CHG-046` 注册 access token 产物与列表空态显示
- `CHG-047` CPA 上传凭证文件名增加 codex 前缀
- `CHG-048` 补号账号增加 Codex 2FA 字段

## 2. 补号账号管理增量需求

### 2.1 数据模型

补号账号 `replacement_accounts` 在 PRD-002 字段基础上新增：

- `codex_2fa`: Codex/OpenAI 账号 2FA 密钥。

API 统一返回字段名 `codex_2fa`。新增和编辑补号账号时，后端必须兼容以下请求体字段名，并统一写入 `replacement_accounts.codex_2fa`：

- `codex_2fa`
- `2fa-codex`
- `2fa_codex`

### 2.2 前端交互

- 补号管理页新增账号和编辑账号弹窗必须提供 `2fa-codex` 输入框。
- 点击保存后，前端必须把 `2fa-codex` 对应值提交到后端。
- 补号列表主表必须新增 `2fa-codex` 列。
- `2fa-codex` 列应复用长字段截断和复制完整值能力。

## 3. OpenAI 注册自动化增量需求

- 注册自动化在成功读取 `chatgpt.com/api/auth/session` 并获得 `accessToken` 后，必须保存本地 token JSON 产物。
- 默认保存目录为 `src/auto/product_files/registration/`。
- 默认文件名使用补号邮箱号，仅替换 Windows 不允许的文件名字符。
- 系统必须支持通过 `REGISTRATION_TOKEN_OUTPUT_DIR` 覆盖注册 token 产物目录。
- 注册日志只能输出 token 文件保存路径，不得输出 access token 明文。

## 4. CPA 健康检测与自动补号增量需求

### 4.1 同邮箱多凭证健康判断

- CPA 健康巡检按邮箱归并状态。
- 同一邮箱存在多个 CPA auth file 时，只要任一凭证为健康状态，该邮箱整体视为健康。
- 同一邮箱存在健康凭证时，不得因为其他旧异常凭证触发自动补号。
- CPA repair worker 上传后复查也必须按同邮箱任一健康凭证判断成功。
- 若同邮箱没有任何健康凭证，仍按原逻辑报告异常或触发补号。

### 4.2 自动补号触发原因日志

- CPA 自动补号入队时携带的 `credential` 和 `reasons` 必须整理为触发原因。
- 真实 Roxy OAuth 子进程运行日志必须在自动化启动前写入 `step=cpa-trigger`。
- `cpa-trigger` 日志应包含 provider、email、CPA status、unavailable、disabled、分类 reasons 和截断后的 `status_message`。
- 如果使用测试或旧式 replacement service 未提前写入，CPA repair worker 应在拿到 run log 后补写同样的 `cpa-trigger` 记录。
- 管理密钥、验证码、Cookie 和 token 类敏感信息不得写入日志。

### 4.3 CPA 上传文件命名

- 补号成功后，本地 CPA JSON 读取路径保持 `src/auto/product_files/cpa/<email>.json` 不变。
- 上传到 CPA 的 auth file 名称必须为 `codex-<email>-plus.json`。
- CPA 上传日志中的 `name=` 必须同步记录新上传文件名。
- 上传后健康复查继续按邮箱判断，不改变补号状态流转规则。

## 5. 后台列表空态与导航

- 邮箱账号列表为空或筛选无结果时，表格主体必须显示“暂无邮箱账号”空态行。
- 补号日志列表为空或筛选无结果时，表格主体必须显示“暂无补号运行日志”空态行。
- `/accounts` 页面必须复用统一 sidebar，并展示补号日志入口。

## 6. 验收标准

- [x] 新增补号账号时填写 `2fa-codex`，后端保存到 `replacement_accounts.codex_2fa`。
- [x] 编辑补号账号时修改 `2fa-codex`，后端更新数据库字段。
- [x] 补号管理列表展示 `2fa-codex` 列，并支持长字段截断和复制完整值。
- [x] 同一邮箱同时存在旧异常凭证和健康凭证时，CPA 健康巡检不再对该邮箱入队补号。
- [x] 同一邮箱同时存在旧异常凭证和健康凭证时，补号后 CPA 复查成功。
- [x] 自动补号运行日志中能看到 `step=cpa-trigger action=记录 CPA 自动补号触发原因`。
- [x] 注册成功后能在本地看到 `<email>.json`，其中包含 `access_token`。
- [x] 注册子进程日志能看到 token 文件保存路径，但不包含 token 明文。
- [x] CPA 上传 auth file 名称为 `codex-<email>-plus.json`。
- [x] 邮箱账号列表和补号日志列表在无数据时显示可见空态行。

## 7. 合并记录

- 合并日期：2026-06-25
- 合并来源：`CHG-044`、`CHG-045`、`CHG-046`、`CHG-047`、`CHG-048`
- 合并目标：PRD-003
