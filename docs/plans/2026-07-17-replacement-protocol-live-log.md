# 补号协议注册实时日志 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在补号管理页通过 SSE 实时显示当前单账号协议注册的 Roxy 准备过程和协议子进程 stdout/stderr，同时保持后台运行记录及 30 条保留策略不变。

**Architecture:** 保持现有 `POST /replacement-accounts/:id/register-protocol` 路由兼容：带 `Accept: text/event-stream` 时流式返回事件，普通请求仍返回 JSON。服务层把 Roxy 准备步骤和 `runChildProcess` 的 stdout/stderr 通过可选回调转发给路由；前端在账号列表下方增加临时日志面板，只在内存中保存当前任务。

**Tech Stack:** Node.js ESM, Express-compatible server, SSE, vanilla JavaScript, node:test, SQLite-backed existing automation run repository.

---

### Task 1: 为服务层日志转发写失败测试

**Files:**
- Modify: `test/replacementServices.test.js`
- Reference: `src/replacementServices.js:335-392`, `src/replacementServices.js:522-653`

**Step 1: Write the failing test**

增加一个协议注册测试，注入 `onLog` 回调，让模拟 Roxy 准备器和 child process 分别产生 `step`、`stdout`、`stderr` 事件，断言回调收到来源、文本和阶段信息，同时保持返回结果与运行记录行为不变。

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="protocol.*log|log.*protocol" test/replacementServices.test.js`

Expected: FAIL，因为当前 `registerProtocolAccount` 不接受日志回调，`runChildProcess` 也不会转发输出。

**Step 3: Write minimal implementation**

在 `registerProtocolAccount(account, options)` 中读取可选 `options.onLog`，将 Roxy 准备阶段按步骤转发；在 `runChildProcess` 中增加可选 `onLog`，stdout/stderr 收到 chunk 时先保持现有文件写入，再调用回调。回调异常不得影响子进程执行。

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="protocol.*log|log.*protocol" test/replacementServices.test.js`

Expected: PASS。

### Task 2: 为协议注册 SSE 路由写失败测试

**Files:**
- Modify: `test/replacementAccountsApi.test.js`
- Reference: `src/server.js:552-568`, `src/server.js:745-770`

**Step 1: Write the failing test**

增加带 `Accept: text/event-stream` 的协议注册请求，测试替代 service 触发日志回调后，响应包含 `start`/`log`/`complete` 事件；同时保留一个普通请求断言 JSON 响应不变。

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="protocol registration.*SSE|protocol.*stream" test/replacementAccountsApi.test.js`

Expected: FAIL，因为当前路由始终等待 service 完成后返回 JSON。

**Step 3: Write minimal implementation**

复用 `streamProgressResponse` 的 SSE 头和生命周期，在协议路由中按请求头选择流式分支；调用 service 时传入 `onLog`，把日志事件包装为账号上下文事件；成功时发送 `complete`，异常时发送 `error`，并继续执行现有状态更新/失败记录逻辑。

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="protocol registration.*SSE|protocol.*stream" test/replacementAccountsApi.test.js`

Expected: PASS。

### Task 3: 为网页临时日志面板写失败测试

**Files:**
- Modify: `test/replacementAccountsWeb.test.js`
- Reference: `web/index.html:103-124`, `web/index.html:210-217`, `web/app.js:647-657`

**Step 1: Write the failing test**

断言页面在账号列表和快捷操作之间存在当前协议注册日志面板及清空/状态元素；断言前端协议注册请求使用 `text/event-stream`，处理 `protocol-log`/`complete`/`error` 事件，且不会调用 `addActivity` 写入历史活动。

**Step 2: Run test to verify it fails**

Run: `npm test -- --test-name-pattern="protocol.*live|协议注册.*日志|实时日志" test/replacementAccountsWeb.test.js`

Expected: FAIL，因为当前页面只有弹窗进度结构，协议注册使用普通 JSON 且会写入 activity。

**Step 3: Write minimal implementation**

在 `web/index.html` 增加内嵌面板；在 `web/app.js` 增加当前日志状态、SSE 读取和 chunk 渲染逻辑。开始新任务时清空面板，页面刷新自然丢失状态；协议注册不再追加原始日志到 `state.activity`。在 `web/styles.css` 增加面板、状态标签和 stdout/stderr 样式。

**Step 4: Run test to verify it passes**

Run: `npm test -- --test-name-pattern="protocol.*live|协议注册.*日志|实时日志" test/replacementAccountsWeb.test.js`

Expected: PASS。

### Task 4: 做最小化重构并运行专项回归

**Files:**
- Modify: `src/replacementServices.js`
- Modify: `src/server.js`
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `web/styles.css`

**Step 1: Run focused tests before refactor**

Run: `npm test -- test/replacementServices.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js`

Expected: Existing focused tests pass except the newly added red tests.

**Step 2: Implement the smallest passing path**

只增加日志回调和 SSE 分支，不改变数据库表、运行记录清理、Roxy single-flight、协议命令参数或 token 输出目录。

**Step 3: Run focused tests**

Run: `npm test -- test/replacementServices.test.js test/replacementAccountsApi.test.js test/replacementAccountsWeb.test.js`

Expected: All focused tests pass。

### Task 5: 验证页面行为和全量回归

**Files:**
- Verify: `docs/plans/2026-07-17-replacement-protocol-live-log-design.md`
- Verify: existing `.env.example` and `src/config.js` retain `REPLACEMENT_AUTOMATION_LOG_MAX_RUNS` default 30.

**Step 1: Run static checks**

Run: `git diff --check`

Expected: no output and exit code 0。

**Step 2: Run Node tests**

Run: `npm test`

Expected: all Node tests pass。

**Step 3: Manually verify the page**

Open `http://localhost:13100/replacement-ui`, click one row's “协议注册”, and confirm:

- the inline panel appears above “快捷操作”;
- logs append while the child process is running;
- failure/success remains visible only for the current page session;
- refresh clears the panel;
- `/replacement-automation-logs` still exposes the persisted run and existing 30-record retention configuration.

**Step 4: Review the diff**

Run: `git diff --stat; git diff -- src/replacementServices.js src/server.js web/index.html web/app.js web/styles.css`

Expected: only the live-log behavior and its tests/docs are changed; no queue, retry, retention-limit, or database migration changes。
