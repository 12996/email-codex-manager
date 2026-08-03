import { inspectJwtInput } from './lib/jwt-auth-core.js';

const atInput = document.querySelector('#access-token');
const precheck = document.querySelector('#precheck');
const startLoginButton = document.querySelector('#start-login');
const clearButton = document.querySelector('#clear-state');
const status = document.querySelector('#status');
const email = document.querySelector('#email');
const plan = document.querySelector('#plan');

function renderPrecheck(result) {
  const text = {
    empty: '未输入 JWT AT',
    'valid-format': 'JWT 格式可提交；登录时会进行本地验签',
    'invalid-format': '请输入有效的 JWT AT',
  };
  precheck.textContent = text[result.kind] || '请输入有效的 JWT AT';
}

function renderState(state) {
  status.textContent = state?.message || '等待登录';
  email.textContent = state?.email || '未提供';
  plan.textContent = state?.plan || '未提供';
}

async function sendAuthMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
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
  const value = atInput.value;
  renderPrecheck(value ? inspectJwtInput(value) : { kind: 'empty' });
});

startLoginButton.addEventListener('click', async () => {
  const jwt = atInput.value;
  atInput.value = '';
  renderPrecheck({ kind: 'empty' });
  renderState(await sendAuthMessage({ type: 'auth:login-jwt', jwt }));
});

clearButton.addEventListener('click', async () => {
  atInput.value = '';
  renderPrecheck({ kind: 'empty' });
  renderState(await sendAuthMessage({ type: 'auth:clear' }));
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'auth:state-changed') {
    renderState(message.state);
  }
});

void sendAuthMessage({ type: 'auth:get-state' }).then(renderState);
