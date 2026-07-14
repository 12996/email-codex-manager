# issues/README.md

本目录记录缺陷、风险、排查过程和修复结果。

状态：`active` 处理中，`resolved` 已解决，`archived` 已归档。

| 编号 | 标题 | 状态 | 入口 |
|---|---|---|---|
| issue-001 | 文档体系初始化 | resolved | `issue-001.md` |
| issue-002 | Roxy OAuth 添加手机号后跳转竞态 | active | `issue-002-roxy-add-phone-transition-race.md` |
| issue-003 | Roxy OAuth callback 在 Chrome error 页下未被识别 | active | `issue-003-roxy-callback-chrome-error-url.md` |
| issue-004 | Roxy OAuth 手机验证码后跳转竞态 | active | `issue-004-roxy-phone-code-transition-race.md` |
| issue-005 | Roxy token exchange fallback 出口 IP 不一致 | active | `issue-005-roxy-token-fallback-exit-ip.md` |
| issue-006 | 邮箱邮件详情弹窗 DOM 缺失 | resolved | `issue-006-email-mail-detail-dialog-missing.md` |
| issue-007 | Windows 保留 3000 端口导致服务启动失败 | resolved | `issue-007-windows-port-3000-eacces.md` |
| issue-008 | Roxy OAuth 密码页 / 邮箱验证码页误判 | resolved | `issue-008-roxy-openai-password-email-code-misclassification.md` |
| issue-009 | Roxy 2FA 补号密码页被 Codex 页脚误判 | resolved | `issue-009-roxy-codex-footer-password-misclassification.md` |
| issue-010 | 短信 API 直连访问受限导致 2FA 补号拿不到手机验证码 | resolved | `issue-010-sms-api-direct-request-region-restricted.md` |
| issue-011 | Roxy 2FA 邮箱提交后阶段识别竞态 | resolved | `issue-011-roxy-2fa-post-email-stage-race.md` |
| issue-012 | Roxy 2FA session 登录状态判定风险 | resolved | `issue-012-roxy-2fa-session-state-guard.md` |
