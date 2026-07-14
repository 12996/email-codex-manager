# CHG-060 Roxy 注册入口兼容邮箱 modal 并固定窗口大小

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

实机注册失败截图显示 `https://chatgpt.com/` 已弹出 `Log in or sign up` 邮箱输入 modal，但自动化仍按旧逻辑寻找顶层 `Log in` / `Sign up` 入口按钮，导致报错“未找到 ChatGPT 登录/注册按钮”。同时用户希望每次启动 Roxy 浏览器时使用当前相同窗口大小。

## 目标

- ChatGPT 入口页已出现邮箱输入框时，直接进入填写邮箱步骤，不再强依赖点击 `Sign up`。
- 入口打开逻辑优先点击 `Log in`，走新版 `signin/openai` 合并链路；只有不可用时再回退 `Sign up`。
- Roxy 开窗时默认写入并传入当前实机尺寸 `2048x1152`，并允许通过环境变量覆盖。

## 验收标准

- [x] 当前页已有 `input[type="email"]` / `input[name="email"]` 时，注册流程不再查询或点击登录/注册按钮。
- [x] 入口页未直接出现邮箱输入框时，自动化优先点击 `Log in`，再等待邮箱输入框。
- [x] Roxy 开窗前写入 Roxy profile `fingerInfo.openWidth/openHeight=2048/1152`，并同时传入 `--window-size=2048,1152` 兜底。
- [x] 可用 `ROXY_WINDOW_WIDTH` / `ROXY_WINDOW_HEIGHT` 或 `ROXY_WINDOW_SIZE=1600x900` 覆盖窗口尺寸。
- [x] `ROXY_WINDOW_SIZE=off` 可关闭窗口尺寸参数。

## 实现记录

实现日期：2026-07-03

- `src/auto/roxy_register_openai.js` 新增 `prepareChatGptEmailEntry()`，统一处理已打开邮箱 modal、优先 `Log in`、回退 `Sign up` 三种入口状态。
- 注册主流程与 `Operation timed out` 恢复流程都改为先准备邮箱输入入口，再填写邮箱。
- `src/auto/roxy_oauth_login.js` 的 `resolveRoxyOpenArgs()` 增加默认窗口尺寸参数和环境变量覆盖；`openRoxyBrowserForAutomation()` 在随机指纹后、开窗前调用 Roxy profile 修改接口写入窗口尺寸。
- `src/auto/roxy-browser-client.cjs` 新增 `updateBrowserConfig()`，调用 `/browser/mdf`。
- 更新 `test/roxyRegisterOpenai.test.js`、`test/roxyOauthLogin.test.js` 与 `test/roxyBrowserClient.test.js` 覆盖入口 modal、窗口参数和 Roxy profile 写入。

## 验证记录

- 实机注册 run `350` 成功，不再卡在 ChatGPT 入口；流程完成到验证码、资料页、主站、session token 保存和 2FA 启用。
- 首次窗口参数验证显示 `--window-size=2048,1152` 已传入但实际 `outerWidth/outerHeight=1000/1000`，确认 Roxy profile 覆盖 Chrome args。
- 改为开窗前写入 Roxy profile 后，实机只开窗验证得到 `outerWidth=2048`、`outerHeight=1152`。

## 回滚

恢复注册入口逻辑为旧的 `Sign up -> Log in -> Create account` 分支，并将 `resolveRoxyOpenArgs()` 恢复为只按 `ROXY_HEADLESS` 返回 headless 参数即可回滚。
