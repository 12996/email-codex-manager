# 无 2FA Session 新标签页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不导航 ChatGPT 主页面的情况下读取无 2FA 注册的 session AT。

**Architecture:** `readSessionAccessToken()` 使用传入主页面所属的 BrowserContext 创建 session 标签页。所有 session 请求、重试和 JSON 解析在该标签页中完成；成功后保留页面供人工核验，且不使用主页面作为回退。

**Tech Stack:** Node.js CommonJS、Playwright Core、node:test。

## Global Constraints

- session URL 固定为 `https://chatgpt.com/api/auth/session`。
- 不记录或输出 AT、OTP、Cookie、CDP endpoint 或代理凭据。
- AT 文件成功写入后才可回写 `registered` 状态。
- 无法创建新标签页时不得导航主页面。

---

### Task 1: Session 标签页读取器

**Files:**
- Modify: `test/roxyNo2FaRegister.test.js:171-215`
- Modify: `src/auto/roxy_no_2fa_register.js:126-173`

**Interfaces:**
- Consumes: Playwright `Page.context(): BrowserContext`、`BrowserContext.newPage(): Promise<Page>`。
- Produces: `readSessionAccessToken(page, options): Promise<string>`，失败时抛出带稳定 `code` 的 Error。

- [x] **Step 1: Write the failing test**

```js
const mainPage = {
  context() { return context; },
  async goto() { throw new Error('main page must not navigate'); },
};
const context = { async newPage() { return sessionPage; } };
const sessionPage = { async goto() { return response; } };
const accessToken = await readSessionAccessToken(mainPage, { attempts: 1 });
assert.equal(accessToken, 'access-token');
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/roxyNo2FaRegister.test.js`

Expected: FAIL because the existing reader invokes `mainPage.goto()` rather than `context.newPage()`.

- [x] **Step 3: Write minimal implementation**

```js
const context = page?.context?.();
const sessionPage = await context.newPage();
return await readFromSessionPage(sessionPage); // Keep the visible session tab open.
```

- [x] **Step 4: Run targeted regression tests**

Run: `node --test test/roxyNo2FaRegister.test.js`

Expected: PASS, including empty-session retry and transient-navigation retry tests.

- [x] **Step 5: Run full verification**

Run: `npm test`

Expected: PASS with no test failures.

### Task 2: 变更记录

**Files:**
- Create: `docs/changes/CHG-106-no2fa-session-new-tab.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/work/2026-08-03-roxy-no2fa-browser-registration.md`
- Modify: `docs/work/handoff.md`

**Interfaces:**
- Consumes: Task 1 verified behavior.
- Produces: A documented `implemented` change and handoff entry.

- [x] **Step 1: Record acceptance criteria**

Document same-context tab creation, no main-page fallback, successful-tab retention, unusable-tab cleanup, and no sensitive-value logging.

- [x] **Step 2: Record verification output**

Recorded `node --test test/roxyNo2FaRegister.test.js` as 28/28 and `npm test` as 71/71.
