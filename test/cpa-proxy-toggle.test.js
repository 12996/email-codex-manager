import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(import.meta.dirname, '..');
const scriptPath = join(projectRoot, 'scripts', 'cpa-proxy-toggle.sh');

function toBashPath(filePath) {
  if (process.platform !== 'win32') return filePath;
  const normalized = resolve(filePath).replaceAll('\\', '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  return match ? `/mnt/${match[1].toLowerCase()}/${match[2]}` : normalized;
}

function bashQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function createCase() {
  const dir = mkdtempSync(join(tmpdir(), 'cpa-proxy-toggle-'));
  const configPath = join(dir, 'config.yaml');
  writeFileSync(configPath, [
    'host: 0.0.0.0',
    'proxy-url: http://old-proxy:1234',
    'other:',
    '  proxy-url: http://nested-value:5678',
    ''
  ].join('\n'));
  return { dir, configPath };
}

function runScript(mode, configPath) {
  const command = [
    `CPA_PROXY_CONFIG_PATH=${bashQuote(toBashPath(configPath))}`,
    'CPA_PROXY_SERVICE_NAME=test-cliproxyapi.service',
    "CPA_PROXY_SUDO=''",
    'CPA_PROXY_SKIP_RESTART=1',
    'CPA_PROXY_SKIP_HOME_CHECK=1',
    bashQuote(toBashPath(scriptPath)),
    bashQuote(mode)
  ].join(' ');

  return spawnSync('bash', ['-lc', command], {
    encoding: 'utf8',
    env: process.env
  });
}

test('direct mode clears only the top-level proxy and creates a backup', () => {
  const { dir, configPath } = createCase();
  const result = runScript('direct', configPath);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = readFileSync(configPath, 'utf8');
  assert.match(config, /^proxy-url: ""$/m);
  assert.match(config, /^  proxy-url: http:\/\/nested-value:5678$/m);
  assert.equal(readdirSync(dir).filter((name) => name.startsWith('config.yaml.bak-')).length, 1);
});

test('home mode points CPA at the local mihomo mixed port', () => {
  const { configPath } = createCase();
  const result = runScript('home', configPath);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(readFileSync(configPath, 'utf8'), /^proxy-url: http:\/\/127\.0\.0\.1:7891$/m);
});

test('rollback restores the most recent config backup', () => {
  const { configPath } = createCase();
  assert.equal(runScript('direct', configPath).status, 0);
  const result = runScript('rollback', configPath);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(readFileSync(configPath, 'utf8'), /^proxy-url: http:\/\/old-proxy:1234$/m);
});

test('script does not mutate systemd proxy environment', () => {
  const source = readFileSync(scriptPath, 'utf8');

  assert.doesNotMatch(source, /daemon-reload/);
  assert.doesNotMatch(source, /Environment=(HTTP|HTTPS|ALL)_PROXY/);
  assert.doesNotMatch(source, /home-proxy\.conf/);
});
