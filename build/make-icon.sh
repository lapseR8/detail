#!/bin/bash
# Turns a 1024x1024 source PNG into build/icon.icns for the Electron build.
#
# Usage:
#   build/make-icon.sh path/to/your-1024.png
#   build/make-icon.sh                          # defaults to build/icon-source.png
#
# Run this any time you swap out the app icon, then rebuild with
# `npm run build:arm` — electron-builder picks up build/icon.icns
# automatically (already wired in package.json's "build.mac.icon").
set -e

SRC="${1:-$(dirname "$0")/icon-source.png}"
OUT_DIR="$(dirname "$0")"
ICONSET="/tmp/detail-icon.iconset"

if [ ! -f "$SRC" ]; then
  echo "No source image found at: $SRC"
  echo "Pass a 1024x1024 PNG as an argument, or drop one at build/icon-source.png."
  exit 1
fi

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

# macOS expects this exact set of sizes/names inside a .iconset bundle.
sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"      > /dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"   > /dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"      > /dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"   > /dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"    > /dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"    > /dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_512x512.png"    > /dev/null
sips -z 1024 1024 "$SRC" --out "$ICONSET/icon_512x512@2x.png" > /dev/null

iconutil -c icns "$ICONSET" -o "$OUT_DIR/icon.icns"
rm -rf "$ICONSET"

echo "Wrote $OUT_DIR/icon.icns from $SRC"
