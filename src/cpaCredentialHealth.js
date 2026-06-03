const AUTH_EXPIRED_PATTERN = /authentication_error|auth_unavailable|expired|invalidated|invalid token|unauthorized|refresh|login|token/i;
const QUOTA_LIMIT_PATTERN = /usage_limit_reached|usage limit|quota/i;
const HEALTHY_STATUSES = new Set(['ready', 'active']);

export function buildCredentialKey(file) {
  const provider = String(file?.provider || '').trim().toLowerCase();
  const email = String(file?.email || '').trim().toLowerCase();
  return `${provider}:${email}`;
}

export function classifyCpaAuthFile(file) {
  const reasons = [];
  const message = String(file?.status_message || '').trim();
  const isQuotaLimited = Boolean(file?.next_retry_after) || QUOTA_LIMIT_PATTERN.test(message);
  const isAuthExpired = AUTH_EXPIRED_PATTERN.test(message) && !isQuotaLimited;
  const status = String(file?.status || '').trim();

  if (isQuotaLimited) reasons.push('quota_limited');
  if (status === 'banned') reasons.push('banned');
  if (file?.disabled === true) reasons.push('disabled');
  if (file?.unavailable === true) reasons.push('unavailable');

  if (status && !HEALTHY_STATUSES.has(status)) {
    reasons.push(`status:${status}`);
  }

  if (isAuthExpired) {
    reasons.push('message:auth_expired');
  }

  const category = determineCategory({ file, reasons, isQuotaLimited, isAuthExpired });
  return {
    healthy: reasons.length === 0,
    category,
    reasons,
  };
}

function determineCategory({ file, reasons, isQuotaLimited, isAuthExpired }) {
  if (reasons.length === 0) return 'healthy';
  if (isQuotaLimited) return 'quota_limited';
  if (reasons.includes('banned') || String(file?.status || '').trim() === 'banned') return 'banned';
  if (file?.disabled === true || String(file?.status || '').trim() === 'disabled') return 'disabled';
  if (isAuthExpired) return 'auth_expired';
  return 'unknown_error';
}
