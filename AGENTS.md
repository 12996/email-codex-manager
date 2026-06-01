# AGENTS.md

本文件是 AI 接手项目时的最小文档导航协议。不要把本文件当作项目介绍、需求文档、技术文档或工作记录。

AI 应根据任务目标自行判断需要阅读哪些文档，不要机械读取全部文档。

## 1. 文档入口

项目文档总入口：

- `docs/README.md`

任务涉及跨会话接手、昨日总结或下一步规划时，优先读取：

- `docs/work/handoff.md`

## 2. 目录职责

| 目录 | 职责 | 入口 |
|---|---|---|
| `docs/prd/` | 需求真相源：做什么、为什么、验收标准 | `PRD_REGISTRY.md` |
| `docs/changes/` | 需求、规则、结构或长期行为变更记录 | `CHANGE_REGISTRY.md` |
| `docs/project/` | 项目说明：文档结构、API、部署 | `document-architecture.md` |
| `docs/templates/` | 文档模板 | `README.md` |
| `docs/memories/` | 长期稳定经验、项目风格、历史坑位 | `README.md` |
| `docs/issues/` | 缺陷、风险、排查和修复记录 | `README.md` |
| `docs/work/` | 工作索引、单日工作记录、日终交接 | `handoff.md` |

## 3. 信息归属

| 信息 | 写入 |
|---|---|
| 需求、用户故事、验收标准 | `docs/prd/` |
| 需求、规则、结构或长期行为的日常变更 | `docs/changes/` |
| 文档结构、API、部署 | `docs/project/` |
| 文档格式 | `docs/templates/` |
| 长期经验和项目风格 | `docs/memories/` |
| Bug、风险、排查过程 | `docs/issues/` |
| 工作记录和日终交接 | `docs/work/` |

## 4. 禁止混放

- PRD 不写技术实现细节。
- 日常变更不直接写成 PRD 流水，应先写入 `docs/changes/`。
- 项目说明不代替 PRD。
- 工作记录不代替 PRD 或项目说明。
- `templates/` 不记录具体项目事实。
- 可执行代码不要放入 `docs/`。

## 5. Change 管理

当任务改变需求、系统行为、文档结构、验收标准、长期规则或重要约束时，必须创建或更新 `docs/changes/` 中的 change 记录。

以下情况必须写 change：

- 新增、删除或修改用户可感知功能。
- 修改流程、交互、权限、数据规则或文档结构。
- 改变验收标准。
- 产生新的长期约束、决策或风险。
- 一个 issue 的修复会改变长期行为。

以下情况不写 change：

- 纯格式、错别字、链接修复。
- 临时调试。
- 单日工作记录。
- 不改变含义的重命名。

Change 状态流转：`draft` → `accepted` → `implemented` → `merged`。不采纳则标记为 `rejected`，被替代则标记为 `superseded`。

当 `docs/changes/CHANGE_REGISTRY.md` 中未合并的 `implemented` change 达到 5 个时，AI 应提醒用户执行 PRD 基线合并。只统计状态为 `implemented` 且尚未 `merged` 的 change；不按日期或工作日自动触发 PRD 合并。

用户也可以随时明确要求整理 PRD、合并 change 或更新 PRD 基线。合并完成后，应将相关 change 状态更新为 `merged`，并在对应 change 文件中记录合并目标 PRD 和合并日期。

## 6. 冲突优先级

文档冲突时，按以下顺序判断：

1. 用户当前明确指令
2. `AGENTS.md`
3. 当前有效 PRD，以及 `docs/changes/` 中已确认或已实现且未合并的 change
4. `docs/project/`
5. `docs/work/handoff.md`
6. `docs/issues/`
7. `docs/memories/`
8. 历史工作日志

其中，已确认或已实现但未合并的 change 视为 PRD 的临时增量，只在该 change 的影响范围内补充或修正当前 PRD。

无法判断时，先向用户说明冲突，不要静默选择。

## 7. 任务结束前

如果任务改变了需求、文档结构、API、测试、问题状态或长期规则，应更新对应文档；符合 change 触发条件时，应同步创建或更新 `docs/changes/`。

涉及阶段性工作时：

- 过程中更新当日工作文档：`docs/work/YYYY-MM-DD-主要工作内容.md`
- 当日工作完成后更新工作索引：`docs/work/work-log.md`
- 当日工作日志完成后再更新 `docs/work/handoff.md`
