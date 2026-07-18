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
    async repair({ account, credential, reasons, mode } = {}) {
      const previousStatus = account.status;
      const operationLabel = mode === '2fa' ? '2FA补号' : '补号';
      replacementAccounts.markReplacementStarted(account.id);
      let runLogPath = '';
      const triggerDetails = formatCpaTriggerDetails({ credential, reasons });
      try {
        const replacementMethod = mode === '2fa'
          ? replacementServices?.replaceAccountWith2FA
          : replacementServices?.replaceAccount;
        if (typeof replacementMethod !== 'function') {
          const methodName = mode === '2fa' ? 'replaceAccountWith2FA' : 'replaceAccount';
          throw new Error(`replacementServices.${methodName} is not configured`);
        }

        // 补号自动化只生成本地 CPA JSON；上传与健康复查统一留在 worker 串行执行。
        const replacementResult = await replacementMethod.call(
          replacementServices,
          account,
          { cpaTriggerDetails: triggerDetails },
        );
        runLogPath = replacementResult?.run?.log_path || '';
        if (!replacementResult?.cpaTriggerLogged) {
          appendRepairLog(runLogPath, 'cpa-trigger', '记录 CPA 自动补号触发原因', triggerDetails);
        }
        const localFileName = `${String(account.email).trim().toLowerCase()}.json`;
        const uploadFileName = buildCpaUploadFileName(account.email);
        appendRepairLog(runLogPath, 'cpa-read-file', '读取本地 CPA JSON', `file=${localFileName}`);
        const payload = readFileImpl(join(cpaOutputDir, localFileName), 'utf8');
        appendRepairLog(runLogPath, 'cpa-upload', '上传 CPA auth file', `name=${uploadFileName}`);
        await cpaClient.uploadAuthFile({ name: uploadFileName, payload });
        appendRepairLog(runLogPath, 'cpa-verify', '复查 CPA 凭证健康', `email=${String(account.email).trim().toLowerCase()}`);
        await assertCredentialHealthy(cpaClient, account.email);
        const updated = replacementAccounts.markReplacementSuccess(account.id);
        appendRepairLog(runLogPath, 'cpa-success', 'CPA repair 完成', `account_id=${account.id}`);
        return { ok: true, account: updated, ...(replacementResult?.run ? { run: replacementResult.run } : {}) };
      } catch (error) {
        const updated = replacementAccounts.markReplacementFailure(
          account.id,
          error.message,
          previousStatus,
          operationLabel,
        );
        notifyCircuitBreaker(adminNotifications, updated);
        appendRepairLog(runLogPath, 'cpa-failure', 'CPA repair 失败', `account_id=${account.id} error=${error.message || error}`);
        return { ok: false, account: updated, error: error.message };
      }
    },
  };
}

function formatCpaTriggerDetails({ credential, reasons } = {}) {
  if (!credential && !Array.isArray(reasons)) return '';
  const fields = [
    `provider=${sanitizeDetail(credential?.provider)}`,
    `email=${sanitizeDetail(credential?.email)}`,
    `status=${sanitizeDetail(credential?.status)}`,
    `unavailable=${credential?.unavailable === true}`,
    `disabled=${credential?.disabled === true}`,
    `reasons=${sanitizeDetail(Array.isArray(reasons) ? reasons.join(',') : '')}`,
    `status_message=${sanitizeDetail(credential?.status_message, 500)}`,
  ];
  return fields.join(' ');
}

function sanitizeDetail(value, maxLength = 200) {
  const normalized = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function notifyCircuitBreaker(adminNotifications, account) {
  if (!adminNotifications?.createNotification) return;
  if (!account?.circuit_breaker_at || Number(account?.consecutive_replace_failures || 0) !== 5) return;
  const email = String(account.email || '').trim().toLowerCase();
  adminNotifications.createNotification({
    type: 'cpa_repair_circuit_breaker',
    severity: 'critical',
    title: '账号已触发补号熔断',
    message: `${email} 连续自动补号失败 5 次，账号已自动熔断，不再进入 CPA 自动补号队列。`,
    account_id: account.id,
    email,
  });
}

function buildCpaUploadFileName(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  return `codex-${normalizedEmail}-plus.json`;
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
  if (matching.some((file) => classifyCpaAuthFile(file).healthy)) {
    return;
  }
  const unhealthy = matching[0];
  throw new Error(`uploaded CPA credential is still unhealthy: ${unhealthy.status || ''} ${unhealthy.status_message || ''}`.trim());
}
