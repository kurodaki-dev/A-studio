package com.kurodaki.avoicestudio;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Link between A Voice Studio and A Studio: tells whether A Studio is installed and
 * opens it (the switch at the top of the screen).
 */
@CapacitorPlugin(name = "ExtensionBridge")
public class ExtensionBridgePlugin extends Plugin {

    private static final String STUDIO = "com.kurodaki.astudio";

    @PluginMethod
    public void isInstalled(PluginCall call) {
        String pkg = call.getString("package", STUDIO);
        JSObject ret = new JSObject();
        boolean installed;
        try {
            getContext().getPackageManager().getPackageInfo(pkg, 0);
            installed = true;
        } catch (PackageManager.NameNotFoundException e) {
            installed = false;
        }
        ret.put("installed", installed);
        call.resolve(ret);
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String pkg = call.getString("package", STUDIO);
        String uri = call.getString("uri", "astudio://open");
        if (!STUDIO.equals(pkg)) {
            call.reject("Only A Studio can be opened");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            intent.setPackage(pkg);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("A Studio is not installed");
        }
    }
}
