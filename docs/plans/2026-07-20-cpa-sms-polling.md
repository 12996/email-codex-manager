# CPA SMS Polling Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让独立 CPA 协议在 `add-phone/send` 后轮询短信 API，而不是只读取一次，并将手机号已存在时的 4xx 作为可继续分支。

**Architecture:** Auth 请求仍通过当前 Roxy CDP 会话；SMS API 继续使用独立 HTTP transport。`add-phone/send` 的 4xx 只记录可继续状态，随后由有总超时和轮询间隔的 helper 获取六位验证码，成功后才调用 `phone-otp/validate`。

**Tech Stack:** Python 标准库、现有 `BrowserSession`、Python `unittest`、Node bridge 回归测试。

---

### Task 1: 添加失败回归测试

**Files:**
- Modify: `src/auto/test_protocol_cpa_auth.py`

**Steps:**
1. 用 fake session 构造 `add-phone/send` 返回 400。
2. mock SMS API 第一次无验证码、第二次返回六位验证码。
3. 断言发生两次 SMS 读取，且 `phone-otp/validate` 在第二次读取成功后才调用。
4. 运行 CPA 专项测试，确认新测试因缺少轮询参数/实现而失败。

**状态：completed**

### Task 2: 实现短信轮询

**Files:**
- Modify: `src/auto/protocol_cpa_auth.py`

**Steps:**
1. 增加 `sms_poll_timeout` 和 `sms_poll_interval` 参数及 CLI/env 配置。
2. 新增总超时轮询 helper，复用现有 `fetch_sms_code`；每次失败只等待后重试。
3. 保留 4xx continue，明确日志说明手机号已存在或请求已挂起。
4. 使用 `phone_code_factory` 的测试/人工注入路径时不走轮询。

**状态：completed**

### Task 3: 回归验证与文档

**Files:**
- Modify: `docs/changes/CHG-089-standalone-cpa-2fa-auth-protocol.md`
- Modify: `docs/work/2026-07-20-standalone-cpa-auth-test.md`

**Steps:**
1. 运行 CPA 专项、协议注册 Python、Roxy bridge/服务 Node 测试。
2. 运行 Python/Node 语法检查和 `git diff --check`。
3. 记录真实测试仍需先到达 `add-phone/send`，不把发送前 SMS 查询当作证据。

**状态：completed**

### Task 4: 独立 CPA 直接 Auth 导航

**Files:**
- Modify: `src/auto/protocol_registration/core/session.py`
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- Modify: `src/auto/protocol_cpa_auth.py`
- Test: `src/auto/protocol_registration/tests/test_roxy_bridge.py`
- Test: `test/roxyCdpBridge.test.js`

**Result:** 独立 CPA 跳过 ChatGPT 预热，bridge 直接导航完整 Auth authorize URL；注册协议继续保留 ChatGPT 预热。相关回归测试通过。

**状态：completed**
