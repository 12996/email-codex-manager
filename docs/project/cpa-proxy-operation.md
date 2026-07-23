# CPA 代理切换使用说明

## 1. 用途

`scripts/cpa-proxy-toggle.sh` 用于切换 VPS-LA 上 CLIProxyAPI（CPA）的出站方式：

- `direct`：CPA 直接走 VPS 宿主机默认出口 IP。
- `home`：CPA 使用本机 mihomo 的家宽代理 `127.0.0.1:7891`。

脚本只修改：

```text
/opt/cliproxyapi/config.yaml
```

脚本不会修改 systemd 的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`，不会执行 systemd 环境重载，不会重启 mihomo，也不会影响服务器上的其他服务。切换后只重启 `cliproxyapi.service`。

## 2. 安装脚本

在本地项目根目录执行：

```powershell
scp .\scripts\cpa-proxy-toggle.sh vps-LA:/home/seal/cpa-proxy-toggle.sh
ssh vps-LA "chmod 700 /home/seal/cpa-proxy-toggle.sh"
```

脚本默认使用：

| 项目 | 值 |
|---|---|
| CPA 配置 | `/opt/cliproxyapi/config.yaml` |
| CPA 服务 | `cliproxyapi.service` |
| 家宽代理 | `http://127.0.0.1:7891` |
| 家宽配置来源 | `/home/seal/home-socks5-direct.yaml`（由 mihomo 加载） |

## 3. 常用命令

### 查看状态

```bash
/home/seal/cpa-proxy-toggle.sh status
```

会显示当前 `proxy-url`、CPA 服务状态和 7891 监听状态。

### 让 CPA 直连宿主机

```bash
/home/seal/cpa-proxy-toggle.sh direct
```

实际配置为：

```yaml
proxy-url: ""
```

### 让 CPA 使用家宽代理

```bash
/home/seal/cpa-proxy-toggle.sh home
```

实际配置为：

```yaml
proxy-url: http://127.0.0.1:7891
```

`home` 模式会先检查 `127.0.0.1:7891` 是否监听；它只能证明 mihomo 端口存在，不能保证家宽上游没有过期。切换前应确认家宽出口可用。

### 恢复最近一次备份

```bash
/home/seal/cpa-proxy-toggle.sh rollback
```

每次 `direct` 或 `home` 修改前，脚本会在 CPA 配置旁创建：

```text
/opt/cliproxyapi/config.yaml.bak-YYYYMMDD-HHMMSS
```

## 4. 验证出口

宿主机直连出口：

```bash
sudo -u cliproxyapi env -i PATH=/usr/bin:/bin \
  curl -fsS --noproxy '*' https://api.ipify.org
```

通过家宽代理的出口：

```bash
curl -fsS -x http://127.0.0.1:7891 https://api.ipify.org
```

如果两次结果不同，说明本地代理链路生效；实际使用的 IP 以 CPA 运行时的 `proxy-url` 模式为准。

## 5. 回滚原则

脚本每次只重启 CPA：

```text
systemctl restart cliproxyapi.service
```

不会调用 systemd 环境重载。因此即使服务器上其他服务有自己的代理环境，也不会被脚本改动。若 CPA 重启失败，先执行 `status`，必要时执行 `rollback` 恢复最近配置备份。
