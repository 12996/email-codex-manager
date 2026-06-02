# CHG-017 补号子进程日志页面

状态：implemented
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`.gitignore`, `src/db.js`, `src/replacementAutomationRuns.js`, `src/replacementServices.js`, `src/server.js`, `web/`, `test/`, `docs/project/api.md`

## 背景

补号接口已通过子进程执行 Roxy OAuth 自动化，但当前 stdout/stderr 只在服务内存中汇总，用户无法在页面上查看运行过程，也无法主动停止长时间占用资源的子进程。

## 变更内容

- 新增：补号自动化运行记录表，保存账号、状态、PID、日志路径、开始/结束时间、退出码和错误摘要。
- 新增：子进程 stdout/stderr 实时写入本地日志文件。
- 新增：补号子进程日志页面，展示运行列表、单次日志详情和运行中的停止按钮。
- 新增：运行列表、运行详情和停止子进程 JSON API。
- 修改：自动补号子进程适配器在执行期间记录运行状态，结束后更新成功、失败或停止状态。

## 验收标准

- [x] 执行补号时创建一条运行记录，并能在日志页面看到账号、状态、PID 和开始时间。
- [x] 子进程 stdout/stderr 会写入日志文件，并可通过页面查看。
- [x] 运行中的子进程可以从页面点击停止；服务只停止当前进程内启动并仍被追踪的 child，不按历史 PID 盲杀系统进程。
- [x] 子进程正常退出后运行记录变为 `succeeded`，失败后变为 `failed`，被停止后变为 `stopped`。
- [x] 自动补号原有账号状态更新规则保持可用。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
