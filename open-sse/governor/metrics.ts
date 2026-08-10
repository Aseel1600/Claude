/**
 * open-sse/governor/metrics.ts
 *
 * Successful-request metrics calculator for Intelligence Governor pre-work.
 *
 * Safe math: handles empty dataset and zero successful tasks without producing NaN or Infinity.
 */

import type { GovernorTelemetry } from "./types.ts";

export interface SuccessfulRequestMetrics {
  totalEvaluations: number;
  successfulTasks: number;
  tokensPerSuccess: number;
  costPerSuccess: number;
  timePerSuccessMs: number;
  retriesPerSuccess: number;
}

export function calculateSuccessfulRequestMetrics(
  telemetryRecords: GovernorTelemetry[]
): SuccessfulRequestMetrics {
  const totalEvaluations = telemetryRecords.length;
  const successfulRecords = telemetryRecords.filter((r) => r.success === true);
  const successfulTasks = successfulRecords.length;

  if (successfulTasks === 0) {
    return {
      totalEvaluations,
      successfulTasks: 0,
      tokensPerSuccess: 0,
      costPerSuccess: 0,
      timePerSuccessMs: 0,
      retriesPerSuccess: 0,
    };
  }

  const totalTokens = successfulRecords.reduce((sum, r) => sum + (r.actualTotalTokens ?? 0), 0);
  const totalCost = successfulRecords.reduce((sum, r) => sum + (r.estimatedCost ?? 0), 0);
  const totalTime = successfulRecords.reduce((sum, r) => sum + (r.latencyMs ?? 0), 0);
  const totalRetries = successfulRecords.reduce((sum, r) => sum + (r.retryCount ?? 0), 0);

  return {
    totalEvaluations,
    successfulTasks,
    tokensPerSuccess: Number((totalTokens / successfulTasks).toFixed(2)),
    costPerSuccess: Number((totalCost / successfulTasks).toFixed(6)),
    timePerSuccessMs: Number((totalTime / successfulTasks).toFixed(2)),
    retriesPerSuccess: Number((totalRetries / successfulTasks).toFixed(4)),
  };
}

/** @deprecated Use calculateSuccessfulRequestMetrics; request semantics are intentional. */
export const calculateSuccessfulTaskMetrics = calculateSuccessfulRequestMetrics;
export type SuccessfulTaskMetrics = SuccessfulRequestMetrics;
