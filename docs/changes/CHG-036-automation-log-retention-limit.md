# CHG-036 自动化运行日志最大保留数量

状态：merged
创建日期：2026-06-05
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/config.js`, `src/replacementAutomationRuns.js`, `src/server.js`, `.env.example`, `test/`, `docs/project/api.md`, `docs/prd/PRD-002-account-management-system.md`, `docs/work/`

## 背景

补号和注册自动化会持续产生 `replacement_automation_runs` 数据库记录及 `data/automation-logs/` 本地日志文件。长期运行后日志数量过多，不利于查看和维护。

## 变更内容

- 新增：`.env` 配置 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS`，默认 30。
- 修改：每次创建新的自动化运行记录后，按开始时间倒序保留最近配置数量内的记录。
- 修改：超过范围的非 `running` 旧记录会从数据库删除，并同步删除其日志文件。
- 保留：`running` 状态记录不自动清理，避免影响仍在执行的子进程排查。

## 验收标准

- [x] 未配置或配置无效时默认保留 30 条。
- [x] 配置为正整数时按该数量保留最近运行记录。
- [x] 超出范围的非 `running` 旧记录会删除数据库记录和日志文件。
- [x] `running` 记录即使超过配置数量也不会被清理。
- [x] API 文档和 `.env.example` 说明该配置。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-05
- 备注：已在补号/注册自动化运行记录和日志能力中补充日志保留数量要求。
