# 2026-06-05 PRD-002 change 基线合并

- 目标：将已实现但未合并的账号管理相关 change 合并到 `docs/prd/PRD-002-account-management-system.md`，并清理临时计划文档。
- 合并范围：
  - `CHG-031` Roxy OAuth 添加手机号页处理
  - `CHG-032` Roxy 添加手机号后跳转竞态守卫
  - `CHG-033` Roxy OAuth callback CDP fallback
  - `CHG-034` Roxy 手机验证码后跳转竞态守卫
  - `CHG-035` Roxy token exchange 浏览器上下文重试
  - `CHG-037` 账号列表服务端分页

## 结果

- `PRD-002` 已补充邮箱账号列表和补号账号列表的服务端分页、服务端筛选和关键词搜索要求。
- `PRD-002` 已补充添加手机号页、添加手机号提交后跳转守卫、手机验证码提交后跳转守卫、Chrome error 页 CDP callback fallback、正式 Token 交换默认仅走 Roxy 浏览器页面上下文等要求。
- `CHANGE_REGISTRY.md` 中 `CHG-031`、`CHG-032`、`CHG-033`、`CHG-034`、`CHG-035`、`CHG-037` 状态已更新为 `merged`。
- 对应 change 文件已补充合并目标 PRD、合并日期和合并备注。
- 已删除本次分页的临时计划文档：
  - `docs/plans/2026-06-05-account-pagination-design.md`
  - `docs/plans/2026-06-05-account-pagination.md`

## 验证

- `rg -n "CHG-03[1-7].*implemented|CHG-03[1-7].*未合并" docs\changes docs\work docs\prd` 未发现本次合并范围的未合并状态。
- `rg --files docs\plans` 已确认本次分页的临时计划文档不再存在。
