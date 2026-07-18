# CHG-083 Roxy 注册密码提交 detached 点击竞态修复

状态：implemented
创建日期：2026-07-16
关联 PRD：PRD-003
关联 Issue：`docs/issues/issue-013-roxy-registration-password-click-detached.md`
影响范围：`src/auto/roxy_register_openai.js`、`test/roxyRegisterOpenai.test.js`

## 背景

注册密码提交期间 OpenAI 页面可能已经导航到 `email-verification`，但旧实现继续操作密码页的 `ElementHandle`，导致 `Element is not attached to the DOM`。

## 变更内容

- `humanClick()` 使用可重新解析的 Playwright `Locator`，保留无 Locator 页面对象的兼容 fallback。
- 密码填写后点击前重新识别页面阶段，已进入下一阶段时不重复点击。
- detached/导航点击错误发生后重新识别页面，仅在确认进入 OTP/profile/session 时视为提交已完成。
- 新增回归测试覆盖旧按钮句柄在点击期间 detached 的场景。

## 验收标准

- [x] 页面在密码点击期间切换到 OTP 时，不再因旧 `ElementHandle` 直接失败。
- [x] 页面仍在密码阶段时，继续正常点击提交按钮。
- [x] 点击错误未确认下一阶段时仍然抛出，避免吞掉真实错误。
- [x] `node --test test/roxyRegisterOpenai.test.js` 29/29 通过。

## 回滚

回滚 `src/auto/roxy_register_openai.js`、`test/roxyRegisterOpenai.test.js` 及本 change 文档即可；不涉及数据库迁移或凭证格式变化。
