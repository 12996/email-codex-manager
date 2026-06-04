# CHG-021 公开验证码启用/停用专用操作

- 状态：merged
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

公开验证码功能已支持通过编辑补号账号保存 `public_code_enabled`，但实际使用中启用入口不够直接，容易误以为无法启用。

## 变更

- 新增 `PATCH /replacement-accounts/:id/public-code`，只更新公开验证码相关字段。
- 新增仓储方法 `updatePublicCodeAccess`，不要求提交完整账号，也不触发账号状态校验。
- 补号管理操作菜单新增：
  - `启用公开验证码`
  - `停用公开验证码`
- 启用后保留已有 `public_code_key`；如果 key 缺失则自动生成。

## 验收

- 可以对已有补号账号一键启用公开验证码。
- 可以对已有补号账号一键停用公开验证码。
- 启用后 `GET /api/verification-code/public/latest?key=...` 能通过 key 命中账号。
- 停用后同一 key 不再命中账号。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的公开验证码 key 功能细则和验收标准。
