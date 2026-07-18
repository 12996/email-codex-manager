# Errors

## [ERR-20260714-001] powershell-inline-node-quoting

**Logged**: 2026-07-14T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
PowerShell passed an escaped quote inside an inline `node --input-type=module -e` script as an unterminated JavaScript string.

### Error
```text
SyntaxError: Invalid or unexpected token
```

### Context
- Attempted to fetch the authenticated `/replacement-ui` HTML and test several `String.includes()` checks in one inline Node command.
- The nested quote around `name="activation_method"` was transformed by PowerShell before Node evaluated it.

### Suggested Fix
Use a request helper with simpler output, avoid nested JavaScript string quotes in PowerShell, or run the check through a temporary script/test instead of a dense inline command.

### Metadata
- Reproducible: yes
- Related Files: `web/index.html`, `web/app.js`
- See Also: none

### Resolution
- **Resolved**: 2026-07-14T00:00:00+08:00
- **Notes**: The application was unaffected; the verification command was rewritten with safer quoting.

## [ERR-20260714-002] cdp-browser-close-during-inspection

**Logged**: 2026-07-14T23:06:50+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Closing a Playwright browser object connected to the live Roxy CDP endpoint terminated the inspection target.

### Error
```text
browserType.connectOverCDP: connect ECONNREFUSED 127.0.0.1:11520
```

### Context
- The inspection command connected to the Roxy CDP endpoint to read the current page state.
- It called `browser.close()` after inspection; for a CDP-attached browser this closed the live browser instead of only detaching the inspector.

### Suggested Fix
Use `browser.disconnect()` after read-only CDP inspection. Do not call `browser.close()` unless the browser session itself should be terminated.

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_2fa_auth_login.js`
- See Also: none

### Resolution
- **Resolved**: 2026-07-14T23:06:50+08:00
- **Notes**: The code verification does not depend on the closed session; future runtime inspection will detach instead of closing.

## [ERR-20260716-001] sqlite-run-schema-assumption

**Logged**: 2026-07-16T11:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
An ad-hoc SQLite inspection assumed `replacement_automation_runs.kind` existed and failed before reading run 507.

### Error
```text
SqliteError: no such column: kind
```

### Context
- Queried `data/app.db` while diagnosing Roxy automation run 507.
- The repository schema stores the run type in a different shape; the query should inspect `PRAGMA table_info` before selecting fields.

### Suggested Fix
Read the actual table schema first, then query only columns present in the current database.

### Metadata
- Reproducible: yes
- Related Files: `src/db.js`, `src/replacementAutomationRuns.js`, `data/app.db`
- See Also: none

## [ERR-20260716-002] npm-test-verification-service-unavailable

**Logged**: 2026-07-16T11:15:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
Full `npm test` ran 355/356 tests successfully; the standalone verification-code integration script failed because its external localhost service was not running.

### Error
```text
TypeError: fetch failed
ECONNREFUSED 127.0.0.1 / localhost:3100
```

### Context
- The targeted `node --test test/roxyRegisterOpenai.test.js` suite passed 29/29.
- `test/test-verification-code.mjs` is an extra integration script that expects a separate service on port 3100.

### Suggested Fix
Start the verification-code service before running the full npm test command, or exclude/gate this integration script when that service is unavailable.

### Metadata
- Reproducible: yes
- Related Files: `test/test-verification-code.mjs`, `docs/work/2026-07-14-replacement-activation-method.md`
- See Also: none

## [ERR-20260716-003] roxy-playwright-stale-cdp-target

**Logged**: 2026-07-16T11:25:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
The Roxy Playwright MCP connection pointed at the previous browser target after run 508 cleanup and reported the target as closed.

### Error
```text
Target page, context or browser has been closed
```

### Context
- Roxy API still reported the `gpt` browser open with a new CDP endpoint.
- Reconnecting to the endpoint from `roxy_get_connection_info` restored access to the live `/about-you` page.

### Suggested Fix
When a retained Roxy run changes the CDP endpoint, query current connection info and reconnect before inspecting pages.

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_register_openai.js`, RoxyBrowser CDP session
- See Also: ERR-20260714-002

### Resolution
- **Resolved**: 2026-07-16T11:25:00+08:00
- **Notes**: Reconnected to the current endpoint without closing the Roxy browser.

## [ERR-20260716-004] roxy-registration-unconsumed-otp-terminal

**Logged**: 2026-07-16T12:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
The `/about-you` profile terminal state was correctly detected, but the registration flow did not consume the resulting `OTP_ALREADY_COMPLETED` signal from its initial OTP wait.

### Error
```text
Error: OTP_ALREADY_COMPLETED
at waitForOtpInputReady (src/auto/roxy_register_openai.js:1379:19)
```

### Context
- The real account `105` run `510` reached `https://auth.openai.com/about-you`.
- `submitOtpWithRetry()` already handled the sentinel, but the preceding standalone OTP wait in `runRegistrationFlow()` did not.
- The failure happened before any repeated OTP fetch or Age-field input.

### Suggested Fix
Every call site that waits for OTP readiness must either consume the profile/session terminal state or delegate to a wrapper that returns an explicit completed status; do not leave sentinel errors unhandled in the outer state machine.

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_register_openai.js`, `test/roxyRegisterOpenai.test.js`
- See Also: ERR-20260716-003

### Resolution
- **Resolved**: 2026-07-16T12:02:21+08:00
- **Notes**: Added `waitForOtpStageOrCompleted()`, added a regression test, and verified real run `511` completed registration, Session retrieval, and MFA.

## [ERR-20260716-005] replacement-email-api-slow-response

**Logged**: 2026-07-16T17:24:18+08:00
**Priority**: medium
**Status**: pending
**Area**: integration

### Summary
The account email API responds successfully, but slower than the service's 15-second abort timeout.

### Error
```text
邮箱 API 请求失败：The operation was aborted due to timeout
```

### Context
- Account: `piglet.swamps-03@icloud.com`, id `72`, status `registered`.
- The persisted error is from `Plus 状态查询`, not the banned-email healthcheck.
- `replacementEmailApiService.js` uses `DEFAULT_EMAIL_API_TIMEOUT_MS = 15000`.
- A direct single-account probe returned HTTP 200 in about 34.8 seconds; the same API with `limit=1` returned HTTP 200 in about 28.5 seconds. `limit=30` was rejected with HTTP 422.

### Suggested Fix
Use a configurable per-provider timeout with retry/backoff, then add mailbox check cursors or a provider-side incremental endpoint so repeated batch checks do not wait on the same historical mailbox data.

### Metadata
- Reproducible: yes
- Related Files: `src/replacementEmailApiService.js`, `src/replacementPlusStatusService.js`, `src/accountHealthcheckService.js`
- See Also: none

## [ERR-20260716-006] powershell-node-inline-query-escaping

**Logged**: 2026-07-16T18:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
PowerShell passed an unintended backslash into a `node --input-type=module -e` inline query, causing a syntax error before the database probe ran.

### Error
```text
SyntaxError: Invalid or unexpected token
```

### Context
- The failed command used JSON-escaped quotes and backslashes inside a PowerShell command string.
- No project file or database state was changed.

### Suggested Fix
Use a PowerShell-safe inline query or a temporary test entry point when quoting becomes nested; avoid shell-style backslash escaping in PowerShell.

### Metadata
- Reproducible: yes
- Related Files: `data/app.db`
- See Also: none

### Resolution
- **Resolved**: 2026-07-16T18:00:20+08:00
- **Notes**: Replaced the probe with a PowerShell-compatible command before continuing migration verification.

## [ERR-20260717-001] roxy-protocol-profile-stale-process

**Logged**: 2026-07-17T15:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
The first protocol-registration attempt could not start the selected Roxy `3/test` profile because a stale `RoxyChrome` process still belonged to that profile.

### Context
- The protocol action targets the shared Roxy profile used by the protocol flow.
- Only the stale process associated with that profile was cleaned; unrelated Roxy profiles were not touched.
- The profile subsequently opened and the protocol flow reached the OpenAI OTP stage.

### Suggested Fix
Before retrying a protocol registration, query the target profile connection state and clean only that profile's stale browser process. Keep the profile single-flight; do not terminate all Roxy processes.

### Metadata
- Reproducible: intermittently
- Related Files: `src/replacementServices.js`, `src/auto/roxy-browser-client.cjs`, `docs/work/2026-07-17-replacement-protocol-registration.md`
- See Also: `ERR-20260716-003`

### Resolution
- **Resolved**: 2026-07-17T15:35:00+08:00
- **Notes**: Profile-specific cleanup restored the target window; later failures were isolated to the external email API.

## [ERR-20260717-002] replacement-protocol-email-api-timeout

**Logged**: 2026-07-17T15:50:58+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
The protocol registration reached the OTP stage, but the selected account's external email-code API did not respond through either Windows direct networking or the refreshed Roxy page context.

### Error
```text
TimeoutError: 补号邮箱验证码等待超时: 补号服务请求失败: TimeoutError
```

### Context
- Account: `178` (`vessel-sparky7u@icloud.com`), status remains `unregistered`.
- External endpoint is stored in `replacement_accounts.email_code_api`.
- Direct Windows request timed out; Roxy page-context `fetch` aborted after 15 seconds; page navigation also timed out after 30 seconds.
- The implementation correctly preserved the account business status and only wrote `last_error`.

### Suggested Fix
Restore the external mailbox API or configure a reachable per-account `email_code_api`, then rerun the single-account protocol flow. Do not classify this as a Roxy fingerprint or registration-state failure without a successful OTP response.

### Metadata
- Reproducible: yes
- Related Files: `core/replacement_client.py`, `core/roxy_cdp.py`, `scripts/roxy_cdp_bridge.cjs`, `docs/issues/issue-015-replacement-protocol-email-api-unreachable.md`
- See Also: `ERR-20260716-005`

## [ERR-20260717-003] full-node-test-verification

**Logged**: 2026-07-17T00:00:00+08:00
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
全量 Node 测试中已有的 `test/test-verification-code.mjs` 因本地服务未监听而失败，协议实时日志专项测试未失败。

### Error
```text
TypeError: fetch failed
ECONNREFUSED
```

### Context
- Command: `npm test`
- Result: 374 tests, 373 passed, 1 failed。
- Failing test: `test\\test-verification-code.mjs`
- The test attempted to fetch a local verification-code service that was not running.
- Focused live-log tests passed separately.

### Suggested Fix
启动该测试依赖的本地验证码服务后重跑全量测试，或将该外部依赖测试从默认 `node --test` discovery 中隔离。

### Metadata
- Reproducible: yes
- Related Files: `test/test-verification-code.mjs`, `src/server.js`
- See Also: none

## [ERR-20260718-001] roxy-protocol-page-fetch-connection-closed

**Logged**: 2026-07-18T02:08:00+08:00
**Priority**: high
**Status**: in_progress
**Area**: integration

### Summary
Roxy 协议注册在首个 `chatgpt.com` 页面请求处把上游连接临时关闭误报为不可恢复失败。

### Error
```text
page.evaluate: TypeError: Failed to fetch
```

### Context
- Roxy `3/test` profile 的实时页面事件显示：`net::ERR_CONNECTION_CLOSED`。
- 同一页面随后重试 `GET /api/auth/providers` 返回 HTTP 200，排除了 CORS 和注册接口参数错误。
- `roxy_cdp_bridge.cjs` 原本只重试导航导致的 execution context 销毁，不重试页面网络瞬断。

### Suggested Fix
对页面上下文中的可恢复网络错误做一次短延迟重试，并记录脱敏 URL、页面 URL、页面关闭状态和错误摘要。

### Metadata
- Reproducible: intermittently
- Related Files: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`, `test/roxyCdpBridge.test.js`
- See Also: ERR-20260717-001
