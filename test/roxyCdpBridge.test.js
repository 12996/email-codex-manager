import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RoxyCdpBridge } = require('../src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs');

test('Roxy CDP origin warmup waits for the page load event before page-context fetches', async () => {
  const calls = [];
  const bridge = new RoxyCdpBridge();
  bridge.page = {
    isClosed: () => false,
    url: () => 'about:blank',
    async goto(url, options) {
      calls.push(['goto', url, options.waitUntil]);
    },
    async waitForLoadState(state) {
      calls.push(['waitForLoadState', state]);
    },
  };

  await bridge.ensureOrigin('https://chatgpt.com/api/auth/providers', 30000);

  assert.deepEqual(calls, [
    ['goto', 'https://chatgpt.com/', 'domcontentloaded'],
    ['waitForLoadState', 'load'],
  ]);
});

test('Roxy CDP request retries a transient page fetch failure', async () => {
  const bridge = new RoxyCdpBridge();
  let attempts = 0;
  bridge.page = {
    isClosed: () => false,
    url: () => 'https://chatgpt.com/',
    async evaluate() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('page.evaluate: TypeError: Failed to fetch');
      }
      return {
        status_code: 200,
        status_text: 'OK',
        url: 'https://chatgpt.com/api/auth/providers',
        headers: {},
        text: '{}',
      };
    },
  };

  const result = await bridge.request({
    url: 'https://chatgpt.com/api/auth/providers',
    method: 'GET',
    timeout_ms: 1,
  });

  assert.equal(result.status_code, 200);
  assert.equal(attempts, 2);
});
