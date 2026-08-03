import {
  DOWNLOAD_ALARM,
  createAuthController,
} from './lib/auth-controller.js';

const controller = createAuthController({ chromeApi: chrome });
const DOWNLOAD_PORT_NAME = 'rt-download';
const DOWNLOAD_DOCUMENT_PATH = 'download.html';
const DOWNLOAD_PORT_WAIT_MS = 5_000;

let activeDownloadPort = null;
let activeDownload = false;
let pendingDownloadPort = null;

const CALLBACK_FILTER = {
  url: [{
    schemes: ['http'],
    hostEquals: 'localhost',
    ports: [1455],
    pathPrefix: '/auth/callback',
  }],
};

chrome.action.onClicked.addListener(tab => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('app.html'),
    active: true,
    windowId: tab.windowId,
  });
});

chrome.webNavigation.onBeforeNavigate.addListener(details => {
  void controller.handleBeforeNavigate(details);
}, CALLBACK_FILTER);

chrome.tabs.onRemoved.addListener(tabId => {
  void controller.handleTabRemoved(tabId);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === DOWNLOAD_ALARM) {
    activeDownload = false;
    activeDownloadPort?.disconnect();
    activeDownloadPort = null;
    void closeDownloadDocument();
  }
  void controller.handleAlarm(alarm.name);
});

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== DOWNLOAD_PORT_NAME) {
    return;
  }

  activeDownloadPort = port;
  pendingDownloadPort?.resolve(port);
  pendingDownloadPort = null;

  port.onMessage.addListener(message => {
    if (message?.type !== 'rt-download:finished' || !activeDownload) {
      return;
    }
    activeDownload = false;
    activeDownloadPort = null;
    void controller.finishRefreshTokenDownload({ success: message.success === true });
    void closeDownloadDocument();
  });

  port.onDisconnect.addListener(() => {
    if (activeDownloadPort !== port) {
      return;
    }
    activeDownloadPort = null;
    if (pendingDownloadPort) {
      pendingDownloadPort.reject(new Error('download_port_disconnected'));
      pendingDownloadPort = null;
    }
    if (activeDownload) {
      activeDownload = false;
      void controller.finishRefreshTokenDownload({ success: false });
      void closeDownloadDocument();
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = async () => {
    switch (message?.type) {
      case 'auth:get-state':
        return controller.getPublicState();
      case 'auth:start':
        return controller.startAuthorization();
      case 'auth:clear':
        return controller.clear();
      case 'auth:download-rt':
        return startRefreshTokenDownload();
      default:
        return undefined;
    }
  };

  void action().then(sendResponse, () => sendResponse(undefined));
  return true;
});

async function startRefreshTokenDownload() {
  try {
    const port = await ensureDownloadPort();
    const refreshToken = await controller.takeRefreshTokenForDownload();
    if (!refreshToken) {
      return controller.getPublicState();
    }
    activeDownload = true;
    port.postMessage({ type: 'rt-download:start', refreshToken });
    return controller.getPublicState();
  } catch {
    activeDownload = false;
    await controller.finishRefreshTokenDownload({ success: false });
    await closeDownloadDocument();
    return controller.getPublicState();
  }
}

async function ensureDownloadPort() {
  if (activeDownloadPort) {
    return activeDownloadPort;
  }
  let waiter = pendingDownloadPort;
  if (!waiter) {
    waiter = createDownloadPortWaiter();
    pendingDownloadPort = waiter;
    try {
      const documentUrl = chrome.runtime.getURL(DOWNLOAD_DOCUMENT_PATH);
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [documentUrl],
      });
      if (!contexts.length) {
        await chrome.offscreen.createDocument({
          url: DOWNLOAD_DOCUMENT_PATH,
          reasons: ['BLOBS'],
          justification: 'Create a user-requested refresh token download Blob.',
        });
      }
    } catch {
      if (pendingDownloadPort === waiter) {
        pendingDownloadPort = null;
        waiter.reject(new Error('download_document_unavailable'));
      }
    }
  }
  return waiter.promise;
}

function createDownloadPortWaiter() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  const timeoutId = setTimeout(() => {
    if (pendingDownloadPort?.promise === promise) {
      pendingDownloadPort = null;
      reject(new Error('download_port_timeout'));
    }
  }, DOWNLOAD_PORT_WAIT_MS);
  return {
    promise,
    resolve(port) {
      clearTimeout(timeoutId);
      resolve(port);
    },
    reject(error) {
      clearTimeout(timeoutId);
      reject(error);
    },
  };
}

async function closeDownloadDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // No offscreen document remains to close.
  }
}
