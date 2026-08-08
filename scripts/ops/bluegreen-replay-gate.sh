#!/usr/bin/env bash
set -euo pipefail

TEXT_RAW_MODEL="${TEXT_RAW_MODEL:-antigravity/gemini-2.5-flash-lite}"
IMAGE_RAW_MODEL="${IMAGE_RAW_MODEL:-antigravity/claude-sonnet-4-6}"
TEXT_COMBO_MODEL="${TEXT_COMBO_MODEL:-pool-sonnet}"
IMAGE_COMBO_MODEL="${IMAGE_COMBO_MODEL:-antigravity-sonnet-vision}"
REPLAY_SUCCESS_THRESHOLD="${REPLAY_SUCCESS_THRESHOLD:-5}"
REPLAY_TIMEOUT="${REPLAY_TIMEOUT:-90}"
IMAGE_DATA_URI="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

usage() {
  printf 'Usage: OMNIROUTE_API_KEY=... %s BASE_URL\n' "${0##*/}"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${1:-}" != "--help" ]] || { usage; exit 0; }
[[ $# -eq 1 ]] || { usage >&2; exit 2; }
[[ -n "${OMNIROUTE_API_KEY:-}" ]] || die "OMNIROUTE_API_KEY is required"
[[ "$REPLAY_SUCCESS_THRESHOLD" =~ ^[1-9][0-9]*$ ]] || die "invalid replay threshold"
[[ "$REPLAY_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die "invalid replay timeout"
command -v curl >/dev/null 2>&1 || die "curl is required"
command -v python3 >/dev/null 2>&1 || die "python3 is required"

BASE_URL="${1%/}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
chmod 700 "$WORK_DIR"

build_request() {
  local model="$1" kind="$2" output="$3"
  MODEL="$model" KIND="$kind" IMAGE_DATA_URI="$IMAGE_DATA_URI" python3 - "$output" <<'PY'
import json, os, sys
content = "Reply with one word: ready"
if os.environ["KIND"] == "image":
    content = [
        {"type": "text", "text": "Name the dominant color in this image."},
        {"type": "image_url", "image_url": {"url": os.environ["IMAGE_DATA_URI"]}},
    ]
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump({"model": os.environ["MODEL"], "messages": [{"role": "user", "content": content}], "stream": False, "max_tokens": 32}, fh)
PY
}

validate_response() {
  python3 - "$1" <<'PY'
import json, sys

raw = open(sys.argv[1], encoding="utf-8").read().strip()
if not raw:
    raise SystemExit("empty response")

payloads = []
if raw.startswith("data:") or "\ndata:" in raw:
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("event:") and "error" in line.lower():
            raise SystemExit("error event")
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            continue
        try:
            payloads.append(json.loads(data))
        except json.JSONDecodeError:
            raise SystemExit("invalid SSE data")
else:
    try:
        payloads.append(json.loads(raw))
    except json.JSONDecodeError:
        raise SystemExit("invalid JSON")

if not payloads:
    raise SystemExit("no response payload")

texts = []
def scan(value):
    if isinstance(value, dict):
        if value.get("error") or "error" in str(value.get("type", "")).lower():
            raise SystemExit("error payload")
        for key, item in value.items():
            if key in {"content", "text", "output_text"} and isinstance(item, str) and item.strip():
                texts.append(item.strip())
            else:
                scan(item)
    elif isinstance(value, list):
        for item in value:
            scan(item)

for payload in payloads:
    scan(payload)

if not texts:
    raise SystemExit("empty assistant output")
PY
}

run_case() {
  local suite="$1" label="$2" model="$3" kind="$4"
  local request="$WORK_DIR/request.json" response="$WORK_DIR/response.txt" code reason
  build_request "$model" "$kind" "$request"
  code="$(curl --silent --show-error --max-time "$REPLAY_TIMEOUT" \
    --output "$response" --write-out '%{http_code}' \
    --request POST "$BASE_URL/v1/chat/completions" \
    --header 'Content-Type: application/json' \
    --header "Authorization: Bearer $OMNIROUTE_API_KEY" \
    --data-binary "@$request" 2>"$WORK_DIR/curl.err" || true)"
  if [[ "$code" != "200" ]]; then
    printf 'suite=%s case=%s model=%s http=%s FAIL reason=http\n' \
      "$suite" "$label" "$model" "${code:-000}"
    return 1
  fi
  if ! reason="$(validate_response "$response" 2>&1)"; then
    printf 'suite=%s case=%s model=%s http=200 FAIL reason=%s\n' \
      "$suite" "$label" "$model" "${reason//$'\n'/ }"
    return 1
  fi
  printf 'suite=%s case=%s model=%s http=200 PASS\n' "$suite" "$label" "$model"
}

streak=0
while (( streak < REPLAY_SUCCESS_THRESHOLD )); do
  suite=$((streak + 1))
  passed=1
  run_case "$suite" text-raw "$TEXT_RAW_MODEL" text || passed=0
  run_case "$suite" image-raw "$IMAGE_RAW_MODEL" image || passed=0
  run_case "$suite" text-combo "$TEXT_COMBO_MODEL" text || passed=0
  run_case "$suite" image-combo "$IMAGE_COMBO_MODEL" image || passed=0
  if (( ! passed )); then
    printf 'target=%s suite=%s streak=0/%s FAIL\n' \
      "$BASE_URL" "$suite" "$REPLAY_SUCCESS_THRESHOLD"
    exit 1
  fi
  streak=$((streak + 1))
  printf 'target=%s suite=%s streak=%s/%s PASS\n' \
    "$BASE_URL" "$suite" "$streak" "$REPLAY_SUCCESS_THRESHOLD"
done

printf 'REPLAY_GATE_OK target=%s streak=%s/%s\n' \
  "$BASE_URL" "$streak" "$REPLAY_SUCCESS_THRESHOLD"
