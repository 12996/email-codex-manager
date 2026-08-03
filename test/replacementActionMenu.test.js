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
    'register-protocol',
    'register-no2fa',
    'replace-2fa-protocol',
    'edit',
    'register',
    'replace',
    'replace-2fa',
    'delete',
  ]) {
    assert.match(actionMenuTemplate, new RegExp(`data-action="${action}"`));
  }
});
