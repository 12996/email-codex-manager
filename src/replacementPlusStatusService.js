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
  onProgress,
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  reportProgress(onProgress, {
    type: 'start',
    operation: 'check-plus-status',
    total: candidates.length,
    message: `开始查询 Plus 状态，共 ${candidates.length} 个已注册账号`,
  });
  const result = {
    checked: candidates.length,
    plus: 0,
    registered: 0,
    failed: 0,
    plusAccounts: [],
    registeredAccounts: [],
    failedAccounts: [],
  };

  for (const [index, account] of candidates.entries()) {
    reportProgress(onProgress, {
      type: 'account-start',
      operation: 'check-plus-status',
      index: index + 1,
      total: candidates.length,
      id: account.id,
      email: account.email,
      message: `开始查询（${index + 1}/${candidates.length}）`,
    });
    try {
      const mailboxEmail = mailboxEmailForAccount(account.email, icloudCodeDefaultGmailAccount);
      const mailbox = accounts.getAccountByGmailEmail(deriveMainGmailAccount(mailboxEmail));
      if (!mailbox) {
        throw new Error(`未配置状态查询收件箱：${mailboxEmail}`);
      }

      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'check-plus-status',
        id: account.id,
        email: account.email,
        message: `正在读取收件箱：${mailboxEmail}`,
      });

      const messages = (await mailService.fetchMessages(mailbox, {
        readLocation: 'inbox',
        limit: PLUS_STATUS_CHECK_LIMIT,
        targetEmail: account.email,
      })) || [];
      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'check-plus-status',
        id: account.id,
        email: account.email,
        message: `已读取 ${messages.length} 封邮件，正在匹配 Plus 订阅文案`,
      });
      const matched = messages.find((message) => (
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
        reportProgress(onProgress, {
          type: 'account-result',
          operation: 'check-plus-status',
          id: account.id,
          email: account.email,
          outcome: 'plus',
          status: 'plus_active',
          message: '命中 Plus 订阅邮件，状态已改为 plus_active',
        });
        continue;
      }

      result.registered += 1;
      result.registeredAccounts.push({ id: account.id, email: account.email });
      reportProgress(onProgress, {
        type: 'account-result',
        operation: 'check-plus-status',
        id: account.id,
        email: account.email,
        outcome: 'registered',
        status: 'registered',
        message: '未命中 Plus 订阅邮件，状态保持 registered',
      });
    } catch (error) {
      replacementAccounts.recordPlusStatusCheckFailure(account.id, error.message || '状态查询失败');
      result.failed += 1;
      result.failedAccounts.push({
        id: account.id,
        email: account.email,
        message: error.message || '状态查询失败',
      });
      reportProgress(onProgress, {
        type: 'account-result',
        operation: 'check-plus-status',
        id: account.id,
        email: account.email,
        outcome: 'failed',
        status: account.status,
        message: `查询失败：${error.message || '状态查询失败'}`,
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

function reportProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch {
    // Progress reporting must not interrupt the account status check.
  }
}
