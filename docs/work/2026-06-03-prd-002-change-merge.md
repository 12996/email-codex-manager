# 2026-06-03 PRD-002 change 基线合并

## 背景

`CHG-017` 至 `CHG-028` 中已有多项 `implemented` change 尚未合并到 `PRD-002`，达到 change 管理规则中的 PRD 基线合并提醒条件。

## 本次处理

- 将 `CHG-017` 至 `CHG-026`、`CHG-028` 合并到 `docs/prd/PRD-002-account-management-system.md`。
- `CHG-027` 已被 `CHG-028` 替代，保持 `superseded`，不合并到 PRD 基线。
- PRD-002 最近基线合并日期更新为 `2026-06-03`。
- PRD-002 补充：
  - 补号子进程运行记录、日志页面和停止操作。
  - 公开验证码 key 的展示、配置、复制、启用和停用。
  - CPA 凭证健康检测、自动补号、上传 CPA 和复查。
  - 补号列表关键字段完整展示和水平滚动。
  - 邮箱/手机验证码阶段状态守卫。
  - Codex 授权 callback 竞态监听与 URL `code/state` 判定。
  - token 交换页面上下文优先、短等待和短超时。
  - 手动补号与自动补号统一 CPA repair worker。
  - `banned` 账号不触发 CPA 自动补号。
- 将对应 change 状态更新为 `merged`，并补充合并记录。

## 验证

- 已检查 `docs/changes/CHANGE_REGISTRY.md`，确认 `CHG-017` 至 `CHG-026`、`CHG-028` 状态为 `merged`。
- 已确认 `CHG-027` 保持 `superseded`。
- 已检查 PRD-002 中新增章节和验收标准。

## 影响范围

- 仅更新需求文档、change 状态和工作记录。
- 未修改运行代码或数据库结构。
