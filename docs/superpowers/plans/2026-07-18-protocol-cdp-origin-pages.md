# Protocol CDP Origin Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep ChatGPT, Auth, and Sentinel requests in separate background CDP pages within one Roxy BrowserContext so OAuth state survives origin changes.

**Architecture:** `RoxyCdpBridge` will maintain an origin-to-page map. `request()` and `sentinel()` select the page for the target origin; `navigate()` selects the page for the URL's origin before following redirects. All pages share the same Roxy BrowserContext, so cookies, IP, and fingerprint remain shared without visible DOM automation.

**Tech Stack:** Node.js CommonJS bridge, Playwright Core over Roxy CDP, Node built-in test runner, Python `unittest` for protocol regression tests.

## Global Constraints

- Do not change Roxy profile selection, fingerprint refresh, proxy rotation, or email-service direct networking.
- Enforce same-egress-IP checks during a registration; do not continue an OAuth session after Roxy reports a new `proxyInfo.lastIp`.
- Do not add DOM click/fill automation.
- Do not log cookies, access tokens, OTP codes, Sentinel headers, or proxy credentials.
- Preserve the existing JSONL bridge protocol on stdout; diagnostics remain on stderr.
- Preserve the existing `Failed to fetch` retry behavior.

---

### Task 1: Add a failing origin-isolation regression test

**Files:**
- Modify: `test/roxyCdpBridge.test.js`
- Reference: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`

**Interfaces:**
- The bridge will expose its internal `pagesByOrigin` map for test inspection only through the instance property; no public JSONL command changes.
- `ensureOrigin(url, timeoutMs)` will return the selected Playwright page.

- [ ] **Step 1: Write the failing test**

Add a fake BrowserContext whose `newPage()` returns pages with independent `url()`, `goto()`, `waitForLoadState()`, `evaluate()`, and `isClosed()` methods. Stub `bridge.ensureConnected()` to initialize the fake context and a blank page. Call `ensureOrigin()` for ChatGPT, Auth, Sentinel, then Auth again. Assert that:

```js
assert.notEqual(chatPage, authPage);
assert.notEqual(authPage, sentinelPage);
assert.equal(authAgain, authPage);
assert.equal(authPage.gotoCalls, 1);
```

Also call `navigate()` with an Auth authorize URL and assert that the Auth page receives the exact authorize URL instead of the ChatGPT page.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- test/roxyCdpBridge.test.js
```

Expected: the new test fails because the current bridge has only `this.page`, `ensureOrigin()` returns no page, and `navigate()` always uses the current page.

### Task 2: Implement origin-scoped page selection

**Files:**
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- Test: `test/roxyCdpBridge.test.js`

**Interfaces:**
- Add `this.pagesByOrigin = new Map()` and `this.ownedPages = new Set()` in the constructor.
- Add `async pageForOrigin(url, timeoutMs)` returning a live page for the URL origin.
- Change `ensureOrigin(url, timeoutMs)` to return `pageForOrigin(url, timeoutMs)`.
- `request()` uses the returned page for `evaluate()` and diagnostics.
- `navigate()` uses the page selected by the target URL origin and maps the page to the final origin after redirects.
- `sentinel()` uses the selected Sentinel page for cookie setup, SDK injection, and token generation.

- [ ] **Step 1: Implement the smallest page pool**

`pageForOrigin()` must:

1. Parse the target origin.
2. Reuse a non-closed page from `pagesByOrigin`.
3. Otherwise reuse the current blank page if available; if not, call `context.newPage()`.
4. Record newly created pages in `ownedPages`.
5. Navigate only a newly assigned page to `${origin}/` and wait for `domcontentloaded`, then best-effort `load`.
6. Set `this.page` to the selected page and return it.

Do not navigate an existing page from another origin to the new origin.

- [ ] **Step 2: Change request and Sentinel execution to use selected pages**

Use a local `const page = await this.ensureOrigin(...)` in `request()` and `sentinel()`. Replace `this.page.evaluate()` / `this.page.addScriptTag()` calls in those methods with the local page. Keep all existing headers, credentials, timeout, and retry behavior unchanged.

- [ ] **Step 3: Change navigation to use the target-origin page**

In `navigate()`, select the page from `pageForOrigin(payload.url, timeoutMs)`, call `page.goto(payload.url, ...)`, and return the response/page URL as before. If a redirect ends at another origin, update `pagesByOrigin` so later requests use the page that now owns the final origin.

- [ ] **Step 4: Preserve cleanup for all bridge-owned pages**

In `close()`, close every live page in `ownedPages` once, then clear `pagesByOrigin`, `ownedPages`, `this.page`, and `this.context`. Preserve the existing browser disconnect behavior and JSONL response format.

- [ ] **Step 5: Run the focused Node test**

Run:

```powershell
npm test -- test/roxyCdpBridge.test.js
```

Expected: all bridge tests pass, including the new origin-isolation test and the existing transient-fetch retry test.

### Task 3: Add page-closed recovery coverage without changing retry semantics

**Files:**
- Modify: `test/roxyCdpBridge.test.js`
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`

**Interfaces:**
- `ensureConnected()` must discard a closed `this.page` reference and reacquire/create a live page from the existing `context` before reconnecting to Roxy.
- A page-closed request error may retry once only after selecting a live page; it must not refresh Roxy fingerprint or proxy.

- [ ] **Step 1: Write the failing page-closed test**

Make the first fake page report `isClosed() === true`; make the fake context return a second live page. Call `request()` and assert that the second page performs the fetch and no Roxy preparation method is called.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npm test -- test/roxyCdpBridge.test.js
```

Expected: the current bridge retains the closed page reference or reconnects without replacing it.

- [ ] **Step 3: Implement minimal closed-page recovery**

When `ensureConnected()` sees a closed page, set `this.page = null`, reuse the existing live `context` when possible, select/create a live page, and only perform a new CDP connection if the context itself is unavailable. Extend the existing diagnostic classification for `Target page, context or browser has been closed` and retry once after reacquiring the page.

- [ ] **Step 4: Run bridge tests again**

Run:

```powershell
npm test -- test/roxyCdpBridge.test.js
```

Expected: all bridge tests pass.

### Task 4: Add Roxy egress-IP consistency checks

**Files:**
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- Modify: `src/auto/protocol_registration/core/roxy_cdp.py`
- Modify: `src/auto/protocol_registration/core/session.py`
- Modify: `src/auto/protocol_registration/config/roxy.py`
- Modify: `src/auto/protocol_registration/config/__init__.py`
- Test: `src/auto/protocol_registration/tests/test_roxy_bridge.py`

**Interfaces:**
- Add JSONL command `ip` in the Node bridge; it reads the selected profile's `proxyInfo.lastIp` through the Roxy API and returns only the current IP metadata.
- Add `RoxyCdpClient.ip()` returning a dictionary with `ip` or an empty value.
- Add `BrowserSession._ensure_roxy_ip()`; it records the first IP and raises a runtime error if later checks differ.
- Add `ROXY_IP_CHECK_ENABLED`, defaulting to enabled for CDP mode, with an environment override for diagnostics.

- [ ] **Step 1: Write the failing IP-change test**

Use a fake CDP client whose `ip()` returns `203.0.113.10` on the first check and `203.0.113.11` on the next check. Construct `BrowserSession` in CDP mode, call one request to establish the baseline, then call another request and assert it raises an IP-change error before the second request is sent.

- [ ] **Step 2: Run the Python test and verify it fails**

Run:

```powershell
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge
```

Expected: the test fails because the current CDP client has no IP command and `BrowserSession` does not compare egress IPs.

- [ ] **Step 3: Implement the Roxy API IP command**

Add a bridge command that resolves the configured profile through `/browser/list`, finds the selected `dirId` / sort number / window name, and returns `proxyInfo.lastIp`. Do not print proxy username/password or any cookies to stdout/stderr.

- [ ] **Step 4: Thread the IP check through the Python session**

Call `_ensure_roxy_ip()` after the initial fingerprint warmup and before each CDP `get`, `post`, `navigate`, and Sentinel operation. On mismatch, raise a clear error and leave the account state unchanged. Do not call Roxy randomization, close/open, or proxy refresh from this path.

- [ ] **Step 5: Run the Python suite**

Run:

```powershell
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest discover -s tests
```

Expected: 40 tests or more pass, including the IP consistency regression.

### Task 5: Verify protocol integration and real single-account behavior

**Files:**
- Test: `test/roxyCdpBridge.test.js`
- Test: `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- Verify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`

- [ ] **Step 1: Run focused Node and Python suites**

Run:

```powershell
npm test -- test/roxyCdpBridge.test.js test/replacementServices.test.js
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest discover -s tests
F:\anaconda\anaconda3\envs\tilian\python.exe -m compileall -q .
```

Expected: Node focused tests pass; Python reports 39 tests OK; compileall exits 0.

- [ ] **Step 2: Check service health and current account state**

Run:

```powershell
(Invoke-WebRequest -Uri 'http://127.0.0.1:13100/login' -TimeoutSec 10).StatusCode
```

Expected: `200`. Confirm the selected account is still `unregistered` before starting a real run.

- [ ] **Step 3: Run one real protocol registration through the SSE endpoint**

Use the existing local admin login and call:

```text
POST http://127.0.0.1:13100/replacement-accounts/<id>/register-protocol
Accept: text/event-stream
```

Expected evidence:

- `roxy-ready` appears before the child starts.
- First ChatGPT request uses the ChatGPT page.
- Auth navigation and OTP validation use the Auth page.
- Sentinel logs do not cause Auth page navigation.
- A failure leaves the account `unregistered`; a success writes only the access-token value and updates registration state.

- [ ] **Step 4: Update the learning entry after verification**

If the real run confirms the fix, change `ERR-20260718-001` in `.learnings/ERRORS.md` to `resolved` and record that transient page fetch recovery and origin-scoped pages were verified.
