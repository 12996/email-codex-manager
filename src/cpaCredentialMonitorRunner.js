export function startCpaCredentialMonitor({
  enabled,
  intervalMs,
  monitor,
  setIntervalImpl = setInterval,
  logger = console,
} = {}) {
  if (!enabled || !monitor?.runOnce) return null;

  const runSafely = async () => {
    try {
      const result = await monitor.runOnce();
      logger.info?.('[cpa-monitor] run completed', result);
    } catch (error) {
      logger.error?.('[cpa-monitor] run failed', error.message);
    }
  };

  return setIntervalImpl(runSafely, intervalMs);
}
