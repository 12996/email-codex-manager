const dotenv = require('dotenv');
const {
    openRoxyBrowserForAutomation,
    closeRoxyBrowserSession
} = require('./roxy_oauth_login.js');

dotenv.config();

function readEnv(name, { required = false, secret = false } = {}) {
    const value = String(process.env[name] || '').trim();
    if (required && !value) {
        throw new Error(`缺少环境变量: ${name}`);
    }
    return {
        name,
        value,
        displayValue: secret && value ? '已配置' : (value || '未配置')
    };
}

function collectDebugInput() {
    const fields = [
        readEnv('REPLACE_EMAIL', { required: true }),
        readEnv('REPLACE_PASSWORD', { secret: true }),
        readEnv('REPLACE_PHONE', { required: true }),
        readEnv('REPLACE_SMS_API', { required: true }),
        readEnv('REPLACE_ACCOUNT_ID'),
        readEnv('REPLACE_REMARK')
    ];

    return Object.fromEntries(fields.map((field) => [field.name, field]));
}

async function main() {
    console.log('[roxy-env-debug] 读取临时调试环境变量...');
    const input = collectDebugInput();
    for (const field of Object.values(input)) {
        console.log(`[roxy-env-debug] env ${field.name}=${field.displayValue}`);
    }

    const targetUrl = process.argv[2] || 'https://chatgpt.com/';
    console.log(`[roxy-env-debug] targetUrl=${targetUrl}`);

    const session = await openRoxyBrowserForAutomation();
    try {
        console.log(`[roxy-env-debug] roxy dirId=${session.dirId}`);
        console.log(`[roxy-env-debug] roxy cdpEndpoint=${session.cdpEndpoint ? '已获取' : '未获取'}`);
        console.log('[roxy-env-debug] 正在打开目标页面...');
        await session.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const title = await session.page.title();
        console.log(`[roxy-env-debug] 页面已打开 url=${session.page.url()} title=${title}`);
        console.log('[roxy-env-debug] 临时账号信息已传入脚本，可在后续 Playwright 自动化中使用。');
    } finally {
        await closeRoxyBrowserSession(session, {
            keepOpen: String(process.env.ROXY_KEEP_OPEN || '1') !== '0'
        });
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`❌ [roxy-env-debug] 失败: ${error.message || error}`);
        if (error && error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    });
}

module.exports = {
    collectDebugInput
};
