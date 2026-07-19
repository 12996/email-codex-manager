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
**Status**: resolved
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

### Resolution
- **Resolved**: 2026-07-18T12:27:53+08:00
- **Notes**: bridge 已加入页面瞬断重试、按 origin 隔离 ChatGPT/Auth/Sentinel 页面、页面关闭恢复，以及按 Roxy `proxyInfo.lastIp` 的会话内出口 IP 一致性检查。真实账号 175 流程中出现一次 `Failed to fetch` 后自动恢复并取得 access token；账号状态为 `registered`，token 文件保持纯 token 文本。

## [ERR-20260718-002] protocol-2fa-reauth-401

**Logged**: 2026-07-18T16:48:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
协议注册完成后的 2FA 重认证验证码提交返回 HTTP 401。

### Error
```text
Roxy 页面请求失败: HTTP 401 https://auth.openai.com/api/accounts/email-otp/validate
```

### Context
- 401 来自 OpenAI Auth，不是本地 `gmail_IMAP` 服务；本地状态回写随后仍成功。
- CDP 模式下 2FA 的 `_follow_reauth()` 与 `_exchange_new_token()` 使用了页面 `fetch`，没有执行真实页面导航，导致新的 Auth/OAuth state 未建立到对应页面。

### Resolution
- **Resolved**: 2026-07-18T16:48:00+08:00
- **Notes**: CDP 模式改为使用 `session.navigate()`；本地 `127.0.0.1:13100` 验证码读取和数据库状态回写继续直连，不经过 Roxy。新增 2FA 导航回归测试并通过。

### Metadata
- Reproducible: intermittently
- Related Files: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`, `test/roxyCdpBridge.test.js`
- See Also: ERR-20260717-001

---

## [ERR-20260718-003] protocol-registration-no-fresh-email-otp

**Logged**: 2026-07-18T18:15:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
协议注册已到邮箱验证码阶段，但当前补号邮箱接口没有返回本次请求之后的新验证码。

### Error
```text
TimeoutError: 补号邮箱验证码等待超时: 本地验证码接口未返回新的有效验证码
TimeoutError: 补号邮箱验证码等待超时: 账号邮箱验证码接口未返回有效验证码
```

### Context
- 单账号真实测试：补号账号 `169` 使用本地 iCloud 验证码接口；响应只有历史时间戳，按 freshness 规则被拒绝。
- 单账号真实测试：补号账号 `166` 使用账号级 `email_code_api`；TCP 端口可达，但等待窗口内没有返回可接受的新验证码。
- 两次测试均保持业务状态为 `unregistered`，只记录 `last_error`，没有写入 access token 或 2FA。

### Suggested Fix
恢复对应邮箱验证码供应方或为账号配置可达、能返回新邮件时间戳的 `email_code_api`；不要放宽 freshness 检查，否则会把旧验证码提交到 OpenAI。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/core/replacement_client.py`, `src/auto/protocol_registration/core/email_provider.py`
- See Also: ERR-20260717-002

## [ERR-20260718-004] protocol-registration-invalid-auth-step

**Logged**: 2026-07-18T19:12:21+08:00
**Priority**: high
**Status**: in_progress
**Area**: integration

### Summary
协议注册在提交 `user/register` 时先后出现 `invalid_auth_step` 和 `invalid_state`，说明密码页阶段的授权状态转换仍未被协议正确复用。

### Error
```text
HTTP 400 https://auth.openai.com/api/accounts/user/register
code=invalid_auth_step
message=Invalid authorization step.

HTTP 409 https://auth.openai.com/api/accounts/user/register
code=invalid_state
message=Your sign-in session is no longer valid. Please start over to continue.
```

### Context
- Account: `175`，失败前状态为 `unregistered`，数据库密码已注入（仅确认长度，不记录明文）。
- `GET /create-account/password` 通过 `page.evaluate(fetch)` 取得响应，但 Roxy 当前文档 URL/授权页面状态没有进入 password step。
- 改为直接 `session.navigate()` 后 URL 虽进入 `/create-account/password`，但提交注册返回 `invalid_state`；裸页面导航没有复用 email-verification 页的有状态转换。
- 首个 `chatgpt.com/api/auth/providers` 的 `Failed to fetch` 已被现有 bridge 重试逻辑处理，不是本次最终失败原因。

### Suggested Fix
先从自动化实际点击/导航行为中确定 email-verification 到 password 的有状态转换（或其准确的内部 continuation 请求），再实现协议复用；在此之前不要对已注册或状态不一致的账号重跑真实流程。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/core/openai_auth.py`, `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- See Also: `ERR-20260718-001`, `ERR-20260718-002`
