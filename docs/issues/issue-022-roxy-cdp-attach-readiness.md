# issue-022 Roxy CDP 未就绪导致 Playwright 附着超时

状态：resolved
发现日期：2026-08-03
关联 Change：`CHG-104-roxy-no2fa-browser-registration.md`

## 现象

无 2FA 浏览器 runner 在调用 `playwright-core` 的 `chromium.connectOverCDP()` 时表现为超时，
导致页面自动化无法开始。

## 运行态证据

- 复现前的 Roxy `/browser/connection_info` 返回空数组，表示当前 profile 没有活动 CDP。
- 通过 `test/manual-roxy-proxy-refresh.cjs` 重新打开同一 profile 后，原生 CDP 命令正常，
  `playwright-core@1.60.0` 对 Chrome 149 连续附着五次成功。
- 新连接入口实机只读验证成功：在不导航页面的情况下完成 connection info 获取、Playwright 附着和断开。

## 根因

不是已证实的 Chrome/Playwright 版本不兼容。Roxy profile 未打开或刚启动时，connection info 可能为空；
旧 client 对 `connectOverCDP()` 没有显式 timeout，也不会在失败后重新取得 endpoint，因此外部等待表现为卡死。

## 修复

- `waitForConnectionInfo()` 最多轮询 12 次、间隔 500ms，仅对“connection info 未就绪”重试。
- `connectPlaywright()` 对每次 Playwright 附着传入 10 秒 timeout。
- `connectReadyPlaywright()` 最多附着 3 次，失败后重新获取 connection info；最终使用
  `ROXY_CDP_CONNECTION_INFO_TIMEOUT` 或 `ROXY_CDP_ATTACH_FAILED` 停止。
- 无 2FA 浏览器 runner 改用该就绪连接入口；连接失败不会进入邮箱、OTP 或资料页步骤。

## 验证

- Node 回归覆盖空 connection info 轮询、timeout 传递、失败后刷新 endpoint，以及最终错误不泄露 endpoint。
- 手动只读 probe 成功；未执行注册、未提交邮箱或 OTP。

## 后续

CDP 附着恢复后，仍需通过真实页面录制确认无 2FA 注册的 DOM 状态机；该问题不等同于注册流程已完成实机验收。
