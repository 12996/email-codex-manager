# 协议注册后台页与响应判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Roxy 协议注册以网络响应和后续协议 API 判定状态，不再以业务页面 DOM 加载判定成功。

**Architecture:** 保留分域后台页和 document navigation 语义。bridge 将后台页初始化与协议导航的等待条件改为 Playwright `commit`，返回 response 提交标记和脱敏重定向状态链；Python 外层等待预算覆盖 bridge 的重试窗口。OAuth callback 最终仍由 `/api/auth/session` 的 `accessToken` 验证。

**Tech Stack:** Node.js CommonJS、Playwright Core/Roxy CDP、Python 3 `unittest`、Node built-in test runner。

## Global Constraints

- 不修改 OpenAI 协议顺序、Sentinel 执行上下文、Roxy profile 选择、验证码来源或账号状态模型。
- 不读取业务页面 DOM，不以元素、页面文案、`domcontentloaded` 或 `load` 判定协议成功。
- 后台页继续按 `auth.openai.com`、`chatgpt.com`、`sentinel.openai.com` 分域复用。
- 不记录 Cookie、授权码、Token、OTP、Sentinel header 或代理凭据。
- 已收到 `email-otp/send` 的 document response 后不得因页面资源加载失败重发请求。

---

### Task 1: 将 bridge 后台页和导航等待切换为 response commit

**Files:**
- Modify: `test/roxyCdpBridge.test.js`
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs:248-304,379-413`

**Interfaces:**
- `RoxyCdpBridge.navigate(payload)` 保留已有响应字段，新增 `response_committed: boolean` 和 `redirect_chain: Array<{status_code,status_text,url}>`。
- `pageForOrigin(url, timeoutMs)` 只等待 origin 根文档 response 已提交，不调用 `waitForLoadState()`。

- [ ] **Step 1: 写失败的 Node 回归测试**

将现有 warm-up 断言改为：

```js
assert.deepEqual(calls, [
  ['goto', 'https://chatgpt.com/', 'commit'],
]);
```

新增导航测试。fake `goto()` 记录 options；final response 的 `request().redirectedFrom()` 指向 302 request，每个 request 的 `response()` 返回对应 response。断言：

```js
assert.equal(gotoOptions.waitUntil, 'commit');
assert.equal(result.response_committed, true);
assert.deepEqual(result.redirect_chain.map((item) => item.status_code), [302, 200]);
```

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- test/roxyCdpBridge.test.js`

Expected: warm-up 仍传入 `domcontentloaded` 并调用 `waitForLoadState`；导航结果缺少新增字段。

- [ ] **Step 3: 实现最小 bridge 修改**

在 `pageForOrigin()` 的两处 warm-up 中只调用 `page.goto(targetOrigin + "/", { waitUntil: "commit", timeout: timeoutMs })`，删除 `page.waitForLoadState("load", ...)`。在 `navigate()` 中传入 `{ waitUntil: "commit", timeout: timeoutMs, referer }`。

新增异步 helper：从最终 response 的 `request().redirectedFrom()` 向前遍历，对每个 request 调用 `await request.response()`，返回按初始到最终排序的、仅含 `status_code`、`status_text`、`url` 的数组。将数组和 `Boolean(response)` 写入 navigate result。

- [ ] **Step 4: 运行 bridge 测试**

Run: `npm test -- test/roxyCdpBridge.test.js`

Expected: 所有 bridge 测试通过；没有测试再要求后台页等待 `load` 或 `domcontentloaded`。

- [ ] **Step 5: 提交本任务**

Run: `git add test/roxyCdpBridge.test.js src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`

Run: `git commit -m "fix: use committed responses for protocol navigation"`

### Task 2: 让 Python bridge 等待预算覆盖网络重试

**Files:**
- Modify: `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- Modify: `src/auto/protocol_registration/core/roxy_cdp.py:62-89,193-235,245-270`

**Interfaces:**
- 新增 `RoxyCdpClient._response_wait_timeout(command, payload) -> float`。
- `RoxyCdpClient._call()` 对 `request` 和 `navigate` 使用此值等待 JSONL response；其他命令保留 `self._request_timeout`。

- [ ] **Step 1: 写失败的 Python 回归测试**

```python
client = RoxyCdpClient(request_timeout=60, exchange=lambda request: {})
timeout = client._response_wait_timeout("navigate", {"timeout_ms": 60_000})
self.assertGreaterEqual(timeout, 190)
```

增加同样的 `request` 断言，防止三个 bridge 尝试期间 Python 先超时。

- [ ] **Step 2: 运行失败测试**

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge.RoxyBridgeTests`

Expected: `AttributeError` 指出 `_response_wait_timeout` 不存在。

- [ ] **Step 3: 实现最小预算函数**

定义 `_PAGE_COMMAND_MAX_ATTEMPTS = 3` 和 `_PAGE_COMMAND_OVERHEAD_SECONDS = 10.0`。`payload["timeout_ms"]` 与 `self._request_timeout` 取较大值作为单次预算；`request`/`navigate` 返回 `single_timeout * 3 + 10`，其他命令返回 `self._request_timeout`；`_call()` 的 `Queue.get()` 使用计算结果。

- [ ] **Step 4: 运行 Python bridge 测试**

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge.RoxyBridgeTests`

Expected: 所有 `RoxyBridgeTests` 通过，默认 60 秒导航能完成三次尝试与退避。

- [ ] **Step 5: 提交本任务**

Run: `git add src/auto/protocol_registration/core/roxy_cdp.py src/auto/protocol_registration/tests/test_roxy_bridge.py`

Run: `git commit -m "fix: budget CDP response waits for retries"`

### Task 3: 强化调用方的响应驱动终态

**Files:**
- Modify: `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- Modify: `src/auto/protocol_registration/core/openai_auth.py:49-89,253-291`
- Modify: `src/auto/protocol_registration/core/account_export.py:151-177`

**Interfaces:**
- `follow_authorize()`、`follow_auth_continue()`、`get_create_account_page()` 继续使用 `session.navigate()`，只检查 response 状态和协议重定向 URL。
- `follow_oauth_callback()` 在返回 URL 前调用 `resp.raise_for_status()`；调用者仍以 `fetch_session()` 的 `accessToken` 作为 OAuth 成功判据。

- [ ] **Step 1: 写失败的调用方测试**

为 callback fake response 增加 `raise_for_status()` 并抛出 `RuntimeError("HTTP 502")`，断言 `follow_oauth_callback()` 抛出该错误。新增 `follow_auth_continue()` 测试：fake response 仅提供 `raise_for_status()` 与 `url`，不提供 DOM API；断言使用 `session.navigate()` 后成功返回。

- [ ] **Step 2: 运行失败测试**

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge.RoxyBridgeTests`

Expected: callback 测试失败，因为当前函数未调用 `raise_for_status()`。

- [ ] **Step 3: 实现最小调用方修改**

在 `follow_oauth_callback()` 的请求后加入 `resp.raise_for_status()`。不加入 DOM、标题、输入框或页面文案检查；保留 `get_create_account_page()` 的 URL 路径检查、`follow_auth_continue()` 的前置 JSON `page.type`/`method` 检查，以及 `_finalize_registration_session()` 的 `accessToken` 最终校验。

- [ ] **Step 4: 运行协议 Python 测试**

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge tests.test_password_registration`

Expected: 全部通过；fake session 不需要任何 DOM 方法。

- [ ] **Step 5: 提交本任务**

Run: `git add src/auto/protocol_registration/core/openai_auth.py src/auto/protocol_registration/core/account_export.py src/auto/protocol_registration/tests/test_roxy_bridge.py`

Run: `git commit -m "fix: validate protocol navigation by response state"`

### Task 4: 验证、记录并实机验收

**Files:**
- Modify: `docs/issues/issue-020-protocol-registration-cdp-navigate-timeout-budget.md`
- Modify: `docs/work/2026-07-28-protocol-registration-cdp-timeout-diagnosis.md`
- Modify: `docs/work/handoff.md`
- Verify: `test/roxyCdpBridge.test.js`、`src/auto/protocol_registration/tests/test_roxy_bridge.py`、`src/auto/protocol_registration/tests/test_password_registration.py`

- [ ] **Step 1: 运行自动化回归集**

Run: `npm test -- test/roxyCdpBridge.test.js`

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_roxy_bridge tests.test_password_registration`

Run: `F:\anaconda\anaconda3\envs\tilian\python.exe -m py_compile src/auto/protocol_registration/core/roxy_cdp.py src/auto/protocol_registration/core/openai_auth.py src/auto/protocol_registration/core/account_export.py`

Expected: 所有命令退出 0。

- [ ] **Step 2: 检查测试账号与 Roxy 前置条件**

通过本地数据库确认 `billows_whine_4y@icloud.com` 是 `unregistered`，再由既有注册入口准备 Roxy 指纹、IP、CDP 和邮箱验证码来源。不得打印密码、Token 或验证码。

- [ ] **Step 3: 执行一次实机协议注册**

使用既有协议注册入口仅运行该测试账号。验收日志必须表明：每个导航已收到 HTTP response/重定向链；没有因 `domcontentloaded` 或 `load` 超时终止；OAuth 只在 `/api/auth/session` 返回 `accessToken` 后确认成功。若在 response 提交前失败，记录状态链和网络错误，不自动重复已提交的 `email-otp/send`。

- [ ] **Step 4: 更新问题记录和交接**

根据自动化与实机结果将 issue-020 更新为 `resolved` 或保留 `active`；记录 run ID、验证命令和脱敏结果。仅在长期行为确实完成变更时创建对应 change 记录。

- [ ] **Step 5: 提交本任务**

Run: `git add docs/issues/issue-020-protocol-registration-cdp-navigate-timeout-budget.md docs/work/2026-07-28-protocol-registration-cdp-timeout-diagnosis.md docs/work/handoff.md`

Run: `git commit -m "docs: verify response-driven protocol navigation"`
