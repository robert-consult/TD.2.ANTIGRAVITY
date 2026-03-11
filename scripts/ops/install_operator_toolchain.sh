#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
TMP_DIR="$(mktemp -d)"

trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$BIN_DIR"

get_latest_tag() {
  local repo="$1"
  python3 - "$repo" <<'PY'
import json
import sys
import urllib.request

repo = sys.argv[1]
with urllib.request.urlopen(f"https://api.github.com/repos/{repo}/releases/latest") as response:
    print(json.load(response)["tag_name"])
PY
}

install_direct_binary() {
  local url="$1"
  local name="$2"
  curl -fsSL "$url" -o "$BIN_DIR/$name"
  chmod +x "$BIN_DIR/$name"
}

install_age() {
  local age_tag
  age_tag="$(get_latest_tag FiloSottile/age)"
  curl -fsSL \
    "https://github.com/FiloSottile/age/releases/download/${age_tag}/age-${age_tag}-linux-amd64.tar.gz" \
    -o "$TMP_DIR/age.tar.gz"
  tar -xzf "$TMP_DIR/age.tar.gz" -C "$TMP_DIR"
  install -m 755 "$TMP_DIR/age/age" "$BIN_DIR/age"
  install -m 755 "$TMP_DIR/age/age-keygen" "$BIN_DIR/age-keygen"
}

echo "Installing age"
install_age

echo "Installing jq"
install_direct_binary "https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64" "jq"

echo "Installing Helm"
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | USE_SUDO=false HELM_INSTALL_DIR="$BIN_DIR" bash

echo "Installing Argo CD CLI"
install_direct_binary "https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64" "argocd"

echo "Installing cosign"
install_direct_binary "https://github.com/sigstore/cosign/releases/latest/download/cosign-linux-amd64" "cosign"

echo "Installing yq"
install_direct_binary "https://github.com/mikefarah/yq/releases/latest/download/yq_linux_amd64" "yq"

echo "Installing sops"
SOPS_TAG="$(get_latest_tag getsops/sops)"
SOPS_VERSION="${SOPS_TAG#v}"
install_direct_binary "https://github.com/getsops/sops/releases/download/${SOPS_TAG}/sops-v${SOPS_VERSION}.linux.amd64" "sops"

echo "Installing syft"
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b "$BIN_DIR"

echo "Installing grype"
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b "$BIN_DIR"

echo "Installing trivy"
curl -sSfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b "$BIN_DIR"

echo "Tool installation complete. Re-run 'npm run ops:toolchain-check' to verify."
