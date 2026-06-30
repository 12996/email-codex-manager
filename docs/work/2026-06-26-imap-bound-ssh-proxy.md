# 2026-06-26 IMAP 绑定 SSH 代理启动

## 目标

让 Gmail IMAP 读取邮件/验证码时可以走固定 VPS 出口，同时代理不做开机自启，而是和 Gmail IMAP 服务同启同停。

## 实现

- 新增 `IMAP_PROXY` 配置，`src/imapService.js` 创建 ImapFlow client 时传入 `proxy`。
- 新增 `scripts/start-with-imap-proxy.cjs`，启动 SSH 动态 SOCKS5 隧道后再启动 `src/server.js`。
- 新增 `npm run start:proxy`：
  - 读取 `IMAP_PROXY_SSH_HOST`，例如 `vps-LA`。
  - 默认监听 `127.0.0.1:11080`。
  - 注入 `IMAP_PROXY=socks5://127.0.0.1:11080`。
  - 服务退出或 `Ctrl+C` 时关闭 SSH 隧道。
- 更新 `.env.example` 和 `docs/project/deployment.md`。
- 新增 change：`docs/changes/CHG-049-imap-bound-ssh-proxy-start.md`。

## 验证

```powershell
node --test test\imapService.test.js test\cpaConfig.test.js test\startWithImapProxy.test.js
```

结果：21/21 pass。

## 使用方式

`.env` 示例：

```env
IMAP_PROXY_SSH_HOST=vps-LA
IMAP_PROXY_LOCAL_HOST=127.0.0.1
IMAP_PROXY_LOCAL_PORT=11080
```

启动：

```powershell
npm run start:proxy
```

保留直连启动：

```powershell
npm start
```

## 注意

- 当前已实测 `vps-LA` 出口 IP 为 `5.253.38.136`，且可访问 `imap.gmail.com:993`。
- 如果本机已有进程占用 `127.0.0.1:11080`，绑定启动会因 SSH 端口转发失败而退出。
