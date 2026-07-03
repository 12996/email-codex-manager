# iCloud Verification Code API Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a JSON API that reads iCloud verification codes from a configurable Gmail inbox.

**Architecture:** Keep the existing Gmail IMAP repository and message parsing path. Add a dedicated iCloud-code route that defaults to `rosannathornton1@gmail.com`, accepts a caller-specified Gmail mailbox, and prefers messages addressed to the requested iCloud account before falling back to the latest code in the mailbox.

**Tech Stack:** Node.js ESM, Express, ImapFlow-backed `imapService`, Node built-in test runner.

---

### Task 1: API behavior tests

**Files:**
- Modify: `test/verificationCodeApi.test.js`

**Step 1: Write failing tests**

Add tests for:
- `POST /api/icloud-verification-code/latest` uses the configured default Gmail mailbox when `gmailAccount` is omitted.
- The same endpoint honors request body `gmailAccount`.
- When `account` is provided, the endpoint prefers a code from a message addressed to that iCloud account.

**Step 2: Run test to verify it fails**

Run:

```powershell
node --test test\verificationCodeApi.test.js
```

Expected: fail because the route does not exist yet.

### Task 2: Minimal API implementation

**Files:**
- Modify: `src/config.js`
- Modify: `src/server.js`

**Step 1: Add default mailbox config**

Add `config.icloudCodeDefaultGmailAccount`, defaulting to `ICLOUD_CODE_GMAIL_ACCOUNT` or `rosannathornton1@gmail.com`.

**Step 2: Add endpoint**

Add `POST /api/icloud-verification-code/latest` with local-call auth bypass, matching the existing verification-code API policy.

**Step 3: Add target-aware extraction**

Prefer messages whose recipient metadata contains the requested iCloud account; if none contain a code, fall back to the latest code in the fetched messages.

**Step 4: Run tests**

Run:

```powershell
node --test test\verificationCodeApi.test.js
node --check src\server.js
node --check src\config.js
```

### Task 3: Documentation

**Files:**
- Create: `docs/changes/CHG-057-icloud-verification-code-api.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/project/api.md`
- Create: `docs/work/2026-07-02-icloud-verification-code-api.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

Document request shape, default mailbox, caller-specified mailbox, response shape, and the PRD merge reminder.

### Task 4: Final verification

Run:

```powershell
node --test test\verificationCodeApi.test.js
node --check src\server.js
node --check src\config.js
git diff --check
```

Expected: all commands exit 0.
