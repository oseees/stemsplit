package online.salespal.twa;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.DownloadListener;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;

/**
 * SalesPal Android app — a plain native WebView wrapper around https://salespal.online/app/.
 *
 * Unlike the old TWA (which renders inside Chrome and delegates the microphone permission
 * to Chrome — the source of the "grant mic" loop), this app hosts its OWN WebView and grants
 * the mic directly in {@link #onPermissionRequest} after holding the Android RECORD_AUDIO
 * runtime permission. That makes getUserMedia (voice sale entry) work reliably.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "https://salespal.online/app/";
    private static final String APP_HOST = "salespal.online";
    private static final int REQ_MIC = 1001;
    private static final int REQ_FILE = 1002;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingMic;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternally(request.getUrl());
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { grantMic(request); }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            // A WebView shows NO alert()/confirm()/prompt() unless the host handles
            // them. Without these, confirm() returns false and prompt() returns null,
            // so delete confirmations, payment toggles, the phone prompt, etc. all
            // silently no-op. Render real Android dialogs instead.
            @Override
            public boolean onJsAlert(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setNegativeButton("Cancel", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView v, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                final EditText input = new EditText(MainActivity.this);
                if (defaultValue != null) input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setView(input)
                        .setPositiveButton("OK", (d, w) -> result.confirm(input.getText().toString()))
                        .setNegativeButton("Cancel", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                downloadFile(url, contentDisposition, mimetype);
            }
        });

        // Bridge so the web app can share a generated invoice PDF/image through the
        // real Android share sheet (the WebView has no navigator.share).
        web.addJavascriptInterface(new ShareBridge(), "SalesPalShare");

        // Ask for the mic up front so the very first "Speak it" tap just records.
        ensureMicPermission();

        web.loadUrl(START_URL);
    }

    // --- microphone: the app grants the WebView audio capture itself ---

    private void grantMic(PermissionRequest request) {
        boolean wantsAudio = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsAudio = true;
        }
        if (!wantsAudio) { request.deny(); return; }
        if (hasMic()) {
            request.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
        } else {
            pendingMic = request;   // grant once the runtime permission comes back
            requestMic();
        }
    }

    private boolean hasMic() {
        return Build.VERSION.SDK_INT < 23
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void ensureMicPermission() {
        if (!hasMic()) requestMic();
    }

    private void requestMic() {
        if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(new String[]{ Manifest.permission.RECORD_AUDIO }, REQ_MIC);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == REQ_MIC && pendingMic != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
                pendingMic.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            } else {
                pendingMic.deny();
                Toast.makeText(this, "Microphone permission is needed for voice entry",
                        Toast.LENGTH_LONG).show();
            }
            pendingMic = null;
        }
    }

    // --- file input (photo uploads) ---

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE) return;
        if (fileCallback == null) return;
        Uri[] results = null;
        if (resultCode == Activity.RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                results = new Uri[n];
                for (int i = 0; i < n; i++) results[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                results = new Uri[]{ data.getData() };
            }
        }
        fileCallback.onReceiveValue(results);
        fileCallback = null;
    }

    // --- downloads (invoice PDFs served as direct links, DB backup) ---

    private void downloadFile(String url, String contentDisposition, String mime) {
        try {
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                Toast.makeText(this, "Use the Share button to save this", Toast.LENGTH_SHORT).show();
                return;
            }
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            String name = URLUtil.guessFileName(url, contentDisposition, mime);
            req.setMimeType(mime);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(req);
            Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Download failed", Toast.LENGTH_SHORT).show();
        }
    }

    // --- external links (WhatsApp share, mailto, tel) open in their own apps ---

    private boolean openExternally(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        boolean external = host.equals("wa.me") || host.endsWith("whatsapp.com")
                || scheme.equals("whatsapp") || scheme.equals("mailto")
                || scheme.equals("tel") || scheme.equals("sms");
        if (host.equals(APP_HOST)) return false;                 // the app itself: stay in the WebView
        if (scheme.equals("http") || scheme.equals("https")) {
            if (!external) return false;                          // Paystack checkout etc.: stay in the WebView
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // JS bridge: window.SalesPalShare.shareFile(base64, mime, filename, text) writes
    // the bytes to a cache file and opens the system share sheet via FileProvider.
    // Only our own trusted origin (+ Paystack) can reach this — navigation is locked
    // to those in shouldOverrideUrlLoading.
    private class ShareBridge {
        @JavascriptInterface
        public void shareFile(String base64, String mime, String filename, String text) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = new File(getCacheDir(), "shares");
                dir.mkdirs();
                String safe = (filename == null ? "invoice" : filename).replaceAll("[^A-Za-z0-9._-]", "_");
                File f = new File(dir, safe);
                FileOutputStream fos = new FileOutputStream(f);
                fos.write(bytes);
                fos.close();
                Uri uri = FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", f);
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime == null || mime.isEmpty() ? "*/*" : mime);
                send.putExtra(Intent.EXTRA_STREAM, uri);
                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(send, "Share invoice")));
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this, "Couldn't share — try again", Toast.LENGTH_SHORT).show());
            }
        }
    }
}
