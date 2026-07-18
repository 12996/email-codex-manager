# Roxy 注册密码提交竞态修复设计

## 目标

避免注册流程在密码提交期间切换到 `email-verification` 后，继续点击已脱离 DOM 的旧 `ElementHandle`。

## 方案

1. `humanClick()` 改用可重新解析的 Playwright `Locator`，不再保存 `waitForSelector()` 返回的旧句柄。
2. 密码填写后、真正点击前再次识别页面阶段；如果已经进入 OTP 页，直接视为密码提交完成。
3. 点击过程中发生 detached/导航异常时重新识别页面；只有确认已进入 OTP 才吞掉该异常，其他错误继续抛出。
4. 增加回归测试，覆盖“点击期间页面从密码页切换到 OTP 页”的负例。

## 验收

- 回归测试先在旧实现上失败，再在修复后通过。
- `node --test test/roxyRegisterOpenai.test.js` 通过。
- `node --check src/auto/roxy_register_openai.js` 和 `git diff --check` 通过。
