# 2026-07-21 CPA 临时切换宿主机直连出口

- 状态：completed
- 目标：CPA 暂停使用家宽代理，直接使用 VPS 宿主机默认出口 IP。
- 远端：`vps-LA`
- 修改：将 `/etc/systemd/system/cliproxyapi.service.d/home-proxy.conf` 从 7891 代理环境改为仅保留 `NO_PROXY=127.0.0.1,localhost`；将 `/opt/cliproxyapi/config.yaml` 的顶层 `proxy-url` 改为空值。
- 备份：`/etc/systemd/system/cliproxyapi.service.d/home-proxy.conf.bak-20260721-070307`、`/opt/cliproxyapi/config.yaml.bak-20260721-072159`
- 重载：已执行 `systemctl daemon-reload` 和两次 `systemctl restart cliproxyapi.service`。
- 验证：CPA 新 PID 为 `6694`，状态为 `active`，接口 `/` 返回 `200`、`/v1/models` 在无 API key 时返回 `401`；进程无 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`；宿主机直连出口 IP 为 `5.253.38.136`。
- 影响范围：`mihomo.service` 未停止，`127.0.0.1:7891` 仍监听，但 CPA 当前不使用它。
- 回滚：同时恢复上述两个备份，再执行 `daemon-reload` 和 CPA 重启即可恢复家宽代理。
- 下一步：家宽服务恢复后，恢复 drop-in 中的 7891 代理环境并重启 CPA。

## 后续维护脚本

- 新增 `scripts/cpa-proxy-toggle.sh`，只切换 `/opt/cliproxyapi/config.yaml` 的顶层 `proxy-url`，不修改 systemd 代理环境或其他服务。
- 新增说明：`docs/project/cpa-proxy-operation.md`。
- 脚本支持 `direct`、`home`、`status`、`rollback`；每次修改前自动创建配置备份。
- 行为测试：`node --test test/cpa-proxy-toggle.test.js`。
