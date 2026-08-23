import { apiFetch } from "../api.mjs";
import { mcpCallTool } from "../mcpClient.mjs";
import { emit } from "../output.mjs";
import { t } from "../i18n.mjs";

function fmtTs(v) {
  if (!v) return "-";
  return new Date(typeof v === "number" ? v * 1000 : v).toLocaleString();
}

async function mcpCall(name, args) {
  return mcpCallTool(name, args);
}

const proxySchema = [
  { key: "host", header: "Host", width: 35 },
  { key: "type", header: "Type", width: 8 },
  { key: "region", header: "Region" },
  { key: "latencyMs", header: "Latency", formatter: (v) => (v ? `${v}ms` : "-") },
  {
    key: "successRate",
    header: "Success%",
    formatter: (v) => (v ? `${(v * 100).toFixed(0)}%` : "-"),
  },
  { key: "lastUsed", header: "Last Used", formatter: fmtTs },
  { key: "state", header: "State" },
];

export async function runOneproxyStats(_opts, cmd) {
  const data = await mcpCall("omniroute_oneproxy_stats", {});
  emit(data, cmd.optsWithGlobals());
}

export async function runOneproxyFetch(opts, cmd) {
  const data = await mcpCall("omniroute_oneproxy_fetch", {
    limit: opts.count,
    protocol: opts.type,
    ...(opts.countryCode ? { countryCode: opts.countryCode } : {}),
    ...(opts.minQuality !== undefined ? { minQuality: opts.minQuality } : {}),
  });
  emit(data.items ?? data, cmd.optsWithGlobals(), proxySchema);
}

export async function runOneproxyRotate(opts, cmd) {
  const data = await mcpCall("omniroute_oneproxy_rotate", {
    ...(opts.strategy ? { strategy: opts.strategy } : {}),
  });
  emit(data, cmd.optsWithGlobals());
}

export function registerOneProxy(program) {
  const op = program.command("oneproxy").description(t("oneproxy.description"));

  op.command("status").action(runOneproxyStats);

  op.command("stats").action(runOneproxyStats);

  op.command("fetch")
    .description(t("oneproxy.fetch.description"))
    .option("--count <n>", t("oneproxy.fetch.count"), parseInt, 1)
    .option("--type <t>", t("oneproxy.fetch.type"), "http")
    .option("--country-code <code>", "Filter by country code")
    .option("--min-quality <n>", "Minimum quality score (0-100)", parseFloat)
    .action(runOneproxyFetch);

  op.command("rotate")
    .description(t("oneproxy.rotate.description"))
    .option("--strategy <strategy>", "Rotation strategy: random, quality, or sequential")
    .action(runOneproxyRotate);

  const config = op.command("config").description(t("oneproxy.config.description"));

  config.command("show").action(async (opts, cmd) => {
    const res = await apiFetch("/api/settings/oneproxy");
    if (!res.ok) {
      process.stderr.write(`Error: ${res.status}\n`);
      process.exit(1);
    }
    emit(await res.json(), cmd.optsWithGlobals());
  });

  config
    .command("set")
    .option("--enabled <b>", t("oneproxy.config.enabled"), (v) => v === "true")
    .option("--pool-size <n>", t("oneproxy.config.poolSize"), parseInt)
    .option("--provider-source <url>", t("oneproxy.config.providerSource"))
    .option("--rotation-policy <p>", t("oneproxy.config.rotationPolicy"))
    .action(async (opts, cmd) => {
      const body = {};
      for (const k of ["enabled", "poolSize", "providerSource", "rotationPolicy"]) {
        if (opts[k] !== undefined) body[k] = opts[k];
      }
      const res = await apiFetch("/api/settings/oneproxy", { method: "PUT", body });
      if (!res.ok) {
        process.stderr.write(`Error: ${res.status}\n`);
        process.exit(1);
      }
      emit(await res.json(), cmd.optsWithGlobals());
    });

  op.command("pool")
    .description(t("oneproxy.pool.description"))
    .action(async (opts, cmd) => {
      const res = await apiFetch("/api/settings/oneproxy?include=pool");
      if (!res.ok) {
        process.stderr.write(`Error: ${res.status}\n`);
        process.exit(1);
      }
      const data = await res.json();
      emit(data.pool ?? data, cmd.optsWithGlobals(), proxySchema);
    });
}
