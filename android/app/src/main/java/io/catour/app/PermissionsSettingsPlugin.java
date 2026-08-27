package io.catour.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PermissionsSettings")
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
            ret.put("photos", isGranted(Manifest.permission.READ_MEDIA_IMAGES));
        } else {
            ret.put("notifications", true);
            ret.put("photos", isGranted(Manifest.permission.READ_EXTERNAL_STORAGE));
        }

        // Special check for Android 14+ Partial Access
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ret.put("limitedPhotos", isGranted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED));
        }
        
        call.resolve(ret);
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
