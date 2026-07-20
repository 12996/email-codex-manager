# 协议补号操作设计

## 目标

在补号管理页新增独立的“协议补号”操作，调用已完成的独立 CPA 2FA 协议，为已有账号生成 CPA JSON，并复用现有 CPA 上传、健康复查和状态回写链路。

## 边界

- 不修改注册入口和 `src/auto/protocol_registration/main.py` 注册状态机。
- 不改变现有“执行补号”和“2FA补号”的行为。
- 不把 Roxy workspace ID 当作 OpenAI workspace ID；协议补号要求 `OPENAI_WORKSPACE_ID`。
- 不重复触发账号 109 的真实补号；本次只增加可回归的操作入口。

## 数据流

```text
补号列表「协议补号」
  -> POST /replacement-accounts/:id/replace-2fa-protocol
  -> cpaRepairWorker.repair(mode=2fa-protocol)
  -> protocol_cpa_replacement.py
  -> protocol_cpa_auth.py
  -> src/auto/product_files/cpa/<email>.json
  -> CPA upload + health check
  -> cpa_mounted / replacement_count + 1
```

协议入口通过补号服务 API 按 `REPLACEMENT_ACCOUNT_ID` 读取当前账号的邮箱、密码、TOTP、手机号和 SMS API。OpenAI/Auth/OAuth 请求继续使用当前 Roxy CDP profile；短信验证码使用账号的 SMS API 和独立 `SMS_API_PROXY` transport。

## 后端

- 新增 `POST /replacement-accounts/:id/replace-2fa-protocol`。
- 配置 CPA worker 时使用 `mode: '2fa-protocol'`，上传和健康复查成功后才标记 `cpa_mounted`。
- 未配置 worker 时直接调用 `replaceAccountWith2FAProtocol`，保持测试/本地 fallback。
- 协议子进程失败时恢复操作前业务状态，并写入“协议补号失败”错误。
- 默认协议脚本改为独立的 `src/auto/protocol_cpa_replacement.py`，避免把 CPA 补号入口放入注册状态机目录。

## 前端

操作菜单前两项固定为：

1. `协议注册`
2. `协议补号`

其余操作顺序保持不变。协议补号成功或失败后刷新账号列表并显示活动提示。

## 测试与回滚

- 先为服务、API、CPA worker 和前端顺序增加失败回归测试，再实现代码。
- Python 入口增加参数/账号读取/协议调用的窄测试，不执行真实网络。
- 运行专项 Node/Python 测试、语法检查和 `git diff --check`。
- 回滚时删除协议补号路由、入口、worker mode、前端按钮和对应测试；不涉及数据库迁移。
