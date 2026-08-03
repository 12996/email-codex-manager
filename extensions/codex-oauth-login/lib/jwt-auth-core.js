export const AGENT_IDENTITY_AUDIENCE = 'codex-app-server';
export const AGENT_IDENTITY_ISSUER = 'https://chatgpt.com/codex-backend/agent-identity';
export const AGENT_IDENTITY_JWKS_URL = 'https://chatgpt.com/backend-api/wham/agent-identities/jwks';

function createJwtError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64Url(value) {
  if (typeof value !== 'string' || !value || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw createJwtError('jwt_invalid_format');
  }
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw createJwtError('jwt_invalid_format');
  }
}

function parseJsonSegment(value) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (!isJsonObject(parsed)) {
      throw createJwtError('jwt_invalid_format');
    }
    return parsed;
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    throw createJwtError('jwt_invalid_format');
  }
}

function parseJwt(rawJwt) {
  const rawValue = String(rawJwt || '');
  if (/\r|\n/.test(rawValue)) {
    throw createJwtError('jwt_invalid_format');
  }
  const token = rawValue.trim();
  const parts = token.split('.');
  if (!token || parts.length !== 3 || parts.some(part => !part)) {
    throw createJwtError('jwt_invalid_format');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseJsonSegment(headerPart);
  const payload = parseJsonSegment(payloadPart);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) {
    throw createJwtError('jwt_invalid_format');
  }

  return {
    header,
    headerPart,
    payload,
    payloadPart,
    signaturePart,
  };
}

function getSigningJwk(jwks, kid) {
  const candidates = Array.isArray(jwks?.keys)
    ? jwks.keys.filter(jwk => jwk?.kid === kid && jwk.kty === 'RSA' && jwk.use === 'sig' && jwk.alg === 'RS256')
    : [];
  if (candidates.length !== 1) {
    throw createJwtError('jwt_signing_key_missing');
  }
  return candidates[0];
}

function requiredNonemptyString(value) {
  return typeof value === 'string' && value.trim();
}

function validateClaims(payload, nowMs) {
  const expiresAt = payload.exp * 1000;
  if (payload.iss !== AGENT_IDENTITY_ISSUER
    || payload.aud !== AGENT_IDENTITY_AUDIENCE
    || typeof payload.exp !== 'number'
    || !Number.isFinite(payload.exp)
    || typeof payload.iat !== 'number'
    || !Number.isFinite(payload.iat)
    || !Number.isFinite(expiresAt)
    || expiresAt <= nowMs
    || !requiredNonemptyString(payload.agent_runtime_id)
    || !requiredNonemptyString(payload.agent_private_key)
    || !requiredNonemptyString(payload.account_id)
    || !requiredNonemptyString(payload.chatgpt_user_id)
    || !requiredNonemptyString(payload.plan_type)
    || typeof payload.chatgpt_account_is_fedramp !== 'boolean') {
    throw createJwtError('jwt_claims_invalid');
  }

  return {
    email: requiredNonemptyString(payload.email) || null,
    plan: payload.plan_type.trim(),
  };
}

export function inspectJwtInput(rawJwt) {
  try {
    parseJwt(rawJwt);
    return { kind: 'valid-format' };
  } catch {
    return { kind: 'invalid-format' };
  }
}

export async function verifyAgentIdentityJwt({
  rawJwt,
  jwks,
  cryptoApi = globalThis.crypto,
  nowMs = Date.now(),
} = {}) {
  const parsed = parseJwt(rawJwt);
  const signingJwk = getSigningJwk(jwks, parsed.header.kid);
  let signatureValid;
  try {
    const publicKey = await cryptoApi.subtle.importKey(
      'jwk',
      signingJwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    signatureValid = await cryptoApi.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      decodeBase64Url(parsed.signaturePart),
      new TextEncoder().encode(`${parsed.headerPart}.${parsed.payloadPart}`),
    );
  } catch {
    throw createJwtError('jwt_signature_invalid');
  }
  if (!signatureValid) {
    throw createJwtError('jwt_signature_invalid');
  }
  return validateClaims(parsed.payload, nowMs);
}
