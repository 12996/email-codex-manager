# CHG-071 注册密码页到 OTP 页跳转竞态防护

状态：implemented

创建日期：2026-07-04

关联 PRD：PRD-003

## 背景

实机 run `372` 在 OTP 等待阶段报错：

```text
密码页未就绪，跳过密码填写：URL=https://auth.openai.com/email-verification
```

失败截图显示页面实际已经是 `Check your inbox` 邮箱验证码输入页。根因是自动化刚判断页面仍像密码页并进入“重新填写数据库密码”恢复分支，但 `submitRegistrationPassword()` 开头的人类化延迟期间，OpenAI 页面已经从密码页自动跳转到 OTP 页。延迟结束后函数再次检查密码页就抛错，导致已经可继续提交邮箱验证码的注册流程失败。

## 目标

- OTP 阶段恢复密码页时，如果页面已自动进入邮箱验证码页，不再报密码页未就绪。
- 保持“必须先提交数据库密码，再提交邮箱验证码”的流程约束。
- 日志继续不输出密码、验证码或 token 明文。

## 验收标准

- [x] `submitRegistrationPassword()` 在准备填写密码时若发现 OTP 输入框已可用，视为密码提交已生效并返回成功。
- [x] 对应日志只记录页面已进入邮箱验证码页，不输出敏感信息。
- [x] 回归测试覆盖“密码页判断后跳转到 OTP 页”的竞态。

## 实现记录

实现日期：2026-07-04

- `src/auto/roxy_register_openai.js`
  - 在 `submitRegistrationPassword()` 的密码页就绪检查失败时，额外检测可用 OTP 输入框。
  - 如果 OTP 输入框已出现，记录 `密码页已自动进入邮箱验证码页，跳过重复填写密码` 并返回成功，交回外层 OTP 流程继续轮询/提交邮箱验证码。
- `test/roxyRegisterOpenai.test.js`
  - 新增 `submitRegistrationPassword treats OTP page after password transition as already submitted`，复现 run `372` 的跳转竞态。

验证：

```powershell
node --test test\roxyRegisterOpenai.test.js
node --check src\auto\roxy_register_openai.js
```

结果：`test\roxyRegisterOpenai.test.js` 26/26 pass，语法检查通过。

## 回滚

移除 `submitRegistrationPassword()` 中 OTP 输入框兜底判断，并删除对应测试即可恢复旧行为；回滚后 run `372` 这类密码页到 OTP 页的跳转竞态会再次失败。
