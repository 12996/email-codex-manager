import { simpleParser } from 'mailparser';
import { ImapFlow } from 'imapflow';

import { config } from './config.js';
import {
  isSelfSentMessage,
  normalizeFetchLimit,
  resolveReadLocation,
} from './readLocations.js';

export async function testConnection(account) {
  const client = createClient(account);
  try {
    await client.connect();
  } catch (error) {
    throw createTypedImapError(error);
  } finally {
    await safelyLogout(client);
  }
}

export async function fetchMessages(account, options = {}) {
  const readLocation = resolveReadLocation(options.readLocation || config.defaultReadLocation);
  const limit = normalizeFetchLimit(options.limit, config.mailFetchLimit);
  const targetEmail = options.targetEmail || account.gmail_email;
  const client = createClient(account);
  const summaries = [];

  try {
    await client.connect();
    const mailboxes = await getMailboxMap(client);

    for (const target of readLocation.targets) {
      const mailboxPath = findMailboxPath(mailboxes, target);
      if (!mailboxPath) {
        continue;
      }

      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const status = await client.status(mailboxPath, { messages: true });
        const lastSequence = Number(status.messages || 0);
        if (lastSequence < 1) {
          continue;
        }

        const fetchStart = Math.max(1, lastSequence - limit * 3 + 1);
        for await (const message of client.fetch(`${fetchStart}:*`, { uid: true, source: true, envelope: true })) {
          const parsed = await simpleParser(message.source);
          const summary = createMessageSummary({
            parsed,
            sourceMailbox: mailboxPath,
            uid: message.uid,
          });
          if (shouldIncludeMessage(summary, targetEmail, readLocation.filterSelfSent)) {
            summaries.push(summary);
          }
        }
      } finally {
        lock.release();
      }
    }

    return mergeSortAndLimitMessages(summaries, limit);
  } catch (error) {
    throw createTypedImapError(error);
  } finally {
    await safelyLogout(client);
  }
}

export function createMessageSummary({ parsed, sourceMailbox, uid }) {
  const fromValue = parsed.from?.value?.[0];
  const date = parsed.date instanceof Date ? parsed.date : null;
  const fallbackText = parsed.text || stripHtml(parsed.html || '');
  return {
    uid,
    sourceMailbox,
    subject: parsed.subject || '(无主题)',
    from: parsed.from?.text || '',
    fromAddress: fromValue?.address || '',
    toAddresses: extractAddressList(parsed.to),
    ccAddresses: extractAddressList(parsed.cc),
    deliveredToAddresses: extractHeaderAddresses(parsed.headers, [
      'delivered-to',
      'x-original-to',
      'envelope-to',
    ]),
    date: date ? date.toISOString() : '',
    preview: normalizePreview(fallbackText),
    bodyText: normalizeBodyText(fallbackText),
    bodyHtml: sanitizeEmailHtml(parsed.html || ''),
    messageId: parsed.messageId || '',
  };
}

export function shouldIncludeMessage(message, gmailEmail, filterSelfSent) {
  if (filterSelfSent) {
    const mainAccount = deriveMainGmailAccount(gmailEmail);
    if (isSelfSentMessage(message, gmailEmail) || isSelfSentMessage(message, mainAccount)) {
      return false;
    }
  }
  return messageMatchesRecipientAlias(message, gmailEmail);
}

export function mergeSortAndLimitMessages(messages, limit) {
  return [...messages]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, limit);
}

export function classifyImapError(error) {
  const message = [
    error?.message,
    error?.responseText,
    error?.serverResponseCode,
    String(error?.response || ''),
    String(error || ''),
  ].join(' ').toLowerCase();
  if (
    error?.authenticationFailed ||
    String(error?.serverResponseCode || '').toUpperCase() === 'AUTHENTICATIONFAILED' ||
    message.includes('authenticationfailed') ||
    message.includes('invalid credentials') ||
    message.includes('auth failed') ||
    message.includes('login failed')
  ) {
    return 'AUTH_FAILED';
  }
  return 'IMAP_ERROR';
}

export function toUserFacingImapError(error) {
  const code = classifyImapError(error);
  if (code === 'AUTH_FAILED') {
    return {
      code,
      message: 'Gmail 认证失败：请确认 Gmail 邮箱号正确、App Password 没有填错或被撤销，并确认 Gmail 已允许 IMAP。',
    };
  }
  return {
    code,
    message: error?.responseText || error?.message || 'IMAP 请求失败',
  };
}

export function normalizeAppPassword(value) {
  return String(value || '').replace(/\s+/g, '');
}

export function deriveMainGmailAccount(email) {
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

export function extractSixDigitCode(message) {
  const candidates = [
    message?.bodyText,
    stripHtml(message?.bodyHtml || ''),
    message?.subject,
  ];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/(?<!\d)\d{6}(?!\d)/);
    if (match) {
      return match[0];
    }
  }
  return null;
}

export function findLatestVerificationCode(messages) {
  const sorted = mergeSortAndLimitMessages(messages, Number.MAX_SAFE_INTEGER);
  for (const message of sorted) {
    const code = extractSixDigitCode(message);
    if (code) {
      return { code, message };
    }
  }
  return null;
}

function createClient(account) {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: deriveMainGmailAccount(account.gmail_email),
      pass: normalizeAppPassword(account.gmail_app_password),
    },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  client.on('error', () => {
    // Route command failures through awaited calls; avoid background socket errors crashing the local app.
  });
  return client;
}

function extractAddressList(addressObject) {
  return (addressObject?.value || [])
    .map((entry) => String(entry?.address || '').trim().toLowerCase())
    .filter(Boolean);
}

function extractHeaderAddresses(headers, names) {
  return names
    .flatMap((name) => {
      const value = headers?.get?.(name);
      return Array.isArray(value) ? value : [value];
    })
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function messageMatchesRecipientAlias(message, gmailEmail) {
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

function isGmailPlusAlias(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 1) {
    return false;
  }
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex + 1);
  return local.includes('+') && ['gmail.com', 'googlemail.com'].includes(domain);
}

async function getMailboxMap(client) {
  const mailboxes = await client.list();
  return mailboxes.map((mailbox) => ({
    path: mailbox.path,
    specialUse: mailbox.specialUse,
  }));
}

function findMailboxPath(mailboxes, target) {
  const bySpecialUse = mailboxes.find((mailbox) => mailbox.specialUse === specialUseForRole(target.role));
  if (bySpecialUse) {
    return bySpecialUse.path;
  }
  const byFallback = mailboxes.find((mailbox) => mailbox.path === target.fallbackPath);
  return byFallback?.path || target.fallbackPath;
}

function specialUseForRole(role) {
  return {
    inbox: '\\Inbox',
    all: '\\All',
    junk: '\\Junk',
    trash: '\\Trash',
  }[role];
}

function createTypedImapError(error) {
  const friendly = toUserFacingImapError(error);
  const typedError = new Error(friendly.message);
  typedError.code = friendly.code;
  typedError.cause = error;
  return typedError;
}

async function safelyLogout(client) {
  try {
    if (client?.usable) {
      await client.logout();
    } else if (client) {
      client.close();
    }
  } catch {
    try {
      client?.close();
    } catch {
      // Ignore close errors after failed connections.
    }
    // Ignore logout errors after failed connections.
  }
}

function normalizePreview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function normalizeBodyText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');
}

function sanitizeEmailHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
}
