#!/usr/bin/env node
'use strict';

const net = require('node:net');
const { spawn } = require('node:child_process');
require('dotenv').config();

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeStartOptions(env = process.env) {
  const localHost = String(env.IMAP_PROXY_LOCAL_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const localPort = positiveInteger(env.IMAP_PROXY_LOCAL_PORT || 11080, 11080);
  const sshHost = String(env.IMAP_PROXY_SSH_HOST || '').trim();
  const imapProxy = String(env.IMAP_PROXY || `socks5://${localHost}:${localPort}`).trim();

  return {
    sshHost,
    localHost,
    localPort,
    imapProxy,
    serverCommand: ['node', ['src/server.js']],
  };
}

function buildSshArgs(options) {
  return [
    '-N',
    '-D',
    `${options.localHost}:${options.localPort}`,
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    options.sshHost,
  ];
}

function waitForPort(host, port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', (error) => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(tryConnect, 200);
      });
    };

    tryConnect();
  });
}

function isPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function assertPortFree(host, port) {
  if (await isPortOpen(host, port)) {
    throw new Error(`local SOCKS port ${host}:${port} is already in use`);
  }
}

function terminate(child) {
  if (!child || child.killed || child.exitCode !== null) {
    return;
  }
  child.kill();
}

async function main() {
  const options = normalizeStartOptions();
  if (!options.sshHost) {
    throw new Error('IMAP_PROXY_SSH_HOST is required, for example IMAP_PROXY_SSH_HOST=vps-LA');
  }

  console.log(`[imap-proxy] starting ssh socks tunnel ${options.localHost}:${options.localPort} -> ${options.sshHost}`);
  await assertPortFree(options.localHost, options.localPort);
  let serverStarted = false;
  let server = null;
  const ssh = spawn('ssh', buildSshArgs(options), { stdio: 'inherit' });

  ssh.once('exit', (code, signal) => {
    if (!serverStarted) {
      console.error(`[imap-proxy] ssh tunnel exited before server start code=${code} signal=${signal || ''}`);
      process.exitCode = code || 1;
      return;
    }
    if (server && server.exitCode === null) {
      console.error(`[imap-proxy] ssh tunnel exited while server is running code=${code} signal=${signal || ''}`);
      terminate(server);
    }
  });

  await waitForPort(options.localHost, options.localPort);
  console.log(`[imap-proxy] tunnel ready, IMAP_PROXY=${options.imapProxy}`);

  serverStarted = true;
  const [command, args] = options.serverCommand;
  server = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      IMAP_PROXY: options.imapProxy,
    },
  });

  const cleanup = () => {
    terminate(server);
    terminate(ssh);
  };

  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  server.once('exit', (code, signal) => {
    terminate(ssh);
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[imap-proxy] failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  assertPortFree,
  buildSshArgs,
  normalizeStartOptions,
  waitForPort,
};
