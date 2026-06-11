# 2026-06-08 PRD-002 change 基线合并

## 背景

用户要求合并当前未合并的 change。合并前 `docs/changes/CHANGE_REGISTRY.md` 中未合并的 `implemented` change 为：

- `CHG-042`：补号注册与 OAuth 支持账号级外部邮箱验证码接口
- `CHG-043`：补号列表长字段截断与复制

## 本次合并

- 更新 `docs/prd/PRD-002-account-management-system.md` 最近基线合并日期为 `2026-06-08`。
- 合并 `CHG-042`：
  - `replacement_accounts.email_code_api` 作为补号账号数据字段。
  - 注册自动化和 OAuth 补号均支持账号级外部邮箱验证码接口。
  - 外部接口通过 GET 读取 HTML/text/JSON 并提取 6 位验证码。
  - 未配置 `email_code_api` 时回退本地 `POST /api/verification-code/latest`。
  - 注册脚本直接运行时兼容 `email_code_api` / `EMAIL_CODE_API` 等别名。
- 合并 `CHG-043`：
  - 补号主表展示 `email_code_api`。
  - 补号主表长字段按最大长度截断。
  - 超长字段旁提供“复制”按钮复制完整原始值。
  - 详情弹窗仍展示完整账号 JSON，公开验证码 URL 原复制入口保持不变。
- 将 `CHG-042`、`CHG-043` 在 change 索引和各自 change 文件中标记为 `merged`，并记录合并目标 PRD 和合并日期。

## 验证

- 文档状态检查：`CHANGE_REGISTRY.md` 中当前没有 `implemented` 状态的 change。
- 本次为文档基线合并，无运行时代码变更。

## 当前提醒

当前未合并的 `implemented` change 数量为 0，未达到 PRD 合并提醒阈值。
