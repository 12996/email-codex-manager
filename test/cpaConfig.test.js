import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeAutomationLogMaxRuns, normalizeCpaConfig } from '../src/config.js';

test('normalizeCpaConfig builds auth-files URL and interval defaults', () => {
  const result = normalizeCpaConfig({
    CPA_URL: 'http://localhost:8317',
    CPA_MANAGEMENT_KEY: 'secret',
  });

  assert.equal(result.baseUrl, 'http://localhost:8317');
  assert.equal(result.authFilesUrl, 'http://localhost:8317/v0/management/auth-files');
  assert.equal(result.managementKey, 'secret');
  assert.equal(result.monitorEnabled, false);
  assert.equal(result.monitorIntervalMs, 10 * 60 * 1000);
});

test('normalizeCpaConfig accepts CPA_URL that already points at management base', () => {
  const result = normalizeCpaConfig({
    CPA_URL: 'http://localhost:8317/v0/management/',
    CPA_MANAGEMENT_KEY: 'secret',
    CPA_HEALTH_MONITOR_ENABLED: 'true',
    CPA_HEALTH_MONITOR_INTERVAL_MS: '60000',
  });

  assert.equal(result.authFilesUrl, 'http://localhost:8317/v0/management/auth-files');
  assert.equal(result.monitorEnabled, true);
  assert.equal(result.monitorIntervalMs, 60000);
});

test('normalizeAutomationLogMaxRuns defaults to 30 and accepts positive integers', () => {
  assert.equal(normalizeAutomationLogMaxRuns({}), 30);
  assert.equal(normalizeAutomationLogMaxRuns({ REPLACEMENT_AUTOMATION_LOG_MAX_RUNS: '10' }), 10);
  assert.equal(normalizeAutomationLogMaxRuns({ REPLACEMENT_AUTOMATION_LOG_MAX_RUNS: '0' }), 30);
  assert.equal(normalizeAutomationLogMaxRuns({ REPLACEMENT_AUTOMATION_LOG_MAX_RUNS: 'abc' }), 30);
});
