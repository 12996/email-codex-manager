# CHG-089 独立 CPA 2FA 补号协议

状态：implemented
创建日期：2026-07-20
关联 PRD：PRD-003
影响范围：`src/auto/protocol_cpa_auth.py`、`src/auto/protocol_registration/core/`、`src/auto/protocol_registration/scripts/`、`src/auto/test_protocol_cpa_auth.py`、`test/roxyCdpBridge.test.js`、`docs/`

## 背景

已有账号的 2FA 补号需要独立复现 Codex OAuth/CPA 协议。该流程不能复用注册状态机，也不能接入注册入口。

## 变更内容

- 新增独立 `protocol_cpa_auth.py`，流程为已有账号登录、TOTP、可选手机号补号、手机 OTP、Codex consent、workspace、OAuth token 和 CPA JSON 输出。
- OAuth 首跳固定为 `https://auth.openai.com/oauth/authorize`；ChatGPT 不是独立 CPA 的登录入口。
- 独立 CPA 禁用 ChatGPT 预热，并让 CDP bridge 直接导航完整 Auth authorize URL；注册协议的旧 ChatGPT 预热行为保持不变。
- Roxy CDP 按 ChatGPT、Auth、Sentinel origin 隔离页面，避免 Sentinel 导航覆盖 Auth 会话。
- Roxy CDP 读取并校验 profile 出口 IP，流程中途 IP 变化时终止 OAuth 会话。
- `add-phone/send` 的 4xx 按当前协议继续进入手机验证码阶段；各阶段继续使用 Auth 返回的 `continue_url`。
- `add-phone/send` 完成后，SMS API 按总超时和轮询间隔持续读取，避免短信异步到达时只请求一次就失败。
- CLI 支持 `--sms-timeout`、`--sms-poll-timeout` 和 `--sms-poll-interval`，也可使用对应 `CPA_*` 环境变量。
- OpenAI workspace ID 与 Roxy API workspace ID 分离；CPA CLI 要求显式 `--workspace-id` 或 `OPENAI_WORKSPACE_ID`，不能使用 `111070`。
- CPA 文件写入 `src/auto/product_files/cpa/`；注册入口和原注册状态机保持不变。

## 验收

- [x] CPA 单元测试 5/5 通过。
- [x] Roxy bridge 与相关服务测试 44/44 通过。
- [x] 注册协议 Python 全量测试 42/42 通过。
- [x] Node/Python 语法检查和 `git diff --check` 通过。
- [x] 代码对比确认 `roxy_2fa_auth_login.js` 与独立 CPA 协议均以 Auth Codex OAuth URL 为首跳。
- [x] 独立 CPA Auth 导航回归测试通过，确认不会先打开 ChatGPT 根页。
- [x] 账号 109 真实 CPA JSON 生成完成；CPA 文件包含非空 `access_token`、`refresh_token`、`id_token`。
- [x] 账号 109 的 SMS API 返回六位验证码后完成手机 OTP 和 token exchange。
- [x] 账号 109 通过 CPA repair worker 完成上传、健康复查和数据库 `cpa_mounted` 状态回写。

## 后续修复（2026-07-20）

- 修复 `phone-code` 阶段跳过 `add-phone/send` 的条件错误；进入任意手机阶段都会先请求发送/绑定接口。
- `add-phone/send` 返回 4xx 仍按“手机号已存在或请求已挂起”分支继续 SMS 轮询。
- 新增回归测试覆盖 `phone-code -> add-phone/send -> phone-otp/validate` 顺序。

## 回滚

删除或回滚本 change 涉及的独立 CPA 文件、Roxy bridge 兼容改动及专项测试；不回滚、不修改注册状态机。
