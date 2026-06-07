# 2026-06-07 PRD-002 change 基线合并

- 目标：将已实现但未合并的账号管理相关 change 合并到 `docs/prd/PRD-002-account-management-system.md`。
- 合并范围：
  - `CHG-038` 前端列表取消局部竖向滚动并显示补号备注
  - `CHG-039` 避免 Windows 保留 3000 端口导致启动失败
  - `CHG-040` Roxy OAuth 密码页 one-time code 与邮箱后异常重试

## 结果

- `PRD-002` 最近基线合并日期更新为 `2026-06-07`。
- `PRD-002` 已补充邮箱邮件结果列表、邮箱账号表格和补号账号表格不设置内部纵向滚动，宽表仅保留水平滚动的要求。
- `PRD-002` 已补充补号主表展示管理员备注，`sms_last_error` 保留在详情 JSON 中供排查。
- `PRD-002` 已补充本机默认端口 `PORT=3100`，以及验证码 API 未显式配置时按当前 `PORT` 推导。
- `PRD-002` 已补充 Roxy OAuth 密码页 one-time code 分支、邮箱提交后 next stage 识别、未知页面重试和相关日志要求。
- `CHANGE_REGISTRY.md` 中 `CHG-038`、`CHG-039`、`CHG-040` 状态已更新为 `merged`。
- 对应 change 文件已补充合并目标 PRD、合并日期和合并备注。

## 验证

- `rg -n "CHG-0(38|39|40).*implemented|状态：implemented|待后续 PRD-002 基线合并" docs\changes\CHG-038-frontend-list-remark-no-inner-scroll.md docs\changes\CHG-039-avoid-windows-port-3000-eacces.md docs\changes\CHG-040-roxy-openai-password-one-time-code.md docs\changes\CHANGE_REGISTRY.md`
- `git diff --check`
