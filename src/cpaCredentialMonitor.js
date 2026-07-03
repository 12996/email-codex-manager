import { classifyCpaAuthFile, buildCredentialKey } from './cpaCredentialHealth.js';

export function createCpaCredentialMonitor({
  cpaClient,
  replacementAccounts,
  repairQueue,
} = {}) {
  return {
    async runOnce() {
      const files = await cpaClient.listAuthFiles();
      const healthyEmails = new Set(files
        .filter((file) => classifyCpaAuthFile(file).healthy)
        .map((file) => String(file?.email || '').trim().toLowerCase())
        .filter(Boolean));
      const result = {
        checked: files.length,
        unhealthy: [],
        enqueued: [],
        skipped: [],
      };

      for (const file of files) {
        const health = classifyCpaAuthFile(file);
        if (health.healthy) continue;

        const email = String(file?.email || '').trim().toLowerCase();
        if (healthyEmails.has(email)) continue;

        const item = {
          key: buildCredentialKey(file),
          provider: file?.provider || '',
          email,
          category: health.category,
          reasons: health.reasons,
        };
        result.unhealthy.push(item);

        if (health.category !== 'auth_expired') {
          result.skipped.push({ ...item, reason: `category_${health.category}` });
          continue;
        }

        const account = replacementAccounts.getAccountByEmail(email);
        if (!account) {
          result.skipped.push({ ...item, reason: 'replacement_account_not_found' });
          continue;
        }
        if (account.status === 'replacing') {
          result.skipped.push({ ...item, account_id: account.id, reason: 'already_replacing' });
          continue;
        }
        if (account.status === 'banned') {
          result.skipped.push({ ...item, account_id: account.id, reason: 'account_banned' });
          continue;
        }
        if (account.circuit_breaker_at) {
          result.skipped.push({ ...item, account_id: account.id, reason: 'account_circuit_breaker' });
          continue;
        }

        const queued = repairQueue.enqueue({ account, credential: file, reasons: health.reasons });
        if (queued) {
          result.enqueued.push({ ...item, account_id: account.id });
        } else {
          result.skipped.push({ ...item, account_id: account.id, reason: 'already_queued' });
        }
      }

      if (result.enqueued.length > 0) {
        await repairQueue.drain?.();
      }

      return result;
    },
  };
}
