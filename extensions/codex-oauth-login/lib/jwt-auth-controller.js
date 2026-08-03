import {
  AGENT_IDENTITY_JWKS_URL,
  inspectJwtInput,
  verifyAgentIdentityJwt,
} from './jwt-auth-core.js';

export const JWT_AUTH_ATTEMPT_KEY = 'codex_jwt_auth_attempt';
export const JWT_AUTH_PUBLIC_STATE_KEY = 'codex_jwt_auth_public_state';

const IDLE_STATE = Object.freeze({
  phase: 'idle',
  message: '等待登录',
  email: null,
  plan: null,
});

const VALIDATING_STATE = Object.freeze({
  phase: 'validating',
  message: '正在校验 AT',
  email: null,
  plan: null,
});

function createPublicState(phase, message, { email = null, plan = null } = {}) {
  return { phase, message, email, plan };
}

function createDefaultAttemptId(cryptoApi) {
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createJwtAuthController({
  chromeApi,
  fetchImpl = globalThis.fetch,
  verifyJwt = verifyAgentIdentityJwt,
  cryptoApi = globalThis.crypto,
  now = Date.now,
  createAttemptId = () => createDefaultAttemptId(cryptoApi),
} = {}) {
  async function readSession(key) {
    const values = await chromeApi.storage.session.get(key);
    return values[key];
  }

  async function publish(state) {
    await chromeApi.storage.session.set({ [JWT_AUTH_PUBLIC_STATE_KEY]: state });
    try {
      await chromeApi.runtime.sendMessage({ type: 'auth:state-changed', state });
    } catch {
      // The extension page reads the redacted state when it opens later.
    }
    return state;
  }

  async function getPublicState() {
    return (await readSession(JWT_AUTH_PUBLIC_STATE_KEY)) || IDLE_STATE;
  }

  async function clearAttempt() {
    await chromeApi.storage.session.remove(JWT_AUTH_ATTEMPT_KEY);
  }

  async function isCurrentAttempt(attemptId) {
    const attempt = await readSession(JWT_AUTH_ATTEMPT_KEY);
    return attempt?.id === attemptId;
  }

  async function fail(message) {
    await clearAttempt();
    return publish(createPublicState('failed', message));
  }

  async function clear() {
    await chromeApi.storage.session.remove([JWT_AUTH_ATTEMPT_KEY, JWT_AUTH_PUBLIC_STATE_KEY]);
    return publish(IDLE_STATE);
  }

  async function startJwtLogin(rawJwt) {
    await clear();
    if (inspectJwtInput(rawJwt).kind !== 'valid-format') {
      return fail('请输入有效的 JWT AT');
    }

    const attemptId = createAttemptId();
    await chromeApi.storage.session.set({ [JWT_AUTH_ATTEMPT_KEY]: { id: attemptId } });
    await publish(VALIDATING_STATE);

    try {
      const response = await fetchImpl(AGENT_IDENTITY_JWKS_URL, { credentials: 'omit' });
      if (!response?.ok) {
        throw new Error('jwks_request_failed');
      }
      const jwks = await response.json();
      const display = await verifyJwt({
        rawJwt,
        jwks,
        cryptoApi,
        nowMs: now(),
      });
      if (!await isCurrentAttempt(attemptId)) {
        return getPublicState();
      }
      await clearAttempt();
      return publish(createPublicState('authenticated', '已登录（JWT AT 已验证）', display));
    } catch {
      if (!await isCurrentAttempt(attemptId)) {
        return getPublicState();
      }
      return fail('AT 校验失败，请检查凭证或稍后重试');
    }
  }

  return {
    clear,
    getPublicState,
    startJwtLogin,
  };
}
