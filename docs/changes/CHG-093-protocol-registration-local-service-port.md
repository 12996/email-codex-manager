# CHG-093 协议注册继承本地补号服务端口

状态：merged
创建日期：2026-07-23
关联 PRD：PRD-003
合并日期：2026-07-25
合并目标：PRD-003
影响范围：`src/replacementServices.js`、`test/replacementServices.test.js`、`docs/work/`

## 背景

协议注册子进程此前未接收 `REPLACEMENT_API_BASE`，Python 配置会回退到已写死的
`http://127.0.0.1:13100`。当本机 Web 服务因 Windows TCP 排除范围改用其他 `PORT` 时，
子进程会向旧端口登录并失败。

## 变更内容

- 协议注册子进程显式继承 `REPLACEMENT_API_BASE`；未配置时由当前服务的 `PORT` 推导为
  `http://127.0.0.1:<PORT>`。
- 显式 `REPLACEMENT_API_BASE` 保持优先，便于独立部署。
- 自动化运行日志记录该配置是否已注入（不记录敏感凭据）。

## 验收

- [x] `PORT=13400` 时，协议注册子进程接收
  `REPLACEMENT_API_BASE=http://127.0.0.1:13400`。
- [x] Node 协议注册专项测试通过。
- [x] tilian Python 协议注册邮箱提供方测试通过。

## 回滚

回滚 `src/replacementServices.js` 中协议注册环境的 `REPLACEMENT_API_BASE` 注入；回滚后使用
非默认端口时须手动配置该变量。
