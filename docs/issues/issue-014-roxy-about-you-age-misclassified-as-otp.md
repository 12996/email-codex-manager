# issue-014 Roxy /about-you 年龄输入框被误识别为 OTP

状态：resolved

## 现象

- run `508` 已经完成密码和邮箱验证码阶段，但在资料页继续按 OTP 流程执行。
- `src/auto/roxy_register_openai.js:795` 最终尝试点击 `/about-you` 页的 `input[inputmode="numeric"]`，该元素实际是 `input[name="age"]`，并报 `locator.click: Timeout 30000ms exceeded`。

## 排查

- Roxy 实时页面：`https://auth.openai.com/about-you`，页面只有 Full name、Age 和 Finish creating account。
- Age 输入框属性为 `type=number`、`name=age`、`inputmode=numeric`。
- `findVisibleOtpSelector()` 原先看到 `inputmode="numeric"` 就直接判定为 OTP；`classifyRegistrationPage()` 又在 profile 判断前扫描 OTP，因此把 Age 当成验证码框。

## 修复

- OTP 输入判定不再仅依赖 `inputmode=numeric`；要求 OTP 语义标记、`autocomplete=one-time-code` 或有限长度的 OTP 类型输入。
- `/about-you` 在页面状态判断中优先识别为 `profile`。
- OTP 等待阶段到达 profile/session 时立即停止等待；填码前再次复查，避免对资料输入框执行 `clearAndType()`。
- 增加 Age 数字输入框的相邻页面误判回归测试。

## 验证

- 初版修复专项测试：`node --test test/roxyRegisterOpenai.test.js` 31/31 通过。
- 追加发现：初始 OTP 等待函数把“已到 profile”转换为 `OTP_ALREADY_COMPLETED` 后，主流程未消费该信号，run `510` 因该错误直接退出。
- 追加修复后专项测试：`node --test test/roxyRegisterOpenai.test.js` 32/32 通过。
- 实机 run `511` 已确认：跳过重复 OTP，填写 `/about-you` 的姓名和年龄，进入 ChatGPT 主站，获取 Session，启用 MFA，并将账号 `105` 标记为 `registered`。
