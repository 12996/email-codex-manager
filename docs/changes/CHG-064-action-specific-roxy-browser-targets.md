# CHG-064 自动化动作级 Roxy 窗口配置

状态：implemented

创建日期：2026-07-03

关联 PRD：PRD-003

## 背景

注册、2FA 登录、普通补号和 2FA 补号默认继承同一组全局 Roxy 窗口配置，容易互相抢占同一个 profile。需要支持按动作指定不同 Roxy 窗口。

## 变更内容

- `replacementServices` 在启动子进程前按动作映射 Roxy 目标窗口：
  - 注册：`ROXY_REGISTER_BROWSER_DIR_ID` / `ROXY_REGISTER_BROWSER_SORT_NUM` / `ROXY_REGISTER_BROWSER_WINDOW_NAME` / `ROXY_REGISTER_CDP_ENDPOINT`
  - 普通补号：`ROXY_REPLACE_BROWSER_DIR_ID` / `ROXY_REPLACE_BROWSER_SORT_NUM` / `ROXY_REPLACE_BROWSER_WINDOW_NAME` / `ROXY_REPLACE_CDP_ENDPOINT`
  - 2FA 补号：`ROXY_REPLACE_2FA_BROWSER_DIR_ID` / `ROXY_REPLACE_2FA_BROWSER_SORT_NUM` / `ROXY_REPLACE_2FA_BROWSER_WINDOW_NAME` / `ROXY_REPLACE_2FA_CDP_ENDPOINT`
  - 2FA 登录：`ROXY_2FA_LOGIN_BROWSER_DIR_ID` / `ROXY_2FA_LOGIN_BROWSER_SORT_NUM` / `ROXY_2FA_LOGIN_BROWSER_WINDOW_NAME` / `ROXY_2FA_LOGIN_CDP_ENDPOINT`
- 动作级窗口变量存在时，会覆盖全局 `ROXY_BROWSER_*`。
- 动作级窗口变量存在但动作级 CDP 为空时，会清除全局 `ROXY_CDP_ENDPOINT`，避免所有动作复用同一个 CDP。
- 更新 `.env.example` 和部署/API 文档。

## 验收标准

- [x] 四类动作可分别注入不同 `ROXY_BROWSER_*`。
- [x] 动作级窗口配置能覆盖全局 `ROXY_BROWSER_DIR_ID` 优先级。
- [x] 动作级窗口配置存在时不会误继承全局 `ROXY_CDP_ENDPOINT`。
- [x] 未配置动作级变量时仍保持原全局配置行为。

## 实现记录

实现日期：2026-07-03

- `src/replacementServices.js` 新增 `applyActionRoxyTargetEnv()`。
- `test/replacementServices.test.js` 新增动作级 Roxy 目标窗口测试。
- `.env.example`、`docs/project/deployment.md`、`docs/project/api.md` 已补充配置说明。

## 回滚

删除 `applyActionRoxyTargetEnv()` 调用和动作级 `.env` 文档；恢复各子进程只继承全局 `ROXY_BROWSER_*` / `ROXY_CDP_ENDPOINT` 即可回滚。
