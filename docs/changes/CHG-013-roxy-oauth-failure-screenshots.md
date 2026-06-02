# CHG-013 Roxy OAuth 失败截图

状态：implemented

创建日期：2026-06-02

关联 PRD：PRD-002

影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 页面自动化失败时，需要保留失败现场，便于定位真实页面状态、选择器变化和验证码/API 异常。

## 变更内容

- 新增 `captureFailureScreenshot(page, error, step, options)`。
- 页面操作函数失败时默认截图到项目根目录 `debug_image/`。
- 截图文件名使用时间戳和步骤名，格式类似 `YYYYMMDD-HHMMSS-ms-<step>.png`。
- 支持 `options.debugImageDir` 覆盖截图目录。
- 支持 `options.disableFailureScreenshot` 关闭失败截图。
- 截图成功时将路径附加到 `error.debugScreenshotPath`。
- 截图失败时只附加 `error.debugScreenshotError` 并记录 warn，不覆盖原始错误。

## 验收标准

- [x] 自动化页面步骤失败后会尝试截图。
- [x] 截图保存到 `debug_image/` 或指定目录。
- [x] 文件名不包含邮箱、验证码、API key 或 URL 等敏感信息。
- [x] 原始错误 code 和 message 保留。
- [x] 截图失败不会遮蔽原始失败原因。

## 验证

- `npm test -- test\roxyOauthLogin.test.js` 通过，27/27 pass。
- `node --check src\auto\roxy_oauth_login.js` 通过。
- `node --check test\roxyOauthLogin.test.js` 通过。
