import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { apiFetch, isServerUp } from "../api.mjs";
import { emit } from "../output.mjs";
import { t } from "../i18n.mjs";

const A2A_SKILLS = [
  { id: "smart-routing", name: t("common.cli.messages.smartRoutingSkill") },
  { id: "quota-management", name: t("common.cli.messages.quotaManagementSkill") },
  { id: "provider-discovery", name: t("common.cli.messages.providerDiscoverySkill") },
  { id: "cost-analysis", name: t("common.cli.messages.costAnalysisSkill") },
  { id: "health-report", name: t("common.cli.messages.healthReportSkill") },
];

function fmtTs(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 11);
}

async function confirm(q) {
  return new Promise((resolve) => {
    process.stdout.write(`${q}${t("common.cli.messages.confirmYesNoSuffix")}`);
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (c) => resolve(c.toString().trim().toLowerCase().startsWith("y")));
  });
}

const taskSchema = [
  { key: "id", header: t("common.cli.messages.taskIdHeader"), width: 22 },
  { key: "skill", header: t("common.cli.messages.skillHeader"), width: 22 },
  { key: "status", header: t("common.cli.tui.evalStatus"), width: 12 },
  { key: "createdAt", header: t("common.cli.messages.createdHeader"), formatter: fmtTs },
  { key: "updatedAt", header: t("common.cli.messages.updatedHeader"), formatter: fmtTs },
  {
    key: "duration",
    header: t("common.cli.messages.durationHeader"),
    formatter: (v) => (v != null ? `${v}ms` : "-"),
  },
];

export function registerA2a(program) {
  const a2a = program.command("a2a").description(t("common.cli.descriptions.a2a"));

  a2a
    .command("status")
    .description(t("common.cli.descriptions.a2aStatus"))
    .option("--json", t("common.jsonOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runA2aStatusCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  a2a
    .command("card")
    .description(t("common.cli.descriptions.a2aCard"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runA2aCardCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // 5.3 — a2a skills + a2a invoke
  a2a
    .command("skills")
    .description(t("a2a.skills.description"))
    .action(async (opts, cmd) => {
      const res = await apiFetch("/.well-known/agent.json");
      if (res.ok) {
        const card = await res.json();
        emit(card.skills ?? A2A_SKILLS, cmd.optsWithGlobals());
      } else {
        emit(A2A_SKILLS, cmd.optsWithGlobals());
      }
    });

  a2a
    .command("invoke <skill>")
    .description(t("a2a.invoke.description"))
    .option("--input <json>", t("a2a.invoke.input"))
    .option("--input-file <path>", t("a2a.invoke.input_file"))
    .option("--wait", t("a2a.invoke.wait"))
    .option("--timeout <ms>", t("a2a.invoke.timeout"), parseInt, 60000)
    .action(async (skill, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const input = opts.input
        ? JSON.parse(opts.input)
        : opts.inputFile
          ? JSON.parse(readFileSync(opts.inputFile, "utf8"))
          : {};

      const rpcBody = {
        jsonrpc: "2.0",
        id: randomId(),
        method: "tasks.create",
        params: {
          skill,
          input,
          messages: [{ role: "user", parts: [{ kind: "data", data: input }] }],
        },
      };

      const res = await apiFetch("/api/a2a/tasks", { method: "POST", body: rpcBody });
      if (!res.ok) {
        process.stderr.write(`${t("common.error", { message: res.status })}\n`);
        process.exit(1);
      }
      const created = await res.json();
      const taskId = created.result?.taskId ?? created.taskId ?? created.id;

      if (!opts.wait) {
        emit({ taskId }, globalOpts);
        return;
      }

      const deadline = Date.now() + (opts.timeout ?? 60000);
      while (Date.now() < deadline) {
        await sleep(1000);
        const taskRes = await apiFetch(`/api/a2a/tasks/${taskId}`);
        if (!taskRes.ok) continue;
        const task = (await taskRes.json()).result ?? (await taskRes.clone().json());
        const state = task.status?.state ?? task.status;
        if (["completed", "failed", "cancelled"].includes(state)) {
          emit(task, globalOpts);
          return;
        }
      }
      process.stderr.write(`${t("common.cli.messages.taskTimeout")}\n`);
      process.exit(124);
    });

  // 5.4 — a2a tasks
  const tasks = a2a.command("tasks").description(t("a2a.tasks.description"));

  tasks
    .command("list")
    .option("--status <s>", t("a2a.tasks.list.status"))
    .option("--skill <s>", t("a2a.tasks.list.skill"))
    .option("--limit <n>", t("common.cli.options.modelIdentifier"), parseInt, 50)
    .option("--since <ts>", t("common.cli.options.outputPath"))
    .action(async (opts, cmd) => {
      const params = new URLSearchParams({ limit: String(opts.limit ?? 50) });
      if (opts.status) params.set("status", opts.status);
      if (opts.skill) params.set("skill", opts.skill);
      if (opts.since) params.set("since", opts.since);
      const res = await apiFetch(`/api/a2a/tasks?${params}`);
      if (!res.ok) {
        process.stderr.write(`${t("common.error", { message: res.status })}\n`);
        process.exit(1);
      }
      const data = await res.json();
      emit(data.tasks ?? data.items ?? data, cmd.optsWithGlobals(), taskSchema);
    });

  tasks.command("get <id>").action(async (id, opts, cmd) => {
    const res = await apiFetch(`/api/a2a/tasks/${id}`);
    if (!res.ok) {
      process.stderr.write(`${t("common.cli.messages.notFound", { id })}\n`);
      process.exit(1);
    }
    emit(await res.json(), cmd.optsWithGlobals());
  });

  tasks
    .command("cancel <id>")
    .option("--yes", t("common.yesOpt"))
    .action(async (id, opts, cmd) => {
      if (!opts.yes) {
        const ok = await confirm(t("common.cli.messages.cancelTask", { id }));
        if (!ok) return;
      }
      const res = await apiFetch(`/api/a2a/tasks/${id}/cancel`, { method: "POST" });
      if (!res.ok) {
        process.stderr.write(`${t("common.error", { message: res.status })}\n`);
        process.exit(1);
      }
      process.stdout.write(`${t("common.cli.messages.cancelledLine")}\n`);
    });

  tasks
    .command("watch <id>")
    .description(t("a2a.tasks.watch.description"))
    .action(async (id, opts, cmd) => {
      let lastState = "";
      while (true) {
        const res = await apiFetch(`/api/a2a/tasks/${id}`);
        if (res.ok) {
          const data = await res.json();
          const state = data.status?.state ?? data.status ?? "";
          if (state !== lastState) {
            process.stderr.write(`[${new Date().toISOString()}] ${state}\n`);
            lastState = state;
          }
          if (["completed", "failed", "cancelled"].includes(state)) {
            emit(data, cmd.optsWithGlobals());
            return;
          }
        }
        await sleep(1500);
      }
    });

  tasks
    .command("stream <id>")
    .description(t("a2a.tasks.stream.description"))
    .action(async (id, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const baseUrl = globalOpts.baseUrl ?? "http://localhost:20128";
      const apiKey = globalOpts.apiKey ?? "";
      const res = await fetch(`${baseUrl}/api/a2a/tasks/${id}?stream=true`, {
        headers: {
          Accept: "text/event-stream",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
      });
      if (!res.ok) {
        process.stderr.write(`${t("common.cli.messages.http", { status: res.status })}\n`);
        process.exit(1);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const raw = line.slice(6).trim();
            if (raw && raw !== "[DONE]") process.stdout.write(raw + "\n");
          }
        }
      }
    });

  tasks
    .command("logs <id>")
    .description(t("a2a.tasks.logs.description"))
    .action(async (id, opts, cmd) => {
      const res = await apiFetch(`/api/a2a/tasks/${id}?include=messages,artifacts`);
      if (!res.ok) {
        process.stderr.write(`${t("common.cli.messages.notFound", { id })}\n`);
        process.exit(1);
      }
      const data = await res.json();
      emit(data.messages ?? data, cmd.optsWithGlobals());
    });
}

export async function runA2aStatusCommand(opts = {}) {
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.error(t("common.serverOffline"));
    return 1;
  }

  try {
    const res = await apiFetch("/api/a2a/status", {
      retry: false,
      timeout: 5000,
      acceptNotOk: true,
    });
    if (!res.ok) {
      console.log(t("common.cli.messages.statusUnavailable"));
      return 0;
    }

    const status = await res.json();

    if (opts.json || opts.output === "json") {
      console.log(JSON.stringify(status, null, 2));
      return 0;
    }

    const running = status.running ? "\x1b[32mrunning\x1b[0m" : "\x1b[31mstopped\x1b[0m";
    console.log(`  ${t("common.cli.messages.statusLabel")}    ${running}`);
    console.log(
      `  ${t("common.cli.messages.protocolLabel")}  ${status.protocol || "JSON-RPC 2.0"}`
    );
    console.log(
      `  ${t("common.cli.messages.tasksLabel")}     ${status.activeTasks || 0} ${t("common.cli.messages.activeSuffix")}`
    );

    if (status.skills?.length) {
      console.log(`\n  ${t("common.cli.messages.skillsLabel")}`);
      for (const skill of status.skills) {
        console.log(
          `\x1b[2m    - ${skill.name}: ${skill.description || t("common.cli.messages.notApplicable")}\x1b[0m`
        );
      }
    }
    return 0;
  } catch (err) {
    console.error(t("common.error", { message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}

export async function runA2aCardCommand(opts = {}) {
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.error(t("common.serverOffline"));
    return 1;
  }

  try {
    const res = await apiFetch("/.well-known/agent.json", {
      retry: false,
      timeout: 5000,
      acceptNotOk: true,
    });
    if (res.ok) {
      const card = await res.json();
      console.log(JSON.stringify(card, null, 2));
      return 0;
    }
    console.log(t("common.cli.messages.agentCardUnavailable"));
    return 0;
  } catch (err) {
    console.error(t("common.error", { message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}
