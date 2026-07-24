# Protocol Registration Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow multiple protocol-registration requests to queue in FIFO order while executing only one Roxy protocol registration at a time.

**Architecture:** Add an in-memory queue owned by the Express application. `POST /replacement-accounts/:id/register-protocol` enqueues an eligible account and returns immediately; a single worker invokes the existing protocol-registration execution path. Queue state is exposed as JSON and rendered in the replacement-management page. Clearing removes only waiting jobs; service shutdown drops all queue state.

**Tech Stack:** Node.js, Express, existing replacement account repository and protocol automation service, vanilla browser JavaScript, Node test runner.

---

### Task 1: Queue unit tests and queue module

**Files:**
- Create: `src/protocolRegistrationQueue.js`
- Create: `test/protocolRegistrationQueue.test.js`

**Step 1: Write failing tests**

Cover FIFO single concurrency, duplicate account rejection, result state transitions, and clearing waiting jobs without cancelling the active job.

**Step 2: Run the test to verify it fails**

Run: `node --test test/protocolRegistrationQueue.test.js`

**Step 3: Implement the minimal queue**

Expose `enqueue(account)`, `getSnapshot()`, and `clearPending()`. Store jobs only in memory with `queued`, `running`, `succeeded`, or `failed` state. Start exactly one drain loop; invoke the injected async worker one job at a time.

**Step 4: Run the test to verify it passes**

Run: `node --test test/protocolRegistrationQueue.test.js`

### Task 2: Route queueing and status APIs

**Files:**
- Modify: `src/server.js:659-724`
- Modify: `test/replacementAccountsApi.test.js`

**Step 1: Write failing route tests**

Verify protocol registration POST returns `202` with queue metadata, duplicate queued/running account returns `409`, queue snapshot returns current/running/waiting/completed state, and `DELETE /protocol-registration-queue` clears waiting jobs only.

**Step 2: Run the focused API test to verify it fails**

Run: `node --test test/replacementAccountsApi.test.js`

**Step 3: Implement route integration**

Extract the existing route execution body into the queue worker so its success path still writes `registered` and its failure path still records the account operation error. Create one queue per `createApp()` invocation. Add authenticated snapshot and clear endpoints. Preserve the existing SSE/log behavior for the active job through queue state and automation-run logs; do not persist queue jobs.

**Step 4: Run API tests to verify they pass**

Run: `node --test test/replacementAccountsApi.test.js`

### Task 3: Replacement-management queue panel

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css` if required
- Modify: `test/replacementAccountsWeb.test.js`

**Step 1: Write failing web tests**

Verify the protocol registration action marks the row as queued immediately, queue panel renders active and waiting accounts, and clear action calls the clear endpoint then refreshes the displayed queue.

**Step 2: Run the focused web test to verify it fails**

Run: `node --test test/replacementAccountsWeb.test.js`

**Step 3: Implement the panel and polling**

Add an in-page "协议注册队列" panel to the replacement-management page, with active account, waiting account list, recent completed/failed results, progress counts, and a clear-waiting button. Poll the snapshot endpoint while jobs exist; update the affected account rows to "排队中" or "注册中" without changing their persisted business status.

**Step 4: Run web tests to verify they pass**

Run: `node --test test/replacementAccountsWeb.test.js`

### Task 4: Documentation and final verification

**Files:**
- Create: `docs/changes/CHG-094-protocol-registration-single-concurrency-queue.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/project/api.md`
- Create: `docs/work/2026-07-23-protocol-registration-queue.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Step 1: Document behavior**

Record FIFO, one active worker, in-memory-only lifecycle, duplicate handling, queue endpoints, page panel, and that clear affects only waiting jobs.

**Step 2: Run verification**

Run:

```powershell
node --check src/protocolRegistrationQueue.js
node --check src/server.js
node --test test/protocolRegistrationQueue.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js
git diff --check
```

**Step 3: Commit**

Commit only the queue implementation and associated documentation after reviewing the diff; do not include unrelated existing worktree changes.
