#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import readline from 'node:readline/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(__dirname, '../src/auto/product_files/registration');

function safeFileName(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) throw new Error('邮箱不能为空');
  return `${normalized.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.txt`;
}

function saveAccessTokenFile({ email, accessToken, outputDir = OUTPUT_DIR } = {}) {
  const token = String(accessToken || '').trim();
  if (!String(email || '').trim()) throw new Error('邮箱不能为空');
  if (!token) throw new Error('AT 不能为空');
  if (/[\r\n]/.test(token)) throw new Error('AT 不能包含换行符');

  const targetDir = path.resolve(outputDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, safeFileName(email));
  fs.writeFileSync(targetFile, token, 'utf8');
  return targetFile;
}

function shouldRunCli(env = process.env) {
  return !env.NODE_TEST_CONTEXT;
}

async function main() {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`保存目录: ${OUTPUT_DIR}`);
    const email = await prompt.question('请输入邮箱: ');
    const accessToken = await prompt.question('请输入 AT: ');
    const targetFile = saveAccessTokenFile({ email, accessToken });
    console.log(`AT 保存成功: ${targetFile}`);
  } finally {
    prompt.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && shouldRunCli()) {
  main().catch((error) => {
    console.error(`AT 保存失败: ${error.message}`);
    process.exitCode = 1;
  });
}

export { OUTPUT_DIR, saveAccessTokenFile, shouldRunCli };
