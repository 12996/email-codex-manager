# CHG-007 修复 Roxy OAuth 调试脚本 CDP 输出与关闭配置读取

状态：merged
创建日期：2026-06-01
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 调试脚本已能拿到 CDP WebSocket，但命令行只输出“已获取”，不便复制到调试模式复用。同时 `ROXY_KEEP_OPEN` 在 `dotenv.config()` 前读取，导致 `.env` 中配置 `ROXY_KEEP_OPEN=0` 时仍按默认保持打开处理。

## 变更内容

- 修改：CDP 获取完成日志输出完整 `ws://...` 地址。
- 新增：CLI 结束时输出 `ROXY_CDP_ENDPOINT=...` 复用提示，便于后续调试连接已打开浏览器。
- 修复：`run()` 在 `dotenv.config()` 后读取 `ROXY_KEEP_OPEN`，确保 `.env` 中的关闭配置生效。
- 修改：Playwright CDP 断开提示明确说明 `browser.close()` 仅用于断开 CDP 连接，不调用 Roxy `closeBrowser`。

## 验收标准

- [x] CLI 日志能看到可复制的 CDP WebSocket 地址。
- [x] CLI 日志能看到可直接放入环境变量的 `ROXY_CDP_ENDPOINT=...`。
- [x] `.env` 中设置 `ROXY_KEEP_OPEN=0` 时，脚本进入关闭 Roxy 窗口分支。
- [x] 单元测试覆盖 CDP 输出和 dotenv 后读取关闭配置。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入 RoxyBrowser 与 OAuth 自动化适配要求。
