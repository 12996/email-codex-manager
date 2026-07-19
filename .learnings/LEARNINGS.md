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
