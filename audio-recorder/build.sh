#!/bin/bash
# Builds "Mac Audio Recorder.app" next to this script.
set -e
cd "$(dirname "$0")"
APP="Mac Audio Recorder.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O rec.swift -o "$APP/Contents/MacOS/recorder"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Mac Audio Recorder</string>
  <key>CFBundleExecutable</key><string>recorder</string>
  <key>CFBundleIdentifier</key><string>local.mac-audio-recorder</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
PLIST
# Stable identity, NOT ad-hoc: TCC keys the Screen Recording grant to the signing
# certificate, so signing every build with the same local cert keeps the grant across
# rebuilds. The cert lives in its own throwaway keychain (rec-signing, password below is
# not a secret — it guards a self-signed local cert only).
security unlock-keychain -p rec-local rec-signing.keychain
codesign --force --sign "Mac Audio Recorder Signing" --keychain rec-signing.keychain "$APP"
echo "built: $PWD/$APP"
