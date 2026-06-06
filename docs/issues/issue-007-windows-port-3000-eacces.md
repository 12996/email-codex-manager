# issue-007 Windows 保留 3000 端口导致服务启动失败

状态：resolved
创建日期：2026-06-06
关联 change：`docs/changes/CHG-039-avoid-windows-port-3000-eacces.md`

## 现象

执行 `npm start` 后，Node 在监听 `0.0.0.0:3000` 时抛出：

```text
Error: listen EACCES: permission denied 0.0.0.0:3000
```

## 排查结论

- `Get-NetTCPConnection -LocalPort 3000` 未发现监听进程。
- `netsh interface ipv4 show excludedportrange protocol=tcp` 显示当前 Windows TCP 排除端口范围包含 `2987-3086`。
- 3000 落在该排除范围内，因此根因不是端口占用，而是系统保留端口导致普通进程无权限监听。

## 修复

- 本机 `.env` 设置 `PORT=3100`。
- 本机 `.env` 将 `VERIFICATION_CODE_API_URL` 留空，让自动化默认按 `PORT` 推导邮箱验证码 API URL。
- `.env.example`、自动化默认验证码 API URL、测试和文档同步为按 `PORT` 推导。

## 验证

- 启动验证：`npm start` 启动后进程保持运行，`GET http://127.0.0.1:3100/login` 返回 200。
- 测试验证：`node --test test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js` 通过，60/60 pass。
