# Protocol Replacement Live Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在补号管理主页面的补号列表下方显示当前协议补号的实时日志，同时保留历史自动化日志页不变。

**Architecture:** 复用现有协议注册的 SSE 进度流模式。协议补号路由在请求 `Accept: text/event-stream` 时流式返回，`cpaRepairWorker` 将子进程 stdout/stderr、CPA 读取/上传/复查步骤通过回调转发；`web/app.js` 增加独立的协议补号日志状态和事件处理，`web/index.html` 将面板放在补号表格后、协议注册日志前。

**Tech Stack:** Node.js、Express SSE、原生 JavaScript、HTML/CSS、Node `node:test`。

---

### Task 1: Write failing regression tests

**Files:**
- Modify: `test/replacementAccountsWeb.test.js`
- Modify: `test/replacementAccountsApi.test.js`
- Modify: `test/cpaRepairWorker.test.js`

**Steps:**

1. Assert the replacement page contains a protocol replacement live-log panel immediately after the account table panel.
2. Assert the frontend uses `Accept: text/event-stream` for protocol replacement and handles replacement-specific live-log IDs/events.
3. Assert the protocol replacement route streams when requested and passes live-log callbacks through the worker.
4. Assert the worker forwards child logs and CPA post-processing steps to `onLog`.
5. Run the focused tests and confirm they fail because the panel/event forwarding is absent.

### Task 2: Implement backend live-event forwarding

**Files:**
- Modify: `src/cpaRepairWorker.js`
- Modify: `src/server.js`

**Steps:**

1. Add a safe `onLog` callback to `cpaRepairWorker.repair()`.
2. Pass the callback to `replaceAccountWith2FAProtocol()`.
3. Emit sanitized step events for CPA file read, upload, health verification, success, and failure.
4. Add an SSE branch to `/replacement-accounts/:id/replace-2fa-protocol`, while preserving the existing JSON response for non-SSE clients.
5. Keep status updates, CPA upload, health checks, and historical run-log persistence unchanged.

### Task 3: Implement the main-page panel and client flow

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Test: `test/replacementAccountsWeb.test.js`

**Steps:**

1. Add `protocolReplacementLivePanel` immediately after the replacement account table panel.
2. Add account, summary, clear button, and scrollable log elements with distinct IDs.
3. Make `replaceAccountWith2FAProtocol()` open/reset the panel and consume the SSE stream.
4. Add replacement-specific state guards so repeated clicks do not start concurrent protocol replacement runs.
5. Render start, step, stdout/stderr, success, failure, and completion events without changing the historical automation log page.

### Task 4: Verify and document

**Files:**
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**

1. Run focused web/API/worker tests.
2. Run related Node regression tests and `node --check` on modified JavaScript files.
3. Run `git diff --check` on the changed files.
4. Record the final layout and verification results in the work/change documents.
