import { isOpenAICompatibleProvider } from "@/shared/constants/providers";

type JsonRecord = Record<string, unknown>;

export type CustomQuotaProviderKind = "theclawbay" | "verboo";

export interface CustomQuotaConnectionLike {
  provider?: string | null;
  providerSpecificData?: JsonRecord | null;
}

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function normalizeBaseUrl(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\/+$/, "") : "";
}

export function getCustomQuotaProviderKindFromBaseUrl(
  baseUrl: unknown
): CustomQuotaProviderKind | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return null;
  if (normalized.includes("api.theclawbay.com")) return "theclawbay";
  if (normalized.includes("code.verboo.ai")) return "verboo";
  return null;
}

export function getCustomQuotaProviderKind(
  providerId: unknown,
  providerSpecificData?: unknown
): CustomQuotaProviderKind | null {
  if (!isOpenAICompatibleProvider(providerId)) return null;
  const psd = toRecord(providerSpecificData);
  return getCustomQuotaProviderKindFromBaseUrl(psd.baseUrl);
}

export function supportsCustomQuotaProvider(
  providerId: unknown,
  providerSpecificData?: unknown
): boolean {
  return getCustomQuotaProviderKind(providerId, providerSpecificData) !== null;
}

export function supportsCustomQuotaConnection(
  connection: CustomQuotaConnectionLike | null | undefined
): boolean {
  if (!connection) return false;
  return supportsCustomQuotaProvider(connection.provider, connection.providerSpecificData);
}

export function getCustomQuotaProviderLabel(
  providerId: unknown,
  providerSpecificData?: unknown
): string | null {
  const kind = getCustomQuotaProviderKind(providerId, providerSpecificData);
  if (kind === "theclawbay") return "The Claw Bay";
  if (kind === "verboo") return "Verboo";
  return null;
}
