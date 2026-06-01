# decisions.md

| 日期 | 决策 | 状态 | 影响范围 |
|---|---|---|---|
| 2026-05-18 | 使用分层文档管理体系，并以 `AGENTS.md` 作为最小 AI 导航协议 | active | 文档体系 |
| 2026-05-19 | 工作记录按 `YYYY-MM-DD-主要工作内容.md` 独立成文，`work-log.md` 只做索引 | active | `docs/work/` |
| 2026-05-19 | 删除默认 `data-model.md`，数据模型默认由 PRD 承载，需要时再单独新增 | active | `docs/project/` |
| 2026-05-19 | `architecture.md` 改名为 `document-architecture.md`，只记录文档结构和目录职责 | active | `docs/project/` |
| 2026-05-19 | `handoff.md` 只在当天工作日志完成后更新，作为日终总结和下一步规划 | active | `docs/work/` |
| 2026-05-19 | 删除默认 `docs/rules/`，避免规则目录承载功能修改和临时过程 | active | 文档体系 |
| 2026-05-24 | 新增轻量 `docs/changes/` 管理日常有效变更，未合并的 `implemented` change 达到 5 个时提醒合并 PRD，不按日期自动触发 | active | `docs/changes/`, `docs/prd/`, `AGENTS.md` |
