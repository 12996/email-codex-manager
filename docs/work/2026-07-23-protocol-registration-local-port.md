# 2026-07-23 协议注册本地服务端口同步

## 问题

Windows 将 `13100` 放入 TCP 排除范围后，本机服务改用 `PORT=13400`。协议注册 Python
子进程仍回退请求 `127.0.0.1:13100/login`，因此在领取补号账号前报“补号服务后台登录失败”。

## 修复

`buildProtocolRegistrationEnv()` 现在向子进程显式传递 `REPLACEMENT_API_BASE`：优先保留
已有显式配置，否则按父服务 `PORT` 构造本机地址。运行日志环境摘要包含该变量。

## 验证

- 新增回归测试：`PORT=13400` 时子进程环境为 `http://127.0.0.1:13400`；RED 阶段确认旧代码未注入该变量。
- `node --test test/replacementServices.test.js`：38/38 通过。
- 在 `tilian` Python 环境执行 `python -m unittest tests.test_replacement_email_provider`：13/13 通过。

## 下一步

重启 `npm run start:home-proxy` 使当前 Node 进程加载修复，再从页面重试协议注册。
