# 2026-06-25 CPA 上传凭证文件名增加 codex 前缀

## 背景

用户要求 CPA 上传凭证名称从邮箱直接开头改为 Codex 前缀格式，例如：

`codex-slide.emoji.2w+rv4okxgrtg9hc7cvf@icloud.com-plus.json`

## 实现

- `src/cpaRepairWorker.js`
  - 本地读取仍使用 `src/auto/product_files/cpa/<email>.json`。
  - 上传 CPA 时使用 `codex-<email>-plus.json`。
  - 运行日志 `cpa-upload name=` 同步记录新上传名。
- `test/cpaRepairWorker.test.js`
  - 回归测试覆盖 CPA 上传名。
- `docs/project/api.md`
  - 记录本地文件名和 CPA 上传名的差异。

## 验证

```powershell
npm test -- test/cpaRepairWorker.test.js
```

结果：通过，5/5 pass。

## Change

- `docs/changes/CHG-047-cpa-upload-file-name-codex-prefix.md`，状态 `implemented`。
