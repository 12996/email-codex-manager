import { precheckAccessToken } from './lib/oauth-core.js';

const atInput = document.querySelector('#access-token');
const precheck = document.querySelector('#precheck');
const startLoginButton = document.querySelector('#start-login');
const downloadButton = document.querySelector('#download-rt');
const clearButton = document.querySelector('#clear-state');
const status = document.querySelector('#status');
const email = document.querySelector('#email');
const plan = document.querySelector('#plan');

function renderPrecheck(result) {
  const text = {
    empty: '未输入 AT',
    invalid: 'AT 格式不完整',
    opaque: 'AT 无法作为 JWT 解析，未进行在线验证',
    'jwt-valid': result.expiresAt ? `JWT 声明过期时间：${new Date(result.expiresAt).toLocaleString()}` : 'JWT 未声明过期时间',
    'jwt-expired': `JWT 声明已过期：${new Date(result.expiresAt).toLocaleString()}`,
  };
  precheck.textContent = text[result.kind] || 'AT 无法解析';
}

function renderState(state) {
  status.textContent = state?.message || '等待登录';
  email.textContent = state?.email || '未提供';
  plan.textContent = state?.plan || '未提供';
  downloadButton.disabled = state?.canDownloadRt !== true;
}

async function refreshState() {
  renderState(await sendAuthMessage('auth:get-state'));
}

async function sendAuthMessage(type) {
  try {
    return await chrome.runtime.sendMessage({ type });
  } catch {
    return {
      phase: 'failed',
      message: '扩展操作失败，请重试',
      email: null,
      plan: null,
      canDownloadRt: false,
    };
  }
}

atInput.addEventListener('input', () => {
  renderPrecheck(precheckAccessToken(atInput.value, Date.now()));
});

startLoginButton.addEventListener('click', async () => {
  atInput.value = '';
  renderPrecheck(precheckAccessToken('', Date.now()));
  renderState(await sendAuthMessage('auth:start'));
});

downloadButton.addEventListener('click', async () => {
  renderState(await sendAuthMessage('auth:download-rt'));
});

clearButton.addEventListener('click', async () => {
  atInput.value = '';
  renderPrecheck(precheckAccessToken('', Date.now()));
  renderState(await sendAuthMessage('auth:clear'));
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'auth:state-changed') {
    renderState(message.state);
  }
});

void refreshState();
