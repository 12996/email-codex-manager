export function createCpaRepairQueue({ worker } = {}) {
  const jobs = [];
  const queuedIds = new Set();
  let running = false;

  return {
    enqueue(job) {
      const id = Number(job?.account?.id);
      if (!id || queuedIds.has(id)) return false;
      queuedIds.add(id);
      jobs.push(job);
      return true;
    },

    async drain() {
      if (running) return { running: true };
      running = true;
      try {
        while (jobs.length > 0) {
          const job = jobs.shift();
          queuedIds.delete(Number(job.account.id));
          await worker(job);
        }
        return { running: false };
      } finally {
        running = false;
      }
    },
  };
}
