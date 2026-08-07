# CHG-107 无 2FA 随机资料与阶段诊断

状态：implemented
创建日期：2026-08-03
关联 PRD：PRD-003
关联 Issue：`issue-025-roxy-no2fa-create-account-response-variant.md`

## 背景

无 2FA runner 虽复用了资料页填写函数，但 CLI 层固定默认生日为 `2000-01-01`，导致年龄固定。OTP 后
`/about-you` 的短暂渲染延迟也会在首次字段不可用时直接失败，并将未分类异常输出为通用失败码。

## 变更内容

- 未传 `--name` / `--birthday` 时，生成随机姓名和随机合法生日；生日对应年龄范围为 20 至 44 岁。
- 显式传入 `--name` 或 `--birthday` 时，继续使用指定资料，保证可复现运行。
- `/about-you` 首次字段不可用时，仅在确认仍处于 profile 状态后重试一次资料填写；若已进入 ChatGPT session，
  不重复提交资料。
- 每个 browser state-machine 边界为未分类异常补充稳定错误码和阶段名；失败日志仅记录脱敏 URL 路径及控件属性，
  不记录输入值、AT、OTP、Cookie、CDP endpoint 或代理凭据。

## 验收标准

- [x] 缺省资料运行会将随机姓名和随机生日传入 browser flow。
- [x] 生成生日换算后年龄始终在 20 至 44 岁范围内。
- [x] 资料页 DOM 延迟一次后出现字段时，runner 会重新填写并继续严格验证 `create_account` 响应。
- [x] 未分类资料页异常显示 `NO2FA_PROFILE_FILL_FAILED stage=profile-fill`，不输出浏览器原始错误内容。
- [x] 不引入 password、`user/register` 或 MFA/TOTP 分支。

## 验证

- `node --test test/roxyNo2FaRegister.test.js`：28/28 通过。
- `npm test`：71/71 通过。
