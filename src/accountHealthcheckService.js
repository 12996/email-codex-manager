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
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  const result = {
    checked: candidates.length,
    banned: 0,
    clean: 0,
    failed: 0,
    bannedAccounts: [],
    cleanAccounts: [],
    failedAccounts: [],
  };

  for (const account of candidates) {
    try {
      const mailboxEmail = mailboxEmailForAccount(account.email, icloudCodeDefaultGmailAccount);
      const mailbox = accounts.getAccountByGmailEmail(deriveMainGmailAccount(mailboxEmail));
      if (!mailbox) {
        throw new Error(`未配置验活收件箱：${mailboxEmail}`);
      }

      const messages = await mailService.fetchMessages(mailbox, {
        readLocation: 'inbox',
        limit: 5,
        targetEmail: account.email,
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
        continue;
      }

      result.clean += 1;
      result.cleanAccounts.push({ id: account.id, email: account.email });
    } catch (error) {
      result.failed += 1;
      result.failedAccounts.push({
        id: account.id,
        email: account.email,
        message: error.message || '验活失败',
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
