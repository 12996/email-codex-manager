# Replacement Email API Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plus status checks request the latest five messages from every replacement-account email API.

**Architecture:** `fetchReplacementEmailMessages()` remains the single API boundary. It will derive a request URL from the stored account URL and force its `limit` query parameter to `5`; callers and message matching remain unchanged.

**Tech Stack:** Node.js ESM, native `URL`, native `fetch`, `node:test`.

## Global Constraints

- Preserve all existing `email_code_api` query parameters and do not log sensitive query values.
- Do not change the stored account URL.
- Use test-first development and only modify the email API request boundary.

---

### Task 1: Add fixed-size mailbox retrieval

**Files:**
- Modify: `test/replacementEmailApiService.test.js`
- Modify: `src/replacementEmailApiService.js`
- Modify: `docs/project/api.md`

**Interfaces:**
- Consumes: `fetchReplacementEmailMessages(account, { fetchImpl })`.
- Produces: a GET request URL that retains the account URL parameters and includes `limit=5`.

- [x] **Step 1: Write the failing test**

```js
assert.deepEqual(calls, [[
  'https://mail.example.test/code?email=target%40icloud.com&limit=5',
  'GET',
]]);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/replacementEmailApiService.test.js`

Expected: FAIL because the current implementation calls the stored URL without `limit=5`.

- [x] **Step 3: Write minimal implementation**

```js
const requestUrl = new URL(apiUrl);
requestUrl.searchParams.set('limit', '5');
response = await fetchImpl(requestUrl, { method: 'GET', ... });
```

- [x] **Step 4: Run focused tests and an API replay**

Run: `node --test test/replacementEmailApiService.test.js test/replacementPlusStatusService.test.js`

Expected: all focused tests pass; the live replay for `10-buff-tactile@icloud.com` reports five messages and a Plus subscription match.

- [x] **Step 5: Update API contract and change/work records**

Document the fixed `limit=5` request behavior in `docs/project/api.md`, mark `CHG-101` implemented after verification, and record exact verification evidence in the daily work log.
