# 2026-08-03 Roxy 无 2FA 浏览器注册

## 完成内容

- 新增 `src/auto/roxy_no_2fa_register.js`，可直接运行：

  ```powershell
  node .\src\auto\roxy_no_2fa_register.js --email <unregistered-email>
  ```

- 可选 `--name` 和 `--birthday YYYY-MM-DD`；未传时使用生成姓名和默认生日。
- 标准路径按 `prepare_roxy_no_2fa.cjs` 刷新 Roxy；配置 `ROXY_NO_2FA_PREPARER` 时按手动刷新脚本
  准备的 profile 连接 CDP，不向 stdout 转发准备器原始输出。
- 自动化只处理邮箱、OTP、资料页和 ChatGPT session；密码、TOTP、`user/register` 均不在分支内。
- session AT 落盘成功后才调用本地状态接口回写 `registered`。现有“无2FA注册”网页操作仍使用 Python 协议 runner，未切换。

## 验证

- `node --test test/roxyNo2FaRegister.test.js test/prepareRoxyNo2FA.test.js`
- `node --check src/auto/roxy_no_2fa_register.js`
- `node --check src/auto/roxy_register_openai.js`

## 真实页面录制与手动验收

- 已由用户在当前 Roxy profile 手动完成：ChatGPT 邮箱入口 → OTP → `/about-you` → ChatGPT callback。
- 实际 DOM：邮箱入口 `input[name="email"]`；OTP `input[name="code"]`、`autocomplete="one-time-code"`、6 位；
  资料页 `input[name="name"]`、`input[name="age"]`；提交按钮为 `Finish creating account`。
- 当前录制段的网络顺序：`POST /api/accounts/email-otp/resend`（`200 { success }`）→
  `POST /api/accounts/email-otp/validate`（body field `code`，`200 page.type=about_you`）→
  `POST /api/accounts/create_account`（body fields `name`、`birthdate`，`200 page.type=external_url`）→
  ChatGPT callback。未出现 password、`user/register` 或 TOTP。
- 已从当前 ChatGPT session 安全读取 AT，先写入 `src/auto/product_files/registration/`，再将该补号账号回写为
  `registered`。文件非空且无换行；AT、OTP、Cookie 和 endpoint 未输出。
- 录制期间发现网络 recorder 会混入旧段、DOM recorder 会写 endpoint；已修复为新 run 覆盖写入、endpoint 脱敏，
  并为三个 recorder 加入 10 秒附着 timeout。
- 浏览器 runner 本身尚未用第二个新的 `unregistered` 邮箱全自动跑完；但实际 UI、网络状态和 AT/状态结算已由
  本次手动流程确认，后续自动验收不得复用本次已注册账号。

## CDP 附着韧性补充

- 运行态确认：Roxy 未打开时 `/browser/connection_info` 返回空；重新按
  `test/manual-roxy-proxy-refresh.cjs` 打开 profile 后，原生 CDP 与 `playwright-core@1.60.0`
  对 Chrome 149 的附着均正常，连续五次附着成功。
- `src/auto/roxy-browser-client.cjs` 新增有限 connection-info 轮询、10 秒 Playwright 附着 timeout 和
  重新读取 endpoint 的三次重试；无 2FA runner 改用该入口。
- 新增 `test/manual-roxy-cdp-attach-probe.cjs`，只读检查 CDP transport、关键 Target 命令和
  Playwright 附着，不输出 endpoint 或凭据。
- 专项回归：`node --test test/roxyBrowserClient.test.cjs test/roxyNo2FaRegister.test.js test/prepareRoxyNo2FA.test.js test/roxyCdpBridge.test.js`，25/25 通过。
- 实机只读验证：新的 `connectReadyPlaywright()` 约 322ms 附着成功；未导航、未输入邮箱、未发送 OTP。
- 全量 `npm test`：48/48 通过。期间将 `test/manualRoxyProxyRefreshRunner.test.js` 的两项旧 TTL 断言从
  5 同步为仓库当前手动刷新配置的 10；未修改代理配置或注册流程。

## 第二次真实浏览器自动验收

- 使用新的 `unregistered` 测试账号启动 `roxy_no_2fa_register.js`。前置校验确认账号 ID/邮箱匹配且配置了
  `email_code_api`；启动后 Roxy 曾因残留 profile 进程无法取得 Chrome 调试端口，清理该 profile 的失联
  RoxyChrome 进程树后恢复。
- runner 自动到达 OTP 页。实机发现两个可复现缺口：外部邮箱验证码 API 的首次瞬时请求异常未重试；旧 OTP
  被拒绝后仅排除旧码，未点击 `Resend email`。已先补失败测试，再加入有限重试和 resend 分支。
- 修复后实机验证确实自动完成 OTP、资料页姓名/年龄填写和提交，但 callback 进入 ChatGPT `/auth/error`；
  session HTTP 200 未返回 AT。已将该 URL 显式分类为 `auth-error`，避免把它误判为已登录。
- 用户指出 about-you 不能只凭 UI 填写/点击推断正确。已依据成功录制补上 `create_account` response guard：点击前
  监听该请求，确认 2xx、`name`/`birthdate` 字段及 `page.type=external_url` 后才进入 callback 阶段。
- 当前测试账号保持 `unregistered`，没有 AT 文件。后续需要新的未注册账号并从 callback 前启动 network recorder，
  详见 `docs/issues/issue-024-roxy-no2fa-chatgpt-auth-error.md`。
- 本轮新增回归：`test/roxyRegisterOpenaiEmailCode.test.cjs` 与 `test/roxyNo2FaRegister.test.js`；当前专项测试
  25/25 通过；全量 `npm test` 为 55/55 通过。

## 完整自动验收

- 使用另一枚新的 `unregistered` 账号，以与 runner 相同的手动 Roxy 刷新顺序准备 profile；启动后从邮箱输入前
  开启 schema-only CDP network recorder。
- 自动流程完成邮箱 OTP、about-you、callback 与 session。录制确认 `create_account` 请求字段为 `name`、
  `birthdate`，响应 HTTP 200、`page.type=external_url`。
- 浏览器 `/api/auth/session` 已确认返回非空 AT；AT 文件非空、无换行，随后本地补号状态为 `registered`。
  AT、OTP、Cookie、CDP endpoint 和代理凭据均未输出。

## Session AT 可见导航调整

- 用户要求不使用后台 `fetch` 读取 AT。`readSessionAccessToken()` 已改为将当前可见 Roxy 页面导航到
  `https://chatgpt.com/api/auth/session`，读取该顶层 JSON 响应的 `accessToken` 后才落盘。
- 保留最多 5 次、默认 3 秒间隔的导航重试；401/403 仍按未登录失败，不写 AT、不回写状态。
- 回归测试覆盖显式 session URL 导航、空响应重试和瞬时导航失败重试；不在测试、日志或文档中输出 token。

## 可见 Session 导航实机测试

- 新的未注册测试账号在 browser runner 中通过邮箱、OTP 和资料页；资料提交请求的状态码和字段均符合 guard，
  但响应 body 未识别为 `external_url`，runner 在自身 session 阶段前以
  `NO2FA_PROFILE_RESPONSE_INVALID` 停止。
- 运行态页面实际已进入 ChatGPT 首页。由于该账号不能重复注册，使用同一可见 Roxy tab 导航至
  `https://chatgpt.com/api/auth/session`，确认 session 归属邮箱匹配、AT 非空；随后按“先落盘、再回写”顺序
  完成 AT 文件和 `registered` 状态。
- 这证明可见 session 导航、AT 落盘和状态回写链路可用，但不构成 browser runner 对该响应变体的完整自动验收；
  已记录 `docs/issues/issue-025-roxy-no2fa-create-account-response-variant.md`，下次须使用新账号录制响应结构后修复。

## 补号管理自动化无 2FA 操作

- 补号操作菜单首项已调整为“编辑账号”，并新增“自动化无2FA注册”。旧“无2FA注册”继续调用 Python 协议
  runner，新操作经 `/replacement-accounts/:id/register-no2fa-browser` 调用 Node browser runner。
- 两个无 2FA 操作共用单线程注册队列，避免共享 Roxy profile 并发。browser runner 成功后，服务复查
  `registered`；UI 队列和日志使用“自动化无2FA注册”区分该路径。
- 本地 `.env` 已指向已验证的 `test/manual-roxy-proxy-refresh.cjs` 准备器；正在运行的服务需重启后才会读取。

## 新标签页 Session、随机资料与资料页延迟诊断

- 旧一次成功 run 在当前脚本写入新标签页实现前结束，不能视为该实现的实机验收。后续必须使用新的
  `unregistered` 账号验证，不得复用已成功账号。
- 当前 runner 从完成注册主页面的同一 BrowserContext 创建新 tab，并只在该 tab 顶层导航
  `https://chatgpt.com/api/auth/session` 读取 AT。主 ChatGPT 页面不导航、不调用 `evaluate(fetch())`。
  成功 session tab 在默认 `ROXY_KEEP_OPEN=1` 时保持可见；不能导航的空白 tab 才关闭。
- 未传 `--name` / `--birthday` 时，runner 随机生成姓名和 20 至 44 岁对应的合法生日；显式 CLI 参数仍保持固定。
- `/about-you` 首次找不到可用字段时，runner 会确认仍在 profile 状态后重试一次；未分类失败带阶段名与脱敏控件元数据，
  不输出敏感值。
- 验证：`node --test test/roxyNo2FaRegister.test.js` 28/28 通过，`npm test` 71/71 通过。
