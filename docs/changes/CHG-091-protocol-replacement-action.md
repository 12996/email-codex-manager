# CHG-091 补号列表独立 CPA 协议补号操作

状态：merged
创建日期：2026-07-20
关联 PRD：PRD-003
合并日期：2026-07-25
合并目标：PRD-003
影响范围：`src/auto/protocol_cpa_replacement.py`、`src/replacementServices.js`、`src/cpaRepairWorker.js`、`src/server.js`、`web/`、`test/`、`docs/project/`

## 背景

独立 CPA 2FA 协议已经完成，但补号管理页只有 DOM 2FA 补号入口，无法从 Gmail-IMAP 后台直接调用协议链路。

## 变更内容

- 新增 `POST /replacement-accounts/:id/replace-2fa-protocol`。
- 新增独立 `src/auto/protocol_cpa_replacement.py`，按账号 ID读取补号数据并调用 `protocol_cpa_auth.py`。
- CPA repair worker 新增 `mode: '2fa-protocol'`，统一完成 CPA JSON 上传、健康复查和状态回写。
- 默认协议入口不再指向不存在的注册目录脚本；注册状态机和原 DOM 2FA 补号保持不变。
- 补号列表操作菜单将“协议注册”“协议补号”放在所有其他操作之前。
- 点击“协议补号”后立即显示启动记录和提示，并通过 SSE 将子进程 stdout/stderr、CPA 读取、上传、健康复查和最终结果实时显示在补号列表下方的“当前协议补号日志”面板；历史“补号子进程日志”页面保持不变。
- 协议补号要求 `OPENAI_WORKSPACE_ID`，与 Roxy `ROXY_WORKSPACE_ID` 分离。
- 每次协议补号启动子进程前，固定对动作级 profile 执行关闭、清本地缓存、清服务端缓存、刷新指纹、重新打开并取得 CDP；子进程只复用刷新后的 CDP。
- `consent.data` 允许对象或路由数据数组两种 JSON 形状；两者都交给同一 consent challenge 提取逻辑。

## 验收

- [x] 独立 Python 适配器测试 2/2 通过。
- [x] replacement services 测试 37/37 通过。
- [x] CPA repair worker 测试 8/8 通过。
- [x] replacement API 测试 36/36 通过。
- [x] replacement web 测试 16/16 通过。
- [x] 协议补号 SSE 流覆盖 start、步骤、stdout/stderr、成功、失败和 complete 事件；普通 JSON 请求保持兼容。
- [x] 协议注册、普通补号和 DOM 2FA 补号入口未改变。

## 使用前提

在 `.env` 配置真实的 `OPENAI_WORKSPACE_ID`，并确保 Roxy 目标 profile、账号 SMS API 和 CPA 管理接口可用。账号 109 已完成过一次真实补号，不应重复触发其 add-phone/SMS。

## 回滚

删除协议补号路由、独立 Python 适配器、worker mode、前端入口和对应测试；不涉及数据库迁移，也不回滚注册状态机。
