const dotenv = require('dotenv');
const { chromium } = require('playwright-core');
const {
    codex_login,
    is_codex_login_page,
    is_email_code_page,
    is_openai_login_page,
    is_phone_add_page,
    is_phone_code_page,
    is_phone_code_request_page,
    is_phone_verify_page,
    openAi_login,
    openAi_email_code,
    openAi_phone_add,
    openAi_phone_code,
    openAi_phone_code_request,
    openAi_phone_verify
} = require('./roxy_oauth_login.js');

dotenv.config();

function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) continue;
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            args[key] = '1';
            continue;
        }
        args[key] = next;
        index += 1;
    }
    return args;
}

function printHelp() {
    console.log(`
Usage:
  node src\\auto\\roxy_oauth_steps_manual_test.js --email <gmail> --cdp <ws-url> [options]

Options:
  --step <name>     openai-page | openai-login | email-code-page | email-code-submit |
                   phone-add-page | phone-add-submit |
                   phone-code-request-page | phone-code-request-submit |
                   phone-verify-page | phone-verify-submit | phone-code-page | phone-code-submit |
                   codex-page | codex-login | all
                   Default: all
  --api <url>       Verification code API URL.
                   Default: http://127.0.0.1:3000/api/verification-code/latest
  --sms-api <url>   Phone SMS API URL.
                   Default: PHONE_VERIFICATION_SMS_API_URL or built-in SMSLease URL
  --phone <number>  Phone number for the add phone page.
                   Default: ROXY_OAUTH_PHONE
  --code <digits>   Bypass API and fill this 6-digit code directly.
  --timeout <ms>    Per-step timeout. Default: 60000
  --help            Show this help.

Examples:
  node src\\auto\\roxy_oauth_steps_manual_test.js --email smiro4099+s1@gmail.com --cdp ws://127.0.0.1:9222/devtools/browser/xxx --step all
  node src\\auto\\roxy_oauth_steps_manual_test.js --email smiro4099+s1@gmail.com --cdp %ROXY_CDP_ENDPOINT% --step openai-login
  node src\\auto\\roxy_oauth_steps_manual_test.js --email smiro4099+s1@gmail.com --cdp %ROXY_CDP_ENDPOINT% --step email-code-submit --code 123456
  node src\\auto\\roxy_oauth_steps_manual_test.js --cdp %ROXY_CDP_ENDPOINT% --step phone-add-page
  node src\\auto\\roxy_oauth_steps_manual_test.js --cdp %ROXY_CDP_ENDPOINT% --step phone-add-submit --phone +13523282595
  node src\\auto\\roxy_oauth_steps_manual_test.js --cdp %ROXY_CDP_ENDPOINT% --step phone-code-request-submit
  node src\\auto\\roxy_oauth_steps_manual_test.js --cdp %ROXY_CDP_ENDPOINT% --step phone-verify-submit
  node src\\auto\\roxy_oauth_steps_manual_test.js --cdp %ROXY_CDP_ENDPOINT% --step phone-code-submit --sms-api https://cdc.smslease.link/adminapi/jsscript/smsInfo/ABC_sms?key=...
`);
}

async function getActivePage(cdpEndpoint) {
    const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 10000 });
    const context = browser.contexts()[0] || await browser.newContext();
    const page = context.pages()[0] || await context.newPage();
    return { browser, page };
}

async function disconnectBrowser(browser) {
    if (browser && typeof browser.disconnect === 'function') {
        await browser.disconnect();
        return;
    }
    if (browser && typeof browser.close === 'function') {
        await browser.close({ reason: 'manual oauth step test disconnect' });
    }
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (args.help) {
        printHelp();
        return;
    }

    const email = String(args.email || process.env.OPENAI_LOGIN_EMAIL || '').trim();
    const cdpEndpoint = String(args.cdp || process.env.ROXY_CDP_ENDPOINT || '').trim();
    const step = String(args.step || 'all').trim();
    const timeoutMs = Number(args.timeout || process.env.ROXY_OAUTH_STEP_TIMEOUT_MS || 60000);
    const phone = String(args.phone || process.env.ROXY_OAUTH_PHONE || '').trim();

    if (!cdpEndpoint) {
        throw new Error('missing --cdp or ROXY_CDP_ENDPOINT');
    }
    if ((step === 'openai-login' || step === 'all') && !email) {
        throw new Error('missing --email or OPENAI_LOGIN_EMAIL');
    }
    if (step === 'email-code-submit' && !args.code && !email) {
        throw new Error('missing --email or OPENAI_LOGIN_EMAIL when --code is not provided');
    }
    if (step === 'phone-add-submit' && !phone) {
        throw new Error('missing --phone or ROXY_OAUTH_PHONE');
    }

    const { browser, page } = await getActivePage(cdpEndpoint);
    try {
        console.log(`[manual-test] connected url=${page.url()} title=${await page.title().catch(() => '')}`);

        if (step === 'openai-page' || step === 'all') {
            const result = await is_openai_login_page(page, { timeoutMs });
            console.log(`[manual-test] is_openai_login_page=${result}`);
            if (step === 'openai-page') return;
        }

        if (step === 'openai-login' || step === 'all') {
            const onLoginPage = await is_openai_login_page(page, { timeoutMs });
            if (onLoginPage) {
                const result = await openAi_login(page, email, { timeoutMs });
                console.log(`[manual-test] openAi_login=${JSON.stringify(result)}`);
            } else {
                console.log('[manual-test] openAi_login=skipped reason=not-openai-login-page');
            }
            if (step === 'openai-login') return;
        }

        if (step === 'email-code-page' || step === 'all') {
            const result = await is_email_code_page(page, { timeoutMs });
            console.log(`[manual-test] is_email_code_page=${result}`);
            if (step === 'email-code-page') return;
        }

        if (step === 'email-code-submit' || step === 'all') {
            const result = await openAi_email_code(page, email, {
                timeoutMs,
                verificationApiUrl: args.api,
                code: args.code
            });
            console.log(`[manual-test] openAi_email_code=${JSON.stringify(result)}`);
            if (step === 'email-code-submit') return;
        }

        if (step === 'phone-add-page' || step === 'all') {
            const result = await is_phone_add_page(page, { timeoutMs });
            console.log(`[manual-test] is_phone_add_page=${result}`);
            if (step === 'phone-add-page') return;
        }

        if (step === 'phone-add-submit' || step === 'all') {
            const onPhoneAddPage = await is_phone_add_page(page, { timeoutMs });
            if (onPhoneAddPage) {
                const result = await openAi_phone_add(page, { timeoutMs, phone });
                console.log(`[manual-test] openAi_phone_add=${JSON.stringify(result)}`);
            } else {
                console.log('[manual-test] openAi_phone_add=skipped reason=not-phone-add-page');
            }
            if (step === 'phone-add-submit') return;
        }

        if (step === 'phone-code-request-page' || step === 'phone-verify-page' || step === 'all') {
            const result = await is_phone_code_request_page(page, { timeoutMs });
            console.log(`[manual-test] is_phone_code_request_page=${result}`);
            if (step === 'phone-code-request-page' || step === 'phone-verify-page') return;
        }

        if (step === 'phone-code-request-submit' || step === 'phone-verify-submit' || step === 'all') {
            const onPhoneCodeRequestPage = await is_phone_code_request_page(page, { timeoutMs });
            if (onPhoneCodeRequestPage) {
                const result = await openAi_phone_code_request(page, { timeoutMs });
                console.log(`[manual-test] openAi_phone_code_request=${JSON.stringify(result)}`);
            } else {
                console.log('[manual-test] openAi_phone_code_request=skipped reason=not-phone-code-request-page');
            }
            if (step === 'phone-code-request-submit' || step === 'phone-verify-submit') return;
        }

        if (step === 'phone-code-page' || step === 'all') {
            const result = await is_phone_code_page(page, { timeoutMs });
            console.log(`[manual-test] is_phone_code_page=${result}`);
            if (step === 'phone-code-page') return;
        }

        if (step === 'phone-code-submit' || step === 'all') {
            const result = await openAi_phone_code(page, {
                timeoutMs,
                smsApiUrl: args['sms-api'],
                code: args.code
            });
            console.log(`[manual-test] openAi_phone_code=${JSON.stringify(result)}`);
            if (step === 'phone-code-submit') return;
        }

        if (step === 'all') {
            await page.waitForTimeout(1000).catch(() => {});
        }

        if (step === 'codex-page' || step === 'all') {
            const result = await is_codex_login_page(page, { timeoutMs });
            console.log(`[manual-test] is_codex_login_page=${result}`);
            if (step === 'codex-page') return;
        }

        if (step === 'codex-login' || step === 'all') {
            const result = await codex_login(page, { timeoutMs });
            console.log(`[manual-test] codex_login=${JSON.stringify(result)}`);
        }
    } finally {
        await disconnectBrowser(browser).catch(() => {});
    }
}

if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
    main().catch((error) => {
        console.error(`[manual-test] failed: ${error.stack || error.message || error}`);
        process.exitCode = 1;
    });
}

module.exports = { disconnectBrowser, main, parseArgs };
