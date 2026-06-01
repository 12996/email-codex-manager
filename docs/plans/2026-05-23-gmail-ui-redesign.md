# Gmail UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the admin UI so the account list uses a clear table layout and fetched emails render as a Gmail-style list with click-to-expand message details.

**Architecture:** Keep server-rendered HTML in `src/views.js` and styling in `public/styles.css`. Do not store emails; render the fetched result returned by the existing IMAP request. Use native `<details>/<summary>` for click-to-expand behavior without adding client JavaScript.

**Tech Stack:** Node.js, Express, server-rendered HTML, CSS, Node test runner.

---

### Task 1: Add view tests for the new account table

**Files:**
- Modify: `test/views.test.js`

**Steps:**
1. Add a failing test that expects account list markup to include `.table-container` and `.data-table`.
2. Add a failing test that expects the account list to include table headers for 操作, Gmail, Gmail 密码, 2FA, App Password, 状态, 上次获取, 最近错误.
3. Run `npm test` and verify the test fails before implementation.

### Task 2: Add view tests for Gmail-style fetched mail results

**Files:**
- Modify: `test/views.test.js`

**Steps:**
1. Add a failing test that renders `accountsPage` with a `result.messages` array.
2. Assert the result section appears after the account list section.
3. Assert mail results use `.gmail-mail-list`, `.gmail-mail-row`, and `<details>`.
4. Assert the summary contains sender, subject, snippet, and time.
5. Assert detail content is inside `.gmail-mail-detail`.
6. Run `npm test` and verify the test fails.

### Task 3: Implement account table markup

**Files:**
- Modify: `src/views.js`

**Steps:**
1. Replace account card rendering with:
   - `<div class="table-container">`
   - `<table class="data-table account-table">`
   - `<thead>` fixed labels.
   - `<tbody>` rows.
2. Keep existing account operations:
   - read location select
   - limit input
   - 获取邮件
   - 测试连接
   - 编辑
   - 删除
3. Run `npm test` and verify account table tests pass.

### Task 4: Implement Gmail-style mail result markup

**Files:**
- Modify: `src/views.js`

**Steps:**
1. Move result rendering below the account list section.
2. Replace full-body always-visible message cards with Gmail-like `<details class="gmail-mail-row">`.
3. Summary initially shows sender, subject, snippet, time, and source mailbox.
4. Detail shows title, sender, date, source, and body preview/content.
5. Run `npm test` and verify mail result tests pass.

### Task 5: Update CSS

**Files:**
- Modify: `public/styles.css`

**Steps:**
1. Add table styles based on the referenced project:
   - `.table-container`
   - `.data-table`
   - `th`
   - `td`
   - row hover
   - `.readonly-cell`
2. Add action layout styles so buttons stay aligned in the 操作 column.
3. Add Gmail-style mail list styles:
   - `.mail-result-panel`
   - `.gmail-mail-list`
   - `.gmail-mail-row`
   - `.gmail-mail-summary`
   - `.gmail-sender`
   - `.gmail-subject`
   - `.gmail-snippet`
   - `.gmail-time`
   - `.gmail-mail-detail`
4. Run `npm test`.

### Task 6: Verify

**Steps:**
1. Run `npm test`.
2. Start the service on a temporary port.
3. Login and fetch `/accounts`.
4. Verify the HTML contains `.data-table`, `.table-container`, and no `.account-card`.
5. Render a sample result via tests.

