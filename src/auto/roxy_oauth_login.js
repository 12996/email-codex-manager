const dotenv = require('dotenv');
const { RoxyBrowserClient } = require('./roxy-browser-client.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 配置文件
const DEFAULT_TARGET_URL = 'https://chatgpt.com/';
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60000;
const DEFAULT_IDLE_TIMEOUT_MS = 10000;



function pickLogger(logger) {
    return logger || console;
}

function log(logger, phase, action, details = '') {
    const suffix = details ? ` ${details}` : '';
    logger.log(`[roxy-oauth-login] phase=${phase} action=${action}${suffix}`);
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
    logger.warn('[roxy-oauth-login] phase=cleanup action=Playwright 断开 诊断=当前 Playwright Browser 对象未提供 disconnect，按 Playwright 连接型 Browser 语义调用 close 断开连接');
    await browser.close({ reason: 'roxy_oauth_login disconnect after navigation' });
    return 'close-connection';
}

async function openRoxyBrowserForAutomation(deps = {}) {
    const logger = pickLogger(deps.logger);
    const env = deps.env || process.env;
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
    log(logger, 'cdp', '获取 CDP 完成', `ws=${cdpEndpoint ? '已获取' : '未获取'}`);

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
    if (keepOpen) {
        return disconnectPlaywright(session.browser, logger);
    }

    log(logger, 'cleanup', '关闭 Playwright/Roxy 窗口', 'keepOpen=false');
    await session.browser.close();
    await session.client.closeBrowser();
    return 'close';
}

// 补账号完整流程
async function run(argv = process.argv.slice(2), deps = {}) {
    const logger = pickLogger(deps.logger);
    const env = deps.env || process.env;
    const dotenvImpl = deps.dotenv || dotenv;
    const keepOpen = shouldKeepOpen(env);

    dotenvImpl.config();
    log(logger, 'config', '读取配置', safeConfigSummary(env));

    const session = await openRoxyBrowserForAutomation(deps);
    const { page } = session;

    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    const authUrl = `https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_challenge=${challenge}&code_challenge_method=S256&codex_cli_simplified_flow=true&id_token_add_organizations=true&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code&scope=openid+profile+email+offline_access&state=${state}`;
    const targetUrl = argv[0] || authUrl;

    log(logger, 'navigate', '导航目标 URL', targetUrl);
    await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_NAVIGATION_TIMEOUT_MS
    });
    await page.waitForLoadState('networkidle', { timeout: DEFAULT_IDLE_TIMEOUT_MS }).catch((error) => {
        logger.warn(`[roxy-oauth-login] phase=navigate action=等待 networkidle 诊断=${error.message}`);
    });

    const currentUrl = page.url();
    const title = await page.title();
    log(logger, 'inspect', '当前页面 URL/title', `url=${currentUrl} title=${title}`);

    const disconnectMode = await closeRoxyBrowserSession(session, { keepOpen, logger });

    return {
        targetUrl,
        currentUrl,
        title,
        dirId: session.dirId,
        cdpEndpoint: session.cdpEndpoint,
        keepOpen,
        disconnectMode
    };
}

async function runCli(proc = process, deps = {}) {
    try {
        await run(proc.argv.slice(2), {
            ...deps,
            env: deps.env || proc.env
        });
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
    openRoxyBrowserForAutomation,
    closeRoxyBrowserSession,
    run,
    runCli,
    disconnectPlaywright
};
