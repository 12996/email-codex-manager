const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const endpoint = process.argv[2] || process.env.ROXY_CDP_ENDPOINT;
if (!endpoint) {
  console.error('Usage: node src/auto/roxy_register_openai_cdp_network_recorder.cjs <cdp-endpoint>');
  process.exit(2);
}

const outFile = path.resolve(__dirname, 'roxy_register_openai.cdp_network_recording.jsonl');
const startFile = path.resolve(__dirname, 'roxy_register_openai.cdp_network_recording.start');
const stopFile = path.resolve(__dirname, 'roxy_register_openai.cdp_network_recording.stop');
const seenPages = new WeakSet();
let recordingStarted = false;

for (const file of [startFile, stopFile]) {
  fs.rmSync(file, { force: true });
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
  const summary = { length: postData.length };
  try {
    summary.format = 'json';
    summary.fields = bodySchema(JSON.parse(postData));
    return summary;
  } catch (_) {}
  // Only parse a conventional form body. URLSearchParams would otherwise
  // treat arbitrary telemetry JSON as one giant key and leak its contents.
  if (!/[\r\n]/.test(postData) && /^[A-Za-z0-9_.%~-]+=[^&]*(&[A-Za-z0-9_.%~-]+=[^&]*)*$/.test(postData)) {
    const params = new URLSearchParams(postData);
    summary.format = 'form';
    summary.fields = Array.from(params.keys()).sort();
    return summary;
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

function write(record) {
  if (!recordingStarted) return;
  fs.appendFileSync(outFile, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}

async function attachPage(page) {
  if (seenPages.has(page)) return;
  seenPages.add(page);

  const cdp = await page.context().newCDPSession(page);
  const responses = new Map();
  await cdp.send('Network.enable', { maxPostDataSize: 65536 });

  cdp.on('Network.requestWillBeSent', (event) => {
    write({
      type: 'cdp-request',
      method: event.request.method,
      resourceType: event.type,
      url: sanitizeUrl(event.request.url),
      initiator: event.initiator?.type || '',
      headerNames: Object.keys(event.request.headers || {}).sort(),
      body: summarizePostData(event.request.postData),
    });
  });

  cdp.on('Network.responseReceived', (event) => {
    responses.set(event.requestId, {
      status: event.response.status,
      resourceType: event.type,
      url: sanitizeUrl(event.response.url),
      mimeType: event.response.mimeType,
    });
  });

  cdp.on('Network.loadingFinished', async (event) => {
    const response = responses.get(event.requestId);
    responses.delete(event.requestId);
    if (!response) return;
    let responseSummary = null;
    if (/json/i.test(response.mimeType || '')) {
      try {
        const body = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
        responseSummary = summarizeJsonResponse(body.body);
      } catch (_) {
        responseSummary = { body_unavailable: true };
      }
    }
    write({ type: 'cdp-response', ...response, response: responseSummary });
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) write({ type: 'navigation', url: sanitizeUrl(frame.url()) });
  });
  page.on('popup', (popup) => attachPage(popup).catch(() => {}));
  write({ type: 'attached-page', url: sanitizeUrl(page.url()) });
}

(async () => {
  const browser = await chromium.connectOverCDP(endpoint);
  for (const context of browser.contexts()) {
    context.on('page', (page) => attachPage(page).catch(() => {}));
    for (const page of context.pages()) await attachPage(page);
  }

  console.log(`CDP NETWORK ARMED outFile=${outFile}`);
  console.log(`START by creating ${startFile}`);
  console.log(`STOP by creating ${stopFile}`);

  const interval = setInterval(async () => {
    if (!recordingStarted && fs.existsSync(startFile)) {
      recordingStarted = true;
      write({ type: 'start', mode: 'cdp-network-schema-only' });
      console.log(`CDP NETWORK STARTED outFile=${outFile}`);
    }
    if (fs.existsSync(stopFile)) {
      write({ type: 'stop-file-detected' });
      clearInterval(interval);
      await browser.close().catch(() => {});
      process.exit(0);
    }
  }, 500);
})();
