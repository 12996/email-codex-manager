# issue-013 Roxy 注册密码提交阶段元素脱离 DOM

状态：resolved

## 现象

- automation run `507` 失败，数据库记录对应 `account_id=105` 的注册流程，不是 `src/auto/roxy_2fa_login.js` 的 2FA 登录流程。
- 失败日志最终报 `elementHandle.click: Element is not attached to the DOM`，调用点为 `src/auto/roxy_register_openai.js:653`。

## 排查

- 运行日志显示流程已从密码页进入邮箱验证码页，期间请求完成：
  `https://auth.openai.com/api/accounts/email-otp/send` -> `https://auth.openai.com/email-verification`。
- `humanClick()` 先通过 `page.waitForSelector()` 获取旧 `ElementHandle`，随机等待后再点击；页面在等待期间导航/重渲染，旧句柄因此 detached 或 disabled。
- 保留的 Roxy 页面实时状态为 `https://auth.openai.com/email-verification`，输入框和按钮本身可用。
- 手动点击 `Resend email` 后从账号 `email_code_api` 获取新验证码，提交成功进入 `https://auth.openai.com/about-you`；说明 OpenAI 邮箱验证码链路可用，主故障是自动化点击竞态。

## 影响

- 注册流程会在密码恢复/重复提交分支失败，浏览器虽已进入验证码页，但子进程退出并将 run 标记为 failed。

## 修复

- `humanClick()` 优先使用可重新解析的 `Locator`，不再保存 `waitForSelector()` 返回的旧 `ElementHandle`。
- 密码填写后、点击前重新识别阶段；如果页面已进入 OTP/profile/session，跳过重复点击。
- 点击期间发生 detached 错误时重新识别页面；确认已进入下一阶段才忽略错误，否则继续抛出。

## 验证

- 新增回归测试覆盖点击期间页面切换到 OTP 且旧按钮 detached 的场景。
- `node --test test/roxyRegisterOpenai.test.js`：29/29 通过。
- `node --check src/auto/roxy_register_openai.js`、`node --check test/roxyRegisterOpenai.test.js` 和 `git diff --check` 通过。
