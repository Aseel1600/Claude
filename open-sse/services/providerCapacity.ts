import {
  getProviderIntelligence,
  type ProviderFreeCapacity,
} from "../config/providerIntelligence.generated.ts";

export interface NormalizedProviderCapacity {
  documented: boolean;

  requestsPerMinute: number | null;
  requestsPerHour: number | null;
  requestsPerDay: number | null;

  tokensPerMinute: number | null;
  tokensPerDay: number | null;

  concurrency: number | null;

  allowanceAmount: number | null;
  allowanceUnit: string | null;
  allowanceScope: string | null;

  resetPeriod: string | null;
  resetDetails: string | null;
  timeRestrictions: string | null;

  accountRequired: string | null;
  paymentRequired: string | null;
  modelRestrictions: string | null;

  confidence: string | null;
}

/**
 * Convert documented capacity into a normalized representation.
 *
 * Missing values remain null. They must never be interpreted as zero.
 */
export function normalizeProviderCapacity(
  capacity: ProviderFreeCapacity | null | undefined
): NormalizedProviderCapacity {
  if (!capacity) {
    return {
      documented: false,
      requestsPerMinute: null,
      requestsPerHour: null,
      requestsPerDay: null,
      tokensPerMinute: null,
      tokensPerDay: null,
      concurrency: null,
      allowanceAmount: null,
      allowanceUnit: null,
      allowanceScope: null,
      resetPeriod: null,
      resetDetails: null,
      timeRestrictions: null,
      accountRequired: null,
      paymentRequired: null,
      modelRestrictions: null,
      confidence: null,
    };
  }

  const rpm = capacity.rpm;
  const rph = capacity.rph;
  const rpd = capacity.rpd;

  const tokenUnit = capacity.unit?.toLowerCase() ?? "";
  const amount = capacity.amount;

  let tokensPerDay: number | null = null;

  if (amount !== null) {
    if (tokenUnit.includes("tokens/day") || tokenUnit.includes("token/day")) {
      tokensPerDay = amount;
    } else if (tokenUnit.includes("tokens/hour") || tokenUnit.includes("token/hour")) {
      tokensPerDay = amount * 24;
    } else if (tokenUnit.includes("tokens/minute") || tokenUnit.includes("token/minute")) {
      tokensPerDay = amount * 1440;
    }
  }

  return {
    documented:
      capacity.amount !== null ||
      capacity.rpm !== null ||
      capacity.rph !== null ||
      capacity.rpd !== null ||
      capacity.tpm !== null ||
      capacity.concurrency !== null ||
      Boolean(capacity.unit || capacity.scope || capacity.resetPeriod || capacity.resetDetails),

    requestsPerMinute: rpm,
    requestsPerHour: rph,
    requestsPerDay: rpd,

    tokensPerMinute: capacity.tpm,
    tokensPerDay,

    concurrency: capacity.concurrency,

    allowanceAmount: capacity.amount,
    allowanceUnit: capacity.unit,
    allowanceScope: capacity.scope,

    resetPeriod: capacity.resetPeriod,
    resetDetails: capacity.resetDetails,
    timeRestrictions: capacity.timeRestrictions,

    accountRequired: capacity.accountRequired,
    paymentRequired: capacity.paymentRequired,
    modelRestrictions: capacity.modelRestrictions,

    confidence: capacity.confidence,
  };
}

/**
 * Resolve documented capacity directly from the Batch 86 provider snapshot.
 */
export function getProviderCapacity(
  providerId: string,
  alias?: string | null
): NormalizedProviderCapacity {
  const intelligence = getProviderIntelligence(providerId, alias);

  return normalizeProviderCapacity(intelligence?.freeCapacity);
}

/**
 * True only when the research snapshot contains at least one usable
 * documented capacity signal.
 */
export function hasDocumentedProviderCapacity(providerId: string, alias?: string | null): boolean {
  return getProviderCapacity(providerId, alias).documented;
}
