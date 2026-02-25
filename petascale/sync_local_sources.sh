#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENDOR_DIR="${ROOT_DIR}/vendor"
PETASCALE_SRC="${PETASCALE_SRC:-/home/Petascale-data}"
HEADLAMP_SRC="${HEADLAMP_SRC:-/home/K8s_Headlamp_Web_UI/headlamp}"

mkdir -p "${VENDOR_DIR}"

copy_glob() {
  local src="$1"
  local dst="$2"
  shift 2
  mkdir -p "${dst}"
  for pattern in "$@"; do
    shopt -s nullglob
    local matches=("${src}"/${pattern})
    shopt -u nullglob
    for file in "${matches[@]}"; do
      if [[ -f "${file}" ]]; then
        cp -f "${file}" "${dst}/"
      fi
    done
  done
}

sync_repo() {
  local name="$1"
  local src="$2"
  shift 2

  local dst="${VENDOR_DIR}/${name}"
  rm -rf "${dst}"
  mkdir -p "${dst}"

  if [[ ! -d "${src}" ]]; then
    echo "[sync] missing source for ${name}: ${src}" >&2
    return 1
  fi

  copy_glob "${src}" "${dst}" "$@"
  echo "[sync] ${name} <= ${src}"
}

sync_repo "bullmq" "${PETASCALE_SRC}/bullmq-master/bullmq-master" \
  "README*" "LICENSE*" "package.json" "docker-compose*.yml"

sync_repo "bull-board" "${PETASCALE_SRC}/bull-board-master/bull-board-master" \
  "README*" "LICENSE*" "package.json" "docker-compose*.yml"

sync_repo "clickhouse" "${PETASCALE_SRC}/ClickHouse-master/ClickHouse-master" \
  "README*" "LICENSE*"

sync_repo "grafana" "${PETASCALE_SRC}/grafana-main/grafana-main" \
  "README*" "LICENSE*" "package.json"

sync_repo "infra-pkg" "${PETASCALE_SRC}/infra-pkg-main/infra-pkg-main" \
  "README*" "LICENSE*"

sync_repo "kes" "${PETASCALE_SRC}/kes-master/kes-master" \
  "README*" "LICENSE*" "go.mod"

sync_repo "minio" "${PETASCALE_SRC}/minio-master/minio-master" \
  "README*" "LICENSE*" "go.mod"

sync_repo "minio_monitor" "${PETASCALE_SRC}/minio_monitor-main/minio_monitor-main" \
  "README*" "*.py"

sync_repo "pigsty" "${PETASCALE_SRC}/pigsty-main/pigsty-main" \
  "README*" "LICENSE*"

sync_repo "prometheus" "${PETASCALE_SRC}/prometheus-main/prometheus-main" \
  "README*" "LICENSE*" "go.mod"

sync_repo "valkey" "${PETASCALE_SRC}/valkey-unstable/valkey-unstable" \
  "README*"

sync_repo "headlamp" "${HEADLAMP_SRC}" \
  "README*" "LICENSE*" "package.json" "kubernetes-headlamp*.yaml"

cat > "${VENDOR_DIR}/MANIFEST.txt" <<EOF
Synced on: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
PETASCALE_SRC=${PETASCALE_SRC}
HEADLAMP_SRC=${HEADLAMP_SRC}
Packages:
  - bullmq
  - bull-board
  - clickhouse
  - grafana
  - infra-pkg
  - kes
  - minio
  - minio_monitor
  - pigsty
  - prometheus
  - valkey
  - headlamp
EOF

echo "[sync] complete: ${VENDOR_DIR}"
