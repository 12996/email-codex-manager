# CHG-019 CPA 凭证健康检测与自动补号

- 状态：merged
- 日期：2026-06-03
- 关联 PRD：PRD-002

## 背景

CPA 已提供 `/v0/management/auth-files` 运行时凭证状态接口，可用于识别失效凭证。

## 变更

- 新增 CPA 凭证健康检测客户端。
- 新增按 `provider + email` 分类的凭证健康判断。
- 新增手动健康检查接口。
- 新增可选 10 分钟轮询守护进程。
- 检测到失效凭证且存在匹配补号账号时，触发现有补号流程。
- 补号子进程成功后，读取 `src/auto/product_files/cpa/<email>.json` 上传到 CPA，并再次检查凭证健康状态。

## 验收

- CPA 管理密钥不出现在日志或接口响应中。
- 健康凭证不会触发补号。
- 失效凭证会按邮箱匹配补号账号并触发补号。
- 已处于 `replacing` 的账号不会重复触发。
- `disabled`、`quota_limited` 和未分类异常只报告，不自动补号。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-03
- 备注：已合并到 `docs/prd/PRD-002-account-management-system.md` 的 CPA 凭证健康检测与自动补号章节。
