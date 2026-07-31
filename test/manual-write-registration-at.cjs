#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

// Paste one or more AT values here. Each non-empty item becomes one line in at.txt.
const manualConfig = Object.freeze({
  outputDir: path.resolve(__dirname, '../src/auto/product_files/registration'),
  tokens: [
    '',
  ],
});

function normalizeTokens(tokens) {
  const unique = new Set();
  for (const raw of tokens || []) {
    const token = String(raw || '').trim();
    if (!token) continue;
    if (/[\r\n]/.test(token)) throw new Error('AT 不能包含换行符');
    unique.add(token);
  }
  return [...unique];
}

function writeAccessTokens({ outputDir, tokens, fileName = 'at.txt' } = {}) {
  const additions = normalizeTokens(tokens);
  if (additions.length === 0) throw new Error('请在 manualConfig.tokens 中至少填写一个 AT');

  const targetDir = path.resolve(String(outputDir || ''));
  const targetFile = path.join(targetDir, fileName);
  fs.mkdirSync(targetDir, { recursive: true });

  const existing = fs.existsSync(targetFile)
    ? normalizeTokens(fs.readFileSync(targetFile, 'utf8').split(/\r?\n/))
    : [];
  const allTokens = [...existing];
  for (const token of additions) {
    if (!allTokens.includes(token)) allTokens.push(token);
  }
  fs.writeFileSync(targetFile, `${allTokens.join('\n')}\n`, 'utf8');
  return { targetFile, added: allTokens.length - existing.length, total: allTokens.length };
}

function shouldRunCli(env = process.env) {
  return !env.NODE_TEST_CONTEXT;
}

if (require.main === module && shouldRunCli()) {
  try {
    const result = writeAccessTokens(manualConfig);
    console.log(`AT 已写入: ${result.targetFile}`);
    console.log(`本次新增: ${result.added}，文件总数: ${result.total}`);
  } catch (error) {
    console.error(`AT 写入失败: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { manualConfig, normalizeTokens, shouldRunCli, writeAccessTokens };
