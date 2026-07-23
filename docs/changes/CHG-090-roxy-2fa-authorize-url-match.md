# CHG-090 Roxy 2FA 使用 oauth_login.js 同形态 authorize URL

状态：implemented
创建日期：2026-07-20
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-017-roxy-cpa-auth-egress-reset.md`
影响范围：`src/auto/roxy_2fa_auth_login.js`、`test/roxy2FAAuthLogin.test.js`、`docs/`

## 背景

账号 109 的既有 2FA 补号必须使用 `src/auto/oauth_login.js` 生成的完整
`https://auth.openai.com/oauth/authorize?...` 链接。旧 2FA runner 在该链接上额外追加
`prompt=login`，与已验证可用的 OAuth 入口不一致。

## 变更内容

- 2FA runner 默认复用 `roxy_oauth_login.js` 的基础 authorize URL，不再追加 `prompt=login`。
- 保留 `buildPromptLoginAuthUrl` 旧导出名作为兼容别名，但其结果与基础 authorize URL 相同。
- 选择账号按钮点击后等待离开 `choose-account` 阶段，避免异步跳转期间重复点击并耗尽状态机轮次。
- 新增回归测试覆盖延迟 choose-account 导航和默认 URL 不含 `prompt=login`。

## 验证

- `npm test -- test/roxy2FAAuthLogin.test.js`：14/14 通过。
- `node --check src/auto/roxy_2fa_auth_login.js`：通过。
- 使用账号 109 和已打开的 Roxy `3/test` CDP 复用运行：
  - 目标路径为 `/oauth/authorize`，`prompt=login=false`；
  - `workspace/select` 返回 HTTP 200；
  - `oauth/token` 返回 HTTP 200；
  - 状态机返回 `oauth-completed`；
  - CPA 文件存在且 `access_token`、`refresh_token`、`id_token` 均非空。

本次 CDP 复用建立在前一轮已完成登录的会话上，没有再次触发 add-phone 或 SMS；完整
password、TOTP、phone-add、SMS、phone-otp 链路仍以同日先前的干净流程证据为准。

随后通过 CPA repair worker 完成账号 109 的 CPA 上传、`active` 健康复查和 `cpa_mounted` 状态回写。

## 回滚

如需回滚，仅恢复 2FA runner 的 URL builder 和对应回归测试；不修改注册状态机、数据库结构或独立 CPA 协议。
