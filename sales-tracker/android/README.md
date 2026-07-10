# SalesPal — Android app (direct-download APK)

The Android app is a **TWA (Trusted Web Activity)**: a thin native wrapper around
the live PWA at https://salespal.online/app/. There is no separate app codebase —
every web deploy updates the app automatically. Offline + sync are handled by the
PWA itself (service worker + local write queue), so the APK is offline-capable too.

The toolchain is already set up on this Mac (2026-07-10): Homebrew OpenJDK 17 +
Android SDK in `~/.bubblewrap/android_sdk` (paths wired in `~/.bubblewrap/config.json`).
The signing key is `android.keystore` here, alias `android`, password in
`keystore.pass` (both git-ignored) — **back both up**; the same key must sign
every future update.

## Rebuild the APK

```bash
cd sales-tracker/android
# twa-manifest.json is the source of truth (bump appVersionCode/appVersion per release).
npx @bubblewrap/cli update --skipVersionUpgrade   # regen project after manifest edits
BUBBLEWRAP_KEYSTORE_PASSWORD=$(cat keystore.pass) \
BUBBLEWRAP_KEY_PASSWORD=$(cat keystore.pass) \
npx @bubblewrap/cli build --skipPwaValidation
```

Outputs `app-release-signed.apk` (+ an `.aab` for Play, unused for now). The
key's SHA-256 fingerprint: `keytool -list -v -keystore android.keystore` (keytool
lives in `/opt/homebrew/opt/openjdk@17/bin`).

## Publish it (two steps)

1. **Serve the download.** Copy the APK so the backend can serve it:
   ```bash
   mkdir -p ../backend/downloads
   cp app-release-signed.apk ../backend/downloads/salespal.apk
   ```
   The landing page's "📲 Download for Android" button (→ `/download/android`) now
   serves it. The `.apk` is a build artifact and is git-ignored.

2. **Verify the domain** so Chrome hides the address bar (makes it look native).
   Set the fingerprint Bubblewrap printed as an env var on the server (Railway →
   Variables), then redeploy:
   ```
   ANDROID_CERT_SHA256 = AA:BB:CC:...:FF     # exactly as printed (colon-separated hex)
   ANDROID_PACKAGE     = online.salespal.twa # only if you chose a different app id
   ```
   The backend serves `/.well-known/assetlinks.json` from these. Confirm with:
   `curl https://salespal.online/.well-known/assetlinks.json`

## Rebuild after a Play/asset change

`bubblewrap build` again (reuses the same keystore), re-copy the APK. No need to
touch `assetlinks.json` unless the signing key changes.

## Notes

- Losing `android.keystore` means you can't ship signed updates to existing
  installs — back it up somewhere safe (not in git).
- The APK carries no business logic; it points at the hosted site. A bad web
  deploy affects the app the same as the website. Roll back the web deploy to fix.
