import { Router } from 'express';

import { programCycleMetrics } from '../services/cycleMetrics.js';

export const cycleMetricsRouter = Router();

/**
 * Cycle-time report derived from the audit trail. Read-only.
 *
 * `HANDS_ON_CAP_MINUTES` and the wall-clock/hands-on distinction are documented in the service —
 * the response exposes both so a reader is never shown a single number without its caveat.
 */
cycleMetricsRouter.get('/cycle-metrics', async (_request, response, next) => {
  try {
    const programs = await programCycleMetrics();
    const completed = programs.filter((program) => program.complete);

    const average = (values: number[]) =>
      values.length === 0
        ? null
        : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;

    response.json({
      programs,
      summary: {
        total_programs: programs.length,
        completed_cycles: completed.length,
        average_total_minutes: average(
          completed.map((program) => program.totalMinutes).filter((v): v is number => v !== null),
        ),
        average_hands_on_minutes: average(
          completed.map((program) => program.handsOnMinutes).filter((v): v is number => v !== null),
        ),
      },
    });
  } catch (error) {
    next(error);
  }
});
