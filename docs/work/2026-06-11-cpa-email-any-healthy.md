# 2026-06-11 CPA 同邮箱多凭证任一健康判断

## 背景

用户反馈 CPA repair 上传后复查失败：

`uploaded CPA credential is still unhealthy: error {"error":{"message":"Your authentication token has been invalidated.","type":"authentication_error","code":"auth_unavailable"}}`

实际场景是同一邮箱可能存在多个 CPA 凭证，只要其中一个凭证正常，该邮箱应视为正常。

## 本次变更

- `src/cpaRepairWorker.js`：上传后复查同邮箱凭证时，改为任一匹配凭证健康即通过；只有同邮箱全部不健康才报错。
- `src/cpaCredentialMonitor.js`：巡检时先收集健康邮箱；如果同邮箱已有健康凭证，则跳过该邮箱其他异常凭证，不入 `unhealthy`，不触发补号。
- 增加回归测试覆盖同邮箱一个 `auth_unavailable`、一个 `active` 的场景。
- 新增 change：`docs/changes/CHG-044-cpa-email-any-healthy.md`，状态 `implemented`。
- 更新 `docs/project/api.md` 的 CPA 健康检测说明。

## 验证

- `node --test test\cpaRepairWorker.test.js test\cpaCredentialMonitor.test.js` 通过，8/8 pass。

## 待办

- 尚未执行真实 CPA `/cpa/auth-health` 实机复查。
- `CHG-044` 尚未合并到 PRD 基线；当前未合并 `implemented` change 数量为 1。
