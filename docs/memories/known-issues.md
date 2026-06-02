# known-issues.md

记录长期稳定的历史坑位、排查经验和复用性教训。

格式：

- 现象：
- 原因：
- 处理方式：
- 相关文件：
- 首次记录日期：

## 已知问题

### Roxy codegen 录制脚本与正式 OAuth 自动化脚本职责不要混用

- 现象：新增 OpenAI 登录流程函数时，容易把可复用业务函数写入 `scripts/roxy-codegen.cjs`。
- 现象：用户明确说“使用 Playwright 的 codegen 模式，我给你走一遍流程”时，容易误解成先根据现有文件补代码和测试。
- 原因：`scripts/roxy-codegen.cjs` 是录制/调试入口；正式补号 OAuth 自动化运行时在 `src/auto/roxy_oauth_login.js`。
- 处理方式：如果用户要求 codegen 并表示会手动走流程，第一步必须先启动 Playwright codegen/recorder，让用户完成真实流程；录制完成后再把 selector 和交互整理进 `src/auto/roxy_oauth_login.js`，对应测试写入 `test/roxyOauthLogin.test.js`。`test/roxyCodegenFlow.test.js` 只覆盖 codegen/录制辅助自身。
- 相关文件：`src/auto/roxy_oauth_login.js`、`scripts/roxy-codegen.cjs`、`test/roxyOauthLogin.test.js`、`test/roxyCodegenFlow.test.js`
- 首次记录日期：2026-06-02

### 手动提交邮箱验证码时不要强制要求邮箱参数

- 现象：执行 `node src\auto\roxy_oauth_steps_manual_test.js --step email-code-submit --code <6位验证码>` 时，脚本报错 `missing --email or OPENAI_LOGIN_EMAIL`。
- 原因：`email-code-submit` 的入口参数校验复用了 API 拉取验证码路径的邮箱要求；但用户已经传入 `--code` 时不需要再用邮箱查询验证码 API。
- 处理方式：只有未传 `--code`、需要通过验证码 API 查询时才要求 `--email`；直接传 `--code` 时允许邮箱为空。
- 相关文件：`src/auto/roxy_oauth_steps_manual_test.js`、`src/auto/roxy_oauth_login.js`、`test/roxyOauthLogin.test.js`
- 首次记录日期：2026-06-02
