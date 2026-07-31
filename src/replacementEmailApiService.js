import { htmlToText } from './verificationCodeService.js';

const DEFAULT_EMAIL_API_TIMEOUT_MS = 15000;

export async function fetchReplacementEmailMessages(account, {
  fetchImpl = globalThis.fetch,
  targetEmail = account?.email,
  timeoutMs = DEFAULT_EMAIL_API_TIMEOUT_MS,
} = {}) {
  const apiUrl = String(account?.email_code_api || '').trim();
  if (!apiUrl) {
    throw new Error('未配置 email_code_api');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持请求邮箱 API');
  }

  let response;
  try {
    const requestUrl = new URL(apiUrl);
    requestUrl.searchParams.set('limit', '5');
    response = await fetchImpl(requestUrl.toString(), {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, text/html',
      },
      signal: AbortSignal.timeout(normalizeTimeout(timeoutMs)),
    });
  } catch (error) {
    throw new Error(`邮箱 API 请求失败：${error?.message || '网络请求失败'}`);
  }

  if (!response || response.ok === false) {
    throw new Error(`邮箱 API 请求失败：HTTP ${response?.status || 'unknown'}`);
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch (error) {
    throw new Error(`邮箱 API 响应读取失败：${error?.message || '无法读取响应'}`);
  }

  const payload = parsePayload(responseText);
  const messages = collectMessages(payload, { targetEmail });
  if (!messages.length) {
    throw new Error('邮箱 API 未返回完整邮件内容');
  }
  return messages;
}

function parsePayload(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^[\[{]/.test(text)) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function collectMessages(value, { targetEmail, depth = 0 } = {}) {
  if (value == null || depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectMessages(entry, { targetEmail, depth: depth + 1 }));
  }
  if (typeof value === 'string') {
    return value.trim() ? [normalizeMessage({ body: value }, targetEmail)] : [];
  }
  if (typeof value !== 'object') return [];

  for (const key of ['messages', 'emails', 'mails', 'data', 'mail', 'message', 'result']) {
    if (!Object.hasOwn(value, key)) continue;
    const nested = collectMessages(value[key], { targetEmail, depth: depth + 1 });
    if (nested.length) return nested;
  }

  return isMessageLike(value) ? [normalizeMessage(value, targetEmail)] : [];
}

function isMessageLike(value) {
  return [
    'subject',
    'body',
    'bodyText',
    'bodyHtml',
    'html',
    'text',
    'preview',
    'content',
  ].some((key) => String(value[key] || '').trim());
}

function normalizeMessage(value, targetEmail) {
  const rawBody = firstNonEmpty(value.body, value.content);
  const bodyHtml = firstNonEmpty(value.bodyHtml, value.html)
    || (looksLikeHtml(rawBody) ? rawBody : '');
  const bodyText = firstNonEmpty(value.bodyText, value.text)
    || (bodyHtml ? stripHtml(bodyHtml) : (looksLikeHtml(rawBody) ? stripHtml(rawBody) : rawBody));
  const explicitRecipients = normalizeAddressList(
    value.toAddresses || value.to || value.recipient || value.recipients,
  );
  const fallbackRecipient = normalizeEmail(value.email);
  const toAddresses = explicitRecipients.length
    ? explicitRecipients
    : fallbackRecipient.includes('@')
      ? [fallbackRecipient]
      : normalizeEmail(targetEmail).includes('@')
        ? [normalizeEmail(targetEmail)]
        : [];

  return {
    subject: firstNonEmpty(value.subject, value.title),
    from: firstNonEmpty(value.from, value.sender),
    fromAddress: normalizeEmail(value.fromAddress || value.from_email || value.sender_email),
    toAddresses,
    ccAddresses: normalizeAddressList(value.ccAddresses || value.cc),
    deliveredToAddresses: normalizeAddressList(value.deliveredToAddresses || value.delivered_to),
    date: firstNonEmpty(value.date, value.received_at, value.receivedAt, value.created_at),
    preview: firstNonEmpty(value.preview) || String(bodyText || '').slice(0, 240),
    bodyText: bodyText || '',
    bodyHtml: bodyHtml || '',
    messageId: firstNonEmpty(value.messageId, value.message_id),
  };
}

function normalizeAddressList(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry || '').split(','))
    .map((entry) => {
      const match = entry.match(/<([^>]+)>/);
      return normalizeEmail(match ? match[1] : entry);
    })
    .filter((entry) => entry.includes('@'));
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || '').trim()).find(Boolean) || '';
}

function looksLikeHtml(value) {
  return /<\/?[a-z][^>]*>/i.test(String(value || ''));
}

function stripHtml(value) {
  return htmlToText(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTimeout(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_EMAIL_API_TIMEOUT_MS;
}
