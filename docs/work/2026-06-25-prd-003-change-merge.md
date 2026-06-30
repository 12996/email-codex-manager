# 2026-06-25 PRD-003 change 基线合并

## 目标

将当前未合并的 `implemented` change 合并到 `PRD-003`，形成 2026-06-25 账号管理系统基线。

## 合并范围

- `CHG-044` CPA 同邮箱多凭证任一健康即视为正常
- `CHG-045` CPA 自动补号触发原因写入运行日志
- `CHG-046` 注册 access token 产物与列表空态显示
- `CHG-047` CPA 上传凭证文件名增加 codex 前缀
- `CHG-048` 补号账号增加 Codex 2FA 字段

## 变更

- 新增 `docs/prd/PRD-003-account-management-system-2026-06-25-baseline.md`。
- 更新 `docs/prd/PRD_REGISTRY.md`，登记 PRD-003。
- 将 `CHG-044` 至 `CHG-048` 状态从 `implemented` 更新为 `merged`。
- 将上述 change 的关联 PRD 更新为 `PRD-003`，并在各 change 文件写入合并目标与合并日期。
- 更新 `docs/changes/CHANGE_REGISTRY.md`。

## 验证

```powershell
rg -n "implemented" docs\changes docs\prd
```

结果：未发现 `CHG-044` 至 `CHG-048` 仍为 `implemented`；仅保留 change 机制说明中的 `implemented` 状态解释。

## 后续

当前未合并的 `implemented` change 数量已归零。
