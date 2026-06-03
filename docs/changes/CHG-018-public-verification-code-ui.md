# CHG-018 公开验证码 key 前端配置与复制入口

状态：implemented
创建日期：2026-06-03
关联 PRD：PRD-002
关联 Issue：
影响范围：`web/index.html`, `web/app.js`, `test/replacementAccountsWeb.test.js`, `docs/project/api.md`, `docs/work/`

## 背景

`GET /api/verification-code/public/latest?key=...` 已经支持通过补号账号表的 `public_code_key` 获取最近 6 位验证码，但补号管理页没有展示 key，也没有启用公开接口或复制公开 URL 的入口，管理员只能从详情 JSON 或数据库中查找字段。

## 变更内容

- 新增：补号账号新增/编辑弹窗提供“允许公开验证码接口”开关。
- 新增：补号账号新增/编辑弹窗提供“公开验证码 Key”输入框；留空时沿用后端自动生成逻辑。
- 新增：补号列表在邮箱信息下方显示公开验证码启用状态和 key。
- 新增：账号操作菜单提供“复制公开验证码 URL”，生成 `/api/verification-code/public/latest?key=...` 完整 URL。
- 新增：前端测试覆盖公开验证码字段和复制入口。

## 验收标准

- [x] 管理员能在补号管理页看到每个补号账号的 `public_code_key`。
- [x] 管理员能在新增/编辑账号时配置 `public_code_enabled`。
- [x] 管理员能在新增/编辑账号时查看或覆盖 `public_code_key`。
- [x] 未启用或缺少 key 时，复制公开验证码 URL 会提示先启用并保存。
- [x] 已启用且存在 key 时，复制公开验证码 URL 使用公开 GET 接口地址。
