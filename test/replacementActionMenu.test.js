import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const menuStart = appSource.indexOf('<div class="action-menu" hidden>');
const menuEnd = appSource.indexOf('</div>\n        </div>\n        <button type="button" data-action="detail"', menuStart);
const actionMenuTemplate = appSource.slice(menuStart, menuEnd);

test('replacement action menu omits removed controls', () => {
  for (const action of [
    'toggle-public-code',
    'sms',
    'json',
    'login-2fa',
    'copy-public-code-url',
  ]) {
    assert.doesNotMatch(actionMenuTemplate, new RegExp(`data-action="${action}"`));
  }
});

test('replacement action menu retains core controls', () => {
  for (const action of [
    'edit',
    'register-protocol',
    'register-no2fa',
    'register-no2fa-browser',
    'replace-2fa-protocol',
    'register',
    'replace',
    'replace-2fa',
    'delete',
  ]) {
    assert.match(actionMenuTemplate, new RegExp(`data-action="${action}"`));
  }
});

test('replacement action menu places edit before automated no2fa registration', () => {
  const source = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const editIndex = source.indexOf('data-action="edit"');
  const browserNo2faIndex = source.indexOf('data-action="register-no2fa-browser"');

  assert.ok(editIndex >= 0);
  assert.ok(browserNo2faIndex >= 0);
  assert.ok(editIndex < browserNo2faIndex);
});

test('replacement page cache version includes the automated no2fa action', () => {
  const indexSource = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

  assert.match(indexSource, /web\/app\.js\?v=automated-no2fa-browser-action/);
});
