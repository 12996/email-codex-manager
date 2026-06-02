const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { chromium } = require('playwright-core');

dotenv.config();

const EMAIL_SUBTITLE_SELECTOR = 'body > div > div > div._titleBlock_l85du_108 > div > span > div > div._subtitle_7asl0_13';
const DEFAULT_OPENAI_LOGIN_TIMEOUT_MS = 60000;

const outputFile = path.resolve(
  process.env.ROXY_CODEGEN_OUTPUT || 'data/roxy-codegen/recorded-flow.spec.js'
);
const targetUrl = String(process.env.ROXY_CODEGEN_URL || '').trim();
fs.mkdirSync(path.dirname(outputFile), { recursive: true });

function createAutomationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

async function collectPageDebug(page) {
  const url = typeof page.url === 'function' ? page.url() : '';
  const title = typeof page.title === 'function' ? await page.title().catch(() => '') : '';
  const bodyText = typeof page.textContent === 'function'
    ? String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '').slice(0, 500)
    : '';
  return { url, title, bodyText };
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function session_check(page, email, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_OPENAI_LOGIN_TIMEOUT_MS;
  const selector = options.emailSubtitleSelector || EMAIL_SUBTITLE_SELECTOR;
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
  }

  const locator = page.locator(selector);
  const displayedText = await withTimeout(
    (async () => {
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return String(await locator.innerText()).trim();
    })(),
    timeoutMs,
    () => createAutomationError('OPENAI_LOGIN_TIMEOUT', `OpenAI 登录页 ${timeoutMs}ms 内未显示邮箱确认区域`, {
      email: normalizedEmail,
    })
  ).catch(async (error) => {
    if (error.code === 'OPENAI_LOGIN_TIMEOUT') {
      Object.assign(error, await collectPageDebug(page));
    }
    throw error;
  });

  if (!displayedText.includes(normalizedEmail)) {
    throw createAutomationError('OPENAI_LOGIN_EMAIL_MISMATCH', 'OpenAI 登录页显示邮箱与传入邮箱不一致', {
      expectedEmail: normalizedEmail,
      actualText: displayedText,
      ...(await collectPageDebug(page)),
    });
  }

  return {
    status: 'session-email-confirmed',
    email: normalizedEmail,
    displayedText,
  };
}

async function openAi_login(page, email, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_OPENAI_LOGIN_TIMEOUT_MS;
  const normalizedEmail = String(email || '').trim();
  if (!normalizedEmail) {
    throw createAutomationError('OPENAI_LOGIN_EMAIL_REQUIRED', 'OpenAI 登录邮箱不能为空');
  }

  const emailInput = page.getByRole('textbox', { name: 'Email address' });
  await emailInput.waitFor({ state: 'visible', timeout: timeoutMs });
  await emailInput.click();
  await emailInput.fill(normalizedEmail);

  await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: timeoutMs });
  return session_check(page, normalizedEmail, options);
}

async function main() {
  const cdpEndpoint = String(process.env.ROXY_CDP_ENDPOINT || '').trim();
  if (!cdpEndpoint) {
    throw new Error('ROXY_CDP_ENDPOINT is empty. Put the Roxy CDP ws URL in .env first.');
  }

  console.log(`[roxy-codegen] connecting CDP: ${cdpEndpoint}`);
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  let context = browser.contexts()[0];
  if (!context) {
    context = await browser.newContext();
  }
  let page = context.pages()[0];
  if (!page) {
    page = await context.newPage();
  }

  await context._enableRecorder({
    language: 'javascript',
    mode: 'recording',
    outputFile,
    handleSIGINT: false,
    launchOptions: {},
    contextOptions: {},
  });

  if (targetUrl) {
    console.log(`[roxy-codegen] navigating: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  console.log(`[roxy-codegen] recorder is running.`);
  console.log(`[roxy-codegen] generated code will be saved to: ${outputFile}`);
  console.log('[roxy-codegen] finish your manual flow, then stop this Node process with Ctrl+C.');

  await new Promise((resolve) => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
  });

  console.log('[roxy-codegen] stopping recorder...');
  await context._disableRecorder().catch(() => {});
  await browser.close({ reason: 'roxy codegen disconnect' }).catch(() => {});
  console.log(`[roxy-codegen] saved: ${outputFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[roxy-codegen] failed: ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  EMAIL_SUBTITLE_SELECTOR,
  openAi_login,
  session_check,
};
