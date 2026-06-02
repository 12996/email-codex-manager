const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
/**
 * 核心工具：生成 PKCE 校验对
 */
function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

const { verifier, challenge } = generatePKCE();
const state = crypto.randomBytes(16).toString('hex');

const authUrl = `https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&code_challenge=${challenge}&code_challenge_method=S256&codex_cli_simplified_flow=true&id_token_add_organizations=true&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&response_type=code&scope=openid+profile+email+offline_access&state=${state}`;
console.log(authUrl);
