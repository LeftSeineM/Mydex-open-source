#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION=0.5.2-preview.2
ARCH="${MYDEX_ARCH:-$(uname -m)}"
case "$ARCH" in arm64) NODE_ARCH=arm64;; x86_64) NODE_ARCH=x64;; *) echo 'Unsupported architecture'; exit 1;; esac
NODE_VERSION=25.6.0
OUT="$ROOT/build/macos-$ARCH"
APP="$OUT/Mydex.app"
CONTENTS="$APP/Contents"
ENGINE="$CONTENTS/Resources/engine"
mkdir -p "$ENGINE/runtime" "$ENGINE/gateway" "$ENGINE/desktop/macos" "$CONTENTS/MacOS" "$ROOT/dist" "$ROOT/build/node-downloads"
ARCHIVE="node-v$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
BASE="https://nodejs.org/dist/v$NODE_VERSION"
curl --fail --location --retry 2 "$BASE/$ARCHIVE" -o "$ROOT/build/node-downloads/$ARCHIVE"
curl --fail --location --retry 2 "$BASE/SHASUMS256.txt" -o "$ROOT/build/node-downloads/SHASUMS256.txt"
(cd "$ROOT/build/node-downloads"; grep "  $ARCHIVE$" SHASUMS256.txt > selected.sha256; test -s selected.sha256; shasum -a 256 -c selected.sha256; tar -xzf "$ARCHIVE")
cp "$ROOT/build/node-downloads/node-v$NODE_VERSION-darwin-$NODE_ARCH/bin/node" "$ENGINE/runtime/node"
cp "$ROOT/build/node-downloads/node-v$NODE_VERSION-darwin-$NODE_ARCH/LICENSE" "$ENGINE/runtime/LICENSE-node.txt"
# Explicit allowlist: never include pairing files, private config, logs or tests.
cp "$ROOT"/gateway/*.mjs "$ROOT"/gateway/package*.json "$ENGINE/gateway/"
cp "$ROOT/desktop/gui-bridge.mjs" "$ROOT/desktop/updater.mjs" "$ROOT/desktop/setup.mjs" "$ROOT/desktop/app-relay.json" "$ENGINE/desktop/"
cp -R "$ROOT/desktop/bridges" "$ENGINE/desktop/"
cp "$ROOT/desktop/macos/bridge.mjs" "$ROOT/desktop/macos/gateway.mjs" "$ROOT/desktop/macos/updater.mjs" "$ROOT/desktop/macos/install-helper.mjs" "$ENGINE/desktop/macos/"
(cd "$ENGINE/gateway"; npm ci --omit=dev --ignore-scripts)
cp "$ROOT/LICENSE" "$CONTENTS/Resources/LICENSE.txt"
# Reuse the existing Mydex phone/desktop icon without introducing another brand.
ICONSET="$OUT/Mydex.iconset"
mkdir -p "$ICONSET"
sips -s format png "$ROOT/desktop/Mydex.ico" --out "$OUT/icon.png" >/dev/null
for SIZE in 16 32 128 256 512; do
 sips -z "$SIZE" "$SIZE" "$OUT/icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
 DOUBLE=$((SIZE * 2)); sips -z "$DOUBLE" "$DOUBLE" "$OUT/icon.png" --out "$ICONSET/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$CONTENTS/Resources/Mydex.icns"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>dev.mydex.desktop</string>
<key>CFBundleName</key><string>Mydex</string>
<key>CFBundleDisplayName</key><string>Mydex</string>
<key>CFBundleExecutable</key><string>Mydex</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>Mydex</string>
<key>CFBundleShortVersionString</key><string>0.5.2</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSLocalNetworkUsageDescription</key><string>让自己的手机连接这台 Mac 上的 Mydex。</string>
</dict></plist>
PLIST
xcrun swiftc -swift-version 5 -parse-as-library -O -target "$ARCH-apple-macos13.0" "$ROOT/desktop/macos/Mydex.swift" -o "$CONTENTS/MacOS/Mydex"
xcrun swiftc -swift-version 5 -O -target "$ARCH-apple-macos13.0" "$ROOT/desktop/macos/DesktopAccess.swift" -o "$ENGINE/desktop/macos/MydexDesktopAccess"
IDENTITY="${MYDEX_SIGN_IDENTITY:--}"
# Ad-hoc builds are test artifacts, not notarized public distributions.
codesign --force --sign "$IDENTITY" "$ENGINE/runtime/node"
codesign --force --sign "$IDENTITY" "$ENGINE/desktop/macos/MydexDesktopAccess"
codesign --force --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
plutil -lint "$CONTENTS/Info.plist"
ln -s /Applications "$OUT/Applications" 2>/dev/null || true
STAGE="$OUT/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/Mydex.app"
ln -s /Applications "$STAGE/Applications" 2>/dev/null || true
hdiutil create -volname Mydex -srcfolder "$STAGE" -ov -format UDZO "$ROOT/dist/Mydex-$VERSION-macOS-$ARCH.dmg"
echo "Built $ROOT/dist/Mydex-$VERSION-macOS-$ARCH.dmg"
