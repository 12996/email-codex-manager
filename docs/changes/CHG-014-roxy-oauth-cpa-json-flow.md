# CHG-014 Roxy OAuth 自动生成 CPA JSON

状态：merged
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy_oauth_login.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

Roxy OAuth 自动化流程需要从单阶段页面函数升级为完整补号链路：完成 OpenAI/Codex OAuth 登录、捕获 callback code、交换 token，并在本地生成 CPA 兼容认证 JSON。当前 CPA 后端缺少 `MANAGEMENT_KEY`，因此本次只落地本地文件，不上传 CPA 后端。

## 变更内容

- 新增：OAuth 页面状态机 `processOAuthLoginFlow`，串接邮箱登录、邮箱验证码、可选手机验证、Codex 授权确认和 callback code 捕获。
- 新增：CPA JSON 构建与本地保存能力，输出到 `src/auto/product_files/cpa/<email>.json`。
- 新增：callback 请求监听，避免 localhost:1455 无服务导致页面变成 `chrome-error://chromewebdata/` 后丢失 code。
- 修改：验证码接口请求默认携带 `admin_auth` cookie，并支持传入覆盖值。
- 修改：token 交换优先使用浏览器页面上下文 `fetch`，避免 Node 直连出口地区不支持。
- 修改：Roxy CDP 复用失败时回退到正常 Roxy 开窗流程；导航中断和 Codex Continue 点击超时均增加可恢复处理。

## 验收标准

- [x] 自动流程可完成 OAuth callback 并调用 token 交换。
- [x] 本地生成 CPA JSON 文件。
- [x] 手机验证方式选择页不存在时可直接进入 Codex 授权确认页。
- [x] `node --test test\roxyOauthLogin.test.js` 通过。
- [x] 真实运行 `node .\src\auto\roxy_oauth_login.js` 成功生成本地 CPA JSON。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入 OAuth callback、token exchange 和本地认证 JSON 生成要求。
