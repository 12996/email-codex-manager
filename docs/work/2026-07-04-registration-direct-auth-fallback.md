# 2026-07-04 注册入口直连 Auth 兜底

## 目标

排查最新注册自动化失败中“邮箱 API 接不到码”的实际原因，并用新未注册邮箱实机跑通注册后 2FA 写库流程。

## 过程

- 查看最新失败日志：
  - run `358` / account `60` 卡在 ChatGPT 登录邮箱 modal。
  - 控制台显示 `https://chatgpt.com/api/auth/signin/openai?...login_hint=...` 返回 403，页面按钮保持 loading。
  - 脚本后续错误进入 OTP 等待，因此日志表现为“未找到验证码输入框”，不是邮箱 API 的第一故障点。
- 独立抽查账号级 `email_code_api`：
  - account `58` 可返回历史验证码。
  - account `59`、`60` 在未触发新邮件时接口超时。
- 连接 Roxy 调试：
  - ChatGPT modal 卡住时，直连 `auth.openai.com/log-in` 可进入 OpenAI 邮箱登录页。

## 修改

- `src/auto/roxy_register_openai.js`
  - 新增 `prepareDirectAuthEmailEntry()`。
  - 邮箱提交后若仍是 `state=email-entry` 且页面在 `chatgpt.com`，自动切到 `auth.openai.com/log-in` 重新提交邮箱。
  - 兜底后仍未知时明确抛出入口阶段错误，不再继续等 OTP。
  - OTP 预等待阶段的超时恢复如果已经重新提交密码，且还没有拉取验证码，则继续确认页面状态，不抛内部 `OTP_REFETCH_AFTER_RECOVERY`。
- `test/roxyRegisterOpenai.test.js`
  - 增加超时恢复回密码页、初次 OTP 等待继续确认页面状态的回归测试。

## 验证

- `node --check src\auto\roxy_register_openai.js` 通过。
- `node --test test\roxyRegisterOpenai.test.js` 通过，23/23。
- 实机 run `359`：
  - account `60` 完成注册。
  - 第一次邮箱验证码判错后继续轮询并提交第二次验证码。
  - 完成资料页、进入 ChatGPT 主站、获取 session。
  - 注册后自动启用 2FA。
  - `replacement_accounts.codex_2fa` 已写入，长度 32。

## 注意

- account `60` 注册成功后的状态写入已由后续 `CHG-069` 改为 `registered`。
- 本次调试中不要打开或粘贴 `/api/auth/session` 原始内容；其中包含 access token 和 session token。
- 当前未合并的 `implemented` change 已超过 5 个，需要安排 PRD 基线合并。
