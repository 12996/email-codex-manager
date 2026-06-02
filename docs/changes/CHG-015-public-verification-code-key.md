# CHG-015 公开验证码 key 与本机免登录验证码接口

状态：merged
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/db.js`, `src/replacementAccounts.js`, `src/server.js`, `test/`, `docs/project/api.md`

## 背景

本地自动化脚本调用验证码接口时携带 `admin_auth` cookie 成本较高；同时外部系统需要在不暴露邮箱明文、不开放任意邮箱查询的前提下，通过 GET 接口获取指定补号邮箱的验证码。

## 变更内容

- 新增：`GET /api/verification-code/public/latest?key=...`，通过补号账号表中的公开验证码 key 定位邮箱并复用现有验证码读取逻辑。
- 新增：`replacement_accounts.public_code_enabled` 和 `replacement_accounts.public_code_key` 字段；权限判断使用明确字段，不使用 `remark`。
- 新增：补号账号创建时自动生成 `public_code_key`；更新账号时如果显式提交空 key，会重新生成随机 key。
- 修改：`POST /api/verification-code/latest` 对本机请求免 `admin_auth`，非本机请求仍需要后台登录态。
- 修改：验证码读取响应逻辑抽取复用，避免 POST 和公开 GET 复制主账号路由、IMAP 读取、验证码提取逻辑。

## 验收标准

- [x] 本机调用 `POST /api/verification-code/latest` 可以不携带 `admin_auth`。
- [x] 外部公开 GET 接口只接收 `key`，不接收邮箱明文。
- [x] `public_code_key` 可自动生成，不需要管理员手动生成。
- [x] `key` 必须命中未删除且 `public_code_enabled = 1` 的补号账号。
- [x] 公开 GET 成功后复用现有 Gmail 主账号路由、别名匹配和 6 位验证码提取逻辑。
- [x] 缺少 key 返回 `KEY_REQUIRED`，无效或未启用 key 返回 `PUBLIC_ACCESS_DENIED`。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-02
- 备注：已合入公开验证码 key、本机免登录验证码接口和补号账号公开取码字段。
