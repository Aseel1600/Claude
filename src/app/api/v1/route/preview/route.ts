import { z } from "zod";

import { buildRoutePreview, type ComboLike } from "@omniroute/open-sse/handlers/routePreview.ts";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { getComboByName } from "@/lib/db/combos";
import { enforceApiKeyPolicy } from "@/shared/utils/apiKeyPolicy";
import { enforceClientApiRouteAuth } from "@/shared/utils/clientApiRouteAuth";
import { isValidationFailure, validateBody } from "@/shared/validation/helpers";

/**
 * POST /v1/route/preview — what target would serve this model, and how much
 * input room would it have?
 *
 * Pre-flight for clients that must decide whether to compact BEFORE calling.
 * Resolves the target chain structurally and reports per-hop capacity plus the
 * narrowest input budget across the chain; never contacts an upstream, never
 * consumes quota, never counts as a billable request.
 */

const routePreviewSchema = z
  .object({
    model: z.string().trim().min(1),
  })
  .strict();

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request: Request) {
  // Authenticate exactly like the sibling /v1 handlers before reading anything.
  // Without this the preview answers anonymous callers while /v1/models rejects
  // them — and a preview enumerates which models and combos exist and how large
  // they are, which is precisely the inventory an unauthenticated caller should
  // not get. Uses the shared guard so this route can never drift stricter or
  // looser than the pipeline that fronts it.
  const authFailure = await enforceClientApiRouteAuth(request);
  if (authFailure) return authFailure;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const validation = validateBody(routePreviewSchema, rawBody);
  if (isValidationFailure(validation)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, validation.error.message);
  }
  const { model } = validation.data;

  // Same key policy as a real call: previewing which models a key can reach is
  // itself information, so it must not be readable past the key's restrictions.
  const policy = await enforceApiKeyPolicy(request, model);
  if (policy.rejection) return policy.rejection;

  // Resolve combos exactly the way chatCore does (getComboByName, plus the
  // optional `combo:` prefix) — a preview that resolves a name differently from
  // the request path would describe a target the request would never reach,
  // which is worse than no preview at all.
  let combo: ComboLike | null = null;
  try {
    combo =
      ((await getComboByName(model)) as ComboLike | null) ??
      (model.startsWith("combo:")
        ? ((await getComboByName(model.substring(6))) as ComboLike | null)
        : null);
  } catch {
    // A combo lookup failure must not fail the preview: a single model still
    // resolves without it, and that answer is accurate for every non-combo id.
    combo = null;
  }

  const preview = buildRoutePreview(model, () => combo);

  return new Response(JSON.stringify(preview), {
    status: HTTP_STATUS.OK,
    headers: { "Content-Type": "application/json" },
  });
}
