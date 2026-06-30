import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildSshArgs,
  assertPortFree,
  normalizeStartOptions,
} = require('../scripts/start-with-imap-proxy.cjs');

test('normalizeStartOptions builds local SOCKS proxy defaults for IMAP', () => {
  const result = normalizeStartOptions({
    IMAP_PROXY_SSH_HOST: 'vps-LA',
  });

  assert.equal(result.sshHost, 'vps-LA');
  assert.equal(result.localHost, '127.0.0.1');
  assert.equal(result.localPort, 11080);
  assert.equal(result.imapProxy, 'socks5://127.0.0.1:11080');
  assert.deepEqual(result.serverCommand, ['node', ['src/server.js']]);
});

test('buildSshArgs uses keepalive and fail-fast forwarding options', () => {
  assert.deepEqual(buildSshArgs({
    sshHost: 'vps-LA',
    localHost: '127.0.0.1',
    localPort: 11080,
  }), [
    '-N',
    '-D',
    '127.0.0.1:11080',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    'vps-LA',
  ]);
});

test('assertPortFree rejects an already occupied local port', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await assert.rejects(
      assertPortFree('127.0.0.1', port),
      /already in use/,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
