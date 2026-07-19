# OTP Distinct Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 当邮箱验证码提交失败时，继续监听同一邮箱，只提交新的不同验证码，最多提交两次，并同时覆盖初始注册和 2FA 重认证。

**Architecture:** 新增 `core.otp_submission` 共享提交器，由调用方注入验证码获取函数和验证码提交函数。邮箱来源层通过 `exclude_codes` 跳过已经提交过的验证码；重试过程复用当前 `BrowserSession`、Sentinel/OAuth 上下文，不刷新 Roxy profile、指纹、IP 或 CDP 会话。

**Tech Stack:** Python 3.10+、标准库 `unittest`、现有 replacement/Gmail IMAP/Outlook 邮箱适配器和 `BrowserSession`。

---

## 约束与验收标准

- 默认最多提交两个不同验证码；第一次成功立即返回。
- 相同验证码提交失败后不再次 POST，只继续轮询邮箱。
- 第二个不同验证码成功后停止；两个不同验证码都失败时抛出最后一次提交错误。
- `after_ts` 在同一 OTP 阶段固定，不因重试而回退到旧邮件。
- 重试不重新发送验证码，不刷新 Roxy profile、指纹、IP 或 CDP 会话。
- 邮箱验证码服务继续本机/直连请求，不通过 Roxy。
- 日志只记录阶段和尝试序号，不打印验证码明文、access token、密码或 TOTP secret。

### Task 1: Add failing tests for the shared OTP submitter

**Files:**
- Create: `src/auto/protocol_registration/tests/test_otp_submission.py`

**Step 1: Write the failing tests**

添加四个 `unittest` 用例：相同验证码不重复提交；第二个不同验证码成功；两个不同验证码失败时抛出最后错误；首次成功后不再获取验证码。获取器接收 `after_ts` 和 `exclude_codes`，测试用短序列或 `TimeoutError` 结束等待。

**Step 2: Run tests to verify they fail**

Run:

```powershell
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest discover -s tests -p test_otp_submission.py -v
```

Expected: FAIL because `core.otp_submission` and `submit_otp_with_distinct_retries` do not exist.

### Task 2: Implement the shared OTP submitter

**Files:**
- Create: `src/auto/protocol_registration/core/otp_submission.py`
- Test: `src/auto/protocol_registration/tests/test_otp_submission.py`

**Step 1: Implement the minimal loop**

定义 `submit_otp_with_distinct_retries(*, fetch_otp, submit_otp, after_ts, max_distinct_codes=2, logger=None)`。`fetch_otp(after_ts, exclude_codes)` 返回验证码，`submit_otp(code)` 返回业务结果。维护已提交验证码集合：重复值只继续获取；新值先记录再提交；成功立即返回；达到上限时重新抛出最后提交异常；获取器异常原样透传；上限必须为正数。

**Step 2: Run the focused tests**

运行 Task 1 命令，预期四个测试全部通过。

### Task 3: Add `exclude_codes` to all email providers

**Files:**
- Modify: `src/auto/protocol_registration/core/email_provider.py`
- Modify: `src/auto/protocol_registration/core/replacement_client.py`
- Modify: `src/auto/protocol_registration/core/outlook_client.py`
- Modify: `src/auto/protocol_registration/tests/test_replacement_email_provider.py`
- Modify: `src/auto/protocol_registration/tests/test_gmail_imap_provider.py`

**Step 1: Add provider-level failing tests**

覆盖 replacement 的外部/本地验证码、Gmail IMAP 和 Outlook：传入 `exclude_codes={"111111"}` 时跳过旧码，发现新码才返回。

**Step 2: Implement the smallest signature changes**

- 所有 provider 的 `exclude_codes` 默认 `None`，统一为字符串集合。
- replacement 在所有解析分支过滤排除码，`wait_for_otp` 每轮透传集合。
- Gmail IMAP 在状态、格式、时间检查后过滤排除码。
- Outlook 在抽取 OTP 后过滤排除码，保留现有 Graph/IMAP settle 行为。
- `core.email_provider.wait_for_otp(email, after_ts, exclude_codes=None)` 透传到对应 provider。

**Step 3: Run provider tests**

```powershell
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest tests.test_otp_submission tests.test_replacement_email_provider tests.test_gmail_imap_provider -v
```

### Task 4: Integrate initial registration OTP retry

**Files:**
- Modify: `src/auto/protocol_registration/main.py`
- Modify: `src/auto/protocol_registration/core/openai_auth.py`
- Modify: `src/auto/protocol_registration/tests/test_roxy_bridge.py`

自动邮箱模式使用共享提交器，保持固定 `otp_after_ts`；每次尝试重新生成 `authorize_continue` Sentinel header，但继续复用同一个 `BrowserSession`。手工输入模式保持一次提交。把验证码明文日志改为阶段/尝试信息。

### Task 5: Integrate 2FA re-authentication OTP retry

**Files:**
- Modify: `src/auto/protocol_registration/core/account_export.py`
- Modify: `src/auto/protocol_registration/tests/test_roxy_bridge.py`

`setup_2fa` 自动邮箱分支使用同一共享提交器，固定 `reauth_otp_after_ts`，每次尝试在同一 session 上重新生成 Sentinel header；不重建浏览器环境。验证码日志不得打印明文。

### Task 6: Full verification and diff audit

```powershell
F:\anaconda\anaconda3\envs\tilian\python.exe -m unittest discover -s tests -v
F:\anaconda\anaconda3\envs\tilian\python.exe -m compileall -q .
npm test -- test/roxyCdpBridge.test.js test/replacementServices.test.js test/replacementAccountsApi.test.js
git diff --check
```

确认没有修改账号状态、真实注册入口、Roxy 刷新逻辑，也没有新增敏感值日志；只依据新鲜命令输出报告结果。
