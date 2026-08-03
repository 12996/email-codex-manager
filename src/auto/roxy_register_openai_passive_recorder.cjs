const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const endpoint = process.argv[2] || process.env.ROXY_CDP_ENDPOINT;
if (!endpoint) {
  console.error('Usage: node src/auto/roxy_register_openai_passive_recorder.cjs <cdp-endpoint>');
  process.exit(2);
}

const outFile = path.resolve(__dirname, 'roxy_register_openai.passive_recording.jsonl');
const startFile = path.resolve(__dirname, 'roxy_register_openai.passive_recording.start');
const stopFile = path.resolve(__dirname, 'roxy_register_openai.passive_recording.stop');
const startedAt = new Date().toISOString();
let recordingStarted = false;
const seenPages = new WeakSet();

for (const file of [startFile, stopFile]) {
  try {
    fs.rmSync(file, { force: true });
  } catch (_) {}
}

function sanitizeUrl(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|code|otp|pass|secret|mfa|challenge|__cf_chl|state|nonce/i.test(key)) {
        url.searchParams.set(key, '<redacted>');
      }
    }
    return url.toString();
  } catch (_) {
    return value.replace(/([?&][^=\s]*(?:token|code|otp|pass|secret|mfa|challenge|__cf_chl|state|nonce)[^=]*=)[^&\s]+/gi, '$1<redacted>');
  }
}

function sanitizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/authorization|cookie|token|secret|set-cookie/i.test(key)) result[key] = '<redacted>';
    else result[key] = String(value).slice(0, 200);
  }
  return result;
}

function write(record) {
  if (!recordingStarted) return;
  fs.appendFileSync(outFile, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n');
}

async function attachPage(page) {
  if (seenPages.has(page)) return;
  seenPages.add(page);

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      write({ type: 'navigation', url: sanitizeUrl(frame.url()) });
    }
  });

  page.on('domcontentloaded', () => {
    write({ type: 'domcontentloaded', url: sanitizeUrl(page.url()) });
  });

  page.on('load', async () => {
    write({ type: 'load', url: sanitizeUrl(page.url()), title: await page.title().catch(() => '') });
  });

  page.on('request', (request) => {
    const resourceType = request.resourceType();
    if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) return;
    write({
      type: 'request',
      method: request.method(),
      resourceType,
      url: sanitizeUrl(request.url()),
      headers: sanitizeHeaders(request.headers()),
    });
  });

  page.on('response', (response) => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) return;
    write({
      type: 'response',
      status: response.status(),
      method: request.method(),
      resourceType,
      url: sanitizeUrl(response.url()),
    });
  });

  page.on('popup', (popup) => {
    write({ type: 'popup', openerUrl: sanitizeUrl(page.url()), popupUrl: sanitizeUrl(popup.url()) });
    attachPage(popup).catch(() => {});
  });
}

(async () => {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  for (const context of browser.contexts()) {
    context.on('page', (page) => attachPage(page).catch(() => {}));
    for (const page of context.pages()) await attachPage(page);
  }

  console.log(`PASSIVE ARMED outFile=${outFile}`);
  console.log(`START by creating ${startFile}`);
  console.log(`STOP by creating ${stopFile}`);

  const interval = setInterval(async () => {
    if (!recordingStarted && fs.existsSync(startFile)) {
      recordingStarted = true;
      fs.writeFileSync(outFile, JSON.stringify({
        type: 'start',
        ts: new Date().toISOString(),
        startedAt,
        endpoint: '<redacted-cdp-endpoint>',
        mode: 'passive-no-dom-injection',
      }) + '\n');
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          write({
            type: 'page-state-at-start',
            url: sanitizeUrl(page.url()),
            title: await page.title().catch(() => ''),
          });
        }
      }
      console.log(`PASSIVE STARTED outFile=${outFile}`);
    }

    if (recordingStarted) {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          write({
            type: 'heartbeat',
            url: sanitizeUrl(page.url()),
            title: await page.title().catch(() => ''),
          });
        }
      }
    }

    if (fs.existsSync(stopFile)) {
      write({ type: 'stop-file-detected' });
      clearInterval(interval);
      await browser.close().catch(() => {});
      process.exit(0);
    }
  }, 3000);
})();
