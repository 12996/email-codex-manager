# 2026-06-03 公开验证码 key 前端配置与复制入口

## 背景

用户在 `docs/project/api.md` 中看到 `/api/verification-code/public/latest` 的说明，但补号管理页没有展示 `public_code_key`，也没有启用公开验证码接口或复制 URL 的入口。

## 完成内容

- 在补号账号新增/编辑弹窗增加：
  - “允许公开验证码接口”复选框。
  - “公开验证码 Key”输入框。
- 在补号列表邮箱信息下方展示公开验证码启用状态和 key。
- 在账号操作菜单增加“复制公开验证码 URL”。
- 未启用或缺少 key 时提示先启用并保存；已启用时复制完整公开验证码接口 URL。
- 新增 `CHG-018` 记录该前端行为变更。

## 验证

```text
npm test -- test/replacementAccountsWeb.test.js
```

结果：5 个测试全部通过。

```text
npm test
```

结果：134 个测试中 133 个通过、1 个失败。失败项为 `test/accountsWebApi.test.js` 中侧栏断言：测试期望不出现“系统设置”，但当前 `web/sidebar.html` 已包含该导航项；该失败不在本次公开验证码 UI 改动范围内。

## 关键文件

- `web/index.html`
- `web/app.js`
- `test/replacementAccountsWeb.test.js`
- `docs/project/api.md`
- `docs/changes/CHG-018-public-verification-code-ui.md`
