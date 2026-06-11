function optionalRequire(request, fallback) {
    try {
        return require(request);
    } catch (_) {
        return fallback;
    }
}

const playwrightExtra = optionalRequire('playwright-extra', null);
const { chromium } = playwrightExtra || require('playwright-core');
const stealth = optionalRequire('puppeteer-extra-plugin-stealth', () => ({}))();
const axios = optionalRequire('axios', {
    async get(url, options = {}) {
        const response = await fetch(url, {
            headers: options.headers,
            signal: AbortSignal.timeout(options.timeout || 15000)
        });
        return {
            status: response.status,
            data: await response.json().catch(async () => ({ text: await response.text().catch(() => '') }))
        };
    }
});
const fs = require('fs');
const path = require('path');
const { getImapAuthHeaders } = optionalRequire('./imap-auth', { getImapAuthHeaders: async () => ({}) });
const { fetchLatestOpenAiOtpOnce } = optionalRequire('./pool-email-imap', { fetchLatestOpenAiOtpOnce: async () => '' });
const inboxEmail = optionalRequire('./inbox-email', {});
const { extractVerificationCode } = optionalRequire('./verification-code-adapter', { extractVerificationCode: () => null });
const { createProxyBridge, closeProxyBridge } = optionalRequire('./local-proxy-bridge', {
    createProxyBridge: async () => ({ localProxy: '' }),
    closeProxyBridge: async () => {}
});
const {
    openRoxyBrowserForAutomation,
    closeRoxyBrowserSession
} = optionalRequire('./roxy_oauth_login.js', {});
// 引入加州指纹伪装库
const CaliforniaFingerprint = optionalRequire('./lib/california-fingerprint', {
    generateRandomCaliforniaFingerprint: () => ({ region: 'fallback', hardwareConcurrency: 4, deviceMemory: 8 }),
    async createCaliforniaContext(browser) {
        return { context: await browser.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles' }) };
    }
});

// 使用 stealth 插件
if (typeof chromium.use === 'function') {
    chromium.use(stealth);
}

function normalizeServicePort(env = process.env) {
    const value = String(env.PORT || 3000).trim();
    return /^\d+$/.test(value) ? value : '3000';
}

function buildDefaultVerificationApiUrl(env = process.env) {
    return `http://127.0.0.1:${normalizeServicePort(env)}/api/verification-code/latest`;
}

const DEFAULT_VERIFICATION_API_URL = buildDefaultVerificationApiUrl();

function resolveVerificationApiUrl(options = {}, env = process.env) {
    return options.verificationApiUrl
        || env.VERIFICATION_CODE_API_URL
        || buildDefaultVerificationApiUrl(env);
}

function resolveRegistrationEmailCodeApiUrl(options = {}, env = process.env) {
    return options.registrationEmailCodeApiUrl
        || options.email_code_api
        || options.emailCodeApiUrl
        || env.REGISTRATION_EMAIL_CODE_API_URL
        || env.EMAIL_CODE_API
        || env.email_code_api
        || '';
}

function verificationApiUrlForLog(verificationApiUrl, registrationEmailCodeApiUrl) {
    return registrationEmailCodeApiUrl ? 'external-email-code' : verificationApiUrl;
}

const DEFAULT_VERIFICATION_TIMEOUT_MS = 30000;
const OPENAI_REGISTRATION_ENTRY_URL = process.env.OPENAI_REGISTRATION_ENTRY_URL || 'https://chatgpt.com/';

function registerLog(logger, step, message, details = '') {
    const sink = logger || console;
    const suffix = details ? ` ${details}` : '';
    const line = `[roxy-register-openai] step=${step} ${message}${suffix}`;
    if (typeof sink.log === 'function') sink.log(line);
}

function registerWarn(logger, step, message, details = '') {
    const sink = logger || console;
    const suffix = details ? ` ${details}` : '';
    const line = `[roxy-register-openai] step=${step} ${message}${suffix}`;
    if (typeof sink.warn === 'function') sink.warn(line);
    else if (typeof sink.log === 'function') sink.log(line);
}

/**
 * 检查代理可用性
 * @param {string} proxyUrl - 代理URL
 * @returns {Promise<boolean>} - 代理是否可用
 */
async function checkProxyAvailability(proxyUrl) {
    if (!proxyUrl) return true;

    // (静默) 验证代理可用性

    try {
        const proxyConfig = {};
        const proxyMatch = proxyUrl.match(/\/\/(.*?):(.*)@(.*)/);
        if (proxyMatch) {
            proxyConfig.proxy = {
                host: proxyMatch[3].split(':')[0],
                port: parseInt(proxyMatch[3].split(':')[1]),
                auth: {
                    username: proxyMatch[1],
                    password: proxyMatch[2]
                },
                protocol: proxyUrl.split('://')[0]
            };
        }

        const response = await axios.get('https://httpbin.org/ip', {
            ...proxyConfig,
            timeout: 15000,
            validateStatus: () => true
        });

        if (response.status === 200) {
            // (静默) 代理可用
            return true;
        } else {
            console.log(`❌ [代理检查] 异常状态码: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ [代理检查] 不可用: ${error.message}`);
        return false;
    }
}

/**
 * 获取验证码的工具函数 (已加入 Bearer Token)
 */
function normalizeImapTimestamp(message) {
    const candidates = [
        message?.createdAt,
        message?.updatedAt,
        message?.receivedAt,
        message?.date,
        message?.timestamp
    ];

    for (const candidate of candidates) {
        if (!candidate) continue;
        const value = new Date(candidate).getTime();
        if (!Number.isNaN(value)) {
            return value;
        }
    }

    return Number(message?.id || 0);
}

function getRandomEmailDomain() {
    return String(process.env.RANDOM_EMAIL_DOMAIN || 'chiyiyi.cloud')
        .trim()
        .replace(/^@/, '')
        .toLowerCase()
        || 'chiyiyi.cloud';
}

function escapeRegex(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCloudEmail(email) {
    let normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
        return normalized;
    }

    const domain = getRandomEmailDomain();
    const dupRe = new RegExp(`@${escapeRegex(domain)}(?:\\.${escapeRegex(domain.split('.').pop() || '')})+$`, 'i');
    normalized = normalized.replace(dupRe, `@${domain}`);
    if (!normalized.includes('@')) {
        normalized = `${normalized}@${domain}`;
    }

    return normalized;
}

async function getLatestCode(email, maxRetries = 24, excludeCode = '', options = {}) {
    const normalizedEmail = normalizeCloudEmail(email);
    console.log(`📨 [IMAP] 正在为 ${normalizedEmail} 获取验证码...`);
    const url = 'https://imap.chiyiyi.cloud/api/admin/all-messages?limit=15';
    const onNoNewCodeFor30Seconds = typeof options.onNoNewCodeFor30Seconds === 'function'
        ? options.onNoNewCodeFor30Seconds
        : null;
    const onBeforePoll = typeof options.onBeforePoll === 'function'
        ? options.onBeforePoll
        : null;
    let lastResendAt = 0;

    for (let i = 0; i < maxRetries; i++) {
        // 每 5 轮打印一次进度，避免刷屏
        if (i === 0 || (i + 1) % 5 === 0 || i + 1 === maxRetries) {
            console.log(`📨 [IMAP] 轮询中 ${i + 1}/${maxRetries}...`);
        }

        if (onBeforePoll) {
            const recovered = await onBeforePoll(i + 1);
            if (recovered) {
                console.log('📨 [IMAP] 页面已恢复，继续等待新验证码...');
            }
        }

        try {
            let headers = await getImapAuthHeaders(false);
            const response = await axios.get(url, {
                headers
            });
            const messages = response.data.messages;
            if (Array.isArray(messages) && messages.length > 0) {
                const targetMessages = messages
                    .filter(m =>
                        m?.targetEmail?.toLowerCase() === normalizedEmail &&
                        (m?.service === 'ChatGPT' || String(m?.subject || '').toLowerCase().includes('verification'))
                    )
                    .sort((a, b) => normalizeImapTimestamp(b) - normalizeImapTimestamp(a));

                const targetMsg = targetMessages.find(m => String(m.code || '').trim() && String(m.code).trim() !== excludeCode)
                    || targetMessages.find(m => String(m.code || '').trim());

                if (targetMsg) {
                    const code = String(targetMsg.code).trim();
                    if (excludeCode && code === excludeCode) {
                        // (静默) 仍是旧验证码
                    } else {
                        console.log('📨 [IMAP] 已获取验证码: [redacted-code]');
                        return code;
                    }
                }
                // (静默) 暂未读取到新验证码
            }
            // (静默) 邮件列表为空
        } catch (err) {
            if (err.response && err.response.status === 401) {
                console.warn('📨 [IMAP] 鉴权失败 (401)，正在强制刷新 Token 后重试...');
                try {
                    const headers = await getImapAuthHeaders(true);
                    const retryResponse = await axios.get(url, { headers });
                    const messages = retryResponse.data.messages;
                    if (Array.isArray(messages) && messages.length > 0) {
                        const targetMessages = messages
                            .filter(m =>
                                m?.targetEmail?.toLowerCase() === normalizedEmail &&
                                (m?.service === 'ChatGPT' || String(m?.subject || '').toLowerCase().includes('verification'))
                            )
                            .sort((a, b) => normalizeImapTimestamp(b) - normalizeImapTimestamp(a));

                        const targetMsg = targetMessages.find(m => String(m.code || '').trim() && String(m.code).trim() !== excludeCode)
                            || targetMessages.find(m => String(m.code || '').trim());

                        if (targetMsg) {
                            const code = String(targetMsg.code).trim();
                            if (excludeCode && code === excludeCode) {
                                console.log('📨 [IMAP] 当前最新验证码仍是旧值，继续等待新验证码...');
                            } else {
                                console.log('📨 [IMAP] 成功获取验证码: [redacted-code]');
                                return code;
                            }
                        } else {
                            console.log('📨 [IMAP] 刷新 Token 后暂未读取到该邮箱的新验证码，继续轮询...');
                        }
                    } else {
                        console.log('📨 [IMAP] 刷新 Token 后邮件列表为空，继续轮询...');
                    }
                } catch (refreshErr) {
                    console.error(`📨 [IMAP] Token 刷新后轮询仍失败: ${refreshErr.message}`);
                }
            } else {
                console.error(`📨 [IMAP] 本次轮询失败: ${err.message}`);
            }
        }

        if (excludeCode && onNoNewCodeFor30Seconds && (i + 1) % 6 === 0) {
            const now = Date.now();
            if (now - lastResendAt >= 28000) {
                lastResendAt = now;
                await onNoNewCodeFor30Seconds();
            }
        }

        for (let waitTick = 0; waitTick < 10; waitTick += 1) {
            if (onBeforePoll) {
                const recovered = await onBeforePoll(i + 1);
                if (recovered) {
                    console.log('📨 [IMAP] 页面恢复完成，保持旧验证码排除，继续等待新验证码...');
                    break;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    throw new Error('获取验证码超时');
}

async function getLatestCodeMicrosoftImap(email, credentials = {}, opts = {}) {
    const maxRetries = Math.max(1, Number(opts.maxRetries || 24));
    const excludeCode = String(opts.excludeCode || '');
    const host = String(opts.host || 'outlook.office365.com').trim() || 'outlook.office365.com';
    const includeJunk = opts.includeJunk !== false;
    const password = String(credentials?.password || '');
    const clientId = String(credentials?.clientId || '');
    const refreshToken = String(credentials?.refreshToken || '');
    const onNoNewCodeFor30Seconds = typeof opts.onNoNewCodeFor30Seconds === 'function'
        ? opts.onNoNewCodeFor30Seconds
        : null;
    const onBeforePoll = typeof opts.onBeforePoll === 'function'
        ? opts.onBeforePoll
        : null;
    let lastResendAt = 0;

    const authMode = refreshToken && clientId ? 'OAuth2' : '密码';
    console.log(`📨 [MS-IMAP] 正在为 ${email} 通过 ${host} 获取验证码（${authMode}，垃圾箱${includeJunk ? '已包含' : '未包含'}）...`);

    for (let i = 0; i < maxRetries; i++) {
        // 每 5 轮打印一次进度，避免刷屏
        if (i === 0 || (i + 1) % 5 === 0 || i + 1 === maxRetries) {
            console.log(`📨 [MS-IMAP] 轮询中 ${i + 1}/${maxRetries}...`);
        }

        if (onBeforePoll) {
            const recovered = await onBeforePoll(i + 1);
            if (recovered) {
                console.log('📨 [MS-IMAP] 页面已恢复，继续等待新验证码...');
            }
        }

        try {
            const code = await fetchLatestOpenAiOtpOnce({
                email,
                password,
                clientId,
                refreshToken,
                host,
                includeJunk,
                excludeCode
            });

            if (code) {
                console.log('📨 [IMAP] 成功获取验证码: [redacted-code]');
                return code;
            }

            console.log('📨 [MS-IMAP] 暂未读取到符合条件的新验证码，继续轮询...');
        } catch (err) {
            console.error(`📨 [MS-IMAP] 本次轮询失败: ${err.message}`);
        }

        if (excludeCode && onNoNewCodeFor30Seconds && (i + 1) % 6 === 0) {
            const now = Date.now();
            if (now - lastResendAt >= 28000) {
                lastResendAt = now;
                await onNoNewCodeFor30Seconds();
            }
        }

        for (let waitTick = 0; waitTick < 10; waitTick += 1) {
            if (onBeforePoll) {
                const recovered = await onBeforePoll(i + 1);
                if (recovered) {
                    console.log('📨 [MS-IMAP] 页面恢复完成，保持旧验证码排除，继续等待新验证码...');
                    break;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    throw new Error('获取验证码超时');
}

/**
 * 生成随机字母数字字符串
 */
function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function buildPlaywrightProxy(proxyValue) {
    if (!proxyValue) return null;
    try {
        const parsed = new URL(proxyValue);
        const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
        const proxy = { server };
        if (parsed.username) {
            proxy.username = decodeURIComponent(parsed.username);
        }
        if (parsed.password) {
            proxy.password = decodeURIComponent(parsed.password);
        }
        return proxy;
    } catch (e) {
        console.warn(`⚠️  [系统] 代理 URL 解析失败，将按原始值使用: ${e.message}`);
        return { server: proxyValue };
    }
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function saveFailureScreenshot(page, prefix = 'register_openai_error') {
    if (!page || page.isClosed()) {
        return null;
    }

    const screenshotDir = path.join(__dirname, 'debug_screenshots', '注册');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `${prefix}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 [系统] 异常截图已保存: ${screenshotPath}`);
    return screenshotPath;
}

async function humanType(page, selector, text) {
    await page.focus(selector);
    for (const char of text) {
        await page.type(selector, char, { delay: Math.random() * 100 + 50 });
    }
}

async function humanClick(page, selector) {
    const element = await page.waitForSelector(selector, { visible: true });
    await element.hover();
    await sleep(Math.random() * 500 + 200);
    await element.click();
}

function visibleUrlForLog(rawUrl) {
    try {
        const url = new URL(String(rawUrl || ''));
        return `${url.origin}${url.pathname}`;
    } catch (_) {
        return String(rawUrl || '').split('?')[0].slice(0, 120);
    }
}

async function clickFirstVisibleEntryAction(page, candidates, actionName, timeoutMs = 10000) {
    for (const candidate of candidates) {
        const target = candidate.locator(page).first();
        const visible = await target.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false);
        if (!visible) {
            continue;
        }

        console.log(`[roxy-register-openai] step=navigation action=${actionName} target=${candidate.label} url=${visibleUrlForLog(page.url())}`);
        await target.click({ timeout: 10000 }).catch(async (error) => {
            console.warn(`[roxy-register-openai] step=navigation action=${actionName}-normal-click-failed target=${candidate.label} message=${String(error?.message || error).split('\n')[0]}`);
            await target.click({ force: true, timeout: 10000 });
        });
        return true;
    }
    return false;
}

const CHATGPT_SIGN_UP_CANDIDATES = [
    { label: 'role-link-sign-up', locator: (page) => page.getByRole('link', { name: /sign up|注册|创建账号|create account/i }) },
    { label: 'role-button-sign-up', locator: (page) => page.getByRole('button', { name: /sign up|注册|创建账号|create account/i }) },
    { label: 'href-create-account', locator: (page) => page.locator('a[href*="create-account"]') },
    { label: 'href-signup', locator: (page) => page.locator('a[href*="signup"], a[href*="sign-up"]') }
];

const CHATGPT_LOG_IN_CANDIDATES = [
    { label: 'data-dd-login', locator: (page) => page.locator('a[data-dd-action-name="(Missing Session) Log in to ChatGPT"]') },
    { label: 'role-link-log-in', locator: (page) => page.getByRole('link', { name: /log in|登录|登入/i }) },
    { label: 'role-button-log-in', locator: (page) => page.getByRole('button', { name: /log in|登录|登入/i }) },
    { label: 'href-login', locator: (page) => page.locator('a[href*="log-in"], a[href*="login"]') }
];

async function clearAndType(page, selector, text) {
    const input = page.locator(selector).first();
    await input.waitFor({ state: 'visible', timeout: 30000 });
    await input.click({ clickCount: 3 });
    await input.fill('');
    await sleep(Math.random() * 400 + 150);
    await humanType(page, selector, text);
}

async function ensureInputValue(page, selector, expectedValue, label = '输入框') {
    const input = page.locator(selector).first();
    await input.waitFor({ state: 'visible', timeout: 30000 });

    for (let attempt = 1; attempt <= 3; attempt++) {
        await input.click({ clickCount: 3 });
        await input.fill('');
        await sleep(Math.random() * 400 + 150);
        await humanType(page, selector, expectedValue);
        await sleep(300);

        const actualValue = String(await input.inputValue().catch(() => '') || '');
        if (actualValue.trim().toLowerCase() === String(expectedValue).trim().toLowerCase()) {
            return;
        }

        console.warn(`⚠️  [Warn] ${label} 第 ${attempt} 次写入未生效，预期=${expectedValue} 实际=${actualValue}，重试中...`);
        await input.fill(expectedValue).catch(() => { });
        const filledValue = String(await input.inputValue().catch(() => '') || '');
        if (filledValue.trim().toLowerCase() === String(expectedValue).trim().toLowerCase()) {
            return;
        }
    }

    throw new Error(`${label} 写入失败: ${expectedValue}`);
}

const OTP_INPUT_SELECTORS = [
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[name="code"]',
    'input[type="tel"]',
    'input[type="text"]'
];

const MAX_OTP_RETRIES = 5;
const OTP_RETRY_EXCEEDED_ERROR = `验证码重试超过 ${MAX_OTP_RETRIES} 次，需要重新上号`;
const OTP_REFETCH_AFTER_RECOVERY = 'OTP_REFETCH_AFTER_RECOVERY';

async function fetchRegistrationEmailVerificationCodeOnce(page, email, options = {}, attempt = 1, maxAttempts = 1) {
    const verificationApiUrl = resolveVerificationApiUrl(options);
    const registrationEmailCodeApiUrl = resolveRegistrationEmailCodeApiUrl(options);
    const timeout = Number(options.timeoutMs || DEFAULT_VERIFICATION_TIMEOUT_MS);
    const request = options.request || page?.request || (typeof page?.context === 'function' ? page.context().request : null);
    const apiUrl = verificationApiUrlForLog(verificationApiUrl, registrationEmailCodeApiUrl);

    registerLog(options.logger, 'email-code-request', 'action=request-email-code', `attempt=${attempt}/${maxAttempts} api=${apiUrl}`);

    let data;
    if (registrationEmailCodeApiUrl && request && typeof request.get === 'function') {
        const response = await request.get(registrationEmailCodeApiUrl, { timeout });
        const text = await response.text();
        data = { ok: true, code: extractVerificationCode(text) };
    } else if (registrationEmailCodeApiUrl && typeof fetch === 'function') {
        const response = await fetch(registrationEmailCodeApiUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(timeout)
        });
        const text = await response.text();
        data = { ok: response.ok, code: extractVerificationCode(text) };
    } else if (request && typeof request.post === 'function') {
        const response = await request.post(verificationApiUrl, {
            data: { account: email },
            timeout
        });
        data = await response.json();
    } else if (typeof fetch === 'function') {
        const response = await fetch(verificationApiUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ account: email }),
            signal: AbortSignal.timeout(timeout)
        });
        data = await response.json();
    } else {
        throw new Error('当前运行环境不支持通过后端 API 获取邮箱验证码');
    }

    const code = String(data?.code || '').trim();
    const validCode = data?.ok && /^\d{6}$/.test(code) ? code : '';
    registerLog(options.logger, 'email-code-request', validCode ? 'action=code-received' : 'action=code-missing', `attempt=${attempt}/${maxAttempts} code=${validCode ? 'received' : 'empty'}`);
    return {
        code: validCode,
        apiResult: data
    };
}

async function fetchRegistrationEmailVerificationCode(page, email, options = {}, excludeCode = '') {
    const maxAttempts = Math.max(1, Number(options.codePollMaxAttempts || options.maxRetries || 12));
    const intervalMs = Math.max(0, Number(options.codePollIntervalMs || 5000));
    let lastResult;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        lastResult = await fetchRegistrationEmailVerificationCodeOnce(page, email, options, attempt, maxAttempts);
        if (lastResult.code && lastResult.code !== excludeCode) {
            return lastResult.code;
        }
        if (attempt < maxAttempts) {
            await sleep(intervalMs);
        }
    }
    throw new Error(`邮箱验证码 API 未返回有效验证码，attempts=${maxAttempts}`);
}

async function findVisibleOtpSelector(page, timeout = 30000) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        for (const selector of OTP_INPUT_SELECTORS) {
            const locator = page.locator(selector).first();
            if (await locator.isVisible().catch(() => false)) {
                return selector;
            }
        }
        await page.waitForTimeout(500);
    }

    const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '').slice(0, 500);
    throw new Error(`未找到可见的验证码输入框，页面片段: ${bodyText}`);
}

async function isOtpIncorrect(page) {
    const errorPatterns = [
        '代码不正确',
        'code incorrect',
        'the code is incorrect',
        'invalid code',
        'incorrect code'
    ];

    try {
        const bodyText = String(await page.textContent('body', { timeout: 4000 }).catch(() => '') || '').toLowerCase();
        // Operation timed out / 糟糕，出错了 不算 OTP 错码，留给上层判断
        if (bodyText.includes('operation timed out') || bodyText.includes('糟糕')) {
            return false;
        }
        return errorPatterns.some(pattern => bodyText.includes(pattern.toLowerCase()));
    } catch (_) {
        return false;
    }
}

async function waitForOtpInputReady(page, recoverOperationTimeout, recoverConnectionClosed, timeout = 45000) {
    const deadline = Date.now() + timeout;
    let lastStateLog = 0;

    while (Date.now() < deadline) {
        const otpSelector = await findVisibleOtpSelector(page, 2000).catch(() => '');
        if (otpSelector) {
            return otpSelector;
        }

        if (await recoverConnectionClosed()) {
            await page.waitForTimeout(1500);
            continue;
        }

        if (await recoverOperationTimeout()) {
            console.warn('🔑 [OTP] 拿到验证码后页面又恢复了，当前验证码作废，准备重新获取新验证码...');
            throw new Error(OTP_REFETCH_AFTER_RECOVERY);
        }

        const now = Date.now();
        if (now - lastStateLog >= 5000) {
            lastStateLog = now;
            const emailVisible = await page.locator('input[type="email"]').first().isVisible().catch(() => false);
            if (emailVisible) {
                console.warn('🔑 [OTP] 已拿到验证码，但页面仍停留在邮箱页，继续等待验证码输入框或恢复流程...');
            } else {
                console.log('🔑 [OTP] 已拿到验证码，正在等待验证码输入框出现...');
            }
        }

        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => { });
        await page.waitForTimeout(1000);
    }

    const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '').slice(0, 500);
    throw new Error(`未找到可见的验证码输入框，页面片段: ${bodyText}`);
}

// 模块级标记：合并页是否已经把姓名/年龄/生日填过；用于 Step 6 跳过重复填写。
let __profileAlreadyFilled = false;

// 兼容多种 selector，新版页面 OpenAI 已经多次改过 input 的 name/id/autocomplete
const NAME_SELECTORS = [
    'input[name="name"]',
    'input[id="name"]',
    'input[autocomplete="name"]',
    'input[autocomplete="given-name"]',
    'input[placeholder*="name" i]',
    'input[placeholder*="姓名" i]'
];
const AGE_SELECTORS = [
    'input[name="age"]',
    'input[id="age"]',
    'input[autocomplete="age"]',
    'input[placeholder*="age" i]',
    'input[placeholder*="年龄" i]'
];
const BIRTH_YEAR_SELECTORS = [
    '[data-type="year"]',
    'input[name="year"]',
    'input[autocomplete="bday-year"]'
];
const BIRTH_MONTH_SELECTORS = [
    '[data-type="month"]',
    'input[name="month"]',
    'input[autocomplete="bday-month"]'
];
const BIRTH_DAY_SELECTORS = [
    '[data-type="day"]',
    'input[name="day"]',
    'input[autocomplete="bday-day"]'
];
// 新版 /about-you 是单一输入框 MM/DD/YYYY 自动格式化
const BIRTH_SINGLE_SELECTORS = [
    'input[autocomplete="bday"]',
    'input[name="birthday"]',
    'input[name="bday"]',
    'input[id="birthday"]',
    'input[id="bday"]',
    'input[placeholder*="MM" i][placeholder*="DD" i]',
    'input[placeholder*="月" i][placeholder*="日" i]'
];

/**
 * 健壮地点击「Continue/Submit」按钮，避免点中 Resend email 等同表单内的其他 submit。
 * 策略：
 *   1) 优先找「文字含 Continue / Sign up / Next / Create / 继续」的 button
 *   2) 其次找 type="submit" 但排除 name="intent"（Resend）
 *   3) 兜底选最后一个 type="submit"
 * 点完后等 URL 变化或聊天框出现；不变就换下一个 selector 再点；最多 3 次。
 *
 * @param {import('playwright').Page} page
 * @param {Object} [opts]
 * @param {string} [opts.startUrl] 当前 URL；URL 变化即视作点击成功
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.confirmTimeoutMs=5000] 单次点击后等 URL 变化的时间
 */
async function clickContinueButtonReliably(page, opts = {}) {
    const startUrl = String(opts.startUrl || page.url() || '');
    const maxAttempts = Math.max(1, Number(opts.maxAttempts || 3));
    const confirmTimeoutMs = Math.max(1000, Number(opts.confirmTimeoutMs || 5000));

    // 真正的「Resend」识别：仅当 value=resend，不能简单按 name=intent 过滤（OpenAI 的 Continue 也带 name=intent）
    const isAcceptableTarget = async (loc) => {
        try {
            if (!(await loc.isVisible().catch(() => false))) return false;
            const meta = await loc.evaluate((node) => ({
                text: (node.textContent || '').trim().toLowerCase(),
                name: (node.getAttribute('name') || '').toLowerCase(),
                value: (node.getAttribute('value') || '').toLowerCase(),
                aria: (node.getAttribute('aria-label') || '').toLowerCase()
            })).catch(() => null);
            if (!meta) return false;
            // 仅 value=resend 视为 Resend，不要因为 name=intent 一律拒绝
            if (meta.value === 'resend' || /resend/.test(meta.text + ' ' + meta.aria)) return false;
            const txt = meta.text || meta.aria;
            // 拒绝 "Continue with password / Google / Apple / Microsoft / phone" 等替代登录入口
            if (/with\s+(password|google|apple|microsoft|phone)/.test(txt)) return false;
            return true;
        } catch (_) {
            return false;
        }
    };

    const filterAcceptable = async (locOrAll) => {
        const arr = Array.isArray(locOrAll) ? locOrAll : [locOrAll];
        for (const item of arr) {
            if (item && await isAcceptableTarget(item)) {
                return item;
            }
        }
        return null;
    };

    // 候选 selectors —— 包含 OpenAI 各页面的实际按钮文案
    // 已知文案：Continue / Continue / Finish creating account / Sign up / Create account / Next / 继续 / 完成
    const PRIMARY_BTN_RE = /^\s*(continue|finish(\s+creating(\s+account)?)?|sign\s*up|create(\s+account)?|next|done|submit|继续|完成|完成创建|确认.*继续)\s*$/i;

    const candidates = [
        // 1) Accessibility tree（最稳）：等最多 8s
        async () => {
            const loc = page.getByRole('button', { name: PRIMARY_BTN_RE }).first();
            try {
                await loc.waitFor({ state: 'visible', timeout: 8000 });
            } catch (_) { return null; }
            return await filterAcceptable(loc);
        },
        // 2) DOM 文字匹配（兼容 role 不在 a11y 树的极端情况）
        async () => {
            const sel = "button:has-text('Continue'):not(:has-text('password')):not(:has-text('Google')):not(:has-text('Apple'))"
                + ", button:has-text('Finish creating')"
                + ", button:has-text('Sign up')"
                + ", button:has-text('Create account')"
                + ", button:has-text('继续')"
                + ", button:has-text('完成')";
            const loc = page.locator(sel).first();
            try {
                await loc.waitFor({ state: 'visible', timeout: 4000 });
            } catch (_) { return null; }
            return await filterAcceptable(loc);
        },
        // 3) submit 按钮 —— 排除 value=resend，不再粗暴排除 name=intent
        async () => {
            const all = await page.locator('button[type="submit"]:not([value="resend"])').all();
            return await filterAcceptable(all);
        },
        // 4) 兜底：所有 submit 的最后一个（OpenAI 通常 Continue 排在 Resend 之后）
        async () => {
            const all = await page.locator('button[type="submit"]').all();
            for (let i = all.length - 1; i >= 0; i -= 1) {
                if (await isAcceptableTarget(all[i])) return all[i];
            }
            return null;
        }
    ];

    // 失败诊断：把当前页面所有可见 button 文本列出来，便于发现为何 selector 全 miss
    const dumpVisibleButtons = async () => {
        try {
            const items = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
                return buttons.slice(0, 25).map((el) => {
                    const cs = window.getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 && r.height === 0) return null;
                    return {
                        tag: el.tagName.toLowerCase(),
                        type: el.getAttribute('type') || '',
                        name: el.getAttribute('name') || '',
                        ariaLabel: el.getAttribute('aria-label') || '',
                        text: (el.textContent || '').trim().slice(0, 40)
                    };
                }).filter(Boolean);
            });
            console.warn('🔍 [Continue] 当前可见按钮:');
            for (const it of items) {
                console.warn(`   • <${it.tag} type="${it.type}" name="${it.name}"> aria="${it.ariaLabel}" text="${it.text}"`);
            }
        } catch (_) { /* ignore */ }
    };

    let lastSelectorLabel = '';
    let consecutiveMisses = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const candIdx = Math.min(attempt - 1, candidates.length - 1);
        const find = candidates[candIdx];
        const target = await find().catch(() => null);

        if (!target) {
            console.warn(`⚠️  [Continue] 第 ${attempt} 次未找到目标按钮（候选 #${candIdx + 1}）`);
            consecutiveMisses += 1;
            if (consecutiveMisses === 2) {
                await dumpVisibleButtons();
            }
            continue;
        }
        consecutiveMisses = 0;

        // 等按钮真正可点击（visible + enabled）
        try {
            await target.waitFor({ state: 'visible', timeout: 5000 });
        } catch (_) {
            console.warn(`⚠️  [Continue] 第 ${attempt} 次按钮未变可见`);
            continue;
        }
        const disabled = await target.isDisabled().catch(() => false);
        if (disabled) {
            console.warn(`⚠️  [Continue] 第 ${attempt} 次按钮处于 disabled 状态，再等 1.5s`);
            await page.waitForTimeout(1500);
        }

        // 通过 evaluate 拿到按钮文本/属性方便日志识别
        let info = '';
        try {
            info = await target.evaluate((node) => {
                const txt = (node.textContent || '').trim().slice(0, 30);
                const intent = node.getAttribute('name') || '';
                return `text="${txt}" name="${intent}"`;
            });
        } catch (_) { }
        lastSelectorLabel = `候选#${candIdx + 1}  ${info}`;
        console.log(`👆 [Continue] 第 ${attempt}/${maxAttempts} 次点击：${lastSelectorLabel}`);

        // 鼠标悬停 + 模拟人手 click（force: true 避免被遮罩 / disabled 状态拦截）
        try {
            await target.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => { });
            await target.hover({ timeout: 3000 }).catch(() => { });
            await page.waitForTimeout(150 + Math.floor(Math.random() * 250));
            await target.click({ force: true, timeout: 5000 });
        } catch (e) {
            console.warn(`⚠️  [Continue] 第 ${attempt} 次 click 异常: ${e.message}`);
            continue;
        }

        // 点完等 URL 变化 / 聊天框出现 / 表单消失 任意一个先来
        const settled = await Promise.race([
            page.waitForFunction(
                (oldUrl) => location.href !== oldUrl,
                startUrl,
                { timeout: confirmTimeoutMs }
            ).then(() => 'urlChanged').catch(() => null),
            page.waitForSelector('#prompt-textarea', { timeout: confirmTimeoutMs }).then(() => 'chatLoaded').catch(() => null),
            (async () => {
                // 点击后表单 input[name="email"] 消失也算
                const wait = Date.now() + confirmTimeoutMs;
                while (Date.now() < wait) {
                    const stillForm = await page.locator('input[type="email"]').first().isVisible().catch(() => false);
                    if (!stillForm) return 'formGone';
                    await page.waitForTimeout(500);
                }
                return null;
            })()
        ]);

        if (settled) {
            console.log(`✅ [Continue] 第 ${attempt} 次点击生效（${settled}）`);
            return { ok: true, attempt, settled, selector: lastSelectorLabel };
        }

        // 关键：点击之后表单可能进入「请求 in-flight」状态
        //   - Continue 按钮变灰 / disabled
        //   - Code/Email 字段变只读
        // 这种状态下 OpenAI 已经接收了请求，只是代理慢、还没回。
        // 不要重点击（会触发新 OTP 或 double-submit），继续延长等待
        const inFlight = await page.evaluate(() => {
            const codeInput = document.querySelector('input[name="code"], input[autocomplete="one-time-code"]');
            const submits = Array.from(document.querySelectorAll('button[type="submit"], button[role="button"], [role="button"]'));
            const someDisabled = submits.some((b) => b.disabled || b.getAttribute('aria-disabled') === 'true' || /opacity:\s*0\.\d|cursor:\s*not-allowed/i.test(b.getAttribute('style') || ''));
            const codeReadonly = codeInput ? (codeInput.readOnly || codeInput.disabled) : false;
            return someDisabled || codeReadonly;
        }).catch(() => false);

        if (inFlight) {
            console.log(`⏳ [Continue] 第 ${attempt} 次点击后表单进入 in-flight 状态（按钮灰/字段只读），延长等待 25s...`);
            const ext = await Promise.race([
                page.waitForFunction(
                    (oldUrl) => location.href !== oldUrl,
                    startUrl,
                    { timeout: 25000 }
                ).then(() => 'urlChanged').catch(() => null),
                page.waitForSelector('#prompt-textarea', { timeout: 25000 }).then(() => 'chatLoaded').catch(() => null),
                page.waitForSelector('input[name="name"]', { timeout: 25000 }).then(() => 'profileShown').catch(() => null)
            ]);
            if (ext) {
                console.log(`✅ [Continue] 延长等待后命中：${ext}`);
                return { ok: true, attempt, settled: ext, selector: lastSelectorLabel };
            }
            console.warn(`⚠️  [Continue] 延长等待后仍未跳转，可能服务端拒绝；切换 selector 再试`);
        } else {
            console.warn(`⚠️  [Continue] 第 ${attempt} 次点击后页面未跳转，准备换 selector 重试`);
        }
    }

    return { ok: false, attempts: maxAttempts, selector: lastSelectorLabel };
}

async function findFirstVisible(page, selectors, timeout = 0) {
    const deadline = Date.now() + Math.max(0, timeout);
    do {
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.isVisible().catch(() => false)) {
                return { selector: sel, locator: loc };
            }
        }
        if (Date.now() >= deadline) {
            return null;
        }
        await page.waitForTimeout(300);
    } while (true);
}

const USER_ALREADY_EXISTS_ERROR = '该邮箱已被注册（user_already_exists），自动跳过';

async function isFormValidationError(page) {
    try {
        const bodyText = String(await page.textContent('body', { timeout: 1500 }).catch(() => '') || '').toLowerCase();
        return bodyText.includes("doesn't look right")
            || bodyText.includes('does not look right')
            || bodyText.includes('看起来不对')
            || bodyText.includes('请输入有效');
    } catch (_) {
        return false;
    }
}

async function isUserAlreadyExistsPage(page) {
    try {
        const url = page.url();
        if (url.includes('user_already_exists') || url.includes('error=user_already_exists')) {
            return true;
        }
        const bodyText = String(await page.textContent('body', { timeout: 2000 }).catch(() => '') || '').toLowerCase();
        return bodyText.includes('user_already_exists')
            || (bodyText.includes('error occurred during authentication') && bodyText.includes('already'));
    } catch (_) {
        return false;
    }
}

// 快速 + 可靠的字段填写：优先 page.fill()（一次性提交，比 humanType 快 10x），
// 失败再回退到 keyboard.type 兜底。OpenAI 没检测填表时长，无需逐字符模拟。
async function safeFillByValue(page, selector, value) {
    const locator = page.locator(selector).first();
    if (!(await locator.isVisible().catch(() => false))) {
        return false;
    }

    // 先点击聚焦（也能解除自动 readonly 状态）
    await locator.click({ clickCount: 3, timeout: 5000 }).catch(() => { });

    // 1) 优先 fill：原生 React onChange 也能稳定触发
    let okViaFill = false;
    try {
        await locator.fill(String(value), { timeout: 5000 });
        okViaFill = true;
    } catch (_) { /* 走兜底 */ }

    if (!okViaFill) {
        // 2) 兜底：键盘 Ctrl+A + Delete 清空 + type 一次性敲入
        await page.keyboard.press('Control+A').catch(() => { });
        await page.keyboard.press('Delete').catch(() => { });
        await page.keyboard.type(String(value), { delay: 30 }).catch(() => { });
    }

    // 3) 触发 input/change/blur，确保 React 状态同步（部分版本 fill 不触发 blur）
    await locator.evaluate((node) => {
        try {
            node.dispatchEvent(new Event('input', { bubbles: true }));
            node.dispatchEvent(new Event('change', { bubbles: true }));
            node.dispatchEvent(new Event('blur', { bubbles: true }));
        } catch (_) { }
    }).catch(() => { });

    await sleep(120 + Math.floor(Math.random() * 200));
    return true;
}

// 当 Email + OTP + 姓名 + 年龄/生日 出现在同一页时调用：点 Continue 之前先把档案信息一次性填完
// label：调用语义标签，便于日志区分「OTP 同页」 / 「Step 6 兜底」
async function fillProfileFieldsIfPresent(page, opts = {}) {
    const label = String(opts.label || '合并页');
    const waitMs = Math.max(0, Number(opts.waitMs || 0));

    const nameField = await findFirstVisible(page, NAME_SELECTORS, waitMs);
    if (!nameField) {
        return false;
    }

    // 短姓名：First + 空格 + Last（11~14 字符内），更接近真人填写
    const firstNames = ['James', 'Mary', 'John', 'Lisa', 'Tom', 'Anna', 'Mike', 'Eva', 'Will', 'Kate'];
    const lastNames = ['Smith', 'Brown', 'Jones', 'Davis', 'Miller', 'Lee', 'Wilson', 'Walker', 'Hall', 'King'];
    const randomName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
    console.log(`📝 [资料] (${label}) 命中姓名输入框 ${nameField.selector}，填写: ${randomName}`);
    await safeFillByValue(page, nameField.selector, randomName);

    const ageField = await findFirstVisible(page, AGE_SELECTORS, 0);
    if (ageField) {
        const randomAge = (Math.floor(Math.random() * 25) + 20).toString();
        console.log(`📝 [资料] (${label}) 命中年龄输入框 ${ageField.selector}，填写: ${randomAge}`);
        await safeFillByValue(page, ageField.selector, randomAge);
    } else {
        // 优先检测「单输入框 MM/DD/YYYY」（新版 /about-you 用这种）
        const singleBday = await findFirstVisible(page, BIRTH_SINGLE_SELECTORS, 0);
        if (singleBday) {
            const year = (Math.floor(Math.random() * 25) + 1980); // 1980 ~ 2004
            const month = Math.floor(Math.random() * 12) + 1;
            const day = Math.floor(Math.random() * 28) + 1;
            const mm = String(month).padStart(2, '0');
            const dd = String(day).padStart(2, '0');
            const yyyy = String(year);
            // 输入裸数字 8 位 MMDDYYYY，由页面自动格式化成 MM/DD/YYYY
            const raw = `${mm}${dd}${yyyy}`;
            console.log(`📝 [资料] (${label}) 命中生日单输入框 ${singleBday.selector}，输入: ${mm}/${dd}/${yyyy}`);
            const loc = page.locator(singleBday.selector).first();
            await loc.click({ clickCount: 3 }).catch(() => { });
            await loc.fill('').catch(async () => {
                await page.keyboard.press('Control+A').catch(() => { });
                await page.keyboard.press('Delete').catch(() => { });
            });
            await sleep(200);
            // 一位一位敲，让 React onChange 触发自动格式化
            for (const ch of raw) {
                await page.keyboard.type(ch, { delay: 60 + Math.floor(Math.random() * 80) });
            }
            await sleep(400);

            // 校验最终渲染：必须包含完整 4 位年份
            const finalVal = String(await loc.inputValue().catch(() => '') || '');
            if (!new RegExp(`${yyyy}$`).test(finalVal)) {
                console.warn(`⚠️  [资料] (${label}) 生日输入完成后值异常: "${finalVal}"，期望以 ${yyyy} 结尾`);
            } else {
                console.log(`✅ [资料] (${label}) 生日输入校验通过: ${finalVal}`);
            }
        } else {
            const yearField = await findFirstVisible(page, BIRTH_YEAR_SELECTORS, 0);
            if (yearField) {
                const monthField = await findFirstVisible(page, BIRTH_MONTH_SELECTORS, 0);
                const dayField = await findFirstVisible(page, BIRTH_DAY_SELECTORS, 0);
                const year = (Math.floor(Math.random() * 25) + 1980).toString();
                const month = (Math.floor(Math.random() * 12) + 1).toString().padStart(2, '0');
                const day = (Math.floor(Math.random() * 28) + 1).toString().padStart(2, '0');
                console.log(`📝 [资料] (${label}) 命中生日分段输入，填写: ${year}/${month}/${day}`);
                // 注意：分段时按 month → day → year 的常见 DOM 顺序填，避免顺序错位
                if (monthField) await safeFillByValue(page, monthField.selector, month);
                if (dayField) await safeFillByValue(page, dayField.selector, day);
                await safeFillByValue(page, yearField.selector, year);
            } else {
                console.warn(`⚠️  [资料] (${label}) 未识别到年龄/生日输入，仅填了姓名`);
            }
        }
    }

    __profileAlreadyFilled = true;
    return true;
}

async function submitOtpWithRetry(page, email, maxAttempts = MAX_OTP_RETRIES, options = {}) {
    const normalizedEmail = normalizeCloudEmail(email);
    const customFetchCode = typeof options.fetchCode === 'function' ? options.fetchCode : null;
    let lastCode = '';
    const beforeAttempt = typeof options.beforeAttempt === 'function' ? options.beforeAttempt : null;
    const waitForOtpInput = typeof options.waitForOtpInput === 'function' ? options.waitForOtpInput : null;

    const clickResendEmail = async () => {
        const resendButton = page.locator('button[type="submit"][name="intent"][value="resend"]').first();
        if (await resendButton.isVisible().catch(() => false)) {
            console.warn('🔑 [OTP] 超过 30 秒未收到新验证码，正在点击“重新发送电子邮件”...');
            await resendButton.click({ force: true }).catch(() => { });
            await page.waitForTimeout(2000);
        }
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (beforeAttempt) {
            await beforeAttempt(attempt);
        }

        const pollOpts = {
            maxRetries: attempt === 1 ? 24 : 36,
            onNoNewCodeFor30Seconds: clickResendEmail,
            onBeforePoll: async () => (beforeAttempt ? beforeAttempt(attempt) : false)
        };

        const code = customFetchCode
            ? await customFetchCode(lastCode, pollOpts)
            : await fetchRegistrationEmailVerificationCode(page, normalizedEmail, {
                maxRetries: pollOpts.maxRetries,
                codePollMaxAttempts: pollOpts.maxRetries,
                codePollIntervalMs: Number(process.env.VERIFICATION_CODE_POLL_INTERVAL_MS || 5000),
                verificationApiUrl: resolveVerificationApiUrl(),
                timeoutMs: Number(process.env.REGISTRATION_CODE_REQUEST_TIMEOUT_MS || DEFAULT_VERIFICATION_TIMEOUT_MS),
                logger: console
            }, lastCode);
        lastCode = code;
        if (beforeAttempt) {
            await beforeAttempt(attempt);
        }
        let otpSelector = '';
        try {
            otpSelector = waitForOtpInput
                ? await waitForOtpInput()
                : await findVisibleOtpSelector(page, 30000);
        } catch (error) {
            if (error && error.message === OTP_REFETCH_AFTER_RECOVERY) {
                if (attempt < maxAttempts) {
                    console.warn(`🔑 [OTP] 页面恢复后需要重新拉取验证码，准备重试 (${attempt}/${maxAttempts})...`);
                    continue;
                }
                throw new Error(OTP_RETRY_EXCEEDED_ERROR);
            }
            throw error;
        }

        console.log(`🔑 [OTP] 第 ${attempt} 次提交验证码: [redacted-code]`);
        await clearAndType(page, otpSelector, code);
        await sleep(Math.random() * 1000 + 800);

        // 兼容新版「合并页」：OTP 与姓名/年龄/生日同屏，必须一次性填完再点 Continue
        // 等 1.5s 让 React 把 profile 字段渲染出来后再扫
        const filled = await fillProfileFieldsIfPresent(page, {
            label: 'OTP 同页',
            waitMs: 1500
        }).catch((err) => {
            console.warn(`⚠️  [资料] OTP 同页填写异常: ${err.message}`);
            return false;
        });
        if (filled) {
            console.log('🔑 [OTP] 检测到合并页，已在同页填写资料');
        } else {
            console.log('🔑 [OTP] 当前页未发现资料字段，按独立 OTP 页处理');
        }

        await sleep(Math.random() * 600 + 400);
        const otpClickResult = await clickContinueButtonReliably(page, {
            startUrl: page.url(),
            maxAttempts: 3,
            confirmTimeoutMs: 20000     // OTP 提交后服务端响应可能要 10-20s（代理慢）
        });
        if (!otpClickResult.ok) {
            console.warn('⚠️  [OTP] 多次点击 Continue 仍未跳转，将进入下一阶段判定');
        }
        await page.waitForTimeout(2000);

        if (await isUserAlreadyExistsPage(page)) {
            throw new Error(USER_ALREADY_EXISTS_ERROR);
        }

        if (!(await isOtpIncorrect(page))) {
            return code;
        }

        if (attempt < maxAttempts) {
            console.warn(`🔑 [OTP] 验证码被判定为错误，等待新验证码后重试 (${attempt}/${maxAttempts})...`);
        }
    }

    throw new Error(OTP_RETRY_EXCEEDED_ERROR);
}

const store = optionalRequire('./mysql-store', {
    getActiveProxy: async () => '',
    markPoolEmailRegistered: async () => {},
    releasePoolEmailReservation: async () => {}
});

async function runRegistrationFlow() {
    // (静默) Banner

    const poolEmailId = Number(process.env.POOL_EMAIL_ID || 0) || 0;
    const rawPoolEmail = String(process.env.POOL_EMAIL || '').trim().toLowerCase();
    const poolImapPass = String(process.env.POOL_EMAIL_PASSWORD || '');
    const poolClientId = String(process.env.POOL_EMAIL_CLIENT_ID || '');
    const poolRefreshToken = String(process.env.POOL_EMAIL_REFRESH_TOKEN || '');
    const poolImapHost = String(process.env.POOL_EMAIL_IMAP_HOST || 'outlook.office365.com').trim() || 'outlook.office365.com';
    const poolIncludeJunk = String(process.env.POOL_EMAIL_INCLUDE_JUNK || '1') !== '0';

    const emailSource = String(process.env.EMAIL_SOURCE || 'pool').toLowerCase();
    const inboxApiBase = String(process.env.INBOX_API_BASE || 'https://temp-email-api.jzqkwl.com').trim().replace(/\/+$/, '');
    const inboxEmailDomain = String(process.env.INBOX_EMAIL_DOMAIN || '').trim().replace(/^@/, '');
    // 多域名候选：每次随机挑一个，避免单一域名被风控/限频
    const inboxEmailDomainsList = String(process.env.INBOX_EMAIL_DOMAINS || '')
        .split(/[\n,;\s]+/)
        .map((d) => d.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
    const pickInboxDomain = () => {
        if (inboxEmailDomainsList.length > 0) {
            return inboxEmailDomainsList[Math.floor(Math.random() * inboxEmailDomainsList.length)];
        }
        return inboxEmailDomain || '';
    };

    const hasOauth = Boolean(poolEmailId && rawPoolEmail && poolClientId && poolRefreshToken);
    const hasPlainPwd = Boolean(poolEmailId && rawPoolEmail && poolImapPass);
    const usePoolImap = (emailSource === 'pool') && (hasOauth || hasPlainPwd);
    const useInbox = emailSource === 'inbox';
    const requestedRegisterEmail = String(process.env.ROXY_REGISTER_EMAIL || process.env.ROXY_OAUTH_EMAIL || '').trim().toLowerCase();

    let email = '';
    let inboxJwt = '';
    if (requestedRegisterEmail) {
        email = requestedRegisterEmail;
        console.log(`📬 [roxy-register-openai] step=config 使用指定注册邮箱 ${email}`);
    } else if (usePoolImap) {
        email = rawPoolEmail;
        console.log(`📬 [邮箱池] 使用预留邮箱 ${email}`);
        console.log(`📡 [邮箱池] 主机 ${poolImapHost}  ·  认证 ${hasOauth ? '🔐 OAuth2' : '🔑 密码'}`);
    } else if (useInbox) {
        // 候选域名按顺序尝试，被服务端拒绝的（HTTP 400 Invalid domain）自动跳过
        // 全部都不行就退到"不指定域名"让 API 用默认值
        const tryOrder = inboxEmailDomainsList.length > 0
            ? [...inboxEmailDomainsList].sort(() => Math.random() - 0.5)
            : [inboxEmailDomain];
        tryOrder.push(''); // 兜底：让 API 自己选

        let lastErr = null;
        let usedDomain = '';
        for (const tryDomain of tryOrder) {
            try {
                const newInbox = await inboxEmail.createAddress({
                    baseUrl: inboxApiBase,
                    domain: tryDomain || undefined
                });
                email = newInbox.address;
                inboxJwt = newInbox.jwt;
                usedDomain = tryDomain || '默认';
                break;
            } catch (e) {
                lastErr = e;
                const msg = String(e?.message || '').slice(0, 120);
                // 只在被服务端拒绝时才静默切换；其它错误（网络等）也尝试下一个但记一笔
                if (msg.includes('Invalid domain') || msg.includes('HTTP 400')) {
                    console.warn(`⚠️ [Inbox] 域名 @${tryDomain || '默认'} 被服务端拒绝，跳过`);
                } else {
                    console.warn(`⚠️ [Inbox] 域名 @${tryDomain || '默认'} 异常: ${msg}`);
                }
            }
        }

        if (!email) {
            // 所有候选都失败了，干脆抛错，让父进程换号重试
            throw new Error(`Inbox 临时邮箱创建失败：所有候选域名均不可用 (${tryOrder.filter(Boolean).join(', ')})`);
        }

        const domainHint = inboxEmailDomainsList.length > 0
            ? `（候选 ${inboxEmailDomainsList.length} 域名 · 本次 @${usedDomain}）`
            : `（@${usedDomain}）`;
        console.log(`📨 [Inbox] 临时邮箱已创建: ${email} ${domainHint}`);
    } else {
        if (emailSource !== 'random' || !process.env.IMAP_ADMIN_PASSWORD) {
            throw new Error('邮箱池模式未拿到可用邮箱凭证，且远程 random 邮箱未启用；不会回退到源码默认服务器');
        }
        const randomDomain = getRandomEmailDomain();
        email = normalizeCloudEmail(`${generateRandomString(15).toLowerCase()}@${randomDomain}`);
        console.log(`🎲 [随机邮箱] 本次使用 ${email}`);
    }

    const DEBUG_HEADFUL = process.env.HEADFUL === '1';
    const DEBUG_PAUSE_ON_ERROR_MS = Number(process.env.DEBUG_PAUSE_ON_ERROR_MS || (DEBUG_HEADFUL ? 30000 : 0));
    const keepRoxyOpen = /^(1|true|yes)$/i.test(String(process.env.ROXY_KEEP_OPEN || ''));

    let browser;
    let roxySession = null;
    let page = null;
    let proxyBridgeStarted = false;
    try {
        if (typeof openRoxyBrowserForAutomation !== 'function') {
            throw new Error('RoxyBrowser 自动化入口不可用：缺少 openRoxyBrowserForAutomation');
        }

        console.log('[roxy-register-openai] step=roxy action=open-browser');
        roxySession = await openRoxyBrowserForAutomation({ logger: console });
        page = roxySession.page;
        browser = roxySession.browser;
        console.log(`[roxy-register-openai] step=roxy action=connected dirId=${roxySession.dirId || ''} cdp=${roxySession.cdpEndpoint ? 'set' : 'unset'}`);

        const isOperationTimedOutPage = async () => {
            try {
                const bodyText = await page.textContent('body', { timeout: 3000 }).catch(() => "");
                return bodyText.includes('Operation timed out') || bodyText.includes('糟糕，出错了');
            } catch (_) {
                return false;
            }
        };

        const isConnectionClosedPage = async () => {
            try {
                const bodyText = await page.textContent('body', { timeout: 3000 }).catch(() => "");
                return bodyText.includes('ERR_CONNECTION_CLOSED')
                    || bodyText.includes('无法访问此网站')
                    || bodyText.includes('意外终止了连接')
                    || bodyText.includes('This site can’t be reached')
                    || bodyText.includes('This site cannot be reached');
            } catch (_) {
                return false;
            }
        };

        const restartFromCreateAccount = async () => {
            console.warn("⚠️  [Warn] 检测到超时错误页，准备从创建账户重新开始并重新提交邮箱...");
            console.log(`[roxy-register-openai] step=navigation action=goto-chatgpt-entry url=${OPENAI_REGISTRATION_ENTRY_URL}`);
            await page.goto(OPENAI_REGISTRATION_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('body', { visible: true, timeout: 30000 });
            await sleep(Math.random() * 1200 + 800);
            let enteredRegister = await clickFirstVisibleEntryAction(page, CHATGPT_SIGN_UP_CANDIDATES, 'click-sign-up', 6000);
            if (!enteredRegister) {
                const enteredLogin = await clickFirstVisibleEntryAction(page, CHATGPT_LOG_IN_CANDIDATES, 'click-log-in', 10000);
                if (!enteredLogin) {
                    throw new Error(`注册入口加载失败：未找到 ChatGPT 登录/注册按钮，URL=${visibleUrlForLog(page.url())}`);
                }
                await sleep(Math.random() * 1200 + 600);
                enteredRegister = await clickFirstVisibleEntryAction(page, CHATGPT_SIGN_UP_CANDIDATES, 'click-create-account', 15000);
            }
            if (!enteredRegister) {
                throw new Error(`注册入口加载失败：未找到创建账号按钮，URL=${visibleUrlForLog(page.url())}`);
            }
            await page.waitForSelector('input[type="email"]', { visible: true, timeout: 30000 });
            await sleep(Math.random() * 1200 + 600);
            console.log("ℹ️  [Info] 超时恢复：正在重新输入邮箱...");
            await ensureInputValue(page, 'input[type="email"]', email, '邮箱输入框');
            await sleep(Math.random() * 800 + 500);
            await humanClick(page, 'button[type="submit"]');
        };

        // 同一段流程中已尝试过的「Operation timed out」恢复次数；超过阈值直接抛错让父进程换号/换代理
        let operationTimedOutRecoverCount = 0;
        const MAX_OPERATION_TIMEOUT_RECOVERIES = 1;

        const recoverOperationTimeout = async () => {
            if (!(await isOperationTimedOutPage())) {
                return false;
            }

            if (operationTimedOutRecoverCount >= MAX_OPERATION_TIMEOUT_RECOVERIES) {
                throw new Error('代理或网络持续超时（Operation timed out），需要换号/换代理');
            }
            operationTimedOutRecoverCount += 1;
            console.warn(`⚠️  [Warn] 检测到 OpenAI 超时页 (第 ${operationTimedOutRecoverCount} 次)，尝试点击“重试”，然后重新回到邮箱输入流程...`);
            const retryButton = page.getByRole('button', { name: /重试|Try again/i }).first();
            await retryButton.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
            if (await retryButton.isVisible().catch(() => false)) {
                let clicked = false;
                clicked = await retryButton.click({ force: true }).then(() => true).catch(() => false);
                if (!clicked) {
                    clicked = await retryButton.dispatchEvent('click').then(() => true).catch(() => false);
                }
                if (!clicked) {
                    clicked = await retryButton.evaluate((node) => {
                        if (node instanceof HTMLElement) {
                            node.click();
                            return true;
                        }
                        return false;
                    }).catch(() => false);
                }
                if (clicked) {
                    console.log("ℹ️  [Info] 超时恢复：已点击“重试”按钮。");
                    await sleep(3000);
                } else {
                    console.warn("⚠️  [Warn] 超时恢复：未能成功点击“重试”按钮，将尝试直接回到注册入口。");
                }
            }

            if (await isOperationTimedOutPage()) {
                await restartFromCreateAccount();
            } else {
                const createAccountLink = page.locator('a[href="/create-account"]').first();
                const emailInput = page.locator('input[type="email"]').first();
                if (await createAccountLink.isVisible().catch(() => false)) {
                    console.log("ℹ️  [Info] 超时恢复：已回到 create-account 入口，正在重新点击...");
                    await sleep(Math.random() * 1200 + 600);
                    await createAccountLink.click({ force: true }).catch(() => { });
                    await page.waitForSelector('input[type="email"]', { visible: true, timeout: 30000 });
                }
                const emailReady = await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { })
                    .then(async () => {
                        await page.waitForTimeout(1500);
                        return emailInput.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
                    });
                if (emailReady) {
                    console.log("ℹ️  [Info] 超时恢复：邮箱页已加载完成，正在重新输入邮箱...");
                    await sleep(Math.random() * 1200 + 600);
                    await ensureInputValue(page, 'input[type="email"]', email, '邮箱输入框');
                    await sleep(Math.random() * 800 + 500);
                    await humanClick(page, 'button[type="submit"]');
                    await page.waitForTimeout(1500);

                    const recoveredToOtp = await Promise.race([
                        findVisibleOtpSelector(page, 15000).then(() => true).catch(() => false),
                        page.waitForTimeout(15000).then(() => false)
                    ]);

                    if (recoveredToOtp) {
                        console.log("ℹ️  [Info] 超时恢复：已重新提交邮箱，并回到验证码页面。");
                    } else {
                        console.warn("⚠️  [Warn] 超时恢复：邮箱已重新提交，但验证码页尚未明确出现，后续继续等待页面推进。");
                    }
                }
            }

            return true;
        };

        const waitForNextRegistrationStep = async (timeout = 15000) => {
            const deadline = Date.now() + timeout;

            while (Date.now() < deadline) {
                if (await recoverOperationTimeout()) {
                    await page.waitForTimeout(1500);
                    continue;
                }

                if (await page.locator('input[name="new-password"]').first().isVisible().catch(() => false)) {
                    return 'password';
                }

                if (await page.locator('text=Verify you are human').first().isVisible().catch(() => false)) {
                    return 'captcha';
                }

                const otpVisible = await Promise.race([
                    findVisibleOtpSelector(page, 1200).then(() => true).catch(() => false),
                    page.waitForTimeout(1200).then(() => false)
                ]);
                if (otpVisible) {
                    return 'otp';
                }
            }

            return 'unknown';
        };

        const recoverConnectionClosed = async () => {
            if (!(await isConnectionClosedPage())) {
                return false;
            }

            console.warn("⚠️  [Warn] 检测到浏览器连接关闭错误页，正在尝试自动重载...");
            for (let attempt = 1; attempt <= 3; attempt++) {
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
                    return page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                });
                await page.waitForTimeout(3000);
                if (!(await isConnectionClosedPage())) {
                    console.log(`ℹ️  [Info] 连接关闭错误页已恢复 (第 ${attempt} 次重载成功)。`);
                    return true;
                }
            }

            const currentUrl = page.url();
            if (currentUrl) {
                await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await page.waitForTimeout(3000);
            }

            return !(await isConnectionClosedPage());
        };

        // 监听崩溃事件并尝试恢复
        page.on('crash', async () => {
            console.error("❌ [Fatal] 页面崩溃！正在尝试重新加载...");
            await page.reload().catch(() => { });
        });

        console.log("🧭 [Step 1] 正在访问 OpenAI 注册入口...");

        // 检测 OpenAI 鉴权出错页（/auth/error?error=undefined 等）
        const isAuthErrorPage = async () => {
            try {
                const u = page.url();
                if (u.includes('/auth/error') || u.includes('chatgpt.com/api/auth/error')) {
                    return true;
                }
                const bodyText = String(await page.textContent('body', { timeout: 1500 }).catch(() => '') || '').toLowerCase();
                return bodyText.includes('access denied')
                    || bodyText.includes('something went wrong, please try again later')
                    || bodyText.includes('unable to load');
            } catch (_) {
                return false;
            }
        };

        // 自动刷新辅助函数：如果页面内容过少（空白）或崩溃，则持续刷新直到成功或达到上限
        const ensurePageLoaded = async (selector, actionName = "未知步骤", maxReloads = 5, waitTimeout = 30000) => {
            for (let i = 0; i < maxReloads; i++) {
                try {
                    // 命中 OpenAI auth/error → 立即抛错让父进程换代理重试，不再耗时刷新
                    if (await isAuthErrorPage()) {
                        throw new Error(`OpenAI 鉴权服务异常 (auth/error)，需要换代理重试，URL=${page.url()}`);
                    }

                    if (await recoverConnectionClosed()) {
                        if (selector) {
                            await page.waitForSelector(selector, { visible: true, timeout: waitTimeout });
                        }
                        return true;
                    }

                    if (await recoverOperationTimeout()) {
                        if (selector) {
                            await page.waitForSelector(selector, { visible: true, timeout: waitTimeout });
                        }
                        return true;
                    }

                    // 检查页面内容是否为空或包含错误
                    const bodyText = await page.textContent('body', { timeout: 5000 }).catch(() => "");

                    // 如果 body 只有几个字符，或者内容太短，判定为加载失败/空白
                    if (bodyText.trim().length < 50) {
                        console.warn(`⚠️  [Warn] 检测到页面可能为空白 (${actionName})，正在尝试第 ${i + 1} 次刷新...`);
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
                            // 如果 reload 失败（可能页面彻底死掉），尝试重新 goto
                            return page.goto(page.url(), { waitUntil: 'domcontentloaded' });
                        });
                        await new Promise(r => setTimeout(r, 2000));
                        continue;
                    }

                    // 检查目标元素是否存在
                    if (selector) {
                        await page.waitForSelector(selector, { visible: true, timeout: waitTimeout });
                    }
                    return true; // 成功加载
                } catch (err) {
                    // OpenAI 鉴权出错页：让它快速失败，不要再循环刷新了
                    if (String(err?.message || '').includes('OpenAI 鉴权服务异常')
                        || (await isAuthErrorPage())) {
                        throw new Error(`OpenAI 鉴权服务异常 (auth/error)，需要换代理重试，URL=${page.url()}`);
                    }
                    console.warn(`⚠️  [Warn] ${actionName} 等待超时或崩溃: ${err.message}，正在刷新...`);
                    if (await recoverOperationTimeout()) {
                        if (selector) {
                            const visible = await page.locator(selector).first().isVisible().catch(() => false);
                            if (visible) {
                                return true;
                            }
                        } else {
                            return true;
                        }
                    }
                    await page.reload({ waitUntil: 'domcontentloaded' }).catch(async () => {
                        // 如果 reload 失败，强制重新访问当前 URL
                        return page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => { });
                    });
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
            throw new Error(`${actionName} 失败：多次刷新或崩溃后页面仍无法正常显示`);
        };

        console.log(`[roxy-register-openai] step=navigation action=goto-chatgpt-entry url=${OPENAI_REGISTRATION_ENTRY_URL}`);
        await page.goto(OPENAI_REGISTRATION_ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await ensurePageLoaded(null, "ChatGPT 入口加载");

        await sleep(Math.random() * 2000 + 1000);
        let enteredRegister = await clickFirstVisibleEntryAction(page, CHATGPT_SIGN_UP_CANDIDATES, 'click-sign-up', 6000);
        if (!enteredRegister) {
            const enteredLogin = await clickFirstVisibleEntryAction(page, CHATGPT_LOG_IN_CANDIDATES, 'click-log-in', 12000);
            if (!enteredLogin) {
                throw new Error(`注册入口加载失败：未找到 ChatGPT 登录/注册按钮，URL=${visibleUrlForLog(page.url())}`);
            }

            await ensurePageLoaded(null, "登录页加载", 3, 30000);
            await sleep(Math.random() * 1500 + 500);
            enteredRegister = await clickFirstVisibleEntryAction(page, CHATGPT_SIGN_UP_CANDIDATES, 'click-create-account', 15000);
        }
        if (!enteredRegister) {
            throw new Error(`注册入口加载失败：未找到创建账号按钮，URL=${visibleUrlForLog(page.url())}`);
        }
        await recoverOperationTimeout();

        console.log('[roxy-register-openai] step=fill-email action=start');
        console.log("📧 ℹ️  [Info] 正在输入邮箱...");

        await ensurePageLoaded('input[type="email"]', "邮箱输入框加载");
        await recoverOperationTimeout();
        await sleep(Math.random() * 1500 + 1000);
        await ensureInputValue(page, 'input[type="email"]', email, '邮箱输入框');

        await sleep(Math.random() * 1000 + 800); // 拟人提交前停顿
        await humanClick(page, 'button[type="submit"]');

        console.log("⏳ [等待] 正在检测下一步流程（验证码 / 创建密码 / 合并页）...");
        await recoverOperationTimeout();
        const nextStep = await waitForNextRegistrationStep(20000);

        if (nextStep === 'password') {
            console.log("🔒 [Step 4.5] 检测到创建密码页面，正在生成随机密码...");
            const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
            let randomPassword = "";
            for (let i = 0; i < 12; i++) {
                randomPassword += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            await sleep(Math.random() * 1500 + 1000);
            await humanType(page, 'input[name="new-password"]', randomPassword);
            await sleep(Math.random() * 1000 + 500);
            await humanClick(page, 'button[type="submit"]');
            console.log("✅ [密码] 密码设置完成，正在进入验证码阶段...");
        } else if (nextStep === 'captcha') {
            console.log("⚠️ [挑战] 触发了真人验证，请手动处理或检查代理...");
        }

        console.log("🔑 [Step 5] 正在从邮箱获取验证码...");

        // 进入 OTP 阶段前先确诊：若仍处于 Operation timed out / 连接关闭页 / 已注册错误页，提前抛错避免空等
        if (await isUserAlreadyExistsPage(page)) {
            throw new Error(USER_ALREADY_EXISTS_ERROR);
        }
        if (await isOperationTimedOutPage()) {
            throw new Error('代理或网络持续超时（Operation timed out），需要换号/换代理');
        }
        if (await isConnectionClosedPage()) {
            await recoverConnectionClosed();
            if (await isConnectionClosedPage()) {
                throw new Error('浏览器连接被代理多次关闭，需要换代理');
            }
        }

        await findVisibleOtpSelector(page, 30000);
        await sleep(Math.random() * 1500 + 1000);
        const fetchCodeFn = async (excludeCode, pollOpts) => fetchRegistrationEmailVerificationCode(page, email, {
            maxRetries: pollOpts.maxRetries,
            codePollMaxAttempts: pollOpts.maxRetries,
            codePollIntervalMs: Number(process.env.VERIFICATION_CODE_POLL_INTERVAL_MS || 5000),
            verificationApiUrl: resolveVerificationApiUrl(),
            timeoutMs: Number(process.env.REGISTRATION_CODE_REQUEST_TIMEOUT_MS || DEFAULT_VERIFICATION_TIMEOUT_MS),
            logger: console
        }, excludeCode);

        await submitOtpWithRetry(page, email, MAX_OTP_RETRIES, {
            fetchCode: fetchCodeFn,
            beforeAttempt: async () => recoverOperationTimeout(),
            waitForOtpInput: async () => waitForOtpInputReady(page, recoverOperationTimeout, recoverConnectionClosed, 45000)
        });

        console.log("📝 [Step 6] 正在完善个人资料（如果需要）...");
        await page.waitForTimeout(3000);

        // 重要：OpenAI 现在还有第三种流程，OTP 提交后会跳到 /about-you 独立资料页
        // 等最多 12 秒看页面是否进入 chatgpt.com / about-you / 字段就位（每 250ms 检查一次，命中即出）
        const stepSixDeadline = Date.now() + 12000;
        while (Date.now() < stepSixDeadline) {
            const u = page.url();
            if (u.includes('chatgpt.com')) break;
            if (u.includes('/about-you')) break;
            const fieldNow = await findFirstVisible(page, NAME_SELECTORS, 0);
            if (fieldNow) break;
            await page.waitForTimeout(250);
        }
        const stepSixUrl = page.url();
        console.log(`ℹ️  [Step 6] 当前 URL = ${stepSixUrl}`);

        const profileFieldNow = await findFirstVisible(page, NAME_SELECTORS, 0);

        if (stepSixUrl.includes('chatgpt.com')) {
            console.log("✅ [Step 6] 已直接进入 chatgpt.com，跳过。");
        } else if (__profileAlreadyFilled && !profileFieldNow && !stepSixUrl.includes('/about-you')) {
            console.log("✅ [Step 6] OTP 同页已填且 name 输入框已消失，跳过。");
        } else {
            const isAboutYou = stepSixUrl.includes('/about-you');
            const labelTag = isAboutYou ? 'Step 6 · about-you' : 'Step 6 · 通用';
            const fillWaitMs = isAboutYou ? 15000 : 6000;
            if (isAboutYou) {
                console.log("📝 [Step 6] 检测到独立资料页 /about-you，等待表单渲染并填写...");
            } else if (!profileFieldNow) {
                console.log("ℹ️  [Step 6] 未发现 name 输入框，等待最多 6s 再判...");
            }

            const filled = await fillProfileFieldsIfPresent(page, {
                label: labelTag,
                waitMs: fillWaitMs
            }).catch((err) => {
                console.warn(`⚠️  [Step 6] 资料填写异常: ${err.message}`);
                return false;
            });

            if (filled) {
                await sleep(Math.random() * 1200 + 800);
                console.log("📝 [Step 6] 资料填写完成，点击 Continue...");
                const click6 = await clickContinueButtonReliably(page, {
                    startUrl: page.url(),
                    maxAttempts: 3,
                    confirmTimeoutMs: 20000
                });
                if (!click6.ok) {
                    console.warn('⚠️  [Step 6] 多次点击 Continue 仍未跳转，进入兜底判定');
                }

                // 内联校验错误先于 URL 等待检测
                await page.waitForTimeout(2500);
                if (await isFormValidationError(page)) {
                    throw new Error('个人资料表单校验失败（生日格式或字段被前端拒绝），换号重试');
                }

                await Promise.race([
                    page.waitForURL((u) => String(u || '').includes('chatgpt.com'), { timeout: 25000 }).catch(() => { }),
                    page.waitForSelector('#prompt-textarea', { timeout: 25000 }).catch(() => { })
                ]);
            } else if (isAboutYou) {
                console.warn("⚠️  [Step 6] /about-you 表单字段无法定位，可能 OpenAI 改版，需要查看截图");
            } else {
                console.log("ℹ️  [Step 6] 资料字段未出现，按已提交处理。");
            }
        }
        // ===== Step 6 结束 =====

        console.log("🎯 [Wait] 正在等待聊天对话框出现（判定注册成功）...");
        try {
            // 等待聊天框出现，这比判断 URL 更稳健
            await page.waitForSelector('#prompt-textarea', { state: 'visible', timeout: 45000 });
            console.log("✅ [成功] 已检测到聊天输入框，确认进入主站。");
        } catch (e) {
            if (await isUserAlreadyExistsPage(page)) {
                throw new Error(USER_ALREADY_EXISTS_ERROR);
            }
            const finalUrl = page.url();
            console.warn(`⚠️  [Warn] 未直接发现对话框，检查当前 URL: ${finalUrl}`);
            if (finalUrl.includes('chatgpt.com')) {
                console.log('ℹ️  [Info] 已在 chatgpt.com 域名下，继续抓 Token。');
            } else if (finalUrl.includes('/about-you')) {
                // 卡在 /about-you：表单大概率没填好（点了 Continue 但校验失败）
                // 再尝试填一次（强等 15s）然后点
                console.warn('⚠️  [Warn] 仍停留在 /about-you，尝试重新填写表单后提交...');
                const filled = await fillProfileFieldsIfPresent(page, {
                    label: '[Wait] /about-you 兜底',
                    waitMs: 15000
                }).catch(() => false);
                if (filled) {
                    await sleep(800);
                    await clickContinueButtonReliably(page, {
                        startUrl: page.url(),
                        maxAttempts: 3,
                        confirmTimeoutMs: 8000
                    });
                    await page.waitForURL((u) => String(u || '').includes('chatgpt.com'), { timeout: 30000 }).catch(() => { });
                }
                if (!page.url().includes('chatgpt.com')) {
                    throw new Error('注册后未能成功进入主站页面（卡在 /about-you）');
                }
            } else if (finalUrl.includes('email-verification') || finalUrl.includes('auth.openai.com')) {
                console.warn('⚠️  [Warn] 仍停留在 OpenAI auth 页面，尝试再次点击 Continue 兜底...');
                await clickContinueButtonReliably(page, {
                    startUrl: page.url(),
                    maxAttempts: 3,
                    confirmTimeoutMs: 8000
                });
                await page.waitForTimeout(2000);
                if (await isUserAlreadyExistsPage(page)) {
                    throw new Error(USER_ALREADY_EXISTS_ERROR);
                }
                if (!page.url().includes('chatgpt.com')) {
                    throw new Error('注册后未能成功进入主站页面');
                }
            } else {
                throw new Error('注册后未能成功进入主站页面');
            }
        }

        console.log("🎟️ [Step 7] 正在获取 Session 信息...");
        // 等待 session 接口完成，如果返回空白则重试
        let sessionData = null;
        for (let i = 0; i < 5; i++) {
            console.log(`🎟️ [Session] 第 ${i + 1}/5 次尝试获取 Access Token...`);
            try {
                // 确保已经在 chatgpt.com 域名下再访问 api
                if (!page.url().includes('chatgpt.com')) {
                    console.log(`🎟️ [Session] 当前不在 chatgpt.com，先跳转主站...`);
                    await page.goto("https://chatgpt.com", { waitUntil: 'networkidle', timeout: 120000 });
                }
                console.log(`🎟️ [Session] 正在请求 /api/auth/session（最长等待 2 分钟）...`);
                // 启动心跳日志，每 30 秒打印一次，避免触发父进程 idle timeout
                let heartbeatCount = 0;
                const heartbeat = setInterval(() => {
                    heartbeatCount++;
                    console.log(`🎟️ [Session] 仍在等待响应... (${heartbeatCount * 30}s)`);
                }, 30000);
                try {
                    await page.goto("https://chatgpt.com/api/auth/session", { waitUntil: 'networkidle', timeout: 120000 });
                } finally {
                    clearInterval(heartbeat);
                }
                const content = await page.textContent('body');
                if (content && content.includes('accessToken')) {
                    sessionData = JSON.parse(content);
                    break;
                } else {
                    console.warn(`⚠️  [Warn] Session 页面内容异常，正在尝试刷新...`);
                }
            } catch (e) {
                console.warn(`⚠️  [Warn] 获取 Session 异常 (${i + 1}/5): ${e.message}`);
            }
            console.log(`🎟️ [Session] 等待 3 秒后重试...`);
            await page.reload({ waitUntil: 'networkidle' }).catch(() => { });
            await new Promise(r => setTimeout(r, 3000));
        }

        if (!sessionData || !sessionData.accessToken) {
            throw new Error("无法获取有效的 Access Token (页面多次刷新无响应)");
        }

        console.log(`🎟️  Access Token 已获取`);
        console.log('[roxy-register-openai] step=registration-complete action=success');
        console.log("🎉 [Success] 注册流程全部完成！");

        if (poolEmailId) {
            try {
                await store.markPoolEmailRegistered(poolEmailId);
                console.log(`[邮箱池] 已标记为已注册 id=${poolEmailId}`);
            } catch (markErr) {
                console.warn(`[邮箱池] 标记已注册失败: ${markErr.message}`);
            }
        }

        if (roxySession) {
            await closeRoxyBrowserSession(roxySession, { keepOpen: keepRoxyOpen, logger: console });
        } else if (browser) {
            await browser.close();
        }
        if (proxyBridgeStarted) await closeProxyBridge();
        // 把邮箱来源/JWT/API base 一起回传，让 oauth_login 用同一个邮箱后端拿验证码
        return {
            email,
            accessToken: sessionData.accessToken,
            emailSource,
            inboxJwt: inboxJwt || '',
            inboxApiBase: useInbox ? inboxApiBase : '',
            poolEmail: usePoolImap ? rawPoolEmail : '',
            poolPassword: usePoolImap ? poolImapPass : '',
            poolClientId: usePoolImap ? poolClientId : '',
            poolRefreshToken: usePoolImap ? poolRefreshToken : '',
            poolImapHost: usePoolImap ? poolImapHost : '',
            poolIncludeJunk
        };
    } catch (e) {
        console.error(`[roxy-register-openai] step=registration-failed action=error message=${String(e?.message || e || '').slice(0, 200)}`);
        const isUserExists = String(e?.message || '').includes(USER_ALREADY_EXISTS_ERROR)
            || String(e?.message || '').includes('user_already_exists');

        if (poolEmailId) {
            if (isUserExists) {
                // 这个邮箱在 OpenAI 上已有账号了，永远过不了注册——直接标记为已注册，避免后续再被抢占
                console.warn(`[邮箱池] ${email} 已被注册过 (user_already_exists)，标记为已注册并跳过`);
                await store.markPoolEmailRegistered(poolEmailId).catch((markErr) => {
                    console.warn(`[邮箱池] 标记已注册失败: ${markErr.message}`);
                });
            } else {
                await store.releasePoolEmailReservation(poolEmailId).catch(() => { });
            }
        }
        try {
            await saveFailureScreenshot(page);
        } catch (_) { }

        if (DEBUG_PAUSE_ON_ERROR_MS > 0 && browser && page && !page.isClosed()) {
            console.warn(`🐞 [调试] 失败保留浏览器 ${Math.round(DEBUG_PAUSE_ON_ERROR_MS / 1000)} 秒，便于手动检查/抓包... URL=${page.url()}`);
            await new Promise((r) => setTimeout(r, DEBUG_PAUSE_ON_ERROR_MS));
        }

        if (roxySession) {
            await closeRoxyBrowserSession(roxySession, { keepOpen: keepRoxyOpen, logger: console }).catch(() => {});
        } else if (browser) {
            await browser.close();
        }
        if (proxyBridgeStarted) await closeProxyBridge();
        throw e;
    }
}

if (require.main === module) {
    runRegistrationFlow()
        .then((result) => {
            if (process.send) {
                process.send({ type: 'result', result });
            }
            process.exit(0);
        })
        .catch((error) => {
            const msg = String(error?.message || error || '注册失败');
            if (process.send) {
                process.send({ type: 'error', message: msg });
            }
            // 已知错误（域名/超时/鉴权/代理）只打一行；未知错误才打完整堆栈
            const isKnown = /Inbox 临时邮箱创建失败|获取验证码超时|OpenAI 鉴权服务异常|代理不可用|代理或网络持续超时|user_already_exists|该邮箱已被注册|个人资料表单校验失败|注册后未能成功进入主站页面|page\.goto/i.test(msg);
            if (isKnown) {
                console.error(`❌ [注册] ${msg}`);
            } else {
                console.error(error);
            }
            process.exit(1);
        });
}

module.exports = {
    DEFAULT_VERIFICATION_API_URL,
    buildDefaultVerificationApiUrl,
    fetchRegistrationEmailVerificationCodeOnce,
    fetchRegistrationEmailVerificationCode,
    runRegistrationFlow
};
