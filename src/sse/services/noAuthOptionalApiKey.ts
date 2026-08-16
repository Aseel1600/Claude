/**
 * Optional API keys on no-auth providers (AI Horde).
 *
 * `getProviderCredentials` short-circuits no-auth providers to a synthetic
 * `connectionId: "noauth"` row so they work with nothing configured. That
 * skipped stored connections, so a registered Horde key could be saved and
 * still never sent. When a no-auth provider also accepts an optional key
 * (`anonymousApiKey` and/or FREE_APIKEY), prefer an active connection that
 * actually has a key, then fall back to the synthetic anonymous path.
 */
import { REGISTRY } from "@omniroute/open-sse/config/providerRegistry.ts";
import { createLazyConnectionView } from "@/lib/db/providers/lazyConnectionView";
import { getCachedRawProviderConnections } from "@/lib/db/readCache";
import { supportsApiKeyOnFreeProvider } from "@/shared/constants/providers";

export function noAuthProviderAcceptsOptionalApiKey(providerId: string): boolean {
  if (supportsApiKeyOnFreeProvider(providerId)) return true;
  const entry = REGISTRY[providerId] as { anonymousApiKey?: string } | undefined;
  return Boolean(entry?.anonymousApiKey);
}

function hasUsableApiKey(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function loadOptionalNoAuthApiKeyCredentials(
  providerId: string,
  excludedConnectionIds: Set<string>
): Promise<{
  apiKey: string;
  accessToken: null;
  refreshToken: null;
  expiresAt: null;
  projectId: null;
  defaultModel: string | null;
  copilotToken: null;
  providerSpecificData: Record<string, unknown>;
  id: string;
  provider: string;
  connectionId: string;
  testStatus: string | null;
  lastError: null;
  lastErrorType: null;
  lastErrorSource: null;
  errorCode: null;
  rateLimitedUntil: null;
  maxConcurrent: null;
} | null> {
  if (!noAuthProviderAcceptsOptionalApiKey(providerId)) return null;

  let connectionsRaw: unknown;
  try {
    connectionsRaw = await getCachedRawProviderConnections({
      provider: providerId,
      isActive: true,
    });
  } catch {
    return null;
  }

  const connections = (Array.isArray(connectionsRaw) ? connectionsRaw : [])
    .map(createLazyConnectionView)
    .filter(
      (conn) =>
        conn.id.length > 0 &&
        !excludedConnectionIds.has(conn.id) &&
        conn.isActive !== false &&
        hasUsableApiKey(conn.apiKey)
    )
    .sort((a, b) => (a.priority || 999) - (b.priority || 999));

  const connection = connections[0];
  if (!connection || !hasUsableApiKey(connection.apiKey)) return null;

  const providerSpecificData =
    connection.providerSpecificData && typeof connection.providerSpecificData === "object"
      ? (connection.providerSpecificData as Record<string, unknown>)
      : {};

  return {
    apiKey: connection.apiKey.trim(),
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    projectId: null,
    defaultModel: connection.defaultModel || null,
    copilotToken: null,
    providerSpecificData,
    id: connection.id,
    provider: connection.provider || providerId,
    connectionId: connection.id,
    testStatus: connection.testStatus ?? "active",
    lastError: null,
    lastErrorType: null,
    lastErrorSource: null,
    errorCode: null,
    rateLimitedUntil: null,
    maxConcurrent: null,
  };
}
