import { getDbInstance } from "./core";

export interface ProviderConnectionRef {
  id: string;
  provider: string;
  name: string | null;
  email: string | null;
}

/**
 * Look up a single provider connection by id. Backs dashboard surfaces that
 * need human-readable account metadata (email/name) for a connection id,
 * e.g. the utilization Account Split cards.
 */
export function getConnection(connectionId: string): ProviderConnectionRef | null {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT id, provider, name, email FROM provider_connections WHERE id = ?")
    .get(connectionId) as ProviderConnectionRef | undefined;
  return row ?? null;
}
