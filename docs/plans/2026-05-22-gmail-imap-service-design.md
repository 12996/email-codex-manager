# Gmail IMAP Service Design

## Goal

Build a local web service for managing Gmail accounts and fetching recent Gmail messages through IMAP.

## Confirmed Requirements

- Local-only service.
- Admin area is protected by one backend login password.
- After entering the admin area, Gmail account fields can be shown and edited in plain text.
- Database stores Gmail account metadata, including:
  - Gmail address
  - Gmail login password
  - Gmail 2FA value
  - Gmail App Password
- IMAP fetching uses only:
  - Gmail address
  - Gmail App Password
- Google login password and 2FA are stored for user convenience, but are not needed for IMAP.
- Emails are not stored in the database.
- Clicking an account operation fetches messages from Gmail live.
- Fetch limit defaults to 5 messages to avoid slow pulls.
- Supported read locations:
  - Inbox
  - All mail
  - Trash box
- Sent mail is not a separate option.
- "All mail" should exclude messages sent by the same Gmail account.
- "Trash box" is a UI-level merged option backed by Gmail Spam and Trash folders.

## Architecture

Use a simple local web app:

- Node.js HTTP service.
- SQLite local database.
- Server-rendered or static admin page.
- IMAP client for live Gmail reads.
- Session/cookie login for admin access.

## Global Configuration

These values are global config, not per-account database fields:

```env
ADMIN_PASSWORD=change-me
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
MAIL_FETCH_LIMIT=5
DEFAULT_READ_LOCATION=inbox
```

## Database Design

Table: `email_accounts`

```sql
CREATE TABLE email_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT,
  gmail_email TEXT NOT NULL,
  gmail_password TEXT NOT NULL,
  gmail_2fa TEXT NOT NULL,
  gmail_app_password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_fetch_at TEXT,
  last_fetch_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Status values:

```text
active
disabled
auth_failed
error
```

Fetch status values:

```text
idle
fetching
success
failed
```

No email content table is needed.

## Read Location Mapping

UI label to IMAP behavior:

```text
收件箱 = INBOX
全部邮件 = [Gmail]/All Mail, then filter out messages where From is the account itself
垃圾箱 = merge [Gmail]/Spam and [Gmail]/Trash
```

The exact Gmail folder names can vary by account language/settings. The implementation should first use Gmail special-use attributes when available, and fall back to common names above.

## UI Design

Admin login page:

```text
Password: [____________]
[Login]
```

Account list:

```text
[Add Account]

Actions                              Gmail              Password  2FA  App Password  Status  Last Fetch
[Fetch] [Test] [Edit] [Delete]       user@gmail.com     ...       ...  ...           active  ...
```

Fetch controls:

```text
Read location: [收件箱 | 全部邮件 | 垃圾箱]
Limit: [5]
```

Fetch result is displayed on the page but not persisted:

```text
Subject
From
Date
Snippet / text body preview
```

## API Design

```text
POST /login
POST /logout

GET  /
GET  /accounts
POST /accounts
GET  /accounts/:id/edit
POST /accounts/:id
POST /accounts/:id/delete

POST /accounts/:id/test
POST /accounts/:id/fetch
```

`POST /accounts/:id/fetch` request:

```json
{
  "readLocation": "inbox",
  "limit": 5
}
```

Allowed `readLocation` values:

```text
inbox
all
trash
```

## Error Handling

- Authentication failure:
  - Set `status = auth_failed`.
  - Set `last_fetch_status = failed`.
  - Save short error message in `last_error`.
- Network or Gmail temporary error:
  - Set `status = error`.
  - Set `last_fetch_status = failed`.
  - Save short error message in `last_error`.
- Successful fetch:
  - Set `status = active`.
  - Set `last_fetch_status = success`.
  - Clear `last_error`.

## Testing Approach

- Unit-test read-location mapping.
- Unit-test account form validation.
- Unit-test "all mail excludes self-sent" filter.
- Integration-test account CRUD with SQLite.
- Manual-test Gmail IMAP fetch with a real App Password.

