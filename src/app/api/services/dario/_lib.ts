/**
 * Shared helpers for /api/services/dario/* route handlers.
 * Creates a supervisor on demand if bootstrap hasn't registered one yet.
 *
 * Dario needs its DARIO_ADMIN_TOKEN (reuses getOrCreateApiKey, same mechanism
 * 9router/mux use) so the spawned proxy mounts its /admin/* control plane —
 * hence getOrInitSupervisor() is async (it resolves the key before building
 * the spawn factory).
 */

import { getSupervisor, registerSupervisor } from "@/lib/services/registry";
import { ServiceSupervisor } from "@/lib/services/ServiceSupervisor";
import { resolveSpawnArgs, DARIO_DEFAULT_PORT } from "@/lib/services/installers/dario";
import { getOrCreateApiKey } from "@/lib/services/apiKey";

const TOOL = "dario";
const PORT = parseInt(process.env.DARIO_PORT ?? String(DARIO_DEFAULT_PORT), 10);

export async function getOrInitSupervisor(): Promise<ServiceSupervisor> {
  const existing = getSupervisor(TOOL);
  if (existing) return existing;

  const apiKey = await getOrCreateApiKey(TOOL).catch(() => "placeholder");

  const sup = new ServiceSupervisor({
    tool: TOOL,
    port: PORT,
    spawnArgs: () => resolveSpawnArgs(apiKey, PORT),
    healthUrl: () => `http://127.0.0.1:${PORT}/health`,
    healthIntervalMs: 5_000,
    stopTimeoutMs: 15_000,
    logsBufferBytes: 5_242_880,
  });

  registerSupervisor(sup);
  return sup;
}
