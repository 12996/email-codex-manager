# CHG-105 补号管理自动化无 2FA 注册操作

状态：implemented
创建日期：2026-08-03
关联 PRD：PRD-003
关联 Issue：`issue-025-roxy-no2fa-create-account-response-variant.md`

## 背景

补号管理原有“无2FA注册”只调用 Python 协议 runner。新增的
`src/auto/roxy_no_2fa_register.js` 是可见 Roxy 浏览器 runner，需要独立操作入口，不能用同名操作替换已有协议路径。

## 变更内容

- 操作菜单将“编辑账号”移至首项。
- 新增“自动化无2FA注册”操作，前端请求
  `POST /replacement-accounts/:id/register-no2fa-browser`。
- 新接口只允许 `unregistered` 账号，复用协议注册的单线程队列，operation 标记为
  `browser-no2fa-registration`。
- 队列 worker 启动 Node browser runner `roxy_no_2fa_register.js --email <account.email>`；子进程成功后
  复查账号状态已由 AT 落盘后的回写改为 `registered`。
- 当前本地配置使用 `ROXY_NO_2FA_PREPARER=test/manual-roxy-proxy-refresh.cjs`，使该操作按已验证的手动
  Roxy 刷新顺序准备 profile；服务重启后加载此配置。
- 旧“无2FA注册”协议操作与 `POST /replacement-accounts/:id/register-no2fa` 保持不变。

## 验收标准

- [x] 菜单首项为“编辑账号”，并存在“自动化无2FA注册”。
- [x] 浏览器操作只向新 endpoint 入队，队列/日志显示正确操作名。
- [x] 新 endpoint 拒绝非 `unregistered` 账号，并在 browser runner 返回后复查 `registered` 状态。
- [x] browser runner 子进程使用 Node、选中账号邮箱、账号 ID 和本地补号服务地址；不向日志传递 AT、Cookie、
  CDP endpoint 或代理凭据。
- [x] Node 回归覆盖菜单顺序、child process 参数、API 入队和状态复查。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
