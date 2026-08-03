const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const endpoint = process.argv[2] || process.env.ROXY_CDP_ENDPOINT;
if (!endpoint) {
  console.error('Usage: node src/auto/roxy_register_openai_recorder.cjs <cdp-endpoint>');
  process.exit(2);
}

const outFile = path.resolve(__dirname, 'roxy_register_openai.recording.jsonl');
const startFile = path.resolve(__dirname, 'roxy_register_openai.recording.start');
const stopFile = path.resolve(__dirname, 'roxy_register_openai.recording.stop');
const startedAt = new Date().toISOString();

let recordingStarted = false;
try {
  fs.rmSync(startFile, { force: true });
  fs.rmSync(stopFile, { force: true });
} catch (_) {}

function sanitizeUrl(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|code|otp|pass|secret|mfa|challenge|__cf_chl/i.test(key)) {
        url.searchParams.set(key, '<redacted>');
      }
    }
    return url.toString();
  } catch (_) {
    return value.replace(/([?&][^=\s]*(?:token|code|otp|pass|secret|mfa|challenge|__cf_chl)[^=]*=)[^&\s]+/gi, '$1<redacted>');
  }
}

function sanitizeRecord(value) {
  if (Array.isArray(value)) return value.map(sanitizeRecord);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/url/i.test(key) && typeof item === 'string') result[key] = sanitizeUrl(item);
    else result[key] = sanitizeRecord(item);
  }
  return result;
}

function append(record) {
  if (!recordingStarted) return;
  fs.appendFileSync(outFile, JSON.stringify(sanitizeRecord({ ts: new Date().toISOString(), ...record })) + '\n');
}

const recorderScript = `
(() => {
  if (window.__openAiRegisterRecorderInstalled) return;
  window.__openAiRegisterRecorderInstalled = true;

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  }

  function shortText(value) {
    return String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name', 'id', 'placeholder', 'type'];
    for (const attr of attrs) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      if (attr === 'id') return '#' + cssEscape(value);
      return tag + '[' + attr + '="' + String(value).replace(/"/g, '\\\\"') + '"]';
    }
    if (tag === 'button' || tag === 'a') {
      const text = shortText(el.innerText || el.textContent);
      if (text) return tag + ':has-text("' + text.replace(/"/g, '\\\\"') + '")';
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += '#' + cssEscape(cur.id);
        parts.unshift(part);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === cur.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function detailsFor(el) {
    const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    const type = (el && (el.getAttribute('type') || el.type) || '').toLowerCase();
    const value = typeof el?.value === 'string' ? el.value : '';
    const sensitive = ['password', 'email', 'tel'].includes(type) || /mail|pass|token|code|otp/i.test(el?.name || el?.id || el?.getAttribute?.('autocomplete') || '');
    return {
      tag,
      type,
      selector: selectorFor(el),
      text: shortText(el?.innerText || el?.textContent),
      name: el?.getAttribute?.('name') || '',
      placeholder: el?.getAttribute?.('placeholder') || '',
      ariaLabel: el?.getAttribute?.('aria-label') || '',
      value: value ? (sensitive ? '<redacted:' + value.length + '>' : value.slice(0, 120)) : '',
      checked: typeof el?.checked === 'boolean' ? el.checked : undefined,
    };
  }

  function send(action, el, extra = {}) {
    const payload = {
      action,
      url: location.href,
      title: document.title,
      ...detailsFor(el),
      ...extra,
    };
    if (window.__recordOpenAiRegisterAction) {
      window.__recordOpenAiRegisterAction(payload).catch(() => {});
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target && event.target.closest ? event.target.closest('button,a,input,textarea,select,[role="button"],[role="checkbox"],[role="radio"],[contenteditable="true"]') : event.target;
    send('click', target || event.target);
  }, true);

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) send('input', target);
  }, true);

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) send('change', target);
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') send('keydown-enter', event.target, { key: event.key });
  }, true);

  send('recorder-installed', document.documentElement);
})();
`;

(async () => {
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
  const seenPages = new WeakSet();

  async function attach(page) {
    if (seenPages.has(page)) return;
    seenPages.add(page);

    await page.exposeBinding('__recordOpenAiRegisterAction', async (source, payload) => {
      append({
        type: 'dom-action',
        pageUrl: source.page().url(),
        frameUrl: source.frame.url(),
        payload,
      });
    }).catch((error) => append({ type: 'expose-binding-error', message: String(error.message || error) }));

    await page.addInitScript({ content: recorderScript }).catch((error) => append({ type: 'add-init-script-error', message: String(error.message || error), url: page.url() }));

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) append({ type: 'navigation', url: frame.url() });
    });
    page.on('dialog', async (dialog) => {
      append({ type: 'dialog', dialogType: dialog.type(), message: dialog.message() });
    });
    page.on('popup', (popup) => {
      append({ type: 'popup', opener: page.url(), popupUrl: popup.url() });
      attach(popup).catch((error) => append({ type: 'attach-popup-error', message: String(error.message || error) }));
    });

    await page.evaluate(recorderScript).catch((error) => append({ type: 'evaluate-install-error', message: String(error.message || error), url: page.url() }));
    append({ type: 'attached-page', url: page.url(), title: await page.title().catch(() => '') });
  }

  for (const context of browser.contexts()) {
    context.on('page', (page) => attach(page).catch((error) => append({ type: 'attach-new-page-error', message: String(error.message || error) })));
    for (const page of context.pages()) await attach(page);
  }

  console.log(`ARMED outFile=${outFile}`);
  console.log(`START by creating ${startFile}`);
  console.log(`STOP by creating ${stopFile}`);
  console.log(`READY outFile=${outFile}`);

  const interval = setInterval(() => {
    if (!recordingStarted && fs.existsSync(startFile)) {
      recordingStarted = true;
      fs.writeFileSync(outFile, JSON.stringify(sanitizeRecord({
        type: 'start',
        ts: new Date().toISOString(),
        startedAt,
        endpoint: '<redacted-cdp-endpoint>',
      })) + '\n');
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          append({ type: 'page-state-at-start', url: page.url() });
          page.title()
            .then((title) => append({ type: 'page-title-at-start', url: page.url(), title }))
            .catch(() => {});
        }
      }
      console.log(`STARTED outFile=${outFile}`);
    }
    if (fs.existsSync(stopFile)) {
      append({ type: 'stop-file-detected' });
      clearInterval(interval);
      browser.close().catch(() => {});
      process.exit(0);
    }
  }, 1000);
})();
