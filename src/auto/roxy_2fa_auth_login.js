const crypto = require('crypto');
const base = require('./roxy_oauth_login.js');

const DEFAULT_STAGE_DETECT_TIMEOUT_MS = 1500;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;
const DEFAULT_POST_PASSWORD_STAGE_TIMEOUT_MS = 8000;

function pickLogger(logger) {
    return logger || console;
}

function log(logger, phase, action, details = '') {
    const suffix = details ? ` ${details}` : '';
    logger.log(`[roxy-2fa-auth-login] phase=${phase} action=${action}${suffix}`);
}

function logConfigured(options, phase, action, details = '') {
    if (options?.logger) {
        log(pickLogger(options.logger), phase, action, details);
    }
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

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

async function isUsableInput(locator, timeoutMs) {
    if (!await isVisible(locator, timeoutMs)) return false;
    if (typeof locator.isEnabled === 'function'
        && !await locator.isEnabled({ timeout: timeoutMs }).catch(() => false)) {
        return false;
    }
    if (typeof locator.isEditable === 'function'
        && !await locator.isEditable({ timeout: timeoutMs }).catch(() => false)) {
        return false;
    }
    return true;
}

async function collectPageDebug(page) {
    const url = typeof page.url === 'function' ? page.url() : '';
    const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
    const bodyText = String(await getBodyText(page, 1000).catch(() => '') || '').slice(0, 500);
    return { url, title, bodyText };
}

async function withFailureScreenshot(page, options, step, operation) {
    try {
        return await operation();
    } catch (error) {
        if (typeof base.captureFailureScreenshot === 'function') {
            await base.captureFailureScreenshot(page, error, step, options).catch(() => {});
        }
        throw error;
    }
}

function getFirstLocator(page, selector) {
    if (!page || typeof page.locator !== 'function') return null;
    const locator = page.locator(selector);
    return locator && typeof locator.first === 'function' ? locator.first() : locator;
}

async function fillInputWithFallback(page, roleName, value, selectors, timeoutMs) {
    const roleInput = typeof page.getByRole === 'function'
        ? page.getByRole('textbox', { name: roleName })
        : null;
    try {
        if (roleInput && typeof roleInput.waitFor === 'function') {
            await roleInput.waitFor({ state: 'visible', timeout: timeoutMs });
        } else if (!await isVisible(roleInput, timeoutMs)) {
            throw new Error(`${roleName} input not visible`);
        }
        if (typeof roleInput.click === 'function') {
            await roleInput.click();
        }
        await roleInput.fill(String(value));
        return `role-${roleName.toLowerCase().replace(/\s+/g, '-')}`;
    } catch (roleError) {
        const fallbackInput = getFirstLocator(page, selectors.join(', '));
        if (!fallbackInput) throw roleError;
        await fallbackInput.waitFor({ state: 'visible', timeout: timeoutMs });
        if (typeof fallbackInput.click === 'function') {
            await fallbackInput.click();
        }
        await fallbackInput.fill(String(value));
        return 'fallback-input';
    }
}

function resolvePassword(options = {}) {
    return String(
        options.password
        || options.openaiPassword
        || options.env?.ROXY_OAUTH_PASSWORD
        || options.env?.OPENAI_PASSWORD
        || options.env?.ROXY_OPENAI_PASSWORD
        || process.env.ROXY_OAUTH_PASSWORD
        || process.env.OPENAI_PASSWORD
        || process.env.ROXY_OPENAI_PASSWORD
        || ''
    ).trim();
}

function resolveMfaCode(options = {}) {
    const code = String(
        options.mfaCode
        || options.twoFactorCode
        || options.totpCode
        || options.env?.ROXY_OAUTH_2FA_CODE
        || options.env?.OPENAI_2FA_CODE
        || options.env?.ROXY_OPENAI_2FA_CODE
        || process.env.ROXY_OAUTH_2FA_CODE
        || process.env.OPENAI_2FA_CODE
        || process.env.ROXY_OPENAI_2FA_CODE
        || ''
    ).trim();
    if (code) return code;

    const secret = String(
        options.totpSecret
        || options.mfaSecret
        || options.env?.ROXY_OAUTH_TOTP_SECRET
        || options.env?.OPENAI_TOTP_SECRET
        || options.env?.ROXY_OPENAI_TOTP_SECRET
        || process.env.ROXY_OAUTH_TOTP_SECRET
        || process.env.OPENAI_TOTP_SECRET
        || process.env.ROXY_OPENAI_TOTP_SECRET
        || ''
    ).trim();
    return secret ? generateTotpCode(secret, options) : '';
}

async function is_openai_password_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = (await getBodyText(page, timeoutMs)).toLowerCase();
    const url = typeof page.url === 'function' ? String(page.url() || '') : '';
    const passwordInput = page.getByRole('textbox', { name: 'Password' });
    return (url.includes('/log-in/password') || bodyText.includes('enter your password'))
        && await isUsableInput(passwordInput, timeoutMs);
}

async function is_openai_mfa_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = (await getBodyText(page, timeoutMs)).toLowerCase();
    const url = typeof page.url === 'function' ? String(page.url() || '') : '';
    const codeInput = page.getByRole('textbox', { name: 'Code' });
    const hasCodeInput = await isUsableInput(codeInput, timeoutMs);
    const hasMfaUrl = url.includes('/mfa-challenge/');
    const hasMfaText = bodyText.includes('verify your identity')
        || bodyText.includes('authenticator app')
        || bodyText.includes('two-factor')
        || bodyText.includes('multi-factor');
    const looksLikeEmailCode = url.includes('/email-verification')
        || bodyText.includes('sent to your email')
        || bodyText.includes('check your inbox');
    return hasCodeInput && !looksLikeEmailCode && (hasMfaUrl || hasMfaText);
}

async function is_openai_choose_account_page(page, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
    const bodyText = (await getBodyText(page, timeoutMs)).toLowerCase();
    const url = typeof page.url === 'function' ? String(page.url() || '') : '';
    const chooseAccountButton = page.getByRole('button', { name: /select account/i });
    // 清缓存后 OpenAI 可能先展示账号选择页；2FA 流程必须接管这里，不能落回 one-time-code 基础流程。
    return (url.includes('/choose-an-account') || bodyText.includes('choose an account'))
        && bodyText.includes('select account')
        && await isVisible(chooseAccountButton, timeoutMs);
}

async function openAi_choose_account(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_choose_account', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        const email = String(options.email || '').trim();
        if (!await is_openai_choose_account_page(page, options)) {
            throw createAutomationError('OPENAI_CHOOSE_ACCOUNT_PAGE_NOT_FOUND', '当前页面不是 OpenAI 选择账号页', {
                ...(await collectPageDebug(page))
            });
        }

        // 优先选择当前补号邮箱；如果页面文案或头像结构变化，再退回第一个 Select account 按钮。
        logConfigured(options, 'openai-choose-account', '选择已有账号');
        const accountButton = email
            ? page.getByRole('button', { name: new RegExp(`select account[\\s\\S]*${escapeRegex(email)}`, 'i') })
            : page.getByRole('button', { name: /select account/i });
        if (await isVisible(accountButton, timeoutMs)) {
            await accountButton.click({ timeout: timeoutMs });
        } else {
            await page.getByRole('button', { name: /select account/i }).click({ timeout: timeoutMs });
        }
        return { status: 'account-selected', email };
    });
}

async function detectPostPasswordStage(page, options = {}) {
    const timeoutMs = Math.min(options.stageDetectTimeoutMs || 1000, options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS);
    const url = typeof page.url === 'function' ? String(page.url() || '') : '';
    const detectOptions = { ...options, timeoutMs };
    if (url.includes('localhost:1455/auth/callback')) return { stage: 'callback', url };
    if (options.ignoreStage !== 'mfa' && await is_openai_mfa_page(page, detectOptions)) return { stage: 'mfa', url };
    if (await base.is_phone_add_page(page, detectOptions)) return { stage: 'phone-add', url };
    if (await base.is_phone_verify_page(page, detectOptions)) return { stage: 'phone-verify', url };
    if (await base.is_phone_code_page(page, detectOptions)) return { stage: 'phone-code', url };
    if (await base.is_codex_login_page(page, detectOptions)) return { stage: 'codex-login', url };
    if (await base.is_email_code_page(page, detectOptions)) return { stage: 'email-code', url };
    return null;
}

async function waitForPostPasswordStage(page, options = {}) {
    const timeoutMs = options.postPasswordStageTimeoutMs
        || options.timeoutMs
        || DEFAULT_POST_PASSWORD_STAGE_TIMEOUT_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        // 提交密码或 MFA 后页面会短暂停留旧 DOM，轮询到真正的下一阶段再交还状态机。
        const stage = await detectPostPasswordStage(page, options);
        if (stage) return stage;
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(300);
        } else {
            await sleepMs(300);
        }
    }
    // 页面可能在最后一次等待期间完成导航；超时边界处必须再做一次即时复查，避免把有效后续页误报为 unknown。
    const finalStage = await detectPostPasswordStage(page, options);
    if (finalStage) return finalStage;
    return {
        stage: 'unknown',
        ...(await collectPageDebug(page))
    };
}

async function detectPostEmail2FAStage(page, options = {}) {
    const timeoutMs = Math.min(options.stageDetectTimeoutMs || 1000, options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS);
    const url = typeof page.url === 'function' ? String(page.url() || '') : '';
    const detectOptions = { ...options, timeoutMs };
    // 基础 OAuth 的邮箱提交检测偏 one-time-code；2FA 流程在 unknown 后用自己的阶段集合补判。
    if (url.includes('localhost:1455/auth/callback')) return { stage: 'callback', url };
    if (await is_openai_choose_account_page(page, detectOptions)) return { stage: 'choose-account', url };
    if (await is_openai_password_page(page, detectOptions)) return { stage: 'openai-password', url };
    if (await is_openai_mfa_page(page, detectOptions)) return { stage: 'mfa', url };
    if (await base.is_phone_add_page(page, detectOptions)) return { stage: 'phone-add', url };
    if (await base.is_phone_verify_page(page, detectOptions)) return { stage: 'phone-verify', url };
    if (await base.is_phone_code_page(page, detectOptions)) return { stage: 'phone-code', url };
    if (await base.is_codex_login_page(page, detectOptions)) return { stage: 'codex-login', url };
    if (await base.is_email_code_page(page, detectOptions)) return { stage: 'email-code', url };
    return null;
}

async function waitForPostEmail2FAStage(page, options = {}) {
    const timeoutMs = options.postEmailStageTimeoutMs
        || options.timeoutMs
        || DEFAULT_POST_PASSWORD_STAGE_TIMEOUT_MS;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        // 真实页面常在 openAi_login 返回 unknown 后才跳到 password，因此这里继续等一小段时间。
        const stage = await detectPostEmail2FAStage(page, options);
        if (stage) return stage;
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(300);
        } else {
            await sleepMs(300);
        }
    }
    // 邮箱提交后的 password/MFA 页面可能刚好在最后一次等待中渲染完成。
    const finalStage = await detectPostEmail2FAStage(page, options);
    if (finalStage) return finalStage;
    return {
        stage: 'unknown',
        ...(await collectPageDebug(page))
    };
}

async function openAi_password_login(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_password_login', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        const password = resolvePassword(options);
        if (!password) {
            throw createAutomationError('OPENAI_PASSWORD_REQUIRED', 'OpenAI 密码不能为空');
        }
        if (!await is_openai_password_page(page, options)) {
            throw createAutomationError('OPENAI_PASSWORD_PAGE_NOT_FOUND', '当前页面不是 OpenAI 密码登录页', {
                ...(await collectPageDebug(page))
            });
        }

        logConfigured(options, 'openai-password', '填写密码');
        await fillInputWithFallback(page, 'Password', password, [
            'input[type="password"]',
            'input[name="password"]',
            'input[autocomplete="current-password"]'
        ], timeoutMs);
        logConfigured(options, 'openai-password', '点击 Continue');
        await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });

        logConfigured(options, 'openai-password', '等待密码提交后页面');
        const nextStage = await waitForPostPasswordStage(page, {
            ...options,
            timeoutMs,
            stageDetectTimeoutMs: Math.min(options.stageDetectTimeoutMs || 1000, timeoutMs)
        });
        logConfigured(options, 'openai-password', '密码提交完成', `next=${nextStage.stage}`);
        if (nextStage.stage === 'unknown') {
            throw createAutomationError('OPENAI_PASSWORD_STAGE_UNKNOWN', 'OpenAI password 提交后未进入合法后续页面', {
                ...nextStage
            });
        }
        return {
            status: 'password-submitted',
            nextStage: nextStage.stage,
            nextStatus: nextStage.status || nextStage.stage,
            url: nextStage.url
        };
    });
}

async function openAi_mfa_code(page, options = {}) {
    return withFailureScreenshot(page, options, 'openAi_mfa_code', async () => {
        const timeoutMs = options.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS;
        const code = resolveMfaCode(options);
        if (!/^\d{6,8}$/.test(code)) {
            throw createAutomationError('OPENAI_MFA_CODE_REQUIRED', 'OpenAI 2FA code 必须是 6-8 位数字');
        }
        if (!await is_openai_mfa_page(page, options)) {
            throw createAutomationError('OPENAI_MFA_PAGE_NOT_FOUND', '当前页面不是 OpenAI MFA 验证页', {
                ...(await collectPageDebug(page))
            });
        }

        logConfigured(options, 'openai-mfa', '填写 2FA code', 'code=provided');
        await fillInputWithFallback(page, 'Code', code, [
            'input[autocomplete="one-time-code"]',
            'input[inputmode="numeric"]',
            'input[name="code"]',
            'input[type="tel"]',
            'input[type="text"]'
        ], timeoutMs);
        logConfigured(options, 'openai-mfa', '点击 Continue');
        await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });

        logConfigured(options, 'openai-mfa', '等待 2FA 提交后页面');
        const nextStage = await waitForPostPasswordStage(page, {
            ...options,
            timeoutMs,
            postPasswordStageTimeoutMs: options.postMfaStageTimeoutMs || options.postPasswordStageTimeoutMs,
            stageDetectTimeoutMs: Math.min(options.stageDetectTimeoutMs || 1000, timeoutMs),
            ignoreStage: 'mfa'
        });
        logConfigured(options, 'openai-mfa', '2FA 提交完成', `next=${nextStage.stage}`);
        if (nextStage.stage === 'unknown') {
            throw createAutomationError('OPENAI_MFA_STAGE_UNKNOWN', 'OpenAI MFA 提交后未进入合法后续页面', {
                ...nextStage
            });
        }
        return {
            status: 'mfa-code-submitted',
            codeLength: code.length,
            nextStage: nextStage.stage,
            nextStatus: nextStage.status || nextStage.stage,
            url: nextStage.url
        };
    });
}

async function process2FAOAuthLoginFlow(page, options = {}) {
    const logger = pickLogger(options.logger);
    const maxStageTurns = normalizePositiveInteger(options.maxStageTurns, 20);
    const stageDetectTimeoutMs = options.stageDetectTimeoutMs || DEFAULT_STAGE_DETECT_TIMEOUT_MS;
    const baseFlow = options.baseProcessOAuthLoginFlow || base.processOAuthLoginFlow;

    if (!page || typeof page.getByRole !== 'function') {
        log(logger, 'oauth-flow', '当前 page 不支持页面状态机，跳过 2FA 登录阶段');
        return baseFlow(page, options);
    }

    for (let turn = 0; turn < maxStageTurns; turn += 1) {
        const detectOptions = { ...options, timeoutMs: stageDetectTimeoutMs, logger };
        const actionOptions = { ...options, logger };
        if (await is_openai_choose_account_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 OpenAI 选择账号页');
            await openAi_choose_account(page, actionOptions);
        } else if (await base.is_openai_login_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 OpenAI 邮箱登录页');
            const emailResult = await base.openAi_login(page, options.email, actionOptions);
            log(logger, 'oauth-flow', '邮箱登录提交后阶段识别完成', `next=${emailResult?.nextStage || 'unknown'}`);
            if (emailResult?.nextStage === 'openai-password') {
                continue;
            }
            if (emailResult?.nextStage === 'unknown') {
                // 不立即失败；先按 2FA 登录可能出现的页面集合恢复一次真实后续阶段。
                const recoveredStage = await waitForPostEmail2FAStage(page, actionOptions);
                if (recoveredStage.stage === 'openai-password') {
                    log(logger, 'oauth-flow', '基础状态机未识别新版密码页，等待后按 2FA 密码页继续');
                    continue;
                }
                if (recoveredStage.stage !== 'unknown') {
                    log(logger, 'oauth-flow', '邮箱提交后等待到合法后续页面', `next=${recoveredStage.stage}`);
                    continue;
                }
                throw createAutomationError('OPENAI_2FA_POST_EMAIL_STAGE_UNKNOWN', 'OpenAI 2FA 邮箱提交后未进入合法后续页面', {
                    ...(await collectPageDebug(page))
                });
            }
        } else if (await is_openai_password_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 OpenAI 密码登录页');
            await openAi_password_login(page, actionOptions);
        } else if (await is_openai_mfa_page(page, detectOptions)) {
            log(logger, 'oauth-flow', '识别到 OpenAI MFA 验证页');
            await openAi_mfa_code(page, actionOptions);
        } else {
            log(logger, 'oauth-flow', '交给原 OAuth 状态机继续处理');
            return baseFlow(page, options);
        }
    }

    throw createAutomationError('OAUTH_2FA_FLOW_TIMEOUT', 'OAuth 2FA 登录状态机未在限定轮次内交接到后续状态', {
        ...(await collectPageDebug(page))
    });
}

function base32ToBuffer(secret) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const clean = String(secret || '').toUpperCase().replace(/[\s=-]+/g, '');
    let bits = '';
    for (const char of clean) {
        const value = alphabet.indexOf(char);
        if (value < 0) {
            throw createAutomationError('TOTP_SECRET_INVALID', 'TOTP secret 不是合法 Base32');
        }
        bits += value.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
        bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
    }
    return Buffer.from(bytes);
}

function generateHotpCode(secret, options = {}) {
    const digits = normalizePositiveInteger(options.digits, 6);
    const algorithm = String(options.algorithm || 'sha1').toLowerCase();
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

function generateTotpCode(secret, options = {}) {
    const stepSeconds = normalizePositiveInteger(options.stepSeconds, 30);
    const timestampMs = Number.isFinite(Number(options.timestampMs)) ? Number(options.timestampMs) : Date.now();
    const counter = Math.floor(Math.floor(timestampMs / 1000) / stepSeconds);
    return generateHotpCode(secret, { ...options, counter });
}

function buildPromptLoginAuthUrl(args = {}) {
    return base.buildOAuthAuthorizeUrl({ ...args, promptLogin: true });
}

async function run(argv = process.argv.slice(2), deps = {}) {
    const processOAuthLoginFlow = deps.processOAuthLoginFlow || process2FAOAuthLoginFlow;
    const buildAuthUrl = deps.buildAuthUrl || buildPromptLoginAuthUrl;
    return base.run(argv, {
        ...deps,
        buildAuthUrl,
        processOAuthLoginFlow
    });
}

async function runCli(proc = process, deps = {}) {
    try {
        const result = await run(proc.argv.slice(2), {
            ...deps,
            env: deps.env || proc.env
        });
        const logger = pickLogger(deps.logger);
        logger.log(`[roxy-2fa-auth-login] phase=result action=CDP endpoint ws=${result.cdpEndpoint || '未获取'}`);
        if (result.cdpEndpoint) {
            logger.log(`[roxy-2fa-auth-login] phase=result action=调试复用提示 ROXY_CDP_ENDPOINT=${result.cdpEndpoint}`);
        }
        proc.exitCode = 0;
    } catch (error) {
        const logger = pickLogger(deps.logger);
        logger.error(`❌ [roxy-2fa-auth-login] roxy_2fa_auth_login 失败: ${error.message || error}`);
        if (error && (error.url || error.title || error.bodyText)) {
            const bodyText = String(error.bodyText || '').replace(/\s+/g, ' ').slice(0, 300);
            logger.error(`[roxy-2fa-auth-login] phase=error action=页面状态诊断 url=${error.url || 'empty'} title=${error.title || 'empty'} body=${bodyText || 'empty'}`);
        }
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
    buildPromptLoginAuthUrl,
    generateHotpCode,
    generateTotpCode,
    is_openai_mfa_page,
    is_openai_password_page,
    is_openai_choose_account_page,
    openAi_choose_account,
    openAi_mfa_code,
    openAi_password_login,
    process2FAOAuthLoginFlow,
    resolveMfaCode,
    resolvePassword,
    run,
    runCli
};
