# Registration Page State Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Roxy OpenAI registration classify the current page before each action, and never fetch an email OTP until the page is confirmed to be an OTP input page.

**Architecture:** Add a small page-state classifier in `src/auto/roxy_register_openai.js` that centralizes URL/body/input checks. Reuse it in post-email routing and OTP wait logic so password, captcha, timeout, email-verification, and OTP pages are handled consistently.

**Tech Stack:** Node.js, Playwright locators, `node:test`.

---

### Task 1: Add RED tests for page-state classification

**Files:**
- Modify: `test/roxyRegisterOpenai.test.js`

**Steps:**
1. Add tests for `classifyRegistrationPage()` covering:
   - `log-in/password` -> `password-login`
   - `create-account/password` -> `password-create`
   - `email-verification` with OTP input before password -> `email-verification-before-password`
   - `email-verification` with OTP input after password -> `otp`
2. Run `node --test test\roxyRegisterOpenai.test.js`.
3. Expected RED: export/function missing.

### Task 2: Add RED test for OTP-before-fetch ordering

**Files:**
- Modify: `test/roxyRegisterOpenai.test.js`

**Steps:**
1. Add a test proving `submitOtpWithRetry()` calls `waitForOtpInput()` before `fetchCode()`.
2. Run `node --test test\roxyRegisterOpenai.test.js`.
3. Expected RED: current implementation fetches code first.

### Task 3: Implement page-state classifier

**Files:**
- Modify: `src/auto/roxy_register_openai.js`

**Steps:**
1. Add `classifyRegistrationPage(page, options)`.
2. Update `detectNextRegistrationStep()` to use classifier.
3. Export `classifyRegistrationPage()` and `submitOtpWithRetry()` for tests.
4. Run focused tests.

### Task 4: Move OTP fetch after OTP page confirmation

**Files:**
- Modify: `src/auto/roxy_register_openai.js`

**Steps:**
1. In `submitOtpWithRetry()`, run `waitForOtpInput()` before calling `fetchCode()`.
2. Keep `OTP_REFETCH_AFTER_RECOVERY` handling unchanged.
3. Ensure no code is fetched while page is password/unknown.

### Task 5: Verify and document

**Files:**
- Modify: `docs/changes/CHG-067-registration-password-stale-page-guard.md`
- Modify: `docs/work/2026-07-03-registration-password-stale-page-guard.md`
- Modify: `docs/work/handoff.md`

**Commands:**
- `node --check src\auto\roxy_register_openai.js`
- `node --test test\roxyRegisterOpenai.test.js`
- `node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js`
- `git diff --check`
