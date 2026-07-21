# CPA Proxy Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a reversible Bash script and operator guide for switching only CLIProxyAPI between direct VPS egress and the local home proxy.

**Architecture:** The script edits the single top-level `proxy-url` in the remote CPA YAML, creates timestamped backups, and restarts only `cliproxyapi.service`. It never edits systemd drop-ins or process-wide proxy environment variables. Environment-variable overrides make the file testable against an isolated temporary config.

**Tech Stack:** Bash, GNU coreutils/sed/find, systemd, Node `node:test` for the local behavior harness, Markdown.

---

### Task 1: Write the failing behavior test

**Files:**
- Create: `test/cpa-proxy-toggle.test.js`

**Steps:**
1. Test `direct` writes `proxy-url: ""`, creates a backup, and does not contain systemd environment mutation commands.
2. Test `home` writes `proxy-url: http://127.0.0.1:7891`.
3. Test `rollback` restores the previous config.
4. Run `node --test test/cpa-proxy-toggle.test.js` and confirm failure because `scripts/cpa-proxy-toggle.sh` does not exist yet.

### Task 2: Implement the script

**Files:**
- Create: `scripts/cpa-proxy-toggle.sh`

**Steps:**
1. Add strict Bash mode, fixed production defaults, and test-only path/command overrides.
2. Validate that exactly one top-level `proxy-url` exists.
3. Implement `direct`, `home`, `status`, and `rollback` with timestamped backups.
4. Restart only `cliproxyapi.service`; do not call `daemon-reload` or edit systemd environments.
5. Run the behavior test and confirm it passes.

### Task 3: Write the operator guide

**Files:**
- Create: `docs/project/cpa-proxy-operation.md`

**Steps:**
1. Document installation, commands, expected output, verification, and rollback.
2. Explicitly explain that the script does not touch systemd proxy variables or mihomo.
3. Document the current VPS paths and port without including credentials.

### Task 4: Verify and review

**Steps:**
1. Run `node --test test/cpa-proxy-toggle.test.js`.
2. Run `bash -n scripts/cpa-proxy-toggle.sh`.
3. Run `git diff --check` for all changed files.
4. Inspect the diff for unrelated changes and confirm only CPA service restart is invoked.
