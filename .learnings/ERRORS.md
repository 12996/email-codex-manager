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

## [ERR-20260803-003] apply-patch-add-file-prefix

**Logged**: 2026-08-03T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
创建长 Markdown 计划时有一行遗漏 apply_patch 的新增行前缀，导致整份补丁被拒绝。

### Error
```text
apply_patch verification failed: invalid hunk ... is not a valid hunk header
```

### Context
- 目标是新增 `docs/superpowers/plans/` 下的实施计划。
- Markdown 代码块中的 `git commit` 行未以 `+` 开头。

### Suggested Fix
长 Add File 补丁提交前逐行确认每个内容行均带 `+`，或按任务拆分为更小的补丁。

### Metadata
- Reproducible: yes
- Related Files: `docs/superpowers/plans/`

### Resolution
- **Resolved**: 2026-08-03T00:00:00+08:00
- **Notes**: 已改用逐行带新增前缀的补丁重试。

---

## [ERR-20260803-001] parallel-git-review-timeout

**Logged**: 2026-08-03T12:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
并发执行多个 Git 审查命令在当前 Windows 工作区超时，未得到审查结果。

### Error
```text
git diff --check / git diff --stat / git status timed out while launched concurrently
```

### Context
- 工作区包含大量未提交变更。
- 三个 Git 命令被同一个工具调用并发启动；之后没有残留 git 进程或 `.git/index.lock`。

### Suggested Fix
对当前工作区的 Git 审查命令使用 `git --no-optional-locks` 串行执行，并限定到本次修改路径。

### Metadata
- Reproducible: unknown
- Related Files: `.git/`, `src/auto/roxy-browser-client.cjs`

### Resolution
- **Resolved**: 2026-08-03T12:00:00+08:00
- **Notes**: 后续路径限定的串行 `git --no-optional-locks status` 正常返回。

---

## [ERR-20260803-001] invalid-wait-cell

**Logged**: 2026-08-03T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
一次工具调用尝试等待不存在的执行单元，未执行项目命令也未修改项目状态。

### Error
```text
exec cell __invalid__ not found
```

### Context
- `functions.wait` 只能用于前一条运行中 `functions.exec` 返回的 cell ID。
- 后续验证均改为受控的单个 `functions.exec` 命令。

### Suggested Fix
仅在已获得运行中 cell ID 时调用等待工具。

### Metadata
- Reproducible: yes
- Related Files: `test/roxyNo2FaRegister.test.js`
- See Also: ERR-20260730-004

### Resolution
- **Resolved**: 2026-08-03T00:00:00+08:00
- **Notes**: 不影响本次实现或测试结果。

---

## [ERR-20260802-001] incorrect-roxy-bridge-test-path

**Logged**: 2026-08-02T22:53:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
计划基线命令引用了不存在的 `test/roxyCdpBridge.test.js`。

### Error
```text
Could not find 'test/roxyCdpBridge.test.js'
```

### Context
- Roxy CDP bridge 的 Python 回归位于 `src/auto/protocol_registration/tests/`。
- 当前根目录可发现的手动 Roxy 刷新测试是 `test/manualRoxyProxyRefreshRunner.test.js`。

### Suggested Fix
后续计划和验证命令使用实际存在的测试文件，且不将本次新功能绑定到无关的手动 runner 测试。

### Metadata
- Reproducible: yes
- Related Files: `docs/superpowers/plans/2026-08-02-protocol-no-2fa-registration.md`, `test/manualRoxyProxyRefreshRunner.test.js`

---

## [ERR-20260728-004] cdp-asset-regex-escaping

**Logged**: 2026-07-28T01:47:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
An inline Node asset-search command failed because PowerShell consumed the JavaScript regular-expression escaping.

### Error
```text
SyntaxError: Invalid regular expression: missing /
```

### Context
- The command queried the currently served Auth bundle through the Roxy CDP page.
- The required endpoint had already been found with a fixed-string search; no retry is needed for the failed regex query.

### Suggested Fix
Prefer fixed-string extraction or a temporary script file for complex JavaScript regular expressions invoked from PowerShell.

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_register_openai_cdp_network_recorder.cjs`

---

## [ERR-20260728-003] roxy-browser-open-timeout

**Logged**: 2026-07-28T01:40:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
RoxyBrowser `/browser/open` exceeded its 15-second client timeout while restarting the protocol profile for a second manual recording.

### Error
```text
/browser/open 调用失败: timeout of 15000ms exceeded
```

### Context
- The first recording had just stopped and the profile had been closed, cache-cleared, and fingerprint-randomized.
- The timeout may leave the Roxy profile opened asynchronously; query its CDP connection before retrying open.

### Suggested Fix
Poll `/browser/connection_info` for the configured profile before issuing another `/browser/open`, and raise the open timeout only if no connection becomes available.

### Metadata
- Reproducible: unknown
- Related Files: `src/auto/roxy-browser-client.cjs`, `src/auto/roxy_oauth_login.js`

---

## [ERR-20260724-001] powershell-empty-pipeline

**Logged**: 2026-07-24T00:10:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
Listener inspection command piped a completed `foreach` block directly, which PowerShell parsed as an empty pipeline element.

### Suggested Fix
Assign loop output to a variable before formatting it through a pipeline.

### Metadata
- Related Files: `.learnings/ERRORS.md`

### Resolution
- **Resolved**: 2026-07-24T00:10:00+08:00
- **Notes**: Re-ran the probe with `$results = foreach (...) { ... }` and confirmed only port 13400 serves the current frontend.

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

---

## [ERR-20260720-001] cpa-auth-roxy-egress-reset

**Logged**: 2026-07-20T11:25:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
独立 CPA 测试尚未到 `add-phone`，Roxy 出口在 Auth 首次导航阶段重置连接。

### Error
```text
page.goto: net::ERR_CONNECTION_RESET at https://auth.openai.com/oauth/authorize
```

### Context
- Roxy target: window `3/test`，当前 `proxyInfo.lastIp=220.96.77.3`。
- 同一出口连续查询稳定；Roxy 标准 close/clear/random/open 准备后出口未改变。
- 本次运行未提交账号、密码、TOTP 或手机号，因此不能据此判断 SMS API 或 `add-phone` 结果。

### Suggested Fix
等待或切换到可访问 Auth 的 Roxy 出口后，从干净会话重新运行；只有日志确认 `add-phone/send` 已执行后，才开始判断 SMS 轮询。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- See Also: `docs/issues/issue-017-roxy-cpa-auth-egress-reset.md`

---

## [ERR-20260720-002] controlled-roxy-test-selected-wrong-profile

**Logged**: 2026-07-20T12:10:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
直接调用 `roxy_2fa_auth_login.run({ env })` 做临时测试时，传入的 `deps.env` 没有同步到 `RoxyBrowserClient` 读取的 `process.env`，导致测试误选了 Roxy `sortNum=8/gpt`，不能作为 `3/test` 证据。

### Error
```text
期望目标：dirId=4c83715f6713db30c9baf9bfbc5086d3 / sortNum=3 / test
实际解析：dirId=36c806d44959e9aa911b77566e93f7a5 / sortNum=8 / gpt
```

### Context
- 临时测试通过 `twoFa.run([], { env, buildAuthUrl })` 注入账号和 Roxy 配置。
- `roxy_oauth_login.js:1496-1497` 使用 `new Client()`；`roxy-browser-client.cjs` 构造函数直接读取 `process.env`，不读取 `deps.env`。
- 浏览器已被用户关闭；该次错误测试不应作为 `3/test` 的网络结论。

### Suggested Fix
后续只通过真实子进程环境或显式构造 `RoxyBrowserClient` 传入目标配置；运行前记录解析出的 `dirId/sortNum/windowName`，不匹配目标时立即终止，不导航页面。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy_oauth_login.js`, `src/auto/roxy-browser-client.cjs`, `src/auto/roxy_2fa_auth_login.js`
- See Also: ERR-20260720-001

---

## [ERR-20260720-003] full-node-test-local-service-smoke-test

**Logged**: 2026-07-20T14:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
仓库根目录直接运行全量 `npm test` 时，独立集成 smoke test 访问未启动的本地服务并失败。

### Error
```text
TypeError: fetch failed
ECONNREFUSED
test/test-verification-code.mjs
```

### Context
- 运行：`npm test`。
- 391 个 Node 测试中 390 个通过；失败项是 `test/test-verification-code.mjs`，它直接 fetch 本地验证码服务，不是本次 2FA URL 或 worker 改动。

### Suggested Fix
把该文件从默认单元测试集合中隔离，或在运行全量测试前启动其依赖的本地服务；验证 2FA 改动时使用明确的测试文件列表。

### Metadata
- Reproducible: yes
- Related Files: `test/test-verification-code.mjs`
- See Also: none

---

## [ERR-20260720-004] python-tests-wrong-module-root

**Logged**: 2026-07-20T14:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: tests

### Summary
从仓库根目录直接调用 Python unittest，未设置项目测试要求的模块根目录，导致 `core` 和 `protocol_cpa_auth` 导入失败。

### Error
```text
ModuleNotFoundError: No module named 'core'
ModuleNotFoundError: No module named 'protocol_cpa_auth'
```

### Context
- 运行：`python -m unittest discover -s src\\auto\\protocol_registration\\tests ...` 和 `python -m unittest src.auto.test_protocol_cpa_auth`。
- 测试源码使用顶层模块导入，必须从对应 `src\\auto` 项目目录运行，或设置 `PYTHONPATH`。

### Suggested Fix
从 `src\\auto\\protocol_registration` 运行注册协议测试；从 `src\\auto` 运行 CPA 专项测试，或明确设置对应 `PYTHONPATH`。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/tests/`, `src/auto/test_protocol_cpa_auth.py`
- See Also: none

---

## [ERR-20260720-005] python-tests-system-interpreter-missing-project-deps

**Logged**: 2026-07-20T14:00:30+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
系统 Python 缺少协议测试依赖；项目指定的 `tilian` 环境可以正常运行测试。

### Error
```text
ModuleNotFoundError: No module named 'pyotp'
ModuleNotFoundError: No module named 'curl_cffi'
```

### Context
- 在正确工作目录运行系统 Python 后，注册协议测试 39 项中 14 项、CPA 测试 5 项中 1 项因依赖导入失败。
- 使用 `F:\\anaconda\\anaconda3\\envs\\tilian\\python.exe` 重跑后，注册协议 42/42、CPA 5/5 通过。

### Suggested Fix
协议项目测试固定使用 `tilian` Python 环境，不要用系统 Python 代替。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/`, `src/auto/test_protocol_cpa_auth.py`
- See Also: ERR-20260720-004

### Resolution
- **Resolved**: 2026-07-20T14:00:30+08:00
- **Notes**: 使用项目指定的 Anaconda `tilian` 环境完成测试。

---

## [ERR-20260720-006] powershell-inline-node-template-literal

**Logged**: 2026-07-20T16:45:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
PowerShell 展开 inline Node 命令中的反引号模板字符串，导致 JavaScript 语法损坏。

### Error
```text
SyntaxError: Unexpected token '{'
```

### Context
- 使用 `node -e` 递归读取已有 CPA JSON 的 workspace/team 字段。
- PowerShell 先处理了 JavaScript 模板字面量 `${p}.${k}`，Node 实际收到的代码缺少模板字符串内容。

### Suggested Fix
避免在 PowerShell 双引号中嵌入 JavaScript 模板字面量；改用字符串拼接、单引号脚本块或独立临时脚本。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/product_files/cpa/19_immoral.bitmap@icloud.com.json`
- See Also: ERR-20260714-001

### Resolution
- **Resolved**: 2026-07-20T16:45:00+08:00
- **Notes**: 后续改用不含模板字面量的 inline Node 命令。

---

## [ERR-20260720-007] powershell-rg-wildcard-path

**Logged**: 2026-07-20T16:47:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
PowerShell 下把 `rg` 的路径参数 `CHG-088*` 当作 Windows 文件系统通配路径处理，导致命令返回路径语法错误。

### Error
```text
rg: docs/changes/CHG-088*: 文件名、目录名或卷标语法不正确。 (os error 123)
```

### Context
- 在跨目录检索 workspace 解析实现和 change 文档时使用了带通配符的路径参数。

### Suggested Fix
在 Windows 下先使用精确文件名，或让通配符只出现在 `rg` 的 `--glob` 参数中。

### Metadata
- Reproducible: yes
- Related Files: `docs/changes/CHG-088-replacement-protocol-openai-workspace-resolution.md`
- See Also: none

### Resolution
- **Resolved**: 2026-07-20T16:47:00+08:00
- **Notes**: 后续使用精确 change 文件路径检索。

---

## [ERR-20260720-008] powershell-inline-node-cdp-quoting

**Logged**: 2026-07-20T16:50:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
通过 PowerShell 执行 inline Node 的 CDP 检查命令时，括号嵌套错误导致 Node 语法解析失败。

### Error
```text
SyntaxError: missing ) after argument list
```

### Context
- 尝试读取已打开 Roxy profile 的页面 URL 和标题。
- 命令包含多层 `JSON.stringify(...map(...))` 和异步 IIFE，实际括号不匹配。

### Suggested Fix
CDP 诊断命令保持单层循环和简单输出；连接 Roxy 后使用 `browser.disconnect()`，不要调用 `browser.close()`。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy-browser-client.cjs`
- See Also: ERR-20260714-002

### Resolution
- **Resolved**: 2026-07-20T16:50:00+08:00
- **Notes**: 改用简单循环和 CDP detach。

---

## [ERR-20260720-009] playwright-cdp-detach-api

**Logged**: 2026-07-20T16:52:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
当前项目使用的 `playwright-core` CDP Browser 对象没有 `disconnect()` 方法，直接调用会抛出 TypeError。

### Error
```text
TypeError: b.disconnect is not a function
```

### Context
- 已成功连接 Roxy `617-3/test` 并读取页面；失败发生在诊断命令结束时的 detach 调用。
- 命令没有调用 `browser.close()`，因此没有主动关闭 Roxy profile。

### Suggested Fix
只做短命令读取后让 Node 进程自然退出；不要对当前版本对象调用不存在的 `disconnect()`，也不要调用 `browser.close()`。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/roxy-browser-client.cjs`
- See Also: ERR-20260714-002

### Resolution
- **Resolved**: 2026-07-20T16:52:00+08:00
- **Notes**: 后续不调用不存在的 detach 方法。

---

## [ERR-20260720-010] roxy-cdp-auth-probe-timeout

**Logged**: 2026-07-20T16:55:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
通过 Roxy `617-3/test` 新建页面访问 Auth 并验证 workspace/select 时，导航或页面请求在 60 秒内未完成。

### Error
```text
command timed out after 64037 milliseconds
```

### Context
- Roxy profile 已通过 API 打开并取得 CDP endpoint。
- 直接 Node 请求 Auth 被出口返回 `unsupported_country_region_territory`；Roxy CDP 页面探测未能在超时内完成。
- 未对账号 109 再次发送手机号或验证码。

### Suggested Fix
不要依赖当前出口做在线 workspace 探测；优先使用已保存 Auth 会话/Token 中的非敏感组织元数据，或等待用户提供/确认真实 OpenAI workspace ID。

### Metadata
- Reproducible: unknown
- Related Files: `src/auto/product_files/cpa/19_immoral.bitmap@icloud.com.json`, `.env`
- See Also: `docs/issues/issue-016-replacement-protocol-workspace-id-collision.md`

---

## [ERR-20260720-011] cpa-consent-data-array-shape

**Logged**: 2026-07-20T17:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: integration

### Summary
协议 CPA 补号在 `consent.data` 返回数组时被错误判定为 JSON 响应异常。

### Error
```text
CpaAuthProtocolError: non-object JSON from https://auth.openai.com/sign-in-with-chatgpt/codex/consent.data
```

### Context
- 账号 `108` 的运行已通过登录、TOTP 和手机号验证阶段。
- `response_json()` 强制要求 `dict`，但 `extract_consent_challenge()` 已有 `list` 分支。
- 同次日志来自重启前旧 13100 进程，协议补号也没有执行新的 Roxy 刷新步骤。

### Suggested Fix
只对需要对象字段的接口保留对象校验；`consent.data` 使用允许 `dict/list` 的解析入口，并在子进程启动前完成 Roxy profile 刷新。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/test_protocol_cpa_auth.py`, `src/replacementServices.js`
- See Also: `docs/work/2026-07-20-protocol-replacement-operation.md`

### Resolution
- **Resolved**: 2026-07-20T17:30:00+08:00
- **Notes**: 已增加数组响应回归测试；CPA 5/5、replacement services 37/37 通过并重启 13100。

---

## [ERR-20260720-012] cpa-workspace-cross-account-401

**Logged**: 2026-07-20T17:46:00+08:00
**Priority**: high
**Status**: resolved
**Area**: integration

### Summary
协议补号把账号 109 的 OpenAI organization workspace 用到了账号 111。

### Error
```text
CpaAuthProtocolError: workspace/select returned HTTP 401
```

### Context
- Run 590 / 账号 111 已经完成登录、TOTP、手机号和 consent.data，且 Roxy CDP 已正确注入。
- 账号 111 的历史 token 是 free personal account；真实录制的 workspace/select body 使用账号 UUID，而不是账号 109 的 org workspace。
- 原独立 CPA 请求还缺少录制中出现的 x-access-flow-invocation-id。

### Suggested Fix
在当前 Auth session 中读取脱敏 workspace 列表，显式值只有属于当前会话时才使用；否则优先 personal workspace，并补齐 workspace/select 的 invocation header。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/protocol_registration/core/session.py`, `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- See Also: `docs/issues/issue-016-replacement-protocol-workspace-id-collision.md`

### Resolution
- **Resolved**: 2026-07-20T17:46:00+08:00
- **Notes**: 已接入 auth_workspaces 动态解析和 invocation header；CPA 6/6、Roxy CDP Node 10/10、Roxy bridge Python 23/23 通过。

---

## [ERR-20260721-001] remote-proxy-change-probe

**Logged**: 2026-07-21T15:05:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
VPS 只读探针首次查询 Docker 无权限，后续验证命令发生 PowerShell/SSH 引号展开，导致一次进程环境探针误读。

### Error
```text
permission denied while trying to connect to the Docker API at unix:///var/run/docker.sock
The term 'systemctl' is not recognized as a name of a cmdlet
```

### Context
- SSH 用户 `seal` 无 Docker socket 权限，但 systemd 和目标服务可通过 `sudo -n` 查询/管理。
- PowerShell 双引号会先展开远程命令中的 `$(...)`；进程环境验证改用 PowerShell 单引号包裹 SSH 命令后通过。

### Suggested Fix
远程只读探针优先使用 systemd、`ss` 和 `sudo`；包含 `$()` 的 SSH 命令使用 PowerShell 单引号，避免本地展开。

### Metadata
- Reproducible: yes
- Related Files: `docs/work/2026-07-21-cpa-host-direct-egress.md`

### Resolution
- **Resolved**: 2026-07-21T15:10:00+08:00
- **Notes**: 已完成 CPA 宿主机直连切换并用 systemd 环境、进程环境、服务状态和直连出口 IP 复核。

---

## [ERR-20260721-002] cpa-config-proxy-remained

**Logged**: 2026-07-21T15:23:00+08:00
**Priority**: high
**Status**: resolved
**Area**: infra

### Summary
只移除 CLIProxyAPI 的 systemd 代理环境不足以切换到宿主机直连，应用配置仍保留顶层 `proxy-url: http://127.0.0.1:7891`。

### Error
```text
proxy-url: http://127.0.0.1:7891
```

### Context
- CPA 进程和接口正常，但 `/opt/cliproxyapi/config.yaml` 的应用级代理配置优先于环境变量切换。
- 配置改为空值并重启后，CPA 新 PID 加载 `proxy-url: ""`，接口 `/` 返回 200，宿主机直连出口 IP 为 `5.253.38.136`。

### Suggested Fix
切换 CPA 出口时同时检查 systemd 环境变量和应用自身配置；两者都必须明确不含旧代理地址。

### Metadata
- Reproducible: yes
- Related Files: `docs/work/2026-07-21-cpa-host-direct-egress.md`, `/opt/cliproxyapi/config.yaml`

### Resolution
- **Resolved**: 2026-07-21T15:23:00+08:00
- **Notes**: 已备份并将顶层 `proxy-url` 设为空，重启 CPA 后完成 API、进程环境和直连出口复核。
## [ERR-20260728-001] diagnosis-query-schema-assumption

**Logged**: 2026-07-28T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
诊断查询错误假设了协议注册目录和 replacement_accounts 的配置/字段位置。

### Error
```text
Cannot find path 'src\\auto\\protocol_registration\\config.py'
SqliteError: no such column: registered_at
```

### Context
- 配置拆分在 `config/` 包，账号表使用 `activated_at` 而非 `registered_at`。
- 先通过 `rg --files` 和 `PRAGMA table_info` 确认真实路径和 schema 后完成查询。

### Suggested Fix
后续诊断前先枚举目标目录并读取 SQLite 表结构，不根据旧模块布局或字段名推断。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/config/`, `data/app.db`

### Resolution
- **Resolved**: 2026-07-28T00:00:00+08:00
- **Notes**: 已通过实际配置包和表结构完成证据采集。

---

## [ERR-20260728-002] verification-command-workdir

**Logged**: 2026-07-28T01:14:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
在 Python 协议目录执行 Node 测试，导致 npm 找不到根目录的 test script。

### Error
```text
npm error Missing script: "test"
```

### Context
- `package.json` 位于仓库根目录；Python `unittest` 位于 `src/auto/protocol_registration/`。
- Node bridge 测试改为在仓库根目录运行后通过。

### Suggested Fix
按测试框架选择工作目录：Node 测试从仓库根目录执行，Python 协议测试从协议目录执行。

### Metadata
- Reproducible: yes
- Related Files: `package.json`, `src/auto/protocol_registration/tests/`

### Resolution
- **Resolved**: 2026-07-28T01:14:00+08:00
- **Notes**: 已分别在正确工作目录运行专项测试。

---

## [ERR-20260730-001] protocol-registration-readme-assumption

**Logged**: 2026-07-30T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: docs

### Summary
检查协议注册运行说明时假定模块目录存在 README.md，导致读取命令失败。

### Error
```text
Cannot find path 'src\\auto\\protocol_registration\\README.md' because it does not exist.
```

### Context
- 当前模块没有独立 README；运行状态以 `docs/work/handoff.md` 和实际 `main.py` 为准。

### Suggested Fix
读取模块说明前先用 `rg --files src/auto/protocol_registration` 确认文档入口。

### Metadata
- Reproducible: yes
- Related Files: `docs/work/handoff.md`, `src/auto/protocol_registration/main.py`

### Resolution
- **Resolved**: 2026-07-30T00:00:00+08:00
- **Notes**: 已改为依据交接记录和当前提交代码判断可执行条件。

---

## [ERR-20260730-002] roxy-cdp-passive-inspection-timeout

**Logged**: 2026-07-30T00:00:00+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
已确认 Roxy CDP endpoint 可用，但附着后读取现有页面状态超时。

### Error
```text
command timed out after 19033 milliseconds
```

### Context
- `GET /browser/connection_info` 返回 code=0，目标 dirId 有本地 CDP endpoint。
- Playwright `connectOverCDP` 后读取页面标题、body 和控件元数据未在 19 秒内完成；未执行导航、点击或写操作。

### Suggested Fix
后续若需继续取证，先把连接、页面枚举和单页 DOM 读取分成独立且短超时的步骤，定位具体阻塞点。

### Metadata
- Reproducible: unknown
- Related Files: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`

---

## [ERR-20260730-003] protocol-test-interpreter-mismatch

**Logged**: 2026-07-30T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
系统 Python 缺少协议注册测试依赖 `pyotp`，不能用于该模块的回归测试。

### Error
```text
ModuleNotFoundError: No module named 'pyotp'
```

### Context
- 直接执行 `python -m unittest` 调用了系统解释器。
- 协议注册服务日志指定 `F:\\anaconda\\anaconda3\\envs\\tilian\\python.exe`，该环境才包含运行依赖。

### Suggested Fix
协议注册 Python 测试和编译均显式使用 `tilian` 环境解释器。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/tests/`

### Resolution
- **Resolved**: 2026-07-30T00:00:00+08:00
- **Notes**: 已切换至服务实际使用的 `tilian` Python 环境。

---

## [ERR-20260730-004] invalid-parallel-tool-dispatch

**Logged**: 2026-07-30T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
尝试用等待工具并行执行独立验证，传入了不存在的执行单元 ID。

### Error
```text
cell invalid not found
```

### Context
- `functions.wait` 只能继续已由 `functions.exec` 返回的运行中 cell。
- 该调用未执行任何项目命令，也未改变项目状态。

### Suggested Fix
独立 shell 验证应在单个 `functions.exec` 内顺序执行，或先创建真实的运行中 cell 再等待。

### Metadata
- Reproducible: yes
- Related Files: `src/auto/protocol_registration/tests/`

### Resolution
- **Resolved**: 2026-07-30T00:00:00+08:00
- **Notes**: 后续验证改为单个受控命令执行。

---

## [ERR-20260730-005] powershell-wildcard-file-read

**Logged**: 2026-07-30T00:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
PowerShell `Get-Content` 未展开日志路径通配符，且后续命令试图读取空路径。

### Error
```text
An object at the specified path ... does not exist
Cannot bind argument to parameter 'Path' because it is null.
```

### Context
- 运行日志文件名的毫秒部分与假设值不一致。
- 改用按修改时间列出文件，再读取实际存在的日志。

### Suggested Fix
日志诊断先以 `Get-ChildItem -Filter` 定位真实文件，再将明确路径交给 `Get-Content`。

### Metadata
- Reproducible: yes
- Related Files: `data/automation-logs/`

### Resolution
- **Resolved**: 2026-07-30T00:00:00+08:00
- **Notes**: 已读取实际运行日志 `protocol-registration-209-2026-07-30T09-17-16-870Z.log`。

---
