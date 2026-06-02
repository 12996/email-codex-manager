# CHG-003 新增 RoxyBrowser 自动化连接工具

状态：merged
创建日期：2026-06-01
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy-browser-client.cjs`, `src/auto/roxy_oauth_login.js`, `src/auto/package.json`, `.env.example`, `test/roxyBrowserClient.test.js`, `test/roxyOauthLogin.test.js`, `package.json`, `package-lock.json`

## 背景

补号自动化流程需要先通过 RoxyBrowser 指纹浏览器准备干净窗口，再用 Playwright 接管 CDP 页面执行后续自动化。

## 变更内容

- 新增：RoxyBrowser 客户端工具，支持关闭窗口、清空本地缓存、清空服务器缓存、刷新随机指纹、打开窗口、读取 CDP 地址并连接 Playwright。
- 新增：未配置 `dirId` 时，可按窗口序号或窗口名称自动查找目标窗口。
- 新增：`src/auto/roxy_oauth_login.js` 调试脚本，默认打开并导航到 `https://chatgpt.com/`，支持命令行第一个参数覆盖目标 URL，默认保持 Roxy 指纹浏览器窗口打开。
- 新增：RoxyBrowser 相关环境变量示例。
- 新增：RoxyBrowser 工具类单元测试。
- 修改：新增 `playwright-core` 依赖，用于通过 CDP 连接已打开的指纹浏览器。
- 删除：无。

## 验收标准

- [x] 工具默认执行“关闭窗口 → 清本地缓存 → 清服务器缓存 → 随机指纹 → 打开窗口 → 查询 CDP → Playwright 连接”。
- [x] 工具支持按 `dirId > sortNum > windowName` 定位目标窗口。
- [x] 调试脚本记录配置读取、目标窗口解析、清缓存、随机指纹、打开窗口、CDP、Playwright 连接、目标 URL 导航、当前 URL/title 和保持打开状态。
- [x] Roxy API 返回失败时抛出包含接口路径的错误。
- [x] 单元测试通过。

## 合并记录

- 合并目标 PRD：PRD-002
- 合并日期：2026-06-01
- 备注：已成功合并入 PRD-002。
