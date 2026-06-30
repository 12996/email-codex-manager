# 2026-06-27 IMAP 家宽代理启动

## 背景

用户希望 `gmail_IMAP` 服务继续运行在当前机器，但 Gmail IMAP 提取邮件时让 Google 看到 `vps-LA` 上的家宽出口 IP，而不是当前机器或 VPS 默认出口 IP。

## 本次变更

- 新增 `scripts/start-with-home-imap-proxy.cjs`。
- 新增 `npm run start:home-proxy`：
  - 启动 SSH 本地端口转发：`ssh -N -L 127.0.0.1:11080:127.0.0.1:7891 vps-LA`。
  - 转发就绪后启动 `src/server.js`。
  - 向服务进程注入 `IMAP_PROXY=socks5://127.0.0.1:11080`。
  - 服务退出时关闭 SSH 转发。
- 新增 `IMAP_HOME_PROXY_*` 环境变量，用于覆盖 SSH host、本地端口和远端家宽代理端点。
- 更新 `.env.example` 和 `docs/project/deployment.md`。
- 新增 change：`docs/changes/CHG-050-home-imap-proxy-start.md`。

## 验证

RED：

```powershell
node --test test\startWithHomeImapProxy.test.js
```

结果：因 `../scripts/start-with-home-imap-proxy.cjs` 不存在失败。

GREEN：

```powershell
node --test test\startWithHomeImapProxy.test.js
```

结果：4/4 pass。

最终验证：

```powershell
node --test test\startWithHomeImapProxy.test.js test\startWithImapProxy.test.js test\imapService.test.js test\cpaConfig.test.js
```

结果：25/25 pass。

## 使用方式

```powershell
npm run start:home-proxy
```

默认转发链路：

```text
本机 127.0.0.1:11080
  -> ssh vps-LA
  -> vps-LA 127.0.0.1:7891
  -> 家宽代理出口
```

如果 `127.0.0.1:11080` 被占用，需要先关闭占用进程，或设置 `IMAP_HOME_PROXY_LOCAL_PORT` 使用其他本地端口。
