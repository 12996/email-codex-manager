const dotenv = require('dotenv');
const { RoxyBrowserClient } = require('./roxy-browser-client.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 配置文件
const DEFAULT_TARGET_URL = 'https://chatgpt.com/';
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;
const Default_EMAIL='jregkolpig+s4@gmail.com';
const DEFAULT_VERIFICATION_API_URL = 'http://127.0.0.1:3000/api/verification-code/latest';
const DEFAULT_PHONE_VERIFICATION_SMS_API_URL = 'https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=3b7c79633a6a3cd91862eb32e5f3f5cd';
const EMAIL_SUBTITLE_SELECTOR = 'body > div > div > div._titleBlock_l85du_108 > div > span > div > div._subtitle_7asl0_13';
const admin_auth='s%3A1.VU9C5Zr7JzIEl761twodGqwXJydas1N5tQ%2Fa1LdNwG8'



function pickLogger(logger) {
    return logger || console;
}

function log(logger, phase, action, details = '') {
    const suffix = details ? ` ${details}` : '';
    logger.log(`[roxy-oauth-login] phase=${phase} action=${action}${suffix}`);
}

function createAutomationError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function decodeJwt(token) {
    try {
        const base64Payload = String(token || '').split('.')[1];
        if (!base64Payload) return {};
        return JSON.parse(Buffer.from(base64Payload, 'base64').toString('utf8'));
    } catch {
        return {};
    }
}

function formatUtc8Timestamp(timestampMs) {
    const value = Number(timestampMs || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return '';
    }
    return new Date(value + (8 * 60 * 60 * 1000))
        .toISOString()
        .replace(/\.\d{3}Z$/, '+08:00');
}

function buildCpaAuthFile(entry, tokenBundle = {}, options = {}) {
    const accessPayload = decodeJwt(tokenBundle.access_token);
    return {
        type: 'codex',
        email: entry.name,
        expired: formatUtc8Timestamp(Number(accessPayload.exp || 0) * 1000),
        id_token: tokenBundle.id_token || '',
        account_id: entry?.credentials?.chatgpt_account_id || '',
        access_token: tokenBundle.access_token || '',
        last_refresh: formatUtc8Timestamp((options.now || new Date()).getTime()),
        refresh_token: tokenBundle.refresh_token || ''
    };
}

function saveIndividualAccountJson(entry, tokenBundle = {}, options = {}) {
    const rootDir = options.outputRootDir || path.join(__dirname, 'product_files');
    const sub2apiDir = path.join(rootDir, 'sub2api');
    const cpaDir = path.join(rootDir, 'cpa');
    fs.mkdirSync(sub2apiDir, { recursive: true });
    fs.mkdirSync(cpaDir, { recursive: true });

    const sub2apiWrapper = {
        exported_at: (options.now || new Date()).toISOString(),
        proxies: [],
        accounts: [entry]
    };
    const sub2apiFile = `${entry.name}.json`;
    const sub2apiPath = path.join(sub2apiDir, sub2apiFile);
    fs.writeFileSync(sub2apiPath, JSON.stringify(sub2apiWrapper, null, 2), 'utf-8');

    const cpaData = buildCpaAuthFile(entry, tokenBundle, options);
    const cpaFile = `${entry.name}.json`;
    const cpaPath = path.join(cpaDir, cpaFile);
    fs.writeFileSync(cpaPath, JSON.stringify(cpaData), 'utf-8');

    return {
        filePath: sub2apiPath,
        fileName: sub2apiFile,
        sub2apiPath,
        sub2apiFile,
        cpaPath,
        cpaFile
    };
}

async function persistProductAsset() {
    return undefined;
}

function formatTimestampForFilename(date = new Date()) {
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate())
    ].join('') + '-' + [
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds())
    ].join('') + '-' + pad(date.getMilliseconds(), 3);
}

function safeStepName(step) {
    return String(step || 'step').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'step';
}

function resolveDebugImageDir(options = {}) {
    return options.debugImageDir || path.resolve(__dirname, '..', '..', 'debug_image');
}

async function captureFailureScreenshot(page, error, step, options = {}) {
    const logger = pickLogger(options.logger);
    if (options.disableFailureScreenshot || !page || typeof page.screenshot !== 'function') {
        return undefined;
    }

    const debugImageDir = resolveDebugImageDir(options);
    const filename = `${formatTimestampForFilename()}-${safeStepName(step)}.png`;
    const screenshotPath = path.join(debugImageDir, filename);

    try {
        await fs.promises.mkdir(debugImageDir, { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        if (error && typeof error === 'object') {
            error.debugScreenshotPath = screenshotPath;
        }
        return screenshotPath;
    } catch (screenshotError) {
        if (error && typeof error === 'object') {
            error.debugScreenshotError = screenshotError?.message || String(screenshotError);
        }
        if (logger && typeof logger.warn === 'function') {
            logger.warn(`[roxy-oauth-login] phase=debug action=失败截图失败 step=${safeStepName(step)} 诊断=${screenshotError?.message || screenshotError}`);
        }
        return undefined;
    }
}

async function withFailureScreenshot(page, options, step, operation) {
    try {
        return await operation();
    } catch (error) {
        await captureFailureScreenshot(page, error, step, options);
        throw error;
    }
}

async function collectPageDebug(page) {
    const url = typeof page.url === 'function' ? page.url() : '';
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    const bodyText = typeof page.textContent === 'function'
        ? String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '').slice(0, 500)
        : '';
    return { url, title, bodyText };
}

function withTimeout(promise, timeoutMs, onTimeout) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getBodyText(page, timeoutMs) {
    if (typeof page.locator === 'function') {
        const body = page.locator('body');
        if (body && typeof body.textContent === 'function') {
            return String(await body.textContent({ timeout: timeoutMs }).catch(() => '') || '');
        }
    }
    if (typeof page.textContent === 'function') {
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

async function is_openai_login_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const emailInput = page.getByRole('textbox', { name: 'Email address' });
    return isVisible(emailInput, timeoutMs);
}

// 邮箱提交后通常会进入 /email-verification；同时兼容页面只渲染 Code 输入框但 URL 未及时变化的情况。
async function waitForOpenAiEmailVerification(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const url = typeof page.url === 'function' ? page.url() : '';
        if (url.includes('/email-verification')) {
            return { status: 'email-verification-page', url };
        }
        if (await is_email_code_page(page, { ...options, timeoutMs: Math.min(1000, timeoutMs) })) {
            return { status: 'email-verification-page', url };
        }
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(500);
        } else {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    throw createAutomationError('OPENAI_EMAIL_VERIFICATION_TIMEOUT', `OpenAI 登录页 ${timeoutMs}ms 内未进入邮箱验证码页`, {
        ...(await collectPageDebug(page))
    });
}

async function session_check(page, email, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const selector = options.emailSubtitleSelector || EMAIL_SUBTITLE_SELECTOR;
    const normalizedEmail = String(email || '').trim();
    if (!normalizedEmail) {
        throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
    }

    const locator = page.locator(selector);
    const displayedText = await withTimeout(
        (async () => {
            await locator.waitFor({ state: 'visible', timeout: timeoutMs });
            return String(await locator.innerText()).trim();
        })(),
        timeoutMs,
        () => createAutomationError('OPENAI_LOGIN_TIMEOUT', `OpenAI 登录页 ${timeoutMs}ms 内未显示邮箱确认区域`, {
            email: normalizedEmail
        })
    ).catch(async (error) => {
        if (error.code === 'OPENAI_LOGIN_TIMEOUT') {
            Object.assign(error, await collectPageDebug(page));
        }
        throw error;
    });

    if (!displayedText.includes(normalizedEmail)) {
        throw createAutomationError('OPENAI_LOGIN_EMAIL_MISMATCH', 'OpenAI 登录页显示邮箱与传入邮箱不一致', {
            expectedEmail: normalizedEmail,
            actualText: displayedText,
            ...(await collectPageDebug(page))
        });
    }

    return {
        status: 'session-email-confirmed',
        email: normalizedEmail,
        displayedText
    };
}

async function openAi_login(page, email, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_login', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        const normalizedEmail = String(email || '').trim();
        if (!normalizedEmail) {
            throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
        }
        if (!await is_openai_login_page(page, options)) {
            throw createAutomationError('OPENAI_LOGIN_PAGE_NOT_FOUND', '当前页面不是 OpenAI 邮箱登录页', {
                email: normalizedEmail,
                ...(await collectPageDebug(page))
            });
        }

        // 使用 codegen 录制到的稳定 role selector 填写邮箱并提交。
        const emailInput = page.getByRole('textbox', { name: 'Email address' });
        await emailInput.waitFor({ state: 'visible', timeout: timeoutMs });
        await emailInput.click();
        await emailInput.fill(normalizedEmail);
        await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });

        const verification = await waitForOpenAiEmailVerification(page, options);
        return {
            status: 'email-submitted',
            email: normalizedEmail,
            nextStatus: verification.status,
            url: verification.url
        };
    });
}

async function is_email_code_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const codeInput = page.getByRole('textbox', { name: 'Code' });
    const bodyText = (await getBodyText(page, timeoutMs)).toLowerCase();
    const url = typeof page.url === 'function' ? page.url() : '';
    const hasCodeInput = await isVisible(codeInput, timeoutMs);
    const hasEmailVerificationContext = url.includes('/email-verification')
        || bodyText.includes('sent to your email')
        || bodyText.includes('check your email')
        || bodyText.includes('email verification')
        || bodyText.includes('verify your email');
    const hasEmailCodeKeywords = bodyText.includes('code') && bodyText.includes('email') && hasEmailVerificationContext;
    return hasCodeInput && hasEmailCodeKeywords;
}

async function fillVerificationCodeInput(page, code, timeoutMs) {
    const roleCodeInput = page.getByRole('textbox', { name: 'Code' });
    try {
        await roleCodeInput.waitFor({ state: 'visible', timeout: timeoutMs });
        await roleCodeInput.click();
        await roleCodeInput.fill(String(code));
        return 'role-code';
    } catch (error) {
        const fallbackSelector = [
            'input[autocomplete="one-time-code"]',
            'input[inputmode="numeric"]',
            'input[name="code"]',
            'input[type="tel"]',
            'input[type="text"]'
        ].join(', ');
        const fallbackInput = page.locator(fallbackSelector).first();
        await fallbackInput.waitFor({ state: 'visible', timeout: timeoutMs });
        await fallbackInput.click();
        await fallbackInput.fill(String(code));
        return 'fallback-input';
    }
}

async function fetchEmailVerificationCode(page, email, options) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const verificationApiUrl = options.verificationApiUrl
        || process.env.VERIFICATION_CODE_API_URL
        || DEFAULT_VERIFICATION_API_URL;

    let data;
    const apiRequest = options.request || page.request || (typeof page.context === 'function' ? page.context().request : null);
    const configuredAdminAuth = options.adminAuthCookie || options.adminAuth || admin_auth;
    const requestHeaders = configuredAdminAuth
        ? { Cookie: `admin_auth=${configuredAdminAuth}` }
        : undefined;

    if (apiRequest && typeof apiRequest.post === 'function') {
        const response = await apiRequest.post(verificationApiUrl, {
            data: { account: email },
            ...(requestHeaders ? { headers: requestHeaders } : {}),
            timeout: timeoutMs
        });
        data = await response.json();
    } else if (typeof fetch === 'function') {
        const response = await fetch(verificationApiUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(requestHeaders || {})
            },
            body: JSON.stringify({ account: email }),
            signal: AbortSignal.timeout(timeoutMs)
        });
        data = await response.json();
    } else {
        throw createAutomationError('OPENAI_EMAIL_CODE_FETCH_FAILED', '当前运行环境不支持通过 API 获取邮箱验证码');
    }

    const code = String(data?.code || '').trim();
    if (!data?.ok || !/^\d{6}$/.test(code)) {
        throw createAutomationError('OPENAI_EMAIL_CODE_FETCH_FAILED', '邮箱验证码 API 未返回有效 6 位验证码', {
            email,
            apiResult: data
        });
    }
    return code;
}

async function openAi_email_code(page, email, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_email_code', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        const normalizedEmail = String(email || '').trim();
        const hasDirectCode = options.code !== undefined && options.code !== null && String(options.code).trim() !== '';
        if (!normalizedEmail && !hasDirectCode) {
            throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
        }
        if (!await is_email_code_page(page, options)) {
            throw createAutomationError('OPENAI_EMAIL_CODE_PAGE_NOT_FOUND', '当前页面不是邮箱验证码输入页', {
                email: normalizedEmail,
                ...(await collectPageDebug(page))
            });
        }

        // 手动测试已传入验证码时，不再强制依赖邮箱和验证码 API。
        const code = hasDirectCode ? String(options.code).trim() : await fetchEmailVerificationCode(page, normalizedEmail, options);
        if (!/^\d{6}$/.test(String(code))) {
            throw createAutomationError('OPENAI_EMAIL_CODE_INVALID', '邮箱验证码必须是 6 位数字', {
                email: normalizedEmail,
                code
            });
        }

        await fillVerificationCodeInput(page, code, timeoutMs);
        await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });

        return {
            status: 'email-code-submitted',
            email: normalizedEmail,
            code: String(code)
        };
    });
}

async function is_phone_verify_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = await getBodyText(page, timeoutMs);
    const textMessageRadio = page.getByRole('radio', { name: 'Text Message' });
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    const hasExpectedText = bodyText.includes('Verify your phone number');
    return hasExpectedText
        && await isVisible(textMessageRadio, timeoutMs)
        && await isVisible(continueButton, timeoutMs);
}

async function submitOpenAiPhoneVerify(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    if (!await is_phone_verify_page(page, options)) {
        throw createAutomationError('OPENAI_PHONE_VERIFY_PAGE_NOT_FOUND', '当前页面不是手机号码验证方式选择页', {
            ...(await collectPageDebug(page))
        });
    }

    const textMessageRadio = page.getByRole('radio', { name: 'Text Message' });
    await textMessageRadio.check({ timeout: timeoutMs });
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
    return { status: 'phone-verify-submitted', method: 'Text Message' };
}

async function openAi_phone_verify(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_phone_verify', () => submitOpenAiPhoneVerify(page, options));
}

const is_phone_code_request_page = is_phone_verify_page;

async function openAi_phone_code_request(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_phone_code_request', () => submitOpenAiPhoneVerify(page, options));
}

async function is_phone_code_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = await getBodyText(page, timeoutMs);
    const codeInput = page.getByRole('textbox', { name: 'Code' });
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    const hasExpectedText = bodyText.includes('Check your phone')
        && bodyText.includes('Enter the verification code');
    return hasExpectedText
        && await isVisible(codeInput, timeoutMs)
        && await isVisible(continueButton, timeoutMs);
}

async function fetchPhoneVerificationCode(options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const smsApiUrl = options.smsApiUrl
        || process.env.PHONE_VERIFICATION_SMS_API_URL
        || DEFAULT_PHONE_VERIFICATION_SMS_API_URL;
    const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
    let text;

    if (options.request && typeof options.request.get === 'function') {
        const response = await options.request.get(smsApiUrl, { timeout: timeoutMs });
        if (typeof response.text === 'function') {
            text = await response.text();
        } else if (typeof response.json === 'function') {
            text = JSON.stringify(await response.json());
        }
    } else if (fetchImpl) {
        const fetchOptions = { method: 'GET' };
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
            fetchOptions.signal = AbortSignal.timeout(timeoutMs);
        }
        const response = await fetchImpl(smsApiUrl, fetchOptions);
        text = typeof response.text === 'function' ? await response.text() : String(response);
    } else {
        throw createAutomationError('OPENAI_PHONE_CODE_FETCH_FAILED', '当前运行环境不支持通过短信 API 获取手机验证码');
    }

    const match = String(text || '').match(/\b\d{6}\b/);
    if (!match) {
        throw createAutomationError('OPENAI_PHONE_CODE_FETCH_FAILED', '短信验证码 API 未返回连续 6 位验证码', {
            smsApiUrl
        });
    }
    return match[0];
}

async function openAi_phone_code(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_phone_code', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        if (!await is_phone_code_page(page, options)) {
            throw createAutomationError('OPENAI_PHONE_CODE_PAGE_NOT_FOUND', '当前页面不是手机验证码输入页', {
                ...(await collectPageDebug(page))
            });
        }

        const code = options.code !== undefined && options.code !== null && String(options.code).trim() !== ''
            ? String(options.code).trim()
            : await fetchPhoneVerificationCode(options);
        if (!/^\d{6}$/.test(code)) {
            throw createAutomationError('OPENAI_PHONE_CODE_INVALID', '手机验证码必须是 6 位数字', { code });
        }

        const codeInput = page.getByRole('textbox', { name: 'Code' });
        await codeInput.waitFor({ state: 'visible', timeout: timeoutMs });
        await codeInput.click();
        await codeInput.fill(code);
        await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });

        return {
            status: 'phone-code-submitted',
            code
        };
    });
}

async function is_codex_login_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = (await getBodyText(page, timeoutMs)).toLowerCase();
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    const hasContinue = await isVisible(continueButton, timeoutMs);
    const hasCodexKeywords = bodyText.includes('codex')
        && (bodyText.includes('chatgpt') || bodyText.includes('chat history') || bodyText.includes('sign in to'));
    return hasContinue && hasCodexKeywords;
}

async function codex_login(page, options = {}) {
    return withFailureScreenshot(page, options, 'codex_login', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        if (!await is_codex_login_page(page, options)) {
            throw createAutomationError('CODEX_LOGIN_PAGE_NOT_FOUND', '当前页面不是 Codex 登录确认页', {
                ...(await collectPageDebug(page))
            });
        }

        try {
            await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
        } catch (error) {
            const currentUrl = typeof page.url === 'function' ? page.url() : '';
            const message = String(error?.message || error);
            if (currentUrl.includes('localhost:1455/auth/callback') || message.includes('localhost:1455/auth/callback')) {
                return { status: 'codex-login-submitted', callbackReached: true };
            }
            throw error;
        }
        return { status: 'codex-login-submitted' };
    });
}

function safeConfigSummary(env) {
    const hasTarget = (name) => env[name] !== undefined && env[name] !== null && String(env[name]).trim() !== '';
    return [
        `apiBaseUrl=${hasTarget('ROXY_API_BASE_URL') ? '已配置' : '未配置'}`,
        `apiPort=${hasTarget('ROXY_API_PORT') ? '已配置' : '未配置'}`,
        `token=${hasTarget('ROXY_API_TOKEN') ? '已配置' : '未配置'}`,
        `workspaceId=${hasTarget('ROXY_WORKSPACE_ID') ? env.ROXY_WORKSPACE_ID : '未配置'}`,
        `dirId=${hasTarget('ROXY_BROWSER_DIR_ID') ? env.ROXY_BROWSER_DIR_ID : '未配置'}`,
        `sortNum=${hasTarget('ROXY_BROWSER_SORT_NUM') ? env.ROXY_BROWSER_SORT_NUM : '未配置'}`,
        `windowName=${hasTarget('ROXY_BROWSER_WINDOW_NAME') ? env.ROXY_BROWSER_WINDOW_NAME : '未配置'}`
    ].join(' ');
}

/**
 * 核心工具：生成 PKCE 校验对
 */
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

function shouldEnsureClosed(env) {
    return String(env.ROXY_ENSURE_CLOSED || '1') !== '0';
}

function shouldKeepOpen(env) {
    return String(env.ROXY_KEEP_OPEN || '1') !== '0';
}

async function disconnectPlaywright(browser, logger) {
    if (!browser) {
        return 'missing-browser';
    }
    if (typeof browser.disconnect === 'function') {
        await browser.disconnect();
        return 'disconnect';
    }
    logger.warn('[roxy-oauth-login] phase=cleanup action=Playwright 断开 诊断=当前 Playwright Browser 对象未提供 disconnect，调用 browser.close 断开 CDP 连接；不会调用 Roxy closeBrowser');
    await browser.close({ reason: 'roxy_oauth_login disconnect after navigation' });
    return 'close-connection';
}

async function connectExistingRoxyByCdp(cdpEndpoint, deps = {}) {
    const logger = pickLogger(deps.logger);
    const endpoint = String(cdpEndpoint || '').trim();
    if (!endpoint) {
        throw new Error('ROXY_CDP_ENDPOINT 为空，无法复用已有 Roxy CDP');
    }

    log(logger, 'cdp-reuse', '检测到 ROXY_CDP_ENDPOINT', 'mode=reuse');
    log(logger, 'cdp-reuse', '跳过 Roxy 准备流程', 'skip=resolveDirId,close,clear,random,open,getConnectionInfo');
    log(logger, 'cdp-reuse', '直接连接 CDP', 'connectOverCDP');

    const playwright = deps.playwright || require('playwright-core');
    const browser = await playwright.chromium.connectOverCDP(endpoint);
    let context = browser.contexts()[0];
    if (!context) {
        context = await browser.newContext();
    }
    let page = context.pages()[0];
    if (!page) {
        page = await context.newPage();
    }

    return {
        client: null,
        browser,
        context,
        page,
        dirId: null,
        workspaceId: null,
        cdpEndpoint: endpoint,
        reuseCdp: true
    };
}

async function openRoxyBrowserForAutomation(deps = {}) {
    const logger = pickLogger(deps.logger);
    const env = deps.env || process.env;
    const reuseCdpEndpoint = String(env.ROXY_CDP_ENDPOINT || '').trim();
    if (reuseCdpEndpoint) {
        try {
            return await connectExistingRoxyByCdp(reuseCdpEndpoint, deps);
        } catch (error) {
            log(logger, 'cdp-reuse', '复用 CDP 失败，回退 Roxy 开窗', `诊断=${error.message || error}`);
        }
    }

    const Client = deps.RoxyBrowserClient || RoxyBrowserClient;
    const client = deps.client || new Client();

    log(logger, 'resolve-target', '解析目标窗口', safeConfigSummary(env));
    const dirId = await client.resolveDirId();
    log(logger, 'resolve-target', '解析目标窗口完成', `dirId=${dirId}`);

    if (shouldEnsureClosed(env)) {
        log(logger, 'prepare', '关闭已有窗口', `dirId=${dirId}`);
        await client.closeBrowser();
    } else {
        log(logger, 'prepare', '跳过关闭已有窗口', 'ROXY_ENSURE_CLOSED=0');
    }

    log(logger, 'prepare', '清缓存', 'scope=local');
    await client.clearLocalCache();
    log(logger, 'prepare', '清缓存', 'scope=server');
    await client.clearServerCache();

    log(logger, 'prepare', '随机指纹', `dirId=${dirId}`);
    await client.randomFingerprint();

    log(logger, 'open', '打开窗口', `dirId=${dirId}`);
    await client.openBrowser();

    log(logger, 'cdp', '获取 CDP', `dirId=${dirId}`);
    const connectionInfo = await client.getConnectionInfo();
    const cdpEndpoint = connectionInfo.ws;
    log(logger, 'cdp', '获取 CDP 完成', `ws=${cdpEndpoint || '未获取'}`);

    log(logger, 'playwright', 'Playwright 连接', 'connectOverCDP');
    const { browser, context, page } = await client.connectPlaywright(cdpEndpoint);

    return {
        client,
        browser,
        context,
        page,
        dirId,
        workspaceId: client.workspaceId,
        cdpEndpoint
    };
}

async function closeRoxyBrowserSession(session, options = {}) {
    const logger = pickLogger(options.logger);
    const keepOpen = options.keepOpen !== undefined ? options.keepOpen : true;

    log(logger, 'cleanup', '是否保持浏览器打开', `保持浏览器打开: ${keepOpen ? '是' : '否'}`);
    if (keepOpen || session.reuseCdp || !session.client) {
        if (session.reuseCdp) {
            log(logger, 'cleanup', 'CDP 复用模式只断开 Playwright', 'skip=Roxy closeBrowser');
        }
        return disconnectPlaywright(session.browser, logger);
    }

    log(logger, 'cleanup', '关闭 Playwright/Roxy 窗口', 'keepOpen=false');
    await session.browser.close();
    await session.client.closeBrowser();
    return 'close';
}

/**
 * 核心流程：使用 Code 换取 Token 并解析
 */
async function exchangeToken(code, verifier, email, proxyValue = '', options = {}) {
    const logger = pickLogger(options.logger);
    log(logger, 'token', '正在通过授权码换取 Token Bundle');
    const url = 'https://auth.openai.com/oauth/token';
    const payload = {
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        grant_type: "authorization_code",
        code: code,
        redirect_uri: "http://localhost:1455/auth/callback",
        code_verifier: verifier
    };

    try {
        if (proxyValue) {
            logger.warn('[roxy-oauth-login] phase=token action=代理提示 诊断=当前 token 请求使用 fetch，不支持 Node 侧代理配置；浏览器阶段仍使用 Roxy 代理');
        }
        let data;
        let ok = true;
        if (options.page && typeof options.page.evaluate === 'function') {
            const result = await options.page.evaluate(async ({ url: tokenUrl, payload: tokenPayload }) => {
                const response = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(tokenPayload)
                });
                return {
                    ok: response.ok,
                    data: await response.json()
                };
            }, { url, payload });
            ok = result.ok !== false;
            data = result.data;
        } else if (options.request && typeof options.request.post === 'function') {
            const resp = await options.request.post(url, {
                data: payload,
                headers: { 'Content-Type': 'application/json' },
                timeout: options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS
            });
            ok = typeof resp.ok === 'function' ? resp.ok() : resp.ok !== false;
            data = await resp.json();
        } else {
            const fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch : null);
            if (!fetchImpl) {
                throw createAutomationError('OPENAI_TOKEN_EXCHANGE_FAILED', '当前运行环境不支持 fetch，无法换取 Token');
            }
            const resp = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            ok = resp.ok !== false;
            data = await resp.json();
        }
        if (!ok) {
            throw createAutomationError('OPENAI_TOKEN_EXCHANGE_FAILED', 'OpenAI token endpoint 返回失败', {
                apiResult: data
            });
        }

        const decodedAccess = decodeJwt(data.access_token);
        const decodedId = decodeJwt(data.id_token);
        const authInfo = decodedAccess["https://api.openai.com/auth"] || {};
        log(logger, 'token', 'Token Bundle 解析完成', `account=${authInfo.chatgpt_account_id || '未知'}`);
        
        const accountEntry = {
            name: email,
            platform: "openai",
            type: "oauth",
            credentials: {
                access_token: data.access_token,
                chatgpt_account_id: authInfo.chatgpt_account_id,
                chatgpt_user_id: authInfo.chatgpt_user_id,
                expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
                expires_in: data.expires_in,
                organization_id: "",
                refresh_token: data.refresh_token
            },
            extra: {
                email: email,
                sub: decodedId.sub
            },
            concurrency: 10,
            priority: 1,
            rate_multiplier: 1,
            auto_pause_on_expired: true,
            plan_type: authInfo.chatgpt_plan_type || "plus"
        };

        const exportInfo = saveIndividualAccountJson(accountEntry, data, options);
        await persistProductAsset(accountEntry, exportInfo);
        return exportInfo;

    } catch (err) {
        const apiDetails = err.apiResult ? ` apiResult=${JSON.stringify(err.apiResult)}` : '';
        logger.error(`[roxy-oauth-login] phase=token action=换取 Token 失败 诊断=${err.response ? JSON.stringify(err.response.data) : err.message}${apiDetails}`);
        throw err;
    }
}

function parseOAuthCallbackUrl(callbackUrl, expectedState) {
    const parsed = new URL(callbackUrl);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    if (!code) {
        throw createAutomationError('OAUTH_CALLBACK_CODE_MISSING', 'OAuth callback URL 中没有 code', { callbackUrl });
    }
    if (expectedState && state !== expectedState) {
        throw createAutomationError('OAUTH_CALLBACK_STATE_MISMATCH', 'OAuth callback state 与本次请求不一致', {
            expectedState,
            actualState: state
        });
    }
    return { code, state, callbackUrl };
}

function getCurrentOAuthCallback(page, expectedState) {
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    if (String(currentUrl).includes('localhost:1455/auth/callback')) {
        return parseOAuthCallbackUrl(currentUrl, expectedState);
    }
    return null;
}

async function processOAuthLoginFlow(page, options = {}) {
    const logger = pickLogger(options.logger);
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const stageDetectTimeoutMs = options.stageDetectTimeoutMs || 1500;
    const maxStageTurns = options.maxStageTurns || 20;
    const email = String(options.email || Default_EMAIL || '').trim();
    if (!email) {
        throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
    }
    if (!options.verifier) {
        throw createAutomationError('OAUTH_VERIFIER_REQUIRED', 'OAuth PKCE verifier 不能为空');
    }
    if (!page || typeof page.getByRole !== 'function') {
        log(logger, 'oauth-flow', '当前 page 不支持页面状态机，跳过自动登录阶段');
        return null;
    }
    let capturedCallback = null;
    if (typeof page.waitForRequest === 'function') {
        page.waitForRequest((request) => {
            const requestUrl = typeof request.url === 'function' ? request.url() : '';
            return requestUrl.includes('localhost:1455/auth/callback');
        }, { timeout: timeoutMs }).then((request) => {
            const requestUrl = typeof request.url === 'function' ? request.url() : '';
            capturedCallback = parseOAuthCallbackUrl(requestUrl, options.state);
        }).catch(() => {});
    }

    for (let turn = 0; turn < maxStageTurns; turn += 1) {
        const callback = capturedCallback || getCurrentOAuthCallback(page, options.state);
        if (callback) {
            const exchange = options.exchangeToken || exchangeToken;
            const requestContext = options.request
                || page.request
                || (typeof page.context === 'function' ? page.context().request : null);
            const exchangeResult = await exchange(callback.code, options.verifier, email, options.proxyValue || '', {
                ...options,
                page,
                ...(requestContext ? { request: requestContext } : {}),
                logger
            });
            return {
                status: 'oauth-completed',
                code: callback.code,
                callbackUrl: callback.callbackUrl,
                exchangeResult
            };
        }

        const detectOptions = { ...options, timeoutMs: stageDetectTimeoutMs, logger };
        const actionOptions = { ...options, timeoutMs, logger };
        if (await is_openai_login_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 OpenAI 邮箱登录页');
            await openAi_login(page, email, actionOptions);
        } else if (await is_codex_login_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 Codex 授权确认页');
            await codex_login(page, actionOptions);
        } else if (await is_email_code_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到邮箱验证码页');
            await openAi_email_code(page, email, actionOptions);
            await waitForStageTransition(page, actionOptions);
        } else if (await is_phone_verify_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到手机验证方式选择页');
            await openAi_phone_verify(page, actionOptions);
        } else if (await is_phone_code_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到手机验证码页');
            await openAi_phone_code(page, actionOptions);
        } else if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(500);
        } else {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw createAutomationError('OAUTH_FLOW_TIMEOUT', 'OAuth 登录状态机未在限定轮次内完成', {
        ...(await collectPageDebug(page))
    });
}

async function waitForStageTransition(page, options = {}) {
    const timeoutMs = options.transitionTimeoutMs || 8000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (getCurrentOAuthCallback(page, options.state)) {
            return 'callback';
        }
        const detectOptions = { ...options, timeoutMs: Math.min(500, options.stageDetectTimeoutMs || 1500) };
        if (await is_codex_login_page(page, detectOptions)) return 'codex';
        if (await is_phone_verify_page(page, detectOptions)) return 'phone-verify';
        if (await is_phone_code_page(page, detectOptions)) return 'phone-code';
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(300);
        } else {
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    return 'timeout';
}

async function navigateOAuthTarget(page, targetUrl, logger) {
    try {
        await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: DEFAULT_NAVIGATION_TIMEOUT_MS
        });
    } catch (error) {
        const message = String(error?.message || error);
        if (!/ERR_CONNECTION_ABORTED|ERR_ABORTED/i.test(message)) {
            throw error;
        }
        logger.warn(`[roxy-oauth-login] phase=navigate action=导航被中断，尝试继续检查页面 诊断=${message}`);
        const currentUrl = typeof page.url === 'function' ? page.url() : '';
        if (!currentUrl) {
            throw error;
        }
    }
}

// 补账号完整流程
async function run(argv = process.argv.slice(2), deps = {}) {
    const logger = pickLogger(deps.logger);
    const env = deps.env || process.env;
    const dotenvImpl = deps.dotenv || dotenv;

    dotenvImpl.config();
    const keepOpen = shouldKeepOpen(env);
    log(logger, 'config', '读取配置', safeConfigSummary(env));

    const session = await openRoxyBrowserForAutomation(deps);
    const { page } = session;

    const pkceFactory = deps.generatePKCE || generatePKCE;
    const { verifier, challenge } = pkceFactory();
    const state = typeof deps.randomState === 'function'
        ? deps.randomState()
        : crypto.randomBytes(16).toString('hex');

    const authUrl = `https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_challenge=${challenge}&code_challenge_method=S256&codex_cli_simplified_flow=true&id_token_add_organizations=true&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code&scope=openid+profile+email+offline_access&state=${state}`;
    const targetUrl = argv[0] || authUrl;

    log(logger, 'navigate', '导航目标 URL', targetUrl);
    await navigateOAuthTarget(page, targetUrl, logger);
    await page.waitForLoadState('networkidle', { timeout: DEFAULT_IDLE_TIMEOUT_MS }).catch((error) => {
        logger.warn(`[roxy-oauth-login] phase=navigate action=等待 networkidle 诊断=${error.message}`);
    });

    const currentUrl = page.url();
    const title = await page.title();
    log(logger, 'inspect', '当前页面 URL/title', `url=${currentUrl} title=${title}`);

    const email = String(env.ROXY_OAUTH_EMAIL || Default_EMAIL || '').trim();
    const oauthResult = await processOAuthLoginFlow(page, {
        ...deps,
        email,
        verifier,
        state,
        adminAuthCookie: deps.adminAuthCookie || env.ADMIN_AUTH_COOKIE || admin_auth,
        verificationApiUrl: deps.verificationApiUrl || env.VERIFICATION_CODE_API_URL || DEFAULT_VERIFICATION_API_URL,
        proxyValue: deps.proxyValue || env.ROXY_PROXY || '',
        logger
    });

    const disconnectMode = await closeRoxyBrowserSession(session, { keepOpen, logger });

    return {
        targetUrl,
        currentUrl,
        title,
        dirId: session.dirId,
        cdpEndpoint: session.cdpEndpoint,
        keepOpen,
        disconnectMode,
        oauthResult
    };
}

async function runCli(proc = process, deps = {}) {
    try {
        const result = await run(proc.argv.slice(2), {
            ...deps,
            env: deps.env || proc.env
        });
        const logger = pickLogger(deps.logger);
        logger.log(`[roxy-oauth-login] phase=result action=CDP endpoint ws=${result.cdpEndpoint || '未获取'}`);
        if (result.cdpEndpoint) {
            logger.log(`[roxy-oauth-login] phase=result action=调试复用提示 ROXY_CDP_ENDPOINT=${result.cdpEndpoint}`);
        }
        proc.exitCode = 0;
    } catch (error) {
        const logger = pickLogger(deps.logger);
        logger.error(`❌ [roxy-oauth-login] roxy_oauth_login 失败: ${error.message || error}`);
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
    DEFAULT_TARGET_URL,
    DEFAULT_PHONE_VERIFICATION_SMS_API_URL,
    DEFAULT_VERIFICATION_API_URL,
    EMAIL_SUBTITLE_SELECTOR,
    buildCpaAuthFile,
    captureFailureScreenshot,
    codex_login,
    connectExistingRoxyByCdp,
    closeRoxyBrowserSession,
    disconnectPlaywright,
    exchangeToken,
    fetchPhoneVerificationCode,
    is_codex_login_page,
    is_email_code_page,
    is_openai_login_page,
    is_phone_code_page,
    is_phone_code_request_page,
    is_phone_verify_page,
    openAi_login,
    openAi_email_code,
    openAi_phone_code,
    openAi_phone_code_request,
    openAi_phone_verify,
    openRoxyBrowserForAutomation,
    processOAuthLoginFlow,
    run,
    runCli,
    saveIndividualAccountJson,
    session_check,
    waitForOpenAiEmailVerification
};
