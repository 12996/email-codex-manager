const DEFAULT_API_HOST = '127.0.0.1';
const DEFAULT_CDP_CONNECTION_INFO_ATTEMPTS = 12;
const DEFAULT_CDP_CONNECTION_INFO_INTERVAL_MS = 500;
const DEFAULT_CDP_CONNECT_ATTEMPTS = 3;
const DEFAULT_CDP_CONNECT_RETRY_DELAY_MS = 750;
const DEFAULT_CDP_CONNECT_TIMEOUT_MS = 10000;

function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
}

function formatFetchError(error) {
    const cause = error?.cause || {};
    const parts = [];
    if (cause.code) {
        parts.push(cause.code);
    }
    if (cause.address || cause.port) {
        parts.push(`${cause.address || 'unknown'}:${cause.port || 'unknown'}`);
    }
    if (parts.length > 0) {
        return parts.join(' ');
    }
    return error?.message || String(error);
}

function resolveApiBaseUrl(options = {}) {
    if (options.apiBaseUrl) {
        return trimTrailingSlash(options.apiBaseUrl);
    }

    if (process.env.ROXY_API_BASE_URL) {
        return trimTrailingSlash(process.env.ROXY_API_BASE_URL);
    }

    const port = options.apiPort || process.env.ROXY_API_PORT;
    if (!port) {
        throw new Error('缺少 RoxyBrowser API 地址：请传入 apiBaseUrl，或配置 ROXY_API_BASE_URL / ROXY_API_PORT');
    }

    return `http://${DEFAULT_API_HOST}:${port}`;
}

function assertRequired(value, name) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`缺少必要参数: ${name}`);
    }
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function createCdpConnectionError(code, attempts) {
    const error = new Error(`Roxy CDP connection failed after ${attempts} attempt(s)`);
    error.code = code;
    return error;
}

function extractConnectionInfo(response, dirId) {
    const data = response && response.data;
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
    return rows.find((item) => String(item.dirId || '') === String(dirId)) || rows[0] || null;
}

function extractBrowserList(response) {
    const data = response && response.data;
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data?.list)) {
        return data.list;
    }
    if (Array.isArray(data?.rows)) {
        return data.rows;
    }
    if (Array.isArray(data?.data)) {
        return data.data;
    }
    return [];
}

function extractResponseRows(response) {
    const data = response && response.data;
    if (Array.isArray(data)) {
        return data;
    }
    if (Array.isArray(data?.rows)) {
        return data.rows;
    }
    if (Array.isArray(data?.list)) {
        return data.list;
    }
    if (Array.isArray(data?.data)) {
        return data.data;
    }
    return [];
}

function publicProxy(proxy = {}) {
    const password = proxy.proxyPassword ?? proxy.password;
    return {
        id: proxy.id,
        ipType: proxy.ipType,
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        username: proxy.proxyUserName ?? proxy.username ?? '',
        checkChannel: proxy.checkChannel,
        refreshUrl: proxy.refreshUrl,
        remark: proxy.remark,
        passwordConfigured: Boolean(password)
    };
}

function publicBrowserProxy(proxyInfo = {}) {
    const password = proxyInfo.proxyPassword ?? proxyInfo.password;
    return {
        host: proxyInfo.host,
        port: proxyInfo.port,
        protocol: proxyInfo.protocol ?? proxyInfo.proxyCategory,
        username: proxyInfo.proxyUserName ?? proxyInfo.username ?? '',
        lastIp: proxyInfo.lastIp,
        passwordConfigured: Boolean(password)
    };
}

function hasValidProxyId(proxyId) {
    return Number.isInteger(proxyId) && proxyId > 0;
}

function extractCdpEndpoint(response, dirId) {
    const data = response && response.data;
    if (typeof data?.ws === 'string' && data.ws) {
        return data.ws;
    }

    const info = extractConnectionInfo(response, dirId);
    return typeof info?.ws === 'string' ? info.ws : '';
}

class RoxyBrowserClient {
    constructor(options = {}) {
        this.apiBaseUrl = resolveApiBaseUrl(options);
        this.token = options.token || process.env.ROXY_API_TOKEN || '';
        this.workspaceId = options.workspaceId ?? Number(process.env.ROXY_WORKSPACE_ID || 0);
        this.dirId = options.dirId || process.env.ROXY_BROWSER_DIR_ID || '';
        this.windowName = options.windowName || process.env.ROXY_BROWSER_WINDOW_NAME || '';
        this.windowSortNum = options.windowSortNum ?? process.env.ROXY_BROWSER_SORT_NUM ?? '';
        this.requestImpl = options.request || null;
        this.playwright = options.playwright || null;
    }

    async request(method, path, body) {
        if (this.requestImpl) {
            const response = await this.requestImpl(method, path, body);
            return this.assertSuccess(path, response);
        }

        let url = `${this.apiBaseUrl}${path}`;
        const headers = {
            'Content-Type': 'application/json'
        };
        if (this.token) {
            headers.token = this.token;
        }

        const init = { method, headers };
        if (method === 'GET' && body && Object.keys(body).length > 0) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(body)) {
                if (value !== undefined && value !== null && value !== '') {
                    params.set(key, String(value));
                }
            }
            const query = params.toString();
            if (query) {
                url += `?${query}`;
            }
        } else if (body !== undefined) {
            init.body = JSON.stringify(body);
        }

        let resp;
        try {
            resp = await fetch(url, init);
        } catch (error) {
            throw new Error(`Roxy API 请求失败: ${method} ${url}; 原因=${formatFetchError(error)}; 请确认 RoxyBrowser API 已启用且 ROXY_API_BASE_URL/ROXY_API_PORT 指向正在监听的本机端口`);
        }
        const text = await resp.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch (error) {
            throw new Error(`${path} 返回非 JSON 响应: ${text.slice(0, 200)}`);
        }

        if (!resp.ok) {
            throw new Error(`${path} HTTP ${resp.status}: ${data.msg || text.slice(0, 200)}`);
        }

        return this.assertSuccess(path, data);
    }

    assertSuccess(path, response) {
        if (!response || response.code !== 0) {
            throw new Error(`${path} 调用失败: ${response?.msg || '未知错误'}`);
        }
        return response;
    }

    async health() {
        return this.request('GET', '/health', {});
    }

    async listBrowsers() {
        assertRequired(this.workspaceId, 'workspaceId');
        return this.request('GET', '/browser/list', {
            workspaceId: this.workspaceId,
            pageIndex: 1,
            pageSize: 100
        });
    }

    async getBrowserProfile(dirId) {
        assertRequired(dirId, 'dirId');
        const response = await this.listBrowsers();
        const browser = extractBrowserList(response)
            .find((item) => String(item?.dirId || '') === String(dirId));
        if (!browser) {
            throw new Error(`未找到 RoxyBrowser 窗口 dirId=${dirId}`);
        }

        // Only a documented, top-level proxyId can safely link a profile to a proxy resource.
        if (browser.proxyId === undefined || browser.proxyId === null || browser.proxyId === '') {
            throw new Error(`RoxyBrowser 窗口 dirId=${dirId} 无法识别 proxyId，不能安全建立绑定；请确认 /browser/list 返回显式 proxyId`);
        }

        return {
            dirId: browser.dirId,
            sortNum: browser.sortNum ?? browser.windowSortNum ?? browser.SN,
            windowName: browser.windowName,
            proxyId: browser.proxyId,
            proxy: publicBrowserProxy(browser.proxyInfo || {})
        };
    }

    async listProxies() {
        assertRequired(this.workspaceId, 'workspaceId');
        const response = await this.request('GET', '/proxy/list', {
            workspaceId: this.workspaceId,
            pageIndex: 1,
            pageSize: 100
        });
        return extractResponseRows(response).map((proxy) => publicProxy(proxy));
    }

    async detectProxyChannels() {
        const response = await this.request('GET', '/proxy/detect_channel', {});
        return extractResponseRows(response);
    }

    buildProxyPayload(payload = {}, proxyId) {
        const body = {
            workspaceId: payload.workspaceId ?? this.workspaceId,
            checkChannel: payload.checkChannel,
            ipType: payload.ipType,
            protocol: payload.protocol,
            host: payload.host,
            port: payload.port,
            proxyUserName: payload.proxyUserName,
            proxyPassword: payload.proxyPassword,
            refreshUrl: payload.refreshUrl ?? '',
            remark: payload.remark ?? ''
        };
        if (proxyId !== undefined) {
            body.id = proxyId;
        }

        for (const field of [
            'workspaceId', 'checkChannel', 'ipType', 'protocol', 'host', 'port',
            'proxyUserName', 'proxyPassword'
        ]) {
            assertRequired(body[field], field);
        }
        if (proxyId !== undefined) {
            assertRequired(proxyId, 'proxyId');
        }
        return body;
    }

    async createProxy(payload = {}) {
        const body = this.buildProxyPayload(payload);
        const response = await this.request('POST', '/proxy/create', body);
        const proxy = publicProxy(response.data || {});
        if (!hasValidProxyId(proxy.id)) {
            throw new Error('/proxy/create 未返回有效的 Roxy proxyId，不能安全建立绑定');
        }
        return proxy;
    }

    async modifyProxy(proxyId, payload = {}) {
        assertRequired(proxyId, 'proxyId');
        const body = this.buildProxyPayload(payload, proxyId);
        const response = await this.request('POST', '/proxy/modify', body);
        return publicProxy(response.data || body);
    }

    async resolveDirId() {
        if (this.dirId) {
            return this.dirId;
        }

        const hasSortNum = this.windowSortNum !== undefined && this.windowSortNum !== null && this.windowSortNum !== '';
        if (!hasSortNum && !this.windowName) {
            assertRequired(this.dirId, 'dirId');
        }

        const response = await this.listBrowsers();
        const browsers = extractBrowserList(response);
        const target = hasSortNum
            ? browsers.find((item) => String(item.sortNum ?? item.windowSortNum ?? '') === String(this.windowSortNum))
            : browsers.find((item) => String(item.windowName || '').trim() === String(this.windowName).trim());

        if (!target || !target.dirId) {
            const targetText = hasSortNum ? `窗口序号 ${this.windowSortNum}` : `窗口名称 ${this.windowName}`;
            throw new Error(`未找到 ${targetText} 对应的 RoxyBrowser 窗口 dirId`);
        }

        this.dirId = target.dirId;
        return this.dirId;
    }

    async closeBrowser() {
        await this.resolveDirId();
        assertRequired(this.dirId, 'dirId');
        return this.request('POST', '/browser/close', { dirId: this.dirId });
    }

    async clearLocalCache() {
        await this.resolveDirId();
        assertRequired(this.dirId, 'dirId');
        return this.request('POST', '/browser/clear_local_cache', { dirIds: [this.dirId] });
    }

    async clearServerCache() {
        await this.resolveDirId();
        assertRequired(this.workspaceId, 'workspaceId');
        assertRequired(this.dirId, 'dirId');
        return this.request('POST', '/browser/clear_server_cache', {
            workspaceId: this.workspaceId,
            dirIds: [this.dirId]
        });
    }

    async randomFingerprint() {
        await this.resolveDirId();
        assertRequired(this.workspaceId, 'workspaceId');
        assertRequired(this.dirId, 'dirId');
        return this.request('POST', '/browser/random_env', {
            workspaceId: this.workspaceId,
            dirId: this.dirId
        });
    }

    async updateBrowserConfig(config = {}) {
        await this.resolveDirId();
        assertRequired(this.workspaceId, 'workspaceId');
        assertRequired(this.dirId, 'dirId');
        return this.request('POST', '/browser/mdf', {
            workspaceId: this.workspaceId,
            dirId: this.dirId,
            ...config
        });
    }

    async openBrowser(args = []) {
        await this.resolveDirId();
        assertRequired(this.workspaceId, 'workspaceId');
        assertRequired(this.dirId, 'dirId');
        const body = {
            workspaceId: this.workspaceId,
            dirId: this.dirId,
            dirIds: [this.dirId]
        };
        if (Array.isArray(args) && args.length > 0) {
            body.args = args;
        }
        return this.request('POST', '/browser/open', body);
    }

    async getConnectionInfo() {
        await this.resolveDirId();
        assertRequired(this.dirId, 'dirId');
        const response = await this.request('GET', '/browser/connection_info', {
            dirIds: this.dirId
        });
        const info = extractConnectionInfo(response, this.dirId);
        if (!info || !info.ws) {
            const error = new Error(`/browser/connection_info 未返回窗口 ${this.dirId} 的 CDP ws 地址`);
            error.code = 'ROXY_CDP_CONNECTION_INFO_UNAVAILABLE';
            throw error;
        }
        return info;
    }

    async waitForConnectionInfo(options = {}) {
        const attempts = positiveInteger(options.attempts, DEFAULT_CDP_CONNECTION_INFO_ATTEMPTS);
        const intervalMs = nonNegativeInteger(options.intervalMs, DEFAULT_CDP_CONNECTION_INFO_INTERVAL_MS);
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await this.getConnectionInfo();
            } catch (error) {
                if (error?.code !== 'ROXY_CDP_CONNECTION_INFO_UNAVAILABLE') {
                    throw error;
                }
                if (attempt === attempts) {
                    throw createCdpConnectionError('ROXY_CDP_CONNECTION_INFO_TIMEOUT', attempt);
                }
                await wait(intervalMs);
            }
        }
        throw createCdpConnectionError('ROXY_CDP_CONNECTION_INFO_TIMEOUT', attempts);
    }

    async connectPlaywright(cdpEndpoint, options = {}) {
        assertRequired(cdpEndpoint, 'cdpEndpoint');
        const playwright = this.playwright || require('playwright-core');
        const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_CDP_CONNECT_TIMEOUT_MS);
        const browser = await playwright.chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs });
        try {
            let context = browser.contexts()[0];
            if (!context) {
                context = await browser.newContext();
            }
            let page = context.pages()[0];
            if (!page) {
                page = await context.newPage();
            }
            return { browser, context, page };
        } catch (error) {
            await browser.close().catch(() => {});
            throw error;
        }
    }

    async connectReadyPlaywright(options = {}) {
        const connectionInfoAttempts = positiveInteger(
            options.connectionInfoAttempts,
            DEFAULT_CDP_CONNECTION_INFO_ATTEMPTS
        );
        const connectionInfoIntervalMs = nonNegativeInteger(
            options.connectionInfoIntervalMs,
            DEFAULT_CDP_CONNECTION_INFO_INTERVAL_MS
        );
        const connectAttempts = positiveInteger(options.connectAttempts, DEFAULT_CDP_CONNECT_ATTEMPTS);
        const retryDelayMs = nonNegativeInteger(options.retryDelayMs, DEFAULT_CDP_CONNECT_RETRY_DELAY_MS);
        const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_CDP_CONNECT_TIMEOUT_MS);
        let fallbackCdpEndpoint = String(options.fallbackCdpEndpoint || '').trim();

        for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
            let connection;
            try {
                connection = await this.waitForConnectionInfo({
                    attempts: connectionInfoAttempts,
                    intervalMs: connectionInfoIntervalMs
                });
            } catch (error) {
                if (error?.code !== 'ROXY_CDP_CONNECTION_INFO_TIMEOUT' || !fallbackCdpEndpoint) {
                    throw error;
                }
                connection = { ws: fallbackCdpEndpoint };
                fallbackCdpEndpoint = '';
            }

            try {
                const connected = await this.connectPlaywright(connection.ws, { timeoutMs });
                return { ...connected, cdpEndpoint: connection.ws };
            } catch (error) {
                if (attempt === connectAttempts) {
                    throw createCdpConnectionError('ROXY_CDP_ATTACH_FAILED', attempt);
                }
                await wait(retryDelayMs);
            }
        }
        throw createCdpConnectionError('ROXY_CDP_ATTACH_FAILED', connectAttempts);
    }

    async launchAndConnect(options = {}) {
        await this.resolveDirId();
        const {
            ensureClosed = true,
            clearLocalCache = true,
            clearServerCache = true,
            randomFingerprint = true,
            args = [],
            ignoreCloseError = true
        } = options;

        if (ensureClosed) {
            try {
                await this.closeBrowser();
            } catch (error) {
                if (!ignoreCloseError) {
                    throw error;
                }
                console.warn(`⚠️ [Roxy] 关闭窗口失败，继续后续流程: ${error.message}`);
            }
        }

        if (clearLocalCache) {
            await this.clearLocalCache();
        }
        if (clearServerCache) {
            await this.clearServerCache();
        }
        if (randomFingerprint) {
            await this.randomFingerprint();
        }

        const openResponse = await this.openBrowser(args);
        const connected = await this.connectReadyPlaywright({
            fallbackCdpEndpoint: extractCdpEndpoint(openResponse, this.dirId)
        });
        return {
            ...connected,
            dirId: this.dirId,
            workspaceId: this.workspaceId,
            close: async ({ closeRoxy = false } = {}) => {
                await connected.browser.close();
                if (closeRoxy) {
                    await this.closeBrowser();
                }
            }
        };
    }
}

async function launchRoxyBrowser(options = {}) {
    const client = new RoxyBrowserClient(options);
    return client.launchAndConnect(options);
}

module.exports = {
    RoxyBrowserClient,
    launchRoxyBrowser,
    extractCdpEndpoint,
    extractConnectionInfo
};
