# CHG-049 IMAP 绑定 SSH 代理启动

状态：implemented

创建日期：2026-06-26

关联 PRD：PRD-003

## 背景

Gmail IMAP 读取验证码和邮件时原本直接从运行服务的机器出网，出口 IP 会随本机网络变化。用户希望 IMAP 使用固定 VPS 出口，但不希望代理开机自启或长期独立常驻，而是和 Gmail IMAP 服务同启同停。

## 变更

- 新增 `IMAP_PROXY` 配置，Gmail IMAP 连接会传给 ImapFlow 的 `proxy` 选项。
- 新增 `npm run start:proxy`，通过 `scripts/start-with-imap-proxy.cjs` 启动 SSH 动态 SOCKS5 隧道后再启动 `src/server.js`。
- 绑定启动默认本地监听 `127.0.0.1:11080`，由 `IMAP_PROXY_SSH_HOST` 指定 SSH Host，例如 `vps-LA`。
- 服务退出或收到 `Ctrl+C` / `SIGTERM` 时，包装器会关闭 SSH 隧道，避免代理脱离 Gmail IMAP 服务单独常驻。

## 验收标准

- [x] `IMAP_PROXY` 为空时保持原直连行为。
- [x] `IMAP_PROXY` 非空时，`src/imapService.js` 创建的 ImapFlow client 带有 `proxy` 选项。
- [x] `npm run start:proxy` 的启动器包含 SSH keepalive 与 `ExitOnForwardFailure=yes`，隧道不可用时不继续启动服务。
- [x] 文档说明绑定启动方式和环境变量。

## 影响范围

- `src/config.js`
- `src/imapService.js`
- `scripts/start-with-imap-proxy.cjs`
- `package.json`
- `.env.example`
- `docs/project/deployment.md`
- `test/`
