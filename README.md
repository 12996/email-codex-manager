# Gmail IMAP Service

本项目是一个本地 Gmail IMAP 管理服务。

## 启动

复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```env
ADMIN_PASSWORD=你的后台密码
SESSION_SECRET=随便一串随机字符
```

启动：

```powershell
npm start
```

访问：

```text
http://localhost:3100/login
```

## Gmail 账号准备

添加 Gmail 账号前，先阅读：

```text
docs/gmail-account-setup.md
```

## API / 页面接口文档

接口文档见：

```text
docs/api.md
```
