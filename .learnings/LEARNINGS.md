## [LRN-20260707-001] correction

**Logged**: 2026-07-07T00:00:00+08:00
**Priority**: high
**Status**: promoted
**Area**: backend

### Summary
浏览器自动化状态机不能把通用点击结果或过渡态 DOM 当作阶段成功。

### Details
Roxy OpenAI 注册流程中，OTP 提交后曾把通用 Continue 点击函数返回的 `formGone` 误判为验证码成功；实际上 OTP 页本来没有 `input[type="email"]`，页面仍停留在 `email-verification` 并延迟显示 `Incorrect code`。随后又把 OpenAI 过渡期间残留的 disabled/detached password input 当作可填写密码页，导致 `locator.click` 超时。正确做法是：提交后按阶段专用状态机重新分类页面；操作输入框前同时验证元素可见、可用、语义匹配当前阶段。

### Suggested Action
在浏览器自动化流程中新增或修改状态判定时，必须采集当前浏览器状态并写回归测试；输入元素必须检查 `locator.isEnabled()` 和 disabled/inert/readOnly/stale 条件；提交后必须等待明确的成功、错误、当前页停留或超时状态。

### Metadata
- Source: user_feedback
- Related Files: AGENTS.md, src/auto/roxy_register_openai.js, test/roxyRegisterOpenai.test.js
- Tags: browser-automation, state-machine, otp, playwright
- Pattern-Key: browser_automation.state_after_submit
- Recurrence-Count: 1
- First-Seen: 2026-07-07
- Last-Seen: 2026-07-07
- Promoted: AGENTS.md

---

## [LRN-20260803-002] correction

**Logged**: 2026-08-03T13:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: integration

### Summary
about-you 页面填写和按钮点击不能证明 `create_account` 契约正确，必须验证实际请求和响应。

### Details
用户指出 AT 缺失可能源于 about-you 未正确处理。历史成功录制表明提交请求必须含 `name`、`birthdate`，并返回
`page.type=external_url`；旧 browser runner 只填 `input[name="age"]` 并接受 click/formGone。该判断无法证明
当前页面组件把年龄正确转换为 `birthdate`。

### Suggested Action
资料页提交前预设 response watcher，确认 `create_account` 的 2xx 状态、无敏感值的字段名集合和
`external_url` 页面类型；失败时停止，不继续 callback/session。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/roxy_no_2fa_register.js`, `src/auto/roxy_register_openai.js`, `test/roxyNo2FaRegister.test.js`
- Tags: roxy, no2fa, about-you, state-machine, response-validation

### Resolution
- **Resolved**: 2026-08-03T13:05:00+08:00
- **Notes**: 已以 `create_account` response guard 和回归测试实现。

---

## [LRN-20260803-001] correction

**Logged**: 2026-08-03T12:24:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
手动完成的浏览器注册不能表述为无 2FA runner 已完成自动化验收。

### Details
本次实机流程由用户完成邮箱 OTP 和资料页，随后仅验证了当前 ChatGPT session 的 AT 落盘及补号状态回写。虽然 `roxy_no_2fa_register.js` 已实现并通过单元测试，但尚未用新的 `unregistered` 账号跑完它的端到端自动流程。对用户报告时必须明确区分“手动流程成功”和“自动 runner 已验收”。

### Suggested Action
先以真实录制确认组件选择和状态机，再使用新的 `unregistered` 账号进行一次完整自动验收；只有 runner 自己完成 Roxy 准备、OTP、资料页、session AT 保存和状态回写后，才能报告自动化成功。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/roxy_no_2fa_register.js`, `test/manual-roxy-proxy-refresh.cjs`, `docs/changes/CHG-104-roxy-no2fa-browser-registration.md`
- Tags: roxy, no2fa, automation, validation-boundary

---

## [LRN-20260719-001] correction

**Logged**: 2026-07-19T23:15:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
手机号提交后的页面跳转存在延迟，固定短超时不能作为添加手机号失败的依据。

### Details
2FA 补号脚本日志在 `add-phone` 页面等待超时，但当前 Roxy 页面随后已经进入 `phone-verification`，说明手机号发送实际完成。失败判断必须区分“请求失败”和“状态转换尚未在等待窗口内完成”。

### Suggested Action
将手机号阶段改为条件等待：持续检查 `phone-verification`、错误提示和网络响应，避免仅用一次固定短超时判定失败；保留实际页面状态和接口状态作为证据。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/roxy_oauth_login.js`, `src/auto/roxy_2fa_auth_login.js`
- Tags: 2fa, phone-verification, condition-waiting

---

## [LRN-20260715-001] best_practice

**Logged**: 2026-07-15T01:15:00+08:00
**Priority**: medium
**Status**: pending
**Area**: backend

### Summary
对带 query 的账号级 API 做日志脱敏时，必须同时展示目标账号映射，并单独验证实际请求 URL。

### Details
补号状态检查实际使用数据库 `replacement_accounts.email_code_api` 的完整 URL，但进度日志为了隐藏 query/hash 只显示了接口基址，容易被误认为请求使用了共享邮箱。日志展示和网络请求是两个不同证据，不能只根据展示文本判断数据源。

### Suggested Action
账号级外部 API 的进度日志保留脱敏策略，同时显示当前账号邮箱；排查时使用注入的 `fetch` 或网络记录确认最终请求 URL，并在回归测试中锁定账号与请求参数映射。

### Metadata
- Source: user_feedback
- Related Files: `src/replacementEmailApiService.js`, `src/accountHealthcheckService.js`, `src/replacementPlusStatusService.js`
- Tags: observability, email-code-api, account-isolation
- See Also: CHG-080

---

## [LRN-20260717-001] correction

**Logged**: 2026-07-17T00:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
协议注册同一账号的失败重试必须复用首次准备好的 Roxy 指纹和 IP，不应每次重试重新刷新环境。

### Details
批量协议注册按选中账号串行执行时，账号切换才刷新 Roxy profile、指纹和出口 IP；同一账号的失败重试应保持同一浏览器上下文/代理环境，只重新启动注册子流程。此前方案把每次完整调用都视为重新准备 Roxy，需要修正为“账号级准备一次、尝试级复用”。

### Suggested Action
将 Roxy 准备与协议子进程执行拆开：每个账号开始时执行一次 close/clear/random/open/CDP，最多三次尝试共享同一个 CDP endpoint；最终失败后再为下一个账号重新准备 Roxy。对 create_account 已成功后的失败仍需避免重复创建。

### Metadata
- Source: user_feedback
- Related Files: `src/replacementServices.js`, `src/server.js`, `web/app.js`
- Tags: protocol-registration, retry, roxy, fingerprint, proxy, batch
- Pattern-Key: protocol_registration.retry_reuses_roxy_context
- Recurrence-Count: 1
- First-Seen: 2026-07-17
- Last-Seen: 2026-07-17

---

## [LRN-20260718-002] best_practice

**Logged**: 2026-07-18T18:15:00+08:00
**Priority**: high
**Status**: pending
**Area**: backend

### Summary
协议注册父服务必须在写入 `registered` 前验证子进程确实返回已激活的 MFA secret。

### Details
旧子进程曾在 2FA 失败后以退出码 0 返回 `registrationMfa=null`，父服务仍把账号标记为 `registered`，形成“已注册但没有 2FA”的假成功。仅依赖子进程退出码不够，父服务需要校验结构化结果并在缺少 MFA 时保留原业务状态。

### Suggested Action
协议注册成功路径先提取并校验 `registrationMfa.secret`，再调用 `markRegistrationSuccess`；同时在实时日志中明确提示 2FA 已写回数据库，但不要输出 secret。

### Metadata
- Source: error
- Related Files: `src/server.js`, `test/replacementAccountsApi.test.js`
- Tags: protocol-registration, mfa, persistence, defense-in-depth
- See Also: ERR-20260718-002
- Pattern-Key: protocol_registration.require_activated_mfa_before_registered
- Recurrence-Count: 1
- First-Seen: 2026-07-18
- Last-Seen: 2026-07-18

---

## [LRN-20260718-003] correction

**Logged**: 2026-07-18T19:38:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
协议注册问题应优先使用协议层和日志证据诊断，不应在用户指定账号可能已注册时切换到完整 UI 自动化流程。

### Details
本次为确认 email-verification 到 password 的状态转换，误启动了现有 UI 自动化诊断。诊断只提交了邮箱入口，没有执行密码、OTP、create_account、2FA 或数据库回写；以后应先选择明确的未注册测试账号，或仅使用可控的协议/桥接单元测试。

### Suggested Action
真实账号端到端测试前先读取并锁定数据库状态；状态为 `registered` 或状态字段与 2FA 不一致时停止，不再触发邮箱提交和页面导航。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_registration/core/openai_auth.py`, `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- Tags: protocol-registration, automation-scope, account-state

---

## [LRN-20260720-004] correction

**Logged**: 2026-07-20T11:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
Roxy 2FA OAuth 流程的目标页是代码生成的完整 Codex OAuth authorize URL，不能用 ChatGPT 官网或 Auth 根页替代。

### Details
`src/auto/oauth_login.js:916-919` 生成完整 `https://auth.openai.com/oauth/authorize?...` 链接；`src/auto/roxy_oauth_login.js:2283-2288` 也把完整 target URL 传给 `page.goto`。`https://auth.openai.com/` 根页不是这条流程的目标页。

### Suggested Action
真实验证时只使用代码生成的完整 authorize URL，并在导航完成后记录 URL、标题和阶段；不要用官网首页或 Auth 根页作为替代入口。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/oauth_login.js`, `src/auto/roxy_oauth_login.js`, `src/auto/roxy_2fa_auth_login.js`
- Tags: roxy, codex-oauth, authorize-url, page-state

---

## [LRN-20260720-005] correction

**Logged**: 2026-07-20T11:25:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
手机验证码只能在成功执行 `add-phone/send` 后判断，不能用发送前的 SMS API 查询作为阻塞证据。

### Details
账号 109 的一次复测在 Auth 首页就因 Roxy 出口 `ERR_CONNECTION_RESET` 终止，实际上没有到达 `add-phone`。此时查询 SMS API 只证明当前没有可读短信，不能证明 OpenAI 没有发送验证码。正确证据链必须记录 `MFA verify -> add-phone/send -> SMS polling -> phone-otp/validate`；此前另一轮完整运行已到达 `add-phone/send`，该轮才有资格判断后续短信轮询结果。

### Suggested Action
真实 CPA 测试中按阶段记录并验证 `add-phone/send` 的状态后再开始 SMS 轮询；Auth 入口失败时只记录 Auth/Roxy 阻塞，不更新 SMS 结论。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_auth.py`, `docs/work/2026-07-20-standalone-cpa-auth-test.md`
- Tags: cpa-auth, add-phone, sms, evidence-order

---

## [LRN-20260720-006] correction

**Logged**: 2026-07-20T11:35:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
`add-phone/send` 的 4xx 可能表示手机号已经添加，属于可继续的正常分支，不应当作补号流程失败。

### Details
OpenAI 手机只能添加一次；重复调用 `add-phone/send` 可能返回 400/其他 4xx，但后续仍应继续读取并提交手机验证码。独立 CPA 协议的真实阶段顺序是 `MFA verify -> add-phone/send -> SMS polling -> phone-otp/validate`，不能因 4xx 跳过后续 OTP，也不能因发送前无短信就下结论。

### Suggested Action
保留 `_send_phone()` 的 4xx continue 逻辑，并在真实日志中将该响应标记为“手机号已存在/继续验证码阶段”，只对 5xx 或其他不可恢复响应终止流程。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/test_protocol_cpa_auth.py`
- Tags: cpa-auth, add-phone, idempotency, sms-otp

---

## [LRN-20260720-007] correction

**Logged**: 2026-07-20T12:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
排查 OAuth 入口时必须对比 `oauth_login.js` 生成的完整授权链接，不能把 `https://auth.openai.com/` 根页当成有效测试目标。

### Details
用户明确指出 `oauth_login.js` 在运行时生成的是带 PKCE/state 参数的 `/oauth/authorize?...` 链接。`roxy_2fa_auth_login.js` 复用同一组 OAuth 参数，但当前额外追加 `prompt=login`。此前把 Auth 根页可达性作为帮助用户验证的条件，偏离了实际流程，也没有先完成 `oauth_login.js` 与 2FA 服务链路的源码对比。

### Suggested Action
先梳理旧 OAuth 自动化、Roxy 2FA runner 和 `/replace-2fa` worker 的真实调用链，再决定是否保留 `prompt=login` 或实现独立 CPA 协议；在此之前不改协议代码、不启动错误入口。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/oauth_login.js`, `src/auto/roxy_oauth_login.js`, `src/auto/roxy_2fa_auth_login.js`, `src/server.js`, `src/replacementServices.js`
- Tags: oauth, authorize-url, 2fa-replacement, source-tracing

---

## [LRN-20260720-008] correction

**Logged**: 2026-07-20T17:12:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
协议补号点击后是否打开 Roxy 必须先看子进程的前置字段校验；缺少 `codex_2fa` 时流程会在创建 BrowserSession 前退出。

### Details
账号 116 的点击请求实际已经进入后端并创建了运行日志，但 `protocol_cpa_replacement.py` 在读取账号时发现 `codex_2fa` 为空，直接返回 `ProtocolReplacementError`，所以 Roxy 没有任何页面动作。前端已有的启动 toast 不能替代具体前置校验错误和运行日志展示。

### Suggested Action
协议补号按钮应在前端或后端明确显示缺少邮箱、密码、TOTP、手机号或 SMS API 的具体字段；只有通过校验后再期待 Roxy 浏览器打开。协议补号页还应提供当前运行日志或明确跳转到运行日志详情。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_replacement.py`, `web/app.js`, `data/automation-logs/replacement-2fa-protocol-116-2026-07-20T09-10-39-175Z.log`
- Tags: protocol-replacement, preflight-validation, roxy, logs

---

## [LRN-20260720-009] correction

**Logged**: 2026-07-20T17:30:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
协议 endpoint 的 JSON 顶层形状不能默认都是对象；实际运行态必须以响应形状为准。

### Details
账号 108 已走到 Codex consent，`consent.data` 返回非对象 JSON，旧解析器直接失败；而同文件的 challenge 提取器已经支持数组，说明接口响应形状在不同账号/状态下变化。另一个独立证据是旧服务进程没有执行新 Roxy 刷新步骤，不能把旧日志当作新代码行为。

### Suggested Action
对每个协议 endpoint 分别定义允许的 JSON 形状；涉及服务重启的验证必须先核对 PID、启动时间和运行日志中的新步骤字段，再开始真实账号测试。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/replacementServices.js`, `data/automation-logs/replacement-2fa-protocol-108-2026-07-20T09-25-12-215Z.log`
- Tags: cpa-auth, consent-data, runtime-version, roxy-refresh

---

## [LRN-20260720-010] correction

**Logged**: 2026-07-20T17:46:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
OpenAI workspace 是账号会话级数据，不能把一个测试账号的组织 ID 放到所有补号账号上。

### Details
账号 111 的 free personal workspace 与账号 109 的 plus organization workspace 不同。历史真实浏览器录制给出了账号 111 的 workspace/select body；Run 590 的 401 由跨账号复用 OPENAI_WORKSPACE_ID 触发，不是 Roxy 刷新失败。录制还显示 workspace/select 需要 x-access-flow-invocation-id。

### Suggested Action
所有跨账号 OAuth/CPA 流程在 MFA 后从当前 Auth session 解析允许的 workspace，显式配置值必须先和当前列表匹配；请求头应逐项对比真实浏览器录制。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/protocol_registration/core/session.py`, `docs/issues/issue-016-replacement-protocol-workspace-id-collision.md`
- Tags: cpa-auth, workspace, cross-account, request-headers

---

## [LRN-20260720-011] correction

**Logged**: 2026-07-20T22:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: integration

### Summary
进入 `phone-code` 页面不能推断 `add-phone/send` 已经执行。

### Details
用户指出协议补号在没有看到手机号绑定/发送请求时就开始等待 SMS。代码中的
`next_stage != "phone-code"` 条件跳过了 `add-phone/send`；但该接口只会成功绑定一次，
手机号已存在时的 4xx 仍是可继续分支。流程必须先发送请求，再读取验证码。

### Suggested Action
所有手机阶段统一调用 `add-phone/send`，记录阶段和返回状态，并用回归测试锁定请求顺序。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/protocol_cpa_auth.py`, `src/auto/test_protocol_cpa_auth.py`
- Tags: cpa-auth, phone-add, sms, state-machine

---

## [LRN-20260803-003] correction

**Logged**: 2026-08-03T13:14:36+08:00
**Priority**: medium
**Status**: resolved
**Area**: integration

### Summary
当用户要求可见浏览器请求时，AT 读取必须使用顶层导航，而不是同页后台 fetch。

### Details
`roxy_no_2fa_register.js` 原先在 Roxy 页面内通过 `page.evaluate(fetch('/api/auth/session'))` 读取 AT，
页面 URL 不会变化，用户无法看到 session JSON 页面。用户明确要求把当前浏览器导航到
`https://chatgpt.com/api/auth/session` 后再读取 `accessToken`。

### Suggested Action
session token 读取器使用 `page.goto()` 的响应体解析 JSON，保留有限重试、401/403 失败和“先落盘再回写状态”
约束；测试必须断言精确的顶层 session URL，且 mock 页面不提供 `evaluate()`。

### Metadata
- Source: user_feedback
- Related Files: `src/auto/roxy_no_2fa_register.js`, `test/roxyNo2FaRegister.test.js`
- Tags: roxy, session, access-token, visible-navigation

### Resolution
- **Resolved**: 2026-08-03T13:14:36+08:00
- **Notes**: 已改为可见 Roxy tab 的 `page.goto()`，并完成 RED/GREEN 回归测试。
