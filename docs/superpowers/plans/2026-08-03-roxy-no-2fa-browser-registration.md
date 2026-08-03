# Roxy 无 2FA 浏览器注册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个独立的 Roxy 浏览器无 2FA 注册脚本，在真实页面完成 OTP-first 注册后保存 AT 并同步补号状态。

**Architecture:** 新脚本使用既有无 2FA Roxy 准备器完成代理刷新、缓存清理、指纹随机化和开窗，再连接这次窗口的 CDP。页面流只接受邮箱、OTP、资料页和 ChatGPT session 阶段；密码、TOTP 和 `user/register` 均是明确失败条件。AT 成功落盘后才调用本地补号服务回写 `registered`。

**Tech Stack:** Node.js CommonJS、`playwright-core`、现有 RoxyBrowserClient、Node test runner。

## Global Constraints

- 文件名固定为 `src/auto/roxy_no_2fa_register.js`。
- 不调用密码、`user/register`、MFA/TOTP API，也不复用旧协议 runner 作为降级路径。
- 不记录 AT、OTP、Cookie、CDP endpoint 或代理凭据。
- 页面点击、URL 改变和元素消失都不是成功判定；只接受阶段专用状态与 session AT。
- 现有 `/replacement-accounts/:id/register-no2fa` 保持运行 Python 协议 runner，浏览器 runner 实机验证后才评估切换。

---

### Task 1: 定义可测试的无 2FA 边界

**Files:**
- Create: `test/roxyNo2FaRegister.test.js`

**Interfaces:**
- Produces: `parseCliArgs`, `parsePreparedProfileOutput`, `assertNo2FaState`, `persistTokenThenMarkRegistered`, `runNo2FaRegistrationFlow` 的期望调用契约。

- [x] **Step 1: Write the failing test**

```js
assert.throws(
  () => assertNo2FaState({ state: 'password-create' }, ['otp']),
  (error) => error.code === 'NO2FA_PASSWORD_STAGE',
);
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/roxyNo2FaRegister.test.js`

Expected: 失败，原因是 `roxy_no_2fa_register.js` 尚不存在。

- [x] **Step 3: Cover the irreversible success ordering**

```js
const order = [];
await persistTokenThenMarkRegistered({
  saveAccessToken: async () => order.push('saved'),
  markRegistered: async () => order.push('marked'),
});
assert.deepEqual(order, ['saved', 'marked']);
```

### Task 2: 实现 Roxy 准备、状态机和本地状态回写

**Files:**
- Create: `src/auto/roxy_no_2fa_register.js`
- Modify: `src/auto/prepare_roxy_no_2fa.cjs`
- Modify: `src/auto/roxy_register_openai.js`
- Test: `test/roxyNo2FaRegister.test.js`

**Interfaces:**
- Consumes: `prepareRoxyNo2FA`, `buildLiveDependencies`, `classifyRegistrationPage`, `fetchRegistrationEmailVerificationCode`, `saveRegistrationAccessTokenFile`。
- Produces: 可由 CLI 和测试注入依赖调用的 `runNo2FaRegistrationFlow`。

- [x] **Step 1: Export only the required shared helpers**

```js
module.exports = {
  // existing exports,
  clickContinueButtonReliably,
  fillProfileFieldsIfPresent,
};
```

- [x] **Step 2: Connect only to the newly prepared Roxy profile**

```js
const prepared = await prepareRoxyNo2FA({ client, proxyService, settingsRepository, env });
const connection = await client.getConnectionInfo();
const { browser, context, page } = await client.connectPlaywright(connection.ws);
```

- [x] **Step 3: Implement the explicit browser stages**

```text
email entry -> usable OTP input -> profile input -> ChatGPT session -> save AT -> registered
```

Every submit is followed by state polling. Password/captcha/unknown terminal states stop the run without a fallback request.

- [x] **Step 4: Implement authenticated local status update**

```text
POST /login -> GET selected replacement account -> PATCH /replacement-accounts/:id/status
```

The helper must use the current account email/ID, never send an AT, and run only after the file save succeeds.

- [x] **Step 5: Run the focused tests**

Run: `node --test test/roxyNo2FaRegister.test.js test/prepareRoxyNo2FA.test.js`

Expected: all tests pass.

### Task 3: Record the durable change and verify the script

**Files:**
- Create: `docs/changes/CHG-104-roxy-no2fa-browser-registration.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Create: `docs/work/2026-08-03-roxy-no2fa-browser-registration.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

- [x] **Step 1: Document behavior and non-goals**

Record the strict no-password/no-TOTP branch, AT-before-status ordering, and that the existing no2fa operation is not switched yet.

- [x] **Step 2: Run final verification**

Run:

```powershell
node --test test/roxyNo2FaRegister.test.js test/prepareRoxyNo2FA.test.js
node --check src/auto/roxy_no_2fa_register.js
git diff --check
```

Expected: all commands exit with code 0.
