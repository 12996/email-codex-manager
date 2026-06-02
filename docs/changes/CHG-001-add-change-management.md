# CHG-001 增加 change 管理机制

状态：merged
创建日期：2026-05-24
关联 PRD：PRD-001
关联 Issue：
影响范围：`AGENTS.md`、`docs/README.md`、`docs/project/document-architecture.md`、`docs/templates/`、`docs/changes/`、`docs/work/`

## 背景

仅依赖 PRD、系统文档、work-log 和 handoff 时，需求变更容易散落在过程记录中。需要一个轻量 change 层承载日常有效变更，并在累计到阈值后再合并成 PRD 基线。

## 变更内容

- 新增：`docs/changes/CHANGE_REGISTRY.md` 作为 change 索引。
- 新增：单文件 change 记录格式，避免每个 change 都创建复杂目录。
- 新增：`docs/templates/change-template.md`。
- 修改：`AGENTS.md` 和 `docs/README.md` 增加 change 触发、状态和 PRD 合并提醒规则。
- 修改：文档结构说明增加 `docs/changes/` 职责。

## 验收标准

- [x] 存在 `docs/changes/CHANGE_REGISTRY.md`。
- [x] 存在 change 模板。
- [x] AI 协议说明什么时候写 change。
- [x] AI 协议说明未合并 `implemented` change 达到 5 个时提醒合并 PRD。
- [x] 明确不按日期或工作日自动合并 PRD。

## 合并记录

- 合并目标 PRD：PRD-001
- 合并日期：2026-06-01
- 备注：已成功合并入 PRD-001。
