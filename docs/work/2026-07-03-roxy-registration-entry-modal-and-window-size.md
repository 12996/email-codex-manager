# 2026-07-03 Roxy 注册入口 modal 与窗口大小

## 背景

注册自动化访问 `https://chatgpt.com/` 后失败，日志报“未找到 ChatGPT 登录/注册按钮”。连接当前 Roxy 窗口和异常截图确认：页面实际已打开 `Log in or sign up` modal，且 modal 内已有 `Email address` 输入框和 `Continue` 按钮。

## 处理

- 确认当前 Roxy 窗口状态：
  - URL：`https://chatgpt.com/`
  - modal：`Log in or sign up`
  - 可见邮箱输入框：`Email address`
- `src/auto/roxy_register_openai.js`
  - 新增 `prepareChatGptEmailEntry()`。
  - 当前页已有邮箱输入框时直接继续填写邮箱。
  - 未出现邮箱输入框时优先点击 `Log in`，再回退 `Sign up`。
  - 主入口和超时恢复入口都复用该函数。
- `src/auto/roxy_oauth_login.js`
  - Roxy 开窗默认传入 `--window-size=2048,1152`。
  - 支持 `ROXY_WINDOW_WIDTH` / `ROXY_WINDOW_HEIGHT` / `ROXY_WINDOW_SIZE` 覆盖。
- `src/auto/roxy-browser-client.cjs`
  - 新增 `updateBrowserConfig()`，用于调用 Roxy `/browser/mdf` 修改 profile。
- 二次修正
  - 实机发现单独传 `--window-size=2048,1152` 会被 Roxy profile 覆盖，窗口仍约 `1000x1000`。
  - 已改为每次 `randomFingerprint()` 后、`openBrowser()` 前写入 `fingerInfo.openWidth/openHeight`，再传 `--window-size` 兜底。

## 验证

- RED：新增测试后，`prepareChatGptEmailEntry is not a function`，窗口参数断言失败；二次 RED 失败于 `updateBrowserConfig is not a function` 和开窗前未写 profile。
- GREEN：`node --test test\roxyRegisterOpenai.test.js test\roxyOauthLogin.test.js` 通过，84/84 pass；`node --test test\roxyOauthLogin.test.js test\roxyBrowserClient.test.js` 通过，81/81 pass。
- 实机注册：`POST /replacement-accounts/56/register` 创建 run `350`，状态 `succeeded`，入口、邮箱验证码、资料页、主站、session token 保存和注册后 2FA 启用均完成。
- 实机窗口尺寸：开窗前写入 Roxy profile 后，验证得到 `outerWidth=2048`、`outerHeight=1152`。

## 待办

- 当前 `node src/server.js` 已重启，运行中服务已加载入口和窗口尺寸修复。
- 后续如继续注册新号，确认 RoxyBrowser 不会因其他 profile 策略覆盖 `fingerInfo.openWidth/openHeight`。
