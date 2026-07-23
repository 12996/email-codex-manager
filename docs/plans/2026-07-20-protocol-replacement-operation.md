# 协议补号操作 Implementation Plan

> **For Codex:** Implement this plan task-by-task with TDD. Keep the existing registration state machine unchanged.

**Goal:** 在补号管理页增加独立 CPA 协议补号操作，并将协议注册、协议补号置于操作菜单最前面。

**Architecture:** 新增独立 `protocol_cpa_replacement.py` 适配器，按账号 ID读取补号数据并调用 `protocol_cpa_auth.py`。Node 后端通过新的协议补号路由调用 CPA repair worker 的新 mode，沿用现有 CPA 上传与健康复查；没有 worker 时保留直接子进程 fallback。

**Tech Stack:** Node.js ES modules、Express、Node test runner、Python `unittest`、现有 Roxy CDP bridge 和 CPA client。

---

### Task 1: Add failing service and worker tests

**Files:**
- Modify: `test/replacementServices.test.js`
- Modify: `test/cpaRepairWorker.test.js`

**Steps:**
1. Add a test requiring the default protocol replacement child to run `src/auto/protocol_cpa_replacement.py` with the account ID, CDP, CPA output, and SMS proxy environment.
2. Add a test requiring `cpaRepairWorker.repair({ mode: '2fa-protocol' })` to call `replaceAccountWith2FAProtocol` and label failures as protocol replacement failures.
3. Run the focused tests and confirm they fail because the new entrypoint/mode is not wired.

### Task 2: Implement the independent Python replacement adapter

**Files:**
- Create: `src/auto/protocol_cpa_replacement.py`
- Create: `src/auto/test_protocol_cpa_replacement.py`

**Steps:**
1. Write narrow tests for account ID validation, required `OPENAI_WORKSPACE_ID`, and passing account credentials/phone/SMS/output values to `CpaAuthProtocol.run`.
2. Run the Python test and confirm the new adapter behavior is absent.
3. Implement the adapter using `ReplacementServiceClient.get_account()` and `CpaAuthProtocol` without modifying registration `main.py`.
4. Emit only sanitized JSON result data and return a non-zero exit code on failure.
5. Run the Python focused tests and syntax check.

### Task 3: Wire CPA worker mode and API route

**Files:**
- Modify: `src/cpaRepairWorker.js`
- Modify: `src/replacementServices.js`
- Modify: `src/server.js`
- Modify: `test/replacementAccountsApi.test.js`

**Steps:**
1. Add API tests for protocol replacement success, CPA worker delegation, failure status preservation, and missing account.
2. Run the focused API tests and confirm the new route/mode fails.
3. Add `2fa-protocol` worker mode and the `/replace-2fa-protocol` route.
4. Change the default child path to the independent adapter while preserving the existing DOM 2FA path and registration route.
5. Run service, worker, and API tests.

### Task 4: Add and order the frontend action

**Files:**
- Modify: `web/app.js`
- Modify: `test/replacementAccountsWeb.test.js`

**Steps:**
1. Add a failing frontend assertion for `协议注册` followed immediately by `协议补号` and the new endpoint/action handler.
2. Implement the action and place both protocol actions before all other operation buttons.
3. Run the frontend test.

### Task 5: Update operational documentation and validate

**Files:**
- Modify: `.env.example`
- Modify: `docs/project/api.md`
- Modify: `docs/project/deployment.md`
- Create or modify: `docs/changes/CHG-091-protocol-replacement-action.md`
- Modify: `docs/work/2026-07-20-protocol-replacement-operation.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**
1. Document `OPENAI_WORKSPACE_ID`, the endpoint, operation order, and failure/status behavior without recording secrets.
2. Run focused Node tests, Python tests, `node --check`, Python compile checks, and `git diff --check`.
3. Review the diff to ensure registration state-machine files were not changed by this feature.
