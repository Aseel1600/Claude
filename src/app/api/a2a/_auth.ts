/**
 * Shared authorization for the REST A2A task routes (GHSA-jcm5-6wpp-wjj8).
 *
 * Dual audience: the dashboard calls these routes with a management session,
 * A2A clients with an inference API key. Posture matrix:
 *
 *  - REQUIRE_API_KEY=true: a valid OmniRoute key is mandatory (the same
 *    posture the /v1 inference plane enforces); a management session also
 *    passes (dashboard), via alwaysRequireAuth so requireLogin=false cannot
 *    bypass it.
 *  - otherwise + requireLogin=true: management session, or a valid key.
 *  - otherwise + requireLogin=false (local-first default): open with an
 *    ownerless task scope, by design.
 *
 * Callers authenticated by key are owner-scoped — another principal's tasks
 * answer as if they did not exist. Management/operator view sees all tasks.
 */

import { requireManagementAuth } from "@/lib/api/requireManagementAuth";
import { extractApiKey, isValidApiKey } from "@/sse/services/auth";
import { isRequireApiKeyEnabled } from "@/shared/utils/featureFlags";
import { resolveA2AOwner } from "@/lib/a2a/authenticate";
import {
  A2A_OPERATOR_SCOPE,
  A2A_OWNERLESS_SCOPE,
  a2aOwnerScope,
  type A2ATaskScope,
} from "@/lib/a2a/taskManager";

export interface A2ARestAuth {
  scope: A2ATaskScope;
}

/**
 * NOTE: the failure branch is whatever requireManagementAuth returns — today a
 * plain `Response` from createErrorResponse(), NOT a NextResponse. Callers must
 * test with `instanceof Response` (NextResponse extends Response), never
 * `instanceof NextResponse`, or the 401 silently falls through to the handler.
 */
export async function authorizeA2ATaskRoute(request: Request): Promise<A2ARestAuth | Response> {
  const apiKey = extractApiKey(request);
  if (apiKey && (await isValidApiKey(apiKey))) {
    const owner = resolveA2AOwner(request);
    if (owner) return { scope: a2aOwnerScope(owner) };
  }

  // alwaysRequireAuth distinguishes a real management credential from the
  // keyless local-first posture, where requireManagementAuth normally returns
  // null before examining credentials.
  const managementError = await requireManagementAuth(request, {
    invalidApiKeyStatus: 401,
    alwaysRequireAuth: true,
  });
  if (managementError === null) return { scope: A2A_OPERATOR_SCOPE };
  if (isRequireApiKeyEnabled()) return managementError;

  const postureError = await requireManagementAuth(request, { invalidApiKeyStatus: 401 });
  if (postureError === null) return { scope: A2A_OWNERLESS_SCOPE };
  return postureError;
}
