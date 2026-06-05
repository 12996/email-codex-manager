# 2026-06-04 PRD-002 注册与默认开通时间合并

## 背景

已实现两个补号账号相关变更，需要同步到 PRD 基线：

- CHG-029 管理员手动触发 OpenAI 注册自动化
- CHG-030 补号账号默认开通时间

## 已完成

- `docs/prd/PRD-002-account-management-system.md`
  - 最近基线合并日期更新为 `2026-06-04`。
  - 补充管理员手动触发 OpenAI 注册自动化要求。
  - 补充注册脚本从 `https://chatgpt.com/` 进入注册流程。
  - 补充注册阶段只使用内部 POST 邮箱验证码接口，不使用 SMS API。
  - 补充新增补号账号缺少 `activated_at` 时系统自动写入当前时间。
- `docs/changes/CHG-029-manual-openai-registration.md`
  - 状态更新为 `merged`。
- `docs/changes/CHG-030-default-replacement-activated-at.md`
  - 状态更新为 `merged`。
- `docs/changes/CHANGE_REGISTRY.md`
  - 同步 CHG-029、CHG-030 状态。

## 验证

- `git diff --check`
