# 2026-07-15 补号状态查询邮箱 API 日志映射修正

## 背景

用户在 `/replacement-ui` 看到：

```text
正在读取邮箱 API：http://5.253.38.136:8080/code
```

因此怀疑一键验活没有使用数据库账号对应的邮箱。该怀疑来自进度日志隐藏 URL query，而不是实际请求切换到了共享收件箱。

## 排查证据

- 数据库 `data/app.db` 中 `roll-happier-6@icloud.com` 的 `email_code_api` 为：
  `http://5.253.38.136:8080/code?email=roll-happier-6@icloud.com`
- `src/replacementEmailApiService.js` 直接将 `account.email_code_api` 传给 GET `fetch`，不会读取默认 Gmail，也不会回退 IMAP。
- 注入 `fetch` 的请求探针实际输出完整 URL：
  `http://5.253.38.136:8080/code?email=roll-happier-6@icloud.com`
- `src/accountHealthcheckService.js` 和 `src/replacementPlusStatusService.js` 原先的 `displayEmailApi()` 会移除 query/hash，导致日志只显示 `/code`。

## 修复

- 保留 URL query/hash 脱敏，避免将未知参数直接写入进度日志。
- Plus 状态查询和一键验活的“正在读取邮箱 API”日志追加当前数据库账号邮箱，显示为：

  ```text
  正在读取邮箱 API：http://5.253.38.136:8080/code（账号邮箱：roll-happier-6@icloud.com）
  ```

- 增加 Plus/验活进度事件回归断言，防止接口基址与账号邮箱映射再次丢失。

## 验证

- RED：新增的两条进度日志断言先分别因缺少账号邮箱而失败。
- GREEN：`node --test test\\accountHealthcheckService.test.js test\\replacementPlusStatusService.test.js test\\replacementEmailApiService.test.js` 通过 12/12。
- 数据库只读查询和请求 URL 探针确认实际请求为完整 `email_code_api`。
- `node --check`、`git diff --check` 通过。
- 全量 `node --test test/*.test.js` 通过 353/353。
- 重启 `13100` 服务后，`GET http://localhost:13100/login` 返回 200。

## 关联

- Change：`docs/changes/CHG-080-replacement-status-email-api-source.md`
- API 文档：`docs/project/api.md`
