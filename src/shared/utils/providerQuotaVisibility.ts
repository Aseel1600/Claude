import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import {
  getCustomQuotaProviderLabel,
  supportsCustomQuotaConnection,
  supportsCustomQuotaProvider,
} from "@/shared/utils/customQuotaProviders";

export interface ProviderQuotaVisibilityConnection {
  provider?: string;
  providerSpecificData?: Record<string, unknown>;
  quotaVisible?: boolean;
}

export function isProviderQuotaVisible(connection: ProviderQuotaVisibilityConnection): boolean {
  return connection.quotaVisible !== false;
}

export function supportsProviderQuota(providerId: string): boolean {
  return USAGE_SUPPORTED_PROVIDERS.includes(providerId) || supportsCustomQuotaProvider(providerId);
}

export function supportsProviderQuotaConnection(
  connection: ProviderQuotaVisibilityConnection | null | undefined
): boolean {
  if (!connection?.provider) return false;
  return (
    USAGE_SUPPORTED_PROVIDERS.includes(connection.provider) ||
    supportsCustomQuotaConnection(connection)
  );
}

export function getProviderQuotaDisplayLabel(
  providerId: string | undefined,
  providerSpecificData?: Record<string, unknown>
): string {
  const customLabel = getCustomQuotaProviderLabel(providerId, providerSpecificData);
  return customLabel || String(providerId || "");
}
