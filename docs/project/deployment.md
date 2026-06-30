# deployment.md

记录部署、环境变量、运行方式和运维说明。

## 运行环境

| 变量 | 用途 | 必填 | 默认值 |
|---|---|---|---|
| `ADMIN_PASSWORD` | 后台管理密码 | 是 | `change-me` |
| `SESSION_SECRET` | 后台登录 Cookie 签名密钥，生产环境必须改成随机长字符串 | 是 | `change-me-session-secret` |
| `DATABASE_PATH` | SQLite 数据库文件路径 | 否 | `./data/app.db` |
| `PORT` | Web 服务监听端口；Windows 可能将 `3000` 放入排除端口范围，`.env.example` 使用 `3100` 避免 `EACCES` | 否 | `3000` |
| `IMAP_HOST` | Gmail IMAP 主机 | 否 | `imap.gmail.com` |
| `IMAP_PORT` | Gmail IMAP 端口 | 否 | `993` |
| `IMAP_SECURE` | IMAP 是否使用 TLS | 否 | `true` |
| `IMAP_PROXY` | Gmail IMAP 代理 URL；支持 `socks5://`、`socks://`、`http://` 等 ImapFlow 支持的代理协议 | 否 | 空 |
| `IMAP_PROXY_SSH_HOST` | `npm run start:proxy` 使用的 SSH Host 别名，例如 `vps-LA` | 使用绑定代理启动时必填 | 空 |
| `IMAP_PROXY_LOCAL_HOST` | `npm run start:proxy` 本地 SOCKS5 监听地址 | 否 | `127.0.0.1` |
| `IMAP_PROXY_LOCAL_PORT` | `npm run start:proxy` 本地 SOCKS5 监听端口 | 否 | `11080` |
| `IMAP_HOME_PROXY_SSH_HOST` | `npm run start:home-proxy` 使用的 SSH Host 别名 | 否 | `vps-LA` |
| `IMAP_HOME_PROXY_LOCAL_HOST` | `npm run start:home-proxy` 本地转发监听地址 | 否 | `127.0.0.1` |
| `IMAP_HOME_PROXY_LOCAL_PORT` | `npm run start:home-proxy` 本地转发监听端口 | 否 | `11080` |
| `IMAP_HOME_PROXY_REMOTE_HOST` | `npm run start:home-proxy` 在远端 SSH 主机上连接的家宽代理地址 | 否 | `127.0.0.1` |
| `IMAP_HOME_PROXY_REMOTE_PORT` | `npm run start:home-proxy` 在远端 SSH 主机上连接的家宽代理端口 | 否 | `7891` |
| `MAIL_FETCH_LIMIT` | 单次读取邮件数量上限 | 否 | `5` |
| `DEFAULT_READ_LOCATION` | 默认读取位置 | 否 | `inbox` |
| `ROXY_API_BASE_URL` | RoxyBrowser 本地 API 基础地址；配置后优先使用该值 | 使用 Roxy 自动补号时必填其一 | 空 |
| `ROXY_API_PORT` | RoxyBrowser 本地 API 端口；未配置 `ROXY_API_BASE_URL` 时用于拼出 `http://127.0.0.1:<port>` | 使用 Roxy 自动补号时必填其一 | 空 |
| `ROXY_API_TOKEN` | RoxyBrowser API token；如果本机 API 已开启 token 校验则必填 | 视 Roxy 配置而定 | 空 |
| `ROXY_WORKSPACE_ID` | RoxyBrowser workspace ID，用于调用 `/browser/list`、`/browser/open` 等接口 | 使用 Roxy 自动补号时必填 | 空 |
| `ROXY_BROWSER_DIR_ID` | RoxyBrowser 浏览器窗口目录 ID；配置后脚本直接使用该窗口 | Roxy 窗口定位三选一 | 空 |
| `ROXY_BROWSER_SORT_NUM` | RoxyBrowser 浏览器窗口序号，即窗口列表里的 `sortNum` / `windowSortNum` / `SN` | Roxy 窗口定位三选一 | 空 |
| `ROXY_BROWSER_WINDOW_NAME` | RoxyBrowser 浏览器窗口名称；名称重复时不建议使用 | Roxy 窗口定位三选一 | 空 |
| `ROXY_CDP_ENDPOINT` | 已打开 Roxy 窗口的 CDP WebSocket 地址；配置后跳过开窗、清缓存、随机指纹等准备步骤 | 调试复用窗口时可选 | 空 |
| `ROXY_KEEP_OPEN` | Roxy 调试/上线运行策略：`1` 保留窗口，`0` 流程结束关闭窗口 | 否 | `1` |
| `ROXY_HEADLESS` | Roxy 是否无头运行；`auto` 表示按 `ROXY_KEEP_OPEN` 推导 | 否 | `auto` |
| `CPA_URL` | CPA 管理接口基础地址 | 使用 CPA 上传/监控时必填 | `http://localhost:8317` |
| `CPA_MANAGEMENT_KEY` | CPA 管理接口密钥 | 使用 CPA 上传/监控时必填 | 空 |
| `CPA_HEALTH_MONITOR_ENABLED` | 是否启动 CPA 自动健康监控 | 否 | `false` |
| `CPA_HEALTH_MONITOR_INTERVAL_MS` | CPA 自动健康监控间隔 | 否 | `600000` |

## 启动方式

```powershell
npm install
npm start
```

如需让 Gmail IMAP 和固定出口代理同启同停，使用：

```powershell
npm run start:proxy
```

该命令会先执行 `ssh -N -D 127.0.0.1:11080 <IMAP_PROXY_SSH_HOST>` 启动本地 SOCKS5 隧道，再以 `IMAP_PROXY=socks5://127.0.0.1:11080` 启动 `src/server.js`。服务退出或按 `Ctrl+C` 时，包装器会同时关闭 SSH 隧道。

绑定代理启动示例：

```env
IMAP_PROXY_SSH_HOST=vps-LA
IMAP_PROXY_LOCAL_HOST=127.0.0.1
IMAP_PROXY_LOCAL_PORT=11080
```

如需只让 Gmail IMAP 走 `vps-LA` 上已运行的家宽代理，使用：

```powershell
npm run start:home-proxy
```

该命令会先执行 `ssh -N -L 127.0.0.1:11080:127.0.0.1:7891 vps-LA`，把本机 `127.0.0.1:11080` 转发到 `vps-LA` 上的 `127.0.0.1:7891`，再以 `IMAP_PROXY=socks5://127.0.0.1:11080` 启动 `src/server.js`。这样只有 Gmail IMAP 连接走家宽代理；Web 服务入口、RoxyBrowser 和其他自动化流程不受影响。

家宽代理启动示例：

```env
IMAP_HOME_PROXY_SSH_HOST=vps-LA
IMAP_HOME_PROXY_LOCAL_HOST=127.0.0.1
IMAP_HOME_PROXY_LOCAL_PORT=11080
IMAP_HOME_PROXY_REMOTE_HOST=127.0.0.1
IMAP_HOME_PROXY_REMOTE_PORT=7891
```

启动前可验证本机转发出口：

```powershell
curl.exe -4 -x socks5h://127.0.0.1:11080 https://api.ipify.org
```

启动前建议复制 `.env.example` 为 `.env`，并至少修改：

```env
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=随机长字符串
DATABASE_PATH=./data/app.db
```

如果要启用 RoxyBrowser 自动补号，还必须配置：

```env
ROXY_API_BASE_URL=http://127.0.0.1:你的RoxyAPI端口
ROXY_API_TOKEN=如果Roxy API需要token则填写
ROXY_WORKSPACE_ID=你的workspaceId
ROXY_BROWSER_SORT_NUM=目标浏览器窗口SN
```

`ROXY_API_BASE_URL` 和 `ROXY_API_PORT` 二选一即可；窗口定位参数 `ROXY_BROWSER_DIR_ID`、`ROXY_BROWSER_SORT_NUM`、`ROXY_BROWSER_WINDOW_NAME` 三选一即可。生产或多人环境建议优先使用 `ROXY_BROWSER_SORT_NUM` 或 `ROXY_BROWSER_DIR_ID`，避免窗口名称重复导致选错窗口。

## RoxyBrowser 参数获取

本项目的 Roxy 自动补号运行时位于 `src/auto/roxy_oauth_login.js`，底层封装在 `src/auto/roxy-browser-client.cjs`。脚本会先读取 `.env` 中的 Roxy 参数，再通过 RoxyBrowser 本地 API 查找并打开目标浏览器窗口。

### 1. 获取 Roxy API 地址和 token

在 RoxyBrowser 客户端中启用本地 API 服务，记录：

- API 地址或端口：写入 `ROXY_API_BASE_URL` 或 `ROXY_API_PORT`。
- API token：如果 RoxyBrowser 本地 API 开启 token 校验，写入 `ROXY_API_TOKEN`；未开启则留空。

示例：

```env
ROXY_API_BASE_URL=http://127.0.0.1:50000
ROXY_API_TOKEN=your-token-if-required
```

如果只知道端口，也可以写：

```env
ROXY_API_PORT=50000
```

### 2. 获取 `ROXY_WORKSPACE_ID`

调用 RoxyBrowser 本地 API 的 workspace 列表接口：

```powershell
$base = "http://127.0.0.1:你的RoxyAPI端口"
$token = "你的RoxyAPIToken"

Invoke-RestMethod `
  -Method GET `
  -Uri "$base/workspace/list?pageIndex=1&pageSize=50" `
  -Headers @{ token = $token }
```

如果本机 Roxy API 不需要 token，去掉 `-Headers @{ token = $token }`。

返回结果中 workspace 的 `id` 填入：

```env
ROXY_WORKSPACE_ID=<workspace.id>
```

注意：`ROXY_WORKSPACE_ID` 要填 workspace ID，不要填 project ID。若后续 `/browser/list` 返回“用户没有该空间权限”，通常表示 `ROXY_WORKSPACE_ID` 填错，或当前 token 对应账号没有该 workspace 权限。

### 3. 获取 `ROXY_BROWSER_SORT_NUM`

拿到 `ROXY_WORKSPACE_ID` 后，调用浏览器窗口列表接口：

```powershell
$workspaceId = "你的workspaceId"

Invoke-RestMethod `
  -Method GET `
  -Uri "$base/browser/list?workspaceId=$workspaceId&pageIndex=1&pageSize=100" `
  -Headers @{ token = $token }
```

返回的浏览器窗口列表里，取目标窗口的 `sortNum`、`windowSortNum` 或界面显示的 `SN`，填入：

```env
ROXY_BROWSER_SORT_NUM=<目标窗口SN>
```

如果返回中能直接看到 `dirId`，也可以改用：

```env
ROXY_BROWSER_DIR_ID=<目标窗口dirId>
```

脚本查找窗口的顺序是：

1. 已配置 `ROXY_BROWSER_DIR_ID`：直接使用该窗口。
2. 未配置 `ROXY_BROWSER_DIR_ID` 但配置了 `ROXY_BROWSER_SORT_NUM`：调用 `/browser/list` 后按 `sortNum` / `windowSortNum` 匹配。
3. 未配置以上两项但配置了 `ROXY_BROWSER_WINDOW_NAME`：调用 `/browser/list` 后按窗口名称匹配。

### 4. 验证 Roxy 参数是否正确

配置完成后，可先运行 Roxy 环境调试脚本验证是否能打开目标窗口：

```powershell
node .\src\auto\roxy_env_debug.js
```

如果失败信息包含：

```text
/browser/list 调用失败: 用户没有该空间权限
```

优先检查：

- `ROXY_WORKSPACE_ID` 是否来自当前 Roxy 账号可访问的 workspace。
- `ROXY_API_TOKEN` 是否属于当前 Roxy 账号。
- 是否误把 project ID 填成了 workspace ID。

如果失败信息包含：

```text
未找到 窗口序号 ... 对应的 RoxyBrowser 窗口 dirId
```

优先检查：

- `ROXY_BROWSER_SORT_NUM` 是否来自同一个 `ROXY_WORKSPACE_ID` 下的窗口列表。
- 目标窗口是否已被删除、移动到其他 workspace/project，或 SN 已变化。

## 数据库迁移

本项目使用 `better-sqlite3`，默认数据库是本地 SQLite 文件：

```txt
data/app.db
```

实际路径由 `DATABASE_PATH` 控制；如果 `.env` 没有配置，默认使用 `./data/app.db`。

迁移到另一台电脑时：

1. 停止旧电脑上的 Node 服务，避免复制时数据库仍在写入。
2. 复制旧电脑项目目录下的数据库文件：

   ```txt
   data/app.db
   ```

3. 放到新电脑相同项目目录：

   ```txt
   <新项目目录>/data/app.db
   ```

4. 复制 `.env`，确认新电脑的 `DATABASE_PATH` 指向该文件。
5. 在新电脑执行 `npm install` 和 `npm start`。

只迁移后台账号、Gmail 账号、补号账号和运行记录时，至少复制：

```txt
data/app.db
.env
```

如果要完整迁移补号自动化上下文，建议同时复制：

```txt
data/automation-logs/
src/auto/product_files/cpa/
src/auto/product_files/sub2api/
```

其中：

- `data/automation-logs/`：补号运行日志。
- `src/auto/product_files/cpa/`：已生成的 CPA auth JSON。
- `src/auto/product_files/sub2api/`：已生成的 sub2api JSON。

## 部署检查项

- `.env` 已配置生产后台密码和随机 `SESSION_SECRET`。
- `DATABASE_PATH` 指向可写目录，且迁移时已停止旧服务。
- 使用 CPA 上传或监控时，`CPA_URL` 和 `CPA_MANAGEMENT_KEY` 已配置。
- 使用 Roxy 自动补号时，RoxyBrowser 本地服务可访问，workspace/window 配置正确。
- 新电脑首次启动后，进入后台确认账号列表和补号账号列表能正常显示。
