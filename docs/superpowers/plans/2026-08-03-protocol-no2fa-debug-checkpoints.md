# 无 2FA 协议注册调试断点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让网页发起的无 2FA 协议注册可在明确阶段受控终止、保留 Roxy Tab，并在队列中显示独立调试终态。

**Architecture:** `protocol_no_2fa_registration.py` 提供用户可编辑的阶段配置和 `debug_pause()` hook；核心状态机只在有注释的阶段边界调用该 hook。命中后核心抛出 `NoTwoFaDebugStop`，CDP bridge 断开但不关闭本次创建页面，CLI 输出无敏感值 JSON，子进程、队列和网页显示 `debug-stopped`。

**Tech Stack:** Python unittest、Node.js、现有 Roxy CDP bridge、Node test runner。

## Global Constraints

- 没有调试配置时，现有无 2FA 请求顺序、AT 保存、`registered` 回写和清理语义不变。
- `after-oauth-callback-before-at` 必须位于 OAuth callback 成功后、`GET /api/auth/session` 前；命中时不得获取、保存或输出 AT，也不得回写账号。
- 不调用、读取或保存 TOTP/2FA；日志、JSON 和文档不得包含 AT、OTP、Cookie、CDP endpoint 或代理凭据。
- 网页操作没有可交互 stdin；调试模式必须结束当前 job，而不能无限循环或等待 `input()`。
- 调试停止仅保留 bridge 创建的页面，仍要断开 CDP 连接和结束 bridge 子进程。
- 用户可只修改 `src/auto/protocol_no_2fa_registration.py` 的集中配置/控制函数；协议 core 只保存明确的阶段注释与 hook 调用。

---

### Task 1: 增加 Python 调试 hook 和阶段注释

**Files:**
- Modify: `src/auto/protocol_registration/core/no_2fa_registration.py`
- Modify: `src/auto/protocol_no_2fa_registration.py`
- Modify: `src/auto/protocol_registration/tests/test_no_2fa_registration.py`
- Modify: `src/auto/protocol_registration/tests/test_no_2fa_cli.py`

**Interfaces:**
- Produces: `NoTwoFaDebugStop(checkpoint: str)`。
- Produces: `run_no_2fa_registration(..., debug_pause: Callable[[str], bool] | None = None)` 和 `run_and_save_no_2fa_registration(..., debug_pause: Callable[[str], bool] | None = None)`。
- Produces: 入口脚本的 `debug_pause(stage: str, selected: set[str]) -> bool`、`--debug-stop-at` 和 `ROXY_NO_2FA_DEBUG_STOP_AT` 配置。

- [ ] **Step 1: 写失败的 Python 测试**

在 `test_no_2fa_registration.py` 让 fake session 收集 `preserve_owned_pages`，新增 AT 前断点测试：

```python
with self.assertRaises(self.subject.NoTwoFaDebugStop) as raised:
    self.subject.run_no_2fa_registration(
        "new.user@example.test", "New User", "2000-01-01",
        session_factory=lambda: session,
        wait_for_otp_fn=lambda *_args, **_kwargs: "123456",
        debug_pause=lambda stage: stage == "after-oauth-callback-before-at",
        sleep_fn=lambda _seconds: None,
    )
self.assertEqual(raised.exception.checkpoint, "after-oauth-callback-before-at")
self.assertTrue(session.preserve_owned_pages)
```

Mock `follow_oauth_callback` to record `callback` and mock `fetch_session` to fail if called. In `test_no_2fa_cli.py`, mock the core runner to raise `NoTwoFaDebugStop`; assert `main()` returns `0`, stdout contains only a `ROXY_REGISTER_RESULT_JSON=` record with `status=debug-stopped` and the checkpoint, and `mark_registered()` is never called.

- [ ] **Step 2: 运行测试确认失败**

Run from `src/auto/protocol_registration`:

```powershell
python -m unittest tests.test_no_2fa_registration tests.test_no_2fa_cli
```

Expected: FAIL because the exception, hook parameters, and structured debug result do not exist.

- [ ] **Step 3: 实现最小 hook 契约**

在 `core/no_2fa_registration.py` 添加：

```python
class NoTwoFaDebugStop(RuntimeError):
    def __init__(self, checkpoint: str):
        self.checkpoint = checkpoint
        super().__init__(f"no2fa debug stopped at {checkpoint}")

def _debug_pause(debug_pause, checkpoint: str) -> None:
    if debug_pause and debug_pause(checkpoint):
        raise NoTwoFaDebugStop(checkpoint)
```

在 `follow_authorize` 后、OTP 验证成功后、资料提交成功后、OAuth callback 后、AT 读取成功后加简短的中文阶段注释和 `_debug_pause(...)`。`run_and_save_no_2fa_registration()` 在文件写入成功后调用 `after-at-save`。发生 `NoTwoFaDebugStop` 时，`finally` 用 preserve close 参数清理；普通成功和异常仍使用默认 close。

在 `protocol_no_2fa_registration.py` 集中定义允许的阶段名、默认空的 `DEFAULT_DEBUG_STOP_AT`、逗号分隔解析器和可编辑的 `debug_pause()`。将 `--debug-stop-at` 的默认值按 CLI 参数、`ROXY_NO_2FA_DEBUG_STOP_AT`、默认常量解析。把 hook 传入 `execute_registration()`；在普通异常处理前捕获 `NoTwoFaDebugStop` 并输出：

```text
ROXY_REGISTER_RESULT_JSON={"status":"debug-stopped","checkpoint":"after-oauth-callback-before-at"}
```

返回 `0`，且该 JSON 不含邮箱或会话信息。

- [ ] **Step 4: 运行 Python 回归确认通过**

Run from `src/auto/protocol_registration`:

```powershell
python -m unittest tests.test_no_2fa_registration tests.test_no_2fa_cli
```

Expected: PASS; 正常路径仍保存 AT，AT 前断点不调用 `fetch_session` 或 `mark_registered`。

- [ ] **Step 5: 提交 Python hook**

```powershell
git add -- src/auto/protocol_no_2fa_registration.py src/auto/protocol_registration/core/no_2fa_registration.py src/auto/protocol_registration/tests/test_no_2fa_registration.py src/auto/protocol_registration/tests/test_no_2fa_cli.py
git commit -m "feat: add no2fa debug checkpoints"
```

### Task 2: 保留页面但安全断开 CDP bridge

**Files:**
- Modify: `src/auto/protocol_registration/core/session.py`
- Modify: `src/auto/protocol_registration/core/roxy_cdp.py`
- Modify: `src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs`
- Modify: `test/roxyCdpBridge.test.js`

**Interfaces:**
- Produces: `BrowserSession.close(*, preserve_owned_pages: bool = False)`。
- Produces: `RoxyCdpClient.close(*, preserve_owned_pages: bool = False)`。
- Produces: `RoxyCdpBridge.close({ preserve_owned_pages = false } = {})`。

- [ ] **Step 1: 写失败的 bridge 测试**

在 `test/roxyCdpBridge.test.js` 增加：

```js
test('disconnects without closing owned pages when debug preservation is requested', async () => {
  let pageClosed = false;
  let browserClosed = false;
  const page = { isClosed: () => false, close: async () => { pageClosed = true; } };
  const bridge = new RoxyCdpBridge();
  bridge.ownedPages.add(page);
  bridge.browser = { close: async () => { browserClosed = true; } };
  await bridge.close({ preserve_owned_pages: true });
  assert.equal(pageClosed, false);
  assert.equal(browserClosed, true);
});
```

再增加默认模式测试，断言 `bridge.close()` 仍关闭 owned page。

- [ ] **Step 2: 运行 bridge 测试确认失败**

Run:

```powershell
node --test test/roxyCdpBridge.test.js
```

Expected: FAIL because bridge currently always closes owned pages.

- [ ] **Step 3: 实现 preserve close 路径**

给 Python `BrowserSession.close()` 和 `RoxyCdpClient.close()` 添加关键字参数，默认 `False`。将参数传入 bridge close command；bridge 只在 `preserve_owned_pages` 为 false 时遍历并关闭 `ownedPages`，随后无论模式都调用 `browser.close()` 断开 CDP 并清除内部引用。

确保 Task 1 的 `NoTwoFaDebugStop` 路径使用：

```python
session.close(preserve_owned_pages=True)
```

- [ ] **Step 4: 运行 bridge 与 Python 回归**

Run:

```powershell
node --test test/roxyCdpBridge.test.js
```

Run from `src/auto/protocol_registration`:

```powershell
python -m unittest tests.test_no_2fa_registration tests.test_roxy_bridge
```

Expected: PASS; 保留模式只断开连接，默认模式仍关闭页面。

- [ ] **Step 5: 提交 preserve close**

```powershell
git add -- src/auto/protocol_registration/core/session.py src/auto/protocol_registration/core/roxy_cdp.py src/auto/protocol_registration/scripts/roxy_cdp_bridge.cjs test/roxyCdpBridge.test.js src/auto/protocol_registration/tests/test_no_2fa_registration.py
git commit -m "feat: preserve roxy tabs at no2fa debug checkpoints"
```

### Task 3: 传播 `debug-stopped` 到服务、队列和页面

**Files:**
- Modify: `src/replacementServices.js`
- Modify: `src/protocolRegistrationQueue.js`
- Modify: `src/server.js`
- Modify: `web/app.js`
- Modify: `test/no2faRegistrationAction.test.js`

**Interfaces:**
- Produces: child JSON `status=debug-stopped` 对应 `{ ok: true, debugStopped: true, debugCheckpoint }`。
- Produces: queue worker 返回 `{ state: 'debug-stopped', debugCheckpoint }` 时，快照保留该 state 和 checkpoint。
- Produces: 页面显示“调试已停在 <checkpoint>”，账号仍是 `unregistered`。

- [ ] **Step 1: 写失败的 Node 测试**

在 `test/no2faRegistrationAction.test.js` 增加：

```js
test('no2fa child debug stop is returned without child failure', async () => {
  // fake stdout: ROXY_REGISTER_RESULT_JSON={"status":"debug-stopped","checkpoint":"after-oauth-callback-before-at"}
  // fake exit code: 0; assert result.debugStopped and result.debugCheckpoint
});

test('protocol queue records a debug-stopped worker result', async () => {
  const queue = createProtocolRegistrationQueue({
    worker: async () => ({ state: 'debug-stopped', debugCheckpoint: 'after-oauth-callback-before-at' }),
  });
  queue.enqueue({ id: 9, email: 'new.user@example.test' }, { operation: 'no2fa-registration' });
  await queue.whenIdle();
  assert.equal(queue.getSnapshot().recent[0].state, 'debug-stopped');
});
```

添加 API 测试：fake `registerNo2faAccount()` 返回 debug result 后，队列 recent state 为 `debug-stopped`，账号仍为 `unregistered`。添加前端源码断言，确认有 `debug-stopped` 和“调试已停在”。

- [ ] **Step 2: 运行 Node 测试确认失败**

Run:

```powershell
node --test test/no2faRegistrationAction.test.js
```

Expected: FAIL because child result、queue state 和 UI label 尚不支持调试终态。

- [ ] **Step 3: 实现结果传播**

在 `runChildProcess()` 成功退出分支解析 `ROXY_REGISTER_RESULT_JSON` 后，只有精确
`status === 'debug-stopped'` 才映射为 `debugStopped` 与 `debugCheckpoint`，并将自动化运行记录标为 stopped。普通 exit 0 维持成功处理。

在 `server.js` 的 no2fa worker 中先处理：

```js
if (result.debugStopped) {
  return { state: 'debug-stopped', debugCheckpoint: result.debugCheckpoint };
}
```

这段必须在 `registered` 状态复查之前。`protocolRegistrationQueue.js` 保存 worker result 的 debug state 和 checkpoint；其他 worker result 继续映射为 succeeded。`web/app.js` 把 debug state 纳入终态检测、队列标签和实时日志概要，不使用错误样式，也不在 debug stopped 后刷新为已注册。

- [ ] **Step 4: 运行 Node 回归确认通过**

Run:

```powershell
node --test test/no2faRegistrationAction.test.js
```

Expected: PASS; 调试停止是独立终态，账号状态保持不变。

- [ ] **Step 5: 提交结果传播**

```powershell
git add -- src/replacementServices.js src/protocolRegistrationQueue.js src/server.js web/app.js test/no2faRegistrationAction.test.js
git commit -m "feat: report no2fa debug checkpoint stops"
```

### Task 4: 记录长期行为与实际调试前验证

**Files:**
- Create: `docs/changes/CHG-105-protocol-no2fa-debug-checkpoints.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Modify: `docs/project/protocol-no-2fa-registration-api.md`
- Modify: `docs/project/api.md`
- Create: `docs/work/2026-08-03-protocol-no2fa-debug-checkpoints.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Interfaces:**
- Produces: CHG-105，最终状态 `implemented`，说明 hook、AT 前停止、Tab 保留、账号不回写和队列终态。
- Produces: API 文档中 `ROXY_NO_2FA_DEBUG_STOP_AT` / `--debug-stop-at` 的阶段列表和行为边界。

- [ ] **Step 1: 创建 change 和项目文档更新**

按 `docs/templates/change-template.md` 创建 CHG-105，先标记 `draft` 并添加 registry 条目。记录所有允许阶段、AT 前断点、敏感信息禁止项和调试停止不回写账号。项目文档给出：

```text
ROXY_NO_2FA_DEBUG_STOP_AT=after-oauth-callback-before-at
```

以及等价 CLI 参数，明确网页按钮命中时 job 会成为 `debug-stopped`，不是 `registered`。

- [ ] **Step 2: 更新工作记录并将 change 标记 implemented**

创建当日工作记录，写入断点位置、验证命令、服务重启要求和页面保留边界；不写用户邮箱或敏感值。更新 `work-log.md` 和 `handoff.md`，再把 CHG-105 与 registry 更新为 `implemented`。

- [ ] **Step 3: 运行专项验证、语法检查和 diff 检查**

Run from `src/auto/protocol_registration`:

```powershell
python -m unittest tests.test_no_2fa_registration tests.test_no_2fa_cli tests.test_roxy_bridge
python -m py_compile ..\protocol_no_2fa_registration.py core\no_2fa_registration.py core\session.py core\roxy_cdp.py
```

Run from repository root:

```powershell
node --test test/no2faRegistrationAction.test.js test/roxyCdpBridge.test.js
node --check src\replacementServices.js
node --check src\protocolRegistrationQueue.js
node --check src\server.js
node --check web\app.js
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 4: 提交文档**

```powershell
git add -- docs/changes/CHG-105-protocol-no2fa-debug-checkpoints.md docs/changes/CHANGE_REGISTRY.md docs/project/protocol-no-2fa-registration-api.md docs/project/api.md docs/work/2026-08-03-protocol-no2fa-debug-checkpoints.md docs/work/work-log.md docs/work/handoff.md
git commit -m "docs: record no2fa debug checkpoints"
```

- [ ] **Step 5: 准备网页实机调试**

确认目标补号账号仍是 `unregistered`，在服务启动环境设置：

```text
ROXY_NO_2FA_DEBUG_STOP_AT=after-oauth-callback-before-at
```

重启服务后从“无2FA注册”按钮触发。验收：队列显示“调试已停在 after-oauth-callback-before-at”、账号仍为 `unregistered`、Roxy Tab 保持打开。不得把邮箱、AT、OTP 或页面 URL 写入日志或文档。
