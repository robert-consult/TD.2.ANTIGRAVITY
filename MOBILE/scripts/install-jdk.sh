#!/usr/bin/env bash
set -euo pipefail

# Capacitor Android currently compiles with Java 21.
JDK_MAJOR="${JDK_MAJOR:-21}"
JDK_ROOT="${JDK_ROOT:-$HOME/.local/share/jdks}"
JDK_LINK="${JDK_ROOT}/temurin-${JDK_MAJOR}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: This installer currently supports Linux (including WSL) only." >&2
  exit 1
fi

arch="$(uname -m)"
case "$arch" in
  x86_64) adoptium_arch="x64" ;;
  aarch64 | arm64) adoptium_arch="aarch64" ;;
  *)
    echo "ERROR: Unsupported CPU architecture: $arch" >&2
    exit 1
    ;;
esac

if [[ -x "${JDK_LINK}/bin/java" ]]; then
  echo "JDK already present at: ${JDK_LINK}"
  "${JDK_LINK}/bin/java" -version
  exit 0
fi

mkdir -p "${JDK_ROOT}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

url="https://api.adoptium.net/v3/binary/latest/${JDK_MAJOR}/ga/linux/${adoptium_arch}/jdk/hotspot/normal/eclipse"
echo "Downloading Eclipse Temurin JDK ${JDK_MAJOR} from:"
echo "  ${url}"
curl -fsSL -L "${url}" -o "${tmpdir}/jdk.tar.gz"

# Avoid SIGPIPE failures under `set -o pipefail` when using `head`.
set +o pipefail
jdk_dir_name="$(tar -tzf "${tmpdir}/jdk.tar.gz" | head -n 1 | cut -d/ -f1)"
set -o pipefail

if [[ -z "${jdk_dir_name}" ]]; then
  echo "ERROR: Failed to determine extracted JDK directory name." >&2
  exit 1
fi

echo "Extracting to: ${JDK_ROOT}/${jdk_dir_name}"
tar -xzf "${tmpdir}/jdk.tar.gz" -C "${JDK_ROOT}"

ln -sfn "${JDK_ROOT}/${jdk_dir_name}" "${JDK_LINK}"

echo "Installed JDK symlink:"
echo "  ${JDK_LINK}"
"${JDK_LINK}/bin/java" -version
"${JDK_LINK}/bin/javac" -version

