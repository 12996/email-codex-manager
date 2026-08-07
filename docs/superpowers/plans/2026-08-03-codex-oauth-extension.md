# Codex OAuth Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a pure Manifest V3 Chrome extension that performs local AT precheck, starts a user-driven Codex OAuth PKCE flow, captures the virtual localhost:1455 callback, exchanges the authorization code for a token bundle, and lets the user download only the refresh token.

**Architecture:** A persistent extension page remains open while a separate OAuth tab is active. The Service Worker owns PKCE state, callback observation, token exchange, expiry alarms, and RT download. Pure parsing and OAuth functions remain browser-independent ESM modules and are tested through the repository's Node test runner.

**Tech Stack:** Chrome Extension Manifest V3, browser crypto.subtle, chrome.webNavigation, chrome.storage.session, chrome.alarms, chrome.downloads, JavaScript ESM, Node.js 22, node:test.

## Global Constraints

- Target Windows Chrome and Edge only. Users manually enable Allow in incognito in extension details.
- Never run codex login, codex logout, a local process, Native Messaging, or a loopback listener.
- Observe exactly http://localhost:1455/auth/callback; do not bind port 1455.
- AT precheck is local and informational. An absent, opaque, malformed, or expired AT never blocks the independent OAuth button.
- OAuth success requires: the original authorization tab, exact callback path, one code, matching state, a successful exchange, and a nonempty refresh_token.
- Email, password, phone, MFA, and consent pages are user-controlled. Never fill controls or infer success from a click, DOM disappearance, or a generic navigation.
- Do not store AT, RT, code, verifier, Cookie, or full token response in local or sync Chrome storage, URLs, filenames, logs, errors, fixtures, or assertions.
- Use chrome.storage.session only for a transaction up to 15 minutes and an authenticated result up to 60 seconds. Clear on terminal state, alarm, explicit Clear, or download completion.
- RT download is the only disk write. An offscreen extension document, not the visible extension page or Service Worker,
  creates the one-time Blob. Its text file body is only the RT and its filename has no email or credential fragment.
- Add no dependency; retain the existing node --test test convention.

---

## File Structure

| Path | Responsibility |
|---|---|
| extensions/codex-oauth-login/manifest.json | Minimal Manifest V3 permissions and Service Worker registration. |
| extensions/codex-oauth-login/background.js | Chrome event/message wiring only. |
| extensions/codex-oauth-login/app.html | Persistent extension-page UI with no inline script. |
| extensions/codex-oauth-login/app.js | Local AT precheck and redacted state rendering. |
| extensions/codex-oauth-login/app.css | Standalone extension-page styling. |
| extensions/codex-oauth-login/download.html | Invisible offscreen document that can create a one-time Blob. |
| extensions/codex-oauth-login/download.js | Private offscreen Port handler for the RT-only download. |
| extensions/codex-oauth-login/lib/oauth-core.js | PKCE, callback parsing, AT precheck, claim extraction, exchange body. |
| extensions/codex-oauth-login/lib/auth-controller.js | Private session state machine, callback exchange, cleanup. |
| extensions/codex-oauth-login/lib/rt-download.js | RT-only Blob download helper used by the offscreen document. |
| extensions/codex-oauth-login/README.md | Load-unpacked, incognito, privacy, and validation instructions. |
| test/codexOauthExtensionCore.test.js | Pure OAuth function coverage. |
| test/codexOauthExtensionController.test.js | Fake Chrome API/controller coverage. |
| test/codexOauthExtensionDownload.test.js | Download payload and cleanup coverage. |
| .gitignore | Re-includes the extension HTML under the existing global HTML ignore rule. |
| docs/changes/CHG-108-codex-oauth-extension.md | Becomes implemented only after live acceptance. |
| docs/work/2026-08-03-codex-oauth-extension-design.md | Records non-sensitive evidence or a runtime blocker. |

## OAuth Constants

Copy the values already used by the verified browser flow in src/auto/roxy_oauth_login.js.

~~~js
export const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
export const OAUTH_SCOPE = 'openid profile email offline_access';
~~~

The authorization URL includes response_type=code, code_challenge_method=S256,
codex_cli_simplified_flow=true, id_token_add_organizations=true, a random state,
and the fixed redirect URI.

### Task 1: Create the Tested OAuth Core

**Files:**
- Create: extensions/codex-oauth-login/lib/oauth-core.js
- Create: test/codexOauthExtensionCore.test.js

**Interfaces:**
- Produces precheckAccessToken(rawToken, nowMs).
- Produces async createPkceTransaction({ cryptoApi, nowMs }).
- Produces parseOAuthCallback(urlText).
- Produces buildTokenExchangeBody({ code, verifier }).
- Produces extractDisplayClaims(tokenBundle).
- Task 2 consumes these exports; none may log credentials or include a supplied credential in an error.

- [x] **Step 1: Write the failing pure-function tests**

Create tests with node:test for all local branches.

~~~js
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  createPkceTransaction,
  parseOAuthCallback,
  precheckAccessToken,
} from '../extensions/codex-oauth-login/lib/oauth-core.js';

test('expired JWT is only a local precheck result', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 100 })).toString('base64url');
  assert.deepEqual(precheckAccessToken('a.' + payload + '.c', 101000), {
    kind: 'jwt-expired',
    expiresAt: 100000,
  });
});

test('PKCE transaction uses the fixed callback and fifteen-minute expiry', async () => {
  const transaction = await createPkceTransaction({ cryptoApi: webcrypto, nowMs: 1000 });
  const url = new URL(transaction.authorizationUrl);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(transaction.expiresAt, 901000);
});

test('only an exact callback with one code and state parses as valid', () => {
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/auth/callback?code=one&state=two'),
    { kind: 'valid', code: 'one', state: 'two' },
  );
  assert.deepEqual(
    parseOAuthCallback('http://localhost:1455/other?code=one&state=two'),
    { kind: 'not-callback' },
  );
});
~~~

Add explicit assertions for blank input, newline input, opaque input, malformed JWT JSON,
duplicate code, OAuth error, missing state, malformed token claims, email extraction,
and plan extraction. Do not use a real credential in fixtures.

- [x] **Step 2: Run the core test to verify RED**

Run:

~~~powershell
node --test test/codexOauthExtensionCore.test.js
~~~

Expected: FAIL because oauth-core.js does not exist.

- [x] **Step 3: Implement the core module**

Implement the following contract.

~~~js
export function parseOAuthCallback(urlText) {
  const url = new URL(urlText);
  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== '1455'
      || url.pathname !== '/auth/callback') return { kind: 'not-callback' };

  const error = url.searchParams.get('error');
  if (error) return { kind: 'error', error };

  const codes = url.searchParams.getAll('code');
  const states = url.searchParams.getAll('state');
  if (codes.length !== 1 || states.length !== 1 || !codes[0] || !states[0]) {
    return { kind: 'error', error: 'invalid_callback' };
  }
  return { kind: 'valid', code: codes[0], state: states[0] };
}
~~~

Use cryptoApi.getRandomValues for both state and verifier. Create the SHA-256 challenge
with cryptoApi.subtle.digest and base64url encoding. precheckAccessToken returns:
empty, invalid for newline values, opaque for non-JWT values, jwt-valid, or jwt-expired.
It must not report an opaque value as remotely invalid.

extractDisplayClaims decodes JWT payload JSON only. It returns email from id_token.email
and plan from access_token['https://api.openai.com/auth'].chatgpt_plan_type; missing or
malformed claims become null.

- [x] **Step 4: Run the core test to verify GREEN**

Run:

~~~powershell
node --test test/codexOauthExtensionCore.test.js
~~~

Expected: PASS.

- [x] **Step 5: Commit the core**

~~~powershell
git add extensions/codex-oauth-login/lib/oauth-core.js test/codexOauthExtensionCore.test.js
git commit -m "feat: add Codex OAuth extension core"
~~~

### Task 2: Implement the Virtual Callback Service Worker

**Files:**
- Create: extensions/codex-oauth-login/manifest.json
- Create: extensions/codex-oauth-login/background.js
- Create: extensions/codex-oauth-login/lib/auth-controller.js
- Create: test/codexOauthExtensionController.test.js

**Interfaces:**
- Consumes all Task 1 OAuth-core exports.
- Produces createAuthController(deps).
- Controller methods: startAuthorization(), handleBeforeNavigate(details), getPublicState(),
  clear(reason), handleAlarm(name), handleTabRemoved(tabId).
- getPublicState returns only phase, message, email, plan, and canDownloadRt.
- Task 2 background message types are auth:get-state, auth:start, and auth:clear. Task 3 adds auth:download-rt.

- [x] **Step 1: Write failing controller tests**

Create a fake chromeApi with session storage, tabs.create, alarms.create/clear,
runtime.sendMessage, and a queued fetch implementation. Test successful exchange,
wrong tab, wrong state, OAuth error, missing RT, expiry alarm, and authorization-tab close.

~~~js
test('only a matching callback in the authorization tab exchanges once', async () => {
  const harness = createControllerHarness({
    tokenResponse: {
      access_token: 'header.payload.signature',
      id_token: 'header.payload.signature',
      refresh_token: 'rt-test-value',
    },
  });
  await harness.controller.startAuthorization();
  const state = harness.chromeApi.session.codex_oauth_transaction.state;

  await harness.controller.handleBeforeNavigate({
    tabId: harness.chromeApi.createdTabId + 1,
    url: 'http://localhost:1455/auth/callback?code=code-one&state=' + state,
  });
  assert.equal(harness.fetchImpl.calls.length, 0);

  await harness.controller.handleBeforeNavigate({
    tabId: harness.chromeApi.createdTabId,
    url: 'http://localhost:1455/auth/callback?code=code-one&state=' + state,
  });
  assert.equal(harness.fetchImpl.calls.length, 1);
  assert.equal(harness.controller.getPublicState().phase, 'authenticated');
  assert.equal(harness.controller.getPublicState().canDownloadRt, true);
});
~~~

Assert emitted messages and errors do not contain code-one, rt-test-value, or the PKCE verifier.

- [x] **Step 2: Run the controller test to verify RED**

Run:

~~~powershell
node --test test/codexOauthExtensionController.test.js
~~~

Expected: FAIL because auth-controller.js does not exist.

- [x] **Step 3: Implement the injected-dependency controller**

Use these private storage keys and alarms.

~~~js
const TRANSACTION_KEY = 'codex_oauth_transaction';
const RESULT_KEY = 'codex_oauth_result';
const TRANSACTION_ALARM = 'codex_oauth_transaction_expiry';
const DOWNLOAD_ALARM = 'codex_oauth_download_expiry';
~~~

startAuthorization clears an old transaction, creates PKCE, writes only state/verifier/
expiresAt/phase to chrome.storage.session, opens a tab with the authorization URL,
persists the returned tab ID, then sets an absolute 15-minute alarm.

handleBeforeNavigate first parses the URL, requires an unexpired transaction with a
matching tab ID and state, marks it consumed before calling fetch, then issues exactly
one form request:

~~~js
await fetchImpl(OAUTH_TOKEN_URL, {
  method: 'POST',
  credentials: 'omit',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: buildTokenExchangeBody({ code, verifier }),
});
~~~

Only a successful JSON response with a nonempty refresh_token enters authenticated.
Save the private bundle only under RESULT_KEY in chrome.storage.session, save no raw
value in the public state, derive email/plan, and create a 60-second download alarm.
On any error, state mismatch, expired transaction, or response without RT, clear private
state and publish a static error category.

clear removes both session keys, clears both alarms, and publishes only a redacted state.
handleTabRemoved clears an active transaction only if the removed tab is authTabId.
handleAlarm clears the matching transaction/result.

- [x] **Step 4: Wire the Manifest and background events**

Create this minimal manifest, without a default popup or broad host permission.

~~~json
{
  "manifest_version": 3,
  "name": "Codex OAuth Login",
  "version": "0.1.0",
  "incognito": "split",
  "permissions": ["alarms", "downloads", "offscreen", "storage", "tabs", "webNavigation"],
  "host_permissions": ["https://auth.openai.com/*", "http://localhost:1455/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Codex OAuth Login" }
}
~~~

background.js opens app.html when chrome.action is clicked. It forwards
chrome.webNavigation.onBeforeNavigate events matching the exact localhost callback
filter to handleBeforeNavigate. It also wires chrome.tabs.onRemoved, chrome.alarms.onAlarm,
and chrome.runtime.onMessage. Async message listeners return true and return only
getPublicState results; no payload or response body reaches console logging.

- [x] **Step 5: Run controller tests and syntax checks to verify GREEN**

Run:

~~~powershell
node --test test/codexOauthExtensionController.test.js
node --check extensions/codex-oauth-login/background.js
node --check extensions/codex-oauth-login/lib/auth-controller.js
~~~

Expected: PASS. The test must prove that callback recognition happens from its URL before
any localhost connection result is considered.

- [x] **Step 6: Commit the callback worker**

~~~powershell
git add extensions/codex-oauth-login/manifest.json extensions/codex-oauth-login/background.js extensions/codex-oauth-login/lib/auth-controller.js test/codexOauthExtensionController.test.js
git commit -m "feat: capture Codex OAuth virtual callback"
~~~

### Task 3: Build the Extension Page and RT-only Download

**Files:**
- Create: extensions/codex-oauth-login/app.html
- Create: extensions/codex-oauth-login/app.js
- Create: extensions/codex-oauth-login/app.css
- Create: extensions/codex-oauth-login/download.html
- Create: extensions/codex-oauth-login/download.js
- Create: extensions/codex-oauth-login/lib/rt-download.js
- Create: test/codexOauthExtensionDownload.test.js
- Modify: extensions/codex-oauth-login/background.js
- Modify: .gitignore

**Interfaces:**
- Consumes Task 2 redacted messages and public state.
- Produces downloadRefreshToken({ refreshToken, downloadsApi, blobFactory, urlApi, nowMs }).
- app.js never receives or renders an RT; it only asks the worker to start a download.
- download.html opens a chrome.runtime Port named rt-download; only that Port receives the RT from the worker.

- [x] **Step 1: Write failing download tests**

Test an RT-only Blob body, neutral timestamp filename, empty-RT rejection, and URL cleanup.

~~~js
test('RT download contains only the refresh token and uses a neutral filename', async () => {
  const observed = { blobs: [], downloads: [] };
  const result = await downloadRefreshToken({
    refreshToken: 'rt-test-value',
    downloadsApi: { download: async options => { observed.downloads.push(options); return 42; } },
    blobFactory: parts => { observed.blobs.push(parts); return { parts }; },
    urlApi: { createObjectURL: () => 'blob:extension-value', revokeObjectURL: () => {} },
    nowMs: Date.UTC(2026, 7, 3, 1, 2, 3),
  });
  assert.deepEqual(observed.blobs, [['rt-test-value']]);
  assert.match(result.filename, /^codex-refresh-token-20260803-010203\.txt$/);
  assert.equal(observed.downloads[0].url, 'blob:extension-value');
});
~~~

- [x] **Step 2: Run the download test to verify RED**

Run:

~~~powershell
node --test test/codexOauthExtensionDownload.test.js
~~~

Expected: FAIL because rt-download.js does not exist.

- [x] **Step 3: Implement RT-only download and terminal cleanup**

rt-download.js creates a text Blob, calls chrome.downloads.download with saveAs true and
conflictAction uniquify, and returns downloadId/filename. Its filename format is
codex-refresh-token-YYYYMMDD-HHmmss.txt and has no account fields. Reject an empty RT
with the generic code refresh_token_missing.

Because a Manifest V3 Service Worker cannot create Blob URLs, implement download.html as
an offscreen document and download.js as its private runtime Port handler. download.js opens
chrome.runtime.connect with the name rt-download, accepts only a start message on that Port,
creates the Blob URL, starts chrome.downloads.download, and waits for complete or interrupted
on chrome.downloads.onChanged before revoking the URL and posting a terminal result without
an RT back through the same Port.

In the worker, auth:download-rt reads RESULT_KEY, calls chrome.offscreen.createDocument with
download.html and the BLOBS reason when no offscreen context exists, waits for the rt-download
Port handshake, then sends the RT only through that Port. The visible app page never receives
this message. A terminal Port message clears private session state and DOWNLOAD_ALARM. The
60-second alarm disconnects the Port, closes the offscreen document, and clears secrets if no
terminal download event arrives. A failed download reports a generic download failure.

- [x] **Step 4: Create the persistent extension page**

Create app.html with a password-type AT input, local precheck text, state text, email,
plan, and buttons for Web Login Codex, Download RT, and Clear. Use external app.css and
a module app.js; add no inline script, event attribute, raw token field, or credential URL.

app.js prechecks each input event locally and clears the field before starting OAuth.

~~~js
atInput.addEventListener('input', () => {
  renderPrecheck(precheckAccessToken(atInput.value, Date.now()));
});

loginButton.addEventListener('click', async () => {
  atInput.value = '';
  await chrome.runtime.sendMessage({ type: 'auth:start' });
  await refreshState();
});
~~~

On app load, call auth:get-state. Subscribe to redacted auth:state-changed messages.
Enable Download RT only when canDownloadRt is true. Clear overwrites the input and sends
auth:clear before rendering idle.

Add this exact exception after the root *.html ignore rule:

~~~gitignore
!extensions/codex-oauth-login/*.html
~~~

- [x] **Step 5: Run focused tests and static checks to verify GREEN**

Run:

~~~powershell
node --test test/codexOauthExtensionCore.test.js test/codexOauthExtensionController.test.js test/codexOauthExtensionDownload.test.js
node --check extensions/codex-oauth-login/app.js
node --check extensions/codex-oauth-login/lib/rt-download.js
git check-ignore -v extensions/codex-oauth-login/app.html
git check-ignore -v extensions/codex-oauth-login/download.html
~~~

Expected: all Node tests PASS and neither git check-ignore command prints a matching ignore rule.

- [x] **Step 6: Commit the UI and download feature**

~~~powershell
git add .gitignore extensions/codex-oauth-login/app.html extensions/codex-oauth-login/app.js extensions/codex-oauth-login/app.css extensions/codex-oauth-login/download.html extensions/codex-oauth-login/download.js extensions/codex-oauth-login/lib/rt-download.js extensions/codex-oauth-login/background.js test/codexOauthExtensionDownload.test.js
git commit -m "feat: add Codex OAuth RT download UI"
~~~

### Task 4: Run Live Browser Validation and Finalize Documentation

**Files:**
- Create: extensions/codex-oauth-login/README.md
- Modify: docs/changes/CHG-108-codex-oauth-extension.md
- Modify: docs/changes/CHANGE_REGISTRY.md
- Modify: docs/work/2026-08-03-codex-oauth-extension-design.md

**Interfaces:**
- Consumes the extension from Tasks 1-3.
- Produces the documented install workflow and updates CHG-108 to implemented only after a successful real browser run.

- [ ] **Step 1: Write the extension README**

Document these exact user steps:

~~~text
1. Open chrome://extensions or edge://extensions.
2. Enable Developer mode.
3. Select Load unpacked and choose extensions/codex-oauth-login.
4. Open Details and enable Allow in incognito.
5. Click the extension action to open the extension page.
6. Start Web Login Codex, complete only the real pages shown for that account, and download RT after success.
~~~

State that no local service runs at port 1455, no Codex CLI is invoked, Chrome storage is
session-only, and a downloaded RT file remains on disk after an incognito window closes.

- [ ] **Step 2: Run all extension tests before browser validation**

Run:

~~~powershell
node --test test/codexOauthExtensionCore.test.js test/codexOauthExtensionController.test.js test/codexOauthExtensionDownload.test.js
~~~

Expected: PASS with no credential value printed.

- [ ] **Step 3: Perform Windows Chrome/Edge acceptance**

Load the extension unpacked, enable incognito permission, and open the extension page in
an incognito window. Start an authorized real OAuth flow. Verify live runtime behavior in
this order:

~~~text
extension page -> authorization tab -> user-controlled account stages ->
localhost:1455 callback navigation -> matching state captured -> token exchange ->
email/plan or 未提供 -> Download RT enabled
~~~

Do not capture credentials in screenshots, consoles, fixtures, work logs, or docs. Confirm
that a later localhost connection error cannot overwrite a callback that was already
captured. Complete or cancel the RT download and confirm the page returns to idle without
displaying a credential.

- [ ] **Step 4: Handle a runtime blocker without broadening scope**

If the worker cannot observe the 1455 URL in incognito or the token endpoint rejects an
extension-context exchange, leave CHG-108 accepted, create an active docs/issues record
with only the error category and reproduction steps, and update the work record. Do not
add a listener, CLI fallback, Cookie injection, automated login fields, or broad host
permission.

If the live flow succeeds, mark all CHG-108 acceptance checks complete, set its status and
registry row to implemented, and append the non-sensitive command/results summary to the
same-day work record.

- [ ] **Step 5: Run repository verification**

Run:

~~~powershell
npm test
git diff --check
~~~

Expected: focused extension tests pass. If existing unrelated worktree modifications make
the full suite fail, record only their paths and summaries; do not alter or revert them.

- [ ] **Step 6: Commit the validation documentation**

For a successful browser run:

~~~powershell
git add extensions/codex-oauth-login/README.md docs/changes/CHG-108-codex-oauth-extension.md docs/changes/CHANGE_REGISTRY.md docs/work/2026-08-03-codex-oauth-extension-design.md
git commit -m "docs: validate Codex OAuth extension"
~~~

For a blocked browser run, commit only the README, issue, and work record; do not claim implementation success.

## Plan Self-Review

### Spec coverage

- Pure extension, no CLI/native host/loopback listener: Tasks 2 and 4.
- Local-only, nonblocking AT precheck: Tasks 1 and 3.
- User-driven OAuth states without form automation: global constraints and Task 4.
- Exact virtual callback and no false success from connection errors: Task 2.
- PKCE/token exchange/RT requirement and claim display: Tasks 1 and 2.
- RT-only download and cleanup: Task 3.
- Incognito setup, documentation, change status, and runtime evidence: Task 4.

### Placeholder scan

Every implementation and test item is assigned. Function names, state timeouts, OAuth URLs,
commands, expected outcomes, permissions, and cleanup behavior are defined explicitly.

### Type consistency

oauth-core.js owns pure values; auth-controller.js owns private session state and exposes
only getPublicState; download.js receives RT only through its private offscreen Port. All later
tasks use these exact function and message names.
