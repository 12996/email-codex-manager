import {
  OAUTH_TOKEN_URL,
  buildTokenExchangeBody,
  createPkceTransaction,
  extractDisplayClaims,
  parseOAuthCallback,
} from './oauth-core.js';

export const TRANSACTION_KEY = 'codex_oauth_transaction';
export const RESULT_KEY = 'codex_oauth_result';
export const PUBLIC_STATE_KEY = 'codex_oauth_public_state';
export const TRANSACTION_ALARM = 'codex_oauth_transaction_expiry';
export const DOWNLOAD_ALARM = 'codex_oauth_download_expiry';

const DOWNLOAD_TTL_MS = 60 * 1000;

function createPublicState(phase, message, { email = null, plan = null, canDownloadRt = false } = {}) {
  return { phase, message, email, plan, canDownloadRt };
}

const IDLE_STATE = createPublicState('idle', '等待登录');

export function createAuthController({ chromeApi, cryptoApi = globalThis.crypto, fetchImpl = globalThis.fetch, now = Date.now }) {
  async function readSession(key) {
    const values = await chromeApi.storage.session.get(key);
    return values[key];
  }

  async function publish(state) {
    await chromeApi.storage.session.set({ [PUBLIC_STATE_KEY]: state });
    try {
      await chromeApi.runtime.sendMessage({ type: 'auth:state-changed', state });
    } catch {
      // The state remains available through auth:get-state when no page is open.
    }
    return state;
  }

  async function getPublicState() {
    return (await readSession(PUBLIC_STATE_KEY)) || IDLE_STATE;
  }

  async function clearAlarms() {
    await chromeApi.alarms.clear(TRANSACTION_ALARM);
    await chromeApi.alarms.clear(DOWNLOAD_ALARM);
  }

  async function clear(reason = 'idle') {
    await chromeApi.storage.session.remove([TRANSACTION_KEY, RESULT_KEY]);
    await clearAlarms();
    if (reason === 'failed') {
      return publish(createPublicState('failed', '登录未完成'));
    }
    return publish(IDLE_STATE);
  }

  async function fail(message) {
    await chromeApi.storage.session.remove([TRANSACTION_KEY, RESULT_KEY]);
    await clearAlarms();
    return publish(createPublicState('failed', message));
  }

  async function startAuthorization() {
    await clear();
    const transaction = await createPkceTransaction({ cryptoApi, nowMs: now() });
    const storedTransaction = {
      state: transaction.state,
      verifier: transaction.verifier,
      expiresAt: transaction.expiresAt,
      authTabId: null,
      consumed: false,
    };

    await chromeApi.storage.session.set({ [TRANSACTION_KEY]: storedTransaction });
    await chromeApi.alarms.create(TRANSACTION_ALARM, { when: transaction.expiresAt });

    try {
      const tab = await chromeApi.tabs.create({ url: transaction.authorizationUrl, active: true });
      await chromeApi.storage.session.set({
        [TRANSACTION_KEY]: { ...storedTransaction, authTabId: tab.id },
      });
    } catch {
      return fail('无法打开授权页');
    }

    return publish(createPublicState('authorizing', '等待网页登录'));
  }

  async function handleBeforeNavigate(details) {
    const callback = parseOAuthCallback(details?.url);
    if (callback.kind === 'not-callback') {
      return getPublicState();
    }

    const transaction = await readSession(TRANSACTION_KEY);
    if (!transaction || transaction.expiresAt <= now()) {
      if (transaction) {
        return clear();
      }
      return getPublicState();
    }
    if (details.tabId !== transaction.authTabId) {
      return getPublicState();
    }
    if (callback.kind === 'error') {
      return fail('OAuth 登录未完成');
    }
    if (callback.state !== transaction.state || transaction.consumed) {
      return fail('OAuth 回调校验失败');
    }

    const consumedTransaction = { ...transaction, consumed: true };
    await chromeApi.storage.session.set({ [TRANSACTION_KEY]: consumedTransaction });
    await publish(createPublicState('exchanging', '正在兑换凭证'));

    let tokenBundle;
    try {
      const response = await fetchImpl(OAUTH_TOKEN_URL, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildTokenExchangeBody({ code: callback.code, verifier: transaction.verifier }),
      });
      if (!response?.ok) {
        return fail('凭证兑换失败');
      }
      tokenBundle = await response.json();
    } catch {
      return fail('凭证兑换失败');
    }

    const activeTransaction = await readSession(TRANSACTION_KEY);
    if (!activeTransaction || activeTransaction.state !== transaction.state || !activeTransaction.consumed) {
      return getPublicState();
    }
    if (typeof tokenBundle?.refresh_token !== 'string' || !tokenBundle.refresh_token.trim()) {
      return fail('未返回 RT');
    }

    const claims = extractDisplayClaims(tokenBundle);
    await chromeApi.storage.session.remove(TRANSACTION_KEY);
    await chromeApi.alarms.clear(TRANSACTION_ALARM);
    await chromeApi.storage.session.set({
      [RESULT_KEY]: {
        accessToken: typeof tokenBundle.access_token === 'string' ? tokenBundle.access_token : '',
        idToken: typeof tokenBundle.id_token === 'string' ? tokenBundle.id_token : '',
        refreshToken: tokenBundle.refresh_token,
      },
    });
    await chromeApi.alarms.create(DOWNLOAD_ALARM, { when: now() + DOWNLOAD_TTL_MS });
    return publish(createPublicState('authenticated', '登录成功', {
      email: claims.email,
      plan: claims.plan,
      canDownloadRt: true,
    }));
  }

  async function handleAlarm(name) {
    if (name === TRANSACTION_ALARM || name === DOWNLOAD_ALARM) {
      return clear();
    }
    return getPublicState();
  }

  async function handleTabRemoved(tabId) {
    const transaction = await readSession(TRANSACTION_KEY);
    if (transaction?.authTabId === tabId) {
      return clear();
    }
    return getPublicState();
  }

  async function takeRefreshTokenForDownload() {
    const result = await readSession(RESULT_KEY);
    if (typeof result?.refreshToken !== 'string' || !result.refreshToken.trim()) {
      await fail('RT 不可用');
      return null;
    }

    await chromeApi.storage.session.remove(RESULT_KEY);
    await publish(createPublicState('downloading', '正在下载 RT'));
    return result.refreshToken;
  }

  async function finishRefreshTokenDownload({ success }) {
    if (success) {
      return clear();
    }
    return fail('RT 下载失败');
  }

  return {
    clear,
    finishRefreshTokenDownload,
    getPublicState,
    handleAlarm,
    handleBeforeNavigate,
    handleTabRemoved,
    startAuthorization,
    takeRefreshTokenForDownload,
  };
}
