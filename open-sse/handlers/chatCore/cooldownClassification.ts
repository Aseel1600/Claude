import { HTTP_STATUS } from "../../config/constants.ts";

/**
 * `errorType` tag for a request dropped by OmniRoute's own request queue.
 *
 * Set in `chatCore.ts` when `rateLimitManager` rejects a job that waited longer
 * than `resilienceSettings.requestQueue.maxWaitMs`. Without a tag of its own the
 * drop reached the cooldown layer as a bare 503, indistinguishable from an
 * upstream that is genuinely failing.
 */
export const LOCAL_QUEUE_TIMEOUT_ERROR_TYPE = "local_queue_timeout";

/**
 * Whether a failed single-model attempt is *self-inflicted* — OmniRoute gave up,
 * the provider never rejected anything. Two shapes qualify:
 *
 *  - **Our own deadline** (fetch-start `TimeoutError`, body `BodyTimeoutError`, or
 *    the combo-per-model timeout) firing while the upstream was still processing,
 *    surfaced as a 504 tagged `upstream_timeout`. Antigravity keeps its own
 *    pre-response-timeout cooldown policy and is therefore excluded.
 *  - **Our own request queue** dropping a job that exceeded `maxWaitMs`, surfaced
 *    as a 503 tagged `local_queue_timeout`. This one has no per-provider
 *    exception: the queue is OmniRoute's for every provider alike, and the
 *    request never left the process.
 *
 * Neither is a provider rejection — the connection is healthy, we just stopped
 * waiting — so the caller must skip the connection cooldown. Cooling the
 * connection down on our own timeout penalises a healthy account and, when a
 * provider has a single connection, blocks every subsequent request behind a
 * self-inflicted cooldown.
 *
 * Measured in production 2026-08-08: 9 queue drops over 40 min cooled 4 healthy
 * connections, locked out 4 models, and cost one request its untried fallback.
 */
export function isSelfInflictedFailure(
  status: number,
  errorType: string | undefined | null,
  provider: string
): boolean {
  if (
    status === HTTP_STATUS.SERVICE_UNAVAILABLE &&
    errorType === LOCAL_QUEUE_TIMEOUT_ERROR_TYPE
  ) {
    return true;
  }
  return (
    status === HTTP_STATUS.GATEWAY_TIMEOUT &&
    errorType === "upstream_timeout" &&
    provider !== "antigravity"
  );
}

/**
 * @deprecated Renamed to `isSelfInflictedFailure` once the queue-drop case joined
 * it — the predicate is no longer only about timeouts. Kept as an alias so any
 * out-of-tree caller keeps working.
 */
export const isSelfInflictedUpstreamTimeout = isSelfInflictedFailure;
