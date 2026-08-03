# Codex JWT AT Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the OAuth/RT Chrome extension with a JWT AT validator that verifies an Agent Identity JWT locally and displays only login state, email, plan, and clear.

**Architecture:** The extension page sends a JWT once to the Service Worker and clears the password input immediately. The worker fetches only the fixed public ChatGPT JWKS, verifies the JWT through Web Crypto, and stores only a redacted public result plus a random attempt ID in `chrome.storage.session`.

**Tech Stack:** Manifest V3, Chrome `storage.session`, `fetch`, Web Crypto `subtle`, JavaScript ESM, Node.js 22, `node:test`.

## Global Constraints

- Work in the current `main` checkout; the user explicitly declined another worktree.
- Accept only Agent Identity JWTs with three base64url segments, `RS256`, matching JWK, exact issuer/audience, future `exp`, numeric `iat`, and required identity claims.
- Fetch only `https://chatgpt.com/backend-api/wham/agent-identities/jwks`; never transmit the JWT to any network endpoint.
- Never invoke Codex CLI, OAuth, loopback callback, token exchange, RT download, Native Messaging, Cookie injection, or a local service.
- Never write a JWT or sensitive claim to storage, URLs, logs, errors, downloads, page text, or HTML attributes. The password input's runtime value and one runtime message are the only transient locations.
- Public state is exactly `phase`, `message`, `email`, and `plan`.
- Add no dependency; tests use generated RSA keys and synthetic JWTs only.
- Do not set CHG-109 to `implemented` until a user-owned JWT succeeds in a manually loaded extension. Do not request the JWT in chat.

---

## File Structure

| Path | Responsibility |
|---|---|
| `extensions/codex-oauth-login/lib/jwt-auth-core.js` | Strict JWT parsing, claim validation, JWK selection, and RS256 verification. |
| `extensions/codex-oauth-login/lib/jwt-auth-controller.js` | JWKS request, session attempt, redacted state, and clear-race prevention. |
| `extensions/codex-oauth-login/background.js` | Action and redacted message routing. |
| `extensions/codex-oauth-login/app.{html,js,css}` | JWT input and redacted status/clear UI. |
| `extensions/codex-oauth-login/manifest.json` | Minimal `storage` permission and ChatGPT JWKS host permission. |
| `test/codexJwtExtensionCore.test.js` | Synthetic RS256/JWKS verification tests. |
| `test/codexJwtExtensionController.test.js` | Redaction, error, and clear-race tests. |
| `test/codexJwtExtensionSurface.test.js` | Manifest and obsolete-OAuth surface contract. |

Delete after the new surface is green:

- `extensions/codex-oauth-login/lib/oauth-core.js`
- `extensions/codex-oauth-login/lib/auth-controller.js`
- `extensions/codex-oauth-login/lib/rt-download.js`
- `extensions/codex-oauth-login/download.html`
- `extensions/codex-oauth-login/download.js`
- `test/codexOauthExtensionCore.test.js`
- `test/codexOauthExtensionController.test.js`
- `test/codexOauthExtensionDownload.test.js`

### Task 1: Create the Strict JWT Verification Core

**Files:** Create `test/codexJwtExtensionCore.test.js` and `extensions/codex-oauth-login/lib/jwt-auth-core.js`.

**Interfaces:**

```js
export const AGENT_IDENTITY_AUDIENCE = 'codex-app-server';
export const AGENT_IDENTITY_ISSUER = 'https://chatgpt.com/codex-backend/agent-identity';
export const AGENT_IDENTITY_JWKS_URL = 'https://chatgpt.com/backend-api/wham/agent-identities/jwks';
export function inspectJwtInput(rawJwt);
export async function verifyAgentIdentityJwt({ rawJwt, jwks, cryptoApi, nowMs });
```

`inspectJwtInput` returns only `valid-format` or `invalid-format`. `verifyAgentIdentityJwt` returns only `{ email, plan }` or throws an error with a static code.

- [ ] **Step 1: Write failing tests**

Generate a fixture RSA key pair with `webcrypto.subtle.generateKey`, export a public JWK carrying fixture-only `kid`, and sign a synthetic JWT. Assert that a verified fixture returns `{ email: 'friend@example.com', plan: 'pro' }`. Add isolated rejection tests for blank/multiline/non-JWT input, absent `kid`, non-`RS256`, missing JWK, changed signature, wrong issuer/audience, expired `exp`, nonnumeric `iat`, and a missing required identity claim. Assert a valid token without `email` returns `email: null`.

- [ ] **Step 2: Verify RED**

```powershell
node --test test/codexJwtExtensionCore.test.js
```

Expected: import failure because `jwt-auth-core.js` does not exist.

- [ ] **Step 3: Implement the minimal core**

Decode base64url without putting parser data in errors. Require `alg: 'RS256'`, a nonempty `kid`, and a JWK with exact `kid`, `kty: 'RSA'`, `use: 'sig'`, and `alg: 'RS256'`. Verify the original header/payload bytes with `cryptoApi.subtle.verify('RSASSA-PKCS1-v1_5', ...)`. Only after a valid signature require exact issuer/audience, future `exp`, numeric `iat`, all required identity fields, and extract only nonempty `email` and `plan_type`.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test test/codexJwtExtensionCore.test.js
```

Expected: all core cases pass.

- [ ] **Step 5: Commit**

```powershell
git add extensions/codex-oauth-login/lib/jwt-auth-core.js test/codexJwtExtensionCore.test.js
git commit -m "feat: verify Codex JWT access tokens"
```

### Task 2: Add the Redacted JWT Session Controller

**Files:** Create `test/codexJwtExtensionController.test.js` and `extensions/codex-oauth-login/lib/jwt-auth-controller.js`.

**Interfaces:**

```js
export const JWT_AUTH_ATTEMPT_KEY = 'codex_jwt_auth_attempt';
export const JWT_AUTH_PUBLIC_STATE_KEY = 'codex_jwt_auth_public_state';
export function createJwtAuthController({ chromeApi, fetchImpl, verifyJwt, cryptoApi, now, createAttemptId });
```

The returned controller exposes `startJwtLogin(rawJwt)`, `clear()`, and `getPublicState()`.

- [ ] **Step 1: Write failing controller tests**

Create an in-memory `chromeApi.storage.session`, a queued `fetchImpl`, and an injected `verifyJwt`. Test that a successful `startJwtLogin('synthetic-jwt-value')` returns exactly:

```js
{
  phase: 'authenticated',
  message: '已登录（JWT AT 已验证）',
  email: 'friend@example.com',
  plan: 'pro',
}
```

Assert the synthetic JWT does not occur in session storage or published messages. Add individual tests for local format failure with no JWKS fetch, non-OK/JWKS JSON/verification errors with the generic failure message, a rejected visible-page message listener, and a deferred JWKS response where `clear()` happens before resolution. The late success must leave state `idle`.

- [ ] **Step 2: Verify RED**

```powershell
node --test test/codexJwtExtensionController.test.js
```

Expected: import failure because `jwt-auth-controller.js` does not exist.

- [ ] **Step 3: Implement the controller**

Use immutable public states `idle` (`等待登录`) and `validating` (`正在校验 AT`) with null email/plan. On login, clear old state, reject local format errors before networking, store only a random attempt ID, publish validating, then call:

```js
await fetchImpl(AGENT_IDENTITY_JWKS_URL, { credentials: 'omit' });
```

Require `response.ok` and valid JSON before `verifyJwt`. Before publishing a terminal result, reread the attempt ID; a mismatch returns current state without publishing. Local format failure publishes `请输入有效的 JWT AT`; all remaining failures publish `AT 校验失败，请检查凭证或稍后重试` and remove private attempt state. `clear()` removes both session keys and publishes idle.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test test/codexJwtExtensionController.test.js
```

Expected: all controller cases pass.

- [ ] **Step 5: Commit**

```powershell
git add extensions/codex-oauth-login/lib/jwt-auth-controller.js test/codexJwtExtensionController.test.js
git commit -m "feat: add redacted JWT auth session"
```

### Task 3: Replace the Extension Surface and Delete OAuth/RT Code

**Files:** Create `test/codexJwtExtensionSurface.test.js`; modify `manifest.json`, `background.js`, `app.html`, `app.js`, `app.css`, and `README.md`; delete every obsolete path listed above.

**Interfaces:**

- Background handles only `auth:get-state`, `auth:login-jwt`, and `auth:clear`.
- App sends `{ type: 'auth:login-jwt', jwt }` once after copying and clearing the password input.
- Manifest has `permissions: ['storage']`, `host_permissions: ['https://chatgpt.com/*']`, and `incognito: 'split'`.

- [ ] **Step 1: Write the failing surface contract test**

Create a file-system test that parses `manifest.json`, reads the extension sources, and asserts:

```js
assert.deepEqual(manifest.permissions, ['storage']);
assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
assert.doesNotMatch(backgroundSource, /webNavigation|oauth\/token|auth:download-rt/);
assert.doesNotMatch(appHtml, /下载 RT|网页登录 Codex/);
assert.match(appHtml, /使用 JWT 登录/);
assert.doesNotMatch(appSource, /auth:start|auth:download-rt/);
```

The same test asserts that every obsolete OAuth/RT source and test path no longer exists.

- [ ] **Step 2: Verify RED**

```powershell
node --test test/codexJwtExtensionSurface.test.js
```

Expected: failure against the current OAuth/RT extension.

- [ ] **Step 3: Implement the replacement**

Replace the manifest with only the documented permission and host permission. Simplify the Service Worker to instantiate `createJwtAuthController`, open `app.html`, and route the three messages without logging payloads. Replace the page with `JWT AT` password input, status/email/plan fields, `使用 JWT 登录`, and `清除`. Capture then immediately clear the input before its one runtime message.

Delete every OAuth/PKCE/callback/RT/download/offscreen module and old OAuth test. Rewrite the README to explain the Agent Identity JWT boundary, lack of ChatGPT web login and RT, session redaction, and manual unpacked/incognito setup.

- [ ] **Step 4: Verify GREEN**

```powershell
node --test test/codexJwtExtensionCore.test.js test/codexJwtExtensionController.test.js test/codexJwtExtensionSurface.test.js
node --check extensions/codex-oauth-login/background.js
node --check extensions/codex-oauth-login/app.js
node --check extensions/codex-oauth-login/lib/jwt-auth-core.js
node --check extensions/codex-oauth-login/lib/jwt-auth-controller.js
Get-Content -Raw extensions/codex-oauth-login/manifest.json | ConvertFrom-Json | Out-Null
```

Expected: focused tests pass, scripts parse, and manifest JSON parses.

- [ ] **Step 5: Commit**

```powershell
git add extensions/codex-oauth-login test/codexJwtExtensionSurface.test.js
git rm test/codexOauthExtensionCore.test.js test/codexOauthExtensionController.test.js test/codexOauthExtensionDownload.test.js
git commit -m "feat: replace OAuth extension with JWT AT login"
```

### Task 4: Validate and Finalize Change Records

**Files:** Modify `docs/changes/CHG-109-codex-jwt-at-extension.md`, `docs/changes/CHG-108-codex-oauth-extension.md`, `docs/changes/CHANGE_REGISTRY.md`, `docs/work/2026-08-03-codex-jwt-at-extension-design.md`, and `docs/work/work-log.md`. Modify `handoff.md` only when today's work is concluded.

- [ ] **Step 1: Record accepted change status**

Set CHG-109 and its registry row to `accepted`. Mark CHG-108 and its registry row `superseded`, citing CHG-109. Preserve unrelated dirty registry edits and stage only this change's hunk.

- [ ] **Step 2: Run broad verification**

```powershell
npm test
git diff --check
```

If unrelated working-tree changes fail, record only their paths and summaries; do not alter or revert them.

- [ ] **Step 3: Perform user-controlled browser acceptance**

The user reloads the unpacked extension, enables incognito permission if needed, opens the extension, and enters a real JWT locally. Do not request or inspect its value. Verify only:

```text
JWT input -> validating -> authenticated or generic failed -> clear -> idle
```

Success requires `已登录（JWT AT 已验证）`, email/plan or `未提供`, and clear returning to idle. A rejected JWT/JWKS result is not success and must leave no account data.

- [ ] **Step 4: Finalize based on observed result**

If manual validation succeeds, check CHG-109 acceptance boxes, set CHG-109/registry to `implemented`, append only redacted outcome categories to the work record, and commit docs. If it fails because the token is not an Agent Identity JWT or JWKS rejects it, leave CHG-109 `accepted`, create a redacted active issue, and do not add permissive JWT, Cookie, OAuth, or CLI fallback.

- [ ] **Step 5: Commit validation docs**

```powershell
git add docs/changes/CHG-108-codex-oauth-extension.md docs/changes/CHG-109-codex-jwt-at-extension.md docs/changes/CHANGE_REGISTRY.md docs/work/2026-08-03-codex-jwt-at-extension-design.md docs/work/work-log.md
git commit -m "docs: validate Codex JWT AT extension"
```

## Plan Self-Review

### Spec coverage

- Strict JWT-only, fixed-JWKS validation: Task 1.
- Session redaction, generic failures, and clear race: Task 2.
- OAuth/RT removal and minimal Manifest/UI: Task 3.
- Change lifecycle, automated verification, and user-controlled runtime proof: Task 4.

### Placeholder scan

All files, interfaces, user-visible messages, fixed URL, claims, test cases, commands, cleanup paths, and documentation outcomes are explicit. No real credential is required by the plan.

### Type consistency

Task 1 exports `verifyAgentIdentityJwt`; Task 2 accepts it as `verifyJwt`; Task 3 imports `createJwtAuthController` and sends `auth:login-jwt`. Public state always has exactly `phase`, `message`, `email`, and `plan`.
