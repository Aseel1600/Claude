import {
  getProviderIntelligence,
  isExcludedProvider,
  isFreeCandidate,
  type ProviderIntelligence,
} from "../config/providerIntelligence.generated.ts";
import { getRegistryEntry } from "../config/providerRegistry.ts";

export interface ResolvedProviderIntelligence {
  provider: ProviderIntelligence;
  registryExists: boolean;
  routable: boolean;
  freeCandidate: boolean;
}

export function resolveProviderIntelligence(
  providerId: string,
  alias?: string | null
): ResolvedProviderIntelligence | null {
  const provider = getProviderIntelligence(providerId, alias);

  if (!provider) {
    return null;
  }

  const registryEntry = getRegistryEntry(alias && alias !== providerId ? alias : providerId);

  const registryExists = registryEntry !== null;

  return {
    provider,
    registryExists,
    routable: registryExists && provider.tier !== "Exclude" && provider.tier !== "Unclassified",
    freeCandidate:
      registryExists &&
      isFreeCandidate(providerId, alias) &&
      !isExcludedProvider(providerId, alias),
  };
}

export function isProviderRoutable(providerId: string, alias?: string | null): boolean {
  return resolveProviderIntelligence(providerId, alias)?.routable === true;
}

export function isProviderFreeCandidate(providerId: string, alias?: string | null): boolean {
  return resolveProviderIntelligence(providerId, alias)?.freeCandidate === true;
}
