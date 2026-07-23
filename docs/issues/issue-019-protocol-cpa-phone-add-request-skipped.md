# Issue-019 协议 CPA 在 phone-code 阶段跳过 add-phone/send

状态：resolved

## 现象

协议补号在 MFA 后直接进入 `phone-code` 时，流程已经开始等待 SMS API，
但请求序列中没有先调用：

```text
POST https://auth.openai.com/api/accounts/add-phone/send
```

这会导致当前补号流程没有显式触发手机号绑定/验证码发送。

## 根因

`src/auto/protocol_cpa_auth.py` 的 `_complete_phone_stage()` 原先只在
`next_stage != "phone-code"` 时调用 `_send_phone()`。`phone-code` 被错误地当作
“已经发送过手机号验证码”的充分证据。

实际协议约束是：`add-phone/send` 只允许成功绑定一次，手机号已存在或已有待处理请求时返回 4xx 也属于可继续分支；因此进入任意手机阶段都必须先请求
`add-phone/send`，再读取 SMS API。

## 修复

- `phone-add`、`phone-verify`、`phone-code` 三种阶段统一先调用 `_send_phone()`。
- 4xx 继续进入 SMS 轮询，500+ 仍立即失败。
- 增加脱敏阶段日志，明确记录 `add-phone/send` 请求前后再进入 SMS polling。

## 验证

- 新增回归测试：`phone-code` 阶段的 `add-phone/send` 必须出现在
  `phone-otp/validate` 之前。
- CPA Auth 测试：8/8 通过。
- CPA replacement 测试：2/2 通过。
- Python 编译检查通过。

## 关联

- `src/auto/protocol_cpa_auth.py`
- `src/auto/test_protocol_cpa_auth.py`
- `docs/changes/CHG-089-standalone-cpa-2fa-auth-protocol.md`
