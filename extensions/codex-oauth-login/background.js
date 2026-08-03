import { createAuthController } from './lib/auth-controller.js';

const controller = createAuthController({ chromeApi: chrome });

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
  void controller.handleAlarm(alarm.name);
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
      default:
        return undefined;
    }
  };

  void action().then(sendResponse, () => sendResponse(undefined));
  return true;
});
