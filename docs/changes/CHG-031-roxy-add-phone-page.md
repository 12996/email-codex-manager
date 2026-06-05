# CHG-031 Roxy OAuth 添加手机号页处理

状态：implemented
创建日期：2026-06-04
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy_oauth_login.js`, `src/auto/roxy_oauth_steps_manual_test.js`, `src/replacementServices.js`, `test/`

## 背景

实机 Playwright codegen 录制显示，OpenAI OAuth 流程在邮箱验证码提交后可能进入 `Add your phone number` 页面。旧状态机只覆盖手机验证方式选择页和手机验证码页，无法识别并提交添加手机号页，最终触发 OAuth 登录状态机超时。

## 变更内容

- 新增添加手机号页判断：识别 `Add your phone number` 文案、`Phone number` 输入框和 `Continue` 按钮。
- 新增添加手机号提交函数：从补号账号手机号注入的 `ROXY_OAUTH_PHONE` 或调用参数中读取手机号，填写 `Phone number` 并点击 `Continue`。
- OAuth 状态机新增添加手机号页分支，提交后继续等待后续手机验证码或授权页。
- 补号子进程环境新增 `ROXY_OAUTH_PHONE`，来源为补号表 `replacement_accounts.phone`。
- 手动验证入口新增 `phone-add-page` 和 `phone-add-submit` 两个 step，用于在真实 Roxy 页面单独验证添加手机号页判断和提交。
- 邮箱验证码阶段在填写验证码前、填写失败时、填写后、点击 Continue 失败时和点击后都会重新检测下一阶段；如果页面已经进入添加手机号、短信验证码、手机验证方式、Codex 授权或 callback，则立即交回状态机，避免继续操作旧验证码输入框。

## 验收标准

- [x] 可独立判断添加手机号页。
- [x] 可填写补号账号手机号并提交。
- [x] 补号子进程启动时会把补号表手机号注入到 `ROXY_OAUTH_PHONE`。
- [x] 手动验证脚本可单独执行添加手机号页判断和提交。
- [x] 邮箱验证码阶段遇到页面已跳转到添加手机号页时，不再继续填旧验证码输入框。
- [x] 现有手机验证码和 Codex 授权流程不受影响。

## 验证

- `npm test -- test/roxyOauthLogin.test.js`
- `npm test -- test/replacementServices.test.js`
- `node --test src\auto\roxy_oauth_steps_manual_test.js`
- 实机：`phone-add-page` 返回 `true`，`phone-add-submit` 返回 `phone-add-submitted`，提交后 `phone-code-page` 返回 `true`。
