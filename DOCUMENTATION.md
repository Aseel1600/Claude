# OmniRoute Custom Fork — Maintenance & Auto-Update Documentation

> **Maintained by:** Hermes (patch manager) on behalf of benzntech
> **Repo:** `/Volumes/External/bensonmac/Documents/OmniRoute/OmniRoute`
> **Upstream:** `https://github.com/diegosouzapw/OmniRoute`
> **Fork:** `https://github.com/benzntech/OmniRoute`
> **Last reviewed:** 2026-08-13 (v3.8.49 → release/v3.8.50 in flight)

---

## 1. What this setup is

This machine runs **a custom version of OmniRoute** that is _not_ the stock npm
global package. The running code is a **git source checkout of the benzntech
fork**, linked into the global `omniroute` command, built with **pnpm**, and
managed by **PM2** exactly like before (`pm2 id 0`, `omniroute serve --no-open`).

### Why

1. **Remove the global npm dependency.** Upstream's auto-update runs
   `npm install -g omniroute@<latest>`. On this machine that would replace the
   linked fork with the stock npm package — silently discarding the custom
   commits (quota-aware scheduling, etc.). The fork is linked via
   `npm link .` so `/opt/homebrew/bin/omniroute` → fork `bin/omniroute.mjs`.
2. **The "Update Available" banner error.** When a new release appears, the
   dashboard banner's "Update Now" previously went down the npm-mode path
   (`npm install -g`) — clobbering the custom install — or the source path,
   which checked out the release tag but **never re-applied the custom fix
   patch** (patch-commit wiring existed only for docker-compose mode). Both are
   patched (see §4).
3. **pnpm everywhere.** All install/build steps use pnpm (the repo ships
   `pnpm-workspace.yaml` + `pnpm.json`; the pnpm store lives at
   `/Volumes/External/.pnpm-store/v11`).

---

## 2. Runtime layout

| Piece                           | Location                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------- |
| Source checkout (the real code) | `/Volumes/External/bensonmac/Documents/OmniRoute/OmniRoute`                                         |
| Global command                  | `/opt/homebrew/bin/omniroute` → `../lib/node_modules/omniroute/bin/omniroute.mjs` (symlink to fork) |
| Global package dir              | `/opt/homebrew/lib/node_modules/omniroute` → symlink to fork                                        |
| Data dir (DB, logs, `.env`)     | `~/.omniroute/`                                                                                     |
| PM2                             | `pm2 id 0`, name `omniroute`, `serve --no-open`                                                     |
| Package manager                 | pnpm 11 (`~/.local/bin/pnpm`), store `/Volumes/External/.pnpm-store/v11`                            |

Verify with:

```bash
readlink /opt/homebrew/lib/node_modules/omniroute        # → fork path
pm2 list                                                 # id 0 omniroute online
omniroute --version                                      # fork version
curl -s localhost:20128/health | head -c 80              # dashboard HTML = healthy
```

---

## 3. The custom fix patch

The fork carries commits that are **not yet merged upstream**. When a release
is pulled, these must be re-applied on top.

### Current patch set (AUTO_UPDATE_PATCH_COMMITS)

| Commit      | What                                                            | Upstream PR | Status                   |
| ----------- | --------------------------------------------------------------- | ----------- | ------------------------ |
| `9a7efe8d3` | quota Phase 2: adapters, reset timers, analytics, dashboard API | #10126      | **OPEN** — keep patching |
| `3e00f0f4a` | quota-aware provider scheduling (opt-in)                        | #10098      | **OPEN** — keep patching |
| `6c421c5c1` | rename migration 143→148 `provider_quota_state`                 | #10098      | **OPEN** — keep patching |

### No longer patched

| Commit                                                           | Upstream PR | Status                                                                                                  |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| ban-safety hardening (onboarding retries, signature-bypass gate) | #9939       | **MERGED 2026-08-10** → upstream releases now include it; its commits were dropped from the patch list. |

---

## 4. What was patched in the fork (code changes)

### `src/lib/system/autoUpdate.ts`

- `buildSourceUpdateScript()` now uses **pnpm** (`pnpm install --prefer-offline`,
  `pnpm run build`) instead of npm.
- Checks out the release on a **named branch** (`autoupdate/<version>`) instead
  of detached HEAD, so a patch can be applied on top.
- **Does NOT auto-cherry-pick** the fix patch — Hermes applies it as a manual
  step (per user instruction: "let hermes do the patch not autoheaking").
- `launchAutoUpdate()` passes through as before; pm2 restart retained.

### `src/app/api/system/version/route.ts` (dashboard "Update Now")

- Source-mode stream uses **pnpm** install/build.
- Checks out the release on `autoupdate/<version>` branch.
- Added a NOTE documenting that the fix patch is applied by Hermes afterwards
  (never auto-cherry-picked in the route).

### `bin/cli/commands/update.mjs` (`omniroute update ...`)

- New `isSourceInstall()`: true when `PKG_ROOT/.git` exists.
- `--apply` on a source install now runs **git fetch + checkout tag + pnpm
  install + pnpm build + pm2 restart** — it **never** runs
  `npm install -g omniroute` (which would clobber the link).
- `--dry-run` reports the source-aware plan.
- Genuine npm global installs keep the upstream `npm install -g` behavior.

### `bin/omniroute.mjs`

- The "Update available" notifier is source-aware: on a source install it
  advises `omniroute update --apply` (git+pnpm) instead of `npm install -g`.

### `pnpm-workspace.yaml`

- Fixed placeholder `allowBuilds` values (`@playwright/browser-chromium`,
  `bun`) that made `pnpm install` inside the build fail with
  `ERR_PNPM_IGNORED_BUILDS`.

---

## 5. Update procedure (when "Update Available" appears)

The dashboard banner appears when `isNewer(latest, current)` (npm registry →
GitHub releases fallback). **Two options:**

### Option A — In-dashboard "Update Now" (recommended for the pull step)

1. Banner shows → click **Update Now**.
2. Route runs **source mode**: `git fetch --tags origin` → verify tag →
   backup branch → checkout `autoupdate/<version>` → `pnpm install` →
   `pnpm run build` → `pm2 restart omniroute --update-env`.
3. **The route does NOT apply the fix patch.** After the build completes and
   the service restarts, run **Option C** below.

### Option B — CLI: `omniroute update --apply`

Same as Option A (git + pnpm + pm2) because the install is a source checkout.
It prints a reminder that the custom patch commits must be re-applied by Hermes.

### Option C — Apply the fix patch (Hermes step, REQUIRED after every pull)

```bash
cd /Volumes/External/bensonmac/Documents/OmniRoute/OmniRoute
# 1. confirm which commits are still unmerged upstream:
gh pr view 10098 --repo diegosouzapw/OmniRoute --json state,mergedAt
gh pr view 10126 --repo diegosouzapw/OmniRoute --json state,mergedAt
# 2. cherry-pick the still-open patch set onto the freshly-pulled release branch:
git cherry-pick --keep-redundant-commits 9a7efe8d3 3e00f0f4a 6c421c5c1
# 3. rebuild with pnpm and restart via pm2 (process management unchanged):
pnpm install --prefer-offline
pnpm run build
pm2 restart omniroute --update-env
```

If a cherry-pick conflicts, resolve, `git cherry-pick --continue`, rebuild,
restart. Then verify: `pm2 list`, `omniroute --version`,
`curl -s localhost:20128/health`.

> The `AUTO_UPDATE_PATCH_COMMITS` env var (in `~/.omniroute/.env`) is the
> single source of truth for the patch list. **When a PR merges upstream, remove
> its commit from that list** — the release then already contains the fix and no
> cherry-pick is needed.

---

## 6. "Stop patching" switch (when the PRs merge)

Once **both** #10098 and #10126 are merged upstream (check with
`gh pr view <n> --repo diegosouzapw/OmniRoute --json state`):

1. Empty the patch list in `~/.omniroute/.env`:
   ```bash
   # AUTO_UPDATE_PATCH_COMMITS=   ← set to empty / remove the line
   ```
2. From then on, updates are **pure upstream + pnpm**: pull the release,
   `pnpm install`, `pnpm run build`, `pm2 restart` — no cherry-pick step.
3. Optionally drop the local branch commits if they are exact upstream copies
   (they will be skipped anyway by `--keep-redundant-commits` semantics when
   Hermes runs the manual cherry-pick, and by upstream code once merged).

The code honors this automatically: with `AUTO_UPDATE_PATCH_COMMITS` empty,
Hermes' update procedure performs no cherry-pick.

---

## 7. Rollback

The source-mode update creates a backup branch before switching:

```bash
cd /Volumes/External/bensonmac/Documents/OmniRoute/OmniRoute
git branch | grep pre-update/        # e.g. pre-update/<shortsha>-<timestamp>
git checkout pre-update/<shortsha>-<timestamp>
pnpm install --prefer-offline
pnpm run build
pm2 restart omniroute --update-env
```

CLI `omniroute update --apply` also copies `bin/` files to
`~/.omniroute/backups/omniroute-<ts>/` (upstream behavior, source installs
primarily rely on git backup branches).

---

## 8. Environment knobs (set in `~/.omniroute/.env`)

| Var                         | Value here                      | Meaning                                                            |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `AUTO_UPDATE_MODE`          | `source`                        | git-based self-update (never `npm install -g`)                     |
| `AUTO_UPDATE_GIT_REMOTE`    | `origin`                        | remote whose tags carry releases (origin = upstream)               |
| `AUTO_UPDATE_PATCH_COMMITS` | `9a7efe8d3 3e00f0f4a 6c421c5c1` | custom fix patch to re-apply after each pull; clear when PRs merge |

Additional env knobs read by the code (see `getAutoUpdateConfig()` in
`src/lib/system/autoUpdate.ts`): `AUTO_UPDATE_REPO_DIR`,
`AUTO_UPDATE_COMPOSE_FILE`, `AUTO_UPDATE_COMPOSE_PROFILE`,
`AUTO_UPDATE_SERVICE`, `AUTO_UPDATE_LOG_PATH`. `OMNIROUTE_NO_UPDATE_NOTIFIER=1`
silences the CLI update banner.

---

## 9. Known state & verification checklist

- [ ] `readlink /opt/homebrew/lib/node_modules/omniroute` → fork path
- [ ] `pm2 list` → id 0 `omniroute` online
- [ ] `curl -s localhost:20128/health` → HTML (healthy)
- [ ] `curl -s localhost:20128/v1/models | head -c 200` → model catalog
- [ ] patch commits present: `git log --oneline -3` shows the quota commits
- [ ] `pnpm --version` ≥ 11; store on /Volumes/External
- [ ] `AUTO_UPDATE_MODE=source` in `~/.omniroute/.env`
- [ ] upstream PR states checked at each update (see §3 table)
