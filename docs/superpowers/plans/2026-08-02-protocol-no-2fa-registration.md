# 无 2FA Roxy 协议注册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 OTP-first Roxy 注册脚本，在不启用 2FA 的前提下从 ChatGPT session 获取 AT 并保存为按邮箱命名的文件。

**Architecture:** Python 负责录制验证过的 Auth 状态机与 AT 导出；Node 准备器按手动刷新脚本顺序刷新代理、重建 Roxy profile。两个进程只用退出状态衔接，不经 stdout、日志或文件传递敏感连接信息。

**Tech Stack:** Python 3、`BrowserSession`、`RoxyCdpClient`、Node.js、`RoxyBrowserClient`、`createRoxyProxyService`、`unittest`、`node --test`。

## Global Constraints

- 只使用同一 Roxy CDP profile，禁止回退普通 HTTP 会话。
- 只支持已录制的 OTP-first 分支，禁止调用密码、`user/register` 或 TOTP API。
- Auth 转换必须验证 HTTP、`page.type`、`method` 和 continuation，不能以 DOM/URL 猜测成功。
- 只在 `/api/auth/session.accessToken` 非空后写入 `REGISTRATION_TOKEN_OUTPUT_DIR/<email>.txt`。
- 不记录 AT、OTP、Cookie、callback 值、CDP endpoint 或代理凭据。
- 浏览器自动化 fallback 必须基于新的 DOM 录制。

---

### Task 1: Roxy 准备器

**Files:**
- Create: `src/auto/protocol_registration/scripts/prepare_roxy_no_2fa.cjs`
- Create: `test/prepareRoxyNo2FA.test.js`

**Interfaces:**
- Consumes: `ROXY_NO_2FA_*` 环境配置、`RoxyBrowserClient`、`createRoxyProxyService`。
- Produces: `prepareRoxyNo2FA({ env, clientFactory, proxyServiceFactory }) -> Promise<{ dirId: string }>`；CLI 成功仅输出 `{ "ok": true, "dirId": result.dirId }`。

- [ ] **Step 1: Write the failing test**

```javascript
test('prepares the bound Roxy profile in manual-refresh order without exposing secrets', async () => {
  const calls = [];
  const result = await prepareRoxyNo2FA({
    env: fixtureEnv,
    clientFactory: () => fakeClient(calls),
    proxyServiceFactory: () => fakeProxyService(calls),
  });
  assert.deepEqual(calls, [
    'listBrowsers', 'listProxies', 'modifyProxy', 'closeBrowser',
    'clearLocalCache', 'clearServerCache', 'randomFingerprint',
    'openBrowser', 'getConnectionInfo',
  ]);
  assert.deepEqual(result, { dirId: 'profile-1' });
  assert.doesNotMatch(JSON.stringify(result), /password|ws:\/\//i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/prepareRoxyNo2FA.test.js`  
Expected: FAIL because the module and `prepareRoxyNo2FA` do not exist.

- [ ] **Step 3: Write minimal implementation**

```javascript
async function prepareRoxyNo2FA({ env = process.env, clientFactory, proxyServiceFactory }) {
  const config = readNo2FAConfig(env);
  const client = await clientFactory(config);
  await assertProfileAndProxy(client, config);
  const service = proxyServiceFactory({ config, client });
  await service.refreshBrowserProxy({ dirId: config.dirId, openArgs: resolveOpenArgs(env) });
  return { dirId: config.dirId };
}
```

Use `RoxyBrowserClient` and `createRoxyProxyService`; proxy credentials remain inside the modify call. Catch errors only to redact them before CLI output.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/prepareRoxyNo2FA.test.js`  
Expected: PASS; fixture password and `ws://` do not appear in output.

- [ ] **Step 5: Commit**

Run: `git add src/auto/protocol_registration/scripts/prepare_roxy_no_2fa.cjs test/prepareRoxyNo2FA.test.js && git commit -m "feat: prepare Roxy for no-2fa registration"`

### Task 2: OTP-first Auth 状态机

**Files:**
- Create: `src/auto/protocol_no_2fa_registration.py`
- Create: `src/auto/protocol_registration/core/no_2fa_registration.py`
- Create: `src/auto/protocol_registration/tests/test_protocol_no_2fa_registration.py`

**Interfaces:**
- Consumes: `BrowserSession`, `get_providers`, `get_csrf_token`, `signin_openai`, `follow_authorize`, `request_sentinel_token`, `build_sentinel_header`, `validate_email_otp`, `follow_auth_continue`, `create_account`, `follow_oauth_callback`, `fetch_session`。
- Produces: `core.no_2fa_registration.run_no_2fa_registration(email: str, name: str, birthday: str, session_factory=BrowserSession) -> str`，返回 AT；CLI wrapper 仅负责参数解析、Roxy 准备和保存；异常时不写 AT。

- [ ] **Step 1: Write the failing test**

```python
def test_otp_first_registration_never_calls_password_or_mfa(monkeypatch, fake_session):
    calls = install_successful_otp_first_flow(monkeypatch, fake_session)
    token = subject.run_no_2fa_registration(
        email="new.user@example.test",
        name="New User",
        birthday="2000-01-01",
        session_factory=lambda: fake_session,
    )
    assert token == "at-value"
    assert calls == [
        "providers", "csrf", "signin", "authorize", "otp-resend",
        "sentinel:authorize_continue", "otp-validate", "about-you",
        "sentinel:oauth_create_account", "create-account", "callback", "session",
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration; Pop-Location`  
Expected: FAIL because `protocol_no_2fa_registration` and `run_no_2fa_registration` do not exist.

- [ ] **Step 3: Write minimal implementation**

```python
def run_no_2fa_registration(email, name, birthday, session_factory=BrowserSession):
    session = session_factory()
    try:
        get_providers(session)
        csrf = get_csrf_token(session)
        authorize_url = signin_openai(session, csrf, email)
        follow_authorize(session, authorize_url)
        resend_initial_email_otp(session)
        otp_result = validate_initial_otp(session, email)
        follow_auth_continue(session, otp_result, "about_you")
        create_result = submit_about_you(session, name, birthday)
        return finalize_session(session, create_result["continue_url"])
    finally:
        session.close()
```

`resend_initial_email_otp()` 只 POST 一次并验证 `{success: true}`。`validate_initial_otp()` 使用 120 秒/5 秒新码策略、`authorize_continue` Sentinel/SO 头和明确的 `about_you` 断言。`submit_about_you()` 只使用 `oauth_create_account` Sentinel/SO 头并断言 `external_url`。

- [ ] **Step 4: Run test to verify it passes**

Run: `Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration; Pop-Location`  
Expected: PASS；调用序列不含 `user/register` 和 MFA endpoint。

- [ ] **Step 5: Commit**

Run: `git add src/auto/protocol_no_2fa_registration.py src/auto/protocol_registration/core/no_2fa_registration.py src/auto/protocol_registration/tests/test_protocol_no_2fa_registration.py && git commit -m "feat: add otp-first no-2fa registration flow"`

### Task 3: 负例与 AT 导出

**Files:**
- Modify: `src/auto/protocol_no_2fa_registration.py`
- Modify: `src/auto/protocol_registration/core/no_2fa_registration.py`
- Modify: `src/auto/protocol_registration/tests/test_protocol_no_2fa_registration.py`
- Reuse: `src/auto/protocol_registration/core/account_export.py`

**Interfaces:**
- Consumes: `run_no_2fa_registration(email, name, birthday, session_factory)` 和 `save_registration_access_token_file(email, access_token, output_dir)`。
- Produces: `run_and_save_no_2fa_registration(email, name, birthday, output_dir, session_factory) -> pathlib.Path`；失败时不创建输出文件。

- [ ] **Step 1: Write the failing tests**

```python
def test_rejects_otp_response_that_remains_on_email_verification(self):
    install_otp_response(page_type="email_otp_verification")
    with self.assertRaisesRegex(RuntimeError, "about_you"):
        subject.run_no_2fa_registration("new.user@example.test", "New User", "2000-01-01")

def test_retries_session_until_access_token_then_writes_plain_token(self):
    install_session_responses([{}, {"accessToken": "at-value"}])
    with tempfile.TemporaryDirectory() as directory:
        output = subject.run_and_save_no_2fa_registration(
            email="new.user@example.test", name="New User", birthday="2000-01-01",
            output_dir=directory,
        )
        self.assertEqual(Path(directory, "new.user@example.test.txt").read_text(encoding="utf-8"), "at-value")
        self.assertEqual(output.name, "new.user@example.test.txt")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration; Pop-Location`  
Expected: FAIL because stage guards and persistence wrapper do not exist.

- [ ] **Step 3: Write minimal implementation**

```python
def run_and_save_no_2fa_registration(*, email, name, birthday, output_dir=None, session_factory=BrowserSession):
    access_token = run_no_2fa_registration(email, name, birthday, session_factory=session_factory)
    return Path(save_registration_access_token_file(
        email=email, access_token=access_token, output_dir=output_dir,
    ))
```

`finalize_session()` may retry callback/session only after `create_account` success. It must not retry resend, OTP validation, or create-account after an ambiguous outcome.

- [ ] **Step 4: Run tests to verify they pass**

Run: `Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration tests.test_registration_token_export; Pop-Location`  
Expected: PASS; success file contains only AT and all negative tests leave no file.

- [ ] **Step 5: Commit**

Run: `git add src/auto/protocol_no_2fa_registration.py src/auto/protocol_registration/core/no_2fa_registration.py src/auto/protocol_registration/tests/test_protocol_no_2fa_registration.py && git commit -m "test: guard no-2fa registration transitions"`

### Task 4: CLI、配置和验收

**Files:**
- Modify: `.env.example`
- Modify: `docs/project/protocol-no-2fa-registration-api.md`
- Modify: `docs/changes/CHG-103-protocol-no-2fa-registration.md`
- Modify: `docs/work/2026-08-02-protocol-no-2fa-registration-design.md`

**Interfaces:**
- Consumes: `ROXY_NO_2FA_*`、`REGISTRATION_EMAIL_CODE_API_URL`、`REGISTRATION_TOKEN_OUTPUT_DIR`。
- Produces: `python src/auto/protocol_no_2fa_registration.py --email new.user@example.test --name "New User" --birthday 2000-01-01`；成功仅输出脱敏阶段和保存路径。

- [ ] **Step 1: Write the failing CLI/config test**

```python
def test_cli_rejects_missing_roxy_no_2fa_proxy_configuration(monkeypatch, capsys):
    monkeypatch.delenv("ROXY_NO_2FA_PROXY_ID", raising=False)
    exit_code = subject.main(["--email", "new.user@example.test", "--name", "New User"])
    assert exit_code == 2
    assert "ROXY_NO_2FA_PROXY_ID" in capsys.readouterr().err
```

- [ ] **Step 2: Run test to verify it fails**

Run: `Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration; Pop-Location`  
Expected: FAIL because the CLI does not validate dedicated Roxy configuration.

- [ ] **Step 3: Write minimal implementation and documentation**

```python
def main(argv=None):
    args = parse_args(argv)
    validate_no_2fa_roxy_config(os.environ)
    run_roxy_preparer()
    run_and_save_no_2fa_registration(email=args.email, name=args.name, birthday=args.birthday)
    return 0
```

`.env.example` must only contain variable names and placeholder values. Change CHG-103 to `implemented` only after all automated tests pass.

- [ ] **Step 4: Run verification**

Run: `node --test test/prepareRoxyNo2FA.test.js; Push-Location src/auto/protocol_registration; python -m unittest tests.test_protocol_no_2fa_registration tests.test_registration_token_export; Pop-Location; python -m py_compile src/auto/protocol_no_2fa_registration.py src/auto/protocol_registration/core/no_2fa_registration.py; git diff --check`  
Expected: all tests pass, Python compiles, no whitespace errors.

- [ ] **Step 5: Commit**

Run: `git add .env.example docs/project/protocol-no-2fa-registration-api.md docs/changes/CHG-103-protocol-no-2fa-registration.md docs/work/2026-08-02-protocol-no-2fa-registration-design.md && git commit -m "docs: document no-2fa registration protocol"`
