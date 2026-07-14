import { deriveMainGmailAccount } from './imapService.js';

const PLUS_STATUS_CHECK_LIMIT = 30;
const PLUS_STATUS_NOTE = 'Plus 状态查询命中订阅邮件';
const PLUS_MARKERS = [
  "you've successfully subscribed to chatgpt plus",
  'chatgpt plus subscription',
  'the openai team',
];

export function messageIndicatesChatGptPlusSubscription(message, targetEmail) {
  const normalizedTarget = normalizeEmail(targetEmail);
  if (!normalizedTarget) return false;

  const text = normalizeMessageText(message);
  if (!PLUS_MARKERS.every((marker) => text.includes(marker))) {
    return false;
  }

  const recipients = messageRecipients(message);
  return recipients.length === 0 || recipients.includes(normalizedTarget);
}

export async function runPlusStatusCheck({
  accounts,
  replacementAccounts,
  mailService,
  icloudCodeDefaultGmailAccount = '',
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  const result = {
    checked: candidates.length,
    plus: 0,
    registered: 0,
    failed: 0,
    plusAccounts: [],
    registeredAccounts: [],
    failedAccounts: [],
  };

  for (const account of candidates) {
    try {
      const mailboxEmail = mailboxEmailForAccount(account.email, icloudCodeDefaultGmailAccount);
      const mailbox = accounts.getAccountByGmailEmail(deriveMainGmailAccount(mailboxEmail));
      if (!mailbox) {
        throw new Error(`未配置状态查询收件箱：${mailboxEmail}`);
      }

      const messages = await mailService.fetchMessages(mailbox, {
        readLocation: 'inbox',
        limit: PLUS_STATUS_CHECK_LIMIT,
        targetEmail: account.email,
      });
      const matched = (messages || []).find((message) => (
        messageIndicatesChatGptPlusSubscription(message, account.email)
      ));

      if (matched) {
        const updated = replacementAccounts.markPlusStatusDetected(account.id, PLUS_STATUS_NOTE);
        result.plus += 1;
        result.plusAccounts.push({
          id: updated.id,
          email: updated.email,
          subject: matched.subject || '',
          date: matched.date || '',
        });
        continue;
      }

      result.registered += 1;
      result.registeredAccounts.push({ id: account.id, email: account.email });
    } catch (error) {
      replacementAccounts.recordPlusStatusCheckFailure(account.id, error.message || '状态查询失败');
      result.failed += 1;
      result.failedAccounts.push({
        id: account.id,
        email: account.email,
        message: error.message || '状态查询失败',
      });
    }
  }

  return result;
}

export function isPlusStatusCheckEligibleStatus(status) {
  return String(status || '').trim() === 'registered';
}

function listCandidates(replacementAccounts) {
  if (replacementAccounts?.listPlusStatusCheckCandidates) {
    return replacementAccounts.listPlusStatusCheckCandidates();
  }
  return (replacementAccounts?.listAccounts?.() || [])
    .filter((account) => isPlusStatusCheckEligibleStatus(account.status));
}

function mailboxEmailForAccount(email, icloudCodeDefaultGmailAccount) {
  const normalized = normalizeEmail(email);
  if (normalized.endsWith('@icloud.com')) {
    const mailbox = normalizeEmail(icloudCodeDefaultGmailAccount);
    if (!mailbox) throw new Error('未配置 iCloud 状态查询 Gmail 收件箱');
    return mailbox;
  }
  return deriveMainGmailAccount(normalized);
}

function normalizeMessageText(message) {
  return [
    message?.subject,
    message?.preview,
    message?.bodyText,
    message?.bodyHtml,
  ].join('\n')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function messageRecipients(message) {
  return [
    ...(message?.toAddresses || []),
    ...(message?.ccAddresses || []),
    ...(message?.deliveredToAddresses || []),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
