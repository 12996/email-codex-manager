# CHG-047 CPA 上传凭证文件名增加 codex 前缀

状态：implemented

日期：2026-06-25

关联 PRD：PRD-002

影响范围：`src/cpaRepairWorker.js`, `test/cpaRepairWorker.test.js`, `docs/project/api.md`, `docs/work/`

## 背景

CPA 上传凭证时需要在 auth file 名称中体现 Codex 用途。此前 repair worker 上传 CPA JSON 时使用 `<email>.json`，不满足新的命名要求。

## 变更

- 本地 CPA JSON 读取路径保持 `src/auto/product_files/cpa/<email>.json` 不变。
- 上传到 CPA 的 auth file 名称改为 `codex-<email>-plus.json`。
- CPA 上传日志中的 `name=` 同步记录新上传文件名。
- 上传后仍按邮箱复查 CPA 凭证健康，不改变健康判断和补号状态流转。

## 验收

- [x] 邮箱 `slide.emoji.2w+rv4okxgrtg9hc7cvf@icloud.com` 上传时，CPA auth file 名称为 `codex-slide.emoji.2w+rv4okxgrtg9hc7cvf@icloud.com-plus.json`。
- [x] 本地读取仍使用 `src/auto/product_files/cpa/<email>.json`，不要求本地产物改名。
- [x] 补号后 CPA 健康复查继续按邮箱判断。

## 验证

```powershell
npm test -- test/cpaRepairWorker.test.js
```

通过，5/5 pass。
