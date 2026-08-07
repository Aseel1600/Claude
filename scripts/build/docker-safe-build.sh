#!/usr/bin/env bash
set -Eeuo pipefail

image="${IMAGE_TAG:-omniroute:safe-build}"
target="${DOCKER_TARGET:-runner-cli}"
build_memory="${OMNIROUTE_BUILD_MEMORY_MB:-3072}"
builder_memory="${DOCKER_BUILDER_MEMORY:-4g}"
builder_memory="${builder_memory,,}"
builder_cpus="${DOCKER_BUILDER_CPUS:-2}"
builder_swap="${DOCKER_BUILDER_SWAP:-8g}"
builder_swap="${builder_swap,,}"
builder="${DOCKER_BUILDER:-omniroute-safe-${builder_memory}-${builder_cpus//./-}}"
progress="${BUILDKIT_PROGRESS:-plain}"

usage() {
  printf '%s\n' 'Usage: scripts/build/docker-safe-build.sh [IMAGE] [--target TARGET] [--no-cache]'
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

[[ "${1:-}" != "-h" && "${1:-}" != "--help" ]] || { usage; exit 0; }
if [[ "${1:-}" != -* ]]; then
  image="$1"
  shift
fi

[[ "$build_memory" =~ ^[1-9][0-9]*$ ]] || die 'OMNIROUTE_BUILD_MEMORY_MB must be a positive integer'
[[ "$builder_memory" =~ ^[1-9][0-9]*([kKmMgG])?$ ]] || die 'DOCKER_BUILDER_MEMORY must be a Docker memory value'
[[ "$builder_cpus" =~ ^[1-9][0-9]*(\.[0-9]+)?$ ]] || die 'DOCKER_BUILDER_CPUS must be positive'

no_cache=0
while (($#)); do
  case "$1" in
    --target) target="${2:?--target requires a value}"; shift 2 ;;
    --no-cache) no_cache=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

exec 9>"${DOCKER_SAFE_BUILD_LOCK:-/tmp/omniroute-docker-build.lock}"
flock -n 9 || die 'another Docker build is active'

docker_context="${DOCKER_CONTEXT:-.}"
[[ -f "$docker_context/Dockerfile" ]] || die "Dockerfile not found in build context: $docker_context"

if [[ "$builder_memory" =~ ^([0-9]+)g$ ]] && (( build_memory >= BASH_REMATCH[1] * 1024 )); then
  die 'build heap must stay below the builder memory budget'
fi

build_args=(--file "$docker_context/Dockerfile" --target "$target" --build-arg "OMNIROUTE_BUILD_MEMORY_MB=$build_memory")
(( no_cache == 0 )) || build_args+=(--no-cache)

require_command docker
require_command flock
docker buildx version >/dev/null 2>&1 || die 'Docker Buildx is required'

printf '%s\n' '--- Docker preflight ---'
docker info --format 'memory={{.MemTotal}} cpus={{.NCPU}} driver={{.Driver}}'
docker system df

host_total_mb=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0)
host_avail_mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo 2>/dev/null || echo 0)
case "$builder_memory" in
  *g) builder_mb=$(( ${builder_memory%g} * 1024 )) ;;
  *m) builder_mb=${builder_memory%m} ;;
  *k) builder_mb=$(( ${builder_memory%k} / 1024 )) ;;
  *) builder_mb=0 ;;
esac
[[ "$builder_mb" =~ ^[1-9][0-9]*$ ]] || die 'unable to parse DOCKER_BUILDER_MEMORY'
 if (( builder_mb < 1024 )); then die 'DOCKER_BUILDER_MEMORY must be at least 1g'; fi
 if (( builder_mb > host_total_mb )); then die 'DOCKER_BUILDER_MEMORY exceeds host memory'; fi
 if (( builder_mb > 0 && host_avail_mb < builder_mb + 1024 )); then
   printf 'WARNING: only %sMiB host memory available, builder budget is %sMiB plus 1GiB headroom.\n' \
     "$host_avail_mb" "$builder_mb" >&2
   [[ "${ALLOW_LOW_MEMORY:-0}" == "1" ]] || die "insufficient free host memory: need $((builder_mb + 1024))MiB, have ${host_avail_mb}MiB. Close other apps or set ALLOW_LOW_MEMORY=1"
 fi
 if (( builder_mb > 0 )); then
   printf 'Host memory: total=%sMiB available=%sMiB builder=%sMiB\n' "${host_total_mb:-?}" "${host_avail_mb:-?}" "$builder_mb"
 fi
required_headroom_mb=$((builder_mb + 1024))
if (( host_avail_mb > 0 && host_avail_mb < required_headroom_mb )); then
  printf 'WARNING: only %sMiB host memory available, builder budget is %sMiB plus 1GiB headroom.\n' \
    "$host_avail_mb" "$builder_mb" >&2
  if [[ "${ALLOW_LOW_MEMORY:-0}" == "1" ]]; then
    printf 'Proceeding because ALLOW_LOW_MEMORY=1\n' >&2
  else
    die "insufficient free host memory: need ${required_headroom_mb}MiB, have ${host_avail_mb}MiB. Close other apps or set ALLOW_LOW_MEMORY=1"
  fi
fi
printf 'Host memory: total=%sMiB available=%sMiB builder=%sMiB\n' "${host_total_mb:-?}" "${host_avail_mb:-?}" "$builder_mb"

docker buildx inspect "$builder" >/dev/null 2>&1 ||
  docker buildx create --name "$builder" --driver docker-container \
    --driver-opt "memory=$builder_memory" \
    --driver-opt "memory-swap=$builder_swap" >/dev/null

docker buildx inspect "$builder" --bootstrap
printf 'Building %s with builder=%s target=%s heap=%sMiB\n' "$image" "$builder" "$target" "$build_memory"

docker buildx build --builder "$builder" --progress "$progress" --load \
  -t "$image" "${build_args[@]}" "$docker_context"

printf '%s\n' '--- Docker postflight ---'
docker image inspect "$image" --format 'id={{.Id}} size={{.Size}} created={{.Created}}'
docker system df
