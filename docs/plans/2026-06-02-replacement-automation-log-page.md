# Replacement Automation Log Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated page for viewing replacement automation child-process logs and stopping a running child process.

**Architecture:** Store one row per automation run in SQLite and write stdout/stderr to a log file under `data/automation-logs/`. Keep live child-process handles in memory for the current server session so `/stop` can kill only processes started by this service instance.

**Tech Stack:** Node.js ESM, Express, better-sqlite3, vanilla HTML/CSS/JS, `node --test`.

---

### Task 1: Change and schema

**Files:**
- Create: `docs/changes/CHG-017-replacement-automation-log-page.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `src/db.js`
- Create: `src/replacementAutomationRuns.js`

**Steps:**
1. Create the change record with status `implemented` once the code is complete.
2. Add `replacement_automation_runs` table with account, status, PID, log path and timestamps.
3. Add repository methods for create/list/read/update run states.

### Task 2: Child-process logging and stop control

**Files:**
- Modify: `src/replacementServices.js`
- Test: `test/replacementServices.test.js`

**Steps:**
1. Add failing tests for run creation, log appending, and stop behavior.
2. Write stdout/stderr chunks to the run log file in real time.
3. Track active child processes in memory by run id.
4. Implement `stopReplacementRun(runId)` with no blind PID killing.

### Task 3: API and page

**Files:**
- Modify: `src/server.js`
- Modify: `web/sidebar.html`
- Create: `web/automation-logs.html`
- Create: `web/automation-logs.js`
- Modify: `web/styles.css`
- Test: `test/replacementAccountsApi.test.js`
- Test: `test/replacementAccountsWeb.test.js`

**Steps:**
1. Add `/replacement-automation-logs` page route.
2. Add `GET /replacement-automation-runs`, `GET /replacement-automation-runs/:id`, and `POST /replacement-automation-runs/:id/stop`.
3. Build a simple log viewer with polling and a stop button for `running` rows.

### Task 4: Docs and verification

**Files:**
- Modify: `docs/project/api.md`
- Modify: `docs/work/2026-06-02-roxy-openai登录页邮箱处理与超时判断.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**
1. Document the new page and APIs.
2. Run focused tests:
   - `node --test .\test\replacementServices.test.js`
   - `node --test .\test\replacementAccountsApi.test.js`
   - `node --test .\test\replacementAccountsWeb.test.js`
   - `node --check .\src\replacementServices.js`
   - `node --check .\src\server.js`
