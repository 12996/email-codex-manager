import { downloadRefreshToken } from './lib/rt-download.js';

const port = chrome.runtime.connect({ name: 'rt-download' });
let activeDownload = null;

port.onMessage.addListener(async message => {
  if (message?.type !== 'rt-download:start' || activeDownload) {
    return;
  }

  try {
    activeDownload = await downloadRefreshToken({ refreshToken: message.refreshToken });
  } catch {
    port.postMessage({ type: 'rt-download:finished', success: false });
  }
});

chrome.downloads.onChanged.addListener(change => {
  if (!activeDownload || change.id !== activeDownload.downloadId || !change.state) {
    return;
  }
  const state = change.state.current;
  if (state !== 'complete' && state !== 'interrupted') {
    return;
  }

  URL.revokeObjectURL(activeDownload.objectUrl);
  activeDownload = null;
  port.postMessage({ type: 'rt-download:finished', success: state === 'complete' });
});

port.onDisconnect.addListener(() => {
  if (activeDownload) {
    URL.revokeObjectURL(activeDownload.objectUrl);
    activeDownload = null;
  }
});
