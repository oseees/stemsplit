# SalesPal — Android app (native WebView build)

This **replaces** the old TWA in `../android/`. It's a plain native `WebView`
wrapper around https://salespal.online/app/ — **not** a Trusted Web Activity /
Chrome Custom Tab.

## Why this exists

The TWA renders inside Chrome and delegates the microphone permission to Chrome.
On the owner's device that permission chain stayed blocked no matter what (Chrome
app perm, site perm, and the app's `RECORD_AUDIO` were all granted) — voice sale
entry kept failing with `not-allowed` and no prompt. A WebView app hosts its own
web engine and **grants the mic itself** in `MainActivity.onPermissionRequest`
(after a normal runtime `RECORD_AUDIO` request), which is the reliable pattern for
`getUserMedia` in a wrapped web app.

Same `applicationId` (`online.salespal.twa`) and same signing key as the TWA, with
a higher `versionCode` (3), so it **updates in place** over an installed TWA — no
uninstall. Digital Asset Links / `assetlinks.json` are irrelevant to a WebView app
and can stay as-is.

## What the native layer handles

- **Microphone** — runtime `RECORD_AUDIO` + `onPermissionRequest` grant (the point).
- **Photo uploads** — `onShowFileChooser` → system file picker → `onActivityResult`.
- **Downloads** (invoice PDF direct links, DB backup) — `DownloadListener` →
  `DownloadManager`, forwarding the session cookie.
- **External links** — `wa.me`/WhatsApp/`mailto:`/`tel:` open in their own apps;
  everything else (incl. Paystack checkout) stays in the WebView so the pay-return
  redirect lands back in the app.
- **Back button** → WebView history.

No third-party dependencies — pure framework `android.webkit.WebView` + `Activity`.

## Build

```bash
cd sales-tracker/android-webview
# bump versionCode/versionName in app/build.gradle per release
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
SALESPAL_KEYSTORE_PASSWORD=$(cat ../android/keystore.pass) \
SALESPAL_KEY_PASSWORD=$(cat ../android/keystore.pass) \
./gradlew :app:assembleRelease --no-daemon
```

Outputs `app/build/outputs/apk/release/app-release.apk`, signed with
`../android/android.keystore` (alias `android`). `local.properties` points Gradle
at the SDK (`~/.bubblewrap/android_sdk`); it's git-ignored.

## Publish

```bash
cp app/build/outputs/apk/release/app-release.apk ../backend/downloads/salespal.apk
cd .. && railway up          # backend serves it at /download/android
```

The signing cert is unchanged from the TWA
(`20:1B:F8:23:92:A8:11:F5:6C:15:00:F1:7F:6F:15:92:8B:06:D9:F3:84:BB:08:9E:43:91:57:72:1D:CA:FD:DB`),
so existing installs update without a reinstall. **Back up
`../android/android.keystore` + `keystore.pass`** — same key required for all future updates.
