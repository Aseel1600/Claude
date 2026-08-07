#!/usr/bin/env bash
set -Eeuo pipefail

DEFAULT_IMAGE="${IMAGE_TAG:-omniroute:deploy-candidate}"
DEFAULT_HOST="${SSH_HOST:-vietnam-vps}"
DEFAULT_REMOTE_DIR="${REMOTE_DIR:-~/OmniRoute}"
DEFAULT_COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.parallel.yml}"
DEFAULT_SERVICE="${SERVICE:-omniroute}"
DEFAULT_CONTAINER="${CONTAINER:-omniroute-parallel}"
DEFAULT_HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:20130/api/monitoring/health}"
DEFAULT_REMOTE_IMAGE="${REMOTE_IMAGE:-omniroute:search-v3-final}"
DEFAULT_ROLLBACK_IMAGE="${ROLLBACK_IMAGE:-omniroute:rollback-prev}"
DEFAULT_SESSION="${TMUX_SESSION:-omni-deploy}"
DEFAULT_LOG_FILE="${DEPLOY_LOG:-/tmp/omni-deploy.log}"
DEFAULT_TIMEOUT="${HEALTH_TIMEOUT:-360}"
DEFAULT_INTERVAL="${HEALTH_INTERVAL:-5}"

usage() {
  cat <<'USAGE'
Usage:
  deploy-omniroute.sh MODE [IMAGE] [OPTIONS]
  deploy-omniroute.sh --self-test

Modes:
  local-ssh  Stream a local image to an SSH host, then deploy there.
  preloaded  Deploy an image already loaded on an SSH host.
  native     Deploy an image on this host; never invokes SSH.

Options:
  --image IMAGE              Candidate image (default: omniroute:deploy-candidate)
  --host HOST                SSH host (default: vietnam-vps)
  --remote-dir DIR           Compose directory (default: ~/OmniRoute)
  --compose-file FILE        Compose file (default: docker-compose.parallel.yml)
  --service SERVICE          Compose service (default: omniroute)
  --container CONTAINER      Runtime container (default: omniroute-parallel)
  --health-url URL           Host health URL
  --remote-image IMAGE       Compose image tag (default: omniroute:search-v3-final)
  --rollback-image IMAGE     Rollback tag (default: omniroute:rollback-prev)
  --session NAME             Detached session (default: omni-deploy)
  --log-file FILE            Deployment log (default: /tmp/omni-deploy.log)
  --timeout SECONDS          Health deadline (default: 360)
  --interval SECONDS         Health polling interval (default: 5)
  -h, --help                 Show help

Environment variables matching the defaults above are also supported.
USAGE
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

quote_command() {
  local result="" quoted arg
  for arg in "$@"; do
    printf -v quoted '%q' "$arg"
    result+="${result:+ }$quoted"
  done
  printf '%s' "$result"
}

valid_image_id() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

has_forbidden_entrypoint_bind() {
  local config="$1"
  grep -Eq "(source|target):[[:space:]]*['\"]?/(tmp|app)/check-permissions\\.sh(['\"]|[[:space:]]|$)" <<<"$config" ||
    grep -Eq "(^|:)['\"]?/(tmp|app)/check-permissions\\.sh(:|['\"]?[[:space:]]*$)" <<<"$config"
}

resolve_remote_dir() {
  case "$remote_dir" in
    "~") remote_dir="$HOME" ;;
    "~/"*) remote_dir="$HOME/${remote_dir#\~/}" ;;
  esac
}

parse_options() {
  mode="${1:-}"
  [[ -n "$mode" ]] || { usage >&2; exit 2; }
  shift

  image="$DEFAULT_IMAGE"
  host="$DEFAULT_HOST"
  remote_dir="$DEFAULT_REMOTE_DIR"
  compose_file="$DEFAULT_COMPOSE_FILE"
  service="$DEFAULT_SERVICE"
  container="$DEFAULT_CONTAINER"
  health_url="$DEFAULT_HEALTH_URL"
  remote_image="$DEFAULT_REMOTE_IMAGE"
  rollback_image="$DEFAULT_ROLLBACK_IMAGE"
  session="$DEFAULT_SESSION"
  log_file="$DEFAULT_LOG_FILE"
  health_timeout="$DEFAULT_TIMEOUT"
  health_interval="$DEFAULT_INTERVAL"

  if [[ $# -gt 0 && "$1" != -* ]]; then
    image="$1"
    shift
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image) image="${2:?--image requires a value}"; shift 2 ;;
      --host) host="${2:?--host requires a value}"; shift 2 ;;
      --remote-dir) remote_dir="${2:?--remote-dir requires a value}"; shift 2 ;;
      --compose-file) compose_file="${2:?--compose-file requires a value}"; shift 2 ;;
      --service) service="${2:?--service requires a value}"; shift 2 ;;
      --container) container="${2:?--container requires a value}"; shift 2 ;;
      --health-url) health_url="${2:?--health-url requires a value}"; shift 2 ;;
      --remote-image) remote_image="${2:?--remote-image requires a value}"; shift 2 ;;
      --rollback-image) rollback_image="${2:?--rollback-image requires a value}"; shift 2 ;;
      --session) session="${2:?--session requires a value}"; shift 2 ;;
      --log-file) log_file="${2:?--log-file requires a value}"; shift 2 ;;
      --timeout) health_timeout="${2:?--timeout requires a value}"; shift 2 ;;
      --interval) health_interval="${2:?--interval requires a value}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1" ;;
    esac
  done

  [[ "$mode" == "local-ssh" || "$mode" == "preloaded" || "$mode" == "native" ]] ||
    die "mode must be local-ssh, preloaded, or native"
  [[ "$session" =~ ^[A-Za-z0-9_.-]+$ ]] || die "session contains unsupported characters"
  [[ "$health_timeout" =~ ^[1-9][0-9]*$ ]] || die "timeout must be a positive integer"
  [[ "$health_interval" =~ ^[1-9][0-9]*$ ]] || die "interval must be a positive integer"
}

image_id() {
  docker image inspect "$1" --format '{{.Id}}'
}

compose_preflight() {
  [[ -d "$remote_dir" ]] || die "remote directory does not exist: $remote_dir"
  cd "$remote_dir"
  [[ -f "$compose_file" ]] || die "compose file does not exist: $remote_dir/$compose_file"

  local rendered service_config services configured_images memory_limit swap_limit
  rendered="$(docker compose -f "$compose_file" config)"
  service_config="$(awk -v service="$service" '$0 == "  " service ":" { found = 1; next } found && /^  [^ ]/ { exit } found { print }' <<<"$rendered")"
  services="$(docker compose -f "$compose_file" config --services)"
  memory_limit="$(grep -m1 'mem_limit:' <<<"$service_config" | awk '{print $2}')"
  swap_limit="$(grep -m1 'memswap_limit:' <<<"$service_config" | awk '{print $2}')"
  [[ -n "$memory_limit" && "$memory_limit" == "$swap_limit" ]] ||
    die "service $service must define equal mem_limit and memswap_limit (got ${memory_limit:-unset}/${swap_limit:-unset})"
  printf 'Remote resource limits: service=%s mem_limit=%s memswap_limit=%s\n' "$service" "$memory_limit" "$swap_limit"
  df -Pk "$remote_dir" | awk 'NR == 2 { if ($4 < 4194304) exit 1 }' ||
    die "insufficient remote free space: need at least 4 GiB in $remote_dir"
  docker system df


  grep -Fxq -- "$service" <<<"$services" || die "compose service not found: $service"
  has_forbidden_entrypoint_bind "$rendered" &&
    die "compose binds host check-permissions.sh; use the file baked into the image"

  configured_images="$(docker compose -f "$compose_file" config --images "$service")"
  grep -Fxq -- "$remote_image" <<<"$configured_images" ||
    die "service $service is not configured to use $remote_image"
}

verify_candidate() {
  local actual_id
  actual_id="$(image_id "$image")"
  valid_image_id "$actual_id" || die "invalid candidate image ID: $actual_id"
  [[ "$actual_id" == "$expected_id" ]] ||
    die "candidate content ID mismatch: expected=$expected_id actual=$actual_id"

  local entrypoint check_permissions
  entrypoint="$(docker image inspect "$image" --format '{{json .Config.Entrypoint}}')"
  case "$entrypoint" in
    '["/tmp/check-permissions.sh"]') check_permissions=/tmp/check-permissions.sh ;;
    '["/app/check-permissions.sh"]') check_permissions=/app/check-permissions.sh ;;
    *) die "candidate entrypoint is not baked check-permissions.sh: $entrypoint" ;;
  esac
  docker run --rm --entrypoint /bin/sh "$image" -ec \
    "test -x $check_permissions && test -f /app/healthcheck.mjs && test -f /app/dev/run-standalone.mjs" ||
    die "candidate lacks baked executable entrypoint, healthcheck, or runtime launcher"
}

print_diagnostics() {
  printf 'Deployment diagnostics:\n' >&2
  docker inspect "$container" --format '{{json .State}}' >&2 2>/dev/null || true
  docker inspect "$container" --format '{{json .State.Health}}' >&2 2>/dev/null || true
  docker compose -f "$compose_file" ps "$service" >&2 2>/dev/null || true
  docker logs --tail 100 "$container" >&2 2>/dev/null || true
  df -h "$remote_dir" >&2 2>/dev/null || true
}

wait_for_health() {
  local wanted_id="$1" label="$2"
  local deadline=$((SECONDS + health_timeout)) attempt=0 state health restarts error actual_id http_code

  while (( SECONDS < deadline )); do
    attempt=$((attempt + 1))
    state="$(docker inspect "$container" --format '{{.State.Status}}' 2>/dev/null || true)"
    health="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' 2>/dev/null || true)"
    restarts="$(docker inspect "$container" --format '{{.RestartCount}}' 2>/dev/null || true)"
    error="$(docker inspect "$container" --format '{{.State.Error}}' 2>/dev/null || true)"
    actual_id="$(docker inspect "$container" --format '{{.Image}}' 2>/dev/null || true)"
    http_code="$(curl --max-time 5 -sS -o /dev/null -w '%{http_code}' "$health_url" 2>/dev/null || true)"
    printf '%s health attempt %d: state=%s health=%s restarts=%s image=%s http=%s error=%s\n' \
      "$label" "$attempt" "${state:-missing}" "${health:-missing}" "${restarts:-unknown}" \
      "${actual_id:-missing}" "${http_code:-000}" "${error:-none}"

    if [[ "$state" == "running" && "$health" == "healthy" && "$actual_id" == "$wanted_id" &&
      "$http_code" =~ ^2[0-9][0-9]$ ]]; then
      return 0
    fi
    sleep "$health_interval"
  done
  return 1
}

rollback() {
  local rollback_id actual_id
  printf 'DEPLOY_FAILED: restoring %s\n' "$rollback_image" >&2
  rollback_id="$(image_id "$rollback_image")" || return 1
  [[ "$rollback_id" == "$snapshot_id" ]] || {
    printf 'Rollback snapshot mismatch: expected=%s actual=%s\n' "$snapshot_id" "$rollback_id" >&2
    return 1
  }

  docker tag "$rollback_image" "$remote_image"
  actual_id="$(image_id "$remote_image")"
  [[ "$actual_id" == "$snapshot_id" ]] || return 1
  docker compose -f "$compose_file" up -d --no-build --no-deps --force-recreate "$service"
  if ! wait_for_health "$snapshot_id" rollback; then
    printf 'ROLLBACK_FAILED: service did not recover\n' >&2
    print_diagnostics
    return 1
  fi
  printf 'ROLLBACK_OK image=%s\n' "$snapshot_id" >&2
}

handle_failure() {
  local rc=$?
  trap - ERR INT TERM
  if (( rollback_armed )); then
    rollback_armed=0
    rollback || {
      printf 'FATAL: deployment and verified rollback both failed\n' >&2
      exit 2
    }
  fi
  exit "$rc"
}

run_deploy() {
  require_command docker
  require_command curl
  require_command flock
  resolve_remote_dir

  exec 9>"/tmp/omniroute-deploy.lock"
  flock -n 9 || die "another deployment is active"

  compose_preflight
  verify_candidate

  [[ -n "$(docker ps -aq --filter "name=^/${container}$")" ]] ||
    die "rollback unavailable: container does not exist: $container"
  snapshot_id="$(docker inspect "$container" --format '{{.Image}}')"
  valid_image_id "$snapshot_id" || die "invalid production image ID: $snapshot_id"
  docker image inspect "$snapshot_id" >/dev/null
  docker tag "$snapshot_id" "$rollback_image"
  [[ "$(image_id "$rollback_image")" == "$snapshot_id" ]] || die "rollback snapshot verification failed"

  rollback_armed=1
  trap handle_failure ERR INT TERM

  docker tag "$image" "$remote_image"
  [[ "$(image_id "$remote_image")" == "$expected_id" ]] || die "candidate tag verification failed"
  docker compose -f "$compose_file" up -d --no-build --no-deps --force-recreate "$service"

  if ! wait_for_health "$expected_id" candidate; then
    printf 'Candidate health gate failed\n' >&2
    print_diagnostics
    return 1
  fi

  rollback_armed=0
  trap - ERR INT TERM
  printf 'DEPLOY_OK image=%s rollback=%s\n' "$expected_id" "$snapshot_id"
  docker inspect "$container" --format 'container={{.Name}} image={{.Image}} health={{.State.Health.Status}} restarts={{.RestartCount}}'
  df -h "$remote_dir"
}

internal_args() {
  printf '%s\0' \
    __deploy --image "$image" --remote-dir "$remote_dir" --compose-file "$compose_file" \
    --service "$service" --container "$container" --health-url "$health_url" \
    --remote-image "$remote_image" --rollback-image "$rollback_image" --session "$session" \
    --log-file "$log_file" --timeout "$health_timeout" --interval "$health_interval" \
    --expected-id "$expected_id"
}

build_internal_argv() {
  internal_argv=(bash "$script_path")
  while IFS= read -r -d '' arg; do
    internal_argv+=("$arg")
  done < <(internal_args)
}

start_detached_here() {
  require_command nohup
  build_internal_argv

  if command -v tmux >/dev/null 2>&1; then
    tmux has-session -t "$session" 2>/dev/null && die "tmux session already exists: $session"
    local payload
    payload="$(quote_command "${internal_argv[@]}") >> $(printf '%q' "$log_file") 2>&1"
    tmux new-session -d -s "$session" "$payload"
    printf 'Deployment started in tmux session %s\n' "$session"
  else
    nohup "${internal_argv[@]}" >>"$log_file" 2>&1 </dev/null &
    printf 'Deployment started with nohup PID %s\n' "$!"
  fi
  printf 'Log: %s\n' "$log_file"
}

remote_exec() {
  local command_line
  command_line="$(quote_command "$@")"
  ssh -- "$host" "$command_line"
}

upload_remote_script() {
  remote_script="/tmp/omniroute-deploy-${session}.sh"
  local remote_script_q
  printf -v remote_script_q '%q' "$remote_script"
  ssh -- "$host" "umask 077; cat > $remote_script_q && chmod 700 $remote_script_q" <"$script_path"
}

start_detached_remote() {
  upload_remote_script
  script_path="$remote_script"
  build_internal_argv

  local log_q session_q payload payload_q
  printf -v log_q '%q' "$log_file"
  printf -v session_q '%q' "$session"
  payload="$(quote_command "${internal_argv[@]}") >> $log_q 2>&1"
  printf -v payload_q '%q' "$payload"

  if remote_exec command -v tmux >/dev/null 2>&1; then
    if remote_exec tmux has-session -t "$session" >/dev/null 2>&1; then
      die "remote tmux session already exists: $session"
    fi
    remote_exec tmux new-session -d -s "$session" "$payload"
    printf 'Remote deployment started in tmux session %s on %s\n' "$session" "$host"
  else
    remote_exec bash -c "nohup $payload </dev/null & printf '%s\\n' \"\$!\"" >/dev/null
    printf 'Remote deployment started with nohup on %s\n' "$host"
  fi
  printf 'Remote log: %s:%s\n' "$host" "$log_file"
}

self_test() {
  local sample quoted
  valid_image_id "sha256:$(printf 'a%.0s' {1..64})" || die "valid_image_id rejected a valid ID"
  ! valid_image_id 'sha256:not-an-id' || die "valid_image_id accepted an invalid ID"
  sample=$'services:\n  app:\n    volumes:\n      - type: bind\n        source: /tmp/check-permissions.sh\n        target: /tmp/check-permissions.sh'
  has_forbidden_entrypoint_bind "$sample" || die "bind detector missed long source syntax"
  sample=$'services:\n  app:\n    volumes:\n      - /opt/check-permissions.sh:/tmp/check-permissions.sh:ro'
  has_forbidden_entrypoint_bind "$sample" || die "bind detector missed short target syntax"
  sample=$'services:\n  app:\n    volumes:\n      - /opt/check-permissions.sh:/app/check-permissions.sh:ro'
  has_forbidden_entrypoint_bind "$sample" || die "bind detector missed /app target syntax"
  ! has_forbidden_entrypoint_bind $'services:\n  app:\n    image: omniroute:test' ||
    die "bind detector rejected safe compose config"
  quoted="$(quote_command printf '%s' 'a b' '$(false)')"
  [[ "$(bash -c "$quoted")" == 'a b$(false)' ]] || die "command quoting failed"
  printf 'SELF_TEST_OK\n'
}

if [[ "${1:-}" == "--self-test" ]]; then
  self_test
  exit 0
fi

if [[ "${1:-}" == "__deploy" ]]; then
  shift
  mode="internal"
  expected_id=""
  image="$DEFAULT_IMAGE"
  remote_dir="$DEFAULT_REMOTE_DIR"
  compose_file="$DEFAULT_COMPOSE_FILE"
  service="$DEFAULT_SERVICE"
  container="$DEFAULT_CONTAINER"
  health_url="$DEFAULT_HEALTH_URL"
  remote_image="$DEFAULT_REMOTE_IMAGE"
  rollback_image="$DEFAULT_ROLLBACK_IMAGE"
  session="$DEFAULT_SESSION"
  log_file="$DEFAULT_LOG_FILE"
  health_timeout="$DEFAULT_TIMEOUT"
  health_interval="$DEFAULT_INTERVAL"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --image) image="$2"; shift 2 ;;
      --remote-dir) remote_dir="$2"; shift 2 ;;
      --compose-file) compose_file="$2"; shift 2 ;;
      --service) service="$2"; shift 2 ;;
      --container) container="$2"; shift 2 ;;
      --health-url) health_url="$2"; shift 2 ;;
      --remote-image) remote_image="$2"; shift 2 ;;
      --rollback-image) rollback_image="$2"; shift 2 ;;
      --session) session="$2"; shift 2 ;;
      --log-file) log_file="$2"; shift 2 ;;
      --timeout) health_timeout="$2"; shift 2 ;;
      --interval) health_interval="$2"; shift 2 ;;
      --expected-id) expected_id="$2"; shift 2 ;;
      *) die "unknown internal option: $1" ;;
    esac
  done
  valid_image_id "$expected_id" || die "missing or invalid expected image ID"
  rollback_armed=0
  snapshot_id=""
  run_deploy
  exit 0
fi

parse_options "$@"
script_path="$(realpath "$0")"
require_command docker

case "$mode" in
  native)
    expected_id="$(image_id "$image")" || die "candidate image not found: $image"
    valid_image_id "$expected_id" || die "invalid local candidate image ID"
    start_detached_here
    ;;
  preloaded)
    require_command ssh
    expected_id="$(remote_exec docker image inspect "$image" --format '{{.Id}}')" ||
      die "candidate image not found on $host: $image"
    valid_image_id "$expected_id" || die "invalid remote candidate image ID"
    remote_exec df -Pk "$remote_dir" | awk 'NR == 2 { if ($4 < 4194304) exit 1 }' ||
      die "insufficient remote free space: need at least 4 GiB in $remote_dir"
    start_detached_remote
    ;;
  local-ssh)
    require_command ssh
    expected_id="$(image_id "$image")" || die "local candidate image not found: $image"
    valid_image_id "$expected_id" || die "invalid local candidate image ID"
    remote_exec docker info >/dev/null
    remote_exec df -Pk "$remote_dir" | awk 'NR == 2 { if ($4 < 4194304) exit 1 }' ||
      die "insufficient remote free space: need at least 4 GiB in $remote_dir"
    printf 'Streaming %s to %s\n' "$image" "$host"
    docker save "$image" | ssh -- "$host" docker load
    remote_id="$(remote_exec docker image inspect "$image" --format '{{.Id}}')"
    [[ "$remote_id" == "$expected_id" ]] ||
      die "transferred content ID mismatch: expected=$expected_id actual=$remote_id"
    start_detached_remote
    ;;
esac
