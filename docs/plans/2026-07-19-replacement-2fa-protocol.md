# Replacement 2FA Protocol Implementation Plan

> **For Codex:** Keep the existing DOM automation state machine unchanged. Use it as the behavioral reference and move only the verified request flow into the protocol layer.

**Goal:** 将补号 2FA 登录中的已验证请求链转换为可恢复的协议流程，并把短信验证码读取与 Roxy/OpenAI 会话传输隔离。

**Architecture:** OpenAI/Auth/OAuth 请求继续通过当前 Roxy CDP 页面上下文，保持 Cookie、UA、设备 ID 和出口 IP 一致；短信验证码 API 使用独立 HTTP transport 和可选本地代理，不复用 Roxy 的 `page.request`。`add-phone/send` 只记录为可选阶段，后续手机验证上下文存在时直接进入 `phone-otp/validate`。

**Tech Stack:** Node.js 22、现有 Playwright CDP bridge、Python protocol `BrowserSession`、标准库 HTTP transport、Node test runner 和 Python `unittest`。

---

## 约束与验收标准

- 不修改 `roxy_oauth_login.js` / `roxy_2fa_auth_login.js` 的既有页面状态机行为。
- OpenAI/Auth/OAuth 请求保持在同一个 Roxy profile 和会话上下文内。
- 短信验证码请求不通过 Roxy 页面上下文；支持 `SMS_API_PROXY` 独立配置。
- `add-phone/send` 的 4xx 或页面延迟不能直接覆盖已经建立的手机验证上下文。
- 只有 `phone-otp/validate` 成功、OAuth callback 完成并拿到 token 后，才进入凭证生成和 CPA 上传。
- 测试和日志不输出密码、验证码、Cookie、Authorization、access token、refresh token 或 TOTP secret。

## Task 1: 锁定独立短信 transport 行为

**Files:**

- Create: `src/auto/protocol_registration/core/sms_client.py`
- Test: `src/auto/protocol_registration/tests/test_sms_client.py`
- Modify: `src/auto/protocol_registration/config/email.py`
- Modify: `src/auto/protocol_registration/config/__init__.py`

1. 先测试默认 transport 不依赖 Roxy request 对象。
2. 测试 `SMS_API_PROXY` 被传给独立 transport，且验证码解析只返回 6 位数字。
3. 测试 4xx、超时、无验证码响应的错误分类。
4. 实现最小 `SmsCodeClient`，不读取浏览器 Cookie，不调用 `RoxyCdpClient`。

## Task 2: 提取手机号协议请求和响应校验

**Files:**

- Create: `src/auto/protocol_registration/core/phone_verification.py`
- Test: `src/auto/protocol_registration/tests/test_phone_verification.py`

1. 用 fake session 写失败测试，覆盖：
   - 手机验证方式页直接进入验证码页；
   - `add-phone/send` 非 2xx 但已有验证码上下文时继续；
   - `phone-otp/validate` 成功返回后续 URL；
   - 没有验证上下文时才抛出明确错误。
2. 实现请求构造器和响应阶段判定，动态字段只来自当前响应或当前会话。
3. 手机验证码通过 `SmsCodeClient` 获取，再由 Roxy 会话提交到 Auth API。

## Task 3: 接入协议执行入口

**Files:**

- Modify: `src/auto/protocol_registration/main.py`
- Modify: `src/replacementServices.js`
- Modify: `test/replacementServices.test.js`

1. 增加独立的 2FA 协议入口，不复用或改写现有 DOM 状态机。
2. 显式传递账号邮箱、密码、已有 2FA、手机号、短信 API 和 `SMS_API_PROXY`。
3. 保持当前浏览器打开策略，不在协议流程中关闭用户已打开的 Roxy 页面。
4. 子进程日志只保留阶段和状态，不记录敏感值。

## Task 4: CPA 前置条件与回归验证

**Files:**

- Modify: `src/cpaRepairWorker.js` only if protocol result contract requires it.
- Add or update focused tests for result validation.

1. 验证协议失败不会执行 CPA upload。
2. 验证 OAuth/token 成功后才生成本地 CPA JSON。
3. 运行 Python/Node focused tests、compileall、`npm test` 和 `git diff --check`。

