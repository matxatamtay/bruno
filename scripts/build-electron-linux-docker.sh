#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ARCH="${ARCH:-amd64}"
VERSION="$(node -e 'console.log(require(process.argv[1]).version)' "$ROOT_DIR/packages/bruno-electron/package.json")"

case "$TARGET_ARCH" in
  amd64|x64|x86_64)
    DOCKER_PLATFORM="linux/amd64"
    ELECTRON_ARCH="x64"
    APPIMAGE_NAME="bruno_${VERSION}_x86_64_linux.AppImage"
    DEB_NAME="bruno_${VERSION}_amd64_linux.deb"
    ;;
  arm64|aarch64)
    DOCKER_PLATFORM="linux/arm64"
    ELECTRON_ARCH="arm64"
    APPIMAGE_NAME="bruno_${VERSION}_arm64_linux.AppImage"
    DEB_NAME="bruno_${VERSION}_arm64_linux.deb"
    ;;
  *)
    echo "Unsupported ARCH: $TARGET_ARCH (use amd64 or arm64)" >&2
    exit 2
    ;;
esac

for command_name in docker rsync node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for reproducible Linux builds." >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is not running." >&2
  exit 1
fi

STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bruno-linux-build.XXXXXX")"
cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='packages/*/node_modules' \
  --exclude='packages/bruno-electron/out' \
  --exclude='packages/bruno-electron/web' \
  --exclude='packages/bruno-app/dist' \
  "$ROOT_DIR/" "$STAGE_DIR/"

echo "Building Bruno for $DOCKER_PLATFORM in a clean Linux workspace..."

docker run --rm \
  --platform "$DOCKER_PLATFORM" \
  -v "$STAGE_DIR:/work" \
  -w /work \
  node:22-bookworm bash -lc "
    set -euo pipefail
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
      git python3 make g++ ca-certificates curl xz-utils fakeroot dpkg rpm
    npm ci
    npm run build:web
    ./scripts/build-electron.sh linux
    npm run dist:deb --workspace=packages/bruno-electron -- --${ELECTRON_ARCH} --publish never
  "

STAGE_OUT="$STAGE_DIR/packages/bruno-electron/out"
OUT_DIR="$ROOT_DIR/packages/bruno-electron/out"
mkdir -p "$OUT_DIR"

for artifact in "$APPIMAGE_NAME" "$DEB_NAME"; do
  if [[ ! -f "$STAGE_OUT/$artifact" ]]; then
    echo "Expected artifact was not created: $artifact" >&2
    exit 1
  fi
  cp "$STAGE_OUT/$artifact" "$OUT_DIR/$artifact"
done

chmod +x "$OUT_DIR/$APPIMAGE_NAME"

(
  cd "$OUT_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$APPIMAGE_NAME" "$DEB_NAME" > SHA256SUMS-linux.txt
  else
    shasum -a 256 "$APPIMAGE_NAME" "$DEB_NAME" > SHA256SUMS-linux.txt
  fi
)

printf '\nLinux artifacts:\n'
ls -lh "$OUT_DIR/$APPIMAGE_NAME" "$OUT_DIR/$DEB_NAME" "$OUT_DIR/SHA256SUMS-linux.txt"
printf '\nChecksums:\n'
cat "$OUT_DIR/SHA256SUMS-linux.txt"
