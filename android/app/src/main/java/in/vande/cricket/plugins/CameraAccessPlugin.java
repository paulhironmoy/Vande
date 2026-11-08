package in.vande.cricket.plugins;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Permission helper for the optional Camera batting mode (src/input/camera). It answers three questions for the page and does nothing
 * else: what is the camera permission state (getStatus), ask the system now (request), open this app's page in system Settings
 * (openSettings).
 *
 * It never opens the camera, never sees a frame and writes nothing. The picture stays inside the WebView (getUserMedia), which
 * Capacitor's own WebChromeClient connects to the same system permission. This helper exists because that path cannot tell the page
 * that the system will not ask again, and a web page cannot open the app's Settings page.
 */
@CapacitorPlugin(
    name = "VandeCameraAccess",
    permissions = { @Permission(alias = CameraAccessPlugin.ALIAS, strings = { Manifest.permission.CAMERA }) }
)
public class CameraAccessPlugin extends Plugin {
    static final String ALIAS = "camera";

    /** No dialog. {camera: 'granted'|'prompt'|'prompt-with-rationale'|'denied', hasFrontCamera, hasAnyCamera}. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    /** Shows the system dialog when the system will show one; resolves with the status once the player has answered. */
    @PluginMethod
    public void request(PluginCall call) {
        if (CameraAccessState.needsSystemRequest(state())) {
            requestPermissionForAlias(ALIAS, call, "afterRequest");
        } else {
            call.resolve(status());
        }
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        call.resolve(status());
    }

    /** Opens this app's page in system Settings, where the player can allow the camera. {opened: boolean}. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null)
        );
        boolean opened;
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            opened = true;
        } catch (ActivityNotFoundException | SecurityException e) {
            opened = false;
        }
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    private String state() {
        PermissionState state = getPermissionState(ALIAS);
        return CameraAccessState.normalize(state == null ? null : state.toString());
    }

    private JSObject status() {
        PackageManager packages = getContext().getPackageManager();
        boolean front = packages.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT);
        boolean any = packages.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY);
        boolean back = packages.hasSystemFeature(PackageManager.FEATURE_CAMERA);
        JSObject result = new JSObject();
        result.put("camera", state());
        result.put("hasFrontCamera", front);
        result.put("hasAnyCamera", CameraAccessState.hasAnyCamera(any, front, back));
        return result;
    }
}
