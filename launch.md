# Gmail IMAP Service 部署与服务管理

本文档记录 `gcp-us` 服务器上的部署位置和后台服务管理命令。

## 部署信息

服务器：

```text
gcp-us
```

部署目录：

```text
/opt/gmail_IMAP
```

systemd 服务名：

```text
gmail-imap.service
```

默认端口：

```text
61298
```

后台登录地址：

```text
http://<服务器公网 IP>:3000/login
```

如果公网端口未放行，可以用 SSH 隧道访问：

```powershell
ssh -L 61298:127.0.0.1:61298 gcp-us
```

然后本地打开：

```text
http://localhost:61298/login
```

## 启动服务

```bash
sudo systemctl start gmail-imap.service
```

## 重启服务

```bash
sudo systemctl restart gmail-imap.service
```

## 关闭服务

```bash
sudo systemctl stop gmail-imap.service
```

## 查看服务状态

```bash
sudo systemctl status gmail-imap.service
```

不分页查看：

```bash
sudo systemctl --no-pager status gmail-imap.service
```

## 查看日志

实时日志：

```bash
sudo journalctl -u gmail-imap.service -f
```

最近 100 行日志：

```bash
sudo journalctl -u gmail-imap.service -n 100 --no-pager
```

本次启动后的日志：

```bash
sudo journalctl -u gmail-imap.service -b --no-pager
```

## 开机自启动

启用开机自启动：

```bash
sudo systemctl enable gmail-imap.service
```

禁用开机自启动：

```bash
sudo systemctl disable gmail-imap.service
```

## 删除服务

删除 systemd 服务，但保留项目文件：

```bash
sudo systemctl stop gmail-imap.service
sudo systemctl disable gmail-imap.service
sudo rm -f /etc/systemd/system/gmail-imap.service
sudo systemctl daemon-reload
sudo systemctl reset-failed
```

删除服务并删除项目目录：

```bash
sudo systemctl stop gmail-imap.service
sudo systemctl disable gmail-imap.service
sudo rm -f /etc/systemd/system/gmail-imap.service
sudo systemctl daemon-reload
sudo systemctl reset-failed
sudo rm -rf /opt/gmail_IMAP
```

## 更新部署

在本地重新打包并上传后，服务器执行：

```bash
cd /opt/gmail_IMAP
npm ci --omit=dev
sudo systemctl restart gmail-imap.service
```

## 配置文件

环境变量文件：

```text
/opt/gmail_IMAP/.env
```

查看配置：

```bash
cd /opt/gmail_IMAP
sed -n '1,120p' .env
```

编辑配置：

```bash
nano /opt/gmail_IMAP/.env
sudo systemctl restart gmail-imap.service
```

注意：`.env` 里包含后台登录密码和 session secret，不要公开。

## 数据库

SQLite 数据库位置：

```text
/opt/gmail_IMAP/data/app.db
```

备份数据库：

```bash
cp /opt/gmail_IMAP/data/app.db /opt/gmail_IMAP/data/app.db.bak.$(date +%Y%m%d-%H%M%S)
```

## 常用远程命令

从本机执行：

```powershell
ssh gcp-us "sudo systemctl restart gmail-imap.service"
ssh gcp-us "sudo journalctl -u gmail-imap.service -n 100 --no-pager"
ssh gcp-us "curl -I http://127.0.0.1:61298/login"
```
