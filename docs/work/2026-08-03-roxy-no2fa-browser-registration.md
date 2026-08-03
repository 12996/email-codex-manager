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
