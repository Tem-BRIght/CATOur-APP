package io.catour.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "PermissionsSettings",
    permissions = {
        @Permission(
            alias = "camera",
            strings = { Manifest.permission.CAMERA }
        ),
        @Permission(
            alias = "location",
            strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }
        ),
        @Permission(
            alias = "microphone",
            strings = { Manifest.permission.RECORD_AUDIO }
        ),
        @Permission(
            alias = "notifications",
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public class PermissionsSettingsPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String type = call.getString("type", "app");
        Intent intent;

        if ("notifications".equals(type) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            Uri uri = Uri.fromParts("package", getContext().getPackageName(), null);
            intent.setData(uri);
        }
        
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("location", isGranted(Manifest.permission.ACCESS_FINE_LOCATION));
        ret.put("camera", isGranted(Manifest.permission.CAMERA));
        ret.put("microphone", isGranted(Manifest.permission.RECORD_AUDIO));
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ret.put("notifications", isGranted(Manifest.permission.POST_NOTIFICATIONS));
        } else {
            // Notifications are handled differently on older Android versions
            ret.put("notifications", true); 
        }
        
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("Alias is required (camera, location, microphone, or notifications)");
            return;
        }

        // Special handling for notifications on older versions
        if (alias.equals("notifications") && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            open(call);
            return;
        }

        requestPermissionForAlias(alias, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        getStatus(call);
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
