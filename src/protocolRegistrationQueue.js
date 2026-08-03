export class ProtocolRegistrationQueueError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function createProtocolRegistrationQueue({ worker, maxRecent = 20, maxLogsPerJob = 200 } = {}) {
  if (typeof worker !== 'function') {
    throw new TypeError('protocol registration queue worker is required');
  }

  const waiting = [];
  const recent = [];
  const idleWaiters = [];
  let current = null;
  let draining = false;

  function snapshotJob(job) {
    return {
      id: job.id,
      operation: job.operation,
      account: { id: job.account.id, email: job.account.email },
      state: job.state,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt || null,
      finishedAt: job.finishedAt || null,
      error: job.error || null,
      logs: job.logs.map(({ level, message }) => ({ level, message })),
    };
  }

  function appendLog(job, { level = 'muted', message } = {}) {
    if (!job || !Array.isArray(job.logs)) return;
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) return;
    job.logs.push({
      level: level === 'error' ? 'error' : 'muted',
      message: normalizedMessage,
    });
    if (job.logs.length > maxLogsPerJob) job.logs.splice(0, job.logs.length - maxLogsPerJob);
  }

  function notifyIdle() {
    if (current || waiting.length) return;
    while (idleWaiters.length) idleWaiters.shift()();
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (waiting.length) {
        current = waiting.shift();
        current.state = 'running';
        current.startedAt = new Date().toISOString();
        try {
          await worker(current);
          current.state = 'succeeded';
        } catch (error) {
          current.state = 'failed';
          current.error = error?.message || '协议注册失败';
        }
        current.finishedAt = new Date().toISOString();
        recent.unshift(current);
        if (recent.length > maxRecent) recent.length = maxRecent;
        current = null;
      }
    } finally {
      draining = false;
      notifyIdle();
    }
  }

  function enqueue(account, { operation = 'protocol-registration' } = {}) {
    const accountId = String(account?.id || '').trim();
    if (!accountId) throw new ProtocolRegistrationQueueError('PROTOCOL_REGISTER_FAILED', 'protocol registration account id is required');
    if (String(current?.account?.id || '') === accountId || waiting.some((job) => String(job.account.id) === accountId)) {
      throw new ProtocolRegistrationQueueError('PROTOCOL_REGISTER_QUEUED', 'protocol registration is already queued for this account');
    }
    const job = {
      id: `${Date.now()}-${accountId}`,
      operation: String(operation || 'protocol-registration'),
      account: { id: account.id, email: account.email },
      state: 'queued',
      enqueuedAt: new Date().toISOString(),
      logs: [],
    };
    waiting.push(job);
    void drain();
    return snapshotJob(job);
  }

  return {
    enqueue,
    clearPending() {
      return waiting.splice(0).map(snapshotJob);
    },
    appendLog,
    getSnapshot() {
      return {
        current: current ? snapshotJob(current) : null,
        waiting: waiting.map(snapshotJob),
        recent: recent.map(snapshotJob),
      };
    },
    whenIdle() {
      if (!current && !waiting.length && !draining) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}
