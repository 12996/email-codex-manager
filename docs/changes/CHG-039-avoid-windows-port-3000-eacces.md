# CHG-039 避免 Windows 保留 3000 端口导致启动失败

状态：merged
创建日期：2026-06-06
关联 PRD：PRD-002
关联 Issue：issue-007
影响范围：`.env.example`, `README.md`, `docs/project/api.md`, `docs/project/deployment.md`, `src/auto/roxy_oauth_login.js`, `src/auto/roxy_register_openai.js`, `src/auto/roxy_oauth_steps_manual_test.js`, `test/`

## 背景

本机运行 `npm start` 时报错：

```text
Error: listen EACCES: permission denied 0.0.0.0:3000
```

排查确认 3000 未被进程占用，但 Windows TCP 排除端口范围包含 `2987-3086`，因此 3000 被系统保留，普通进程无法监听。

## 变更内容

- 修改：本机 `.env` 增加 `PORT=3100`，服务改为监听 3100。
- 修改：本机 `.env` 将 `VERIFICATION_CODE_API_URL` 留空，自动化子流程未显式配置验证码 API 时会按 `PORT` 推导。
- 修改：`.env.example` 增加 `PORT=3100`，并说明验证码 API 留空时自动跟随 `PORT`。
- 修改：Roxy OAuth / 注册自动化内置验证码 API 默认地址改为根据 `PORT` 动态生成。
- 修改：README、API 文档和部署文档中的默认访问地址/环境变量说明同步到 3100。
- 修改：相关测试中的验证码 API URL 期望同步到 3100。

## 验收标准

- [x] `npm start` 不再因监听 `0.0.0.0:3000` 报 `EACCES`。
- [x] 服务可通过 `http://127.0.0.1:3100/login` 访问。
- [x] 验证码 API 默认地址会随 `PORT` 变化。
- [x] 文档和示例配置不再引导使用当前环境不可用的 3000 端口。

## 合并记录

- 合并目标 PRD：`docs/prd/PRD-002-account-management-system.md`
- 合并日期：2026-06-07
- 备注：已合并到 PRD-002 最近基线，补充本机默认端口 3100，以及验证码 API 未显式配置时随 `PORT` 推导的需求。
