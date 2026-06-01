# docs/README.md

项目文档总入口。先判断任务目标，再读取相关入口；不要机械读取全部文档。

## 1. 目录索引

| 目录 | 职责 | 入口 |
|---|---|---|
| `prd/` | 需求：做什么、为什么、验收标准 | `prd/PRD_REGISTRY.md` |
| `changes/` | 日常需求、规则、结构或长期行为变更 | `changes/CHANGE_REGISTRY.md` |
| `project/` | 项目说明：文档结构、API、部署 | `project/document-architecture.md` |
| `templates/` | 文档模板 | `templates/README.md` |
| `memories/` | 长期经验、项目风格、历史坑位 | `memories/README.md` |
| `issues/` | 缺陷、风险、排查、修复 | `issues/README.md` |
| `work/` | 工作索引、单日工作记录、日终交接 | `work/handoff.md` |

## 2. 常用入口

| 目的 | 读取 |
|---|---|
| 接手状态 | `work/handoff.md` |
| 需求列表 | `prd/PRD_REGISTRY.md` |
| 变更列表 | `changes/CHANGE_REGISTRY.md` |
| 文档结构 | `project/document-architecture.md` |
| 历史经验 | `memories/README.md` |
| 问题排查 | `issues/README.md` |
| 新建文档 | `templates/README.md` |

## 3. 维护原则

- PRD 写需求，`project/` 写项目说明，`work/` 写过程。
- 日常需求、规则、结构或长期行为变更先写 `changes/`，不要把 PRD 改成工作流水。
- 未合并的 `implemented` change 达到 5 个时，AI 应提醒用户合并到 PRD；不按日期或工作日自动触发。
- 文档格式写 `templates/`，长期经验写 `memories/`。
- 每次阶段工作单独写入 `work/YYYY-MM-DD-主要工作内容.md`。
- `work-log.md` 只做索引。
- `handoff.md` 只在当天工作日志完成后更新，作为日终总结和下一步规划。
