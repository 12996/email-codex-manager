'use strict';

function requiredText(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function parseCliArgs(argv = [], env = process.env) {
  const values = {
    email: String(env.ROXY_REGISTER_EMAIL || '').trim().toLowerCase(),
    name: String(env.ROXY_REGISTER_NAME || '').trim(),
    birthday: String(env.ROXY_REGISTER_BIRTHDAY || '').trim(),
  };
  const names = {
    '--email': 'email',
    '--name': 'name',
    '--birthday': 'birthday',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const name = names[argv[index]];
    if (!name) throw new Error(`unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`);
    values[name] = String(value).trim();
    index += 1;
  }

  return values;
}

function parsePreparedProfileOutput(output) {
  const raw = String(output || '').trim();
  const toPreparedProfile = (value) => {
    if (value?.ok === true && value.dirId) {
      return { dirId: requiredText(value.dirId, 'prepared Roxy dirId') };
    }
    return null;
  };
  try {
    const prepared = toPreparedProfile(JSON.parse(raw));
    if (prepared) return prepared;
  } catch (_) {
    // A custom preparer may write diagnostics before its final JSON object.
  }

  const objectStarts = [...raw.matchAll(/(?:^|\r?\n)\s*\{/g)]
    .map((match) => match.index + match[0].lastIndexOf('{'))
    .reverse();
  for (const start of objectStarts) {
    try {
      const prepared = toPreparedProfile(JSON.parse(raw.slice(start)));
      if (prepared) return prepared;
    } catch (_) {
      // Try the next possible JSON object boundary.
    }
  }

  const lines = raw.split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const prepared = toPreparedProfile(JSON.parse(line));
      if (prepared) return prepared;
    } catch (_) {
      // The preparation command can emit non-JSON diagnostics before its result.
    }
  }
  throw new Error('Roxy preparation did not return a usable profile');
}

function assertNo2FaState(pageState, allowedStates) {
  const state = String(pageState?.state || 'unknown');
  if (state === 'auth-error') {
    const error = new Error('no2fa registration reached the ChatGPT authentication error page');
    error.code = 'NO2FA_AUTH_ERROR';
    throw error;
  }
  if (['password-create', 'password-login', 'password-error'].includes(state)) {
    const error = new Error('no2fa registration unexpectedly reached a password stage');
    error.code = 'NO2FA_PASSWORD_STAGE';
    throw error;
  }
  if (state === 'captcha') {
    const error = new Error('no2fa registration requires manual CAPTCHA handling');
    error.code = 'NO2FA_CAPTCHA';
    throw error;
  }
  if (state === 'user-exists') {
    const error = new Error('the registration email already has an account');
    error.code = 'NO2FA_USER_EXISTS';
    throw error;
  }
  return Array.isArray(allowedStates) && allowedStates.includes(state);
}

async function waitForNo2FaState(page, allowedStates, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 30000));
  const intervalMs = Math.max(0, Number(options.intervalMs || 250));
  const classifyPage = options.classifyPage;
  const wait = options.wait || ((delay) => page.waitForTimeout(delay));
  if (typeof classifyPage !== 'function') {
    throw new TypeError('classifyPage is required');
  }

  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';
  while (Date.now() <= deadline) {
    const pageState = await classifyPage(page);
    lastState = String(pageState?.state || 'unknown');
    if (assertNo2FaState(pageState, allowedStates)) return pageState;

    if (lastState === 'timeout' || lastState === 'connection-closed') {
      const error = new Error('no2fa registration page did not remain available');
      error.code = 'NO2FA_PAGE_UNAVAILABLE';
      throw error;
    }
    await wait(intervalMs);
  }

  const error = new Error(`no2fa registration did not reach an expected stage: ${lastState}`);
  error.code = 'NO2FA_STAGE_TIMEOUT';
  throw error;
}

function no2FaStageFailureCode(stage) {
  return `NO2FA_${String(stage || 'browser-registration')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}_FAILED`;
}

function attachNo2FaStageFailure(stage, error) {
  const failure = error instanceof Error
    ? error
    : new Error(String(error || 'no2fa browser registration failed'));
  if (!failure.code) failure.code = no2FaStageFailureCode(stage);
  if (!failure.no2faStage) failure.no2faStage = stage;
  return failure;
}

function no2FaLogUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return '';
  }
}

async function collectNo2FaPageMetadata(page) {
  const metadata = { url: no2FaLogUrl(page?.url?.()), controls: [] };
  if (typeof page?.locator !== 'function') return metadata;
  try {
    metadata.controls = await page.locator('input, button').evaluateAll((nodes) => nodes
      .slice(0, 16)
      .map((node) => {
        const element = node instanceof HTMLElement ? node : null;
        const rect = element?.getBoundingClientRect?.();
        return {
          tag: element?.tagName?.toLowerCase() || '',
          type: element?.getAttribute('type') || '',
          name: element?.getAttribute('name') || '',
          autocomplete: element?.getAttribute('autocomplete') || '',
          disabled: Boolean(element?.matches?.(':disabled')),
          readOnly: Boolean(element && 'readOnly' in element && element.readOnly),
          ariaDisabled: element?.getAttribute('aria-disabled') === 'true',
          visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        };
      }));
  } catch (_) {
    // Diagnostics must never replace the original automation failure.
  }
  return metadata;
}

async function runNo2FaStage({ page, stage, operation, logger = console } = {}) {
  try {
    return await operation();
  } catch (error) {
    const failure = attachNo2FaStageFailure(stage, error);
    const metadata = await collectNo2FaPageMetadata(page);
    logger.error?.(`[roxy-no2fa-register] step=${stage} action=failed code=${failure.code} metadata=${JSON.stringify(metadata)}`);
    throw failure;
  }
}

async function readSessionAccessToken(page, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 5));
  const intervalMs = Math.max(0, Number(options.intervalMs || 3000));
  const sessionUrl = 'https://chatgpt.com/api/auth/session';
  let lastStatus = 0;

  let context = null;
  try {
    context = typeof page?.context === 'function' ? page.context() : null;
  } catch (_) {
    context = null;
  }
  if (!context || typeof context.newPage !== 'function') {
    const error = new Error('ChatGPT session tab cannot be created from the Roxy browser context');
    error.code = 'NO2FA_SESSION_TAB_UNAVAILABLE';
    throw error;
  }

  let sessionPage;
  try {
    // Keep the completed ChatGPT page intact. The new page shares this
    // BrowserContext's authenticated cookies and is used only for session JSON.
    sessionPage = await context.newPage();
  } catch (_) {
    const error = new Error('ChatGPT session tab could not be opened');
    error.code = 'NO2FA_SESSION_TAB_UNAVAILABLE';
    throw error;
  }
  if (!sessionPage || typeof sessionPage.goto !== 'function') {
    try {
      await sessionPage?.close?.();
    } catch (_) {
      // This page was not usable; its cleanup cannot change the error reason.
    }
    const error = new Error('ChatGPT session tab is not navigable');
    error.code = 'NO2FA_SESSION_TAB_UNAVAILABLE';
    throw error;
  }

  const wait = options.wait || ((delay) => {
    if (typeof sessionPage.waitForTimeout === 'function') return sessionPage.waitForTimeout(delay);
    return new Promise((resolve) => setTimeout(resolve, delay));
  });

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let result;
    try {
      const response = await sessionPage.goto(sessionUrl, {
        waitUntil: 'domcontentloaded',
        timeout: Number(options.navigationTimeoutMs || 60000),
      });
      if (!response) {
        throw new Error('session navigation did not return an HTTP response');
      }
      result = { status: response.status(), body: await response.text() };
    } catch (_) {
      if (attempt < attempts) await wait(intervalMs);
      continue;
    }
    lastStatus = Number(result?.status || 0);
    let sessionData = null;
    try {
      sessionData = JSON.parse(String(result?.body || ''));
    } catch (_) {
      sessionData = null;
    }
    const accessToken = String(sessionData?.accessToken || '').trim();
    if (lastStatus >= 200 && lastStatus < 300 && accessToken) {
      // Keep this page open so the browser visibly proves where AT came from.
      return accessToken;
    }
    if (lastStatus === 401 || lastStatus === 403) {
      const error = new Error('ChatGPT session is not authenticated');
      error.code = 'NO2FA_SESSION_UNAUTHENTICATED';
      throw error;
    }
    if (attempt < attempts) await wait(intervalMs);
  }

  const error = new Error('ChatGPT session did not return an access token');
  error.code = 'NO2FA_SESSION_TOKEN_MISSING';
  error.status = lastStatus;
  throw error;
}

function resolveReplacementServiceBaseUrl(env = process.env) {
  const configured = String(env.REPLACEMENT_API_BASE || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  const port = Number(env.PORT || 3000);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 ? port : 3000}`;
}

function extractLoginCookie(response) {
  const setCookies = typeof response?.headers?.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response?.headers?.get?.('set-cookie')];
  for (const value of setCookies) {
    const cookie = String(value || '').split(';')[0].trim();
    if (cookie) return cookie;
  }
  throw new Error('replacement service login did not return an authentication cookie');
}

function normalizeReplacementAccount(account, email) {
  const id = Number(account?.id);
  const accountEmail = String(account?.email || '').trim().toLowerCase();
  if (!Number.isInteger(id) || id <= 0 || accountEmail !== email) {
    throw new Error('replacement service did not return the requested account');
  }
  if (String(account?.status || '').trim() !== 'unregistered') {
    throw new Error('replacement account is not unregistered');
  }
  return {
    id,
    email: accountEmail,
    emailCodeApiUrl: String(account?.email_code_api || '').trim(),
  };
}

function createReplacementAccountGateway(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const baseUrl = resolveReplacementServiceBaseUrl(env);
  const adminPassword = String(env.REPLACEMENT_ADMIN_PASSWORD || env.ADMIN_PASSWORD || '').trim();
  let authCookie = '';

  const authenticate = async () => {
    if (authCookie) return authCookie;
    if (!adminPassword) throw new Error('replacement service admin password is required');
    const response = await fetchImpl(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: adminPassword }),
      redirect: 'manual',
    });
    if (response.status < 200 || response.status >= 400) {
      throw new Error(`replacement service login failed: HTTP ${response.status}`);
    }
    authCookie = extractLoginCookie(response);
    return authCookie;
  };

  const requestJson = async (url, optionsForRequest = {}) => {
    const cookie = await authenticate();
    const response = await fetchImpl(url, {
      ...optionsForRequest,
      headers: {
        ...(optionsForRequest.headers || {}),
        cookie,
      },
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`replacement service request failed: HTTP ${response.status}`);
    }
    return response.json();
  };

  return {
    async prepareReplacementAccount({ email }) {
      const normalizedEmail = requiredText(email, 'email').toLowerCase();
      const accountId = String(env.REPLACEMENT_ACCOUNT_ID || '').trim();
      let payload;
      if (accountId) {
        payload = await requestJson(`${baseUrl}/replacement-accounts/${encodeURIComponent(accountId)}`);
        return normalizeReplacementAccount(payload?.account, normalizedEmail);
      }
      const query = new URLSearchParams({ status: 'unregistered', page: '1', pageSize: '100' });
      payload = await requestJson(`${baseUrl}/replacement-accounts?${query.toString()}`);
      const account = Array.isArray(payload?.accounts)
        ? payload.accounts.find((item) => String(item?.email || '').trim().toLowerCase() === normalizedEmail)
        : null;
      return normalizeReplacementAccount(account, normalizedEmail);
    },

    async markReplacementAccountRegistered({ account }) {
      const id = Number(account?.id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('replacement account id is required before status update');
      }
      await requestJson(`${baseUrl}/replacement-accounts/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'registered',
          status_note: '浏览器无2FA注册成功',
        }),
      });
    },
  };
}

function shouldKeepRoxyOpen(env = process.env) {
  return String(env.ROXY_KEEP_OPEN || '1').trim() !== '0';
}

async function closePreparedRoxyBrowser({ browser, client, closeDatabase, keepOpen }) {
  try {
    if (keepOpen && typeof browser?.disconnect === 'function') {
      await browser.disconnect();
    } else {
      await browser?.close?.();
      if (!keepOpen) await client?.closeBrowser?.();
    }
  } finally {
    await closeDatabase?.();
  }
}

async function runConfiguredRoxyPreparer(options = {}) {
  const env = options.env || process.env;
  const configured = requiredText(env.ROXY_NO_2FA_PREPARER, 'ROXY_NO_2FA_PREPARER');
  const path = require('node:path');
  const { execFile } = require('node:child_process');
  const projectRoot = path.resolve(__dirname, '..', '..');
  const preparerPath = path.isAbsolute(configured)
    ? configured
    : path.resolve(projectRoot, configured);
  const node = String(env.NODE_EXECUTABLE || process.execPath || 'node').trim();

  let stdout = '';
  try {
    stdout = await new Promise((resolve, reject) => {
      execFile(node, [preparerPath], {
        cwd: projectRoot,
        env: { ...process.env, ...env },
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      }, (error, output) => {
        if (error) reject(error);
        else resolve(String(output || ''));
      });
    });
    return parsePreparedProfileOutput(stdout);
  } catch (_) {
    const error = new Error('configured Roxy preparation failed');
    error.code = 'NO2FA_ROXY_PREPARATION_FAILED';
    throw error;
  }
}

async function openPreparedRoxyBrowser(options = {}) {
  const env = options.env || process.env;
  const injected = options.deps || {};
  const preparation = injected.prepareRoxyNo2FA
    || require('./prepare_roxy_no_2fa.cjs').prepareRoxyNo2FA;
  const buildLiveDependencies = injected.buildLiveDependencies
    || require('./prepare_roxy_no_2fa.cjs').buildLiveDependencies;
  const hasConfiguredPreparer = Boolean(String(env.ROXY_NO_2FA_PREPARER || '').trim());
  const prepareExternally = injected.runConfiguredRoxyPreparer || runConfiguredRoxyPreparer;
  let effectiveEnv = env;
  let live;
  let connected;
  try {
    if (hasConfiguredPreparer) {
      const prepared = await prepareExternally({ env });
      effectiveEnv = { ...env, ROXY_NO_2FA_BROWSER_DIR_ID: prepared.dirId };
    }
    live = await buildLiveDependencies(effectiveEnv);
    if (!hasConfiguredPreparer) {
      await preparation({
        env: effectiveEnv,
        client: live.client,
        proxyService: live.proxyService,
        settingsRepository: live.settingsRepository,
      });
    }
    connected = await live.client.connectReadyPlaywright();
    return {
      page: connected.page,
      async close() {
        await closePreparedRoxyBrowser({
          browser: connected.browser,
          client: live.client,
          closeDatabase: live.close,
          keepOpen: shouldKeepRoxyOpen(effectiveEnv),
        });
      },
    };
  } catch (error) {
    if (connected?.browser) {
      await connected.browser.disconnect?.().catch(() => {});
    }
    await live?.close?.();
    throw error;
  }
}

async function fillUsableInput(page, selector, value, label = 'input') {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  const visible = await locator.isVisible().catch(() => false);
  const enabled = await locator.isEnabled().catch(() => false);
  const operable = visible && enabled && await locator.evaluate((node) => {
    const el = node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node : null;
    return Boolean(el && !el.disabled && !el.readOnly && !el.closest?.('[aria-disabled="true"], [inert], fieldset[disabled]'));
  }).catch(() => false);
  if (!operable) {
    const error = new Error(`${label} input is not operable`);
    error.code = 'NO2FA_INPUT_UNUSABLE';
    throw error;
  }

  await locator.click({ timeout: 5000 });
  await locator.fill(String(value), { timeout: 10000 });
  const actual = String(await locator.inputValue().catch(() => '') || '').trim();
  if (actual !== String(value).trim()) {
    const error = new Error(`${label} input value was not accepted`);
    error.code = 'NO2FA_INPUT_VALUE_MISMATCH';
    throw error;
  }
  return true;
}

function submittedFieldNames(postData) {
  const body = String(postData || '').trim();
  if (!body) return [];
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.keys(parsed);
    }
  } catch (_) {
    // OpenAI currently submits this form as URL-encoded data.
  }
  return [...new Set([...new URLSearchParams(body).keys()])];
}

async function submitNo2FaProfile({ page, submitPrimaryAction, timeoutMs = 30000 } = {}) {
  if (!page || typeof page.waitForResponse !== 'function') {
    const error = new Error('no2fa profile page cannot observe create_account response');
    error.code = 'NO2FA_PROFILE_RESPONSE_UNAVAILABLE';
    throw error;
  }
  if (typeof submitPrimaryAction !== 'function') {
    throw new TypeError('submitPrimaryAction is required');
  }

  const createAccountResponse = page.waitForResponse((response) => {
    const request = response?.request?.();
    return request?.method?.() === 'POST'
      && String(response?.url?.() || '').includes('/api/accounts/create_account');
  }, { timeout: Math.max(1000, Number(timeoutMs) || 30000) });

  try {
    await submitPrimaryAction({ page, stage: 'profile' });
  } catch (error) {
    await createAccountResponse.catch(() => {});
    throw error;
  }

  let response;
  try {
    response = await createAccountResponse;
  } catch (_) {
    const error = new Error('no2fa profile submission did not produce create_account response');
    error.code = 'NO2FA_PROFILE_RESPONSE_MISSING';
    throw error;
  }

  const status = Number(response.status?.() || 0);
  if (status < 200 || status >= 300) {
    const error = new Error('no2fa create_account response was not successful');
    error.code = 'NO2FA_PROFILE_RESPONSE_FAILED';
    throw error;
  }

  const fields = submittedFieldNames(response.request?.().postData?.());
  if (!fields.includes('name') || !fields.includes('birthdate')) {
    const error = new Error('no2fa create_account payload did not contain name and birthdate');
    error.code = 'NO2FA_PROFILE_PAYLOAD_INVALID';
    throw error;
  }

  let payload = null;
  try {
    payload = JSON.parse(await response.text());
  } catch (_) {
    payload = null;
  }
  const pageType = String(payload?.page?.type || payload?.page_type || '').trim();
  if (pageType !== 'external_url') {
    const error = new Error('no2fa create_account response did not advance to external_url');
    error.code = 'NO2FA_PROFILE_RESPONSE_INVALID';
    throw error;
  }
  return { status, pageType };
}

async function waitForOtpOutcome(page, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 30000));
  const intervalMs = Math.max(0, Number(options.intervalMs || 500));
  const classifyPage = options.classifyPage;
  const wait = options.wait || ((delay) => page.waitForTimeout(delay));
  const readBody = options.readBody || (() => page.textContent('body', { timeout: 2000 }));
  if (typeof classifyPage !== 'function') throw new TypeError('classifyPage is required');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const body = String(await readBody().catch(() => '') || '').toLowerCase();
    if (/code incorrect|the code is incorrect|incorrect code|invalid code|代码不正确/.test(body)) {
      return { status: 'incorrect' };
    }
    const pageState = await classifyPage(page);
    if (assertNo2FaState(pageState, ['profile', 'chatgpt-session'])) {
      return { status: 'success', state: pageState };
    }
    const state = String(pageState?.state || 'unknown');
    if (state === 'timeout' || state === 'connection-closed') {
      const error = new Error('no2fa OTP page became unavailable');
      error.code = 'NO2FA_OTP_PAGE_UNAVAILABLE';
      throw error;
    }
    await wait(intervalMs);
  }
  return { status: 'pending' };
}

async function resendNo2FaOtpEmail(page) {
  const resendButton = page.locator('button[type="submit"][name="intent"][value="resend"]').first();
  const visible = await resendButton.isVisible().catch(() => false);
  const enabled = await resendButton.isEnabled().catch(() => false);
  const operable = visible && enabled && await resendButton.evaluate((node) => {
    const button = node instanceof HTMLButtonElement ? node : null;
    return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      && !button.closest?.('[aria-disabled="true"], [inert], fieldset[disabled]'));
  }).catch(() => false);
  if (!operable) return false;

  await resendButton.click({ force: true, timeout: 5000 });
  await page.waitForTimeout?.(2000);
  return true;
}

async function submitNo2FaOtp(options = {}) {
  const page = options.page;
  const email = requiredText(options.email, 'email').toLowerCase();
  const legacy = options.legacy || require('./roxy_register_openai.js');
  const env = options.env || process.env;
  const maxAttempts = Math.max(1, Number(env.ROXY_NO_2FA_OTP_MAX_ATTEMPTS || 5));
  const waitForOutcome = options.waitForOutcome || ((currentPage) => waitForOtpOutcome(currentPage, {
    timeoutMs: Number(env.ROXY_NO_2FA_OTP_SUBMIT_WAIT_MS || 30000),
    classifyPage: (targetPage) => legacy.classifyRegistrationPage(targetPage, {
      passwordSubmitted: true,
      timeoutMs: 500,
    }),
  }));
  let excludedCode = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const otpSelector = await legacy.findVisibleOtpSelector(page, 45000);
    const code = await legacy.fetchRegistrationEmailVerificationCode(page, email, {
      registrationEmailCodeApiUrl: String(options.emailCodeApiUrl || env.REGISTRATION_EMAIL_CODE_API_URL || '').trim(),
      codePollMaxAttempts: Number(env.ROXY_NO_2FA_OTP_POLL_ATTEMPTS || 24),
      codePollIntervalMs: Number(env.VERIFICATION_CODE_POLL_INTERVAL_MS || 5000),
      timeoutMs: Number(env.REGISTRATION_CODE_REQUEST_TIMEOUT_MS || 30000),
      onNoNewCodeFor30Seconds: () => resendNo2FaOtpEmail(page),
    }, excludedCode);
    await fillUsableInput(page, otpSelector, code, 'OTP');

    await legacy.fillProfileFieldsIfPresent(page, {
      label: '无2FA OTP合并页',
      waitMs: 1500,
      name: options.name,
      birthday: options.birthday,
    });
    await legacy.clickContinueButtonReliably(page, {
      startUrl: String(page.url?.() || ''),
      maxAttempts: 3,
      confirmTimeoutMs: 20000,
      requireEnabled: true,
    });

    const outcome = await waitForOutcome(page);
    if (outcome?.status === 'success') return outcome;
    if (outcome?.status === 'incorrect' && attempt < maxAttempts) {
      excludedCode = code;
      continue;
    }
    const error = new Error('no2fa OTP did not advance to the profile or session stage');
    error.code = outcome?.status === 'incorrect' ? 'NO2FA_OTP_RETRIES_EXHAUSTED' : 'NO2FA_OTP_SUBMIT_UNCONFIRMED';
    throw error;
  }

  const error = new Error('no2fa OTP retries exhausted');
  error.code = 'NO2FA_OTP_RETRIES_EXHAUSTED';
  throw error;
}

function createBrowserFlowDependencies(options = {}) {
  const legacy = options.legacy || require('./roxy_register_openai.js');
  return {
    prepareChatGptEmailEntry(page, context = {}) {
      return legacy.prepareChatGptEmailEntry(page, { timeoutMs: 60000, logger: context.logger || console });
    },
    fillEmailInput({ page, email }) {
      return fillUsableInput(page, 'input[type="email"], input[name="email"]', email, 'email');
    },
    async submitPrimaryAction({ page }) {
      await legacy.clickContinueButtonReliably(page, {
        startUrl: String(page.url?.() || ''),
        maxAttempts: 3,
        confirmTimeoutMs: 20000,
        requireEnabled: true,
      });
    },
    waitForNo2FaState(page, allowedStates) {
      return waitForNo2FaState(page, allowedStates, {
        classifyPage: (currentPage) => legacy.classifyRegistrationPage(currentPage, {
          passwordSubmitted: true,
          timeoutMs: 500,
        }),
      });
    },
    submitNo2FaOtp({ page, email, name, birthday, emailCodeApiUrl, env }) {
      return submitNo2FaOtp({
        page,
        email,
        name,
        birthday,
        emailCodeApiUrl,
        env,
        legacy,
      });
    },
    fillProfileFields({ page, name, birthday }) {
      return legacy.fillProfileFieldsIfPresent(page, {
        label: '无2FA资料页',
        waitMs: 15000,
        name,
        birthday,
      });
    },
    readSessionAccessToken,
  };
}

async function completeBrowserRegistration(options = {}) {
  const page = options.page;
  const env = options.env || process.env;
  const logger = options.logger || console;
  const helpers = { ...createBrowserFlowDependencies(), ...(options.deps || {}) };
  const email = requiredText(options.email, 'email').toLowerCase();
  const name = requiredText(options.name, 'name');
  const birthday = requiredText(options.birthday, 'birthday');
  const { prepareChatGptEmailEntry, fillEmailInput, submitPrimaryAction } = helpers;
  const waitForState = helpers.waitForNo2FaState;
  const submitOtp = helpers.submitNo2FaOtp;
  const { fillProfileFields } = helpers;
  const getSessionAccessToken = helpers.readSessionAccessToken;
  const entryUrl = String(env.OPENAI_REGISTRATION_ENTRY_URL || 'https://chatgpt.com/').trim();
  const runStage = (stage, operation) => runNo2FaStage({ page, stage, operation, logger });

  await runStage('entry-navigation', () => page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }));
  await runStage('email-entry', () => prepareChatGptEmailEntry(page, { env }));
  await runStage('email-fill', () => fillEmailInput({ page, email }));
  await runStage('email-submit', () => submitPrimaryAction({ page, stage: 'email' }));
  await runStage('otp-stage', () => waitForState(page, ['otp']));
  await runStage('otp-submit', () => submitOtp({ page, email, name, birthday, emailCodeApiUrl: options.emailCodeApiUrl, env }));

  const afterOtp = await runStage('post-otp-state', () => waitForState(page, ['profile', 'chatgpt-session']));
  if (afterOtp.state === 'profile') {
    let filled = await runStage('profile-fill', () => fillProfileFields({ page, name, birthday }));
    if (!filled) {
      const settledProfileState = await runStage('profile-render-wait', () => waitForState(page, ['profile', 'chatgpt-session']));
      if (settledProfileState.state === 'chatgpt-session') {
        return runStage('session-read', () => getSessionAccessToken(page, { env }));
      }
      filled = await runStage('profile-fill-retry', () => fillProfileFields({ page, name, birthday }));
    }
    if (!filled) {
      const error = new Error('no2fa profile page did not expose usable profile fields');
      error.code = 'NO2FA_PROFILE_FIELDS_UNAVAILABLE';
      error.no2faStage = 'profile-fill';
      throw error;
    }
    await runStage('profile-submit', () => submitNo2FaProfile({ page, submitPrimaryAction }));
    await runStage('chatgpt-session', () => waitForState(page, ['chatgpt-session']));
  }

  return runStage('session-read', () => getSessionAccessToken(page, { env }));
}

async function persistTokenThenMarkRegistered({
  email,
  accessToken,
  saveAccessToken,
  markRegistered,
}) {
  const registrationTokenFile = await saveAccessToken({ email, accessToken });
  await markRegistered();
  return { registrationTokenFile: registrationTokenFile.path };
}

async function runNo2FaRegistrationFlow(options = {}) {
  const deps = options.deps || {};
  const env = options.env || process.env;
  const email = requiredText(options.email, 'email').toLowerCase();
  const name = requiredText(options.name, 'name');
  const birthday = requiredText(options.birthday, 'birthday');
  const gateway = deps.replacementAccountGateway || createReplacementAccountGateway({
    env,
    fetchImpl: deps.fetchImpl,
  });
  const legacy = deps.legacy || require('./roxy_register_openai.js');
  const prepareReplacementAccount = deps.prepareReplacementAccount
    || gateway.prepareReplacementAccount;
  const openPreparedRoxyBrowser = deps.openPreparedRoxyBrowser
    || ((context) => openPreparedRoxyBrowserDefault(context, deps.roxy));
  const completeBrowserRegistration = deps.completeBrowserRegistration
    || ((context) => completeBrowserRegistrationDefault(context, deps.browserFlow));
  const saveAccessToken = deps.saveAccessToken
    || ((context) => legacy.saveRegistrationAccessTokenFile(context));
  const markReplacementAccountRegistered = deps.markReplacementAccountRegistered
    || gateway.markReplacementAccountRegistered;

  const account = await prepareReplacementAccount({ email, env });
  if (String(account?.email || '').trim().toLowerCase() !== email) {
    throw new Error('prepared replacement account email does not match the requested email');
  }

  const roxy = await openPreparedRoxyBrowser({ env });
  try {
    const accessToken = await completeBrowserRegistration({
      page: roxy.page,
      email,
      name,
      birthday,
      emailCodeApiUrl: String(account.emailCodeApiUrl || ''),
      env,
    });
    const persisted = await persistTokenThenMarkRegistered({
      email,
      accessToken,
      saveAccessToken,
      markRegistered: () => markReplacementAccountRegistered({ account, env }),
    });
    return { email, registrationTokenFile: persisted.registrationTokenFile };
  } finally {
    await roxy?.close?.();
  }
}

function openPreparedRoxyBrowserDefault(context, injectedDeps) {
  return openPreparedRoxyBrowser({ ...context, ...(injectedDeps ? { deps: injectedDeps } : {}) });
}

function completeBrowserRegistrationDefault(context, injectedDeps) {
  return completeBrowserRegistration({ ...context, ...(injectedDeps ? { deps: injectedDeps } : {}) });
}

function generateProfileName() {
  const firstNames = ['James', 'Mary', 'John', 'Lisa', 'Tom', 'Anna', 'Mike', 'Eva', 'Will', 'Kate'];
  const lastNames = ['Smith', 'Brown', 'Jones', 'Davis', 'Miller', 'Lee', 'Wilson', 'Walker', 'Hall', 'King'];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
}

function generateProfileBirthday(options = {}) {
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const current = options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(current.getTime())) {
    const error = new Error('unable to generate a profile birthday from the current date');
    error.code = 'NO2FA_PROFILE_BIRTHDAY_GENERATION_FAILED';
    throw error;
  }

  const nextInteger = (maxExclusive) => {
    const value = Number(random());
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(value, 0.999999999)) : 0;
    return Math.floor(normalized * maxExclusive);
  };
  const age = 20 + nextInteger(25); // 20 through 44, inclusive.
  const year = current.getUTCFullYear() - age;
  const month = nextInteger(current.getUTCMonth() + 1) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const maxDay = month === current.getUTCMonth() + 1
    ? Math.min(current.getUTCDate(), daysInMonth)
    : daysInMonth;
  const day = nextInteger(maxDay) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function loadProjectEnv() {
  const path = require('node:path');
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

async function runCli(proc = process, options = {}) {
  const loadEnv = options.loadEnv || loadProjectEnv;
  try {
    loadEnv(proc.env);
    const args = parseCliArgs(proc.argv.slice(2), proc.env);
    const email = requiredText(args.email, 'email').toLowerCase();
    const name = String(args.name || '').trim() || (options.generateProfileName || generateProfileName)();
    const birthday = String(args.birthday || '').trim()
      || (options.generateProfileBirthday || generateProfileBirthday)();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
      throw new Error('birthday must use YYYY-MM-DD');
    }
    const runFlow = options.runNo2FaRegistrationFlow || runNo2FaRegistrationFlow;
    const result = await runFlow({ email, name, birthday, env: proc.env });
    proc.stdout.write(`${JSON.stringify({
      ok: true,
      email: result.email,
      registrationTokenFile: result.registrationTokenFile,
    })}\n`);
    proc.exitCode = 0;
    return 0;
  } catch (error) {
    const code = String(error?.code || 'NO2FA_BROWSER_REGISTRATION_FAILED');
    const stage = String(error?.no2faStage || '').trim();
    proc.stderr.write(`[roxy-no2fa-register] failed code=${code}${stage ? ` stage=${stage}` : ''}\n`);
    proc.exitCode = 1;
    return 1;
  }
}

module.exports = {
  assertNo2FaState,
  completeBrowserRegistration,
  createBrowserFlowDependencies,
  createReplacementAccountGateway,
  fillUsableInput,
  generateProfileBirthday,
  openPreparedRoxyBrowser,
  parseCliArgs,
  parsePreparedProfileOutput,
  persistTokenThenMarkRegistered,
  readSessionAccessToken,
  runNo2FaRegistrationFlow,
  runCli,
  submitNo2FaOtp,
  waitForNo2FaState,
  waitForOtpOutcome,
};

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
