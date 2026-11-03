package com.kurodaki.astudio;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a new A Studio APK from the project's GitHub releases and hands it
 * to the Android package installer. Android always asks the user to confirm.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private static final String ALLOWED_PREFIX = "https://github.com/kurodaki-dev/A-studio/releases/download/";

    // Screen orientation: "landscape" (default) or "auto" (portrait allowed).
    @PluginMethod
    public void setOrientation(PluginCall call) {
        String mode = call.getString("mode", "landscape");
        int o = "auto".equals(mode) ? ActivityInfo.SCREEN_ORIENTATION_FULL_USER : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(o));
        call.resolve();
    }

    // A Voice Studio, the vocal extension (a separate APK without a launcher icon).
    private static final String VOICE_PACKAGE = "com.kurodaki.avoicestudio";

    @PluginMethod
    public void extensionInstalled(PluginCall call) {
        JSObject ret = new JSObject();
        boolean installed;
        long build = 0;
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager().getPackageInfo(VOICE_PACKAGE, 0);
            installed = true;
            build = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (android.content.pm.PackageManager.NameNotFoundException e) {
            installed = false;
        }
        ret.put("installed", installed);
        // Build number of the installed extension, to offer its updates.
        ret.put("build", build);
        call.resolve(ret);
    }

    @PluginMethod
    public void openExtension(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("avoicestudio://open"));
            intent.setPackage(VOICE_PACKAGE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("A Voice Studio is not installed");
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        boolean allowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
        ret.put("allowed", allowed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || !url.endsWith(".apk")) {
            call.reject("URL not allowed");
            return;
        }
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                Context ctx = getContext();
                File dir = new File(ctx.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create cache folder");
                File apk = new File(dir, "A-Studio.apk");
                URL current = new URL(url);
                // GitHub redirects to its file storage: follow up to 5 HTTPS redirects.
                for (int i = 0; i < 5; i++) {
                    conn = (HttpURLConnection) current.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(30000);
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String loc = conn.getHeaderField("Location");
                        conn.disconnect();
                        conn = null;
                        if (loc == null) throw new Exception("Redirect without location");
                        current = new URL(current, loc);
                        if (!"https".equals(current.getProtocol())) throw new Exception("Insecure redirect");
                        continue;
                    }
                    if (code != 200) throw new Exception("HTTP " + code);
                    break;
                }
                if (conn == null) throw new Exception("Too many redirects");
                long total = conn.getContentLengthLong();
                long received = 0;
                long lastSent = 0;
                try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        out.write(buf, 0, n);
                        received += n;
                        if (received - lastSent > 262144 || received == total) {
                            lastSent = received;
                            JSObject p = new JSObject();
                            p.put("received", received);
                            p.put("total", total);
                            notifyListeners("progress", p);
                        }
                    }
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(install);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Download failed" : e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }
}
