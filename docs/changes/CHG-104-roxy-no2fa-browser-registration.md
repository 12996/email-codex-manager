# CHG-104 Roxy 无 2FA 浏览器注册脚本

状态：implemented
创建日期：2026-08-03
关联 PRD：PRD-003
关联 Issue：`issue-021-protocol-no2fa-trial-link-check.md`

## 背景

现有无 2FA 注册入口是经过实机验证的协议 runner。为对比手动浏览器流程产生的运行态，新增一个
独立浏览器自动化 runner；现有补号管理接口暂不切换到该 runner。

## 变更内容

- 新增 `src/auto/roxy_no_2fa_register.js`：邮箱 -> OTP -> 资料页 -> ChatGPT session 的无 2FA
  浏览器状态机。
- Roxy 准备默认复用 `prepare_roxy_no_2fa.cjs` 的绑定代理刷新顺序；配置
  `ROXY_NO_2FA_PREPARER` 时，执行手动准备器并只读取其新 profile 的 `dirId`，随后连接该 profile。
- 明确拒绝密码页、CAPTCHA、已注册邮箱和无效阶段；不调用 password、`user/register` 或 TOTP。
- 仅 `/api/auth/session` 返回非空 `accessToken` 才成功。AT 先写入
  `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt`，再经本地补号服务回写 `registered`。
- CLI stdout 只输出邮箱和 AT 文件路径；不输出 AT、OTP、Cookie、CDP endpoint 或代理凭据。
- 为复用资料页逻辑，`roxy_register_openai.js` 的 Continue/输入操作增加可操作性检查，并导出资料页和
  Continue helper。
- Roxy 连接改为先有限轮询 `/browser/connection_info`，再以 10 秒 timeout 附着 Playwright；附着失败时
  必须重新读取 connection info 后有限重试，最终在连接阶段停止，不进入页面注册状态机。
- 新增 `test/manual-roxy-cdp-attach-probe.cjs` 只读探针，用于区分“没有活动 CDP”与 Playwright 附着失败；
  不导航、不填表、不输出 endpoint 或凭据。
- 已根据真实页面录制确认无 2FA UI：邮箱 OTP 使用 `input[name="code"]`，资料页使用
  `input[name="name"]` 与 `input[name="age"]`，提交为 `Finish creating account`。当资料页只显示年龄时，
  配置的 `birthday` 会换算为年龄，不再随机覆盖。
- 三个 recorder 均使用 10 秒 CDP 附着 timeout；网络 recorder 在开始时创建新的记录段，DOM recorder 的
  启动记录不再写入 endpoint。

## 非目标

- 不修改 `POST /replacement-accounts/:id/register-no2fa` 当前调用的 Python 协议 runner。
- 不根据 URL 改变、元素消失或 click 返回值判定注册成功。
- 不用本 runner 重跑已注册邮箱。

## 验收标准

- [x] Roxy 按手动刷新同序准备，且外部准备器输出不转发到日志。
- [x] OTP 和资料提交后均等待专用下一阶段；disabled/readOnly/inert 输入和按钮不会操作。
- [x] session 空响应或瞬时浏览器请求错误会有限重试；无 AT 不写文件、不回写状态。
- [x] AT 写入失败不回写 `registered`；状态回写失败不删除已保存的 AT。
- [x] 新增 Node 回归覆盖密码阶段拒绝、OTP 短暂停留、disabled 输入、session 重试、AT/状态顺序和敏感值不输出。
- [x] connection info 为空时有限轮询；Playwright 附着带 10 秒上限，重试前重新读取当前 endpoint。
- [x] 连接耗尽返回稳定错误码且不包含 endpoint；无 2FA runner 仅经就绪连接入口附着。
- [x] 实录确认 OTP-first 无密码路径：`email-otp/resend` → `email-otp/validate`（`page.type=about_you`）
  → `create_account`（`page.type=external_url`）→ ChatGPT callback → session AT；未发生 `user/register` 或 TOTP。
- [x] 手动完成的真实 session 已验证 AT 落盘后回写 `registered`；AT 不输出到 CLI、日志或文档。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
