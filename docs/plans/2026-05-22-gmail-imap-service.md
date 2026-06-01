# Gmail IMAP Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local admin web service that stores Gmail account fields in SQLite and fetches the latest Gmail messages live through IMAP without storing message content.

**Architecture:** A Node.js Express app serves a password-protected local admin UI. SQLite stores Gmail account records only. IMAP calls are made on demand using Gmail address plus App Password, with read-location options for inbox, all mail, and a merged trash box.

**Tech Stack:** Node.js, Express, SQLite, IMAP client library, minimal server-rendered HTML/CSS, built-in test runner or lightweight script tests.

---

### Task 1: Scaffold the Node.js project

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `src/config.js`

**Step 1: Create package metadata**

Create `package.json` with scripts:

```json
{
  "name": "gmail-imap-service",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "better-sqlite3": "^11.9.1",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "imapflow": "^1.0.181",
    "mailparser": "^3.7.2"
  }
}
```

**Step 2: Add environment example**

Create `.env.example`:

```env
ADMIN_PASSWORD=change-me
SESSION_SECRET=change-me-session-secret
DATABASE_PATH=./data/app.db
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
MAIL_FETCH_LIMIT=5
DEFAULT_READ_LOCATION=inbox
```

**Step 3: Add `.gitignore`**

```gitignore
node_modules/
.env
data/
```

**Step 4: Implement config loader**

Create `src/config.js`:

```js
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  sessionSecret: process.env.SESSION_SECRET || 'change-me-session-secret',
  databasePath: process.env.DATABASE_PATH || './data/app.db',
  imap: {
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT || 993),
    secure: String(process.env.IMAP_SECURE || 'true') === 'true',
  },
  mailFetchLimit: Number(process.env.MAIL_FETCH_LIMIT || 5),
  defaultReadLocation: process.env.DEFAULT_READ_LOCATION || 'inbox',
};
```

**Step 5: Install dependencies**

Run:

```powershell
npm install
```

Expected: dependencies installed successfully.

---

### Task 2: Add SQLite schema and account repository

**Files:**
- Create: `src/db.js`
- Create: `src/accounts.js`
- Create: `test/accounts.test.js`

**Step 1: Write repository tests**

Create tests for:

- creating an account requires `gmail_email`, `gmail_password`, `gmail_2fa`, `gmail_app_password`
- listing accounts returns created rows
- updating last fetch status persists

**Step 2: Implement database initialization**

`src/db.js` should:

- ensure the `data/` directory exists
- open SQLite with `better-sqlite3`
- create `email_accounts` table if missing

**Step 3: Implement repository**

`src/accounts.js` should export:

```js
createAccount(input)
listAccounts()
getAccount(id)
updateAccount(id, input)
deleteAccount(id)
markFetchSuccess(id)
markFetchFailure(id, status, errorMessage)
```

**Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: repository tests pass.

---

### Task 3: Add read-location mapping and mail filtering

**Files:**
- Create: `src/readLocations.js`
- Create: `test/readLocations.test.js`

**Step 1: Write tests**

Test:

```text
inbox -> one target: INBOX
all -> one target: [Gmail]/All Mail, filterSelfSent true
trash -> two targets: [Gmail]/Spam and [Gmail]/Trash
invalid value throws
limit defaults to 5 and clamps to a reasonable max
```

**Step 2: Implement mapping**

Export:

```js
resolveReadLocation(readLocation)
normalizeFetchLimit(value, defaultLimit)
isSelfSentMessage(message, gmailEmail)
```

**Step 3: Run tests**

Run:

```powershell
npm test
```

Expected: mapping and filter tests pass.

---

### Task 4: Implement Gmail IMAP service

**Files:**
- Create: `src/imapService.js`
- Create: `test/imapService.test.js`

**Step 1: Write unit tests around pure helpers**

Avoid requiring real Gmail in automated tests. Test:

- message summaries are shaped as `{ subject, from, date, text }`
- self-sent messages are filtered when read location is `all`
- merged trash results are sorted newest first and limited

**Step 2: Implement IMAP fetch**

`src/imapService.js` should export:

```js
testConnection(account)
fetchMessages(account, options)
```

Behavior:

- connect to Gmail via global IMAP config
- auth with `account.gmail_email` and `account.gmail_app_password`
- open mapped mailbox target(s)
- fetch newest messages first
- parse message body with `mailparser`
- return at most `limit` summaries
- do not persist message content

**Step 3: Authentication error classification**

Return or throw typed errors:

```text
AUTH_FAILED
IMAP_ERROR
```

**Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: helper tests pass. Real Gmail fetch remains manual.

---

### Task 5: Build admin authentication

**Files:**
- Create: `src/auth.js`
- Modify: `src/server.js`
- Create: `test/auth.test.js`

**Step 1: Write auth tests**

Test:

- unauthenticated request to `/accounts` redirects to `/login`
- wrong password fails
- correct password sets session cookie

**Step 2: Implement simple signed-cookie session**

Use `cookie-parser` and `SESSION_SECRET`.

**Step 3: Add routes**

```text
GET /login
POST /login
POST /logout
```

**Step 4: Run tests**

Run:

```powershell
npm test
```

Expected: auth tests pass.

---

### Task 6: Build account UI and routes

**Files:**
- Create: `src/server.js`
- Create: `src/views.js`
- Create: `public/styles.css`

**Step 1: Implement server setup**

Express app should:

- parse forms
- serve static CSS
- require auth for account pages
- initialize database on start

**Step 2: Implement account pages**

Routes:

```text
GET /
GET /accounts
POST /accounts
GET /accounts/:id/edit
POST /accounts/:id
POST /accounts/:id/delete
```

**Step 3: Display plain-text fields**

Account list shows:

```text
Gmail
Gmail password
2FA
App Password
Status
Last fetch
Last error
```

**Step 4: Run app**

Run:

```powershell
npm start
```

Expected:

```text
Listening on http://localhost:3000
```

---

### Task 7: Add fetch/test operations

**Files:**
- Modify: `src/server.js`
- Modify: `src/views.js`
- Modify: `src/accounts.js`

**Step 1: Add form controls**

Each account row should include:

```text
读取位置: 收件箱 / 全部邮件 / 垃圾箱
数量: 5
[获取邮件]
[测试连接]
```

**Step 2: Implement routes**

```text
POST /accounts/:id/test
POST /accounts/:id/fetch
```

**Step 3: Update account status**

On success:

```text
status = active
last_fetch_status = success
last_error = null
```

On auth failure:

```text
status = auth_failed
last_fetch_status = failed
last_error = short auth error
```

On other failure:

```text
status = error
last_fetch_status = failed
last_error = short error
```

**Step 4: Render fetch results**

Show:

```text
Subject
From
Date
Preview
Source mailbox
```

Do not save fetched emails.

---

### Task 8: Manual Gmail verification

**Files:**
- Modify if needed based on manual testing findings.

**Step 1: Create `.env`**

Copy `.env.example` to `.env` and set:

```env
ADMIN_PASSWORD=your-local-admin-password
SESSION_SECRET=random-local-string
```

**Step 2: Start app**

Run:

```powershell
npm start
```

**Step 3: Add a Gmail account**

Use:

```text
gmail_email
gmail_password
gmail_2fa
gmail_app_password
```

**Step 4: Test connection**

Expected: account status becomes `active`.

**Step 5: Fetch inbox**

Expected: latest 5 inbox messages are displayed.

**Step 6: Fetch all mail**

Expected: latest 5 non-self-sent all-mail messages are displayed.

**Step 7: Fetch trash box**

Expected: latest messages from Spam and Trash are merged and displayed.

