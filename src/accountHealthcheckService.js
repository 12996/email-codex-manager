import { fetchReplacementEmailMessages } from './replacementEmailApiService.js';

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

  const recipients = messageRecipients(message);
  return (text.includes(email) || recipients.includes(email))
    && text.includes('your account has been deactivated')
    && (
      text.includes('violated our terms and usage policies')
      || text.includes('this means your account can no longer be used')
    );
}

export async function runBannedEmailHealthcheck({
  replacementAccounts,
  emailApiService = { fetchMessages: fetchReplacementEmailMessages },
  onProgress,
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  const queryable = candidates.filter(hasEmailCodeApi);
  const skipped = candidates.filter((account) => !hasEmailCodeApi(account));
  reportProgress(onProgress, {
    type: 'start',
    operation: 'healthcheck-banned',
    total: candidates.length,
    checked: queryable.length,
    skipped: skipped.length,
    message: `开始一键验活：符合状态 ${candidates.length} 个，已配置 email_code_api ${queryable.length} 个，跳过 ${skipped.length} 个`,
  });
  const result = {
    checked: queryable.length,
    skipped: skipped.length,
    banned: 0,
    clean: 0,
    failed: 0,
    bannedAccounts: [],
    cleanAccounts: [],
    failedAccounts: [],
    skippedAccounts: skipped.map((account) => ({ id: account.id, email: account.email })),
  };

  for (const account of skipped) {
    reportProgress(onProgress, {
      type: 'account-result',
      operation: 'healthcheck-banned',
      id: account.id,
      email: account.email,
      outcome: 'skipped',
      status: account.status,
      message: '跳过验活：未配置 email_code_api',
    });
  }

  for (const [index, account] of queryable.entries()) {
    reportProgress(onProgress, {
      type: 'account-start',
      operation: 'healthcheck-banned',
      index: index + 1,
      total: queryable.length,
      id: account.id,
      email: account.email,
      message: `开始验活（${index + 1}/${queryable.length}）`,
    });
    try {
      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'healthcheck-banned',
        id: account.id,
        email: account.email,
        message: `正在读取邮箱 API：${displayEmailApi(account.email_code_api)}`,
      });

      const messages = await emailApiService.fetchMessages(account, {
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function messageRecipients(message) {
  return [
    ...(message?.toAddresses || []),
    ...(message?.ccAddresses || []),
    ...(message?.deliveredToAddresses || []),
    ...(message?.recipients || []),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
}

function hasEmailCodeApi(account) {
  return Boolean(String(account?.email_code_api || '').trim());
}

function displayEmailApi(apiUrl) {
  try {
    const url = new URL(String(apiUrl));
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return String(apiUrl || '').trim();
  }
}

function reportProgress(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(event);
  } catch {
    // Progress reporting must not interrupt the account check itself.
  }
}
