#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_DIR="REPORTS AND REVIEWS/Admin/Data/New folder"
mkdir -p "$LOG_DIR" .tmp

STAMP="$(date -u +%F)"
MAIN_LOG="${MAIN_LOG:-$LOG_DIR/DEEP_SYSTEM_AUDIT_20_CYCLES_FULLSPECTRUM_${STAMP}.log}"
DETAIL_LOG="${DETAIL_LOG:-$LOG_DIR/DEEP_SYSTEM_AUDIT_20_CYCLES_FULLSPECTRUM_${STAMP}_RUNTIME.log}"
SERVER_LOG="${SERVER_LOG:-.tmp/deep-system-audit-start-e2e.log}"
PID_FILE="${PID_FILE:-.tmp/deep-system-audit-start-e2e.pid}"

CYCLES="${CYCLES:-20}"
BASE_URL="${BASE_URL:-http://127.0.0.1:5000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@local.test}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
HEAVY_EVERY="${HEAVY_EVERY:-5}"
LOAD_EVERY="${LOAD_EVERY:-4}"
UNIT_EVERY="${UNIT_EVERY:-2}"
K8S_EVERY="${K8S_EVERY:-10}"
AUDIT_EVERY="${AUDIT_EVERY:-10}"
WS_MIN_QUOTE_UPDATES="${WS_MIN_QUOTE_UPDATES:-60}"
BUILD_EVERY="${BUILD_EVERY:-4}"
PARQUET_AUDIT_EVERY="${PARQUET_AUDIT_EVERY:-4}"
SMOKE_WARMUP_QUOTES="${SMOKE_WARMUP_QUOTES:-1}"
SMOKE_WARMUP_DURATION_SEC="${SMOKE_WARMUP_DURATION_SEC:-6}"
SMOKE_WARMUP_INTERVAL_MS="${SMOKE_WARMUP_INTERVAL_MS:-500}"

: >"$MAIN_LOG"
: >"$DETAIL_LOG"
: >"$SERVER_LOG"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  local msg="$1"
  echo "[$(timestamp)] $msg" | tee -a "$MAIN_LOG"
}

run_step() {
  local name="$1"
  shift
  log "RUN $name"
  {
    echo "[$(timestamp)] >>> $name"
    "$@"
  } >>"$DETAIL_LOG" 2>&1
  local rc=$?
  if (( rc != 0 )); then
    log "FAIL $name (exit=$rc)"
  fi
  return $rc
}

port_in_use() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)5000$'
}

kill_port_5000() {
  if command -v fuser >/dev/null 2>&1; then
    fuser -k 5000/tcp >>"$DETAIL_LOG" 2>&1 || true
  fi

  local current_uid
  current_uid="$(id -u)"

  local pids=()
  if mapfile -t pids < <(pgrep -u "$current_uid" -f "node dist/index.js" 2>/dev/null || true); then
    for pid in "${pids[@]}"; do
      kill "$pid" >>"$DETAIL_LOG" 2>&1 || true
    done
  fi

  pids=()
  if mapfile -t pids < <(pgrep -u "$current_uid" -f "tsx scripts/startE2E.ts" 2>/dev/null || true); then
    for pid in "${pids[@]}"; do
      kill "$pid" >>"$DETAIL_LOG" 2>&1 || true
    done
  fi
}

stop_server() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      log "Stopping start:e2e pid=$pid"
      kill "$pid" >>"$DETAIL_LOG" 2>&1 || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  kill_port_5000

  for _ in $(seq 1 40); do
    if ! port_in_use; then
      return 0
    fi
    sleep 0.25
  done

  log "WARN port 5000 still in use after stop attempts"
  return 1
}

start_server() {
  stop_server || true
  : >"$SERVER_LOG"
  log "Starting npm run start:e2e"
  npm run start:e2e >>"$SERVER_LOG" 2>&1 &
  local pid=$!
  echo "$pid" >"$PID_FILE"

  for _ in $(seq 1 120); do
    if curl -fsS "$BASE_URL/ready" >/dev/null 2>&1; then
      log "Server ready pid=$pid"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      log "ERROR start:e2e exited before readiness"
      tail -n 80 "$SERVER_LOG" | tee -a "$MAIN_LOG" >/dev/null
      return 1
    fi
    sleep 1
  done

  log "ERROR timed out waiting for $BASE_URL/ready"
  tail -n 80 "$SERVER_LOG" | tee -a "$MAIN_LOG" >/dev/null
  return 1
}

admin_cookie() {
  BASE_URL="$BASE_URL" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node - <<'NODE'
const base = process.env.BASE_URL;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

function parseSetCookiePairs(headers) {
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    return values.map((v) => String(v || "").split(";")[0]?.trim()).filter(Boolean);
  }
  const raw = headers.get("set-cookie") || "";
  if (!raw) return [];
  const out = [];
  const pattern = /(?:^|,\s*)([^=,\s;]+=[^;,\s]+)/g;
  let m;
  while ((m = pattern.exec(raw))) {
    if (m[1]) out.push(String(m[1]).trim());
  }
  return out;
}

const res = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ email, password }),
});

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`login failed status=${res.status} body=${body.slice(0, 200)}`);
  process.exit(1);
}

const cookie = parseSetCookiePairs(res.headers).join("; ");
if (!cookie.includes("connect.sid=")) {
  console.error("login cookie missing connect.sid");
  process.exit(1);
}

process.stdout.write(cookie);
NODE
}

cleanup() {
  stop_server || true
}

trap cleanup EXIT

pass_count=0

log "START deep-system-audit cycles=$CYCLES baseUrl=$BASE_URL"
log "LOGS main=$MAIN_LOG detail=$DETAIL_LOG server=$SERVER_LOG"
run_step "db:ensure (preflight)" npm run db:ensure
start_server

for cycle in $(seq 1 "$CYCLES"); do
  log "CYCLE $cycle START"
  cycle_failed=0

  run_step "check (cycle $cycle)" npm run check || cycle_failed=1

  if (( cycle_failed == 0 && cycle % BUILD_EVERY == 0 )); then
    run_step "build (cycle $cycle)" npm run build || cycle_failed=1
  fi

  if (( cycle_failed == 0 && cycle % UNIT_EVERY == 0 )); then
    run_step "vitest (cycle $cycle)" npx vitest run || cycle_failed=1
  fi

  if (( cycle_failed == 0 )) && [[ "$SMOKE_WARMUP_QUOTES" == "1" ]]; then
    run_step "warmup:publish-quotes (cycle $cycle)" npm run loadtest:publish-quotes -- --duration-sec "$SMOKE_WARMUP_DURATION_SEC" --interval-ms "$SMOKE_WARMUP_INTERVAL_MS" || cycle_failed=1
  fi

  if (( cycle_failed == 0 )); then
    run_step "smoke:admin (cycle $cycle)" env ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run smoke:admin || cycle_failed=1
  fi
  if (( cycle_failed == 0 )); then
    run_step "smoke:trader-search (cycle $cycle)" env ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run smoke:trader-search || cycle_failed=1
  fi
  if (( cycle_failed == 0 )); then
    run_step "integrity:market-data (cycle $cycle)" env ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run integrity:market-data || cycle_failed=1
  fi

  if (( cycle_failed == 0 && cycle % LOAD_EVERY == 0 )); then
    run_step "audit:petascale-parquet (cycle $cycle)" npm run audit:petascale-parquet || cycle_failed=1
  fi

  if (( cycle_failed == 0 && cycle % LOAD_EVERY == 0 )); then
    run_step "loadtest:publish-quotes (cycle $cycle)" npm run loadtest:publish-quotes -- --duration-sec 15 --interval-ms 500 || cycle_failed=1
    if (( cycle_failed == 0 )); then
      run_step "loadtest:ws-fanout (cycle $cycle)" npm run loadtest:ws-fanout -- --duration-sec 15 --ramp-sec 5 --clients 500 --min-quote-updates "$WS_MIN_QUOTE_UPDATES" || cycle_failed=1
    fi
    if (( cycle_failed == 0 )); then
      cookie="$(admin_cookie)" || cycle_failed=1
    fi
    if (( cycle_failed == 0 )); then
      run_step "loadtest:admin-data-tab (cycle $cycle)" env LOADTEST_ADMIN_COOKIE="$cookie" LOADTEST_DURATION_SEC=30 LOADTEST_CONCURRENCY=6 npm run loadtest:admin-data-tab || cycle_failed=1
    fi
    if (( cycle_failed == 0 )); then
      run_step "loadtest:export-pipeline (cycle $cycle)" env LOADTEST_ADMIN_COOKIE="$cookie" LOADTEST_EXPORT_JOB_COUNT=6 LOADTEST_EXPORT_MAX_WAIT_SEC=240 npm run loadtest:export-pipeline || cycle_failed=1
    fi
  fi

  if (( cycle_failed == 0 && cycle % PARQUET_AUDIT_EVERY == 0 && cycle % LOAD_EVERY != 0 )); then
    run_step "audit:petascale-parquet (cycle $cycle)" npm run audit:petascale-parquet || cycle_failed=1
  fi

  if (( cycle_failed == 0 && cycle % K8S_EVERY == 0 )); then
    run_step "k8s dry-run (cycle $cycle)" kubectl apply --dry-run=client -f k8s/ || cycle_failed=1
  fi

  if (( cycle_failed == 0 && cycle % AUDIT_EVERY == 0 )); then
    run_step "db:audit (cycle $cycle)" npm run db:audit || cycle_failed=1
    if (( cycle_failed == 0 )); then
      run_step "audit:activity (cycle $cycle)" npm run audit:activity || cycle_failed=1
    fi
    if (( cycle_failed == 0 )); then
      run_step "audit:trade-history (cycle $cycle)" npm run audit:trade-history || cycle_failed=1
    fi
    if (( cycle_failed == 0 )); then
      run_step "npm audit high (cycle $cycle)" npm audit --audit-level=high || cycle_failed=1
    fi
  fi

  if (( cycle_failed == 0 && cycle % HEAVY_EVERY == 0 )); then
    stop_server || true
    run_step "e2e (cycle $cycle)" npm run e2e || cycle_failed=1
    start_server || cycle_failed=1
  fi

  if (( cycle_failed == 0 )); then
    log "CYCLE $cycle PASS"
    pass_count=$((pass_count + 1))
  else
    log "CYCLE $cycle FAIL"
    exit 1
  fi
done

log "DONE pass_count=$pass_count cycles=$CYCLES"
