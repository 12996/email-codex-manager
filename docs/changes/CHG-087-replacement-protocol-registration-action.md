# CHG-087 补号列表协议注册操作

状态：implemented
创建日期：2026-07-17
关联 PRD：PRD-003
影响范围：`src/server.js`、`src/replacementServices.js`、`web/app.js`、`web/index.html`、`web/styles.css`、`test/`、`docs/project/`

## 背景

补号管理页原有注册入口依赖 DOM 自动化。需要新增一个按当前补号行执行的协议注册入口，并在启动协议前刷新 RoxyBrowser 指纹，保证协议请求复用新的浏览器 profile、Cookie 和出口 IP。

## 变更内容

- 新增 `POST /replacement-accounts/:id/register-protocol`。
- 补号列表每行“操作”菜单新增“协议注册”。
- 后端按当前行账号 ID 启动 `tilian` 环境中的 `src/auto/protocol_registration/main.py --count 1 --workers 1`。
- 启动前按 `close -> clear local cache -> clear server cache -> random fingerprint -> open -> connection info` 刷新 Roxy profile，默认目标为 `3/test`，可用 `ROXY_PROTOCOL_BROWSER_*` 覆盖。
- 子进程显式接收 `OTP_PROVIDER=replacement`、`REPLACEMENT_ACCOUNT_ID`、`ROXY_CDP_ENABLED=1` 和刷新后的 `ROXY_CDP_ENDPOINT`，协议项目不再默认领取列表首个邮箱。
- 协议成功取得 `access_token` 后，按邮箱文件名写入 `src/auto/product_files/registration/<email>.txt`，文件内容只保留 token 值本身；可用 `REGISTRATION_TOKEN_OUTPUT_DIR` 覆盖目录。
- 共享 Roxy profile 使用 single-flight；并行请求返回 `PROTOCOL_REGISTER_BUSY`。
- 成功将当前账号标记为 `registered`；失败只写入操作错误，不改变账号业务状态。
- 补号管理页在账号列表下方增加当前协议注册实时日志面板，通过 SSE 显示 Roxy 准备步骤及协议子进程 stdout/stderr；网页不保存历史日志，后台运行记录仍按 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS`（默认 30）保留。

## 验收

- [x] API、前端操作入口和失败展示均有回归测试。
- [x] 协议注册 SSE 实时日志和网页临时日志面板有回归测试。
- [x] Python 指定账号选择、Roxy 页面上下文邮箱 API、CDP bridge 和 token TXT 输出专项测试通过。
- [x] Node 全量测试 370/370 通过。
- [x] Python 全量测试 37/37 通过。
- [ ] 真实账号端到端注册完成；当前账号的外部 `email_code_api` 从 Windows 直连和 Roxy 页面上下文均超时，见 `issue-015`。

## 回滚

回滚本 change 涉及的后端、前端、Python 协议适配、测试和文档变更；不涉及数据库结构迁移。保留已有运行日志和协议注册产物，便于复盘。
