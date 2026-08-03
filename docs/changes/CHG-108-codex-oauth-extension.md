# CHG-108 纯 Chrome 扩展 Codex OAuth 登录与 RT 下载

状态：accepted
创建日期：2026-08-03
关联 PRD：PRD-003

## 背景

需要提供可供 Windows Chrome/Edge 用户在无痕窗口使用的 Codex OAuth 登录扩展。该扩展不能依赖或改变
本机 Codex CLI 登录，也不能要求安装 Native Messaging Host 或本机回调服务。

## 变更内容

- 新增独立 Manifest V3 Chrome 扩展，默认仅对用户输入的 AT 做本地格式、JWT 可解析性和声明过期时间预检；预检
  结果不阻止用户另行发起网页登录。
- 用户触发“网页登录 Codex”后，扩展创建 PKCE 事务，用户在真实 OAuth 页面自行处理其账户要求的邮箱、密码、
  手机号、验证码和授权确认步骤。
- 扩展监听同一认证 tab 到 `http://localhost:1455/auth/callback` 的跳转；不监听 1455 端口。仅在 callback
  path、`code` 和 `state` 均有效时兑换授权码。
- token exchange 只有返回非空 refresh token (RT) 时才视为登录成功；回调、点击或连接失败页面不得单独判定成功。
- 登录成功后显示 token claim 可提供的邮箱和套餐类型；缺失信息显示“未提供”。
- 增加用户主动触发的“下载 RT”按钮，下载文件只包含 RT；下载、取消、超时、失败或手动清除后删除本次敏感内存。
- AT、RT、授权码、PKCE verifier、Cookie 和完整响应不写入持久 Chrome storage、日志、URL 或远程服务。

## 非目标

- 不调用 `codex login`、`codex logout`，不读取或修改现有 Codex CLI 凭据。
- 不把 AT 转换为网页登录 Cookie，也不自动填写或绕过 OAuth 页面中的账户、手机号、MFA 或重新认证要求。
- 不提供本机端口监听、Native Messaging、Codex 对话或代码生成功能。

## 验收标准

- [ ] 扩展可在用户手动启用无痕权限后运行；不需要本机 CLI 或监听服务。
- [ ] 只有匹配的 1455 callback 且 token exchange 返回非空 RT 时才显示登录成功和下载按钮。
- [ ] `state` 不匹配、缺少 code、OAuth error、兑换失败、RT 缺失及连接错误不会误判成功，并会清除敏感内存。
- [ ] 下载产物只包含 RT；文件名、日志、错误和 UI 不泄露凭据。
- [ ] 回归测试覆盖 callback 竞态、错误/缺失字段、下载和敏感数据清除。

## 合并记录

- 合并目标 PRD：
- 合并日期：
- 备注：
