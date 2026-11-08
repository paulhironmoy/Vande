package in.vande.cricket.plugins;

import android.app.Activity;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import in.vande.cricket.unity.UnityPracticeHost;
import org.json.JSONObject;

/**
 * Narrow, optional Capacitor boundary for the full-screen Unity Practice surface.
 *
 * <p>The plugin is present in every build so the web layer can fail closed when no verified export exists. Calls are
 * generation-scoped by operationId; attachment is not readiness, and no event is retained beyond active listeners.
 */
@CapacitorPlugin(name = "VandeUnityPractice")
public final class UnityPracticePlugin extends Plugin implements UnityPracticeHost.Callback {
    private static final String LOG_TAG = "VandeUnityPractice";
    private static final int MAX_LOG_FIELD = 160;
    private PluginCall pendingLaunch;
    private String pendingLaunchOperationId;
    private PluginCall pendingUnload;
    private String pendingUnloadOperationId;
    private boolean destroyed;

    @PluginMethod
    public void availability(PluginCall call) {
        JSObject result = new JSObject();
        Activity activity = getActivity();
        UnityPracticeHost.Availability availability = UnityPracticeHost.availability(activity);
        result.put("available", availability.isAvailable());
        result.put("reason", availability.reason());
        result.put("unityVersion", availability.isAvailable() ? UnityPracticeHost.version() : JSONObject.NULL);
        Float pixelsPerDp = availability.isAvailable() ? UnityPracticeHost.logicalPixelsPerDp(activity) : null;
        Float systemTextScale = availability.isAvailable() ? UnityPracticeHost.systemTextScale(activity) : null;
        result.put("pixelsPerDp", pixelsPerDp != null ? pixelsPerDp : JSONObject.NULL);
        result.put("systemTextScale", systemTextScale != null ? systemTextScale : JSONObject.NULL);
        call.resolve(result);
    }

    @PluginMethod
    public void launch(PluginCall call) {
        launchWithActivity(call, getActivity());
    }

    /** Package-private seam keeps the Activity-before-reservation invariant executable in instrumentation tests. */
    void launchWithActivity(PluginCall call, Activity activity) {
        String packet = call.getString("packet");
        String operationId = call.getString("operationId");
        if (packet == null || !UnityPracticeHost.validOperationId(operationId)) {
            call.reject("packet and a bounded operationId are required", "invalid_message");
            return;
        }
        // Do not reserve a promise that the host can never complete. Capacitor may briefly expose a null Activity
        // during teardown/recreation; a launch in that window must fail synchronously and remain retryable.
        if (activity == null || activity.isFinishing() || activity.isDestroyed()) {
            call.reject("The Android host is not available for Unity Practice launch", "lifecycle");
            return;
        }
        synchronized (this) {
            if (destroyed) {
                call.reject("The Android host is being destroyed", "lifecycle");
                return;
            }
            if (pendingLaunch != null || pendingUnload != null || UnityPracticeHost.attached()) {
                call.reject("Unity Practice already has an active or pending operation", "lifecycle");
                return;
            }
            pendingLaunch = call;
            pendingLaunchOperationId = operationId;
        }
        UnityPracticeHost.attach(activity, operationId, packet, this);
    }

    @PluginMethod
    public void cancelLaunch(PluginCall call) {
        String operationId = call.getString("operationId");
        if (!UnityPracticeHost.validOperationId(operationId)) {
            call.reject("A bounded operationId is required", "invalid_message");
            return;
        }
        boolean cancelled = UnityPracticeHost.cancelLaunch(operationId);
        PluginCall launchToReject = null;
        synchronized (this) {
            // A matching plugin reservation must be released even when the host never installed its operation (for
            // example, an Activity disappeared at the launch boundary). Native cancellation truth remains in the
            // returned boolean, but stale Java state may not poison every later launch in this plugin instance.
            if (operationId.equals(pendingLaunchOperationId)) {
                launchToReject = pendingLaunch;
                pendingLaunch = null;
                pendingLaunchOperationId = null;
            }
        }
        if (launchToReject != null) launchToReject.reject("Unity Practice launch was cancelled", "launch_cancelled");
        JSObject result = new JSObject();
        result.put("cancelled", cancelled);
        call.resolve(result);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String packet = call.getString("packet");
        String operationId = call.getString("operationId");
        if (packet == null || !UnityPracticeHost.validOperationId(operationId)) {
            call.reject("packet and a bounded operationId are required", "invalid_message");
            return;
        }
        JSObject result = new JSObject();
        result.put("accepted", UnityPracticeHost.send(operationId, packet));
        call.resolve(result);
    }

    /** Shows Unity only for presentation moments; setup and dead-ball React UI remain reachable during parity work. */
    @PluginMethod
    public void setVisible(PluginCall call) {
        String operationId = call.getString("operationId");
        Boolean visible = call.getBoolean("visible");
        if (!UnityPracticeHost.validOperationId(operationId) || visible == null) {
            call.reject("a bounded operationId and visible are required", "invalid_message");
            return;
        }
        UnityPracticeHost.setVisible(operationId, visible, applied -> {
            boolean hostDestroyed;
            synchronized (this) {
                hostDestroyed = destroyed;
            }
            if (hostDestroyed) {
                call.reject("The Android host was destroyed before visibility could be applied", "lifecycle");
                return;
            }
            JSObject result = new JSObject();
            result.put("applied", applied);
            call.resolve(result);
        });
    }

    /** Reveals the ready scene with the host-localized one-gesture cue above the Unity view. */
    @PluginMethod
    public void setReadyVisible(PluginCall call) {
        String operationId = call.getString("operationId");
        Boolean visible = call.getBoolean("visible");
        String hint = call.getString("hint");
        if (!UnityPracticeHost.validOperationId(operationId) || visible == null ||
            hint == null || hint.isEmpty() || hint.length() > 240 || hasControlCharacter(hint)) {
            call.reject("a bounded operationId, visible and safe localized hint are required", "invalid_message");
            return;
        }
        UnityPracticeHost.setReadyVisible(operationId, visible, hint, applied -> {
            boolean hostDestroyed;
            synchronized (this) {
                hostDestroyed = destroyed;
            }
            if (hostDestroyed) {
                call.reject("The Android host was destroyed before ready visibility could be applied", "lifecycle");
                return;
            }
            JSObject result = new JSObject();
            result.put("applied", applied);
            call.resolve(result);
        });
    }

    private static boolean hasControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (Character.isISOControl(current) && current != '\n') return true;
        }
        return false;
    }

    @PluginMethod
    public void unload(PluginCall call) {
        String operationId = call.getString("operationId");
        if (!UnityPracticeHost.validOperationId(operationId)) {
            call.reject("A bounded operationId is required", "invalid_message");
            return;
        }
        synchronized (this) {
            if (destroyed) {
                call.reject("The Android host is being destroyed", "lifecycle");
                return;
            }
            if (pendingUnload != null) {
                call.reject("Unity Practice unload is already pending", "lifecycle");
                return;
            }
            // launchWithActivity reserves the promise before UnityPracticeHost.attach can reserve the native
            // generation. An unload racing through that deliberate gap must not observe host IDLE and falsely
            // report success while the launch proceeds immediately afterwards.
            if (pendingLaunch != null) {
                call.reject("Unity Practice launch is still pending", "lifecycle");
                return;
            }
            if (!UnityPracticeHost.attached()) {
                JSObject result = new JSObject();
                result.put("unloaded", true);
                call.resolve(result);
                return;
            }
            if (!UnityPracticeHost.ownsOperation(operationId)) {
                call.reject("operationId does not own the active Unity runtime", "lifecycle");
                return;
            }
            pendingUnload = call;
            pendingUnloadOperationId = operationId;
        }
        if (!UnityPracticeHost.unload(operationId)) {
            synchronized (this) {
                if (call == pendingUnload) {
                    pendingUnload = null;
                    pendingUnloadOperationId = null;
                }
            }
            call.reject("Unity Practice could not begin unload", "lifecycle");
        }
    }

    @Override
    public void onReady(String operationId, String packet) {
        PluginCall launch;
        synchronized (this) {
            if (destroyed || !operationId.equals(pendingLaunchOperationId)) return;
            launch = pendingLaunch;
            pendingLaunch = null;
            pendingLaunchOperationId = null;
        }
        emitPacket(operationId, packet);
        if (launch != null) {
            JSObject result = new JSObject();
            result.put("accepted", true);
            launch.resolve(result);
        }
    }

    @Override
    public void onMessage(String operationId, String packet) {
        synchronized (this) {
            if (destroyed) return;
        }
        emitPacket(operationId, packet);
    }

    private void emitPacket(String operationId, String packet) {
        JSObject event = new JSObject();
        event.put("operationId", operationId);
        event.put("packet", packet);
        // Retained events were an unbounded memory/replay hazard; listeners must be installed before launch.
        notifyListeners("message", event, false);
    }

    @Override
    public void onUnloaded(String operationId) {
        PluginCall launchToReject = null;
        PluginCall unloadToResolve = null;
        synchronized (this) {
            if (operationId.equals(pendingLaunchOperationId)) {
                launchToReject = pendingLaunch;
                pendingLaunch = null;
                pendingLaunchOperationId = null;
            }
            if (operationId.equals(pendingUnloadOperationId)) {
                unloadToResolve = pendingUnload;
                pendingUnload = null;
                pendingUnloadOperationId = null;
            }
        }
        if (launchToReject != null) launchToReject.reject("Unity unloaded before becoming ready", "lifecycle");
        if (unloadToResolve != null) {
            JSObject result = new JSObject();
            result.put("unloaded", true);
            unloadToResolve.resolve(result);
        }
    }

    @Override
    public void onError(String operationId, String code, String detail) {
        Log.e(
                LOG_TAG,
                "callback error operationId=" + boundedForLog(operationId)
                        + " code=" + boundedForLog(code)
                        + " detail=" + boundedForLog(detail));
        PluginCall launchToReject = null;
        PluginCall unloadToReject = null;
        boolean shouldNotify;
        synchronized (this) {
            shouldNotify = !destroyed;
            if (operationId != null && operationId.equals(pendingLaunchOperationId)) {
                launchToReject = pendingLaunch;
                pendingLaunch = null;
                pendingLaunchOperationId = null;
            }
            if (operationId != null && operationId.equals(pendingUnloadOperationId)) {
                unloadToReject = pendingUnload;
                pendingUnload = null;
                pendingUnloadOperationId = null;
            }
        }
        if (launchToReject != null) launchToReject.reject(detail, code);
        if (unloadToReject != null) unloadToReject.reject(detail, code);
        if (!shouldNotify) return;
        JSObject event = new JSObject();
        event.put("operationId", operationId == null ? JSONObject.NULL : operationId);
        event.put("code", code);
        event.put("detail", detail);
        notifyListeners("error", event, false);
    }

    private static String boundedForLog(String value) {
        if (value == null) return "null";
        String sanitized = value.replace('\r', ' ').replace('\n', ' ');
        return sanitized.length() <= MAX_LOG_FIELD ? sanitized : sanitized.substring(0, MAX_LOG_FIELD);
    }

    @Override
    protected void handleOnDestroy() {
        PluginCall launch;
        PluginCall unload;
        synchronized (this) {
            destroyed = true;
            launch = pendingLaunch;
            unload = pendingUnload;
            pendingLaunch = null;
            pendingLaunchOperationId = null;
            pendingUnload = null;
            pendingUnloadOperationId = null;
        }
        if (launch != null) launch.reject("The Android host was destroyed during Unity launch", "lifecycle");
        if (unload != null) unload.reject("The Android host was destroyed during Unity unload", "lifecycle");
        UnityPracticeHost.releaseCallback(this);
        super.handleOnDestroy();
    }
}
