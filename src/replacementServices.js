import { codedError } from './replacementAccounts.js';

export function createReplacementServices({
  fetchImpl = fetch,
  replacementAutomation = null,
} = {}) {
  return {
    async fetchSmsCode(smsApi) {
      const url = normalizeUrl(smsApi, 'SMS_API_REQUIRED', 'sms_api is required');
      const response = await fetchImpl(url);
      const text = await response.text();
      if (!response.ok) {
        throw codedError('SMS_FETCH_FAILED', `SMS API returned ${response.status}`);
      }
      return extractSmsCode(text);
    },

    async fetchJson(url) {
      const normalizedUrl = normalizeUrl(url, 'JSON_URL_REQUIRED', 'url is required');
      const response = await fetchImpl(normalizedUrl);
      const text = await response.text();
      if (!response.ok) {
        throw codedError('JSON_FETCH_FAILED', `JSON API returned ${response.status}`);
      }

      try {
        JSON.parse(text);
      } catch {
        throw codedError('JSON_FETCH_FAILED', 'JSON API returned invalid JSON');
      }

      return text;
    },

    async replaceAccount(account) {
      if (!replacementAutomation?.replaceAccount) {
        throw codedError('REPLACE_NOT_CONFIGURED', 'replacement automation is not configured');
      }
      return replacementAutomation.replaceAccount(account);
    },
  };
}

export function extractSmsCode(text) {
  const raw = String(text || '');
  try {
    const parsed = JSON.parse(raw);
    const directCode = normalizeCode(parsed?.code);
    if (directCode) return directCode;
    const nestedCode = normalizeCode(parsed?.data?.code);
    if (nestedCode) return nestedCode;
  } catch {
    // Non-JSON SMS providers are supported by scanning the response text.
  }

  const match = raw.match(/\b\d{6}\b/);
  if (match) return match[0];

  throw codedError('SMS_FETCH_FAILED', 'verification code not found');
}

function normalizeUrl(value, code, message) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw codedError(code, message);
  }
  return normalized;
}

function normalizeCode(value) {
  const normalized = String(value || '').trim();
  return /^\d{6}$/.test(normalized) ? normalized : null;
}
