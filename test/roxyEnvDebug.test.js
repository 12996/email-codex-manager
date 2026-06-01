import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { collectDebugInput } = require('../src/auto/roxy_env_debug.js');

test('collectDebugInput 从环境变量读取临时账号、手机号和 sms api', () => {
  const oldEnv = { ...process.env };
  process.env.REPLACE_EMAIL = 'user@example.com';
  process.env.REPLACE_PASSWORD = 'secret';
  process.env.REPLACE_PHONE = '+1234567890';
  process.env.REPLACE_SMS_API = 'https://example.test/sms';
  process.env.REPLACE_ACCOUNT_ID = '42';
  process.env.REPLACE_REMARK = 'debug';

  try {
    const input = collectDebugInput();

    assert.equal(input.REPLACE_EMAIL.value, 'user@example.com');
    assert.equal(input.REPLACE_PHONE.value, '+1234567890');
    assert.equal(input.REPLACE_SMS_API.value, 'https://example.test/sms');
    assert.equal(input.REPLACE_PASSWORD.displayValue, '已配置');
    assert.equal(input.REPLACE_ACCOUNT_ID.value, '42');
    assert.equal(input.REPLACE_REMARK.value, 'debug');
  } finally {
    process.env = oldEnv;
  }
});

test('collectDebugInput 缺少必填环境变量时报错', () => {
  const oldEnv = { ...process.env };
  delete process.env.REPLACE_EMAIL;
  process.env.REPLACE_PHONE = '+1234567890';
  process.env.REPLACE_SMS_API = 'https://example.test/sms';

  try {
    assert.throws(() => collectDebugInput(), /缺少环境变量: REPLACE_EMAIL/);
  } finally {
    process.env = oldEnv;
  }
});
