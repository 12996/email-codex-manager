# issue-008 Roxy OAuth 密码页 / 邮箱验证码页误判

状态：resolved
发现日期：2026-06-06
关联文件：`src/auto/roxy_oauth_login.js`
关联 change：`docs/changes/CHG-040-roxy-openai-password-one-time-code.md`
关联历史问题：`issue-002-roxy-add-phone-transition-race.md`, `issue-004-roxy-phone-code-transition-race.md`

## 现象

完整 Roxy OAuth 实机链路中，OpenAI 密码页点击 `Log in with a one-time code` 后，日志出现：

```text
[roxy-oauth-login] phase=openai-password action=one-time code 登录入口提交完成 next=openai-password
[roxy-oauth-login] phase=oauth-flow action=识别到 OpenAI 邮箱登录页
[roxy-oauth-login] phase=openai-email action=填写邮箱
❌ [roxy-oauth-login] roxy_oauth_login 失败: locator.click: Timeout 30000ms exceeded.
  - waiting for getByRole('textbox', { name: 'Email address' })
  - locator resolved to <input readonly ... placeholder="Email address" aria-description="Read only." value="smiro4099+s3@gmail.com" .../>
```

当时真实页面已是邮箱验证码页：

```text
url=https://auth.openai.com/email-verification
title=Check your inbox - OpenAI
```

页面包含 `Code` 输入框，`is_email_code_page=true`；但旧逻辑先把 password 页上的 readonly `Email address` 输入框误判为邮箱登录页，随后尝试 click/fill readonly 输入框而超时。

## 根因

本次问题与 `issue-002`、`issue-004` 是同一类状态机问题：

- 页面提交后 OpenAI 前端可能短暂停留在当前阶段，或保留旧组件。
- 新增 password 分支时没有复用历史修复中的“提交后等待离开当前阶段 / 忽略当前阶段”规则。
- `is_openai_login_page()` 只检查 `textbox "Email address"` 是否可见，没有排除 password 页的 readonly 邮箱展示框和 email-code 页。

历史 issue 已经记录过防线：

- `issue-002`：`phone-add` 提交后要忽略当前 `phone-add`，不能重复填写手机号。
- `issue-004`：`phone-code` 提交后要忽略当前 `phone-code`，不能重复操作旧验证码输入框。

本次复发的直接原因是这条规则没有被抽象成所有 Roxy OAuth 阶段变更的通用约束。

## 预期行为

- 页面判断函数不能只凭单个 role selector 判断页面类型；必须结合 URL、标题/正文关键词和控件可编辑性/上下文排除误判。
- 每个“提交后等待下一阶段”的逻辑必须支持忽略当前阶段，直到进入明确的合法后续阶段或超时。
- 对 password 页，点击 one-time code 后的合法后续阶段是：
  - `email-code`
  - `codex-login`
  - OAuth callback
- 如果仍停留在 `openai-password`，应继续等待，不应返回 `next=openai-password`。

## 修复记录（2026-06-06）

- `is_openai_login_page()` 增加上下文排除：
  - `/log-in/password`
  - `/email-verification`
  - `Enter your password`
  - `Check your inbox`
  - `verification code`
- `openAi_password_one_time_code()` 调用后续阶段等待时传入 `ignoreStage: 'openai-password'`。
- `waitForOpenAiPostEmailStage()` 支持 `ignoreStage`，不会把被忽略的当前阶段当作下一阶段成功。
- 新增回归测试：
  - `is_openai_login_page ignores readonly email field on the password screen`
  - `openAi_password_one_time_code ignores the current password page while waiting for the next stage`
- 当前 Roxy 页面手动验证：
  - `openai-page=false`
  - `email-code-page=true`

## 验证

```text
RED: node --test .\test\roxyOauthLogin.test.js
# fail 2
# is_openai_login_page returned true for password readonly Email address
# openAi_password_one_time_code returned nextStage=openai-password

GREEN: node --test .\test\roxyOauthLogin.test.js
# tests 68
# pass 68
# fail 0

node --check .\src\auto\roxy_oauth_login.js
# exit 0
```

## 防复发规则

- 新增或修改 Roxy OAuth 阶段时，必须先查 `docs/issues/issue-002*`、`issue-004*` 和本 issue。
- 任何提交后等待下一阶段的函数都必须具备“忽略当前阶段”的测试。
- 页面识别函数至少要覆盖一个“相邻页误判”负例测试，例如 password 页的 readonly email 不应命中 email login。
- 实机卡住时先用当前 Roxy CDP 检查真实 URL、body、inputs readonly/disabled、buttons，再改代码。
