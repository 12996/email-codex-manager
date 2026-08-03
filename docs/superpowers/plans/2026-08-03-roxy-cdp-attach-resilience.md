# Roxy CDP Attach Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Roxy CDP attachment bounded and recoverable when a profile is starting or an endpoint becomes stale.

**Architecture:** Keep all CDP readiness logic in `RoxyBrowserClient`. Callers use one high-level `connectReadyPlaywright()` method that obtains fresh connection info before every bounded Playwright attach attempt. The no-2FA runner consumes that method and never receives an endpoint in its public result.

**Tech Stack:** Node.js 22, `node:test`, `playwright-core@1.60.0`, Roxy local API.

## Global Constraints

- Default connection-info poll: 12 attempts, 500ms interval.
- Default Playwright attach timeout: 10,000ms; default attach retries: 3, 750ms interval.
- Do not log or serialize CDP endpoints, cookies, OTPs, access tokens, proxy usernames, or proxy passwords.
- Connection failure must stop before any registration page action.
- Preserve existing Roxy browser lifecycle and do not upgrade dependencies.

---

### Task 1: Add client-level red tests

**Files:**
- Create: `test/roxyBrowserClient.test.cjs`
- Modify: `src/auto/roxy-browser-client.cjs:377-402`

**Interfaces:**
- Consumes: `RoxyBrowserClient` with injectable `request` and `playwright` dependencies.
- Produces: tests for `waitForConnectionInfo(options)`, `connectPlaywright(endpoint, options)`, and `connectReadyPlaywright(options)`.

- [x] **Step 1: Write the failing tests**

```js
test('waitForConnectionInfo polls an empty Roxy response until a websocket exists', async () => {
  let calls = 0;
  const client = createClient({ request: async () => {
    calls += 1;
    return calls === 1 ? { code: 0, data: [] } : { code: 0, data: [{ dirId: 'dir-1', ws: 'ws://fresh' }] };
  }});
  const info = await client.waitForConnectionInfo({ attempts: 2, intervalMs: 0 });
  assert.equal(info.ws, 'ws://fresh');
  assert.equal(calls, 2);
});
```

- [x] **Step 2: Run the tests to verify red**

Run: `node --test test/roxyBrowserClient.test.cjs`

Expected: FAIL because `waitForConnectionInfo` and `connectReadyPlaywright` do not exist.

- [x] **Step 3: Implement the minimal client methods**

```js
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function publicCdpError(code, attempts) {
  const error = new Error(`Roxy CDP connection failed after ${attempts} attempt(s)`);
  error.code = code;
  return error;
}

async waitForConnectionInfo({ attempts = 12, intervalMs = 500 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await this.getConnectionInfo(); } catch (error) {
      if (attempt === attempts) throw publicCdpError('ROXY_CDP_CONNECTION_INFO_TIMEOUT', attempt);
      await delay(intervalMs);
    }
  }
}

async connectPlaywright(cdpEndpoint, { timeoutMs = 10_000 } = {}) {
  const browser = await playwright.chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs });
  try { return await resolveFirstContextAndPage(browser); } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

async connectReadyPlaywright({ connectionInfoAttempts = 12, connectAttempts = 3, retryDelayMs = 750 } = {}) {
  for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
    const { ws } = await this.waitForConnectionInfo({ attempts: connectionInfoAttempts });
    try { return await this.connectPlaywright(ws); } catch (error) {
      if (attempt === connectAttempts) throw publicCdpError('ROXY_CDP_ATTACH_FAILED', attempt);
      await delay(retryDelayMs);
    }
  }
}
```

Attach `error.code = 'ROXY_CDP_CONNECTION_INFO_TIMEOUT'` or
`error.code = 'ROXY_CDP_ATTACH_FAILED'` on exhausted paths; ensure the public message does not include the endpoint.

- [x] **Step 4: Run the client tests to verify green**

Run: `node --test test/roxyBrowserClient.test.cjs`

Expected: PASS.

### Task 2: Route all browser openings through the resilient client entrypoint

**Files:**
- Modify: `src/auto/roxy-browser-client.cjs:437-449`
- Modify: `src/auto/roxy_no_2fa_register.js:353-354`
- Modify: `test/roxyNo2FaRegister.test.js:204-290`

**Interfaces:**
- Consumes: `RoxyBrowserClient.connectReadyPlaywright(options)` from Task 1.
- Produces: Roxy launch and no-2FA browser preparation paths that cannot reuse a stale endpoint between attempts.

- [x] **Step 1: Write the failing runner tests**

```js
test('Roxy browser connection uses the ready connection entrypoint', async () => {
  const calls = [];
  const session = await openPreparedRoxyBrowser({ deps: {
    async buildLiveDependencies() {
      return { client: { async connectReadyPlaywright() { calls.push('ready-connect'); return fakeConnected; } }, close() {} };
    },
    async prepareRoxyNo2FA() {},
  }});
  assert.equal(session.page, fakeConnected.page);
  assert.deepEqual(calls, ['ready-connect']);
});
```

- [x] **Step 2: Run the runner test to verify red**

Run: `node --test test/roxyNo2FaRegister.test.js`

Expected: FAIL because the runner still calls `getConnectionInfo()` plus `connectPlaywright()` directly.

- [x] **Step 3: Implement the minimal call-site changes**

```js
const connected = await live.client.connectReadyPlaywright();
```

In `launchAndConnect()`, retain the open response only as a fallback and delegate to `connectReadyPlaywright()` so retries first ask Roxy for a fresh connection-info record.

- [x] **Step 4: Run focused tests to verify green**

Run: `node --test test/roxyBrowserClient.test.cjs test/roxyNo2FaRegister.test.js`

Expected: PASS.

### Task 3: Record the operational contract and verify live attachment

**Files:**
- Modify: `docs/changes/CHG-104-roxy-no2fa-browser-registration.md`
- Modify: `docs/project/deployment.md`
- Modify: `docs/work/2026-08-03-roxy-no2fa-browser-registration.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`
- Create: `docs/issues/issue-022-roxy-cdp-attach-readiness.md`

**Interfaces:**
- Consumes: bounded client behavior from Tasks 1 and 2 and manual probe `test/manual-roxy-cdp-attach-probe.cjs`.
- Produces: documented timeout/retry boundary and an issue record that distinguishes no active CDP from a Playwright compatibility failure.

- [x] **Step 1: Update records with observed evidence and operational controls**

Document the empty `connection_info` precondition, the successful current attach evidence, bounded retry defaults, and the fact that the probe is read-only and does not expose sensitive values.

- [x] **Step 2: Run static and focused regression checks**

Run: `node --check src/auto/roxy-browser-client.cjs`

Run: `node --check src/auto/roxy_no_2fa_register.js`

Run: `node --test test/roxyBrowserClient.test.cjs test/roxyNo2FaRegister.test.js test/prepareRoxyNo2FA.test.js`

Run: `git diff --check`

Expected: all commands exit 0.

- [x] **Step 3: Run the live read-only probe once**

Run: `node test/manual-roxy-cdp-attach-probe.cjs`

Expected: raw CDP checks and `playwright.ok` are true; no registration navigation or credential output occurs.
