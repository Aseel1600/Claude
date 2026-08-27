import { VIDEO_TRANSCRIPT_LOG_OMISSION_MARKER } from "@/lib/guardrails/videoTranscriptLogRedaction";

import type { ExecutorLog } from "../../executors/base.ts";

type ExecutorLogMethod = NonNullable<ExecutorLog["debug"]>;

function retainMethod(
  owner: ExecutorLog,
  method: ExecutorLogMethod | undefined
): ExecutorLogMethod | undefined {
  if (!method) return undefined;

  return (tag) => {
    method.call(owner, tag, VIDEO_TRANSCRIPT_LOG_OMISSION_MARKER);
  };
}

/**
 * Executor diagnostics can contain arbitrary provider text, including request echoes.
 * Keep the original logger for ordinary requests, but give every executor a request-scoped
 * fail-closed view when the Video Bridge marked the request sensitive. Tags remain useful;
 * messages and optional structured metadata are replaced/dropped only at the retention seam.
 */
export function createExecutorRetentionLog(
  log: ExecutorLog | null | undefined,
  videoTranscriptSensitive: boolean
): ExecutorLog | null | undefined {
  if (!log || !videoTranscriptSensitive) return log;

  return {
    debug: retainMethod(log, log.debug),
    info: retainMethod(log, log.info),
    warn: retainMethod(log, log.warn),
    error: retainMethod(log, log.error),
  };
}
