import crypto from 'node:crypto';

function createTotpError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeAlgorithm(value) {
  const algorithm = String(value || 'sha1').toLowerCase();
  if (!['sha1', 'sha256', 'sha512'].includes(algorithm)) {
    throw createTotpError('TOTP_ALGORITHM_INVALID', 'TOTP algorithm must be sha1, sha256, or sha512');
  }
  return algorithm;
}

export function base32ToBuffer(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(secret || '').toUpperCase().replace(/[\s=-]+/g, '');
  if (!clean) {
    throw createTotpError('TOTP_SECRET_REQUIRED', 'TOTP secret is required');
  }

  let bits = '';
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      throw createTotpError('TOTP_SECRET_INVALID', 'TOTP secret is not valid Base32');
    }
    bits += value.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateHotpCode(secret, options = {}) {
  const digits = normalizePositiveInteger(options.digits, 6);
  const algorithm = normalizeAlgorithm(options.algorithm);
  const counter = Number(options.counter || 0);
  const key = Buffer.isBuffer(secret) ? secret : base32ToBuffer(secret);
  const counterBuffer = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;
  counterBuffer.writeUInt32BE(high, 0);
  counterBuffer.writeUInt32BE(low, 4);

  const hmac = crypto.createHmac(algorithm, key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function normalizeTotpOptions(options = {}) {
  return {
    step: normalizePositiveInteger(options.step ?? options.stepSeconds, 30),
    digits: normalizePositiveInteger(options.digits, 6),
    algorithm: normalizeAlgorithm(options.algorithm),
    timestampMs: Number.isFinite(Number(options.timestampMs)) ? Number(options.timestampMs) : Date.now(),
  };
}

export function generateTotpCode(secret, options = {}) {
  const normalized = normalizeTotpOptions(options);
  const counter = Math.floor(Math.floor(normalized.timestampMs / 1000) / normalized.step);
  return generateHotpCode(secret, { ...normalized, counter });
}

export function getTotpCodeInfo(secret, options = {}) {
  const normalized = normalizeTotpOptions(options);
  const epochSeconds = Math.floor(normalized.timestampMs / 1000);
  return {
    code: generateTotpCode(secret, normalized),
    expiresIn: normalized.step - (epochSeconds % normalized.step),
    step: normalized.step,
    digits: normalized.digits,
    algorithm: normalized.algorithm,
  };
}
