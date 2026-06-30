# CHG-050 IMAP 家宽代理启动

状态：implemented

创建日期：2026-06-27

关联 PRD：PRD-003

## 背景

Gmail IMAP 只需要读取邮件和验证码走固定家宽 IP，不需要把整个 `gmail_IMAP` 服务部署到 `vps-LA`，也不希望其他 Web/Roxy 自动化流量被一并代理。`vps-LA` 上已运行本地家宽代理 `127.0.0.1:7891`，可通过 SSH 本地端口转发复用。

## 变更

- 新增 `npm run start:home-proxy`。
- 新增 `scripts/start-with-home-imap-proxy.cjs`，启动 `ssh -N -L <localHost>:<localPort>:<remoteHost>:<remotePort> <sshHost>` 后再启动 `src/server.js`。
- 默认转发链路为本机 `127.0.0.1:11080` -> `vps-LA` -> `127.0.0.1:7891`。
- 启动器固定注入 `IMAP_PROXY=socks5://127.0.0.1:11080`，只影响 Gmail IMAP 连接。
- 新增 `IMAP_HOME_PROXY_*` 环境变量用于覆盖 SSH 主机、本地监听和远端家宽代理端点。

## 验收标准

- [x] `npm run start:home-proxy` 使用 SSH `-L` 本地端口转发，不使用 `-D` 动态 SOCKS。
- [x] 默认 SSH host 为 `vps-LA`，远端家宽代理为 `127.0.0.1:7891`。
- [x] 服务启动时注入 `IMAP_PROXY=socks5://127.0.0.1:11080`。
- [x] 服务退出或收到 `Ctrl+C` / `SIGTERM` 时关闭 SSH 转发进程。
- [x] 文档说明家宽代理启动方式和环境变量。

## 影响范围

- `scripts/start-with-home-imap-proxy.cjs`
- `package.json`
- `.env.example`
- `docs/project/deployment.md`
- `test/startWithHomeImapProxy.test.js`
