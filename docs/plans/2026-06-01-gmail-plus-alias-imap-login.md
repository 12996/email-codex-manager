# Gmail Plus Alias IMAP Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow accounts like `jregkolpig+s1@gmail.com` to be fetched with the base account App Password for `jregkolpig@gmail.com`, while optionally filtering fetched mail to the requested alias.

**Architecture:** Keep the stored `gmail_email` as the user-entered target address. Derive a separate IMAP login address at runtime by removing Gmail plus tags only for `gmail.com` / `googlemail.com`, then connect IMAP with that login address and the existing App Password. When the stored address contains a plus tag, filter fetched messages by recipient headers so the result is scoped to the alias rather than the whole base mailbox.

**Tech Stack:** Node.js ESM, Express, SQLite via `better-sqlite3`, IMAP via `imapflow`, parsing via `mailparser`, tests via `node --test`.

---

## Change Brief

### Target

When an account is saved as `name+tag@gmail.com`, `/accounts/:id/test` and `/accounts/:id/fetch` should authenticate to Gmail IMAP as `name@gmail.com`, using the stored App Password, and fetch mail addressed to `name+tag@gmail.com`.

### Out of Scope

- Do not add OAuth.
- Do not change the SQLite schema unless implementation proves runtime derivation is insufficient.
- Do not normalize or rewrite the displayed/stored `gmail_email`; the UI should still show the alias the user entered.
- Do not implement dot-alias normalization (`j.reg.kolpig@gmail.com` -> `jregkolpig@gmail.com`) in this change, because Gmail dot behavior can surprise users and affect filtering expectations.

### Acceptance Criteria

- `deriveGmailImapLoginEmail('jregkolpig+s1@gmail.com')` returns `jregkolpig@gmail.com`.
- `deriveGmailImapLoginEmail('jregkolpig@gmail.com')` returns `jregkolpig@gmail.com`.
- Non-Gmail domains are unchanged, e.g. `user+tag@example.com` stays `user+tag@example.com`.
- IMAP `auth.user` uses the derived login email, not the raw alias.
- When `gmail_email` contains a Gmail plus alias, fetched messages are included only if recipient headers contain that exact alias case-insensitively.
- Existing tests continue to pass.
- Docs explain that Gmail App Password belongs to the base mailbox, while `gmail_email` may be a plus alias target.

### Rollback Expectation

This should be reversible by reverting changes to `src/imapService.js`, tests, and docs. No database migration should be needed.

---

## Current Behavior Summary

- `src/accounts.js` stores `gmail_email` using `input.gmail_email.trim()` and does not normalize plus aliases.
- `src/server.js` loads the account by `id`, then calls `testConnection(account)` or `fetchMessages(account, options)`.
- `src/imapService.js` creates `ImapFlow` with `auth.user: account.gmail_email`.
- `src/imapService.js` already strips spaces from the App Password via `normalizeAppPassword`.
- `src/readLocations.js` filters self-sent mail for "all mail" by comparing sender to the raw `gmail_email`.
- `createMessageSummary()` currently records sender fields, but does not record `to`, `cc`, or delivery recipient headers needed for alias filtering.

Important files:

- Modify: `src/imapService.js` - IMAP login derivation, message recipient extraction, alias filtering.
- Modify: `test/imapService.test.js` - unit tests for derivation and alias filtering.
- Modify: `docs/api.md` - document plus alias behavior.
- Modify: `docs/gmail-account-setup.md` - explain base App Password + alias address usage.

---

## Impact & Risk

### Must Change

- `src/imapService.js`
  - Add `deriveGmailImapLoginEmail()`.
  - Use derived login in `createClient()`.
  - Add recipient extraction to `createMessageSummary()`.
  - Add `shouldIncludeMessageForAccount()` or equivalent central filter that combines existing self-sent filtering with alias-recipient filtering.

- `test/imapService.test.js`
  - Add focused unit tests before implementation.
  - Keep no-network tests only; do not connect to Gmail in automated tests.

- `docs/api.md`, `docs/gmail-account-setup.md`
  - Update usage guidance.

### Risks

- Some Gmail messages may not expose the alias in standard `To`/`Cc` if they were Bcc'd or forwarded. Mitigation: also inspect parsed headers like `Delivered-To`, `X-Original-To`, and `Envelope-To` where present.
- If alias filtering is too strict, legitimate alias mail may be hidden. Mitigation: tests cover standard `To` and delivery headers; docs mention Bcc/forwarding edge cases.
- Existing "全部邮件" self-sent filtering currently compares against raw alias. For alias accounts, self-sent filtering should compare against the derived base login too.

### Rollback Plan

- Revert the single feature diff.
- No data cleanup required because stored `gmail_email` remains unchanged.
- If alias filtering causes missed mail, temporarily disable recipient filtering while keeping base-login derivation.

---

## Task 1: Add Gmail login email derivation tests

**Files:**

- Modify: `test/imapService.test.js`
- Modify later: `src/imapService.js`

**Step 1: Write the failing test**

Add `deriveGmailImapLoginEmail` to the import list:

```js
import {
  classifyImapError,
  createMessageSummary,
  deriveGmailImapLoginEmail,
  mergeSortAndLimitMessages,
  normalizeAppPassword,
  shouldIncludeMessage,
  toUserFacingImapError,
} from '../src/imapService.js';
```

Add tests:

```js
test('deriveGmailImapLoginEmail removes plus tag only for Gmail domains', () => {
  assert.equal(deriveGmailImapLoginEmail('jregkolpig+s1@gmail.com'), 'jregkolpig@gmail.com');
  assert.equal(deriveGmailImapLoginEmail('JregKolPig+S1@Gmail.com'), 'jregkolpig@gmail.com');
  assert.equal(deriveGmailImapLoginEmail('jregkolpig+s1@googlemail.com'), 'jregkolpig@googlemail.com');
  assert.equal(deriveGmailImapLoginEmail('user+tag@example.com'), 'user+tag@example.com');
  assert.equal(deriveGmailImapLoginEmail('user@gmail.com'), 'user@gmail.com');
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: FAIL because `deriveGmailImapLoginEmail` is not exported.

**Step 3: Implement minimal derivation**

In `src/imapService.js`, add:

```js
export function deriveGmailImapLoginEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 1) {
    return normalized;
  }

  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  if (!['gmail.com', 'googlemail.com'].includes(domain)) {
    return normalized;
  }

  const plusIndex = local.indexOf('+');
  const loginLocal = plusIndex === -1 ? local : local.slice(0, plusIndex);
  return `${loginLocal}@${domain}`;
}
```

**Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/imapService.js test/imapService.test.js
git commit -m "feat: derive gmail imap login for plus aliases"
```

---

## Task 2: Use derived Gmail login in IMAP authentication

**Files:**

- Modify: `src/imapService.js`
- Test: `test/imapService.test.js`

**Step 1: Make `createClient` testable without network**

Because `createClient()` is currently private and constructs `ImapFlow` directly, keep the public surface small by exporting a pure helper:

```js
export function createImapAuth(account) {
  return {
    user: deriveGmailImapLoginEmail(account.gmail_email),
    pass: normalizeAppPassword(account.gmail_app_password),
  };
}
```

**Step 2: Write the failing test**

Update import list with `createImapAuth`, then add:

```js
test('createImapAuth uses base Gmail login for plus alias and normalizes app password', () => {
  assert.deepEqual(
    createImapAuth({
      gmail_email: 'jregkolpig+s1@gmail.com',
      gmail_app_password: 'abcd efgh ijkl mnop',
    }),
    {
      user: 'jregkolpig@gmail.com',
      pass: 'abcdefghijklmnop',
    },
  );
});
```

**Step 3: Run test to verify it fails**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: FAIL because `createImapAuth` is not exported.

**Step 4: Implement helper and wire it into `createClient`**

In `src/imapService.js`:

```js
export function createImapAuth(account) {
  return {
    user: deriveGmailImapLoginEmail(account.gmail_email),
    pass: normalizeAppPassword(account.gmail_app_password),
  };
}
```

Then replace:

```js
auth: {
  user: account.gmail_email,
  pass: normalizeAppPassword(account.gmail_app_password),
},
```

with:

```js
auth: createImapAuth(account),
```

**Step 5: Run tests**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/imapService.js test/imapService.test.js
git commit -m "feat: authenticate gmail aliases with base mailbox"
```

---

## Task 3: Preserve recipient data in message summaries

**Files:**

- Modify: `src/imapService.js`
- Modify: `test/imapService.test.js`

**Step 1: Write the failing test**

Update the existing `createMessageSummary shapes parsed mail into UI summary` expected object to include:

```js
toAddresses: ['jregkolpig+s1@gmail.com'],
ccAddresses: ['support@example.com'],
deliveredToAddresses: ['jregkolpig+s1@gmail.com'],
```

Use this parsed input:

```js
to: { text: 'Alias <jregkolpig+s1@gmail.com>', value: [{ address: 'jregkolpig+s1@gmail.com' }] },
cc: { text: 'Support <support@example.com>', value: [{ address: 'support@example.com' }] },
headers: new Map([
  ['delivered-to', 'jregkolpig+s1@gmail.com'],
]),
```

**Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: FAIL because those fields are not present.

**Step 3: Implement recipient extraction**

In `src/imapService.js`, add helper functions:

```js
function extractAddressList(addressObject) {
  return (addressObject?.value || [])
    .map((entry) => String(entry?.address || '').trim().toLowerCase())
    .filter(Boolean);
}

function extractHeaderAddresses(headers, names) {
  const values = names.flatMap((name) => {
    const value = headers?.get?.(name);
    return Array.isArray(value) ? value : [value];
  });

  return values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}
```

Then extend `createMessageSummary()` return value:

```js
toAddresses: extractAddressList(parsed.to),
ccAddresses: extractAddressList(parsed.cc),
deliveredToAddresses: extractHeaderAddresses(parsed.headers, [
  'delivered-to',
  'x-original-to',
  'envelope-to',
]),
```

**Step 4: Run tests**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/imapService.js test/imapService.test.js
git commit -m "feat: track gmail message recipient aliases"
```

---

## Task 4: Filter plus-alias fetch results to the requested alias

**Files:**

- Modify: `src/imapService.js`
- Modify: `test/imapService.test.js`

**Step 1: Write failing tests**

Add exported helper tests:

```js
test('shouldIncludeMessage includes Gmail plus alias recipients case-insensitively', () => {
  const message = {
    fromAddress: 'sender@example.com',
    toAddresses: ['JregKolPig+S1@Gmail.com'],
    ccAddresses: [],
    deliveredToAddresses: [],
  };

  assert.equal(shouldIncludeMessage(message, 'jregkolpig+s1@gmail.com', false), true);
});

test('shouldIncludeMessage excludes other recipients when account is a Gmail plus alias', () => {
  const message = {
    fromAddress: 'sender@example.com',
    toAddresses: ['jregkolpig+s2@gmail.com'],
    ccAddresses: [],
    deliveredToAddresses: [],
  };

  assert.equal(shouldIncludeMessage(message, 'jregkolpig+s1@gmail.com', false), false);
});

test('shouldIncludeMessage accepts delivered-to header for Gmail plus aliases', () => {
  const message = {
    fromAddress: 'sender@example.com',
    toAddresses: [],
    ccAddresses: [],
    deliveredToAddresses: ['jregkolpig+s1@gmail.com'],
  };

  assert.equal(shouldIncludeMessage(message, 'jregkolpig+s1@gmail.com', false), true);
});
```

Update existing self-sent test to ensure the derived base login is also treated as self:

```js
test('shouldIncludeMessage filters self-sent messages for alias account all mail', () => {
  const message = { fromAddress: 'jregkolpig@gmail.com', toAddresses: ['other@example.com'] };

  assert.equal(shouldIncludeMessage(message, 'jregkolpig+s1@gmail.com', true), false);
});
```

**Step 2: Run tests to verify failure**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: FAIL because alias-recipient filtering does not exist.

**Step 3: Implement alias detection and recipient filtering**

Add:

```js
function isGmailPlusAlias(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const [local, domain] = normalized.split('@');
  return Boolean(local?.includes('+') && ['gmail.com', 'googlemail.com'].includes(domain));
}

function messageMatchesAliasRecipient(message, gmailEmail) {
  if (!isGmailPlusAlias(gmailEmail)) {
    return true;
  }

  const target = String(gmailEmail || '').trim().toLowerCase();
  const recipients = [
    ...(message.toAddresses || []),
    ...(message.ccAddresses || []),
    ...(message.deliveredToAddresses || []),
  ].map((value) => String(value || '').trim().toLowerCase());

  return recipients.includes(target);
}
```

Then change `shouldIncludeMessage()` to:

```js
export function shouldIncludeMessage(message, gmailEmail, filterSelfSent) {
  if (filterSelfSent && isSelfSentMessage(message, gmailEmail)) {
    return false;
  }
  if (filterSelfSent && isSelfSentMessage(message, deriveGmailImapLoginEmail(gmailEmail))) {
    return false;
  }
  return messageMatchesAliasRecipient(message, gmailEmail);
}
```

**Step 4: Run focused tests**

Run:

```powershell
npm test -- test/imapService.test.js
```

Expected: PASS.

**Step 5: Run all tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/imapService.js test/imapService.test.js
git commit -m "feat: filter gmail plus alias recipients"
```

---

## Task 5: Update documentation

**Files:**

- Modify: `docs/api.md`
- Modify: `docs/gmail-account-setup.md`

**Step 1: Update API docs**

In `docs/api.md`, under account creation/update fields, add:

```md
Gmail plus alias:

- 可以把 `gmail_email` 填成 `jregkolpig+s1@gmail.com`。
- 后端会使用 `jregkolpig@gmail.com` 作为 Gmail IMAP 登录用户名。
- `gmail_app_password` 必须是 `jregkolpig@gmail.com` 这个主账号生成的 App Password。
- 拉取邮件时会优先只显示收件人/投递头匹配 `jregkolpig+s1@gmail.com` 的邮件。
```

**Step 2: Update setup docs**

In `docs/gmail-account-setup.md`, add a short section:

```md
## 使用 Gmail `+tag` 别名

如果你需要读取 `jregkolpig+s1@gmail.com` 这类别名邮件：

1. 在 Google 账号里为主账号 `jregkolpig@gmail.com` 创建 App Password。
2. 在本项目的 `Gmail 邮箱号` 填 `jregkolpig+s1@gmail.com`。
3. 在 `App Password` 填主账号生成的 App Password。

服务连接 IMAP 时会自动用 `jregkolpig@gmail.com` 登录，并在拉取结果里筛选投递到 `jregkolpig+s1@gmail.com` 的邮件。
```

**Step 3: Run tests**

Run:

```powershell
npm test
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add docs/api.md docs/gmail-account-setup.md
git commit -m "docs: explain gmail plus alias app passwords"
```

---

## Task 6: Manual verification

**Files:**

- No code changes expected.

**Step 1: Start the app**

Run:

```powershell
npm start
```

Expected:

```text
Listening on http://localhost:3000
```

**Step 2: Create or edit account**

In the admin UI:

- `gmail_email`: `jregkolpig+s1@gmail.com`
- `gmail_app_password`: App Password from `jregkolpig@gmail.com`

**Step 3: Test connection**

Click `测试`.

Expected:

- Page shows `jregkolpig+s1@gmail.com 连接成功`.
- Account status stays `active`.

**Step 4: Fetch mail**

Send a test email to `jregkolpig+s1@gmail.com`, then click `获取`.

Expected:

- The new email appears.
- Emails only addressed to `jregkolpig+s2@gmail.com` should not appear in this alias account result.

**Step 5: Regression checks**

Also verify:

- A normal `user@gmail.com` account still fetches normally.
- A non-Gmail address with `+tag` is not rewritten for IMAP login.
- `all` read location still filters self-sent mail.

---

## Final Verification Command

Run:

```powershell
npm test
```

Expected:

```text
# pass ...
# fail 0
```

The exact pass count may change after adding tests, but failures must be zero.
