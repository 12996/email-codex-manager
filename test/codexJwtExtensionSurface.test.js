import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionRoot = path.join(projectRoot, 'extensions', 'codex-oauth-login');

function readExtensionFile(name) {
  return fs.readFileSync(path.join(extensionRoot, name), 'utf8');
}

test('JWT extension surface has minimum permissions and no OAuth or RT paths', () => {
  const manifest = JSON.parse(readExtensionFile('manifest.json'));
  const backgroundSource = readExtensionFile('background.js');
  const appHtml = readExtensionFile('app.html');
  const appSource = readExtensionFile('app.js');

  assert.deepEqual(manifest.permissions, ['storage']);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.equal(manifest.incognito, 'split');
  assert.doesNotMatch(backgroundSource, /webNavigation|oauth\/token|auth:download-rt|offscreen/);
  assert.doesNotMatch(appHtml, /下载 RT|网页登录 Codex/);
  assert.match(appHtml, /使用 JWT 登录/);
  assert.doesNotMatch(appSource, /auth:start|auth:download-rt|refreshToken/);

  for (const relativePath of [
    'lib/oauth-core.js',
    'lib/auth-controller.js',
    'lib/rt-download.js',
    'download.html',
    'download.js',
  ]) {
    assert.equal(fs.existsSync(path.join(extensionRoot, relativePath)), false, relativePath);
  }
  for (const relativePath of [
    'test/codexOauthExtensionCore.test.js',
    'test/codexOauthExtensionController.test.js',
    'test/codexOauthExtensionDownload.test.js',
  ]) {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), false, relativePath);
  }
});
