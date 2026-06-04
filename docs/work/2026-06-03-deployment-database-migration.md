# 2026-06-03 部署文档与数据库迁移说明

## 背景

项目准备迁移到另一台电脑，需要明确 SQLite 数据库、运行日志和自动化产物的迁移位置。

## 本次处理

- 确认项目默认数据库为 `data/app.db`，由 `DATABASE_PATH` 控制。
- 在 `docs/project/deployment.md` 补充部署环境变量、启动方式和部署检查项。
- 补充数据库迁移步骤：停止旧服务后复制 `data/app.db` 到新电脑相同项目目录。
- 补充完整迁移建议：同步复制 `.env`、`data/automation-logs/`、`src/auto/product_files/cpa/` 和 `src/auto/product_files/sub2api/`。
- 补充 RoxyBrowser 自动补号必填参数：`ROXY_API_BASE_URL` / `ROXY_API_PORT`、`ROXY_API_TOKEN`、`ROXY_WORKSPACE_ID`、窗口定位参数。
- 补充 Roxy 参数获取方式：通过 `/workspace/list` 获取 workspace ID，通过 `/browser/list?workspaceId=...` 获取窗口 `sortNum` / `windowSortNum` / `SN`，并说明常见权限和窗口匹配错误。

## 验证

- 已读取 `src/config.js`、`src/db.js`、`.env.example` 和当前 `data/` 目录确认路径。
- 已重新读取 `docs/project/deployment.md`，确认文档内容可读。
- 已根据 `src/auto/roxy-browser-client.cjs` 的实际环境变量和接口调用方式补充 RoxyBrowser 参数说明。

## 影响范围

- 仅更新项目部署文档和工作记录。
- 未修改运行代码、数据库结构或测试。
