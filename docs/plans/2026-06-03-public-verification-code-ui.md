# Public Verification Code UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `public_code_enabled` and `public_code_key` visible and manageable from the replacement account UI, with a one-click public verification URL copy action.

**Architecture:** Keep the existing backend JSON API unchanged because it already persists and authorizes public code fields. Extend `web/index.html` account form and `web/app.js` rendering/actions so the UI submits the fields, displays key state, and copies `/api/verification-code/public/latest?key=...`.

**Tech Stack:** Node.js built-in test runner, static HTML/CSS/JS frontend, existing Express routes.

---

### Task 1: Frontend behavior test

**Files:**
- Modify: `test/replacementAccountsWeb.test.js`

**Step 1: Write the failing test**

Add assertions that `web/index.html` contains public code controls and `web/app.js` contains:
- `public_code_enabled`
- `public_code_key`
- copy action label and public endpoint path

**Step 2: Run test to verify it fails**

Run: `npm test -- test/replacementAccountsWeb.test.js`

Expected: FAIL because the current UI does not contain these controls/actions.

### Task 2: Minimal UI implementation

**Files:**
- Modify: `web/index.html`
- Modify: `web/app.js`

**Step 1: Implement form fields**

Add:
- checkbox `name="public_code_enabled"`
- input `name="public_code_key"`

**Step 2: Implement save normalization**

Convert checkbox value into `1` or `0` before saving. Preserve custom key input; blank means backend regenerates when explicitly submitted.

**Step 3: Implement copy action**

Add an action menu button `复制公开验证码 URL`; if disabled or missing key, show toast. Otherwise copy `${location.origin}/api/verification-code/public/latest?key=${encodeURIComponent(key)}`.

**Step 4: Run focused test**

Run: `npm test -- test/replacementAccountsWeb.test.js`

Expected: PASS.

### Task 3: Documentation and change record

**Files:**
- Modify: `docs/project/api.md`
- Create: `docs/changes/CHG-018-public-verification-code-ui.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create/update: `docs/work/2026-06-03-public-verification-code-ui.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Step 1: Document UI usage**

Explain that the replacement account page exposes enable/key/copy controls.

**Step 2: Record change**

Create CHG-018 as `implemented`.

**Step 3: Run final checks**

Run: `npm test -- test/replacementAccountsWeb.test.js`

Expected: PASS.
