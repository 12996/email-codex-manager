import { fetchReplacementEmailMessages } from './replacementEmailApiService.js';
import { htmlToText } from './verificationCodeService.js';

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
  replacementAccounts,
  emailApiService = { fetchMessages: fetchReplacementEmailMessages },
  onProgress,
} = {}) {
  const candidates = listCandidates(replacementAccounts);
  const queryable = candidates.filter(hasEmailCodeApi);
  const skipped = candidates.filter((account) => !hasEmailCodeApi(account));
  reportProgress(onProgress, {
    type: 'start',
    operation: 'check-plus-status',
    total: candidates.length,
    checked: queryable.length,
    skipped: skipped.length,
    message: `开始查询 Plus 状态：已注册 ${candidates.length} 个，已配置 email_code_api ${queryable.length} 个，跳过 ${skipped.length} 个`,
  });
  const result = {
    checked: queryable.length,
    skipped: skipped.length,
    plus: 0,
    registered: 0,
    failed: 0,
    plusAccounts: [],
    registeredAccounts: [],
    failedAccounts: [],
    skippedAccounts: skipped.map((account) => ({ id: account.id, email: account.email })),
  };

  for (const account of skipped) {
    reportProgress(onProgress, {
      type: 'account-result',
      operation: 'check-plus-status',
      id: account.id,
      email: account.email,
      outcome: 'skipped',
      status: account.status,
      message: '跳过查询：未配置 email_code_api',
    });
  }

  for (const [index, account] of queryable.entries()) {
    reportProgress(onProgress, {
      type: 'account-start',
      operation: 'check-plus-status',
      index: index + 1,
      total: queryable.length,
      id: account.id,
      email: account.email,
      message: `开始查询（${index + 1}/${queryable.length}）`,
    });
    try {
      reportProgress(onProgress, {
        type: 'account-step',
        operation: 'check-plus-status',
        id: account.id,
        email: account.email,
        message: `正在读取邮箱 API：${displayEmailApi(account.email_code_api)}（账号邮箱：${account.email}）`,
      });

      const messages = (await emailApiService.fetchMessages(account, {
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

function normalizeMessageText(message) {
  return [
    message?.subject,
    message?.preview,
    message?.bodyText,
    message?.bodyHtml,
    htmlToText(message?.bodyHtml),
    message?.body,
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
    ...(message?.recipients || []),
  ]
    .map(normalizeEmail)
    .filter(Boolean);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
    // Progress reporting must not interrupt the account status check.
  }
}
