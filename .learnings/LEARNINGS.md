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
