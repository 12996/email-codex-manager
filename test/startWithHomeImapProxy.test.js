import assert from 'node:assert/strict';
import net from 'node:net';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  assertPortFree,
  buildSshArgs,
  normalizeStartOptions,
} = require('../scripts/start-with-home-imap-proxy.cjs');

test('normalizeStartOptions builds home broadband IMAP proxy defaults', () => {
  const result = normalizeStartOptions({});

  assert.equal(result.sshHost, 'vps-LA');
  assert.equal(result.localHost, '127.0.0.1');
  assert.equal(result.localPort, 11080);
  assert.equal(result.remoteHost, '127.0.0.1');
  assert.equal(result.remotePort, 7891);
  assert.equal(result.imapProxy, 'socks5://127.0.0.1:11080');
  assert.deepEqual(result.serverCommand, ['node', ['src/server.js']]);
});

test('normalizeStartOptions accepts home proxy endpoint overrides', () => {
  const result = normalizeStartOptions({
    IMAP_HOME_PROXY_SSH_HOST: 'custom-vps',
    IMAP_HOME_PROXY_LOCAL_HOST: '127.0.0.2',
    IMAP_HOME_PROXY_LOCAL_PORT: '12080',
    IMAP_HOME_PROXY_REMOTE_HOST: '127.0.0.3',
    IMAP_HOME_PROXY_REMOTE_PORT: '7892',
  });

  assert.equal(result.sshHost, 'custom-vps');
  assert.equal(result.localHost, '127.0.0.2');
  assert.equal(result.localPort, 12080);
  assert.equal(result.remoteHost, '127.0.0.3');
  assert.equal(result.remotePort, 7892);
  assert.equal(result.imapProxy, 'socks5://127.0.0.2:12080');
});

test('buildSshArgs uses local forwarding to vps home proxy instead of dynamic SOCKS', () => {
  const args = buildSshArgs({
    sshHost: 'vps-LA',
    localHost: '127.0.0.1',
    localPort: 11080,
    remoteHost: '127.0.0.1',
    remotePort: 7891,
  });

  assert.deepEqual(args, [
    '-N',
    '-L',
    '127.0.0.1:11080:127.0.0.1:7891',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    'vps-LA',
  ]);
  assert.equal(args.includes('-D'), false);
});

test('assertPortFree rejects an already occupied home proxy local port', async () => {
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
