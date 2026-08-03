'use strict';

// Manual, read-only CDP compatibility probe. It never navigates, fills forms,
// or prints CDP endpoints, cookies, credentials, or page URLs.
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const requireFromHere = createRequire(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_PLAYWRIGHT_TIMEOUT_MS = 10_000;

function parseArgs(argv = process.argv.slice(2)) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--dir-id') {
      result.dirId = argv[index + 1] || '';
      index += 1;
    } else if (current === '--playwright-child') {
      result.playwrightChild = true;
    }
  }
  return result;
}

function elapsedSince(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function safeError(error) {
  const message = String(error?.message || error || 'unknown error')
    .replace(/(?:ws|wss):\/\/[^\s"']+/gi, '[redacted-cdp-endpoint]')
    .replace(/\s+/g, ' ')
    .slice(0, 240);
  return { name: String(error?.name || 'Error'), message };
}

function commandResult(method, startedAt, result) {
  return {
    method,
    ok: true,
    durationMs: elapsedSince(startedAt),
    result,
  };
}

function commandFailure(method, startedAt, error) {
  return {
    method,
    ok: false,
    durationMs: elapsedSince(startedAt),
    error: safeError(error),
  };
}

class CdpConnection {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open(timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    if (typeof WebSocket !== 'function') {
      throw new Error('当前 Node 运行时没有 WebSocket API');
    }

    this.socket = new WebSocket(this.endpoint);
    this.socket.addEventListener('message', (event) => this.onMessage(event));
    this.socket.addEventListener('close', () => this.failPending(new Error('CDP WebSocket closed')));
    this.socket.addEventListener('error', () => this.failPending(new Error('CDP WebSocket error')));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), timeoutMs);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket open failed'));
      }, { once: true });
    });
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.method) {
      this.events.push(String(message.method));
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new Error(`${message.error.code || 'CDP'}: ${message.error.message || 'command failed'}`));
      return;
    }
    pending.resolve(message.result || {});
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  send(method, params = {}, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.failPending(new Error('CDP probe closed'));
    this.socket?.close();
  }
}

async function runRawProbe(endpoint) {
  const cdp = new CdpConnection(endpoint);
  const result = { transport: null, commands: [], events: [] };
  const openedAt = Date.now();
  try {
    await cdp.open();
    result.transport = { ok: true, durationMs: elapsedSince(openedAt) };

    const checks = [
      ['Browser.getVersion', {}, (value) => ({
        protocolVersion: String(value.protocolVersion || ''),
        productFamily: String(value.product || '').split('/')[0] || '',
      })],
      ['Target.getTargets', {}, (value) => ({
        targetCount: Array.isArray(value.targetInfos) ? value.targetInfos.length : 0,
        targetTypes: [...new Set((value.targetInfos || []).map((item) => String(item.type || 'unknown')))].sort(),
      })],
      ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, () => ({})],
      ['Target.getTargetInfo', {}, (value) => ({ hasTargetInfo: Boolean(value.targetInfo) })],
    ];

    for (const [method, params, summarize] of checks) {
      const startedAt = Date.now();
      try {
        const value = await cdp.send(method, params);
        result.commands.push(commandResult(method, startedAt, summarize(value)));
      } catch (error) {
        result.commands.push(commandFailure(method, startedAt, error));
        break;
      }
    }
  } catch (error) {
    result.transport = { ok: false, durationMs: elapsedSince(openedAt), error: safeError(error) };
  } finally {
    // Restore auto-attach before disconnecting so this probe does not retain a debugger policy.
    if (cdp.socket?.readyState === WebSocket.OPEN) {
      await cdp.send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true })
        .catch(() => {});
    }
    result.events = [...new Set(cdp.events)].slice(0, 12);
    cdp.close();
  }
  return result;
}

function collectProtocolMethods(output) {
  const methods = [];
  const seen = new Set();
  const matcher = /"method"\s*:\s*"([^"]+)"/g;
  for (const match of String(output || '').matchAll(matcher)) {
    const method = match[1];
    if (!seen.has(method)) {
      seen.add(method);
      methods.push(method);
    }
  }
  return methods.slice(-20);
}

async function runPlaywrightChild(endpoint) {
  const { chromium } = requireFromHere('playwright-core');
  const startedAt = Date.now();
  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: DEFAULT_PLAYWRIGHT_TIMEOUT_MS });
    const contexts = browser.contexts();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      durationMs: elapsedSince(startedAt),
      contextCount: contexts.length,
      pageCount: contexts.reduce((total, context) => total + context.pages().length, 0),
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      durationMs: elapsedSince(startedAt),
      error: safeError(error),
    })}\n`);
    process.exitCode = 2;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function runPlaywrightProbe(endpoint) {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [__filename, '--playwright-child'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ROXY_CDP_PROBE_ENDPOINT: endpoint,
      DEBUG: 'pw:protocol',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, timedOut: true });
    }, DEFAULT_PLAYWRIGHT_TIMEOUT_MS + 2_000);
    child.once('exit', () => {
      clearTimeout(timer);
      const line = stdout.trim().split(/\r?\n/).at(-1) || '';
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ ok: false, error: { name: 'ProbeError', message: 'Playwright child returned no structured result' } });
      }
    });
  });

  return {
    ...result,
    durationMs: elapsedSince(startedAt),
    lastCdpMethods: collectProtocolMethods(stderr),
  };
}

function resolveLiveConfig(args, env = process.env) {
  requireFromHere('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
  const manualConfig = requireFromHere('./manual-roxy-proxy-refresh.cjs').manualConfig || {};
  const dirId = String(args.dirId || env.ROXY_CDP_PROBE_DIR_ID || env.ROXY_BROWSER_DIR_ID || manualConfig.dirId || '').trim();
  if (!dirId) throw new Error('missing --dir-id, ROXY_CDP_PROBE_DIR_ID, or ROXY_BROWSER_DIR_ID');
  return {
    dirId,
    apiBaseUrl: manualConfig.apiBaseUrl || env.ROXY_API_BASE_URL || undefined,
    apiPort: manualConfig.apiPort || env.ROXY_API_PORT || undefined,
    token: manualConfig.apiToken || env.ROXY_API_TOKEN || undefined,
    workspaceId: Number(manualConfig.workspaceId || env.ROXY_WORKSPACE_ID || 0),
  };
}

function shouldRunCli(env = process.env) {
  return !env.NODE_TEST_CONTEXT;
}

async function main() {
  const args = parseArgs();
  if (args.playwrightChild) {
    await runPlaywrightChild(String(process.env.ROXY_CDP_PROBE_ENDPOINT || '').trim());
    return;
  }

  const config = resolveLiveConfig(args);
  const { RoxyBrowserClient } = requireFromHere('../src/auto/roxy-browser-client.cjs');
  const client = new RoxyBrowserClient(config);
  const connection = await client.getConnectionInfo();
  const endpoint = String(connection.ws || '').trim();
  if (!endpoint) throw new Error('Roxy returned no CDP endpoint');

  const raw = await runRawProbe(endpoint);
  const playwright = await runPlaywrightProbe(endpoint);
  process.stdout.write(`${JSON.stringify({
    ok: Boolean(raw.transport?.ok && playwright.ok),
    raw,
    playwright,
  }, null, 2)}\n`);
}

if (require.main === module && shouldRunCli()) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CdpConnection,
  collectProtocolMethods,
  parseArgs,
  runRawProbe,
  safeError,
  shouldRunCli,
};
