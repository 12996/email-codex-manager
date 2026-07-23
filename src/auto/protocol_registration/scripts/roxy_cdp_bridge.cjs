'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');

// JSONL 协议的 stdout 必须保持纯净；Roxy/Playwright 的诊断统一转到 stderr。
for (const method of ['log', 'info', 'warn', 'error']) {
  console[method] = (...args) => process.stderr.write(`${args.map(String).join(' ')}\n`);
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resolveModulePath(envName, fallback) {
  return process.env[envName] || fallback;
}

function defaultGmailImapRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'gmail_IMAP'),
    path.resolve(__dirname, '..', '..', '..', '..', '..', 'gmail_IMAP'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function defaultRoxyClientPath() {
  return path.join(defaultGmailImapRoot(), 'src', 'auto', 'roxy-browser-client.cjs');
}

function defaultPlaywrightPath() {
  return path.join(defaultGmailImapRoot(), 'node_modules', 'playwright-core');
}

function normalizeHeaders(headers) {
  const output = {};
  let referer = '';
  for (const [rawName, rawValue] of Object.entries(headers || {})) {
    const name = String(rawName).toLowerCase();
    if (rawValue === undefined || rawValue === null) continue;
    if (name === 'referer' || name === 'referrer') {
      referer = String(rawValue);
      continue;
    }

    // 这些头由真实浏览器/页面上下文生成，fetch 不应尝试伪造。
    if (
      name === 'host' ||
      name === 'connection' ||
      name === 'content-length' ||
      name === 'user-agent' ||
      name === 'origin' ||
      name.startsWith('sec-')
    ) {
      continue;
    }
    output[rawName] = String(rawValue);
  }
  return { headers: output, referer };
}

function appendParams(url, params) {
  if (!params) return url;
  const target = new URL(url);
  if (typeof params === 'string') {
    new URLSearchParams(params).forEach((value, key) => target.searchParams.append(key, value));
  } else if (Array.isArray(params)) {
    for (const [key, value] of params) {
      if (value !== undefined && value !== null) target.searchParams.append(key, String(value));
    }
  } else {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
}

function responseToResult(response, fallbackUrl = '') {
  return {
    status_code: response ? response.status() : 0,
    status_text: response ? response.statusText() : '',
    url: response ? response.url() : fallbackUrl,
    headers: response ? response.headers() : {},
    text: ''
  };
}

function decodeCookiePayload(value) {
  try {
    const segment = String(value || '').split('.')[0];
    if (!segment) return null;
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function extractAuthWorkspaces(cookies) {
  const cookie = (Array.isArray(cookies) ? cookies : [])
    .find((candidate) => candidate?.name === 'oai-client-auth-session');
  const payload = decodeCookiePayload(cookie?.value);
  const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
  const seen = new Set();
  return workspaces
    .map((workspace) => ({
      id: String(workspace?.id || '').trim(),
      kind: String(workspace?.kind || '').trim(),
      name: String(workspace?.name || '').trim(),
    }))
    .filter((workspace) => {
      if (!workspace.id || seen.has(workspace.id)) return false;
      seen.add(workspace.id);
      return true;
    });
}

function redactUrlForLog(rawUrl) {
  try {
    const target = new URL(String(rawUrl));
    return `${target.origin}${target.pathname}${target.search ? '?<redacted>' : ''}`;
  } catch (_) {
    return String(rawUrl || '(empty)').slice(0, 240);
  }
}

function isTransientPageFetchError(error) {
  const message = String(error?.message || error);
  return /Failed to fetch|NetworkError|ERR_CONNECTION_(?:CLOSED|RESET|TIMED_OUT)|ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(message);
}

function getPageUrlForLog(page) {
  try {
    return redactUrlForLog(page?.url?.() || '');
  } catch (_) {
    return '(unavailable)';
  }
}

function formatPageRequestDiagnostic(page, method, url, error) {
  const name = String(error?.name || 'Error');
  const message = String(error?.message || error).replace(/\s+/g, ' ').slice(0, 300);
  let closed = 'unknown';
  try {
    closed = String(Boolean(page?.isClosed?.()));
  } catch (_) {
    closed = 'unavailable';
  }
  return `method=${method} url=${redactUrlForLog(url)} pageUrl=${getPageUrlForLog(page)} pageClosed=${closed} error=${name}: ${message}`;
}

class RoxyCdpBridge {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.roxyClient = null;
    this.closed = false;
    this.ownsPage = false;
    this.originIsolationEnabled = options.originIsolationEnabled !== undefined
      ? Boolean(options.originIsolationEnabled)
      : String(process.env.ROXY_CDP_ORIGIN_ISOLATION || '1') !== '0';
    this.pagesByOrigin = new Map();
    this.ownedPages = new Set();
  }

  async ensureConnected() {
    if (this.page && !this.page.isClosed()) return;
    if (this.page && this.page.isClosed()) this.page = null;
    if (this.closed) throw new Error('Roxy CDP bridge 已关闭');

    // Tests and reconnect paths may already provide a live BrowserContext.
    // Reuse it without resolving a new Roxy API client.
    if (this.browser && this.context) {
      const pages = this.context.pages().filter((candidate) => !candidate.isClosed());
      if (process.env.ROXY_CDP_REUSE_EXISTING_PAGE === '1' && pages[0]) {
        this.page = pages[0];
      } else {
        this.page = await this.context.newPage();
        this.ownsPage = true;
        this.ownedPages.add(this.page);
      }
      return;
    }

    const playwrightPath = resolveModulePath('ROXY_PLAYWRIGHT_CORE_PATH', defaultPlaywrightPath());
    const playwright = require(playwrightPath);
    const endpoint = String(process.env.ROXY_CDP_ENDPOINT || '').trim();

    if (endpoint) {
      this.browser = await playwright.chromium.connectOverCDP(endpoint);
    } else {
      const clientPath = resolveModulePath('ROXY_BROWSER_CLIENT_SCRIPT', defaultRoxyClientPath());
      const { RoxyBrowserClient } = require(clientPath);
      this.roxyClient = new RoxyBrowserClient({
        apiBaseUrl: process.env.ROXY_API_BASE_URL,
        token: process.env.ROXY_API_TOKEN || '',
        workspaceId: asNumber(process.env.ROXY_WORKSPACE_ID, 0),
        dirId: process.env.ROXY_BROWSER_DIR_ID || '',
        windowName: process.env.ROXY_BROWSER_WINDOW_NAME || '',
        windowSortNum: process.env.ROXY_BROWSER_SORT_NUM || '',
        playwright
      });

      let cdpEndpoint = '';
      try {
        const connectionInfo = await this.roxyClient.getConnectionInfo();
        cdpEndpoint = connectionInfo.ws;
      } catch (_) {
        const prepared = process.env.ROXY_CDP_PREPARE === '1';
        const launched = await this.roxyClient.launchAndConnect({
          ensureClosed: prepared,
          clearLocalCache: prepared,
          clearServerCache: prepared,
          randomFingerprint: prepared,
          ignoreCloseError: true
        });
        this.browser = launched.browser;
        this.context = launched.context;
      }
      if (!this.browser && cdpEndpoint) {
        this.browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
      }
    }

    if (!this.context) this.context = this.browser.contexts()[0];
    if (!this.context) this.context = await this.browser.newContext();
    if (!this.page) {
      const pages = this.context.pages().filter((candidate) => !candidate.isClosed());
      if (process.env.ROXY_CDP_REUSE_EXISTING_PAGE === '1' && pages[0]) {
        this.page = pages[0];
      } else {
        // 默认使用独立 tab，避免 Roxy/MCP 正在操作的活动页打断协议请求上下文。
        this.page = await this.context.newPage();
        this.ownsPage = true;
        this.ownedPages.add(this.page);
      }
    }
  }

  async pageForOrigin(url, timeoutMs, options = {}) {
    await this.ensureConnected();
    const targetOrigin = new URL(url).origin;
    const warmup = options.warmup !== false;

    if (!this.originIsolationEnabled || !this.context) {
      const page = this.page;
      if (!page) throw new Error(`Roxy CDP 没有可用页面: ${targetOrigin}`);
      let currentOrigin = '';
      try {
        currentOrigin = new URL(page.url()).origin;
      } catch (_) {
        currentOrigin = '';
      }
      if (currentOrigin !== targetOrigin && warmup) {
        await page.goto(`${targetOrigin}/`, {
          waitUntil: 'domcontentloaded',
          timeout: timeoutMs
        });
        await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
      }
      return page;
    }

    const mapped = this.pagesByOrigin.get(targetOrigin);
    if (mapped && !mapped.isClosed()) {
      this.page = mapped;
      return mapped;
    }
    if (mapped) this.pagesByOrigin.delete(targetOrigin);

    let page = this.page && !this.page.isClosed() ? this.page : null;
    let currentOrigin = '';
    if (page) {
      try {
        const currentUrl = String(page.url() || '');
        currentOrigin = currentUrl.startsWith('about:') ? '' : new URL(currentUrl).origin;
      } catch (_) {
        currentOrigin = '';
      }
    }
    if (!page || (currentOrigin && currentOrigin !== targetOrigin)) {
      page = await this.context.newPage();
      this.ownedPages.add(page);
    }

    // 每个 origin 使用独立页面，避免 Auth/Sentinel 导航覆盖 ChatGPT OAuth 状态。
    if (currentOrigin !== targetOrigin && warmup) {
      await page.goto(`${targetOrigin}/`, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs
      });
      await page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
    }
    this.pagesByOrigin.set(targetOrigin, page);
    this.page = page;
    return page;
  }

  async ensureOrigin(url, timeoutMs) {
    return this.pageForOrigin(url, timeoutMs);
  }

  async request(payload) {
    const url = appendParams(payload.url, payload.params);
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    const method = String(payload.method || 'GET').toUpperCase();
    const normalized = normalizeHeaders(payload.headers);
    const page = await this.ensureOrigin(url, timeoutMs);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await page.evaluate(async ({ url, method, headers, body, allowRedirects, timeoutMs, referer }) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const requestBody = body === null || body === undefined
              ? undefined
              : (typeof body === 'string' ? body : JSON.stringify(body));
            const response = await fetch(url, {
              method,
              headers,
              body: requestBody,
              credentials: 'include',
              redirect: allowRedirects ? 'follow' : 'manual',
              referrer: referer || undefined,
              signal: controller.signal
            });
            return {
              status_code: response.status,
              status_text: response.statusText,
              url: response.url || url,
              headers: Object.fromEntries(response.headers.entries()),
              text: await response.text()
            };
          } finally {
            clearTimeout(timer);
          }
        }, {
          url,
          method,
          headers: normalized.headers,
          body: payload.body,
          allowRedirects: payload.allow_redirects !== false,
          timeoutMs,
          referer: normalized.referer
        });
      } catch (error) {
        const message = String(error?.message || error);
        const contextDestroyed = /execution context was destroyed|most likely because of a navigation/i.test(message);
        const transientFetch = isTransientPageFetchError(error);
        const diagnostic = formatPageRequestDiagnostic(page, method, url, error);
        if (!contextDestroyed && !transientFetch) {
          console.error(`[Roxy CDP] page request failed: ${diagnostic}`);
          throw error;
        }
        if (attempt === 2) {
          console.error(`[Roxy CDP] page request retry exhausted: ${diagnostic}`);
          throw error;
        }

        console.warn(`[Roxy CDP] page request transient failure, retrying (${attempt + 1}/2): ${diagnostic}`);
        if (contextDestroyed) {
          await this.page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => {});
        } else {
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(50, Math.floor(timeoutMs / 10)))));
        }
      }
    }
  }

  async navigate(payload) {
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    const page = await this.pageForOrigin(
      payload.page_origin || payload.url,
      timeoutMs,
      { warmup: false },
    );
    const normalized = normalizeHeaders(payload.headers);
    const response = await page.goto(payload.url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
      referer: normalized.referer || undefined
    });
    const finalUrl = page.url();
    if (this.originIsolationEnabled) {
      try {
        this.pagesByOrigin.set(new URL(finalUrl).origin, page);
      } catch (_) {
        // Keep the target-origin mapping when the page ends on a non-URL error page.
      }
    }
    this.page = page;
    const result = responseToResult(response, finalUrl);
    result.url = finalUrl;
    return result;
  }

  async sentinel(payload) {
    const sdkPath = String(payload.sdk_path || '').trim();
    if (!sdkPath || !fs.existsSync(sdkPath)) {
      throw new Error(`找不到 Sentinel SDK: ${sdkPath || '(empty)'}`);
    }
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    const page = await this.ensureOrigin('https://sentinel.openai.com/', timeoutMs);

    const deviceId = String(payload.device_id || '').trim();
    const flow = String(payload.flow || '').trim();
    if (!deviceId || !flow) throw new Error('Sentinel bridge 缺少 device_id 或 flow');

    // Sentinel SDK 会从 .openai.com 域的 oai-did cookie 组装 id 字段。
    await page.evaluate((id) => {
      document.cookie = `oai-did=${encodeURIComponent(id)}; Path=/; Domain=.openai.com; Secure; SameSite=Lax`;
    }, deviceId);

    const hasSdk = await page.evaluate(() => typeof window.SentinelSDK?.token === 'function');
    if (!hasSdk) await page.addScriptTag({ path: sdkPath });

    const output = await page.evaluate(async ({ flow: tokenFlow, deviceId: expectedId }) => {
      if (typeof window.SentinelSDK?.token !== 'function') {
        throw new Error('页面中没有 SentinelSDK.token');
      }
      const header = await window.SentinelSDK.token(tokenFlow);
      let observer = null;
      if (typeof window.SentinelSDK.sessionObserverToken === 'function') {
        observer = await window.SentinelSDK.sessionObserverToken(tokenFlow);
      }
      const headerData = JSON.parse(header);
      if (headerData.id && headerData.id !== expectedId) {
        throw new Error(`Sentinel SDK id 不匹配: expected=${expectedId} got=${headerData.id}`);
      }
      return { header, observer };
    }, { flow, deviceId });

    let soHeader = null;
    if (output.observer) {
      let observerData = output.observer;
      if (typeof observerData === 'string') observerData = JSON.parse(observerData);
      const headerData = JSON.parse(output.header);
      if (observerData && observerData.so) {
        soHeader = JSON.stringify({
          so: observerData.so,
          c: observerData.c || headerData.c || '',
          id: deviceId,
          flow
        });
      }
    }
    return { header: output.header, so_header: soHeader };
  }

  async fingerprint() {
    await this.ensureConnected();
    return this.page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemory: navigator.deviceMemory || null,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      webdriver: Boolean(navigator.webdriver),
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth
      },
      url: location.href
    }));
  }

  async ip() {
    if (!this.roxyClient) await this.ensureConnected();
    if (!this.roxyClient || typeof this.roxyClient.listBrowsers !== 'function') {
      return { ip: '' };
    }
    const response = await this.roxyClient.listBrowsers();
    const data = response && response.data;
    const rows = Array.isArray(data)
      ? data
      : (Array.isArray(data?.rows) ? data.rows
        : (Array.isArray(data?.list) ? data.list : []));
    const target = rows.find((row) => {
      if (this.roxyClient.dirId && String(row?.dirId || '') === String(this.roxyClient.dirId)) return true;
      if (this.roxyClient.windowSortNum !== undefined && this.roxyClient.windowSortNum !== '') {
        return String(row?.windowSortNum ?? row?.sortNum ?? '') === String(this.roxyClient.windowSortNum);
      }
      return this.roxyClient.windowName
        && String(row?.windowName || '').trim() === String(this.roxyClient.windowName).trim();
    }) || rows[0];
    return { ip: String(target?.proxyInfo?.lastIp || '').trim() };
  }

  async authWorkspaces() {
    await this.ensureConnected();
    if (!this.context || typeof this.context.cookies !== 'function') return [];
    const cookies = await this.context.cookies(['https://auth.openai.com/']);
    return extractAuthWorkspaces(cookies);
  }

  async close() {
    if (this.closed) return { closed: true };
    this.closed = true;
    for (const page of this.ownedPages) {
      if (page && !page.isClosed()) await page.close().catch(() => {});
    }
    if (this.browser) {
      // Playwright connected over CDP 时 close() 只断开连接，不关闭 Roxy profile。
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ownsPage = false;
    this.pagesByOrigin.clear();
    this.ownedPages.clear();
    return { closed: true };
  }
}

async function main() {
  const bridge = new RoxyCdpBridge();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let chain = Promise.resolve();

  input.on('line', (line) => {
    chain = chain.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({ id: null, ok: false, error: { message: `JSON parse failed: ${error.message}` } })}\n`);
        return;
      }

      try {
        let result;
        if (request.command === 'request') result = await bridge.request(request);
        else if (request.command === 'navigate') result = await bridge.navigate(request);
        else if (request.command === 'fingerprint') result = await bridge.fingerprint();
        else if (request.command === 'ip') result = await bridge.ip();
        else if (request.command === 'auth_workspaces') result = await bridge.authWorkspaces();
        else if (request.command === 'sentinel') result = await bridge.sentinel(request);
        else if (request.command === 'close') result = await bridge.close();
        else throw new Error(`未知 bridge command: ${request.command}`);

        await new Promise((resolve) => {
          process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n', resolve);
        });
        if (request.command === 'close') process.exit(0);
      } catch (error) {
        const message = error?.stack || error?.message || String(error);
        process.stdout.write(JSON.stringify({
          id: request.id,
          ok: false,
          error: { message }
        }) + '\n');
      }
    });
  });
}

module.exports = { RoxyCdpBridge, extractAuthWorkspaces };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  });
}
