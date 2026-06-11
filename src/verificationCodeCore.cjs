const CODE_FIELD_NAMES = new Set([
  'code',
  'otp',
  'verification_code',
  'verificationCode',
  'verificationcode',
  'one_time_code',
  'oneTimeCode',
]);

function extractVerificationCode(payload) {
  if (payload == null) {
    return null;
  }

  if (typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    const fromFields = extractFromJsonFields(payload);
    if (fromFields) return fromFields;

    const candidates = [
      payload.bodyText,
      htmlToText(payload.bodyHtml),
      payload.subject,
      payload.text,
      payload.html ? htmlToText(payload.html) : '',
    ];
    return findFirstSixDigitCode(candidates);
  }

  const text = String(payload);
  const parsed = tryParseJson(text);
  if (parsed) {
    const fromJson = extractVerificationCode(parsed);
    if (fromJson) return fromJson;
  }
  return findFirstSixDigitCode([htmlToText(text)]);
}

function extractFromJsonFields(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return null;
  }
  seen.add(value);

  for (const [key, fieldValue] of Object.entries(value)) {
    if (CODE_FIELD_NAMES.has(key)) {
      const code = findFirstSixDigitCode([fieldValue]);
      if (code) return code;
    }
  }

  for (const fieldValue of Object.values(value)) {
    if (fieldValue && typeof fieldValue === 'object') {
      const nested = extractFromJsonFields(fieldValue, seen);
      if (nested) return nested;
    }
  }
  return null;
}

function htmlToText(input) {
  return String(input || '')
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (entity, codePoint) => decodeHtmlCodePoint(entity, Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (entity, codePoint) => decodeHtmlCodePoint(entity, parseInt(codePoint, 16)));
}

function decodeHtmlCodePoint(entity, codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return ' ';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return ' ';
  }
}

function findFirstSixDigitCode(candidates) {
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/(?<!\d)\d{6}(?!\d)/);
    if (match) return match[0];
  }
  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = {
  extractVerificationCode,
  htmlToText,
};
