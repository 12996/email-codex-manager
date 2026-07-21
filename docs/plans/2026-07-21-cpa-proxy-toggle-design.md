# CPA 代理切换脚本设计

## 目标

为 VPS-LA 上的 CLIProxyAPI 提供一个可重复执行的 CPA 出口切换脚本：只修改 `/opt/cliproxyapi/config.yaml` 的顶层 `proxy-url`，不修改 systemd 代理环境，也不影响服务器上的其他服务。

## 范围

- `home`：设置 `proxy-url: http://127.0.0.1:7891`。
- `direct`：设置 `proxy-url: ""`，让 CPA 使用宿主机默认出口。
- `status`：显示当前 `proxy-url`、CPA 服务状态和 7891 监听状态。
- `rollback`：恢复最近一次 `config.yaml` 备份并只重启 CPA。

每次修改前为 `config.yaml` 创建带时间戳的备份。脚本只调用 `systemctl restart cliproxyapi.service`，不调用 `daemon-reload`，不写 `/etc/systemd/system/`，不重启 mihomo。

## 验收标准

- 切换 `direct`/`home` 后，配置文件只有一个顶层 `proxy-url`，值准确匹配目标模式。
- 每次修改都产生 `config.yaml.bak-YYYYMMDD-HHMMSS` 备份。
- `rollback` 能恢复最近备份。
- 脚本源码不包含对 systemd drop-in、`Environment=HTTP_PROXY`、`Environment=HTTPS_PROXY`、`Environment=ALL_PROXY` 或 `daemon-reload` 的写操作。
- CPA 重启失败时返回非零状态；其他服务不被重启。

## 风险与回滚

- `7891` 代理失效时，`home` 模式仍会写入该地址；使用前通过 `status` 或外部 IP 检查确认 mihomo/家宽可用。
- 配置写入失败时保留原文件；需要恢复时执行 `rollback`。
- systemd 的既有代理环境由脚本完全不处理，避免影响同机其他服务。
