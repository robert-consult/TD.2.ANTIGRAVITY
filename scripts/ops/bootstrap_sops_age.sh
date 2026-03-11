#!/usr/bin/env bash
set -euo pipefail

force=0
if [[ "${1:-}" == "--force" ]]; then
  force=1
fi

if ! command -v age-keygen >/dev/null 2>&1; then
  echo "age-keygen is required. Install age before bootstrapping SOPS."
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
generated_dir="$repo_root/PRODUCTION READINESS/generated"
template_file="$repo_root/.sops.template.yaml"
target_file="$repo_root/.sops.yaml"
key_file="$generated_dir/tradehub-prod.agekey"

if [[ ! -f "$template_file" ]]; then
  echo "Missing template: $template_file"
  exit 1
fi

umask 077
mkdir -p "$generated_dir"
chmod 700 "$generated_dir"

if [[ -f "$key_file" && "$force" -ne 1 ]]; then
  echo "Refusing to overwrite existing age key: $key_file"
  echo "Re-run with --force if you intend to rotate the local bootstrap key."
  exit 1
fi

age-keygen -o "$key_file" >/dev/null
recipient="$(awk '/public key:/{print $4}' "$key_file")"

if [[ -z "$recipient" ]]; then
  echo "Failed to extract public age recipient from $key_file"
  exit 1
fi

sed "s|AGE-RECIPIENT-PLACEHOLDER|$recipient|g" "$template_file" > "$target_file"
chmod 600 "$target_file" "$key_file"

echo "Age key written to: $key_file"
echo "Local SOPS config written to: $target_file"
echo "Public recipient: $recipient"
