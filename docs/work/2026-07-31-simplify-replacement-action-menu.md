# 2026-07-31 精简补号账号操作菜单

## 完成内容

- 从补号账号“操作”菜单移除公开验证码、获取验证码、获取 JSON、2FA 登录和公开验证码 URL 复制入口。
- 保留相关前端处理函数及所有后端 API。
- 新增菜单渲染回归测试。

## 验证

- `node --test test/replacementActionMenu.test.js`：2/2 通过。

## 关联

- Change：`docs/changes/CHG-102-simplify-replacement-action-menu.md`
