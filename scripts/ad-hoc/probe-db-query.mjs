import Database from "better-sqlite3";
const db = new Database("/app/data/storage.sqlite", { readonly: true });

const log = console.log;

const activeConns = db
  .prepare("SELECT DISTINCT provider FROM provider_connections WHERE is_active = 1")
  .all();
const activeProviders = new Set(activeConns.map((c) => c.provider));
log("=== ACTIVE PROVIDERS ===");
log([...activeProviders].sort().join(", "));

log("\n=== COMBOS ===");
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
    if (Array.isArray(data)) flatten(data);
    else if (data && typeof data === "object") {
      if (Array.isArray(data.models)) flatten(data.models);
      if (Array.isArray(data.targets)) flatten(data.targets);
      if (Array.isArray(data.steps)) {
        data.steps.forEach((s) => {
          if (s.models && Array.isArray(s.models)) flatten(s.models);
          if (s.targets && Array.isArray(s.targets)) flatten(s.targets);
        });
      }
    }
  } catch (e) {}
});

log("\n=== syncedAvailableModels ===");
const syncedEntries = db
  .prepare("SELECT key, value FROM key_value WHERE namespace = 'syncedAvailableModels'")
  .all();
log("Total synced entries: " + syncedEntries.length);

log("\n=== FREE MODELS by PROVIDER ===");
const freeModelsByProvider = {};
const allModelsByProvider = {};
syncedEntries.forEach((entry) => {
  const provider = entry.key.split(":")[0];
  if (!activeProviders.has(provider)) return;
  if (!freeModelsByProvider[provider]) {
    freeModelsByProvider[provider] = new Set();
    allModelsByProvider[provider] = new Set();
  }
  try {
    const models = JSON.parse(entry.value);
    const modelList = Array.isArray(models)
      ? models
      : models && Array.isArray(models.models)
        ? models.models
        : [];
    modelList.forEach((m) => {
      if (m && m.id) {
        allModelsByProvider[provider].add(m.id);
        const lower = m.id.toLowerCase();
        if (lower.endsWith(":free") || lower.endsWith("-free"))
          freeModelsByProvider[provider].add(m.id);
      }
    });
  } catch (e) {}
});

let totalFree = 0;
for (const p of Object.keys(freeModelsByProvider).sort()) {
  totalFree += freeModelsByProvider[p].size;
  log(`${p}: ${freeModelsByProvider[p].size} free / ${allModelsByProvider[p].size} total`);
}

log("\n=== ALL FREE MODEL ROUTES ===");
for (const p of Object.keys(freeModelsByProvider).sort()) {
  const ids = [...freeModelsByProvider[p]].sort();
  ids.forEach((id) => log(`${p}/${id}`));
}
log("\nTotal free routes: " + totalFree);

log("\n=== COMBO MODELS ===");
log([...comboModelSet].sort().join(", "));

log("\n=== ACTIVE PROVIDER:MODEL (all, sorted) ===");
for (const p of Object.keys(allModelsByProvider).sort()) {
  const ids = [...allModelsByProvider[p]].sort();
  log("--- " + p + " (" + ids.length + ") ---");
  ids.forEach((id) => log(id));
}

db.close();
