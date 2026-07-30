import { getCodexModelScope } from "../../config/codexQuotaScopes.ts";
import { updateProviderConnection } from "@/lib/db/providers";
import { getCachedProviderConnectionById } from "@/lib/localDb";

type CodexFailoverCredentials = {
  connectionId?: string | null;
  providerSpecificData?: unknown;
};

/**
 * Return true when a Codex response is an upstream transient-capacity failure
 * that should move this request to another OAuth account.
 *
 * Codex overloads have appeared both as HTTP 502/503/504 JSON responses and as
 * a Responses SSE `response.failed` event carrying
 * `response.error.code=server_is_overloaded`.  Keep this status-bounded so
 * local validation/auth errors never rotate accounts.
 */
export function isCodexTransientAccountFailure(status: number): boolean {
  if (status === 429) return true;
  return status === 502 || status === 503 || status === 504;
}

function asProviderData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function markCodexScopeRateLimited(params: {
  failedConnectionId: string;
  model: string | null;
  rateLimitedUntil: string;
  credentials?: CodexFailoverCredentials | null;
  /** Optional status/message for non-429 transient capacity failures. */
  status?: number;
}): Promise<void> {
  const connection = await getCachedProviderConnectionById(params.failedConnectionId).catch(() => null);
  const existingProviderData = connection
    ? asProviderData(connection.providerSpecificData)
    : asProviderData(params.credentials?.providerSpecificData);
  const existingScopeMap = asProviderData(existingProviderData.codexScopeRateLimitedUntil);
  const nextProviderData = {
    ...existingProviderData,
    codexScopeRateLimitedUntil: {
      ...existingScopeMap,
      [getCodexModelScope(params.model || "")]: params.rateLimitedUntil,
    },
  };

  updateProviderConnection(params.failedConnectionId, {
    ...(connection ? { providerSpecificData: nextProviderData } : {}),
    lastError: `${params.status ?? 429} transient upstream failure — codex account rotation`,
    errorCode: params.status ?? 429,
  }).catch(() => {});

  if (params.credentials && String(params.credentials.connectionId) === params.failedConnectionId) {
    params.credentials.providerSpecificData = nextProviderData;
  }
}
