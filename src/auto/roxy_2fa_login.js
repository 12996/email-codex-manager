const fs = require('node:fs');
const path = require('node:path');
const base = require('./roxy_oauth_login.js');
const twoFA = require('./roxy_2fa_auth_login.js');

const DEFAULT_CHATGPT_ENTRY_URL = process.env.CHATGPT_2FA_ENTRY_URL || 'https://chatgpt.com/';
const DEFAULT_SESSION_URL = 'https://chatgpt.com/api/auth/session';
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;
const DEFAULT_STAGE_DETECT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_STAGE_TURNS = 20;
const DEFAULT_TOKEN_OUTPUT_DIR = path.join(__dirname, 'product_files', '2fa_login');

function optionalRequire(request, fallback) {
    try {
        return require(request);
    } catch (_) {
        return fallback;
    }
}

const dotenv = optionalRequire('dotenv', { config: () => {} });

function pickLogger(logger) {
    return logger || console;
}

function log(logger, phase, action, details = '') {
    const suffix = details ? ` ${details}` : '';
    logger.log(`[roxy-2fa-login] phase=${phase} action=${action}${suffix}`);
}

function createAutomationError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function normalizePositiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
}

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getBodyText(page, timeoutMs = 1000) {
    if (typeof page?.locator === 'function') {
        const body = page.locator('body');
        if (body && typeof body.textContent === 'function') {
            return String(await body.textContent({ timeout: timeoutMs }).catch(() => '') || '');
        }
    }
    if (typeof page?.textContent === 'function') {
        return String(await page.textContent('body', { timeout: timeoutMs }).catch(() => '') || '');
    }
    return '';
}

async function isVisible(locator, timeoutMs) {
    if (!locator) return false;
    if (typeof locator.isVisible === 'function') {
        return Boolean(await locator.isVisible({ timeout: timeoutMs }).catch(() => false));
    }
    if (typeof locator.waitFor === 'function') {
        await locator.waitFor({ state: 'visible', timeout: timeoutMs });
        return true;
    }
    return false;
}

function getPageUrl(page) {
    return typeof page?.url === 'function' ? String(page.url() || '') : '';
}

function firstLocator(locator) {
    return locator && typeof locator.first === 'function' ? locator.first() : locator;
}

function isChatGptOrigin(url) {
    try {
        return new URL(url).origin === 'https://chatgpt.com';
    } catch (_) {
        return false;
    }
}

async function collectPageDebug(page) {
    return {
        url: getPageUrl(page),
        title: typeof page?.title === 'function' ? await page.title().catch(() => '') : '',
        bodyText: String(await getBodyText(page, 1000).catch(() => '') || '').slice(0, 500)
    };
}

async function getChatGptSessionSnapshot(page, options = {}) {
    if (typeof page?.evaluate !== 'function') {
        return null;
    }
    const sessionUrl = options.sessionUrl || DEFAULT_SESSION_URL;
    return page.evaluate(async (url) => {
        try {
            const response = await fetch(url, {
                credentials: 'include',
                cache: 'no-store'
            });
            return await response.json().catch(() => null);
        } catch (_) {
            return null;
        }
    }, sessionUrl).catch(() => null);
}

async function isChatGptLoggedInPage(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_STAGE_DETECT_TIMEOUT_MS;
    const url = getPageUrl(page);
    if (!isChatGptOrigin(url) || url.includes('/api/auth/')) {
        return false;
    }
    const loginButton = firstLocator(page.getByRole?.('button', { name: /log in/i }));
    if (await isVisible(loginButton, timeoutMs)) {
        return false;
    }
    const session = await getChatGptSessionSnapshot(page, options);
    return Boolean(session?.accessToken);
}

async function isChatGptLoginEntryPage(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_STAGE_DETECT_TIMEOUT_MS;
    const url = getPageUrl(page);
    if (!isChatGptOrigin(url) || url.includes('/api/auth/')) {
        return false;
    }
    const loginButton = firstLocator(page.getByRole?.('button', { name: /log in/i }));
    return isVisible(loginButton, timeoutMs);
}

async function openChatGptLoginEntry(page, options = {}) {
    const logger = pickLogger(options.logger);
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    if (!await isChatGptLoginEntryPage(page, options)) {
        throw createAutomationError('CHATGPT_LOGIN_ENTRY_NOT_FOUND', '当前页面不是 ChatGPT 登录入口页', {
            ...(await collectPageDebug(page))
        });
    }
    log(logger, 'chatgpt-entry', '点击 Log in');
    await firstLocator(page.getByRole('button', { name: /log in/i })).click({ timeout: timeoutMs });
    return { status: 'chatgpt-login-clicked' };
}

function logStageAfterAction(logger, fromStage, nextStage) {
    log(logger, 'flow', '动作后阶段识别', `from=${fromStage} stage=${nextStage?.stage || 'unknown'} url=${nextStage?.url || ''}`);
}

async function submitOpenAiEmail(page, options = {}) {
    const logger = pickLogger(options.logger);
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const email = String(options.email || '').trim();
    if (!email) {
        throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
    }
    if (!await base.is_openai_login_page(page, options)) {
        throw createAutomationError('OPENAI_LOGIN_PAGE_NOT_FOUND', '当前页面不是 OpenAI 邮箱登录页', {
            ...(await collectPageDebug(page))
        });
    }

    const emailInput = page.getByRole('textbox', { name: 'Email address' });
    log(logger, 'openai-email', '填写邮箱');
    await emailInput.waitFor({ state: 'visible', timeout: timeoutMs });
    await emailInput.click();
    await emailInput.fill(email);
    log(logger, 'openai-email', '点击 Continue');
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
    return { status: 'email-submitted', email };
}

async function submitOpenAiPassword(page, options = {}) {
    const logger = pickLogger(options.logger);
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const password = twoFA.resolvePassword(options);
    if (!password) {
        throw createAutomationError('OPENAI_PASSWORD_REQUIRED', 'OpenAI 密码不能为空');
    }
    if (!await twoFA.is_openai_password_page(page, options)) {
        throw createAutomationError('OPENAI_PASSWORD_PAGE_NOT_FOUND', '当前页面不是 OpenAI 密码登录页', {
            ...(await collectPageDebug(page))
        });
    }

    const passwordInput = page.getByRole('textbox', { name: 'Password' });
    log(logger, 'openai-password', '填写密码');
    await passwordInput.waitFor({ state: 'visible', timeout: timeoutMs });
    await passwordInput.click();
    await passwordInput.fill(password);
    log(logger, 'openai-password', '点击 Continue');
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
    return { status: 'password-submitted' };
}

async function submitOpenAiMfa(page, options = {}) {
    const logger = pickLogger(options.logger);
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const code = twoFA.resolveMfaCode(options);
    if (!/^\d{6,8}$/.test(code)) {
        throw createAutomationError('OPENAI_MFA_CODE_REQUIRED', 'OpenAI 2FA code 必须是 6-8 位数字');
    }
    if (!await twoFA.is_openai_mfa_page(page, options)) {
        throw createAutomationError('OPENAI_MFA_PAGE_NOT_FOUND', '当前页面不是 OpenAI MFA 验证页', {
            ...(await collectPageDebug(page))
        });
    }

    const codeInput = page.getByRole('textbox', { name: 'Code' });
    log(logger, 'openai-mfa', '填写 2FA code', 'code=provided');
    await codeInput.waitFor({ state: 'visible', timeout: timeoutMs });
    await codeInput.click();
    await codeInput.fill(code);
    log(logger, 'openai-mfa', '点击 Continue');
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
    return { status: 'mfa-submitted', codeLength: code.length };
}

async function detectChatGpt2FAStage(page, options = {}) {
    const timeoutMs = Math.min(options.stageDetectTimeoutMs || DEFAULT_STAGE_DETECT_TIMEOUT_MS, options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS);
    const detectOptions = { ...options, timeoutMs };
    const url = getPageUrl(page);
    if (url.includes('chatgpt.com/api/auth/callback/openai')) return { stage: 'chatgpt-callback', url };
    if (await isChatGptLoggedInPage(page, detectOptions)) return { stage: 'chatgpt-home', url };
    if (await isChatGptLoginEntryPage(page, detectOptions)) return { stage: 'chatgpt-entry', url };
    if (await twoFA.is_openai_choose_account_page(page, detectOptions)) return { stage: 'choose-account', url };
    if (await base.is_openai_login_page(page, detectOptions)) return { stage: 'openai-email', url };
    if (await twoFA.is_openai_password_page(page, detectOptions)) return { stage: 'openai-password', url };
    if (await twoFA.is_openai_mfa_page(page, detectOptions)) return { stage: 'openai-mfa', url };
    return { stage: 'unknown', url, ...(await collectPageDebug(page)) };
}

async function waitForKnownStage(page, options = {}) {
    const timeoutMs = options.transitionTimeoutMs || 10000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const stage = await detectChatGpt2FAStage(page, options);
        if (stage.stage !== 'unknown' && stage.stage !== options.ignoreStage) {
            return stage;
        }
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(300);
        } else {
            await sleepMs(300);
        }
    }
    return { stage: 'unknown', ...(await collectPageDebug(page)) };
}

async function fetchChatGptSession(page, options = {}) {
    const logger = pickLogger(options.logger);
    const sessionUrl = options.sessionUrl || DEFAULT_SESSION_URL;
    const timeoutMs = options.sessionTimeoutMs || 120000;
    log(logger, 'session', '请求 ChatGPT session');
    let session = await getChatGptSessionSnapshot(page, { ...options, sessionUrl });
    if (!session && typeof page.goto === 'function') {
        await page.goto(sessionUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
        const content = await page.textContent('body');
        try {
            session = JSON.parse(String(content || '{}'));
        } catch (error) {
            throw createAutomationError('CHATGPT_SESSION_PARSE_FAILED', 'ChatGPT session 响应不是合法 JSON', {
                bodyPreview: String(content || '').slice(0, 200)
            });
        }
    }
    if (!session?.accessToken) {
        throw createAutomationError('CHATGPT_SESSION_ACCESS_TOKEN_MISSING', 'ChatGPT session 中没有 accessToken', {
            keys: Object.keys(session || {})
        });
    }
    log(logger, 'session', 'Access Token 已获取');
    return session;
}

function safeCredentialFileName(email) {
    const normalized = String(email || '').trim().toLowerCase();
    const safe = normalized.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+$/, '_');
    return `${safe || 'unknown-email'}.json`;
}

function save2FALoginCredentialFile(options = {}) {
    const logger = pickLogger(options.logger);
    const email = String(options.email || '').trim().toLowerCase();
    const accessToken = String(options.accessToken || '');
    if (!email) {
        throw createAutomationError('CHATGPT_SESSION_EMAIL_REQUIRED', '保存 2FA 登录凭证需要邮箱');
    }
    if (!accessToken) {
        throw createAutomationError('CHATGPT_SESSION_ACCESS_TOKEN_REQUIRED', '保存 2FA 登录凭证需要 accessToken');
    }

    const outputRootDir = options.outputRootDir
        || process.env.TWO_FA_LOGIN_TOKEN_OUTPUT_DIR
        || DEFAULT_TOKEN_OUTPUT_DIR;
    fs.mkdirSync(outputRootDir, { recursive: true });
    const filePath = path.join(outputRootDir, safeCredentialFileName(email));
    const payload = {
        email,
        access_token: accessToken,
        created_at: typeof options.now === 'function' ? options.now() : new Date().toISOString(),
        source: 'chatgpt_2fa_session_login'
    };
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    log(logger, 'credential', '已保存凭证文件', `path=${filePath}`);
    return { path: filePath, payload };
}

async function processChatGpt2FALoginFlow(page, options = {}) {
    const logger = pickLogger(options.logger);
    const maxStageTurns = normalizePositiveInteger(options.maxStageTurns, DEFAULT_MAX_STAGE_TURNS);
    const email = String(options.email || '').trim();
    if (!email) {
        throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
    }

    for (let turn = 0; turn < maxStageTurns; turn += 1) {
        const stage = await detectChatGpt2FAStage(page, options);
        log(logger, 'flow', '阶段识别', `stage=${stage.stage}`);

        if (stage.stage === 'chatgpt-home') {
            const session = await fetchChatGptSession(page, options);
            const saved = save2FALoginCredentialFile({
                ...options,
                email,
                accessToken: session.accessToken,
                logger
            });
            return {
                status: 'session-saved',
                email,
                session,
                credentialFile: saved.path
            };
        }

        if (stage.stage === 'chatgpt-callback') {
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'chatgpt-callback' });
            logStageAfterAction(logger, 'chatgpt-callback', nextStage);
            continue;
        }

        if (stage.stage === 'chatgpt-entry') {
            await openChatGptLoginEntry(page, options);
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'chatgpt-entry' });
            logStageAfterAction(logger, 'chatgpt-entry', nextStage);
            continue;
        }

        if (stage.stage === 'choose-account') {
            await twoFA.openAi_choose_account(page, options);
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'choose-account' });
            logStageAfterAction(logger, 'choose-account', nextStage);
            continue;
        }

        if (stage.stage === 'openai-email') {
            await submitOpenAiEmail(page, options);
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'openai-email' });
            logStageAfterAction(logger, 'openai-email', nextStage);
            continue;
        }

        if (stage.stage === 'openai-password') {
            await submitOpenAiPassword(page, options);
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'openai-password' });
            logStageAfterAction(logger, 'openai-password', nextStage);
            continue;
        }

        if (stage.stage === 'openai-mfa') {
            await submitOpenAiMfa(page, options);
            const nextStage = await waitForKnownStage(page, { ...options, ignoreStage: 'openai-mfa' });
            logStageAfterAction(logger, 'openai-mfa', nextStage);
            continue;
        }

        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(500);
        } else {
            await sleepMs(500);
        }
    }

    throw createAutomationError('CHATGPT_2FA_LOGIN_FLOW_TIMEOUT', 'ChatGPT 2FA 登录状态机未在限定轮次内完成', {
        ...(await collectPageDebug(page))
    });
}

function shouldKeepOpen(env) {
    return String(env.ROXY_KEEP_OPEN || '1') !== '0';
}

async function run(argv = process.argv.slice(2), deps = {}) {
    const logger = pickLogger(deps.logger);
    const env = deps.env || process.env;
    const dotenvImpl = deps.dotenv || dotenv;
    dotenvImpl.config();

    const session = await base.openRoxyBrowserForAutomation({ ...deps, env, logger });
    const { page } = session;
    const entryUrl = argv[0] || deps.entryUrl || env.CHATGPT_2FA_ENTRY_URL || DEFAULT_CHATGPT_ENTRY_URL;
    try {
        log(logger, 'navigate', '打开 ChatGPT 登录入口', `url=${entryUrl}`);
        await page.goto(entryUrl, {
            waitUntil: 'domcontentloaded',
            timeout: deps.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS
        });
        if (typeof page.waitForLoadState === 'function') {
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        }
        const email = String(deps.email || env.ROXY_2FA_EMAIL || env.ROXY_OAUTH_EMAIL || '').trim();
        const result = await processChatGpt2FALoginFlow(page, {
            ...deps,
            env,
            email,
            logger
        });
        const disconnectMode = await base.closeRoxyBrowserSession(session, {
            keepOpen: shouldKeepOpen(env),
            logger
        });
        return {
            status: 'ok',
            entryUrl,
            dirId: session.dirId,
            cdpEndpoint: session.cdpEndpoint,
            disconnectMode,
            result
        };
    } catch (error) {
        await base.closeRoxyBrowserSession(session, {
            keepOpen: shouldKeepOpen(env),
            logger
        }).catch(() => {});
        throw error;
    }
}

async function runCli(proc = process, deps = {}) {
    try {
        const result = await run(proc.argv.slice(2), {
            ...deps,
            env: deps.env || proc.env
        });
        const logger = pickLogger(deps.logger);
        logger.log(`[roxy-2fa-login] phase=result action=凭证文件 path=${result.result?.credentialFile || ''}`);
        if (result.cdpEndpoint) {
            logger.log(`[roxy-2fa-login] phase=result action=调试复用提示 ROXY_CDP_ENDPOINT=${result.cdpEndpoint}`);
        }
        proc.exitCode = 0;
    } catch (error) {
        const logger = pickLogger(deps.logger);
        logger.error(`❌ [roxy-2fa-login] roxy_2fa_login 失败: ${error.message || error}`);
        if (error && error.stack) {
            logger.error(error.stack);
        }
        proc.exitCode = 1;
        if (typeof proc.exit === 'function') {
            proc.exit(1);
        }
    }
}

if (require.main === module) {
    runCli(process);
}

module.exports = {
    DEFAULT_CHATGPT_ENTRY_URL,
    DEFAULT_SESSION_URL,
    DEFAULT_TOKEN_OUTPUT_DIR,
    detectChatGpt2FAStage,
    fetchChatGptSession,
    isChatGptLoggedInPage,
    openChatGptLoginEntry,
    processChatGpt2FALoginFlow,
    run,
    runCli,
    save2FALoginCredentialFile,
    submitOpenAiEmail,
    submitOpenAiMfa,
    submitOpenAiPassword
};
