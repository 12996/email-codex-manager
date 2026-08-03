function formatTimestamp(nowMs) {
  const date = new Date(nowMs);
  const part = value => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    part(date.getUTCMonth() + 1),
    part(date.getUTCDate()),
  ].join('') + '-' + [
    part(date.getUTCHours()),
    part(date.getUTCMinutes()),
    part(date.getUTCSeconds()),
  ].join('');
}

function createDownloadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function downloadRefreshToken({
  refreshToken,
  downloadsApi,
  blobFactory,
  urlApi,
  nowMs = Date.now(),
} = {}) {
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    throw createDownloadError('refresh_token_missing');
  }

  const resolvedDownloadsApi = downloadsApi || globalThis.chrome?.downloads;
  const resolvedBlobFactory = blobFactory || (parts => new Blob(parts, { type: 'text/plain;charset=utf-8' }));
  const resolvedUrlApi = urlApi || URL;
  if (!resolvedDownloadsApi) {
    throw createDownloadError('refresh_token_download_failed');
  }

  const blob = resolvedBlobFactory([refreshToken], { type: 'text/plain;charset=utf-8' });
  const objectUrl = resolvedUrlApi.createObjectURL(blob);
  const filename = `codex-refresh-token-${formatTimestamp(nowMs)}.txt`;

  try {
    const downloadId = await resolvedDownloadsApi.download({
      url: objectUrl,
      filename,
      saveAs: true,
      conflictAction: 'uniquify',
    });
    return { downloadId, filename, objectUrl };
  } catch {
    resolvedUrlApi.revokeObjectURL(objectUrl);
    throw createDownloadError('refresh_token_download_failed');
  }
}
