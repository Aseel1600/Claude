export interface GovernorRuntimeConfig {
  activeEnabled: boolean;
  canaryRate: number;
  maxEstimatedRequestCost: number | null;
  controlModel: boolean;
  controlProvider: boolean;
  controlReasoning: boolean;
  controlCompression: boolean;
  controlOutput: boolean;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function rate(): number {
  const value = Number(process.env.GOVERNOR_ACTIVE_CANARY_RATE ?? "0");
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

function optionalNonNegativeNumber(name: string): number | null {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function getGovernorRuntimeConfig(): GovernorRuntimeConfig {
  return {
    activeEnabled: bool("GOVERNOR_ACTIVE_ENABLED", false),
    canaryRate: rate(),
    maxEstimatedRequestCost: optionalNonNegativeNumber("GOVERNOR_MAX_ESTIMATED_REQUEST_COST"),
    controlModel: bool("GOVERNOR_CONTROL_MODEL", true),
    controlProvider: bool("GOVERNOR_CONTROL_PROVIDER", true),
    controlReasoning: bool("GOVERNOR_CONTROL_REASONING", true),
    controlCompression: bool("GOVERNOR_CONTROL_COMPRESSION", true),
    controlOutput: bool("GOVERNOR_CONTROL_OUTPUT", true),
  };
}
