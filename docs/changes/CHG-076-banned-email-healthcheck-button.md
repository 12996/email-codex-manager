# CHG-076 补号账号一键封禁邮件验活

状态：implemented
创建日期：2026-07-10
关联 PRD：PRD-003
关联 Issue：
影响范围：`src/accountHealthcheckService.js`, `src/replacementAccounts.js`, `src/server.js`, `web/index.html`, `web/app.js`, `test/`, `docs/project/api.md`

## 背景

管理员需要对已注册过 Plus 的账号执行邮件验活：如果对应邮箱最近邮件中出现 ChatGPT deactivation 通知，则自动把补号账号状态改成已封禁，避免继续出售或使用已封禁账号。

## 变更内容

- 新增：
  - 补号管理页“一键验活”按钮。
  - `POST /replacement-accounts/healthcheck-banned` 批量验活接口。
  - `src/accountHealthcheckService.js`，集中处理候选账号筛选、收件箱路由、封禁邮件匹配和批量结果汇总。
  - `replacementAccounts.listBannedHealthcheckCandidates()` 和 `markBannedByHealthcheck()`。
- 修改：
  - 一键验活检测 `registered`、`plus_active`、`cpa_mounted`、`for_sale`、`sold` 状态账号。
  - 命中封禁邮件时将账号状态写为 `banned`，状态备注写入“一键验活检测到 ChatGPT deactivation 邮件”。
  - Gmail plus alias 使用主 Gmail 收件箱；iCloud 账号使用 `ICLOUD_CODE_GMAIL_ACCOUNT` 对应 Gmail 收件箱。
- 删除：
  - 无。

## 验收标准

- [x] 点击“一键验活”后批量检测 `registered`、`plus_active`、`cpa_mounted`、`for_sale`、`sold` 状态账号。
- [x] 每个账号只读取最近 5 封邮件。
- [x] 邮件同时包含目标账号邮箱和 ChatGPT deactivation 稳定文案时，账号自动变为 `banned`。
- [x] 非目标邮箱或普通邮件不误封。
- [x] IMAP 或收件箱配置失败只计入失败结果，不改变账号状态。
- [x] 前端显示检测数、新封禁数、未命中数和失败数。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：待后续 PRD 基线合并。
