# handoff.md

状态：active

## 2026-07-30 协议注册状态机恢复

- 因误将协议目录恢复到 `ab37db5`，2026-07-28 尚未提交的 CHG-100 代码被覆盖；账号
  `210` 随后直接请求 `user/register` 并收到 HTTP 409 `invalid_state`。
- Git 历史没有完整正确版本，已依据 `CHG-100` 与 `issue-020` 恢复：真实 OAuth 参数 ->
  `authorize_continue` Sentinel -> OTP validate -> `username_password_create` continuation ->
  `user/register`。
- 回归：`tests.test_roxy_bridge` + `tests.test_password_registration` 33/33 通过，
  `py_compile` 通过。
- 已在 Roxy `617-3` 手动完成一枚新账号的前置 OTP、密码、密码后 OTP、资料页、OAuth
  callback 和 TOTP 2FA；Auth 状态机已真实验收。
- 待办：修复自动流程的外部 `email_code_api` 旧码首次命中问题；不要复用账号 210 或录制邮箱。
- 实施前阅读 `docs/project/protocol-registration-flow.md`；其中已明确双 OTP 各自的时间下界、
  120 秒/5 秒轮询和 `wrong_email_otp_code` 后等待新邮件的规则。
- 自动代码已实现错码后的继续轮询和 5 秒默认间隔；待使用全新邮箱验证自动错码恢复分支。
- 已提交 OTP 会在同一阶段被排除；接口重复返回相同旧码时只会继续轮询，避免重复提交。

## 2026-07-28 协议注册邮箱验证先于密码提交

- 两次 Roxy 手动录制确认真实前端 OAuth 初始参数为 `screen_hint=login_or_signup`、
  `prompt=login` 和 `login_hint=<email>`，流程到密码页前先经过 `email-verification`。
- 当前在线 Auth bundle 确认验证码确认接口为 `POST /api/accounts/email-otp/validate`，请求体为 `{code}`。
- `main.py` 已恢复真实 OAuth 参数，并改为 `authorize_continue` Sentinel -> OTP validate ->
  `username_password_create` continuation -> `user/register`；禁止直接访问密码页后提交密码。
- 回归：`tests.test_roxy_bridge` + `tests.test_password_registration` 33/33 通过，`py_compile` 通过。
- 待办：用新的未注册邮箱执行一次完整协议注册验收；不要复用两个手动录制邮箱。关联
  `CHG-100` 和 active `issue-020`。

## 2026-07-25 PRD-003 基线合并

- 已将 `CHG-091` 至 `CHG-099` 合并进 PRD-003，并将这些 change 标记为 `merged`。
- 本次基线覆盖协议注册/协议补号、直接 MFA、CDP 重试与运行模式、AT 复制，以及按状态筛选的一键验活。

## 2026-07-25 一键验活按状态筛选

- 当前筛选为 `registered`、`plus_active`、`cpa_mounted`、`for_sale` 或 `sold` 时，一键验活只处理该状态。
- 状态为空或筛选其他状态时，仍处理上述五种可验活状态的全集；后端会校验该范围。

## 2026-07-25 协议注册密码链路端到端验证

- 协议流程已改为：signup → 密码页 → `user/register` → 邮箱 OTP → `about_you` → OAuth 回调 → access token → 直接 TOTP 激活。
- 已用新补号邮箱完成全链路实测，并确认 TOTP 激活后才回写 `registered`。
- Roxy IP 元数据接口的短暂 502 仅记录告警；只有读取到实际不同出口 IP 时才中断会话。
- 通过服务队列发起的另一轮新指纹测试在 Auth authorize 阶段遇到 HTTP 403，未进入密码/OTP 代码；这是 Roxy 预热后的风控响应，不影响已完成的同指纹实测链路，需单独观察新指纹稳定性。

## 2026-07-24 已注册账号纳入一键验活

- 一键验活候选范围已增加 `registered`；命中封禁邮件后同样标记为 `banned`。
- 仅处理已配置 `email_code_api` 的账号；“查询 Plus 状态”仍只处理 `registered`，未改变。

## 2026-07-24 协议注册日志面板缓存修复

- 已确认队列 API 正常返回当前任务日志；旧版浏览器脚本会把日志误渲染进队列。
- `web/index.html` 已为 `web/app.js` 使用 `protocol-queue-status-only` 版本参数；队列渲染已不再拼接原始 `job.error`，刷新页面后队列只显示状态和顺序，明细只显示在“当前协议注册日志”。

## 2026-07-24 协议注册继承 Roxy 无头配置

- 根因：协议注册准备 CDP 时调用 Roxy `/browser/open` 没有传入启动参数，因此忽略了 `.env` 的 `ROXY_HEADLESS` / `ROXY_KEEP_OPEN`。
- 修复：`ROXY_HEADLESS=true` 强制无头，`false` 强制有头；默认 `auto` 时 `ROXY_KEEP_OPEN=0` 也会无头。服务重启后生效。

## 2026-07-24 补号账号注册 AT 快速复制

- 补号列表的每个邮箱下方新增“复制 AT”。接口仅在管理员登录态下按账号邮箱读取 `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt`，并把纯 token 复制到剪贴板。
- 文件不存在或为空显示“AT 未找到”；不将 token 缓存到页面、列表或数据库。

## 2026-07-23 协议注册单并发队列

- 协议注册已改为仅服务进程内存在的 FIFO 单并发队列；可连续入队，服务关闭后自动清空。
- 新增 `GET` / `DELETE /protocol-registration-queue`；清空仅影响等待任务，不取消当前 Roxy 流程。
- 补号管理页新增队列面板并在账号行显示“注册中/排队中”；队列面板只显示状态和顺序，当前账号的准备步骤、stdout 和 stderr 显示在独立“当前协议注册日志”面板（每任务最多 200 条）。页面每两秒轮询，重启服务后生效。

## 2026-07-23 协议注册随本地服务端口同步

- 根因：Windows TCP 排除范围包含 `13100`，本机服务已配置为 `PORT=13400`；协议注册 Python 子进程仍默认请求 `http://127.0.0.1:13100/login`，在领取账号前报“补号服务后台登录失败”。
- 修复：`buildProtocolRegistrationEnv()` 现在显式注入 `REPLACEMENT_API_BASE`，未配置时由父服务 `PORT` 推导；显式外部地址仍优先。
- 验证：Node 协议注册专项 38/38、tilian Python 邮箱提供方专项 13/13 通过。需要重启 `npm run start:home-proxy` 后再从页面重试。

## 2026-07-21 CPA 临时切换宿主机直连出口

- 已将 VPS-LA 上 `cliproxyapi.service` 的代理环境从 `127.0.0.1:7891` 家宽代理移除，并将 `/opt/cliproxyapi/config.yaml` 顶层 `proxy-url` 设为空，CPA 当前直接使用宿主机默认出口。
- 当前 CPA PID 为 `6694`，服务状态为 `active`；进程无 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`；`/` 返回 `200`，无 API key 的 `/v1/models` 返回 `401`。
- `mihomo.service` 和 `127.0.0.1:7891` 保持运行但不再被 CPA 使用；宿主机直连出口 IP 为 `5.253.38.136`。
- 回滚备份：`/etc/systemd/system/cliproxyapi.service.d/home-proxy.conf.bak-20260721-070307`、`/opt/cliproxyapi/config.yaml.bak-20260721-072159`。恢复两个文件后执行 `sudo systemctl daemon-reload && sudo systemctl restart cliproxyapi.service`。
- 后续切换使用 `scripts/cpa-proxy-toggle.sh`；说明文档为 `docs/project/cpa-proxy-operation.md`。脚本只改 CPA `config.yaml` 并重启 CPA，不触碰 systemd 代理环境或 mihomo。

## 2026-07-20 协议 CPA phone-code 阶段跳过 add-phone 修复

- 根因：`src/auto/protocol_cpa_auth.py` 原先在 `next_stage == "phone-code"` 时跳过 `add-phone/send`，直接等待 SMS。
- 修复：`phone-add`、`phone-verify`、`phone-code` 统一先调用 `add-phone/send`；4xx 继续 SMS，500+ 失败；新增阶段日志。
- 回归：CPA Auth 8/8、CPA replacement 2/2、Python 编译检查通过；issue `docs/issues/issue-019-protocol-cpa-phone-add-request-skipped.md` 已标记 resolved。
- 已用真实管理接口重跑账号 `76`，Run `612`：`mfa/verify` 返回 `next_stage=sign-in-with-chatgpt-codex-consent`，所以本轮没有进入手机阶段，也没有调用 `add-phone/send` 或 SMS；随后在 `accounts/consent` 失败。该结果证明当前账号这轮不是“跳过 add-phone 后等待 SMS”。
- 账号 76 数据库虽有手机号字段，但不等于本轮 Auth 已完成手机号绑定；若要实测 `add-phone/send`，必须使用 MFA 返回 `phone-add`/`phone-code` 的账号状态。

## 2026-07-20 协议注册 2FA 回调 401 排查

- 账号 `162`（`seal-heir.3h@icloud.com`）已在注册阶段取得 `accessToken`，但旧 2FA 分支在 `auth.openai.com/api/accounts/email-otp/validate` 返回 HTTP 401；没有进入 `mfa/enroll`。
- 根因是协议注册仍走 `signin/openai?reauth=password` 的第二次邮箱 OTP 回调；`src/auto/roxy_register_openai.js` 的工作流程是在同一注册态直接执行 `mfa_info -> mfa/enroll -> activate_enrollment -> mfa_info`。
- 已新增 `CHG-092`：协议注册统一由 `setup_2fa()` 直接复用注册后的 `accessToken`，删除 password re-auth 和邮箱 OTP 分支；`main.py` 显式传入 token。
- 回归：协议注册 Python 测试 47/47、语法检查通过；账号 162 不重复重跑，待用新的 `unregistered` 账号做真实验证。
- issue：`docs/issues/issue-018-protocol-registration-mfa-reauth-401.md`，当前仍为 active，表示真实端到端验证尚未完成。

## 2026-07-20 协议补号 consent.data 失败与 Roxy 刷新修复

- 账号 `108` 的一次协议补号已通过登录、TOTP 和手机号阶段，失败点为 `https://auth.openai.com/sign-in-with-chatgpt/codex/consent.data` 的 `non-object JSON`。
- 根因：该接口在部分状态返回 JSON 数组，旧 `response_json()` 只接受对象；`extract_consent_challenge()` 已支持数组但没有被使用。
- 同一运行日志还显示 `ROXY_CDP_ENDPOINT=unset` 且无 `prepare-roxy`，说明运行的是重启前旧 13100 进程。现已重启 `start:home-proxy`，当前 `node src/server.js` PID `31040`，启动时间 `17:29:54`。
- 代码现状：协议补号 spawn 前强制执行 Roxy `close -> clear local -> clear server -> random fingerprint -> open -> connection_info`，子进程复用新 CDP；`consent.data` 支持对象和数组。
- 验证：CPA Python `5/5`、replacement services `37/37`、Node/Python 语法和 `git diff --check` 通过。账号 108 尚未在修复后重跑。

## 2026-07-20 Run 590 账号 111 workspace 401 修复

- Roxy 刷新已生效，Run 590 的 ROXY_CDP_ENDPOINT=set；失败是 workspace/select HTTP 401。
- 账号 111 是 free personal account，历史真实录制显示其 workspace 为 7e2e668c-cd6a-4eb6-9a44-297691e39323；原代码错误复用账号 109 的组织 workspace，并遗漏 x-access-flow-invocation-id。
- 已接入 auth_workspaces：Roxy bridge 从 Auth session cookie 只返回脱敏 workspace 元数据；CPA 选择当前会话中匹配的 workspace，否则优先 personal workspace；workspace/select 补 invocation header。
- 验证：CPA 6/6、Roxy CDP Node 10/10、Roxy bridge Python 23/23 通过。账号 111 尚未在修复后重跑。

## 2026-07-20 协议补号点击无反应排查

- 根因一：`13100` 曾由旧进程提供服务，未加载 `replace-2fa-protocol` 路由；已重启为 PID `33588`（`2026-07-20 16:25:22`）。
- 根因二：前端原先只在同步协议请求完成后显示结果，点击后菜单关闭且无即时反馈；`web/app.js` 已增加“协议补号已启动”操作记录和 toast。
- 验证：`node --test test/replacementAccountsWeb.test.js` 15/15 通过。
- 配置已写入 `.env`：`OPENAI_WORKSPACE_ID` 使用账号 109 既有 Auth 凭证中的账号级 workspace；协议补号、普通补号和 2FA 登录统一使用 Roxy `617-3/test`（同一 `dirId`）。服务已重启，账号 109 已完成 add-phone/SMS，不要重复触发。
- 最近点击的账号 `116` 已实际创建协议补号运行记录 `run_id=582`，但因数据库缺少 `codex_2fa` 在打开 Roxy 前退出；该次旧运行使用的是只有启动 toast 的前端。当前代码已补上协议补号实时日志面板；实际重跑仍需先补齐账号 `116` 的 TOTP/2FA secret，或改用已有 `codex_2fa` 的新测试账号。

## 2026-07-20 协议补号实时日志面板

- `web/index.html` 在补号列表后、协议注册日志前新增“当前协议补号日志”。
- `web/app.js` 的协议补号改用 `Accept: text/event-stream`，并增加独立运行锁、清空、步骤/stdout/stderr/成功/失败状态处理；注册日志状态不复用。
- `src/server.js` 保留普通 JSON 兼容，同时为协议补号 SSE 转发 worker 子进程日志和 account-result/complete/error 事件。
- `src/cpaRepairWorker.js` 通过 `onLog` 转发 CPA 读取、上传、健康复查和最终状态步骤；历史运行日志仍写入 `data/automation-logs/`，历史日志页不变。
- 验证：`replacementAccountsWeb.test.js` 16/16、`replacementAccountsApi.test.js` 36/36、`cpaRepairWorker.test.js` 8/8；`node --check` 和 `git diff --check` 通过。

## 2026-07-20 Gmail-IMAP 协议补号操作

- 工作记录：`docs/work/2026-07-20-protocol-replacement-operation.md`
- change：`docs/changes/CHG-091-protocol-replacement-action.md`，状态 `implemented`。
- 已新增独立 `POST /replacement-accounts/:id/replace-2fa-protocol`，调用 `protocol_cpa_replacement.py` -> `protocol_cpa_auth.py`，成功后沿用 CPA 上传、健康复查和 `cpa_mounted` 状态回写。
- 补号列表操作菜单顺序现在为“协议注册”→“协议补号”→其他操作。
- 注册状态机、普通补号和 DOM 2FA 补号未修改。
- 使用前必须配置真实 `OPENAI_WORKSPACE_ID`；不能使用 Roxy workspace `111070`。不要重复测试已完成过 add-phone/SMS 的账号 109。

## 2026-07-20 独立 CPA 2FA 补号协议真实测试

- 来源工作日志：`docs/work/2026-07-20-standalone-cpa-auth-test.md`
- change：`docs/changes/CHG-089-standalone-cpa-2fa-auth-protocol.md`、`docs/changes/CHG-090-roxy-2fa-authorize-url-match.md`，均为 `implemented`，尚未合并到 PRD。
- 当前进展：当前目标仍是先调通账号 109 的既有 2FA 补号；不修改注册状态机。Roxy 2FA runner 已与 `oauth_login.js` 复用同形态的完整 `https://auth.openai.com/oauth/authorize?...` URL，不使用 Auth 根页，也不追加 `prompt=login`。Roxy 用户指定窗口为 `3/test`（617-3），`dirId=4c83715f6713db30c9baf9bfbc5086d3`。
- 自动验证：关联 Node 回归（2FA runner、OAuth runner、CPA worker、replacement services）136/136、注册协议 Python 42/42、CPA 5/5 通过；语法检查和 `git diff --check` 通过。默认 `npm test` 的唯一失败是未启动本地服务的独立 smoke test，不属于本次改动。
- 实机进展：已在已打开的 `617-3 / 3/test` CDP 上用生产 runner 复跑；目标 `prompt=login=false`，选择账号延迟跳转守卫生效，`workspace/select` 和 `oauth/token` 均 HTTP 200，runner 返回 `oauth-completed`，账号 109 CPA/sub2api 文件存在且 CPA 三类 token 字段非空。此前干净流程已完成 password、TOTP、phone-add、SMS、phone-otp、Codex、callback 和 token exchange。
- 当前边界：账号 109 的生产 `cpaRepairWorker.repair` 代码路径已验证完成，CPA 上传、`active` 健康复查和数据库 `cpa_mounted` 回写均成功；本次未额外通过 HTTP 管理页面触发。不要把 Roxy workspace `111070` 当作 OpenAI workspace ID，也不要把注册状态机接入 CPA 协议，不要重复触发已完成的 add-phone。

## 2026-07-17 补号列表协议注册操作

- 来源工作日志：`docs/work/2026-07-17-replacement-protocol-registration.md`
- change：`docs/changes/CHG-087-replacement-protocol-registration-action.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号列表操作菜单已增加“协议注册”；后端新增 `POST /replacement-accounts/:id/register-protocol`，按当前行账号刷新 Roxy `3/test` profile 后启动 `tilian` 协议项目单次注册，并通过 `REPLACEMENT_ACCOUNT_ID` 固定邮箱。成功取得 access token 后以纯文本写入 `src/auto/product_files/registration/<email>.txt`，共享 profile 使用 single-flight，失败只记录操作错误，不改变业务状态。
- 验证：Node 全量 370/370、Python 全量 37/37 通过；`13100` 服务正在监听，账号查询正常。
- 实机结果：账号 `178` 已进入 OpenAI OTP 阶段，但其外部 `email_code_api` 从 Windows 和 Roxy 页面上下文均超时，账号保持 `unregistered`。详见 `docs/issues/issue-015-replacement-protocol-email-api-unreachable.md` 和 `data/automation-logs/protocol-registration-178-2026-07-17T07-48-18-539Z.log`。
- 下一步：确认账号邮箱 API 可达或更换可用 `email_code_api` 后，使用共享 Roxy `3/test` profile 单线程重新执行一次真实流程；不要并行触发。

## 2026-07-17 Roxy OAuth 邮箱验证码协议提交

- 来源工作日志：`docs/work/2026-07-17-roxy-email-otp-protocol.md`
- change：`docs/changes/CHG-086-roxy-email-otp-protocol-submit.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增可选 `ROXY_EMAIL_OTP_PROTOCOL=1`；邮箱验证码在同一 Roxy 页面上下文 POST 验证，成功后处理 `continue_url`；HTTP 4xx 不再重复提交 DOM，页面上下文不可用或网络异常时回退旧流程。
- 验证：OAuth、2FA OAuth、2FA ChatGPT session 测试合计 107/107 通过；语法检查和 `git diff --check` 通过。
- 使用：在 `.env` 中设置 `ROXY_EMAIL_OTP_PROTOCOL=1` 后运行 OAuth/2FA OAuth 流程；未设置或为 `0` 时保持原 DOM 流程。

## 2026-07-16 补号操作失败不占用账号状态

- 来源工作日志：`docs/work/2026-07-16-replacement-operation-failure-display.md`
- change：`docs/changes/CHG-085-replacement-operation-failure-not-status.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：历史 `failed` 账号统一迁移为 `banned`；补号、2FA 补号、注册、Plus 查询和一键验活失败时保留业务状态，状态旁显示简短红色操作失败提示，不新增数据库字段。
- 迁移记录：原始 `failed` 行为账号 ID `4`、`17`、`22`、`46`、`64`、`65`、`66`、`76`。
- 验证：专项测试、全量 JavaScript 测试、语法检查和 `git diff --check` 已通过；13100 服务已重启并确认数据库无原始 `status='failed'`。

## 2026-07-16 Roxy run 511 OTP 终态消费与注册实机验收

- 来源工作日志：`docs/work/2026-07-16-roxy-run-511-otp-completion-and-e2e.md`
- change：`docs/changes/CHG-084-roxy-about-you-otp-state-guard.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-014-roxy-about-you-age-misclassified-as-otp.md`，状态 `resolved`。
- 当前进展：run `510` 暴露了前置 OTP 等待未消费 `OTP_ALREADY_COMPLETED` 的遗漏；已新增 `waitForOtpStageOrCompleted()`，主流程在已到 profile/session 时跳过重复 OTP 并继续资料页。
- 实机验证：run `511` 成功完成 `/about-you`、ChatGPT 主站、Session 和 MFA，账号 `105` 状态为 `registered`；Roxy 保持打开并已回到 ChatGPT 主页面。
- 自动验证：`node --test test/roxyRegisterOpenai.test.js` 32/32；`node --check src/auto/roxy_register_openai.js` 和 `git diff --check` 通过。
- 运行日志：`data/automation-logs/registration-105-2026-07-16T04-00-03-559Z.log`。

## 2026-07-16 Roxy run 508 OTP/资料页误判修复

- 来源工作日志：`docs/work/2026-07-16-roxy-run-508-otp-age-misclassification.md`
- change：`docs/changes/CHG-084-roxy-about-you-otp-state-guard.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-014-roxy-about-you-age-misclassified-as-otp.md`，状态 `resolved`。
- 当前进展：run `508` 已完成邮箱验证码后进入 `/about-you`，旧状态机把 Age 的 `inputmode=numeric` 当成 OTP；现已收紧 OTP 语义、优先识别 profile，并在 OTP 等待/填码前增加终态短路。后续 run `510` 又发现主流程未消费终态信号，已由 run `511` 修复并完成实机验收。
- 验证：`node --test test/roxyRegisterOpenai.test.js` 32/32 通过；run `511` 已成功注册 account `105`。

## 2026-07-16 Roxy run 507 注册失败诊断

- 来源工作日志：`docs/work/2026-07-16-roxy-run-507-diagnosis.md`
- issue：`docs/issues/issue-013-roxy-registration-password-click-detached.md`，状态 `resolved`。
- 当前进展：已连接用户保留的 Roxy `gpt` 窗口。确认 run `507` 是 account `105` 的注册流程，不是 `roxy_2fa_login.js`；`humanClick()` 已改用 Locator，密码提交前后增加阶段复查。
- 实机验证：手动 `Resend email` 后提交新验证码，页面已进入 `https://auth.openai.com/about-you`；未关闭 Roxy。
- 自动验证：`node --test test/roxyRegisterOpenai.test.js` 29/29、相关 `node --check` 和 `git diff --check` 通过。

## 2026-07-15 补号状态查询邮箱 API 日志映射修正

- 来源工作日志：`docs/work/2026-07-15-replacement-status-api-log-mapping.md`
- 关联 change：`docs/changes/CHG-080-replacement-status-email-api-source.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已确认 `roll-happier-6@icloud.com` 的数据库值为 `http://5.253.38.136:8080/code?email=roll-happier-6@icloud.com`，实际请求使用该完整 URL；此前日志的 `displayEmailApi()` 只隐藏 query，造成窗口看起来像未按账号查询。现在 Plus/验活日志显示脱敏后的接口基址并追加“账号邮箱”，不泄露 query 中的其他参数。
- 验证：真实数据库行读取和注入 `fetch` 请求探针均确认完整 URL；RED 阶段两条进度日志回归测试按预期失败，修复后专项测试 12/12、全量测试 353/353 通过；`13100` 已重启为 PID `27696`，`GET /login` 返回 200。
- 下一步：在 `/replacement-ui` 再点击“一键验活”或“查询 Plus 状态”，应看到 `正在读取邮箱 API：.../code（账号邮箱：当前账号）`；没有 `email_code_api` 的账号仍应显示跳过。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD-003 基线合并。

## 2026-07-15 Roxy 2FA ChatGPT session 状态判定加固

- 来源工作日志：`docs/work/2026-07-15-roxy-2fa-session-state-guard.md`
- change：`docs/changes/CHG-082-roxy-2fa-session-state-guard.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-012-roxy-2fa-session-state-guard.md`，状态 `resolved`。
- 当前进展：`src/auto/roxy_2fa_login.js` 已增加阶段等待最终复查、控件 visible/enabled/editable 守卫、严格 ChatGPT callback origin/path；page 有 `evaluate` 时 session 空响应不再导航可视页面。
- 验证：`node --test test/roxy2FALogin.test.js` 通过 13/13；相关 `node --check` 和 `git diff --check` 通过。
- 下一步：重新触发 `login-2fa` 做真实 Roxy 端到端验证，确认 `chatgpt-entry -> openai-email -> openai-password -> openai-mfa -> chatgpt-home`。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD-003 基线合并。

## 2026-07-14 Roxy 2FA 邮箱提交后阶段判定竞态修复

- 来源工作日志：`docs/work/2026-07-14-roxy-2fa-stage-detection-guard.md`
- change：`docs/changes/CHG-081-roxy-2fa-post-email-stage-guard.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-011-roxy-2fa-post-email-stage-race.md`，状态 `resolved`。
- 当前进展：2FA OAuth 在邮箱提交、password 提交和 MFA 提交后的等待窗口结束时增加最终即时阶段复查；password/MFA 输入框必须可见且 enabled/editable；未知状态会把 URL、标题和截断页面摘要写入运行日志。
- 根因证据：run `465` 失败后 Roxy 页面实际位于 `https://auth.openai.com/log-in/password`，旧状态机因错过最后一次渲染把可用 password 页判定为 `unknown`。
- 验证：`node --test test/roxy2FAAuthLogin.test.js` 通过 13/13；全量 `node --test test/*.test.js` 通过 346/346；相关 `node --check` 和 `git diff --check` 通过。
- 下一步：重新触发一个 2FA 补号，确认日志出现 `识别到 OpenAI 密码登录页` 并继续到 MFA/Codex/callback。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD-003 基线合并。

## 2026-07-14 补号状态检查使用账号邮箱 API

- 来源工作日志：`docs/work/2026-07-14-replacement-status-email-api-source.md`
- change：`docs/changes/CHG-080-replacement-status-email-api-source.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：Plus 状态查询和一键验活现在只使用每个补号账号自己的 `email_code_api`。没有配置 API 的账号直接跳过，不读取 IMAP、`ICLOUD_CODE_GMAIL_ACCOUNT` 或其他共享收件箱；API 请求失败或只返回验证码时计入失败且不回退。
- 验证：真实 `/code?email=...` 接口已确认返回完整邮件并命中 Plus 文案；共享 API 归一化、Plus/验活服务、JSON/SSE API 测试已通过。全量 JavaScript 测试 `node --test test/*.test.js` 通过 344/344；相关 `node --check` 和 `git diff --check` 通过；`13100` 已重启，当前 PID `42440`。
- 下一步：在 `/replacement-ui` 点击两个按钮确认日志显示对应账号 API 和跳过信息；没有 `email_code_api` 的账号应显示跳过，不应出现 IMAP 收件箱日志。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-14 补号状态查询实时进度窗口

- 来源工作日志：`docs/work/2026-07-14-replacement-healthcheck-progress-window.md`
- change：`docs/changes/CHG-079-replacement-healthcheck-progress-window.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：一键验活和查询 Plus 状态现在支持 SSE 实时进度；页面点击后立即打开“执行进度”窗口，逐个输出开始查询、读取邮箱 API、跳过、命中/未命中/失败，完成后保留汇总。原有 JSON API 保持兼容。Plus 命中仍更新为 `plus_active`，封禁命中仍更新为 `banned`。
- 验证：服务进度事件测试、API JSON/SSE 测试和前端静态测试已通过；全量 JavaScript 测试 `node --test test/*.test.js` 通过 340/340；相关 `node --check` 和 `git diff --check` 通过。
- 风险：关闭进度窗口不会取消后端任务；状态检查现在依赖账号自己的 `email_code_api` 返回完整邮件。
- 下一步：重启正在运行的 13100 服务后，在页面点击两个按钮验证实时日志。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-14 补号账号 Plus 状态查询

- 来源工作日志：`docs/work/2026-07-14-replacement-plus-status-check.md`
- change：`docs/changes/CHG-078-replacement-plus-status-check.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增 `POST /replacement-accounts/check-plus-status` 和 `src/replacementPlusStatusService.js`，只查询 `registered` 且配置邮箱 API 的账号；同时匹配 `You've successfully subscribed to ChatGPT Plus`、`ChatGPT Plus Subscription`、`The OpenAI Team`，命中后更新为 `plus_active`。未命中保持 `registered`，无 API 的账号跳过，失败保持 `registered` 并记录 `last_error`。补号管理页新增“查询 Plus 状态”按钮。
- 验证：Plus 状态专项、仓储、API、前端组合测试通过 78/78；全量 JavaScript 测试 `node --test test/*.test.js` 通过 337/337；相关 JS `node --check` 和 `git diff --check` 通过。
- 风险：真实查询依赖每个账号的 `email_code_api` 返回完整订阅邮件；只返回 6 位验证码的接口不能用于状态判断。
- 下一步：重启正在运行的 13100 服务后，在 `http://localhost:13100/replacement-ui` 点击“查询 Plus 状态”做真实邮箱验收。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-14 补号账号开通方式下拉与页面维护

- 来源工作日志：`docs/work/2026-07-14-replacement-activation-method.md`
- change：`docs/changes/CHG-077-replacement-activation-method-catalog.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已新增 `replacement_activation_methods` 目录表和 6 个初始方式（越南直卡、`upi`、`ideal`、波兰、瑞士、`pix 直卡`）；补号列表开通方式已改为行内下拉，调用 `PATCH /replacement-accounts/:id/activation-method` 保存；“管理开通方式”弹窗可通过 `POST /replacement-activation-methods` 新增方式；历史目录外值以“历史值”保留。API 文档、设计文档和实施计划已同步。
- 验证：专项测试通过 74/74；全部 JavaScript 测试通过 330/330；`node --check` 和 `git diff --check` 通过；重启 `13100` 服务后认证接口返回 6 个初始方式，`/replacement-ui` 页面模板包含新控件。`npm test` 仅因额外脚本 `test/test-verification-code.mjs` 连接未启动的 `localhost:3100` 而出现 `ECONNREFUSED`。
- 下一步：代码实现和文档已完成；如需视觉/点击级验收，打开可用浏览器访问 `http://localhost:13100/replacement-ui`，验证下拉修改、新增方式、刷新持久化和状态下拉回归。当前 in-app browser 不可用，已完成认证 HTTP 级运行态验证。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-10 补号账号一键封禁邮件验活

- 来源工作日志：`docs/work/2026-07-10-banned-email-healthcheck-button.md`
- change：`docs/changes/CHG-076-banned-email-healthcheck-button.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号管理页已新增“一键验活”按钮；后端新增 `POST /replacement-accounts/healthcheck-banned`。接口只检测 `plus_active`、`cpa_mounted`、`for_sale`、`sold` 且配置邮箱 API 的账号；没有 API 的账号跳过。邮件同时包含目标邮箱和 ChatGPT deactivation 稳定文案时，账号自动标记为 `banned`，状态备注写入“一键验活检测到 ChatGPT deactivation 邮件”。
- 验证：`node --test test\accountHealthcheckService.test.js` 通过 3/3；`node --test test\replacementAccountsApi.test.js` 通过 22/22；`node --test test\replacementAccountsWeb.test.js` 通过 12/12。
- 待办：用真实后台点击“一键验活”做一次人工验收；当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-07 短信 API Roxy 浏览器兜底

- 来源工作日志：`docs/work/2026-07-07-sms-api-roxy-browser-fallback.md`
- change：`docs/changes/CHG-075-sms-api-roxy-browser-fallback.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-010-sms-api-direct-request-region-restricted.md`，状态 `resolved`。
- 当前进展：已确认 run `433` 不是 OpenAI 未发短信，也不是短信平台未收到。直连同一短信 API 时，Node 默认请求、Chrome UA 请求、API Accept 请求均返回 `访问受限 / Access Restricted` HTML；当前 Roxy `mac` 真实浏览器新标签导航同一 URL 返回短信 JSON，包含 `isReceived=yes` 和 6 位 OpenAI 验证码。因此根因是自动化子进程直连出口被短信平台地区限制，Roxy 浏览器出口可访问。
- 修复：`fetchPhoneVerificationCodeOnce()` 现在检测访问受限 HTML；当前有 Roxy Playwright `page` 时，会新开 Roxy 浏览器临时页导航短信 API 读取响应并关闭临时页。验证码解析跳过 `<style>` 和 CSS 色值，避免把访问受限页的颜色值误当验证码。`openAi_phone_add()` 和 `openAi_phone_code()` 已传入当前 page，让发送前旧码快照和后续轮询都可走 Roxy browser fallback。
- 验证：新增 fallback 回归测试先失败于 `OPENAI_PHONE_CODE_ACCESS_RESTRICTED`；修复后 `node --test test\roxyOauthLogin.test.js` 通过，78/78；`node --test test\roxy2FAAuthLogin.test.js` 通过，11/11；`node --check src\auto\roxy_oauth_login.js` 和 `git diff --check` 通过。实机连接当前 Roxy CDP，仅调用短信读取函数，已通过 Roxy browser fallback 读取到 6 位验证码，未提交 OpenAI 表单。
- 待办：原 run 已失败，当前 OpenAI 页仍在手机验证码页。可重新触发 account `78` 的 `2FA补号`，确认手机验证码阶段继续到 Codex/callback。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-07 Roxy Codex 页脚密码页误判防护

- 来源工作日志：`docs/work/2026-07-07-roxy-codex-footer-password-guard.md`
- change：`docs/changes/CHG-074-roxy-codex-footer-password-guard.md`，状态 `implemented`，尚未合并到 PRD。
- issue：`docs/issues/issue-009-roxy-codex-footer-password-misclassification.md`，状态 `resolved`。
- 当前进展：已连接用户保留的 Roxy `mac` 窗口确认实时页面是 `https://auth.openai.com/log-in/password`，密码输入框可见且可用。根因为 OpenAI password 页页脚含 `ChatGPT` / `Codex` 文案，旧 `is_codex_login_page()` 只看 Codex、ChatGPT 和 Continue，误判为 Codex consent，导致 2FA 补号没进入密码填写。现在 Codex consent 判定会显式排除 password 页，并要求 `sign in to codex` / `continue to codex` / `authorize codex` 这类授权确认语义。
- 验证：新增回归测试先失败于 `true !== false`；修复后 `node --test test\roxyOauthLogin.test.js` 通过，76/76；`node --test test\roxy2FAAuthLogin.test.js` 通过，11/11；`node --check src\auto\roxy_oauth_login.js` 通过。当前 Roxy password 页实机复检 `is_codex_login_page=false`，2FA 专用 `is_openai_password_page=true`。
- 待办：原失败子进程已退出，需重新触发 `2FA补号` 让新子进程加载修复并验证 account `78` 或同类账号的完整链路。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-07 Roxy 2FA 登录阶段识别修复

- 来源工作日志：`docs/work/2026-07-07-roxy-2fa-login-stage-detection.md`
- change：`docs/changes/CHG-062-roxy-2fa-chatgpt-session-login.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：修复 `src/auto/roxy_2fa_login.js` 把 ChatGPT 游客首页误判为已登录的问题。现在只有页面内请求 `/api/auth/session` 返回 `accessToken` 才判定 `chatgpt-home`；有 `Log in` 按钮时优先判定 `chatgpt-entry`。多个 `Log in` 按钮时点击第一个可见按钮。每次页面动作完成后都会日志记录 `动作后阶段识别 from=... stage=... url=...`。`fetchChatGptSession()` 现在优先页面内 `fetch()`，不再把可视页面导航到 `/api/auth/session`。
- 验证：`node --test test\roxy2FALogin.test.js` 通过，6/6；`node --test test\roxy2FALogin.test.js test\replacementServices.test.js` 通过，31/31；`node --check src\auto\roxy_2fa_login.js` 通过。实机 account `75` 的 `login-2fa` run `431` 成功，最终 Roxy 页面保持在 `https://chatgpt.com/`。
- 待办：实机日志中仍出现一次 `openai-password -> unknown` 后重试密码并成功进入 MFA；若后续频繁出现，可继续调长 password 后阶段等待窗口或增加提交成功判定。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-07 浏览器自动化状态判定规则

- 来源工作日志：`docs/work/2026-07-07-browser-automation-state-rule.md`
- change：`docs/changes/CHG-073-browser-automation-state-judgment-rule.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已把本次 OTP 错码误判和 disabled/detached password input 误判沉淀到 `AGENTS.md` 的 `0.1 浏览器自动化状态判定规则`。后续处理 Roxy/OpenAI/ChatGPT 自动化时，提交后必须按阶段状态机分类页面；操作输入框前必须检查可见、`isEnabled()`、disabled/readOnly/aria-disabled/inert/stale 条件；当前浏览器页面和截图优先于代码预期。
- 同步记录：`.learnings/LEARNINGS.md` 新增 `LRN-20260707-001` 并标记已推广到 `AGENTS.md`。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-07 注册 OTP 提交后状态判定守卫

- 来源工作日志：`docs/work/2026-07-07-registration-otp-submit-state-guard.md`
- change：`docs/changes/CHG-072-registration-otp-submit-state-guard.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：定位 run `418`、`419` 的失败根因：OTP 提交后通用 Continue 点击函数把 `formGone` 当作成功，但 OTP 页本来没有 `input[type="email"]`，导致错误验证码未等到 `Incorrect code` 就进入 Step 6。现在新增 `waitForOtpSubmitResult()`，只有进入 `/about-you`、资料页、`chatgpt.com` 或主站 session 才算 OTP 成功；检测到 `Incorrect code` 会排除旧码并继续下一轮轮询；长时间仍停在 OTP 页会明确报“邮箱验证码提交后未进入下一阶段”。追加排查 run `421` 后确认当前 Roxy 页面实际已经在 `email-verification` Code 输入页，失败原因是前一瞬间的 password input 过渡 DOM 被当成可填写密码页，但 Playwright 判定该元素 `not enabled`；`findVisiblePasswordSelector()` 现已要求 `isEnabled()` 为真并排除 disabled/inert 容器。
- 验证：新增回归测试先失败于返回第一次错误验证码；追加 disabled password input 回归测试先失败于返回 `input[type="password"]`；修复后 `node --test .\test\roxyRegisterOpenai.test.js` 通过，28/28；`node --check .\src\auto\roxy_register_openai.js` 和 `git diff --check` 通过。
- 待办：下一次真实注册时观察错码后是否继续出现第二轮 `email-code-request`，并确认不再从 `email-verification` 误入 Step 6。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-04 注册密码页到 OTP 页跳转竞态防护

- 来源工作日志：`docs/work/2026-07-04-registration-password-to-otp-race.md`
- change：`docs/changes/CHG-071-registration-password-to-otp-race.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：run `372` 的失败截图和当前 Roxy 浏览器均显示页面已在 `https://auth.openai.com/email-verification` OTP 输入页。根因是 OTP 等待阶段刚判断页面像密码页并进入重填密码分支，但 `submitRegistrationPassword()` 的人类化延迟期间页面已自动跳到 OTP 页，随后密码页就绪检查抛出“密码页未就绪”。现在 `submitRegistrationPassword()` 在密码页就绪失败时会复检 OTP 输入框；若 OTP 已可用，则记录“密码页已自动进入邮箱验证码页，跳过重复填写密码”并返回成功，交回外层继续验证码流程。
- 验证：新增回归测试先失败于同一错误；修复后 `node --test test\roxyRegisterOpenai.test.js` 通过，26/26；`node --check src\auto\roxy_register_openai.js` 通过。
- 待办：run `372` 原子进程已退出，不能自动续跑；下一次重新触发注册时新子进程会加载修复。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-04 注册 OTP 等待窗口按阶段重置

- 来源工作日志：`docs/work/2026-07-04-registration-otp-wait-window-reset.md`
- change：`docs/changes/CHG-070-registration-otp-wait-window-reset.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：修复 OpenAI 超时恢复后 OTP 等待仍沿用旧 deadline 的问题。`waitForOtpInputReady()` 现在使用可重置等待窗口：超时恢复后若回到密码页并重新提交密码，会重置 OTP 等待窗口；初始 OTP 等待阶段即使 `recoverPasswordPage=false`，如果密码页稳定停留超过防抖时间，也会重新提交密码并重置等待窗口。日志新增 `已重置验证码页等待窗口 reason=... timeoutMs=...`。
- 验证：`node --test test\roxyRegisterOpenai.test.js` 通过，25/25；`node --check src\auto\roxy_register_openai.js` 通过；`node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，71/71；`git diff --check` 通过。
- 待办：下次实机注册遇到 OpenAI 超时页时，观察是否出现 `reason=timeout-recovery-returned-password-page` 的等待窗口重置日志，并确认随后能继续进入 OTP 页再拉取邮箱验证码。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-04 注册成功状态与新增默认状态

- 来源工作日志：`docs/work/2026-07-04-registration-status-registered.md`
- change：`docs/changes/CHG-069-registration-status-registered.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号账号新增业务状态 `registered`，前端显示“已注册”。`createAccount()` 和新库表默认状态已从 `for_sale` 改为 `unregistered`；`POST /replacement-accounts/:id/register` 注册成功后调用 `markRegistrationSuccess()`，统一写入 `status=registered`、`codex_2fa` 和 `status_updated_at`。前端状态筛选、行内下拉、编辑弹窗和图例均已加入“已注册”。
- 验证：`node --test test\replacementAccounts.test.js` 通过，32/32；`node --test test\replacementAccountsApi.test.js` 通过，21/21；`node --test test\replacementAccountsWeb.test.js` 通过，12/12。
- 数据修正：本次按当前调试上下文把已注册成功的 account `60` 补写为 `registered`；旧数据不做批量迁移。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-04 注册入口直连 Auth 兜底

- 来源工作日志：`docs/work/2026-07-04-registration-direct-auth-fallback.md`
- change：`docs/changes/CHG-068-registration-direct-auth-fallback.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：最新实机失败并不是邮箱 API 第一时间接不到码，而是 account `60` 在 ChatGPT 邮箱 modal 提交后，`/api/auth/signin/openai?...login_hint=...` 返回 403 HTML，页面停在邮箱输入 loading，旧逻辑误入 OTP 等待。`src/auto/roxy_register_openai.js` 已新增 `prepareDirectAuthEmailEntry()`：邮箱提交后仍是 `state=email-entry` 且在 `chatgpt.com` 时，切换到 `https://auth.openai.com/log-in` 直连登录页重新提交邮箱；兜底后仍未知则明确报入口阶段错误。OTP 预等待阶段的超时恢复也已调整：如果尚未拉验证码且恢复回密码页并重新提交密码，继续确认页面状态，不再抛内部 `OTP_REFETCH_AFTER_RECOVERY`。
- 验证：`node --check src\auto\roxy_register_openai.js` 通过；`node --test test\roxyRegisterOpenai.test.js` 通过，23/23；实机 run `359` / account `60` 注册成功，第一次邮箱验证码失败后继续轮询并提交第二次验证码，注册后自动启用 2FA，`replacement_accounts.codex_2fa` 已写入（长度 32，未输出 secret）。
- 注意：不要打开或粘贴 `/api/auth/session` 原始内容，其中包含 access token/session token。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 注册 OTP 阶段密码页误判防护

- 来源工作日志：`docs/work/2026-07-03-registration-password-stale-page-guard.md`
- change：`docs/changes/CHG-067-registration-password-stale-page-guard.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：run `354` 的失败根因为密码提交后导航到 OTP 页期间，旧 DOM 中短暂存在的 `input[name="new-password"]` 被误判为“OTP 阶段回到了创建密码页”，导致重复提交数据库密码；第三次尝试时页面已是 `https://auth.openai.com/email-verification`，所以 `page.type()` 等不到 `new-password`。run `355` 又确认页面实际停在 `https://auth.openai.com/log-in/password`，旧逻辑只识别 `create-account/password`，因此跳过登录密码页并错误进入 OTP 轮询。
- 修复：新增 `classifyRegistrationPage()` 统一识别邮箱输入、创建密码、登录密码、密码错误、邮箱验证但密码未提交、OTP、人机、超时、连接关闭、已注册、资料页、ChatGPT session、unknown。`detectNextRegistrationStep()` 和 `waitForOtpInputReady()` 优先走统一状态分类。`log-in/password` 和 `create-account/password` 都纳入 password gate。`submitOtpWithRetry()` 改为先确认 OTP 输入框，再 fetch 邮箱验证码，避免密码页提前消耗验证码。`waitForOtpInputReady()` 在初次密码提交后的预等待阶段禁用自动重填密码；遇到 `Incorrect email address or password` 直接报 `password-error`。`submitRegistrationPassword()` 改为先清空输入框再输入数据库密码，并仅日志记录密码长度和短 SHA-256 指纹，不输出明文。
- 验证：`node --check src\auto\roxy_register_openai.js` 通过；`node --test test\roxyRegisterOpenai.test.js` 通过，22/22；`node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，68/68；`git diff --check` 通过。实机 account `57` 确认脚本先填数据库密码、不提前拉邮箱验证码；OpenAI 返回密码错误后失败退出，不再循环重复填写密码，页面密码框已清空。
- 待办：本次只改注册子进程脚本，下一次注册自动化 spawn 新进程时会读取当前文件；用下一个未注册且数据库密码正确的真实账号验证 `log-in/password` / `create-account/password` 都会先填数据库密码，之后才拉取/提交邮箱验证码。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 注册超时恢复兼容回到密码页

- 来源工作日志：`docs/work/2026-07-03-registration-timeout-recovery-password-page.md`
- change：`docs/changes/CHG-066-registration-timeout-recovery-password-page.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：run `351` 的失败根因为 OpenAI 超时页点击“重试”后回到 `Create a password`，旧 OTP 兜底 selector 误命中只读邮箱文本框并 `fill()` 超时。`src/auto/roxy_register_openai.js` 已改为 OTP 输入框必须可编辑且像 code/OTP 字段；OTP 阶段若回到密码页，会重新填写数据库密码并提交，已获取验证码作废并重新轮询新码。
- 验证：`node --test test\roxyRegisterOpenai.test.js` 通过，13/13。
- 待办：重启当前 `node src/server.js` 后新注册子进程加载修复；用下一个未注册真实账号验证超时恢复后不会再误填只读邮箱输入框。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 2FA补号接入 CPA 上传复查链路

- 来源工作日志：`docs/work/2026-07-03-replace-2fa-cpa-upload-chain.md`
- change：`docs/changes/CHG-065-replace-2fa-cpa-upload-chain.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：`POST /replacement-accounts/:id/replace-2fa` 在生产注入 `cpaRepairWorker` 时已改走 `repair({ account, source: 'manual', mode: '2fa' })`。worker 会先调用 `replacementServices.replaceAccountWith2FA()` 生成本地 CPA JSON，再上传 `codex-<email>-plus.json`，复查 CPA auth file 健康后才标记账号为 `cpa_mounted`。未注入 worker 时仍保留直接 2FA 自动化 fallback。
- 验证：`node --test test\cpaRepairWorker.test.js` 通过 6/6；`node --test test\replacementAccountsApi.test.js` 通过 21/21；`node --test test\cpaRepairWorker.test.js test\replacementAccountsApi.test.js test\replacementServices.test.js` 通过 52/52；`node --check src\cpaRepairWorker.js`、`node --check src\server.js`、`git diff --check` 均通过。
- 待办：重启当前 `node src/server.js` 后新 `replace-2fa` 路由逻辑生效；可用真实账号从 UI 点击“2FA补号”做端到端验证。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 自动化动作级 Roxy 窗口配置

- 来源工作日志：`docs/work/2026-07-03-action-specific-roxy-browser-targets.md`
- change：`docs/changes/CHG-064-action-specific-roxy-browser-targets.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：`src/replacementServices.js` 已支持注册、普通补号、2FA 补号、2FA 登录分别使用动作级 Roxy 窗口变量。动作级窗口变量存在时会覆盖全局 `ROXY_BROWSER_*`，并在未配置动作级 CDP 时清除全局 `ROXY_CDP_ENDPOINT`，避免所有动作误复用同一窗口。
- 推荐配置：`ROXY_REGISTER_BROWSER_SORT_NUM`、`ROXY_2FA_LOGIN_BROWSER_SORT_NUM`、`ROXY_REPLACE_BROWSER_SORT_NUM`、`ROXY_REPLACE_2FA_BROWSER_SORT_NUM` 分别填不同 Roxy SN。
- 验证：`node --test test\replacementServices.test.js` 通过 25/25。
- 待办：重启当前 `node src/server.js` 后新配置映射才会在 UI 触发的子进程中生效。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 补号操作菜单新增 2FA 登录入口

- 来源工作日志：`docs/work/2026-07-03-replacement-2fa-login-action.md`
- change：`docs/changes/CHG-063-replacement-2fa-login-action.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号管理页“操作⌄”菜单已新增 `2FA登录`，前端调用 `POST /replacement-accounts/:id/login-2fa`。后端新增路由并调用 `replacementServices.loginAccountWith2FA(account)`，子进程运行 `src/auto/roxy_2fa_login.js`，注入 `ROXY_2FA_EMAIL`、`ROXY_OAUTH_EMAIL`、`ROXY_OAUTH_PASSWORD` 以及 `ROXY_OAUTH_2FA_CODE` 或 `ROXY_OAUTH_TOTP_SECRET`。该操作不写补号成功状态、不增加补号次数；现有 `2FA补号` 保持原 Codex OAuth 补号链路不变。
- 验证：`node --test test\replacementServices.test.js` 通过 24/24；`node --test test\replacementAccountsApi.test.js` 通过 19/19；`node --test test\replacementAccountsWeb.test.js` 通过 12/12；`node --test test\roxy2FALogin.test.js` 通过 3/3；`node --check src\replacementServices.js`、`node --check src\server.js`、`node --check web\app.js` 均通过。
- 待办：重启当前 `node src/server.js` 后新入口生效；可选用真实账号从 UI 点击 `2FA登录` 做端到端验证。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 Roxy 2FA ChatGPT session 登录脚本

- 来源工作日志：`docs/work/2026-07-03-roxy-2fa-chatgpt-session-login.md`
- change：`docs/changes/CHG-062-roxy-2fa-chatgpt-session-login.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已基于 Roxy profile `gpt`、SN `617-8` 的手动录制确认真实路径为 ChatGPT session 登录：`chatgpt.com` 入口 -> OpenAI password -> MFA challenge -> `chatgpt.com/api/auth/callback/openai` -> `chatgpt.com/`。新增独立 `src/auto/roxy_2fa_login.js`，不走 Codex OAuth authorize，也不进入手机号接码；登录成功后请求 `/api/auth/session` 并保存 access token 到 `src/auto/product_files/2fa_login/`。
- 验证：`node --test test\roxy2FALogin.test.js` 通过 3/3；`node --test test\roxy2FAAuthLogin.test.js` 通过 11/11；`node --test test\roxyRegisterOpenai.test.js` 通过 11/11；`node --test test\roxyOauthLogin.test.js` 通过 75/75。
- 待办：如需实机运行，配置 `ROXY_2FA_EMAIL` 或 `ROXY_OAUTH_EMAIL`、`ROXY_OAUTH_PASSWORD`、`ROXY_OAUTH_2FA_CODE` 或 `ROXY_OAUTH_TOTP_SECRET` 后执行 `node src\auto\roxy_2fa_login.js`。
- PRD 合并提醒：当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 Roxy 注册入口 modal 与窗口大小

- 来源工作日志：`docs/work/2026-07-03-roxy-registration-entry-modal-and-window-size.md`
- change：`docs/changes/CHG-060-roxy-registration-entry-modal-and-window-size.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已连接当前 Roxy 窗口确认失败根因不是页面没加载，而是 `https://chatgpt.com/` 已打开 `Log in or sign up` 邮箱 modal，旧注册脚本仍强依赖查找登录/注册入口按钮。`src/auto/roxy_register_openai.js` 新增 `prepareChatGptEmailEntry()`，当前页已有邮箱输入框时直接继续填写邮箱；未出现邮箱输入框时优先点击 `Log in`，再回退 `Sign up`。主注册入口和超时恢复入口均已复用该逻辑。`src/auto/roxy_oauth_login.js` 开窗参数默认增加 `--window-size=2048,1152`，并支持 `ROXY_WINDOW_WIDTH` / `ROXY_WINDOW_HEIGHT` / `ROXY_WINDOW_SIZE` 覆盖。实机发现 Chrome args 会被 Roxy profile 覆盖后，又在 `src/auto/roxy-browser-client.cjs` 新增 `updateBrowserConfig()`，开窗前写入 `fingerInfo.openWidth/openHeight`。
- 验证：`node --test test\roxyRegisterOpenai.test.js test\roxyOauthLogin.test.js` 通过，84/84 pass；`node --test test\roxyOauthLogin.test.js test\roxyBrowserClient.test.js` 通过，81/81 pass。实机注册 run `350` 成功完成并自动启用 2FA；窗口尺寸二次实机验证 `outerWidth=2048`、`outerHeight=1152`。当前 `node src/server.js` 已重启，运行中服务已加载最新修复。
- 待办：后续继续注册新号时观察 RoxyBrowser 是否稳定保留 profile 窗口尺寸；不要在日志或页面中暴露 `/api/auth/session` 的 token 内容。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049` 至 `CHG-060` 中除已合并项外的 12 个以上，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 注册流程先设置数据库密码再提交邮箱验证码

- 来源工作日志：`docs/work/2026-07-03-registration-password-before-email-otp.md`
- change：`docs/changes/CHG-059-registration-password-before-email-otp.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：Roxy OpenAI 注册流程已改为使用补号账号数据库 `password` 创建密码，`registerAccount()` 会注入 `ROXY_REGISTER_PASSWORD`。注册脚本在 password 未提交前遇到 `auth.openai.com/email-verification` 时，不论是否可见 OTP 输入框，都会先点击主按钮推进到 `create-account/password`；二次修正后，即使 URL 不是 `/email-verification`，只要 password 未提交且 OTP 输入框可见，也会先返回 `email-verification-before-password`，禁止直接接码。只有 password 提交后，OTP 输入框才被识别为真正邮箱验证码页。OTP 错码后继续排除旧码，每轮 24 次、5 秒间隔轮询新码。注册完成后自动启用 2FA 与 `registrationMfa.secret` 写入补号账号 `codex_2fa` 的链路保持不变。
- 验证：`node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js` 通过，31/31 pass；`node --test test\replacementAccountsApi.test.js` 通过，18/18 pass；二次修正后 `node --test test\replacementServices.test.js test\roxyRegisterOpenai.test.js test\replacementAccountsApi.test.js` 通过，51/51 pass；`node --check src\auto\roxy_register_openai.js`、`node --check src\replacementServices.js`、`node --check src\server.js` 均通过。
- 待办：当前 `node src/server.js` 已于 2026-07-03 20:19:25 重启并加载修正；下一个未注册真实账号需要端到端验证 password 前 OTP 不填码、数据库密码设置成功、第二次邮箱验证码提交成功、`codex_2fa` 自动写库。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`、`CHG-055`、`CHG-056`、`CHG-057`、`CHG-058`、`CHG-059`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-03 iCloud 邮箱验证码 API 优先级对齐

- 来源工作日志：`docs/work/2026-07-03-icloud-email-code-api-priority.md`
- change：`docs/changes/CHG-058-icloud-email-code-api-priority.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：iCloud 与 Gmail 的账号级邮箱验证码 API 优先级已对齐。补号账号行 `email_code_api` 有值时，注册、普通补号和 2FA 补号都会注入外部验证码 API；为空时才由自动化脚本按邮箱域名选择默认本地接口，`@icloud.com` 走 `/api/icloud-verification-code/latest`，其他邮箱走 `/api/verification-code/latest`。直接运行脚本时，显式 `verificationApiUrl` / `VERIFICATION_CODE_API_URL` 也会优先于默认本地接口。
- 验证：`node --test test\replacementServices.test.js test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js` 通过，98/98 pass；`node --check src\replacementServices.js`、`node --check src\auto\roxy_oauth_login.js`、`node --check src\auto\roxy_register_openai.js`、`git diff --check` 均通过。
- 待办：重启服务后新子进程环境注入逻辑生效；用真实 iCloud 账号分别验证 `email_code_api` 有值和为空两条路径。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`、`CHG-055`、`CHG-056`、`CHG-057`、`CHG-058`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-02 iCloud 验证码 Gmail 收件 API

- 来源工作日志：`docs/work/2026-07-02-icloud-verification-code-api.md`
- change：`docs/changes/CHG-057-icloud-verification-code-api.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增 `POST /api/icloud-verification-code/latest`，用于从 Gmail 收件箱读取 iCloud 验证码。默认 Gmail 为 `ICLOUD_CODE_GMAIL_ACCOUNT`，未配置时使用 `rosannathornton1@gmail.com`；请求体可传 `gmailAccount` / `mailbox` / `gmail` 覆盖默认 Gmail，也可传 `account` / `icloudAccount` 指定目标 iCloud。接口会优先返回收件人元数据匹配目标 iCloud 的 6 位验证码，匹配不到时回退收件箱最新验证码并返回 `targetMatched: false`。本机调用免登录，远程调用仍需 `admin_auth`。注册、OAuth 补号和 2FA 补号遇到 `@icloud.com` 邮箱且未配置账号级 `email_code_api` 时默认走本地 iCloud 验证码 API。
- 验证：`node --test test\verificationCodeApi.test.js` 通过，7/7 pass；`node --test test\roxyOauthLogin.test.js`、`node --test test\roxyRegisterOpenai.test.js`、`node --test test\replacementServices.test.js` 均通过；`node --check src\server.js`、`node --check src\config.js`、`git diff --check` 均通过。
- 待办：重启当前 `node src/server.js` 服务后新接口生效；确认后台邮箱账号已配置 `rosannathornton1@gmail.com` 的 Gmail App Password；实机调用一次确认 Apple/iCloud 邮件头是否能让 `targetMatched` 为 `true`。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`、`CHG-055`、`CHG-056`、`CHG-057`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-02 注册后自动启用 2FA

- 来源工作日志：`docs/work/2026-07-02-registration-auto-enable-2fa.md`
- change：`docs/changes/CHG-056-registration-auto-enable-2fa.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：`src/auto/roxy_register_openai.js` 在注册成功并获取 `https://chatgpt.com/api/auth/session` 的 `accessToken` 后，默认执行 `enableChatGptTotpMfa()`，在同一 Roxy/ChatGPT 页面上下文中调用 MFA 协议：`mfa_info -> mfa/enroll -> 本地 TOTP -> activate_enrollment -> mfa_info`。成功后 CLI 输出 `ROXY_REGISTER_RESULT_JSON=...`；`src/replacementServices.js` 解析该结果；`src/server.js` 的注册接口把 `registrationMfa.secret` 写入补号账号 `codex_2fa`。可用 `ROXY_REGISTER_ENABLE_MFA=0` 关闭自动启用。
- 验证：`node --test test\roxyRegisterOpenai.test.js test\replacementServices.test.js test\replacementAccountsApi.test.js` 通过，41/41 pass；`node --check src\auto\roxy_register_openai.js`、`node --check src\replacementServices.js`、`node --check src\server.js` 通过。
- 待办：重启当前 `node src/server.js` 服务后新注册流程生效；建议再用真实 Roxy 注册账号端到端验证 `codex_2fa` 自动写入。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`、`CHG-055`、`CHG-056`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-02 本地 2FA 验证码 API

- 来源工作日志：`docs/work/2026-07-02-local-2fa-code-api.md`
- change：`docs/changes/CHG-055-local-2fa-code-api.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增 `src/totpService.js`，实现与 Google Authenticator/`2fa.fun` 默认参数一致的 TOTP：`sha1`、6 位、30 秒周期。`src/server.js` 新增 `POST /api/2fa-code`，请求体传 `{ "secret": "<base32>" }`，成功返回 `code`、`expiresIn`、`step`、`digits`、`algorithm`。本机 `127.0.0.1` 调用免后台登录态，远程调用仍要求 `admin_auth`。
- 验证：`node --test test\totpService.test.js test\replacementAccountsApi.test.js` 通过，21/21 pass；`node --check src\totpService.js`、`node --check src\server.js` 通过。
- 待办：需要重启当前 `node src/server.js` 服务后，运行中的项目实例才会暴露 `/api/2fa-code`；外部自动化建议使用 POST body 传 secret，不要放到 URL query。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`、`CHG-055`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-02 补号管理页新增 2FA 补号操作

- 来源工作日志：`docs/work/2026-07-02-replacement-2fa-action.md`
- change：`docs/changes/CHG-054-replacement-2fa-ui-action.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号管理页已新增“2FA补号”入口，前端调用 `POST /replacement-accounts/:id/replace-2fa`。后端新增 `replacementServices.replaceAccountWith2FA(account)`，默认通过子进程运行 `src/auto/roxy_2fa_auth_login.js`。传值沿用补号账号记录：`email -> ROXY_OAUTH_EMAIL`、`phone -> ROXY_OAUTH_PHONE`、`sms_api -> PHONE_VERIFICATION_SMS_API_URL`、`email_code_api -> VERIFICATION_CODE_API_URL`、`password -> ROXY_OAUTH_PASSWORD`、`codex_2fa -> ROXY_OAUTH_2FA_CODE` 或 `ROXY_OAUTH_TOTP_SECRET`；其中 6-8 位数字 `codex_2fa` 按一次性 2FA code 处理，否则按 TOTP secret 处理。
- 验证：`node --test test\replacementServices.test.js`、`node --test test\replacementAccountsApi.test.js`、`node --test test\replacementAccountsWeb.test.js` 通过；`node --check src\replacementServices.js`、`node --check src\server.js`、`node --check web\app.js` 通过。
- 待办：重启当前 `node src/server.js` 服务后，运行中的补号管理页才会出现“2FA补号”；可再选真实账号实机验证完整 2FA 补号链路。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`、`CHG-054`，已超过 5 个，应安排 PRD 基线合并。

## 2026-07-02 Roxy 2FA OAuth 登录自动化脚本

- 来源工作日志：`docs/work/2026-07-02-roxy-2fa-oauth-login.md`
- change：`docs/changes/CHG-053-roxy-2fa-oauth-login.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增独立 `src/auto/roxy_2fa_auth_login.js`，用于 OpenAI password + MFA OAuth 登录。新脚本会先处理 email 页并提交邮箱，进入 password 页后填写 `ROXY_OAUTH_PASSWORD` / options password 并 Continue；识别 `/mfa-challenge/` 或 `Verify your identity / Code` MFA 页后，使用显式 2FA code 或 TOTP secret 生成 code 并提交。MFA 后续 add-phone、phone-verification、phone-code、Codex consent、callback、token exchange 和失败截图继续复用原 `src/auto/roxy_oauth_login.js` 状态机。原脚本只新增 `buildAuthUrl` 与 `processOAuthLoginFlow` 注入钩子，旧 one-time-code 流程保持不变。新脚本默认 OAuth authorize URL 带 `prompt=login`，CLI 第一个参数仍可覆盖 target URL。
- 验证：RED 阶段 `node --test test\roxy2FAAuthLogin.test.js` 失败于新模块缺失；二次 RED 失败于 email 页进入 password 后仍点击 one-time-code；实现后 `node --test test\roxy2FAAuthLogin.test.js` 通过 7/7，`node --test test\roxyOauthLogin.test.js` 通过 69/69，合并运行 `node --test test\roxy2FAAuthLogin.test.js test\roxyOauthLogin.test.js` 通过 76/76；`node --check src\auto\roxy_2fa_auth_login.js` 和 `node --check src\auto\roxy_oauth_login.js` 通过。
- 待办：可用真实 Roxy 窗口执行 `node src\auto\roxy_2fa_auth_login.js` 做实机验证；运行前提供 `ROXY_OAUTH_PASSWORD` 和 `ROXY_OAUTH_2FA_CODE`，或提供 `ROXY_OAUTH_TOTP_SECRET`。
- PRD 合并提醒：当前未合并的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`、`CHG-053`，已达到 5 个，应安排 PRD 基线合并。

## 2026-06-30 补号账号状态模型与行内编辑

- 来源工作日志：`docs/work/2026-06-30-replacement-account-status-model.md`
- change：`docs/changes/CHG-052-replacement-account-status-model-and-inline-edit.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：补号账号业务状态已扩展为 `unregistered`、`pending_activation`、`plus_active`、`cpa_mounted`、`for_sale`、`sold`、`banned`、`failed`，其中旧 `pending/active/replaced` 兼容映射为 `for_sale/plus_active/cpa_mounted`。新库表结构和新增账号默认 `for_sale`；补号成功写 `cpa_mounted`；连续失败 5 次后状态保持 `failed` 并写入熔断字段，不再写 `banned`。`GET /replacement-accounts?circuit_breaker=1` 支持筛选已熔断账号；CPA 自动监控会跳过 `banned` 和已熔断账号。补号管理页状态列已改为中文下拉行内编辑，并在熔断账号旁显示“已熔断”徽标；状态下拉已放大，并按状态显示不同颜色，切换状态时会立即换色。
- 验证：`node --test test\replacementAccounts.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js test\cpaCredentialMonitor.test.js test\cpaRepairWorker.test.js` 通过，68/68 pass；补充 `node --test test\replacementAccountsWeb.test.js` 通过，12/12 pass；`node --check .\src\db.js`、`node --check .\src\replacementAccounts.js`、`node --check .\src\server.js`、`node --check .\src\cpaCredentialMonitor.js`、`node --check .\src\cpaRepairWorker.js`、`node --check .\web\app.js` 通过。
- 待办：需要重启当前 `node src/server.js` 服务后，新状态模型和前端行内编辑才会在运行中的页面生效。当前未合并 PRD 的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`、`CHG-052`，未达到 5 个提醒阈值。

## 2026-06-29 补号账号密码字段与列表压缩展示

- 来源工作日志：`docs/work/2026-06-29-replacement-password-compact-fields.md`
- change：`docs/changes/CHG-051-replacement-password-and-compact-fields.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：`replacement_accounts` 新增 `password` 字段，既有数据库启动时通过 `ensureColumn` 自动补列。新增补号账号未提交密码时自动生成 12-16 位随机密码，字符集包含大小写字母、数字和 `!@#$%^&*_-`；编辑时密码为空会保留原值，提交非空密码则更新。补号管理页新增“密码”输入框和主表列；主表除邮箱、备注和开通时间外的长字段压缩为前 6 位并提供复制完整值按钮；邮箱、备注和开通时间完整显示并按约 12 个字符宽度换行；主表隐藏“状态更新时间”“最后操作”“更新时间”三列；表格宽度按内容收缩，减少列间距异常和操作列挤压。
- 验证：`npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js` 通过，54/54 pass；`node --check .\src\db.js`、`node --check .\src\replacementAccounts.js`、`node --check .\web\app.js` 通过。
- 待办：需要重启当前 `node src/server.js` 服务后，新数据库字段和前端页面才会在运行中的服务生效。当前未合并 PRD 的 `implemented` change 为 `CHG-049`、`CHG-050`、`CHG-051`，未达到 5 个提醒阈值。

## 2026-06-27 IMAP 家宽代理启动

- 来源工作日志：`docs/work/2026-06-27-home-imap-proxy-start.md`
- change：`docs/changes/CHG-050-home-imap-proxy-start.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：新增 `npm run start:home-proxy` 和 `scripts/start-with-home-imap-proxy.cjs`，通过 `ssh -N -L 127.0.0.1:11080:127.0.0.1:7891 vps-LA` 将本机 IMAP 代理端口转发到 `vps-LA` 上的家宽代理，再以 `IMAP_PROXY=socks5://127.0.0.1:11080` 启动 `src/server.js`。该启动方式只影响 Gmail IMAP 连接，`npm start` 和 `npm run start:proxy` 保持原行为。
- 验证：`node --test test\startWithHomeImapProxy.test.js test\startWithImapProxy.test.js test\imapService.test.js test\cpaConfig.test.js` 通过，25/25 pass。
- 待办：正式启动前确认 `vps-LA` 上 `127.0.0.1:7891` 的家宽代理可用；如本机 `127.0.0.1:11080` 被占用，需要先关闭占用进程或调整 `IMAP_HOME_PROXY_LOCAL_PORT`。

## 2026-06-26 IMAP 绑定 SSH 代理启动

- 来源工作日志：`docs/work/2026-06-26-imap-bound-ssh-proxy.md`
- change：`docs/changes/CHG-049-imap-bound-ssh-proxy-start.md`，状态 `implemented`，尚未合并到 PRD。
- 当前进展：已新增 `IMAP_PROXY`，Gmail IMAP 创建 ImapFlow client 时会使用该代理；新增 `npm run start:proxy`，通过 `scripts/start-with-imap-proxy.cjs` 先启动 `ssh -N -D 127.0.0.1:11080 <IMAP_PROXY_SSH_HOST>`，再启动 `src/server.js`，并在服务退出时关闭 SSH 隧道。`npm start` 保持原直连行为。
- 实机前置验证：`vps-LA` 出口 IP 为 `5.253.38.136`，可访问 `imap.gmail.com:993`，通过本地 SOCKS5 隧道 TLS 握手成功。
- 验证：`node --test test\imapService.test.js test\cpaConfig.test.js test\startWithImapProxy.test.js` 通过，21/21 pass。
- 待办：正式启动前如仍有临时 SSH 隧道占用 `127.0.0.1:11080`，需要先关闭该进程，避免绑定启动端口冲突。

## 2026-06-25 PRD-003 change 基线合并

- 来源工作日志：`docs/work/2026-06-25-prd-003-change-merge.md`
- 合并范围：`CHG-044`、`CHG-045`、`CHG-046`、`CHG-047`、`CHG-048`。
- 当前进展：已新增 `docs/prd/PRD-003-account-management-system-2026-06-25-baseline.md`，并在 `docs/prd/PRD_REGISTRY.md` 登记 PRD-003。上述 change 已全部更新为 `merged`，关联 PRD 已改为 `PRD-003`，各 change 文件已记录合并目标和合并日期。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现未合并的 `implemented` change。

## 2026-06-25 补号账号 Codex 2FA 字段

- 来源工作日志：`docs/work/2026-06-25-replacement-codex-2fa-field.md`
- change：`docs/changes/CHG-048-replacement-codex-2fa-field.md`，状态 `merged`，已合并到 PRD-003。
- 当前进展：`replacement_accounts` 新增 `codex_2fa` 字段，既有数据库启动时通过 `ensureColumn` 自动补列。`POST /replacement-accounts` 与 `PUT /replacement-accounts/:id` 支持保存 `codex_2fa`，并兼容请求体字段名 `2fa-codex`、`2fa_codex`。补号管理页账号弹窗新增 `2fa-codex` 输入框，主表新增 `2fa-codex` 列并复用长字段截断/复制。
- 验证：`npm test -- test/replacementAccounts.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js` 通过，53/53 pass。
- 待办：需要重启当前 `node src/server.js` 服务后，`http://localhost:13100/replacement-ui` 才会加载新页面与新 API 逻辑。

## 2026-06-25 CPA 上传凭证文件名 codex 前缀

- 来源工作日志：`docs/work/2026-06-25-cpa-upload-file-name-codex-prefix.md`
- change：`docs/changes/CHG-047-cpa-upload-file-name-codex-prefix.md`，状态 `merged`，已合并到 PRD-003。
- 当前进展：CPA repair worker 读取本地 CPA JSON 时仍使用 `src/auto/product_files/cpa/<email>.json`；上传到 CPA 的 auth file 名称改为 `codex-<email>-plus.json`，例如 `codex-slide.emoji.2w+rv4okxgrtg9hc7cvf@icloud.com-plus.json`。上传后健康复查仍按邮箱判断。
- 验证：`npm test -- test/cpaRepairWorker.test.js` 通过，5/5 pass。
- 待办：需要重启当前 `node src/server.js` 服务后，新 CPA 上传命名才会在运行中的服务生效。

## 2026-06-25 注册 token 保存与列表空态

- 来源工作日志：`docs/work/2026-06-25-registration-token-output-and-list-empty-state.md`
- change：`docs/changes/CHG-046-registration-token-output-and-list-empty-state.md`，状态 `merged`，已合并到 PRD-003。
- 当前进展：OpenAI 注册自动化在成功读取 `chatgpt.com/api/auth/session` 的 `accessToken` 后，会保存纯 token 值到 `src/auto/product_files/registration/<email>.txt`；文件名默认使用补号邮箱号，仅替换 Windows 不允许的文件名字符。注册日志只输出 token 文件路径，不输出 token 明文。`/accounts` 页面改为复用统一 sidebar，补号日志入口在邮箱账号页可见；邮箱账号列表和补号日志列表在无数据或筛选无结果时显示空态行。
- 验证：`node --test test\roxyRegisterOpenai.test.js` 通过，4/4 pass；`node --test test\replacementAccountsWeb.test.js` 通过，10/10 pass。
- 待办：重启当前 `node src/server.js` 服务后，前端页面和注册子进程新逻辑才会在 13100 端口生效。

## 2026-06-21 CPA 自动补号触发原因日志

- 来源工作日志：`docs/work/2026-06-21-cpa-repair-trigger-log.md`
- change：`docs/changes/CHG-045-cpa-repair-trigger-log.md`，状态 `merged`，已合并到 PRD-003。
- 当前进展：CPA 自动补号运行日志已新增 `step=cpa-trigger`，记录触发补号的 CPA provider、email、status、unavailable、disabled、reasons 和截断后的 `status_message`。真实 Roxy OAuth 子进程日志会在自动化启动前写入该信息，即使后续 OAuth 自动化失败也能从 run log 判断为什么执行了补号。
- 验证：`node --test test\cpaRepairWorker.test.js` 通过，5/5 pass；`node --test test\replacementServices.test.js` 通过，15/15 pass。
- 待办：需要重启当前 `node src/server.js` 服务让新日志逻辑在定时 CPA monitor 中生效。

## 2026-06-11 CPA 同邮箱多凭证任一健康判断

- 来源工作日志：`docs/work/2026-06-11-cpa-email-any-healthy.md`
- change：`docs/changes/CHG-044-cpa-email-any-healthy.md`，状态 `merged`，已合并到 PRD-003。
- 当前进展：CPA 健康巡检和补号后复查已改为按邮箱归并判断；同一邮箱存在多个 CPA auth file 时，只要任一凭证为健康状态，邮箱整体视为健康，不再因为其他旧异常凭证触发补号或导致 repair worker 复查失败。若同邮箱没有任何健康凭证，仍按原逻辑报告异常或触发补号。
- 验证：`node --test test\cpaRepairWorker.test.js test\cpaCredentialMonitor.test.js` 通过，8/8 pass。
- 待办：尚未执行真实 CPA `/cpa/auth-health` 实机复查。

## 2026-06-08 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-08-prd-002-change-merge.md`
- 合并范围：`CHG-042`、`CHG-043`。
- 当前进展：`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-08`，并吸收账号级 `email_code_api`、注册/OAuth 外部邮箱验证码接口、外部 HTML/text/JSON 验证码提取、本地 POST 回退、补号主表 `email_code_api` 展示、长字段截断和复制完整原始值等要求。
- 状态更新：`docs/changes/CHANGE_REGISTRY.md` 及对应 change 文件中 `CHG-042`、`CHG-043` 已更新为 `merged`，并补充合并目标 PRD 和合并日期。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现未合并的 `implemented` change。

## 2026-06-08 补号 OAuth 外部邮箱验证码接口

- 来源工作日志：`docs/work/2026-06-08-email-code-api-extraction-service.md`
- change：`docs/changes/CHG-042-email-code-api-extraction-service.md`，状态 `merged`，已合并 PRD。
- 当前进展：`CHG-042` 已从“补号注册支持账号级外部邮箱验证码接口”扩展为“补号注册与 OAuth 支持账号级外部邮箱验证码接口”。`replacementServices.replaceAccount()` 现在读取补号账号 `email_code_api`，有值时向 `src/auto/roxy_oauth_login.js` 子进程注入 `VERIFICATION_CODE_API_URL`；无值时移除该 env，让脚本按 `PORT` 继续走本地 `POST /api/verification-code/latest`。`roxy_oauth_login.js` 对本地验证码接口保持 POST JSON，对外部 `VERIFICATION_CODE_API_URL` 使用 GET，并复用通用验证码提取核心处理 HTML/text/JSON，避免 CSS 色值误匹配。`roxy_register_openai.js` 也已直接兼容 `email_code_api` / `emailCodeApiUrl` 参数和 `EMAIL_CODE_API` / `email_code_api` 环境变量，均优先于本地 POST。
- 验证：RED 阶段测试先失败于 `replaceAccount` 未注入外部邮箱验证码 URL、`openAi_email_code` 对外部 URL 仍走旧 POST/JSON 解析，以及注册脚本传入 `email_code_api` 选项时仍调用本地 POST；修复后 `node --test test\replacementServices.test.js` 通过，15/15 pass；`node --test test\roxyOauthLogin.test.js` 通过，69/69 pass；`node --test test\roxyRegisterOpenai.test.js` 通过，3/3 pass；`node --check src\auto\roxy_oauth_login.js` 和 `node --check src\auto\roxy_register_openai.js` 通过。
- 当前提醒：`CHG-042` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-08 补号列表长字段截断与复制

- 来源工作日志：`docs/work/2026-06-08-replacement-table-limited-field-copy.md`
- change：`docs/changes/CHG-043-replacement-table-limited-field-copy.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号管理主表已对邮箱、手机号、SMS API、邮箱验证码 API、备注、开通信息、状态时间、公开验证码 Key、更新时间等字段使用 `tableFieldLimits` 做最大显示长度控制；超长字段旁新增“复制”按钮，点击复制该字段完整原始值，剪贴板不可用时回退 `prompt`。详情弹窗和后端接口未改变。
- 验证：`node --check .\web\app.js` 通过；`node --test .\test\replacementAccountsWeb.test.js` 通过，9/9 pass。
- 当前提醒：`CHG-043` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-08 补号注册外部邮箱验证码接口

- 来源工作日志：`docs/work/2026-06-08-email-code-api-extraction-service.md`
- change：`docs/changes/CHG-042-email-code-api-extraction-service.md`，状态 `merged`，已合并 PRD。
- 当前进展：新增通用验证码提取核心，ESM 与 `src/auto` CommonJS 脚本共用同一份 `.cjs` 核心；HTML 提取会先移除 `script/style` 和标签，再匹配独立 6 位数字，避免 CSS 色值误匹配。`imapService.extractSixDigitCode()` 已复用该逻辑，本地 `POST /api/verification-code/latest` 保持原接口行为。补号账号新增 `email_code_api` 字段，数据库、仓储、前端表单和列表已做最小支持。`POST /replacement-accounts/:id/register` 启动注册子进程时，若账号配置该字段，会注入 `REGISTRATION_EMAIL_CODE_API_URL`；注册脚本优先 GET 外部接口提取验证码，未配置时继续 POST 本地验证码接口。日志只记录 `code=received/empty`，不记录验证码明文。
- 验证：RED 阶段测试先失败于服务缺失、env 未注入、注册脚本仍 POST、仓储字段未持久化；修复后 `npm test -- test/verificationCodeService.test.js test/replacementAccounts.test.js test/replacementServices.test.js test/roxyRegisterOpenai.test.js test/verificationCodeApi.test.js test/imapService.test.js` 通过，65/65 pass。
- 待办：尚未执行真实外部邮箱验证码页面端到端注册实机验证。`CHG-042` 已在 2026-06-08 PRD 基线合并中更新为 `merged`。

## 2026-06-07 CPA 自动补号连续失败熔断与站内通知

- 来源工作日志：`docs/work/2026-06-07-cpa-repair-circuit-breaker-notifications.md`
- change：`docs/changes/CHG-041-cpa-repair-circuit-breaker-notifications.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号账号新增连续失败计数与熔断字段；补号失败会递增 `consecutive_replace_failures`，连续失败达到 5 次会自动标记为 `banned` 并写入 `circuit_breaker_at` / `circuit_breaker_reason`；补号成功会清零失败计数和熔断字段。新增 `admin_notifications` 表与通知 API，CPA repair worker 触发熔断时会创建未读通知。顶部铃铛 UI 已改为真实通知入口，显示未读数量并支持查看最近通知、标记已读。补号管理页已新增“解除熔断”独立操作，解除后账号回到 `pending` 并清空连续失败和熔断字段。
- 验证：`npm test -- test/replacementAccounts.test.js test/adminNotifications.test.js test/adminNotificationsApi.test.js test/cpaRepairWorker.test.js` 通过，32/32 pass；`npm test -- test/replacementAccountsApi.test.js` 通过，13/13 pass；全量 `npm test` 通过，211/211 pass；关键 JS 文件 `node --check` 均通过。
- 待办：尚未执行真实 CPA 守护进程实机熔断链路；邮件通知未实现。当前未合并的 `implemented` change 数量为 0。

## 2026-06-07 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-07-prd-002-change-merge.md`
- 合并范围：`CHG-038`、`CHG-039`、`CHG-040`。
- 当前进展：`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-07`，并吸收列表无内部纵向滚动、补号主表显示备注、默认端口 3100、验证码 API 随 `PORT` 推导、Roxy OAuth 密码页 one-time code 和邮箱后未知页重试等要求。
- 状态更新：`docs/changes/CHANGE_REGISTRY.md` 及对应 change 文件中 `CHG-038`、`CHG-039`、`CHG-040` 已更新为 `merged`，并补充合并目标 PRD 和合并日期。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现未合并的 `implemented` change。

## 2026-06-06 Roxy OAuth 密码页 one-time code 与邮箱后异常重试

- 来源工作日志：`docs/work/2026-06-06-roxy-openai-password-one-time-code.md`
- 新增 issue：`docs/issues/issue-008-roxy-openai-password-email-code-misclassification.md`，状态 `resolved`。
- change：`docs/changes/CHG-040-roxy-openai-password-one-time-code.md`，状态 `merged`，已合并 PRD。
- 当前进展：已用当前 Roxy CDP 启动 Playwright recorder，录制确认 OpenAI 密码页需要点击 `Log in with a one-time code`。`roxy_oauth_login.js` 已新增密码页判断和 one-time code 操作；邮箱提交后会识别 `openai-password`、`email-code`、`codex-login`、`callback` 或 `unknown`。进入密码页时点击 one-time code 并继续状态机；进入未知页时会回到本次 OAuth target URL 重试，默认最多 3 次，耗尽后抛出 `OPENAI_POST_EMAIL_STAGE_RETRY_EXHAUSTED`。
- 二次修复：密码页 readonly `Email address` 输入框不再被误判为邮箱登录页；one-time code 后等待阶段会忽略当前 password 页，避免页面短暂停留时记录 `next=openai-password` 并回到邮箱登录分支。
- 复盘：`issue-002` / `issue-004` 已经记录过“提交后不能把当前阶段当下一阶段”的问题；本次新增 password 阶段时没有沿用该通用规则，导致同类问题复发。后续新增 Roxy OAuth 阶段必须同步补“忽略当前阶段”和“相邻页误判负例”测试。
- 新增日志：邮箱提交后 next stage、密码页识别、one-time code 后 next stage、异常页面重试次数和重试耗尽。
- 验证：`node --check .\src\auto\roxy_oauth_login.js` 通过；`node --test .\test\roxyOauthLogin.test.js` 通过，68/68 pass。当前 Roxy 页 `https://auth.openai.com/email-verification` 下，手动验证 `openai-page=false`、`email-code-page=true`。
- 当前提醒：`CHG-040` 已在 2026-06-07 PRD 基线合并中更新为 `merged`。

## 2026-06-06 Windows 3000 端口 EACCES 修复

- 来源工作日志：`docs/work/2026-06-06-port-3100-eacces.md`
- 新增 issue：`docs/issues/issue-007-windows-port-3000-eacces.md`，状态 `resolved`。
- change：`docs/changes/CHG-039-avoid-windows-port-3000-eacces.md`，状态 `merged`，已合并 PRD。
- 当前进展：已确认 `3000` 未被占用，而是 Windows TCP 排除端口范围包含 `2987-3086` 导致监听 `0.0.0.0:3000` 报 `EACCES`。本机 `.env` 已改为 `PORT=3100`，`VERIFICATION_CODE_API_URL` 留空时自动化会按 `PORT` 推导验证码 API URL；示例配置、自动化默认值、测试和文档已同步。
- 验证：`npm start` 启动后 `GET http://127.0.0.1:3100/login` 返回 200；`node --test test\roxyOauthLogin.test.js test\roxyRegisterOpenai.test.js` 通过，60/60 pass。
- 当前提醒：`CHG-039` 已在 2026-06-07 PRD 基线合并中更新为 `merged`。

## 2026-06-05 前端列表取消局部竖向滚动并显示补号备注

- 来源工作日志：`docs/work/2026-06-05-frontend-list-remark-no-inner-scroll.md`
- change：`docs/changes/CHG-038-frontend-list-remark-no-inner-scroll.md`，状态 `merged`，已合并 PRD。
- 当前进展：补号管理主表已将 `SMS 错误` 列替换为 `备注` 列，直接展示 `replacement_accounts.remark`；`sms_last_error` 仍保留在详情 JSON 中。邮箱管理和补号管理表格容器已取消固定高度与内部纵向滚动，仅保留横向滚动；邮箱邮件结果列表也取消内部纵向滚动，内容自然撑开页面。
- 验证：`node --test test\replacementAccountsWeb.test.js` 通过，7/7 pass；`node --test test\accountsWebApi.test.js` 通过，7/7 pass；全量 `npm test` 通过，194/194 pass；`node --check .\web\app.js`、`node --check .\web\accounts.js` 通过。
- 待办：如需进一步优化宽表阅读体验，可继续压缩列宽或改成关键字段卡片式展示。

## 2026-06-05 PRD-002 change 基线合并

- 来源工作日志：`docs/work/2026-06-05-prd-002-change-merge.md`
- 当前进展：`CHG-031`、`CHG-032`、`CHG-033`、`CHG-034`、`CHG-035`、`CHG-037` 已合并到 `docs/prd/PRD-002-account-management-system.md`，状态均更新为 `merged`。
- 清理：已删除本次分页的临时计划文档 `docs/plans/2026-06-05-account-pagination-design.md` 和 `docs/plans/2026-06-05-account-pagination.md`；保留 change/work 记录作为审计链。
- 当前提醒：`CHANGE_REGISTRY.md` 中当前未发现 `CHG-031` 至 `CHG-037` 仍处于待合并 PRD 的状态。

## 2026-06-05 账号列表分页

- 来源工作日志：`docs/work/2026-06-05-account-list-pagination.md`
- change：`docs/changes/CHG-037-account-list-pagination.md`，状态 `merged`，已合并 PRD。
- 当前进展：邮箱账号接口 `/api/accounts` 和补号账号接口 `/replacement-accounts` 已支持 `page`、`pageSize`、`status`、`keyword` 服务端分页查询，并返回 `pagination` 元数据。邮箱账号页和补号管理页已新增每页条数、上一页、下一页和当前页显示；筛选状态或输入关键词会重置到第 1 页并重新请求接口。
- 验证：RED 阶段新增测试分别失败于 `listAccountsPage is not a function`、分页控件缺失和接口未分页；修复后 `npm test -- test\accounts.test.js test\replacementAccounts.test.js` 通过，29/29 pass；`npm test -- test\accountsWebApi.test.js test\replacementAccountsApi.test.js test\replacementAccountsWeb.test.js` 通过，26/26 pass；全量 `npm test` 通过，194/194 pass；`node --check .\src\accounts.js`、`node --check .\src\replacementAccounts.js`、`node --check .\src\server.js`、`node --check .\web\accounts.js`、`node --check .\web\app.js` 通过。

## 2026-06-05 邮箱邮件详情弹窗修复

- 来源工作日志：`docs/work/2026-06-05-email-mail-detail-dialog.md`
- 新增 issue：`docs/issues/issue-006-email-mail-detail-dialog-missing.md`，状态 `resolved`。
- 当前进展：已定位邮箱账号页面点击邮件摘要无弹窗的根因：`web/accounts.js` 的 `openMailDetailDialog()` 引用了 `#mailDetailDialog` 和多个详情字段节点，但 `web/accounts.html` 缺少对应 DOM。已在页面中补回邮件详情弹窗结构，并新增回归测试覆盖。另补充 `.gitignore` 例外 `!web/accounts.html`，确保该页面模板不会继续被全局 `*.html` 规则忽略。
- 验证：RED 阶段 `npm test -- test\accountsWebApi.test.js` 失败于缺少 `id="mailDetailDialog"`；修复后同命令通过，5/5 pass。全量 `npm test` 通过，186/186 pass；`node --check .\web\accounts.js`、`node --check .\src\server.js` 通过。

## 2026-06-05 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-add-phone-transition-race.md`
- 新增 issue：`docs/issues/issue-002-roxy-add-phone-transition-race.md`
- change：`docs/changes/CHG-032-roxy-add-phone-transition-guard.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 `phone-add` 提交后的跳转竞态；`waitForStageTransition()` 支持忽略当前阶段，`phone-add` 提交后不会再把同阶段 `phone-add` 当作有效跳转，避免重复填写手机号并命中 disabled/detached 旧组件。新增回归测试覆盖 add-phone 短暂停留后进入 phone-code 的场景。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，56/56 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Add your phone number -> Check your phone -> Codex/callback` 通过；通过后关闭 `issue-002`。

## 2026-06-05 callback CDP fallback 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-callback-cdp-fallback.md`
- 新增 issue：`docs/issues/issue-003-roxy-callback-chrome-error-url.md`
- change：`docs/changes/CHG-033-roxy-callback-cdp-fallback.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 Codex callback 在 Chrome error 页下漏识别的问题；当 `page.url()` 为 `chrome-error://chromewebdata/` 时，会通过 CDP `Page.getNavigationHistory()` / `Target.getTargets()` 提取匹配本次 `state` 的 callback URL，并继续 token exchange。
- 新增日志：检测到 Chrome error 页时记录 CDP fallback 尝试；从 navigation history 或 target URL 捕获 callback 时记录来源。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，57/57 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 callback 后 token exchange 和 CPA JSON 生成成功；通过后关闭 `issue-003`。

## 2026-06-05 phone-code transition race 更新

- 来源工作日志：`docs/work/2026-06-05-roxy-phone-code-transition-race.md`
- 新增 issue：`docs/issues/issue-004-roxy-phone-code-transition-race.md`
- change：`docs/changes/CHG-034-roxy-phone-code-transition-guard.md`，状态 `merged`，已合并 PRD。
- 当前进展：已修复 `phone-code` 提交后的跳转竞态；`processOAuthLoginFlow()` 在手机验证码提交后等待离开当前 `phone-code` 阶段，并记录/消费 `openAi_phone_code()` 返回的 `next-stage`。`openAi_phone_code()` 在验证码输入框 wait/click/fill 或 Continue click 失败时，会复检 Codex/callback 并返回下一阶段，避免重复操作 disabled/detached 旧 `Code` 输入框。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，58/58 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Check your phone -> Codex/callback -> token exchange` 通过；通过后关闭 `issue-004`。

## 2026-06-05 token exchange 页面上下文重试更新

- 来源工作日志：`docs/work/2026-06-05-roxy-token-page-context-retry.md`
- 新增 issue：`docs/issues/issue-005-roxy-token-fallback-exit-ip.md`
- change：`docs/changes/CHG-035-roxy-token-page-context-retry.md`，状态 `merged`，已合并 PRD。
- 当前进展：已移除正式 token exchange 默认 Playwright `request` / Node `fetch` fallback；`exchangeToken()` 默认只走 Roxy 浏览器页面上下文，最多 3 次重试，单次默认 10000ms。页面上下文 `fetch` 使用浏览器内 `AbortController`，单次超时会 abort 当前 token 请求，避免上一轮迟到请求和后续 retry 重复兑换同一个 authorization code。当前页为 Chrome error、空白页或非 `auth.openai.com` origin 时，会在同一 Roxy browser context 中复用或新建 auth 页面，并通过同源 `fetch('/oauth/token', ...)` 换 token。
- 新增日志：每次 token exchange 尝试和失败均记录 attempt、maxAttempts、timeoutMs、当前 URL、origin、token URL 和诊断。
- 验证：`npm test -- test/roxyOauthLogin.test.js` 通过，59/59 pass；`node --check .\src\auto\roxy_oauth_login.js` 通过。
- 待办：重新执行完整 `/replace` 实机链路，确认 `Codex/callback -> auth.openai.com 页面上下文 token exchange -> CPA JSON` 通过；通过后关闭 `issue-005`。

## 2026-06-05 自动化运行日志保留数量更新

- 来源工作日志：`docs/work/2026-06-05-automation-log-retention-limit.md`
- 新增 change：`docs/changes/CHG-036-automation-log-retention-limit.md`，状态 `merged`，已合并到 `PRD-002`。
- 当前进展：新增 `.env` 配置 `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS`，默认 30。每次创建新的补号或注册自动化运行记录后，会按配置保留最近记录；超过范围的非 `running` 旧记录会删除数据库行，并同步删除其 `log_path` 指向的日志文件。`running` 记录不会自动清理。
- 验证：`npm test -- test\replacementAccounts.test.js` 通过，21/21 pass；`npm test -- test\cpaConfig.test.js` 通过，3/3 pass。
- 备注：`CHG-031` 至 `CHG-035` 已在后续 PRD 基线合并中更新为 `merged`。

- 来源工作日志：`docs/work/2026-06-04-roxy-add-phone-page.md`
- 当前任务：Roxy OAuth 登录流程已串接到 OAuth callback、token exchange 和本地 CPA JSON 保存；验证码 API 已补充公开 key 与本机免登录调用能力；补号接口已通过子进程接入 Roxy OAuth 自动化；补号子进程日志页面和停止按钮已实现；补号管理页已增加公开验证码 key 展示、启用开关和复制公开验证码 URL 入口；CPA 凭证健康检测、失效分类、自动补号队列、CPA JSON 上传和复查已实现；补号列表现已完整显示关键运行字段；公开验证码已新增一键启用/停用专用操作；手机和邮箱验证码阶段均已增加状态守卫；Roxy OAuth 已新增添加手机号页处理，会从补号表手机号注入的 `ROXY_OAUTH_PHONE` 填写 `Phone number`；Codex 授权点击已增加 OAuth callback 竞态监听，并支持 URL 变化后用匹配 `state` 的 `code/state` 判定成功，避免长时间卡在 Playwright click 等待；token 交换现默认只使用 Roxy 浏览器页面上下文，最多 3 次重试，单次默认 10000ms，页面 fetch 超时会 abort；手动补号与自动补号现已统一走 CPA repair worker，补号后都会上传 CPA 并复查；Roxy 支持按 `ROXY_KEEP_OPEN` 推导有头/无头运行；`banned` 账号不会触发自动补号；管理员可手动触发 OpenAI 注册自动化，注册从 `https://chatgpt.com/` 进入且只用内部 POST 邮箱验证码接口；新增补号账号时 `activated_at` 为空会由后端自动写入当前时间；部署文档已补充 SQLite 数据库迁移、运行日志、自动化产物迁移说明，以及 RoxyBrowser 必填参数和 `/workspace/list`、`/browser/list` 获取方式。`CHG-017` 至 `CHG-026`、`CHG-028` 至 `CHG-037` 已合并进 `PRD-002` 基线，`CHG-027` 保持 `superseded`。
- 当前进展：已实现 `processOAuthLoginFlow` 状态机，覆盖 OpenAI 邮箱输入、邮箱验证码、添加手机号、手机验证方式选择、手机验证码、Codex 授权确认、OAuth callback 捕获、`exchangeToken` 和认证 JSON 保存；邮箱验证码阶段现在会在填写验证码前后、填写/点击失败时重新检测是否已进入添加手机号、短信验证码、手机验证方式、Codex 或 callback，命中则交回状态机，避免继续操作旧验证码输入框。Codex 授权点击前现在会监听 `localhost:1455/auth/callback` 请求并轮询当前 URL，点击过程若捕获 callback 会立即返回；如果 callback 请求未捕获但当前 URL相对点击前已变化，且 query/hash 中包含匹配本次 `state` 的 `code/state`，也会判定成功；未捕获则记录等待并交回状态机继续识别。`exchangeToken` 现在默认只走 Roxy 浏览器页面上下文换 token，最多 3 次重试，单次默认 10000ms；当前页为 Chrome error、空白页或非 `auth.openai.com` origin 时会复用/新建 auth 页面并执行同源 `fetch('/oauth/token')`；页面 fetch 超时会 abort，默认不回退 Playwright request/Node fetch。实机运行 `node .\src\auto\roxy_oauth_login.js` 已成功生成本地 CPA/sub2api JSON。验证码侧新增 `GET /api/verification-code/public/latest?key=...`，通过补号账号表放权 key 获取验证码；`POST /api/verification-code/latest` 本机请求免 `admin_auth`。`POST /replacement-accounts/:id/register` 已支持管理员手动触发注册自动化，注册脚本使用 RoxyBrowser 接管页面，从 `https://chatgpt.com/` 进入注册流程，只通过 `POST /api/verification-code/latest` 获取邮箱验证码，不使用 SMS API。`POST /replacement-accounts/:id/replace` 在生产注入 `cpaRepairWorker` 后会走统一 repair 链路：运行 Roxy OAuth、读取 `src/auto/product_files/cpa/<email>.json`、上传 CPA、复查 CPA 健康、落库成功或失败；子进程环境会注入 `ROXY_OAUTH_EMAIL`、`ROXY_OAUTH_PHONE` 和 `PHONE_VERIFICATION_SMS_API_URL`。CPA 返回 `status=active` 现在视为健康，repair worker 会把 CPA 读取、上传、复查和成功/失败步骤追加到同一个补号运行日志。新增 `GET /cpa/auth-health`，会读取 CPA auth-files，将凭证分类为 `healthy`、`banned`、`disabled`、`auth_expired`、`quota_limited` 或 `unknown_error`；只有 `auth_expired` 会按邮箱匹配补号账号并进入 single-flight 队列，本地补号账号 `status=banned` 时跳过入队并返回 `account_banned`。`ROXY_KEEP_OPEN=1` 默认有头并保留窗口，`ROXY_KEEP_OPEN=0` 默认无头并关闭窗口，`ROXY_HEADLESS` 可显式覆盖。补号列表主表新增 `phone` 原文、`sms_api`、`sms_last_error`、`activated_at`、`status_updated_at`、`public_code_key` 等列，表格使用水平滚动查看长字段；新增补号账号未提交 `activated_at` 时，`src/replacementAccounts.js` 会写入当前 ISO 时间。公开验证码现在可通过操作菜单直接“启用公开验证码”或“停用公开验证码”，对应 `PATCH /replacement-accounts/:id/public-code`。手机和邮箱验证码阶段现在以“取一次码 + 检查一次页面状态”的方式轮询，验证码为空不会点击提交，进入后续页则交回外层状态机继续。`docs/project/deployment.md` 已补充环境变量、启动方式、SQLite 数据库迁移步骤和部署检查项；迁移时至少复制 `data/app.db` 与 `.env`，完整补号上下文建议同时复制 `data/automation-logs/`、`src/auto/product_files/cpa/` 和 `src/auto/product_files/sub2api/`；RoxyBrowser 自动补号还需配置 `ROXY_API_BASE_URL` / `ROXY_API_PORT`、`ROXY_API_TOKEN`、`ROXY_WORKSPACE_ID` 和窗口定位参数，workspace ID 通过 `/workspace/list` 获取，窗口 `ROXY_BROWSER_SORT_NUM` 通过 `/browser/list?workspaceId=...` 返回的 `sortNum` / `windowSortNum` / `SN` 获取。`docs/prd/PRD-002-account-management-system.md` 最近基线合并日期已更新为 `2026-06-05`，并吸收 `CHG-017` 至 `CHG-026`、`CHG-028` 至 `CHG-037` 的需求内容。
- 关键文件：`src/auto/roxy_oauth_login.js`、`src/auto/roxy_register_openai.js`、`src/replacementServices.js`、`src/replacementAutomationRuns.js`、`src/server.js`、`src/replacementAccounts.js`、`src/db.js`、`src/config.js`、`src/cpaClient.js`、`src/cpaCredentialHealth.js`、`src/cpaCredentialMonitor.js`、`src/cpaRepairQueue.js`、`src/cpaRepairWorker.js`、`src/cpaCredentialMonitorRunner.js`、`web/index.html`、`web/app.js`、`web/styles.css`、`web/automation-logs.html`、`web/automation-logs.js`、`test/roxyOauthLogin.test.js`、`test/roxyRegisterOpenai.test.js`、`test/replacementServices.test.js`、`test/replacementAccountsApi.test.js`、`test/replacementAccountsWeb.test.js`、`test/verificationCodeApi.test.js`、`test/replacementAccounts.test.js`、`test/cpa*.test.js`、`docs/prd/PRD-002-account-management-system.md`、`docs/project/deployment.md`、`docs/changes/CHANGE_REGISTRY.md`、`docs/changes/CHG-017-replacement-automation-log-page.md`、`docs/changes/CHG-018-public-verification-code-ui.md`、`docs/changes/CHG-019-cpa-auth-health-monitor.md`、`docs/changes/CHG-020-replacement-table-full-fields.md`、`docs/changes/CHG-021-public-code-toggle-api.md`、`docs/changes/CHG-022-roxy-phone-code-state-guard.md`、`docs/changes/CHG-023-roxy-email-code-state-guard.md`、`docs/changes/CHG-024-unified-cpa-repair-and-roxy-headless.md`、`docs/changes/CHG-025-banned-accounts-skip-auto-repair.md`、`docs/changes/CHG-026-roxy-codex-callback-click-guard.md`、`docs/changes/CHG-028-roxy-token-exchange-page-context-short-timeout.md`、`docs/changes/CHG-029-manual-openai-registration.md`、`docs/changes/CHG-030-default-replacement-activated-at.md`、`docs/changes/CHG-031-roxy-add-phone-page.md`、`docs/work/2026-06-03-roxy-codex-callback-click-guard.md`、`docs/work/2026-06-03-deployment-database-migration.md`、`docs/work/2026-06-03-prd-002-change-merge.md`、`docs/work/2026-06-04-prd-002-register-and-time-merge.md`、`docs/work/2026-06-04-roxy-add-phone-page.md`
- 关键产物：`src/auto/product_files/cpa/jregkolpig+s4@gmail.com.json`、`src/auto/product_files/sub2api/jregkolpig+s4@gmail.com.json`。这些文件包含敏感 token，禁止提交或公开。
- 下一步建议：先用刚才卡在 add phone 的补号账号重新执行一次 `/replace`，确认 `Add your phone number` -> 手机验证码 -> Codex 授权链路实机通过；CPA 管理密钥修复后，再用后台登录态手动请求 `GET /cpa/auth-health`，确认 CPA auth-files 读取、分类、补号、上传和复查链路；手动验证稳定后再设置 `CPA_HEALTH_MONITOR_ENABLED=true` 启用 10 分钟轮询。
## 2026-07-28 协议注册 CDP 导航超时诊断

- 来源工作日志：`docs/work/2026-07-28-protocol-registration-cdp-timeout-diagnosis.md`
- 新增 issue：`docs/issues/issue-020-protocol-registration-cdp-navigate-timeout-budget.md`，状态 `active`。
- 当前进展：账号 `211`（`rattler.riel4v@icloud.com`）在 Auth 返回 `email_otp_verification` 后，导航 `GET /api/accounts/email-otp/send` 时失败。bridge 的 `page.goto()` 单次超时为 60 秒且可重试 3 次，但 Python `RoxyCdpClient._call()` 外层等待同样只有 60 秒；首个导航超时后 bridge 刚开始第 2 次尝试，Python 已提前退出，因此导航重试没有机会完成。
- 结论：问题位于 Roxy/CDP 导航超时预算，不是邮箱验证码、密码、Sentinel 或 OpenAI HTTP 业务响应。run `691` 未执行 `user/register`，账号仍为 `unregistered`。
- 下一步：按命令 timeout 和最大重试次数调整 bridge 外层等待预算（或将重试移到 Python），补“第 1 次导航超时、bridge 进入第 2 次时外层不提前超时”的回归测试，再重试账号 `211`。审计发现同一模式还覆盖步骤 4 authorize、各 `follow_auth_continue()`、进入密码页、OAuth callback 及跨 origin warm-up；需统一修复，不能只针对 `email-otp/send`。
- 2026-07-28 00:58 补充：账号 `210` 的 run `692` 没有导航超时，但步骤 7 `user/register` 返回 HTTP 400 `invalid_auth_step`。步骤 5 JSON 是 `email_otp_verification`，当前代码仅通过访问 `/create-account/password` 的 URL 认定已进入密码阶段，服务端响应证明该认定不成立。修复必须以 Auth JSON 和接口响应决定密码阶段，不得以 URL/DOM 推断。
- 2026-07-28 实施：`CHG-100` 状态为 `implemented`。bridge 后台页导航改为等待 HTTP `commit` 并返回脱敏重定向链；Python 等待预算覆盖 bridge 重试；OAuth callback 校验 HTTP 响应后仍以 session `accessToken` 终态确认。另修正密码阶段顺序：步骤 5 的 `email-otp/send` continuation 只能在 `user/register` 成功后跟随，避免提前进入 OTP 状态导致 `invalid_auth_step`。自动化测试 Node 12/12、Python 33/33 通过；账号 `210` 仍待实机重跑验收。
