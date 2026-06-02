# CHG-011 Playwright codegen 录制优先规则

状态：merged
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`AGENTS.md`, `docs/memories/known-issues.md`

## 背景

当用户要求使用 Playwright codegen/录制模式，并表示会手动走一遍流程时，AI 需要先进入录制状态，而不是根据现有代码自行推断和实现。该规则需要提升为项目级长期约束，避免后续重复误解。

## 变更内容

- 在 `AGENTS.md` 新增“自动化录制优先规则”。
- 明确：用户要求 Playwright codegen/录制并亲自走流程时，第一步必须启动 codegen/recorder。
- 明确：录制完成后，才整理 selector、流程函数和测试。
- 明确：Roxy OAuth 可复用运行时代码归属 `src/auto/roxy_oauth_login.js`，手动验证入口归属 `src/auto/roxy_oauth_steps_manual_test.js`。

## 验收标准

- [x] `AGENTS.md` 包含 Playwright codegen 录制优先规则。
- [x] 规则明确禁止先自行推断补代码或写测试。
- [x] 规则明确录制后再整理函数和测试。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入自动化录制优先和运行时代码归属约束。
