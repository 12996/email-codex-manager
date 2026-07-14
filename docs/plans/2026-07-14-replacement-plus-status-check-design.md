# 补号账号 Plus 状态查询设计

- 状态：approved
- 创建日期：2026-07-14
- 关联 PRD：PRD-003
- 关联 Change：CHG-078

## 背景

补号账号注册成功后状态为 `registered`。管理员需要确认账号是否已经开通 ChatGPT Plus。收到 OpenAI 的 Plus 订阅确认邮件即可作为开通依据，命中后账号状态应更新为 `plus_active`。

## 目标与范围

- 在补号管理页增加手动“查询 Plus 状态”操作。
- 只查询 `registered` 状态的账号，其他状态不参与本次批量查询。
- 使用现有 IMAP 收件箱读取能力查询邮件，不把验证码接口当作完整邮件来源。
- 命中 Plus 订阅邮件后更新为 `plus_active`。
- 未命中时保持 `registered` 不变。
- 单个账号查询失败时保持 `registered`，并记录失败原因，不阻断其他账号。
- 本次不增加定时任务，不改变注册、补号和封禁验活流程。

## 方案决策

| 方案 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| 复用 IMAP `fetchMessages` | 已支持 Gmail alias、iCloud 收件箱映射和邮件结构化解析；可校验收件人 | 批量查询需要逐账号读取邮箱 | 采用 |
| 请求账号 `email_code_api` | 可能减少 IMAP 读取 | 当前接口契约是提取验证码，不保证返回完整邮件和收件人信息，容易误判 | 不采用 |
| 增加定时后台任务 | 可自动维护状态 | 超出当前手动查询需求，增加调度和重试复杂度 | 暂不采用 |

## Plus 邮件匹配规则

邮件主题、预览、纯文本正文和 HTML 正文合并后统一转小写并规范空白。邮件需要同时包含以下稳定文案：

- `you've successfully subscribed to chatgpt plus`
- `chatgpt plus subscription`
- `the openai team`

其中撇号兼容直撇号和弯撇号。邮件收件人地址优先从 `to`、`cc`、`delivered-to`、`x-original-to`、`envelope-to` 中读取；如果存在收件人信息，则必须包含目标补号邮箱。Gmail plus alias 仍由现有 `fetchMessages` 过滤，iCloud 共用 Gmail 收件箱时依靠收件人校验避免串号。

## 数据流

1. 前端点击“查询 Plus 状态”并确认操作。
2. 后端 `POST /replacement-accounts/check-plus-status` 调用状态查询服务。
3. 仓储只返回未软删除且状态为 `registered` 的账号。
4. 后端按邮箱类型选择收件箱：Gmail 使用主 Gmail，iCloud 使用 `ICLOUD_CODE_GMAIL_ACCOUNT`。
5. 每个账号读取收件箱最近 30 封邮件，匹配 Plus 订阅确认邮件。
6. 命中后写入 `status=plus_active`、`status_updated_at` 和状态备注，并清空旧 `last_error`。
7. 未命中不改变状态。
8. 查询失败不改变状态，在 `last_error` 中记录带“Plus 状态查询失败”前缀的原因，并加入失败结果。
9. 前端展示检测、命中、未命中和失败数量，完成后刷新列表。

## API

### `POST /replacement-accounts/check-plus-status`

无请求体。接口只处理当前状态为 `registered` 的账号。

成功响应：

```json
{
  "ok": true,
  "result": {
    "checked": 1,
    "plus": 1,
    "registered": 0,
    "failed": 0,
    "plusAccounts": [],
    "registeredAccounts": [],
    "failedAccounts": []
  }
}
```

单个账号失败不会让批量接口整体失败；只有初始化或服务级异常才返回 API 错误。

## 页面交互

- 工具栏增加“查询 Plus 状态”按钮。
- 点击后提示“只查询已注册状态账号”。
- 成功后记录操作日志并显示汇总 toast。
- 查询失败的账号仍留在 `registered` 筛选结果中，管理员可再次查询。

## 测试与验收

- Plus 邮件命中时只把 `registered` 账号改为 `plus_active`。
- 同批次的 `plus_active`、`banned` 和其他状态账号不会被查询。
- 非目标收件人的 Plus 邮件不会误判 iCloud 账号。
- 未找到邮件时状态保持 `registered`。
- IMAP 或收件箱配置失败时状态保持 `registered`，结果包含失败原因。
- API 返回正确的批量汇总并需要后台认证。
- 前端存在按钮、接口路径和结果刷新逻辑。
- 现有 JavaScript 测试与 `node --check` 回归通过。

## 回滚

删除新路由、状态查询服务和前端按钮即可回滚；账号状态不会因为未命中而改变。已经被标记为 `plus_active` 的账号如需回滚，应由管理员通过现有状态下拉手动调整。
