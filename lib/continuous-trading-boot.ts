/** Boot-time kick for institutional continuous trading when session is already active. */
export async function bootstrapContinuousTradingRuntime(): Promise<void> {
  const { isContinuousTradingSessionActive } = await import('./continuous-trading-session');
  if (!(await isContinuousTradingSessionActive())) return;

  const { ensureAutonomyRuntime } = await import('./autonomy-store');
  await ensureAutonomyRuntime();

  try {
    const { advanceAutonomousPipeline } = await import('./autonomous-pipeline-store');
    await advanceAutonomousPipeline('AUTO');
    const { maintainInstitutionalPositions } = await import('./institutional-position-maintenance');
    await maintainInstitutionalPositions('boot');
  } catch {
    // scheduler retries on next tick
  }
}
