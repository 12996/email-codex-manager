# Protocol Registration State Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the response-driven protocol registration sequence documented by CHG-100 so password submission only follows successful email OTP validation and the returned password continuation.

**Architecture:** Keep the existing `run_registration()` entrypoint and Auth helpers. Change only its orchestration: use the recorded OAuth parameters, validate the pre-password OTP with an `authorize_continue` Sentinel token, require `username_password_create` from the validation response, then navigate that continuation before requesting the password Sentinel token and submitting `user/register`.

**Tech Stack:** Python 3.10, `unittest`, Roxy CDP bridge.

## Global Constraints

- Do not reuse the failed account or interact with the currently open Roxy window.
- Preserve the existing post-password OTP branch and all persistence behavior.
- Use actual Auth response page types, not URL presence, as state-transition evidence.

---

### Task 1: Lock the response-driven ordering with a regression test

**Files:**
- Modify: `src/auto/protocol_registration/tests/test_roxy_bridge.py`

**Interfaces:**
- Consumes: `main.run_registration(email, name, otp_code)`.
- Produces: a test proving `validate_email_otp()` is called before `register_user()` and that the password continuation is navigated before password submission.

- [ ] **Step 1: Write the failing test**

Mock the existing registration dependencies so OTP validation returns:

```python
{"page": {"type": "username_password_create"}, "continue_url": "https://auth.openai.com/create-account/password"}
```

Record calls to `validate_email_otp`, `follow_auth_continue`, and `register_user`; assert their order is OTP validation, password continuation navigation, then password registration. Also assert `signin_openai()` receives `screen_hint="login_or_signup"`, `prompt="login"`, and `include_login_hint=True`.

- [ ] **Step 2: Run the focused test and verify it fails against `ab37db5`**

Run: `python -m unittest tests.test_roxy_bridge.RoxyBridgeTests.test_registration_verifies_email_before_submitting_password`

Expected: FAIL because the current code submits `user/register` before `validate_email_otp`.

- [ ] **Step 3: Implement the minimal orchestration change**

Restore the documented sequence in `main.run_registration()` without changing Auth helper interfaces.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `python -m unittest tests.test_roxy_bridge.RoxyBridgeTests.test_registration_verifies_email_before_submitting_password`

Expected: PASS.

### Task 2: Verify the protocol module and document the recovered state

**Files:**
- Modify: `src/auto/protocol_registration/main.py`
- Modify: `docs/changes/CHG-100-protocol-registration-response-driven-navigation.md`
- Modify: `docs/work/2026-07-30-protocol-registration-state-recovery.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Interfaces:**
- Consumes: the regression test from Task 1.
- Produces: a verified recovery with an explicit warning that the previous uncommitted source was not present in Git history.

- [ ] **Step 1: Run focused protocol tests**

Run: `python -m unittest tests.test_roxy_bridge tests.test_password_registration`

Expected: all tests pass.

- [ ] **Step 2: Compile the restored module**

Run: `python -m py_compile main.py core/openai_auth.py`

Expected: exit code 0.

- [ ] **Step 3: Record the recovery**

Update CHG-100 and today’s work/handoff records with the recovered sequence, test evidence, and the remaining requirement for a fresh-account live validation.

