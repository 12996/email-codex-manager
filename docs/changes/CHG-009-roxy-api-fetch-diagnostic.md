# CHG-009 Roxy API 连接失败诊断信息增强

状态：implemented
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy-browser-client.cjs`, `test/roxyBrowserClient.test.js`, `docs/work/`

## 背景

Roxy OAuth 调试脚本在 RoxyBrowser API 端口不可达时只输出 `fetch failed`，无法直接判断实际请求地址、接口路径和底层网络错误。

## 变更内容

- 修改：`RoxyBrowserClient.request()` 捕获原生 `fetch` 失败，错误中输出请求方法、完整 URL、底层原因和配置检查提示。
- 新增：测试覆盖 Roxy API 连接失败时应包含 `ECONNREFUSED` 等底层原因。

## 验收标准

- [x] 当 `ROXY_API_BASE_URL` 指向未监听端口时，错误信息包含完整请求 URL。
- [x] 当底层 fetch 提供 `cause.code/address/port` 时，错误信息包含底层原因。
- [x] 既有 RoxyBrowserClient 测试通过。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
