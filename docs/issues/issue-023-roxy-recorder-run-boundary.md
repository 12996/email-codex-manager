# issue-023 Roxy 录制文件混入旧会话且 DOM recorder 泄露 endpoint

状态：resolved
发现日期：2026-08-03
关联 Change：`CHG-104-roxy-no2fa-browser-registration.md`

## 现象

CDP 网络 recorder 的新会话会追加到既有 JSONL，读取时可能把历史 `user/register` 等事件误认为当前流程；
DOM recorder 的 start 记录还会写入传入的 CDP endpoint。

## 根因

- 网络 recorder 在 start 时调用追加写入，而没有初始化新的输出段。
- DOM recorder 的 start payload 直接包含 `endpoint` 字段。
- 三个 recorder 的 `connectOverCDP()` 没有显式 timeout。

## 修复

- 网络 recorder 在 start 时使用覆盖写入，只保留当前录制段。
- DOM recorder 将 start 中的 endpoint 固定为脱敏占位符。
- DOM、被动网络、CDP schema recorder 均使用 10 秒附着 timeout。

## 验证

- 本次真实录制按最后一个 start 段独立解析，确认当前路径为 OTP-first、无 password/TOTP。
- 修改后执行 Node 语法检查与完整 Node 回归；后续录制不再需要依赖历史段过滤。
