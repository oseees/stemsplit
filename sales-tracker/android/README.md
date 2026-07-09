# SalesPal — Android app (direct-download APK)

The Android app is a **TWA (Trusted Web Activity)**: a thin native wrapper around
the live PWA at https://salespal.online/app/. There is no separate app codebase —
every web deploy updates the app automatically. Offline + sync are handled by the
PWA itself (service worker + local write queue), so the APK is offline-capable too.

The signed APK must be built on a machine with a JDK (this repo's CI/sandbox has
none). It's a one-time ~10-minute setup; rebuilds are one command.

## Build the APK

```bash
npm install -g @bubblewrap/cli          # one-time
cd sales-tracker/android
# First run downloads a JDK + Android SDK into ~/.bubblewrap if you don't have them.
bubblewrap init --manifest https://salespal.online/app/manifest.webmanifest
#   → Application ID:  online.salespal.twa   (must match ANDROID_PACKAGE below)
#   → Host:            salespal.online
#   → accept the icon/colour defaults pulled from the manifest
#   → it creates & password-protects a signing key (android.keystore) — KEEP IT SAFE,
#     you need the same key to ship updates.
bubblewrap build
```

`bubblewrap build` prints the key's **SHA-256 fingerprint** and outputs
`app-release-signed.apk`.

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
