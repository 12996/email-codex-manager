import { deriveMainGmailAccount } from './imapService.js';

const ELIGIBLE_BANNED_HEALTHCHECK_STATUSES = new Set([
  'plus_active',
  'cpa_mounted',
  'for_sale',
  'sold',
]);

const HEALTHCHECK_STATUS_NOTE = '一键验活检测到 ChatGPT deactivation 邮件';

export function messageIndicatesChatGptDeactivation(message, targetEmail) {
  const email = normalizeEmail(targetEmail);
  if (!email) return false;
  const text = [
    message?.subject,
    message?.preview,
    message?.bodyText,
    message?.bodyHtml,
  ].join('\n').toLowerCase();

  return text.includes(email)
    && text.includes('your account has been deactivated')
    && (
      text.includes('violated our terms and usage policies')
      || text.includes('this means your account can no longer be used')
    );
}

export async function runBannedEmailHealthcheck({
  accounts,
  replacementAccounts,
  mailService,
  icloudCodeDefaultGmailAccount = '',
  onProgress,
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  reportProgress(onProgress, {
    type: 'start',
    operation: 'healthcheck-banned',
    total: candidates.length,
    message: `开始一键验活，共 ${candidates.length} 个账号`,
  });
  const result = {
    checked: candidates.length,
    banned: 0,
    clean: 0,
    failed: 0,
    bannedAccounts: [],
    cleanAccounts: [],
    failedAccounts: [],
  };

  for (const [index, account] of candidates.entries()) {
    reportProgress(onProgress, {
      type: 'account-start',
      operation: 'healthcheck-banned',
      index: index + 1,
      total: candidates.length,
      id: account.id,
      email: account.email,
      message: `开始验活（${index + 1}/${candidates.length}）`,
    });
    try {
      const mailboxEmail = mailboxEmailForAccount(account.email, icloudCodeDefaultGmailAccount);
      const mailbox = accounts.getAccountByGmailEmail(deriveMainGmailAccount(mailboxEmail));
      if (!mailbox) {
        throw new Error(`未配置验活收件箱：${mailboxEmail}`);
      }

      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'healthcheck-banned',
        id: account.id,
        email: account.email,
        message: `正在读取收件箱：${mailboxEmail}`,
      });

      const messages = await mailService.fetchMessages(mailbox, {
        readLocation: 'inbox',
        limit: 5,
        targetEmail: account.email,
      });
      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'healthcheck-banned',
        id: account.id,
        email: account.email,
        message: `已读取 ${messages.length} 封邮件，正在匹配封禁文案`,
      });
      const matched = messages.find((message) => messageIndicatesChatGptDeactivation(message, account.email));
      if (matched) {
        const updated = replacementAccounts.markBannedByHealthcheck(account.id, HEALTHCHECK_STATUS_NOTE);
        result.banned += 1;
        result.bannedAccounts.push({
          id: updated.id,
          email: updated.email,
          subject: matched.subject || '',
          date: matched.date || '',
        });
        reportProgress(onProgress, {
          type: 'account-result',
          operation: 'healthcheck-banned',
          id: account.id,
          email: account.email,
          outcome: 'banned',
          status: 'banned',
          message: '命中封禁邮件，状态已改为 banned',
        });
        continue;
      }

      result.clean += 1;
      result.cleanAccounts.push({ id: account.id, email: account.email });
      reportProgress(onProgress, {
        type: 'account-result',
        operation: 'healthcheck-banned',
        id: account.id,
        email: account.email,
        outcome: 'clean',
        status: account.status,
        message: '未命中封禁邮件，状态保持不变',
      });
    } catch (error) {
      result.failed += 1;
      result.failedAccounts.push({
        id: account.id,
        email: account.email,
        message: error.message || '验活失败',
      });
      reportProgress(onProgress, {
        type: 'account-result',
        operation: 'healthcheck-banned',
        id: account.id,
        email: account.email,
        outcome: 'failed',
        status: account.status,
        message: `查询失败：${error.message || '验活失败'}`,
      });
    }
  }

  return result;
}

export function isBannedHealthcheckEligibleStatus(status) {
  return ELIGIBLE_BANNED_HEALTHCHECK_STATUSES.has(String(status || '').trim());
}

function listCandidates(replacementAccounts) {
  if (replacementAccounts?.listBannedHealthcheckCandidates) {
    return replacementAccounts.listBannedHealthcheckCandidates();
  }
  return (replacementAccounts?.listAccounts?.() || [])
    .filter((account) => isBannedHealthcheckEligibleStatus(account.status));
}

function mailboxEmailForAccount(email, icloudCodeDefaultGmailAccount) {
  const normalized = normalizeEmail(email);
  if (normalized.endsWith('@icloud.com')) {
    const mailbox = normalizeEmail(icloudCodeDefaultGmailAccount);
    if (!mailbox) throw new Error('未配置 iCloud 验活 Gmail 收件箱');
    return mailbox;
  }
  return deriveMainGmailAccount(normalized);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function reportProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch {
    // Progress reporting must not interrupt the account check itself.
  }
}
