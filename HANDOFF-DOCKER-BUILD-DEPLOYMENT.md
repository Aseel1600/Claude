# OmniRoute Docker Build + Deployment Handoff

> **Current production runbook:** [`docs/ops/ORACLE_VPS_OPERATIONS_KB.md`](docs/ops/ORACLE_VPS_OPERATIONS_KB.md) records the completed Oracle VPS migration, live topology, source/fix lineage, data policy, Tailscale Funnel identity, search stack, deployment procedure, and recovery checks. This handoff remains the generic resource-bounded build reference.

Status: historical build handoff; production migrated to `oracle-vps` on 2026-07-30.

## Root cause

The Docker builder runs Next.js/Turbopack, native compilation, npm, and Docker overhead concurrently. `Dockerfile` allows a 4096 MiB V8 heap; Docker had no bounded builder budget. This host has ~11 GiB RAM, a ~3 GiB qBittorrent process, 15.43 GiB images, and ~8.3 GiB BuildKit cache. No kernel OOM record was available, so the exact kill event cannot be proven; unbounded aggregate memory is the supported diagnosis.

## Safe build

Builds are serialized through a dedicated Buildx container capped at 4 GiB RAM + 8 GiB swap and 2 CPUs. The Node heap defaults to 3072 MiB, leaving headroom for native/Turbopack memory. The wrapper refuses to start when host available memory is below the builder budget plus 1 GiB headroom.

```bash
cd ~/OmniRoute
IMAGE_TAG=omniroute:home-wsl npm run build:docker:safe
```

Tuning for smaller hosts:

```bash
DOCKER_BUILDER_MEMORY=3g DOCKER_BUILDER_SWAP=6g DOCKER_BUILDER_CPUS=2 \
OMNIROUTE_BUILD_MEMORY_MB=2048 \
npm run build:docker:safe
```

Do not run concurrent builds. Do not set `OMNIROUTE_BUILD_MEMORY_MB` above `DOCKER_BUILDER_MEMORY`. The command prints Docker memory, image/cache, and result metadata. It uses `--load`, so the image is available to the local Docker engine.

Safe-build implementation: `scripts/build/docker-safe-build.sh`; npm alias: `package.json` → `build:docker:safe`.

## Runtime limits

`docker-compose.yml` and `docker-compose.prod.yml` cap the app by default at 2 GiB RAM/swap and 2 CPUs. Runtime V8 heap defaults to 1536 MiB. Redis defaults to 256 MiB RAM/swap and 0.5 CPU in the local Compose file. Override with `OMNIROUTE_CONTAINER_MEMORY`, `OMNIROUTE_CONTAINER_CPUS`, and `OMNIROUTE_MEMORY_MB` when justified.

Validate rendered config:

```bash
docker compose -f docker-compose.yml config >/tmp/omniroute-compose.txt
docker compose -f docker-compose.prod.yml config >/tmp/omniroute-prod-compose.txt
```

## Windows home PC / WSL2

1. Install Docker Desktop; enable Linux containers and the WSL2 backend.
2. Docker Desktop → Settings → Resources: start with 6 GiB memory, 2 CPUs, 8 GiB swap. Leave at least 4 GiB for Windows/other apps. The wrapper's default builder is 4 GiB RAM + 8 GiB swap; lower it if the PC has less memory.
3. Keep the checkout in WSL’s Linux filesystem, not `/mnt/c`:

```bash
wsl
mkdir -p ~/src
cd ~/src
# clone/copy OmniRoute here
npm install
IMAGE_TAG=omniroute:home-wsl npm run build:docker:safe
```

4. Confirm the image before transfer:

```bash
docker image inspect omniroute:home-wsl \
  --format 'id={{.Id}} size={{.Size}} created={{.Created}}'
```

The WSL/Docker Desktop cap protects the PC; Compose limits protect the running service. Review `docker system df` before any manual cache cleanup. Do not run broad prune commands without checking rollback images first.

> **2026-08-07 onward: oracle-vps production deploys via the blue-green pipeline** — build with
> the 20g builder from the `vps-build-vb` fork branch, promote with `vb-swap.sh`, roll back with
> `vb-rollback.sh`, refresh the standby with `vb-standby.sh`, auto-switch via the
> `omniroute-bluegreen.service` watcher (see `docs/ops/ORACLE_VPS_OPERATIONS_KB.md` §16). The wrapper
> flow below is the legacy path, retained for other hosts.

## Deployment

Use the existing rollback-safe wrapper. It validates the remote Compose config, requires equal `mem_limit`/`memswap_limit`, checks at least 4 GiB free in the remote filesystem, verifies the image ID, health-checks, and rolls back on failure.

```bash
./deploy-omniroute.sh local-ssh omniroute:home-wsl
```

For a preloaded remote image:

```bash
./deploy-omniroute.sh preloaded omniroute:home-wsl
```

Never use a foreground `docker save | ssh` pipeline. Keep the rollback image until health and live-request checks pass. Do not deploy from this handoff without an explicit release decision.

## Verification

```bash
bash -n scripts/build/docker-safe-build.sh deploy-omniroute.sh
npm run build:docker:safe -- --help
./deploy-omniroute.sh --self-test
git diff --check
```

Run typecheck/lint/tests separately before release. A failed Docker build is not a release; capture the BuildKit error plus preflight diagnostics before retrying.
