import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyCpaAuthFile } from './cpaCredentialHealth.js';

export function createCpaRepairWorker({
  cpaClient,
  replacementAccounts,
  replacementServices,
  adminNotifications,
  cpaOutputDir,
  readFileImpl = readFileSync,
} = {}) {
  return {
    async repair({ account }) {
      replacementAccounts.markReplacementStarted(account.id);
      let runLogPath = '';
      try {
        const replacementResult = await replacementServices.replaceAccount(account);
        runLogPath = replacementResult?.run?.log_path || '';
        const fileName = `${String(account.email).trim().toLowerCase()}.json`;
        appendRepairLog(runLogPath, 'cpa-read-file', '读取本地 CPA JSON', `file=${fileName}`);
        const payload = readFileImpl(join(cpaOutputDir, fileName), 'utf8');
        appendRepairLog(runLogPath, 'cpa-upload', '上传 CPA auth file', `name=${fileName}`);
        await cpaClient.uploadAuthFile({ name: fileName, payload });
        appendRepairLog(runLogPath, 'cpa-verify', '复查 CPA 凭证健康', `email=${String(account.email).trim().toLowerCase()}`);
        await assertCredentialHealthy(cpaClient, account.email);
        const updated = replacementAccounts.markReplacementSuccess(account.id);
        appendRepairLog(runLogPath, 'cpa-success', 'CPA repair 完成', `account_id=${account.id}`);
        return { ok: true, account: updated };
      } catch (error) {
        const updated = replacementAccounts.markReplacementFailure(account.id, error.message);
        notifyCircuitBreaker(adminNotifications, updated);
        appendRepairLog(runLogPath, 'cpa-failure', 'CPA repair 失败', `account_id=${account.id} error=${error.message || error}`);
        return { ok: false, account: updated, error: error.message };
      }
    },
  };
}

function notifyCircuitBreaker(adminNotifications, account) {
  if (!adminNotifications?.createNotification) return;
  if (account?.status !== 'banned' || Number(account?.consecutive_replace_failures || 0) !== 5) return;
  const email = String(account.email || '').trim().toLowerCase();
  adminNotifications.createNotification({
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: `${email} 连续自动补号失败 5 次，已自动标记为 banned，不再进入 CPA 自动补号队列。`,
    account_id: account.id,
    email,
  });
}

function appendRepairLog(logPath, step, action, details = '') {
  if (!logPath) return;
  const suffix = details ? ` ${details}` : '';
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, `[${new Date().toISOString()}] step=${step} action=${action}${suffix}\n`, 'utf8');
  } catch {
    // Logging must not make an otherwise successful repair fail.
  }
}

async function assertCredentialHealthy(cpaClient, email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const files = await cpaClient.listAuthFiles();
  const matching = files.filter((file) => String(file?.email || '').trim().toLowerCase() === normalizedEmail);
  if (matching.length === 0) {
    throw new Error(`uploaded CPA credential not found for ${normalizedEmail}`);
  }
  const unhealthy = matching.find((file) => !classifyCpaAuthFile(file).healthy);
  if (unhealthy) {
    throw new Error(`uploaded CPA credential is still unhealthy: ${unhealthy.status || ''} ${unhealthy.status_message || ''}`.trim());
  }
}
