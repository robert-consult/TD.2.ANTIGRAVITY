#!/usr/bin/env bash
set -euo pipefail

required_tools=(
  age
  age-keygen
  sops
  kubectl
  helm
  argocd
  cosign
  syft
  grype
  trivy
  jq
  yq
)

optional_tools=(
  docker
  gh
)

missing=0

printf 'TradeHub production toolchain audit\n'
printf '==================================\n'

for tool in "${required_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'FOUND    %s -> %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'MISSING  %s\n' "$tool"
    missing=1
  fi
done

if command -v kustomize >/dev/null 2>&1; then
  printf 'FOUND    %s -> %s\n' "kustomize" "$(command -v kustomize)"
elif kubectl kustomize --help >/dev/null 2>&1; then
  printf 'FOUND    %s -> kubectl kustomize\n' "kustomize"
else
  printf 'MISSING  %s\n' "kustomize"
  missing=1
fi

printf '\nOptional operator helpers\n'
printf '%s\n' '-------------------------'

for tool in "${optional_tools[@]}"; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'FOUND    %s -> %s\n' "$tool" "$(command -v "$tool")"
  else
    printf 'OPTIONAL %s\n' "$tool"
  fi
done

if [[ "$missing" -ne 0 ]]; then
  printf '\nOne or more required tools are missing.\n'
  exit 1
fi

printf '\nAll required tools are present.\n'
