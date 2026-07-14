# 2026-07-04 注册密码页到 OTP 页跳转竞态防护

## 背景

用户反馈 run `372` 注册失败，日志显示 OTP 阶段尝试重填数据库密码时抛出：

```text
密码页未就绪，跳过密码填写：URL=https://auth.openai.com/email-verification
```

查看失败截图和当前 Roxy 浏览器后确认页面实际停在 `https://auth.openai.com/email-verification`，并且已经显示 `Check your inbox` 的邮箱验证码输入框。

## 排查结论

- 失败不是邮箱 API 或密码长度问题。
- 根因是页面状态竞态：
  1. `waitForOtpInputReady()` 看到页面短暂像密码页；
  2. 调用 `handlePasswordPageDuringOtp()`；
  3. `submitRegistrationPassword()` 先输出“正在填写数据库密码”并等待人类化延迟；
  4. 延迟期间 OpenAI 页面已自动跳到 OTP 页；
  5. 函数再检查密码页时发现 URL 是 `email-verification`，于是抛错。

## 修改

- `src/auto/roxy_register_openai.js`
  - `submitRegistrationPassword()` 在密码页就绪检查失败时增加 OTP 输入框复检。
  - 若 OTP 已出现，记录“密码页已自动进入邮箱验证码页，跳过重复填写密码”，返回成功，让外层继续 OTP 流程。
- `test/roxyRegisterOpenai.test.js`
  - 新增竞态回归测试，先观察测试失败，再实现修复。

## 验证

```powershell
node --test test\roxyRegisterOpenai.test.js
node --check src\auto\roxy_register_openai.js
```

结果：

- `test\roxyRegisterOpenai.test.js`：26/26 pass。
- `src\auto\roxy_register_openai.js`：语法检查通过。

## 后续

- run `372` 的浏览器仍停在 OTP 页，但自动化子进程已退出，不能从原 run 自动续跑。
- 下一次重新触发注册时，新子进程会加载本次修复。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
