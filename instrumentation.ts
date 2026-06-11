export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { bootstrapContinuousTradingRuntime } = await import('./lib/continuous-trading-boot');
  void bootstrapContinuousTradingRuntime();

  const { maybeRunChartCaptureCleanup, chartCaptureCleanupIntervalMs } = await import('./lib/chart-capture-cleanup');
  void maybeRunChartCaptureCleanup('startup');
  setInterval(() => {
    void maybeRunChartCaptureCleanup('scheduler');
  }, chartCaptureCleanupIntervalMs());
}
