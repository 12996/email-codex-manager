# issue-012 Roxy 2FA session 登录状态判定风险

状态：resolved

## 现象

- `src/auto/roxy_2fa_login.js` 的 ChatGPT session 登录状态机在页面过渡和 session 请求异常时存在误判或丢阶段风险。
- 具体风险包括：阶段等待最后一次等待后才完成导航、页面内 session 无 token 时把可视页面导航到 session JSON、disabled 控件被当成可操作控件，以及非 ChatGPT origin 的 URL 被识别为 callback。

## 复现

1. 在动作提交后让页面在阶段等待窗口的最后一次等待期间切换到下一阶段。
2. 页面内 `/api/auth/session` 请求返回空值或请求失败，但 page 仍有 `evaluate` 能力。
3. 登录按钮或邮箱输入框可见但 disabled/readOnly。
4. 当前 URL 的 query 中包含 `chatgpt.com/api/auth/callback/openai`，但实际 origin 不是 `https://chatgpt.com`。

## 期望 / 实际

- 期望：阶段判定只接受明确且可操作的页面；session 获取不改变主页面；callback 必须匹配正确 origin/path。
- 实际：旧逻辑只检查可见性，阶段等待没有最终复查，session 空响应会 fallback 到 `page.goto()`，callback 只做字符串包含判断。

## 排查

- `docs/work/2026-07-07-roxy-2fa-login-stage-detection.md` 已规定页面内 session fetch 优先且不导航主页面，但当前代码条件是 `if (!session && page.goto)`，没有限定“无 evaluate 才回退”。
- `waitForKnownStage()` 与此前已修复的 2FA OAuth 状态机存在相同的超时边界竞态。
- 真实登录路径要求 `chatgpt-entry -> openai-email -> openai-password -> openai-mfa -> chatgpt-home`，因此控件可用性和动作后复查必须同时覆盖。

## 修复

- 增加统一的 control/input 可用性判定，检查 visible、`isEnabled()`、`isEditable()`，并排除 `aria-disabled` / `inert`。
- OpenAI 邮箱阶段检测和提交动作均使用可用输入框判定；Continue、Log in 提交前再次确认按钮可操作。
- `waitForKnownStage()` 超时边界增加最终阶段复查。
- session 已有页面上下文 `evaluate` 时不再导航主页面；只有无 `evaluate` 能力时保留旧 `goto` fallback。
- callback 改为严格匹配 `https://chatgpt.com/api/auth/callback/openai` 的 origin 和 pathname。

## 验证

- RED：五类回归测试先分别暴露缺陷。
- GREEN：`node --test test/roxy2FALogin.test.js` 通过 13/13。
- `node --check src/auto/roxy_2fa_login.js`、`node --check test/roxy2FALogin.test.js` 和 `git diff --check` 通过。
