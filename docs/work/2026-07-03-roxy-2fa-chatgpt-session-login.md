# 2026-07-03 Roxy 2FA ChatGPT session 登录脚本

## 目标

根据手动录制的真实流程，新增一个独立的 2FA 登录脚本：通过 ChatGPT 登录入口完成 OpenAI password + MFA 登录，成功后获取 `/api/auth/session` 并保存凭证文件。

## 过程

- 使用 Roxy profile `gpt`、SN `617-8` 录制真实流程。
- 录制确认成功路径：
  - `chatgpt.com/`
  - OpenAI password 页
  - `POST /api/accounts/password/verify`
  - MFA challenge 页
  - `POST /api/accounts/mfa/verify`
  - `chatgpt.com/api/auth/callback/openai`
  - `chatgpt.com/`
- 新增 `src/auto/roxy_2fa_login.js`，没有复制 `roxy_register_openai.js` 的注册流程，只复用已有 Roxy 开窗/关闭和 2FA 页面判断能力。
- 新增 `test/roxy2FALogin.test.js`，先红灯确认模块缺失，再实现最小逻辑。

## 验证

- `node --test test\roxy2FALogin.test.js`：3/3 pass。
- `node --test test\roxy2FAAuthLogin.test.js`：11/11 pass。
- `node --test test\roxyRegisterOpenai.test.js`：11/11 pass。
- `node --test test\roxyOauthLogin.test.js`：75/75 pass。

## 产物

- `src/auto/roxy_2fa_login.js`
- `test/roxy2FALogin.test.js`
- `docs/changes/CHG-062-roxy-2fa-chatgpt-session-login.md`

## 待办

- 如需实机运行，准备 `ROXY_2FA_EMAIL` 或 `ROXY_OAUTH_EMAIL`、`ROXY_OAUTH_PASSWORD`、`ROXY_OAUTH_2FA_CODE` 或 `ROXY_OAUTH_TOTP_SECRET`。
- 默认凭证输出目录：`src/auto/product_files/2fa_login/`。
- 当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
