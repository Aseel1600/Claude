import { readFileSync } from "node:fs";
import { apiFetch, isServerUp } from "../api.mjs";
import { mcpCallTool } from "../mcpClient.mjs";
import { emit } from "../output.mjs";
import { t } from "../i18n.mjs";

function truncate(v, len = 60) {
  if (v == null) return "-";
  const s = String(v);
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}

const mcpToolSchema = [
  { key: "name", header: "Tool", width: 36 },
  {
    key: "scopes",
    header: "Scopes",
    formatter: (v) => (Array.isArray(v) ? v.join(",") : (v ?? "-")),
  },
  { key: "auditLevel", header: "Audit", width: 10 },
  { key: "phase", header: "Phase", width: 6 },
  { key: "description", header: "Description", formatter: truncate },
];

export function registerMcp(program) {
  const mcp = program.command("mcp").description(t("mcp.title"));

  mcp
    .command("status")
    .description("Show MCP server status")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runMcpStatusCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  mcp
    .command("restart")
    .description("Restart the MCP server")
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runMcpRestartCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // 5.1 — mcp call + mcp scopes
  mcp
    .command("call <tool> [argsJson]")
    .description(t("mcp.call.description"))
    .option("--args <json>", t("mcp.call.args"))
    .option("--args-file <path>", t("mcp.call.args_file"))
    .option("--stream", t("mcp.call.stream"))
    .option("--scope <s>", t("mcp.call.scope"), (v, prev = []) => [...prev, v], [])
    .action(async (tool, argsPositional, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const args = opts.args
        ? JSON.parse(opts.args)
        : opts.argsFile
          ? JSON.parse(readFileSync(opts.argsFile, "utf8"))
          : argsPositional
            ? JSON.parse(argsPositional)
            : {};

      const exitCode = await runMcpCallCommand(
        tool,
        args,
        {
          ...opts,
          stream: opts.stream,
        },
        globalOpts
      );

      if (exitCode !== 0) process.exit(exitCode);
    });

  mcp
    .command("scopes")
    .description(t("mcp.scopes.description"))
    .option("--tool <name>", t("mcp.scopes.tool"))
    .action(async (opts, cmd) => {
      const params = new URLSearchParams({ meta: "scopes" });
      if (opts.tool) params.set("tool", opts.tool);
      const res = await apiFetch(`/api/mcp/tools?${params}`);
      if (!res.ok) {
        process.stderr.write(`Error: ${res.status}\n`);
        process.exit(1);
      }
      const data = await res.json();
      emit(data.scopes ?? data, cmd.optsWithGlobals());
    });
}

export async function runMcpCallCommand(tool, args, opts = {}, globalOpts = {}) {
  try {
    const result = await mcpCallTool(tool, args, {
      ...globalOpts,
      ...opts,
      stream: opts.stream === true,
      timeout: opts.timeout ?? globalOpts.timeout,
    });

    if (!opts.stream) {
      if (typeof result === "string") process.stdout.write(`${result}\n`);
      else emit(result, globalOpts);
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`MCP call failed: ${message}\n`);
    return typeof err?.exitCode === "number" ? err.exitCode : 1;
  }
}

export async function runMcpStatusCommand(opts = {}) {
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.error(t("common.serverOffline"));
    return 1;
  }

  try {
    const res = await apiFetch("/api/mcp/status", {
      retry: false,
      timeout: 5000,
      acceptNotOk: true,
    });
    if (!res.ok) {
      console.log(t("mcp.stopped"));
      return 0;
    }

    const status = await res.json();

    if (opts.json || opts.output === "json") {
      console.log(JSON.stringify(status, null, 2));
      return 0;
    }

    const transport = status.transport || "stdio";
    const online = status.online ?? status.running;
    console.log(online ? t("mcp.running", { transport }) : t("mcp.stopped"));
    if (status.toolsCount !== undefined) console.log(`  Tools: ${status.toolsCount}`);
    if (status.scopes?.length) {
      console.log("  Scopes:");
      for (const scope of status.scopes) console.log(`    - ${scope}`);
    }
    return 0;
  } catch (err) {
    console.error(t("common.error", { message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}

export async function runMcpRestartCommand(opts = {}) {
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.error(t("common.serverOffline"));
    return 1;
  }

  try {
    const res = await apiFetch("/api/mcp/restart", {
      method: "POST",
      retry: false,
      timeout: 10000,
      acceptNotOk: true,
    });
    if (res.ok) {
      console.log(t("mcp.restarted"));
      return 0;
    }
    console.error(t("common.error", { message: `HTTP ${res.status}` }));
    return 1;
  } catch (err) {
    console.error(t("common.error", { message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}
