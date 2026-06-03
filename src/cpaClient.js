import { codedError } from './replacementAccounts.js';

export function createCpaClient({ authFilesUrl, managementKey, fetchImpl = fetch } = {}) {
  return {
    async listAuthFiles() {
      if (!authFilesUrl || !managementKey) {
        throw codedError('CPA_NOT_CONFIGURED', 'CPA_URL and CPA_MANAGEMENT_KEY are required');
      }
      const response = await fetchImpl(authFilesUrl, {
        headers: {
          Authorization: `Bearer ${managementKey}`,
        },
      });
      if (!response.ok) {
        const body = await safeText(response);
        throw codedError('CPA_AUTH_FILES_FAILED', `CPA auth-files returned ${response.status}: ${body}`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.files) ? payload.files : [];
    },

    async uploadAuthFile({ name, payload }) {
      if (!authFilesUrl || !managementKey) {
        throw codedError('CPA_NOT_CONFIGURED', 'CPA_URL and CPA_MANAGEMENT_KEY are required');
      }
      const url = `${authFilesUrl}?name=${encodeURIComponent(name)}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementKey}`,
          'Content-Type': 'application/json',
        },
        body: String(payload || ''),
      });
      if (!response.ok) {
        const body = await safeText(response);
        throw codedError('CPA_AUTH_UPLOAD_FAILED', `CPA auth upload returned ${response.status}: ${body}`);
      }
      return response.json();
    },
  };
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
