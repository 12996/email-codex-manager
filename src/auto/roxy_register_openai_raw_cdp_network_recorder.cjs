'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { RoxyBrowserClient } = require('./roxy-browser-client.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT_FILE = path.resolve(__dirname, 'roxy_register_openai.raw_cdp_network_recording.jsonl');
const DEFAULT_READY_FILE = path.resolve(__dirname, 'roxy_register_openai.raw_cdp_network_recording.ready');
const DEFAULT_STOP_FILE = path.resolve(__dirname, 'roxy_register_openai.raw_cdp_network_recording.stop');

function requiredText(value, name) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function sanitizeUrl(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|code|otp|pass|secret|mfa|challenge|state|nonce|email/i.test(key)) {
        url.searchParams.set(key, '<redacted>');
      }
    }
    return url.toString();
  } catch (_) {
    return '<non-url>';
  }
}

function bodySchema(value, prefix = '', fields = []) {
  if (Array.isArray(value)) {
    fields.push(`${prefix || '$'}[]`);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      bodySchema(child, prefix ? `${prefix}.${key}` : key, fields);
    }
  } else if (prefix) {
    fields.push(prefix);
  }
  return fields.sort();
}

function summarizePostData(postData) {
  if (!postData) return null;
  const summary = { length: String(postData).length };
  try {
    return { ...summary, format: 'json', fields: bodySchema(JSON.parse(postData)) };
  } catch (_) {}
  if (!/[\r\n]/.test(postData) && /^[A-Za-z0-9_.%~-]+=[^&]*(&[A-Za-z0-9_.%~-]+=[^&]*)*$/.test(postData)) {
    const params = new URLSearchParams(postData);
    return { ...summary, format: 'form', fields: Array.from(params.keys()).sort() };
  }
  return { ...summary, format: 'opaque' };
}

function summarizeJsonResponse(body) {
  try {
    const data = JSON.parse(body);
    return {
      json_fields: bodySchema(data),
      page_type: data?.page?.type || null,
      method: data?.method || null,
      has_continue_url: Boolean(data?.continue_url),
      error_code: data?.error?.code || null,
    };
  } catch (_) {
    return null;
  }
}

function safeErrorCode(error) {
  return String(error?.code || error?.name || 'CDP_ERROR').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 80);
}

function createTargetAttachGuard() {
  const attaching = new Set();
  return {
    begin(targetId) {
      const key = String(targetId || '');
      if (!key || attaching.has(key)) return false;
      attaching.add(key);
      return true;
    },
    finish(targetId) {
      attaching.delete(String(targetId || ''));
    },
  };
}

class RawCdpConnection {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Set();
  }

  async open(timeoutMs = 10000) {
    if (typeof WebSocket !== 'function') throw new Error('Node WebSocket API is unavailable');
    this.socket = new WebSocket(this.endpoint);
    this.socket.addEventListener('message', (event) => this.onMessage(event));
    this.socket.addEventListener('close', () => this.failPending(new Error('CDP socket closed')));
    this.socket.addEventListener('error', () => this.failPending(new Error('CDP socket error')));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP socket open timeout')), timeoutMs);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP socket open failed'));
      }, { once: true });
    });
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch (_) {
      return;
    }
    if (message.method) {
      for (const handler of this.eventHandlers) handler(message);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(Object.assign(new Error(message.error.message || 'CDP command failed'), { code: `CDP_${message.error.code || 'ERROR'}` }));
      return;
    }
    pending.resolve(message.result || {});
  }

  send(method, params = {}, { sessionId, timeoutMs = 10000 } = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`CDP command timeout: ${method}`), { code: 'CDP_COMMAND_TIMEOUT' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  failPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.failPending(new Error('CDP recorder closed'));
    this.socket?.close();
  }
}

function resolveTargetDirId(env = process.env) {
  return requiredText(
    env.ROXY_CDP_RECORDER_DIR_ID || env.ROXY_NO_2FA_BROWSER_DIR_ID || env.ROXY_PROTOCOL_BROWSER_DIR_ID,
    'ROXY_CDP_RECORDER_DIR_ID, ROXY_NO_2FA_BROWSER_DIR_ID, or ROXY_PROTOCOL_BROWSER_DIR_ID',
  );
}

function createRoxyClient(env, dirId) {
  return new RoxyBrowserClient({
    apiBaseUrl: String(env.ROXY_API_BASE_URL || '').trim() || undefined,
    apiPort: String(env.ROXY_API_PORT || '').trim() || undefined,
    token: String(env.ROXY_API_TOKEN || '').trim() || undefined,
    workspaceId: Number(env.ROXY_WORKSPACE_ID || 0),
    dirId,
  });
}

async function startRawNetworkRecorder(options = {}) {
  const env = options.env || process.env;
  const outFile = options.outFile || DEFAULT_OUT_FILE;
  const dirId = resolveTargetDirId(env);
  const client = options.client || createRoxyClient(env, dirId);
  const connection = await client.getConnectionInfo();
  const cdp = options.cdp || new RawCdpConnection(requiredText(connection?.ws, 'Roxy CDP websocket'));
  const sessions = new Map();
  const attachGuard = createTargetAttachGuard();
  let stopped = false;

  const write = (record) => {
    if (!stopped) fs.appendFileSync(outFile, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
  };

  const attachTarget = async (target) => {
    if (stopped || target?.type !== 'page') return;
    if ([...sessions.values()].some((entry) => entry.targetId === target.targetId)) return;
    if (!attachGuard.begin(target.targetId)) return;
    try {
      const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      const sessionId = requiredText(attached?.sessionId, 'CDP target session');
      sessions.set(sessionId, { targetId: target.targetId, responses: new Map() });
      await cdp.send('Network.enable', { maxPostDataSize: 65536 }, { sessionId });
      await cdp.send('Page.enable', {}, { sessionId });
      write({ type: 'attached-page', url: sanitizeUrl(target.url) });
    } finally {
      attachGuard.finish(target.targetId);
    }
  };

  cdp.onEvent((event) => {
    if (stopped) return;
    if (event.method === 'Target.targetCreated') {
      attachTarget(event.params?.targetInfo).catch((error) => write({ type: 'attach-failed', code: safeErrorCode(error) }));
      return;
    }
    const session = sessions.get(event.sessionId);
    if (!session) return;
    const params = event.params || {};
    if (event.method === 'Network.requestWillBeSent') {
      write({
        type: 'cdp-request',
        method: params.request?.method || '',
        resourceType: params.type || '',
        url: sanitizeUrl(params.request?.url),
        initiator: params.initiator?.type || '',
        headerNames: Object.keys(params.request?.headers || {}).sort(),
        body: summarizePostData(params.request?.postData),
      });
      return;
    }
    if (event.method === 'Network.responseReceived') {
      session.responses.set(params.requestId, {
        status: params.response?.status || 0,
        resourceType: params.type || '',
        url: sanitizeUrl(params.response?.url),
        mimeType: params.response?.mimeType || '',
      });
      return;
    }
    if (event.method === 'Network.loadingFinished') {
      const response = session.responses.get(params.requestId);
      session.responses.delete(params.requestId);
      if (!response) return;
      (async () => {
        let responseSummary = null;
        if (/json/i.test(response.mimeType)) {
          try {
            const body = await cdp.send('Network.getResponseBody', { requestId: params.requestId }, { sessionId: event.sessionId });
            responseSummary = summarizeJsonResponse(body.body);
          } catch (_) {
            responseSummary = { body_unavailable: true };
          }
        }
        write({ type: 'cdp-response', ...response, response: responseSummary });
      })().catch(() => {});
      return;
    }
    if (event.method === 'Page.frameNavigated' && !params.frame?.parentId) {
      write({ type: 'navigation', url: sanitizeUrl(params.frame?.url) });
    }
  });

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    type: 'start',
    ts: new Date().toISOString(),
    mode: 'raw-cdp-network-schema-only',
  }) + '\n');
  await cdp.open();
  await cdp.send('Target.setDiscoverTargets', { discover: true });
  const targets = await cdp.send('Target.getTargets');
  for (const target of targets.targetInfos || []) await attachTarget(target);

  return {
    outFile,
    async stop() {
      if (stopped) return;
      write({ type: 'stop' });
      stopped = true;
      cdp.close();
    },
  };
}

async function main() {
  require('dotenv').config({ path: path.join(PROJECT_ROOT, '.env') });
  fs.rmSync(DEFAULT_STOP_FILE, { force: true });
  fs.rmSync(DEFAULT_READY_FILE, { force: true });
  const recorder = await startRawNetworkRecorder();
  fs.writeFileSync(DEFAULT_READY_FILE, JSON.stringify({
    mode: 'raw-cdp-network-schema-only',
    armedAt: new Date().toISOString(),
  }));
  process.stdout.write(`RAW_CDP_NETWORK_ARMED outFile=${recorder.outFile}\n`);
  const stopFile = DEFAULT_STOP_FILE;
  const stop = async () => {
    clearInterval(interval);
    await recorder.stop();
    process.exitCode = 0;
  };
  const interval = setInterval(() => {
    if (fs.existsSync(stopFile)) stop().catch(() => { process.exitCode = 1; });
  }, 500);
  process.once('SIGINT', () => stop().catch(() => { process.exitCode = 1; }));
}

if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
  main().catch((error) => {
    process.stderr.write(`RAW_CDP_NETWORK_FAILED code=${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_READY_FILE,
  DEFAULT_STOP_FILE,
  RawCdpConnection,
  createTargetAttachGuard,
  sanitizeUrl,
  startRawNetworkRecorder,
  summarizeJsonResponse,
  summarizePostData,
};
