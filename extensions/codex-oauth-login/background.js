import {
  createJwtAuthController,
} from './lib/jwt-auth-controller.js';

const controller = createJwtAuthController({ chromeApi: chrome });

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('app.html'),
    active: true,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = async () => {
    switch (message?.type) {
      case 'auth:get-state':
        return controller.getPublicState();
      case 'auth:login-jwt':
        return controller.startJwtLogin(message.jwt);
      case 'auth:clear':
        return controller.clear();
      default:
        return undefined;
    }
  };

  void action().then(sendResponse, () => sendResponse(undefined));
  return true;
});
