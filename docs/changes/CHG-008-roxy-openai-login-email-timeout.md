# CHG-008 新增 Roxy OpenAI 登录页邮箱处理与超时判断

状态：implemented
创建日期：2026-06-02
关联 PRD：PRD-002
关联 Issue：
影响范围：`src/auto/roxy_oauth_login.js`, `src/auto/roxy_oauth_steps_manual_test.js`, `scripts/roxy-codegen.cjs`, `test/roxyCodegenFlow.test.js`, `test/roxyOauthLogin.test.js`, `docs/work/`

## 背景

补号自动化需要复用 Roxy CDP 页面处理 OpenAI 登录页。用户会后续传入目标邮箱，自动化需要完成邮箱输入、点击继续，并判断登录页是否进入邮箱验证码页；如果页面长时间未进入下一阶段，应输出可识别的超时错误。

## 变更内容

- 新增：`openAi_login(page, email, options)`，负责等待邮箱输入框、填入传入邮箱、点击 `Continue`，并等待进入邮箱验证码页。
- 新增：`waitForOpenAiEmailVerification(page, options)`，负责在邮箱提交后等待 `/email-verification` 或 `Code` 输入框出现。
- 保留：`session_check(page, email, options)`，作为旧登录页邮箱展示区域校验工具，不作为本次 codegen 录制确认的主路径。
- 新增：`is_openai_login_page(page, options)`，用于手动测试入口判断当前页面是否为 OpenAI 邮箱输入页。
- 修改：将可复用登录页函数补入 `src/auto/roxy_oauth_login.js` 并导出，`scripts/roxy-codegen.cjs` 保留录制/调试职责。
- 修改：`src/auto/roxy_oauth_steps_manual_test.js` 支持 `openai-page` 和 `openai-login` 步骤，便于实机连接 Roxy CDP 验证。
- 新增：超时错误 `OPENAI_EMAIL_VERIFICATION_TIMEOUT`，包含当前 URL、title 和 body 截断文本。
- 新增：邮箱不一致错误 `OPENAI_LOGIN_EMAIL_MISMATCH`。
- 修改：`scripts/roxy-codegen.cjs` 增加 `require.main === module` 保护，避免测试导入时启动真实 CDP 录制。
- 新增：`test/roxyCodegenFlow.test.js` 和 `test/roxyOauthLogin.test.js` 覆盖正常登录页处理、邮箱不一致和超时。

## 验收标准

- [x] 登录页邮箱来自函数参数，不写死。
- [x] 能等待并填写 `Email address` 输入框。
- [x] 能点击 `Continue`。
- [x] 能在提交邮箱后等待进入邮箱验证码页。
- [x] 超时时抛出 `OPENAI_EMAIL_VERIFICATION_TIMEOUT`。
- [x] 邮箱不一致时抛出 `OPENAI_LOGIN_EMAIL_MISMATCH`。
- [x] 单元测试通过。
