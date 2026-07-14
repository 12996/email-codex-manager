# 封禁邮件验活按钮设计

## 目标

在补号管理页新增手动按钮，批量检测已注册过 Plus 且未封禁的账号是否收到 ChatGPT 封禁通知邮件；命中后自动把账号状态改为 `banned`。

## 范围

- 检测状态范围：`plus_active`、`cpa_mounted`、`for_sale`、`sold`。
- 跳过其他状态，尤其跳过 `banned`。
- 每个目标账号只检测对应收件箱最近 5 封邮件。
- 命中封禁邮件后写入状态备注，不删除账号、不触发补号。

## 数据流

1. 前端补号管理页点击“一键验活”按钮。
2. 后端新接口筛选目标账号。
3. 后端按邮箱类型解析收件箱：
   - Gmail / Gmail plus alias：读取主 Gmail 收件箱。
   - iCloud：读取 `ICLOUD_CODE_GMAIL_ACCOUNT` 指定的 Gmail 收件箱。
4. IMAP 读取最近 5 封邮件，匹配账号邮箱和 ChatGPT deactivation 文案。
5. 命中则调用补号账号仓储方法更新为 `banned`。
6. 前端展示汇总：检测数、新封禁数、未命中数、失败数。

## 封禁匹配规则

邮件正文、预览、主题合并后需要同时满足：

- 包含目标账号邮箱。
- 包含 `Your account has been deactivated`。
- 包含 `violated our Terms and Usage Policies` 或 `This means your account can no longer be used`。

## 错误处理

- IMAP 失败只记录到结果中的失败项，不改账号状态。
- 找不到收件箱配置时该账号记为失败，不影响其他账号。
- 单个账号失败不终止整批检测。

## 测试

- 封禁邮件命中后状态变为 `banned`。
- 非目标邮箱的封禁邮件不误封。
- 非目标状态账号不参与检测。
- IMAP 失败不改状态并返回失败结果。
- 前端按钮调用批量验活接口并刷新列表。
