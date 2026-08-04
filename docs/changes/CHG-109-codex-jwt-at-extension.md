# CHG-109 纯 Chrome 扩展 JWT AT 直连校验

状态：accepted
创建日期：2026-08-03
关联 PRD：PRD-003
关联 Issue：无
影响范围：`extensions/codex-oauth-login/`、`test/codexJwtExtension*.test.js`、`docs/`

## 背景

用户不需要 OAuth、1455 callback、RT 下载或 Codex CLI 登录，而是希望在独立 Chrome 扩展页面输入 JWT AT 后，
直接得到脱敏的登录状态、邮箱和套餐。现有 CHG-108 的 OAuth/RT 行为不满足该目标。

## 变更内容

- 新增：基于固定 ChatGPT JWKS 的 Agent Identity JWT 本地 RS256 验签和受限 claim 校验。
- 修改：扩展页面改为 JWT AT 输入、登录、邮箱/套餐显示和清除；登录成功仅代表该 JWT 已按当前 Codex 合约验证。
- 修改：后台仅保留无凭证的 session attempt 与脱敏公共状态；JWT 不写入 Chrome storage。
- 修改：校验失败仅显示 JWKS 获取、签名不匹配或 Agent Identity claim 不匹配等安全分类，不显示 JWT、claim、HTTP 响应或原始错误。
- 删除：OAuth/PKCE、1455 callback、token exchange、RT 下载、offscreen document 及其权限和用户界面。
- 约束：不调用或依赖 Codex CLI，不建立网页 Cookie/session，不把 JWT 发送到网络。

## 验收标准

- [ ] 固定 JWKS 的 RS256 签名、issuer、audience、过期时间和必要 claim 全部通过时，才显示“已登录（JWT AT 已验证）”、邮箱和套餐。
- [ ] 错误 JWT、错误签名、错误 `kid`、错误 issuer/audience、过期、缺字段、JWKS 错误及清除竞态均不会误判成功。
- [ ] JWKS 获取失败、签名不匹配和 claim 不匹配分别显示安全分类，且不暴露原始错误或 JWT 内容。
- [ ] 除用户主动输入期间 password 控件的运行时值外，JWT 及敏感 claim 不出现在 `storage.local`、`storage.sync`、
  `storage.session`、日志、URL、下载文件、错误、页面文本或 HTML 属性。
- [ ] Manifest 仅包含完成本流程所需的 `storage` 权限和 ChatGPT JWKS host permission。
- [ ] 扩展不执行 Codex CLI、OAuth callback、RT 下载、本地端口或 Cookie 注入。

## 与既有 Change 的关系

本 change 被接受后，CHG-108 将标记为 `superseded`，因为两者的登录机制和产物互斥。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
