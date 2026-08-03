# Simplify Replacement Action Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove five unneeded actions from the replacement-account operation menu without changing their backend APIs.

**Architecture:** The menu is rendered as one template in `web/app.js`. Remove only the five button nodes from that template; their existing handlers and server routes remain available to other callers.

**Tech Stack:** Browser JavaScript, Node.js built-in test runner.

## Global Constraints

- Do not remove event handlers or backend endpoints.
- Keep `协议注册`、`协议补号`、`编辑账号`、`注册`、`执行补号`、`2FA补号`、`删除账号` and conditional `解除熔断` visible.

---

### Task 1: Remove obsolete operation-menu controls

**Files:**
- Create: `test/replacementActionMenu.test.js`
- Modify: `web/app.js:496-510`
- Create: `docs/changes/CHG-102-simplify-replacement-action-menu.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`

**Interfaces:**
- Consumes: the replacement-account row template in `renderReplacementRows`.
- Produces: an action menu that omits the five requested `data-action` values.

- [ ] **Step 1: Write the failing test**

```js
for (const action of ['toggle-public-code', 'sms', 'json', 'login-2fa', 'copy-public-code-url']) {
  assert.doesNotMatch(menuTemplate, new RegExp(`data-action="${action}"`));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/replacementActionMenu.test.js`

Expected: FAIL because the current menu contains `data-action="toggle-public-code"`.

- [ ] **Step 3: Remove the five menu button nodes**

Delete only the five button/template lines from the `.action-menu` HTML template in `web/app.js`. Do not alter `handleAction`, `togglePublicCode`, `copyPublicCodeUrl`, `fetchSmsCode`, `fetchJson`, or `loginAccountWith2FA`.

- [ ] **Step 4: Run the focused test**

Run: `node --test test/replacementActionMenu.test.js`

Expected: PASS.

- [ ] **Step 5: Record the change**

Create `CHG-102` with status `implemented` and add its registry entry. State that the removal is presentation-only and leaves server behavior unchanged.
