import { existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { t } from "../i18n.mjs";
import { apiFetch } from "../api.mjs";
import { resolveDataDir } from "../data-dir.mjs";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

function cachePath() {
  return join(resolveDataDir(), "completion-cache.json");
}

function readCache() {
  try {
    const raw = JSON.parse(readFileSync(cachePath(), "utf8"));
    if (raw && typeof raw.ts === "number" && Date.now() - raw.ts < CACHE_TTL_MS) return raw;
  } catch (err) {
    if (process.env.OMNIROUTE_DEBUG_COMPLETION) {
      console.error(
        t("common.cli.messages.completionReadCacheFailed", { error: err?.message ?? err })
      );
    }
  }
  return null;
}

async function refreshCache(opts = {}) {
  let combos = [],
    providers = [],
    models = [];
  try {
    const [cr, pr, mr] = await Promise.allSettled([
      apiFetch("/api/combos", opts),
      apiFetch("/api/providers", opts),
      apiFetch("/api/models", opts),
    ]);
    if (cr.status === "fulfilled" && cr.value.ok) {
      const j = await cr.value.json();
      combos = (j.combos || j.items || []).map((c) => c.name || c.id).filter(Boolean);
    }
    if (pr.status === "fulfilled" && pr.value.ok) {
      const j = await pr.value.json();
      providers = (j.providers || j.items || []).map((p) => p.id || p.name).filter(Boolean);
    }
    if (mr.status === "fulfilled" && mr.value.ok) {
      const j = await mr.value.json();
      models = (Array.isArray(j) ? j : j.data || []).map((m) => m.id).filter(Boolean);
    }
  } catch (err) {
    if (process.env.OMNIROUTE_DEBUG_COMPLETION) {
      console.error(
        t("common.cli.messages.completionRefreshCacheFailed", { error: err?.message ?? err })
      );
    }
  }
  const data = { combos, providers, models, ts: Date.now() };
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(data));
  } catch (err) {
    if (process.env.OMNIROUTE_DEBUG_COMPLETION) {
      console.error(
        t("common.cli.messages.completionWriteCacheFailed", { error: err?.message ?? err })
      );
    }
  }
  return data;
}

function detectShell() {
  const shell = process.env.SHELL || "";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("fish")) return "fish";
  return "bash";
}

function installPath(shell) {
  const home = homedir();
  if (shell === "zsh") return join(home, ".zsh", "completions", "_omniroute");
  if (shell === "fish") return join(home, ".config", "fish", "completions", "omniroute.fish");
  return join(home, ".bash_completion.d", "omniroute");
}

function generateZshScript() {
  return `#compdef omniroute

# OmniRoute zsh completion (dynamic)
_omniroute_get_cache() {
  local key="$1"
  local cache="$HOME/.omniroute/completion-cache.json"
  local now=$(date +%s 2>/dev/null || echo 0)
  local mtime=0
  if [[ -f "$cache" ]]; then
    mtime=$(stat -c %Y "$cache" 2>/dev/null || stat -f %m "$cache" 2>/dev/null || echo 0)
  fi
  if [[ $((now - mtime)) -gt 3600 ]]; then
    omniroute completion refresh --quiet >/dev/null 2>&1
  fi
  if command -v python3 &>/dev/null && [[ -f "$cache" ]]; then
    python3 -c "import json,sys;d=json.load(open('$cache'));print(' '.join(d.get('$key',[])))" 2>/dev/null
  fi
}

_omniroute() {
  local -a commands
  commands=(
    'serve:${t("common.cli.messages.completionServe")}'
    'stop:${t("common.cli.messages.completionStop")}'
    'restart:${t("common.cli.messages.completionRestart")}'
    'setup:${t("common.cli.messages.completionSetup")}'
    'doctor:${t("common.cli.messages.completionDoctor")}'
    'status:${t("common.cli.messages.completionStatus")}'
    'logs:${t("common.cli.messages.completionLogs")}'
    'providers:${t("common.cli.messages.completionProviders")}'
    'config:${t("common.cli.messages.completionConfig")}'
    'keys:${t("common.cli.messages.completionKeys")}'
    'models:${t("common.cli.messages.completionModels")}'
    'combo:${t("common.cli.messages.completionCombo")}'
    'chat:${t("common.cli.messages.completionChat")}'
    'stream:${t("common.cli.messages.completionStream")}'
    'dashboard:${t("common.cli.messages.completionDashboard")}'
    'open:${t("common.cli.messages.completionOpen")}'
    'backup:${t("common.cli.messages.completionBackup")}'
    'restore:${t("common.cli.messages.completionRestore")}'
    'health:${t("common.cli.messages.completionHealth")}'
    'quota:${t("common.cli.messages.completionQuota")}'
    'cache:${t("common.cli.messages.completionCache")}'
    'mcp:${t("common.cli.messages.completionMcp")}'
    'a2a:${t("common.cli.messages.completionA2a")}'
    'tunnel:${t("common.cli.messages.completionTunnel")}'
    'env:${t("common.cli.messages.completionEnv")}'
    'test:${t("common.cli.messages.completionTest")}'
    'update:${t("common.cli.messages.completionUpdate")}'
    'completion:${t("common.cli.messages.completionCommand")}'
    'memory:${t("common.cli.messages.completionMemory")}'
    'skills:${t("common.cli.messages.completionSkills")}'
  )

  _arguments -C \\
    '1: :->command' \\
    '*:: :->arg' && return 0

  case $state in
    command) _describe 'command' commands ;;
    arg)
      case $words[1] in
        combo)
          case $words[2] in
            switch|delete|show)
              local -a combos
              combos=($(_omniroute_get_cache combos))
              _describe 'combo' combos ;;
            *) _arguments '1:subcommand:(list switch create delete show suggest)' ;;
          esac ;;
        providers|keys)
          case $words[2] in
            add|remove|test)
              local -a providers
              providers=($(_omniroute_get_cache providers))
              _describe 'provider' providers ;;
            *) _arguments '1:subcommand:(list add remove test)' ;;
          esac ;;
        chat|stream)
          _arguments \\
            '--model[${t("common.cli.messages.completionModelId")}]:model:->models' \\
            '--combo[${t("common.cli.messages.completionComboName")}]:combo:->combos' \\
            '--system[${t("common.cli.messages.completionSystemPrompt")}]:' \\
            '--max-tokens[${t("common.cli.messages.completionMaxTokens")}]:' ;;
        open)
          _arguments '1:resource:(combos providers api-manager cli-tools agents settings logs memory skills evals audit cost resilience)' ;;
        completion) _arguments '1:subcommand:(zsh bash fish install refresh)' ;;
        config) _arguments '1:subcommand:(list get set validate contexts)' ;;
        *) ;;
      esac
      case $state in
        models)
          local -a models
          models=($(_omniroute_get_cache models))
          _describe 'model' models ;;
        combos)
          local -a combos
          combos=($(_omniroute_get_cache combos))
          _describe 'combo' combos ;;
      esac ;;
  esac
}

compdef _omniroute omniroute
`;
}

function generateBashScript() {
  return `#!/bin/bash
# OmniRoute CLI bash completion (dynamic)

_omniroute_get_cache() {
  local key="$1"
  local cache="$HOME/.omniroute/completion-cache.json"
  local now
  now=$(date +%s 2>/dev/null || echo 0)
  local mtime=0
  [[ -f "$cache" ]] && mtime=$(stat -c %Y "$cache" 2>/dev/null || stat -f %m "$cache" 2>/dev/null || echo 0)
  if (( now - mtime > 3600 )); then
    omniroute completion refresh --quiet >/dev/null 2>&1
  fi
  if command -v python3 &>/dev/null && [[ -f "$cache" ]]; then
    python3 -c "import json,sys;d=json.load(open('$cache'));print(' '.join(d.get('$key',[])))" 2>/dev/null
  fi
}

_omniroute() {
  local cur prev cmds
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  cmds="setup doctor status logs providers config test update serve stop restart keys models combo chat stream completion dashboard open backup restore health quota cache mcp a2a tunnel env memory skills"

  case "\${prev}" in
    combo)       COMPREPLY=($(compgen -W "list switch create delete show suggest" -- "\${cur}")); return 0 ;;
    keys)        COMPREPLY=($(compgen -W "add list remove regenerate revoke reveal usage" -- "\${cur}")); return 0 ;;
    providers)   COMPREPLY=($(compgen -W "available list test test-all" -- "\${cur}")); return 0 ;;
    config)      COMPREPLY=($(compgen -W "list get set validate contexts" -- "\${cur}")); return 0 ;;
    completion)  COMPREPLY=($(compgen -W "zsh bash fish install refresh" -- "\${cur}")); return 0 ;;
    open)        COMPREPLY=($(compgen -W "combos providers api-manager cli-tools agents settings logs memory skills evals audit cost resilience" -- "\${cur}")); return 0 ;;
    --model)
      local models
      models=$(_omniroute_get_cache models)
      COMPREPLY=($(compgen -W "\${models}" -- "\${cur}")); return 0 ;;
    --combo)
      local combos
      combos=$(_omniroute_get_cache combos)
      COMPREPLY=($(compgen -W "\${combos}" -- "\${cur}")); return 0 ;;
    switch|delete)
      local combos
      combos=$(_omniroute_get_cache combos)
      COMPREPLY=($(compgen -W "\${combos}" -- "\${cur}")); return 0 ;;
    *)
      COMPREPLY=($(compgen -W "\${cmds} --help --version --output --quiet" -- "\${cur}")); return 0 ;;
  esac
}

complete -F _omniroute omniroute
`;
}

function generateFishScript() {
  return `# OmniRoute CLI fish completion (dynamic)
complete -c omniroute -f

set -l commands serve stop restart setup doctor status logs providers config keys models combo chat stream completion dashboard open backup restore health quota cache mcp a2a tunnel env memory skills update test

for cmd in $commands
  complete -c omniroute -n '__fish_is_nth_token 1' -a $cmd
end

# Subcommands
complete -c omniroute -n '__fish_seen_subcommand_from combo' -a 'list switch create delete show suggest'
complete -c omniroute -n '__fish_seen_subcommand_from keys' -a 'add list remove regenerate revoke reveal usage'
complete -c omniroute -n '__fish_seen_subcommand_from providers' -a 'available list test test-all'
complete -c omniroute -n '__fish_seen_subcommand_from config' -a 'list get set validate contexts'
complete -c omniroute -n '__fish_seen_subcommand_from completion' -a 'zsh bash fish install refresh'
complete -c omniroute -n '__fish_seen_subcommand_from open' -a 'combos providers api-manager cli-tools agents settings logs memory skills evals audit cost resilience'

# Dynamic completions from cache (requires python3)
function __omniroute_cache_get
  set -l key $argv[1]
  set -l cache "$HOME/.omniroute/completion-cache.json"
  set -l now (date +%s 2>/dev/null; or echo 0)
  set -l mtime 0
  test -f $cache; and set mtime (stat -c %Y $cache 2>/dev/null; or stat -f %m $cache 2>/dev/null; or echo 0)
  if test (math $now - $mtime) -gt 3600
    omniroute completion refresh --quiet >/dev/null 2>&1
  end
  if command -q python3; and test -f $cache
    python3 -c "import json,sys;d=json.load(open('$cache'));print('\\n'.join(d.get('$key',[])))" 2>/dev/null
  end
end

complete -c omniroute -n '__fish_seen_subcommand_from combo; and __fish_seen_subcommand_from switch delete' -a '(__omniroute_cache_get combos)'
complete -c omniroute -l model -a '(__omniroute_cache_get models)'
complete -c omniroute -l combo -a '(__omniroute_cache_get combos)'
`;
}

const generators = { zsh: generateZshScript, bash: generateBashScript, fish: generateFishScript };

export function registerCompletion(program) {
  const comp = program.command("completion").description(t("completion.description"));

  comp
    .command("zsh")
    .description(t("common.cli.descriptions.completionZsh"))
    .action(async () => process.stdout.write(generateZshScript()));

  comp
    .command("bash")
    .description(t("common.cli.descriptions.completionBash"))
    .action(async () => process.stdout.write(generateBashScript()));

  comp
    .command("fish")
    .description(t("common.cli.descriptions.completionFish"))
    .action(async () => process.stdout.write(generateFishScript()));

  comp
    .command("install [shell]")
    .description(t("common.cli.descriptions.completionInstall"))
    .action(async (shell, opts, cmd) => {
      const target = shell || detectShell();
      const gen = generators[target];
      if (!gen) {
        process.stderr.write(`${t("common.cli.messages.unknownShell", { shell: target })}\n`);
        process.exit(2);
      }
      const dest = installPath(target);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, gen());
      process.stdout.write(
        t("common.cli.messages.completionInstalled", { shell: target, path: dest }) + "\n"
      );
    });

  comp
    .command("refresh")
    .description(t("common.cli.descriptions.completionRefresh"))
    .option("--quiet", t("common.cli.options.quiet"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const data = await refreshCache(globalOpts);
      if (!opts.quiet && !globalOpts.quiet) {
        process.stdout.write(
          t("common.cli.messages.completionCached", {
            combos: data.combos.length,
            providers: data.providers.length,
            models: data.models.length,
          }) + "\n"
        );
      }
    });

  // Backward-compat: `omniroute completion <shell>` (positional arg form)
  comp
    .command("<shell>")
    .description(t("common.cli.descriptions.completion"))
    .allowUnknownOption(false)
    .action(async (shell) => {
      const gen = generators[shell];
      if (!gen) {
        process.stderr.write(`${t("common.cli.messages.unknownShell", { shell })}\n`);
        process.exit(1);
      }
      process.stdout.write(gen());
    });
}

// Legacy export for backward compatibility
export async function runCompletionCommand(shell) {
  const gen = generators[shell];
  if (!gen) {
    process.stderr.write(`${t("common.cli.messages.unknownShell", { shell })}\n`);
    return 1;
  }
  process.stdout.write(gen());
  return 0;
}
