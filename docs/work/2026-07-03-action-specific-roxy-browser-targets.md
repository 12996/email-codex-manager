# 2026-07-03 自动化动作级 Roxy 窗口配置

## 目标

支持注册、2FA 登录、普通补号、2FA 补号分别使用不同 Roxy profile/window，避免多个自动化动作抢占同一个浏览器窗口。

## 实现

- `src/replacementServices.js`
  - 新增 `applyActionRoxyTargetEnv(env, prefix)`。
  - `replaceAccount()` 使用 `ROXY_REPLACE_*`。
  - `replaceAccountWith2FA()` 使用 `ROXY_REPLACE_2FA_*`。
  - `loginAccountWith2FA()` 使用 `ROXY_2FA_LOGIN_*`。
  - `registerAccount()` 使用 `ROXY_REGISTER_*`。
- 动作级窗口变量存在时删除全局窗口定位和全局 CDP，再写入对应动作目标，避免 `ROXY_BROWSER_DIR_ID` 或 `ROXY_CDP_ENDPOINT` 抢优先级。
- `.env.example` 和项目部署/API 文档已补充配置示例。

## 推荐配置

```env
ROXY_REGISTER_BROWSER_SORT_NUM=617-8
ROXY_2FA_LOGIN_BROWSER_SORT_NUM=617-9
ROXY_REPLACE_BROWSER_SORT_NUM=617-10
ROXY_REPLACE_2FA_BROWSER_SORT_NUM=617-11
```

## 验证

- RED：`node --test test\replacementServices.test.js` 失败于动作级窗口未覆盖全局窗口。
- GREEN：`node --test test\replacementServices.test.js` 通过 25/25。

## 待办

- 重启当前 `node src/server.js` 后新环境映射才会在 UI 触发的子进程中生效。
- 当前未合并的 `implemented` change 已超过 5 个，应安排 PRD 基线合并。
