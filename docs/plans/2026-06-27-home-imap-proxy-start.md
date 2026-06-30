# Home IMAP Proxy Start Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a startup command that runs gmail_IMAP locally while routing only Gmail IMAP traffic through the home broadband proxy on `vps-LA`.

**Architecture:** Create a wrapper script that starts `ssh -N -L <local>:<remote>` to forward local `127.0.0.1:11080` to `vps-LA`'s `127.0.0.1:7891`, then starts `src/server.js` with `IMAP_PROXY=socks5://127.0.0.1:11080`. Keep the existing `npm start` and `npm run start:proxy` behavior unchanged.

**Tech Stack:** Node.js CommonJS wrapper, SSH local forwarding, Node test runner.

---

### Task 1: Test home IMAP proxy startup options

**Files:**
- Create: `test/startWithHomeImapProxy.test.js`

**Steps:**
1. Write a failing test importing `scripts/start-with-home-imap-proxy.cjs`.
2. Assert defaults use `vps-LA`, local `127.0.0.1:11080`, remote `127.0.0.1:7891`, and `IMAP_PROXY=socks5://127.0.0.1:11080`.
3. Assert SSH args use `-L 127.0.0.1:11080:127.0.0.1:7891`, not `-D`.
4. Run `node --test test/startWithHomeImapProxy.test.js` and confirm it fails because the script does not exist.

### Task 2: Implement the wrapper and npm command

**Files:**
- Create: `scripts/start-with-home-imap-proxy.cjs`
- Modify: `package.json`

**Steps:**
1. Implement normalization, SSH args, port wait/free checks, child cleanup, and server spawn.
2. Add `start:home-proxy` to `package.json`.
3. Run `node --test test/startWithHomeImapProxy.test.js` and confirm it passes.

### Task 3: Update docs and change record

**Files:**
- Modify: `.env.example`
- Modify: `docs/project/deployment.md`
- Add: `docs/changes/CHG-050-home-imap-proxy-start.md`
- Modify: `docs/changes/CHANGE_REGISTRY.md`
- Add: `docs/work/2026-06-27-home-imap-proxy-start.md`
- Modify: `docs/work/work-log.md`
- Modify: `docs/work/handoff.md`

**Steps:**
1. Document `npm run start:home-proxy` and its env overrides.
2. Record the behavior change as `implemented`.
3. Run targeted tests.
