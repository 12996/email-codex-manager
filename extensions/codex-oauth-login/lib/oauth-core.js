export const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const OAUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
export const OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token';
export const OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback';
export const OAUTH_SCOPE = 'openid profile email offline_access';

const TRANSACTION_TTL_MS = 15 * 60 * 1000;

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function randomBase64Url(cryptoApi, byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  cryptoApi.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function decodeJwtPayload(token) {
  const segments = String(token || '').split('.');
  if (segments.length !== 3 || !segments[1]) {
    return null;
  }

  try {
    const encoded = segments[1]
      .replaceAll('-', '+')
      .replaceAll('_', '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function asDisplayString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function precheckAccessToken(rawToken, nowMs = Date.now()) {
  const token = String(rawToken || '').trim();
  if (!token) {
    return { kind: 'empty' };
  }
  if (/[\r\n]/.test(rawToken)) {
    return { kind: 'invalid' };
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { kind: 'opaque' };
  }

  const expiresAt = Number(payload.exp) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
    return { kind: 'jwt-valid' };
  }
  if (expiresAt <= nowMs) {
    return { kind: 'jwt-expired', expiresAt };
  }
  return { kind: 'jwt-valid', expiresAt };
}

export async function createPkceTransaction({ cryptoApi = globalThis.crypto, nowMs = Date.now() } = {}) {
  const verifier = randomBase64Url(cryptoApi);
  const state = randomBase64Url(cryptoApi);
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = toBase64Url(new Uint8Array(digest));
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    codex_cli_simplified_flow: 'true',
    id_token_add_organizations: 'true',
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state,
  });

  return {
    state,
    verifier,
    challenge,
    expiresAt: nowMs + TRANSACTION_TTL_MS,
    authorizationUrl: `${OAUTH_AUTHORIZE_URL}?${params.toString()}`,
  };
}

export function parseOAuthCallback(urlText) {
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return { kind: 'not-callback' };
  }

  if (url.protocol !== 'http:' || url.hostname !== 'localhost' || url.port !== '1455'
    || url.pathname !== '/auth/callback') {
    return { kind: 'not-callback' };
  }

  const error = url.searchParams.get('error');
  if (error) {
    return { kind: 'error', error };
  }

  const codes = url.searchParams.getAll('code');
  const states = url.searchParams.getAll('state');
  if (codes.length !== 1 || states.length !== 1 || !codes[0] || !states[0]) {
    return { kind: 'error', error: 'invalid_callback' };
  }
  return { kind: 'valid', code: codes[0], state: states[0] };
}

export function buildTokenExchangeBody({ code, verifier }) {
  return new URLSearchParams([
    ['client_id', OAUTH_CLIENT_ID],
    ['grant_type', 'authorization_code'],
    ['code', String(code || '')],
    ['redirect_uri', OAUTH_REDIRECT_URI],
    ['code_verifier', String(verifier || '')],
  ]);
}

export function extractDisplayClaims(tokenBundle = {}) {
  const idPayload = decodeJwtPayload(tokenBundle.id_token);
  const accessPayload = decodeJwtPayload(tokenBundle.access_token);
  const authClaim = accessPayload?.['https://api.openai.com/auth'];

  return {
    email: asDisplayString(idPayload?.email),
    plan: asDisplayString(authClaim?.chatgpt_plan_type),
  };
}
