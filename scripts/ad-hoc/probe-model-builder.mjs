import Database from "better-sqlite3";
const db = new Database("/tmp/storage.sqlite");

const log = console.log;

// Active providers from provider_connections
log("=== ACTIVE PROVIDERS (is_active=1) ===");
const activeConns = db
  .prepare("SELECT DISTINCT provider FROM provider_connections WHERE is_active = 1")
  .all();
const activeProviders = new Set(activeConns.map((c) => c.provider));
log([...activeProviders].join(", "));

// Combinations
log("\n=== COMBOS (models data) ===");
const combos = db.prepare("SELECT id, name, data FROM combos").all();
const comboModelSet = new Set();

combos.forEach((c) => {
  log(`Combo: ${c.id} (${c.name})`);
  try {
    const data = JSON.parse(c.data);
    const flatten = (arr) =>
      arr.forEach((item) => {
        if (typeof item === "string") {
          comboModelSet.add(item);
        } else if (item && typeof item === "object") {
          if (item.model) comboModelSet.add(item.model);
          if (item.id) comboModelSet.add(item.id);
          if (item.models && Array.isArray(item.models)) flatten(item.models);
        }
      });
    if (Array.isArray(data)) {
      flatten(data);
    } else if (data && typeof data === "object") {
      if (Array.isArray(data.models)) flatten(data.models);
      if (Array.isArray(data.targets)) flatten(data.targets);
      if (Array.isArray(data.steps)) {
        data.steps.forEach((s) => {
          if (s.models && Array.isArray(s.models)) flatten(s.models);
          if (s.targets && Array.isArray(s.targets)) flatten(s.targets);
        });
      }
    }
  } catch (e) {
    log(`  - raw data: ${c.data?.substring?.(0, 200)}`);
  }
});

log("\n=== KEY_VALUE namespace distribution ===");
const namespaces = db
  .prepare("SELECT namespace, COUNT(*) as cnt FROM key_value GROUP BY namespace")
  .all();
namespaces.forEach((ns) => log(`${ns.namespace}: ${ns.cnt}`));

log("\n=== syncedAvailableModels entries (first 5 keys per provider) ===");
const syncedEntries = db
  .prepare("SELECT key, value FROM key_value WHERE namespace = 'syncedAvailableModels'")
  .all();
log("Total synced entries:", syncedEntries.length);

// Group by provider
const byProvider = {};
syncedEntries.forEach((e) => {
  const provider = e.key.split(":")[0];
  if (!byProvider[provider]) byProvider[provider] = [];
  byProvider[provider].push(e);
});

log("\nProviders with synced models:", [...Object.keys(byProvider)].sort().join(", "));

log("\n=== FREE MODELS by PROVIDER ===");
const freeModelsByProvider = {};
syncedEntries.forEach((entry) => {
  const provider = entry.key.split(":")[0];
  if (!activeProviders.has(provider)) return;
  if (!freeModelsByProvider[provider]) freeModelsByProvider[provider] = new Set();
  try {
    const models = JSON.parse(entry.value);
    const modelList = Array.isArray(models)
      ? models
      : models?.models && Array.isArray(models.models)
        ? models.models
        : [];
    modelList.forEach((m) => {
      if (m && m.id) {
        const lower = m.id.toLowerCase();
        if (lower.endsWith(":free") || lower.endsWith("-free")) {
          freeModelsByProvider[provider].add(m.id);
        }
      }
    });
  } catch (e) {}
});

let totalFree = 0;
for (const [p, models] of Object.entries(freeModelsByProvider).sort()) {
  totalFree += models.size;
  log(`${p}: ${models.size} — ${[...models].sort().join(", ")}`);
}
log(`\nTOTAL free models: ${totalFree}`);

log("\n=== FINAL ROUTE LIST (provider/model:free or provider/model-free) ===");
const finalRoutes = new Set();
for (const [provider, models] of Object.entries(freeModelsByProvider)) {
  for (const modelId of models) {
    finalRoutes.add(`${provider}/${modelId}`);
  }
}

const sortedRoutes = [...finalRoutes].sort();
sortedRoutes.forEach((r) => log(r));
log(`\nTotal final routes: ${sortedRoutes.length}`);

log("\n=== COMBO MODELS ===");
log([...comboModelSet].sort().join(", "));

db.close();
