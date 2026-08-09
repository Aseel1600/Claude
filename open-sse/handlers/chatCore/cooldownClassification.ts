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
 * `errorType` tag for a job dropped when OmniRoute force-reset its own WEDGED
 * queue — the limiter was idle with capacity (`queued>0 running=0 executing=0`)
 * and the job had never been dispatched.
 *
 * Set in `chatCore.ts` from `RATE_LIMIT_QUEUE_WEDGED`, the sibling of
 * `RATE_LIMIT_QUEUE_TIMEOUT` thrown from the same catch in `withRateLimit`. It
 * surfaces as a 502 rather than a 503, which is precisely how it slipped past the
 * 2026-08-08 rule: that one was written for the pair `503 + local_queue_timeout`.
 */
export const LOCAL_QUEUE_WEDGE_ERROR_TYPE = "local_queue_wedge";

/**
 * Tags OmniRoute writes about its OWN request queue, at a single site each. No
 * provider response can produce them, so matching on the tag alone is safe — and
 * necessary: binding them to a status is the trap that left the wedge unprotected
 * for a day while its sibling was covered.
 */
const OWN_QUEUE_FAILURE_TYPES = new Set<string>([
  LOCAL_QUEUE_TIMEOUT_ERROR_TYPE,
  LOCAL_QUEUE_WEDGE_ERROR_TYPE,
]);

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
  // Our own queue, either way it failed — matched by tag, never by status. Both
  // shapes mean the request never reached the provider; the wedge means it was
  // never even dispatched.
  if (typeof errorType === "string" && OWN_QUEUE_FAILURE_TYPES.has(errorType)) {
    return true;
  }
  // `upstream_timeout` keeps the status pairing: unlike the queue tags it is not
  // exclusively ours (antigravity emits it for its pre-response timeout), so the
  // 504 narrows it to the case this rule was written for.
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
