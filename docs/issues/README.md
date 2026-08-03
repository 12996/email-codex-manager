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
| issue-013 | Roxy 注册密码提交阶段元素脱离 DOM | resolved | `issue-013-roxy-registration-password-click-detached.md` |
| issue-014 | Roxy /about-you 年龄输入框被误识别为 OTP | resolved | `issue-014-roxy-about-you-age-misclassified-as-otp.md` |
| issue-015 | 补号协议注册外部邮箱验证码 API 不可达 | active | `issue-015-replacement-protocol-email-api-unreachable.md` |
| issue-016 | 补号协议混用 Roxy 与 OpenAI workspace ID | fixed | `issue-016-replacement-protocol-workspace-id-collision.md` |
| issue-017 | Roxy CPA Auth 出口被重置或拒绝 | resolved | `issue-017-roxy-cpa-auth-egress-reset.md` |
| issue-018 | 协议注册 2FA 重认证回调返回 401 | active | `issue-018-protocol-registration-mfa-reauth-401.md` |
| issue-019 | 协议 CPA phone-code 阶段跳过 add-phone/send | resolved | `issue-019-protocol-cpa-phone-add-request-skipped.md` |
| issue-020 | 协议注册 CDP 导航重试超时预算不足 | active | `issue-020-protocol-registration-cdp-navigate-timeout-budget.md` |
| issue-021 | 无2FA协议账号提链结算金额读取失败 | active | `issue-021-protocol-no2fa-trial-link-check.md` |
| issue-022 | Roxy CDP 未就绪导致 Playwright 附着超时 | resolved | `issue-022-roxy-cdp-attach-readiness.md` |
| issue-023 | Roxy 录制文件混入旧会话且 DOM recorder 泄露 endpoint | resolved | `issue-023-roxy-recorder-run-boundary.md` |
