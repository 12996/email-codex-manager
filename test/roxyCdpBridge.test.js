import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { RoxyCdpBridge } = require('../src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs');

test('replaces a chrome error page before retrying the same origin request', async () => {
  const failedPage = {
    isClosed: () => false,
    url: () => 'chrome-error://chromewebdata/',
  };
  const recoveredPage = {
    isClosed: () => false,
    url: () => 'https://chatgpt.com/',
    goto: async () => undefined,
  };
  let createdPages = 0;
  const bridge = new RoxyCdpBridge({ originIsolationEnabled: true });
  bridge.browser = {};
  bridge.context = {
    pages: () => [failedPage],
    newPage: async () => {
      createdPages += 1;
      return recoveredPage;
    },
  };
  bridge.page = failedPage;
  bridge.pagesByOrigin.set('https://chatgpt.com', failedPage);

  const page = await bridge.pageForOrigin('https://chatgpt.com/api/auth/providers', 1000);

  assert.equal(page, recoveredPage);
  assert.equal(createdPages, 1);
  assert.equal(bridge.pagesByOrigin.get('https://chatgpt.com'), recoveredPage);
});
