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
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.roxyClient = null;
    this.closed = false;
    this.ownsPage = false;
  }

  async ensureConnected() {
    if (this.page && !this.page.isClosed()) return;
    if (this.closed) throw new Error('Roxy CDP bridge 已关闭');

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
      }
    }
  }

  async ensureOrigin(url, timeoutMs) {
    await this.ensureConnected();
    const targetOrigin = new URL(url).origin;
    let currentOrigin = '';
    try {
      currentOrigin = new URL(this.page.url()).origin;
    } catch (_) {
      currentOrigin = '';
    }
    if (currentOrigin === targetOrigin) return;

    // 先把 document origin 切到目标站点，再由该页面发 fetch，避免跨源 CORS。
    await this.page.goto(`${targetOrigin}/`, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    await this.page.waitForLoadState('load', { timeout: timeoutMs }).catch(() => {});
  }

  async request(payload) {
    const url = appendParams(payload.url, payload.params);
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    const method = String(payload.method || 'GET').toUpperCase();
    const normalized = normalizeHeaders(payload.headers);
    await this.ensureOrigin(url, timeoutMs);

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await this.page.evaluate(async ({ url, method, headers, body, allowRedirects, timeoutMs, referer }) => {
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
        const diagnostic = formatPageRequestDiagnostic(this.page, method, url, error);
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
    await this.ensureConnected();
    const normalized = normalizeHeaders(payload.headers);
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    const response = await this.page.goto(payload.url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
      referer: normalized.referer || undefined
    });
    const result = responseToResult(response, this.page.url());
    if (response) result.text = await response.text().catch(() => '');
    result.url = this.page.url();
    return result;
  }

  async sentinel(payload) {
    const sdkPath = String(payload.sdk_path || '').trim();
    if (!sdkPath || !fs.existsSync(sdkPath)) {
      throw new Error(`找不到 Sentinel SDK: ${sdkPath || '(empty)'}`);
    }
    const timeoutMs = Math.max(1, asNumber(payload.timeout_ms, 60000));
    await this.ensureOrigin('https://sentinel.openai.com/', timeoutMs);

    const deviceId = String(payload.device_id || '').trim();
    const flow = String(payload.flow || '').trim();
    if (!deviceId || !flow) throw new Error('Sentinel bridge 缺少 device_id 或 flow');

    // Sentinel SDK 会从 .openai.com 域的 oai-did cookie 组装 id 字段。
    await this.page.evaluate((id) => {
      document.cookie = `oai-did=${encodeURIComponent(id)}; Path=/; Domain=.openai.com; Secure; SameSite=Lax`;
    }, deviceId);

    const hasSdk = await this.page.evaluate(() => typeof window.SentinelSDK?.token === 'function');
    if (!hasSdk) await this.page.addScriptTag({ path: sdkPath });

    const output = await this.page.evaluate(async ({ flow: tokenFlow, deviceId: expectedId }) => {
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

  async close() {
    if (this.closed) return { closed: true };
    this.closed = true;
    if (this.ownsPage && this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    if (this.browser) {
      // Playwright connected over CDP 时 close() 只断开连接，不关闭 Roxy profile。
      await this.browser.close().catch(() => {});
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ownsPage = false;
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

module.exports = { RoxyCdpBridge };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error?.message || error}\n`);
    process.exit(1);
  });
}
