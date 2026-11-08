package in.vande.cricket.unity;

import android.app.Activity;
import android.content.ComponentCallbacks2;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import in.vande.cricket.BuildConfig;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayDeque;
import java.util.HashSet;
import java.util.Set;

/**
 * Reflection-only Unity-as-a-Library host.
 *
 * <p>Keeping Unity symbols out of the normal compile path preserves the default Capacitor build when no export is
 * present. TypeScript remains authoritative; this class owns only the Android view/lifecycle boundary and refuses to
 * forward an unchecked packet. It deliberately never calls UnityPlayer.quit(), which would terminate the shared app.
 */
public final class UnityPracticeHost {
    private static final String LOG_TAG = "UnityPracticeHost";
    private static final int MAX_LOG_OPERATION_ID = 128;
    /** One native decision shared by availability reporting and the launch boundary. */
    public enum Availability {
        LINKED_UNVERIFIED(true, "linked_unverified", "The optional Unity runtime passed native preflight."),
        UNITY_EXPORT_MISSING(false, "unity_export_missing", "The optional verified unityLibrary module is not linked."),
        PROCESS_32_BIT(false, "unsupported_native_abi", "This 32-bit app process cannot load the ARM64 Unity runtime; use the retained renderer."),
        UNSUPPORTED_NATIVE_ABI(false, "unsupported_native_abi", "This device ABI cannot load the ARM64 Unity runtime; use the retained renderer."),
        ABI_STATUS_UNAVAILABLE(false, "unsupported_native_abi", "Android ABI status is unavailable; use the retained renderer."),
        UNSUPPORTED_GRAPHICS_API(false, "unsupported_graphics_api", "OpenGL ES 3 is unavailable; use the retained renderer."),
        GRAPHICS_STATUS_UNAVAILABLE(false, "unsupported_graphics_api", "Android graphics capability is unavailable; use the retained renderer."),
        LOW_RAM_DEVICE(false, "low_memory_device", "Android classifies this as a low-RAM device; use the retained renderer."),
        LOW_MEMORY(false, "low_memory_device", "Android currently reports low system memory; use the retained renderer."),
        TOTAL_MEMORY_AT_OR_BELOW_FLOOR(false, "low_memory_device", "This device has 3 GB RAM or less; use the retained renderer."),
        MEMORY_STATUS_UNAVAILABLE(false, "low_memory_device", "Android memory status is unavailable; use the retained renderer."),
        DISPLAY_METRICS_UNAVAILABLE(false, "error", "Android display or text-scale metrics are unavailable; use the retained renderer."),
        ERROR(false, "error", "A prior Unity runtime did not confirm unload; restart the app before retrying.");

        private final boolean available;
        private final String reason;
        private final String detail;

        Availability(boolean available, String reason, String detail) {
            this.available = available;
            this.reason = reason;
            this.detail = detail;
        }

        public boolean isAvailable() {
            return available;
        }

        public String reason() {
            return reason;
        }

        String detail() {
            return detail;
        }
    }

    public interface Callback {
        /** Called only after C# has validated host.initialize and emitted a checksummed unity.ready packet. */
        void onReady(String operationId, String packet);

        void onMessage(String operationId, String packet);

        void onUnloaded(String operationId);

        void onError(String operationId, String code, String detail);
    }

    /** Completion is delivered on Android's main thread after the requested visibility state is applied or refused. */
    public interface VisibilityCallback {
        void onApplied(boolean applied);
    }

    private enum State {
        IDLE,
        LOADING,
        INITIALIZING,
        READY,
        UNLOADING,
        /** The runtime did not confirm unload. Keep its reference and refuse a second player for process safety. */
        BLOCKED
    }

    private enum PacketDecision {
        ACCEPT,
        DUPLICATE,
        OUT_OF_ORDER
    }

    private static final class MessageWindow {
        private static final int MAX_SEEN = 2_048;
        private final Set<String> seen = new HashSet<>();
        private final ArrayDeque<String> order = new ArrayDeque<>();
        private long lastSequence = -1;

        PacketDecision accept(UnityPracticePacketValidator.ValidatedPacket packet) {
            if (seen.contains(packet.messageId)) return PacketDecision.DUPLICATE;
            if (packet.sequence <= lastSequence) return PacketDecision.OUT_OF_ORDER;
            seen.add(packet.messageId);
            order.addLast(packet.messageId);
            lastSequence = packet.sequence;
            while (order.size() > MAX_SEEN) seen.remove(order.removeFirst());
            return PacketDecision.ACCEPT;
        }
    }

    private static final String PLAYER_CLASS = "com.unity3d.player.UnityPlayerForActivityOrService";
    private static final String LIFECYCLE_EVENTS_CLASS = "com.unity3d.player.IUnityPlayerLifecycleEvents";
    private static final String MEMORY_USAGE_CLASS = PLAYER_CLASS + "$MemoryUsage";
    private static final String BRIDGE_OBJECT = "VandeBridge";
    private static final String RECEIVE_METHOD = "ReceivePacket";
    private static final String PREPARE_UNLOAD_METHOD = "PrepareForUnload";
    private static final String NATIVE_BACK_PAUSE_METHOD = "RequestDeadBallPauseFromNativeBack";
    // This is a fail-safe cap, not a startup target. It starts when the operation is reserved, before main-thread
    // construction, and leaves bounded room for an evidence cohort whose one cold ARM64 IL2CPP observation was
    // 12.8 s. The independent bridge/coordinator caps are 35/40 s; measured production UX must remain much faster.
    private static final long LAUNCH_TIMEOUT_MS = 30_000;
    private static final long PREPARE_UNLOAD_GRACE_MS = 100;
    private static final long UNLOAD_TIMEOUT_MS = 6_000;
    /** Let the protocol pause reach Unity and emit its ACK before Android suspends the player. */
    private static final long LIFECYCLE_PAUSE_ACK_GRACE_MS = 2_000;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private static State state = State.IDLE;
    private static Activity activity;
    private static FrameLayout overlay;
    private static TextView readyHintView;
    private static Object player;
    private static Callback callback;
    private static String operationId;
    private static String pendingInitialPacket;
    private static String buildId;
    private static String sessionId;
    private static MessageWindow hostMessages;
    private static MessageWindow unityMessages;
    private static Runnable launchTimeout;
    private static long launchDeadlineElapsedRealtimeMs;
    private static Runnable unloadTimeout;
    private static boolean failureReported;
    private static boolean cancelRequested;
    /** True only after VandeBridge.Awake has bound the managed endpoint for this exact operation. */
    private static boolean runtimeEndpointLoaded;
    private static boolean activityStarted;
    private static boolean activityPaused;
    private static boolean playerStarted;
    private static boolean playerPaused;
    private static String pendingLifecyclePauseMessageId;
    private static Runnable lifecyclePauseTimeout;

    private static View coveredWebView;
    private static int coveredAccessibility;
    private static int coveredDescendantFocusability;
    private static boolean coveredHadFocus;

    private UnityPracticeHost() {}

    public static Availability availability(Activity host) {
        if (!BuildConfig.VANDE_UNITY_LINKED) return Availability.UNITY_EXPORT_MISSING;
        if (logicalPixelsPerDp(host) == null || systemTextScale(host) == null)
            return Availability.DISPLAY_METRICS_UNAVAILABLE;

        // The verified exporter is ARM64-only. Refuse every unsupported or unknown process before touching any Unity
        // class so Android never attempts to resolve a missing/incompatible native library for this optional path.
        UnityPracticeAbiGate.Decision abi = UnityPracticeAbiGate.inspect();
        switch (abi) {
            case PROCESS_32_BIT:
                return Availability.PROCESS_32_BIT;
            case UNSUPPORTED_ABI:
                return Availability.UNSUPPORTED_NATIVE_ABI;
            case SIGNAL_UNAVAILABLE:
                return Availability.ABI_STATUS_UNAVAILABLE;
            default:
                break;
        }

        // GLES 3 is required by this Unity export. Keep it out of the install manifest so unsupported devices can
        // still use VANDE, but never touch Unity classes or native libraries on those devices.
        UnityPracticeGraphicsGate.Decision graphics = UnityPracticeGraphicsGate.inspect(host);
        switch (graphics) {
            case UNSUPPORTED_GLES:
                return Availability.UNSUPPORTED_GRAPHICS_API;
            case SIGNAL_UNAVAILABLE:
                return Availability.GRAPHICS_STATUS_UNAVAILABLE;
            default:
                break;
        }

        // This check deliberately precedes Class.forName(PLAYER_CLASS): low-memory cohorts must never trigger Unity
        // class/native-library loading, let alone construct UnityPlayer.
        UnityPracticeMemoryGate.Decision memory = UnityPracticeMemoryGate.inspect(host);
        switch (memory) {
            case LOW_RAM_DEVICE:
                return Availability.LOW_RAM_DEVICE;
            case LOW_MEMORY:
                return Availability.LOW_MEMORY;
            case TOTAL_MEMORY_AT_OR_BELOW_FLOOR:
                return Availability.TOTAL_MEMORY_AT_OR_BELOW_FLOOR;
            case SIGNAL_UNAVAILABLE:
                return Availability.MEMORY_STATUS_UNAVAILABLE;
            default:
                break;
        }

        try {
            verifyPlayerApi();
            synchronized (UnityPracticeHost.class) {
                if (state == State.BLOCKED) return Availability.ERROR;
            }
        } catch (Throwable ignored) {
            return Availability.UNITY_EXPORT_MISSING;
        }

        return Availability.LINKED_UNVERIFIED;
    }

    /**
     * Android's logical pixels-per-dp value for this Activity. Unity's Screen.dpi is allowed to be unknown and is
     * not an accessibility density signal; DisplayMetrics.density is the platform value used by Android touch-target
     * guidance. Values below one are deliberately promoted to one, which only enlarges the resulting dp target.
     */
    public static Float logicalPixelsPerDp(Activity host) {
        if (host == null || host.getResources() == null || host.getResources().getDisplayMetrics() == null) return null;
        float density = host.getResources().getDisplayMetrics().density;
        if (!Float.isFinite(density) || density <= 0f || density > 8f) return null;
        return Math.max(1f, density);
    }

    /** Android's user-selected system font scale, kept separate from logical touch density. */
    public static Float systemTextScale(Activity host) {
        if (host == null || host.getResources() == null || host.getResources().getConfiguration() == null) return null;
        float scale = host.getResources().getConfiguration().fontScale;
        if (!Float.isFinite(scale) || scale < 0.5f || scale > 3f) return null;
        return scale;
    }

    public static synchronized boolean blocked() {
        return state == State.BLOCKED;
    }

    /** The version selected at build time; unity.ready must prove that the loaded runtime is exactly this patch. */
    public static String version() {
        return BuildConfig.VANDE_UNITY_LINKED ? BuildConfig.VANDE_UNITY_EDITOR_VERSION : "unavailable";
    }

    public static synchronized boolean attached() {
        return state != State.IDLE;
    }

    public static synchronized boolean ownsOperation(String candidate) {
        return candidate != null && candidate.equals(operationId) && state != State.IDLE;
    }

    public static boolean validOperationId(String candidate) {
        return UnityPracticePacketValidator.validOperationId(candidate);
    }

    public static void attach(Activity host, String requestedOperationId, String initialPacket, Callback events) {
        if (events == null) return;
        if (host == null) {
            events.onError(requestedOperationId, "lifecycle", "The Android host is unavailable for Unity Practice launch.");
            return;
        }
        if (!UnityPracticePacketValidator.validOperationId(requestedOperationId)) {
            events.onError(requestedOperationId, "invalid_message", "A bounded operationId is required.");
            return;
        }

        final UnityPracticePacketValidator.ValidatedPacket initial;
        try {
            initial = UnityPracticePacketValidator.validate(initialPacket, UnityPracticePacketValidator.Direction.HOST);
            if (!"host.initialize".equals(initial.type) || initial.deliveryId != null) {
                throw new UnityPracticePacketValidator.ValidationException(
                    "invalid_message",
                    "Launch requires one session-scoped host.initialize packet."
                );
            }
        } catch (UnityPracticePacketValidator.ValidationException error) {
            events.onError(requestedOperationId, error.code, error.getMessage());
            return;
        }

        Availability nativeAvailability = availability(host);
        String refusal = null;
        String refusalCode = "lifecycle";
        synchronized (UnityPracticeHost.class) {
            if (!nativeAvailability.isAvailable()) {
                refusal = nativeAvailability.detail();
                refusalCode = nativeAvailability.reason();
            } else if (state != State.IDLE || player != null) {
                refusal = "Unity Practice already has an active operation.";
            } else if (!activityStarted || activityPaused) {
                refusal = "Unity Practice cannot launch while the Android host is not started and resumed.";
            } else {
                state = State.LOADING;
                activity = host;
                callback = events;
                operationId = requestedOperationId;
                pendingInitialPacket = initial.packet;
                buildId = initial.buildId;
                sessionId = initial.sessionId;
                hostMessages = new MessageWindow();
                unityMessages = new MessageWindow();
                hostMessages.accept(initial);
                failureReported = false;
                cancelRequested = false;
                runtimeEndpointLoaded = false;
                launchDeadlineElapsedRealtimeMs = SystemClock.elapsedRealtime() + LAUNCH_TIMEOUT_MS;
            }
        }
        if (refusal != null) {
            events.onError(requestedOperationId, refusalCode, refusal);
            return;
        }

        // Reserve one monotonic native deadline before posting construction. The main-thread timer cannot interrupt
        // Unity's constructor, so attach checkpoints also reject the generation immediately after any stalled step.
        logMilestone("operation_reserved", requestedOperationId);
        scheduleLaunchTimeout(requestedOperationId);
        MAIN.post(() -> attachOnMain(host, requestedOperationId));
    }

    private static void attachOnMain(Activity host, String requestedOperationId) {
        logMilestone("attach_main_enter", requestedOperationId);
        if (failIfLaunchDeadlineExpiredOnMain(requestedOperationId, "attach_main_enter")) return;
        boolean cancelled;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state != State.LOADING) return;
            cancelled = cancelRequested;
            if (!activityStarted || activityPaused) cancelled = true;
        }
        if (cancelled) {
            beginUnloadOnMain(requestedOperationId);
            return;
        }
        if (host.isFinishing() || host.isDestroyed()) {
            failAndUnloadOnMain(requestedOperationId, "lifecycle", "The Android host is no longer available for launch.");
            return;
        }

        // Availability may have been queried milliseconds earlier by TypeScript or attach(). Re-read Android's
        // current memory state on the main thread immediately before the UnityPlayer constructor. A device that
        // becomes memory-constrained in that window must still remain on Three.js/Classic.
        Availability nativeAvailability = availability(host);
        if (!nativeAvailability.isAvailable()) {
            failAndUnloadOnMain(requestedOperationId, nativeAvailability.reason(), nativeAvailability.detail());
            return;
        }

        try {
            Object constructed = constructPlayer(host, requestedOperationId);
            logMilestone("player_constructed", requestedOperationId);
            synchronized (UnityPracticeHost.class) {
                if (!requestedOperationId.equals(operationId) || state != State.LOADING) return;
                player = constructed;
                cancelled = cancelRequested;
            }
            if (failIfLaunchDeadlineExpiredOnMain(requestedOperationId, "player_constructed")) return;
            if (cancelled) {
                beginUnloadOnMain(requestedOperationId);
                return;
            }

            View playerView = playerView(constructed);
            if (playerView.getParent() != null) {
                throw new IllegalStateException("Unity player view already has a parent");
            }

            FrameLayout layer = new FrameLayout(host);
            layer.setClickable(true);
            layer.setFocusable(true);
            layer.setFocusableInTouchMode(true);
            // StageHost prepares while React still shows setup. Keep Unity mounted but hidden until a presentation
            // operation explicitly reveals it; otherwise this overlay would make setup and dead-ball actions unusable.
            layer.setVisibility(View.INVISIBLE);
            layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            layer.setAccessibilityPaneTitle("VANDE Practice");
            layer.setContentDescription("VANDE Practice cricket surface");
            layer.setBackgroundColor(0xff050914);
            layer.addView(
                playerView,
                new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            );
            TextView readyHint = createReadyHintView(host);
            FrameLayout.LayoutParams readyHintLayout = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL
            );
            int side = dp(host, 20);
            readyHintLayout.setMargins(side, 0, side, dp(host, 22));
            layer.addView(readyHint, readyHintLayout);
            ViewCompat.setOnApplyWindowInsetsListener(layer, (view, windowInsets) -> {
                Insets safe = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() |
                    WindowInsetsCompat.Type.displayCutout() |
                    WindowInsetsCompat.Type.systemGestures()
                );
                applyReadyHintInsets(host, readyHint, side, safe);
                return windowInsets;
            });
            host.addContentView(
                layer,
                new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            );
            ViewCompat.requestApplyInsets(layer);
            cancelled = false;
            synchronized (UnityPracticeHost.class) {
                overlay = layer;
                readyHintView = readyHint;
                cancelled = cancelRequested;
            }
            logMilestone("player_view_attached", requestedOperationId);
            if (failIfLaunchDeadlineExpiredOnMain(requestedOperationId, "player_view_attached")) return;
            if (cancelled) {
                beginUnloadOnMain(requestedOperationId);
                return;
            }
            startAndResumePlayerOnMain(constructed, host.hasWindowFocus());
            logMilestone("player_started_resumed_focus_replayed", requestedOperationId);
            failIfLaunchDeadlineExpiredOnMain(requestedOperationId, "player_started_resumed_focus_replayed");
        } catch (Throwable error) {
            boolean hasPlayer;
            synchronized (UnityPracticeHost.class) {
                hasPlayer = player != null;
            }
            if (hasPlayer) failAndUnloadOnMain(requestedOperationId, "unity_load_failed", rootMessage(error));
            else {
                // A throwing constructor can leave native Unity state behind without returning a Java player object.
                // Refuse a second player in this process rather than guessing that partial initialization is harmless.
                blockRuntimeOnMain(requestedOperationId, "unity_load_failed", rootMessage(error));
            }
        }
    }

    /** Require Unity's lifecycle-listener constructor: unload cannot be certified safely without its callback. */
    private static Object constructPlayer(Activity host, String requestedOperationId) throws Exception {
        Class<?> type = Class.forName(PLAYER_CLASS);
        Class<?> lifecycleType = Class.forName(LIFECYCLE_EVENTS_CLASS);
        Constructor<?> constructor = UnityPlayerConstructorResolver.resolve(type, lifecycleType);
        Object lifecycle = Proxy.newProxyInstance(
            lifecycleType.getClassLoader(),
            new Class<?>[] { lifecycleType },
            (proxy, method, args) -> lifecycleCallback(proxy, method, args, requestedOperationId)
        );
        return constructor.newInstance(host, lifecycle);
    }

    /** Unity 6 no longer makes the embeddable player itself a View; attach its official root FrameLayout. */
    private static View playerView(Object constructed) throws Exception {
        Method getter = UnityPlayerConstructorResolver.resolveFrameLayoutGetter(constructed.getClass());
        Object candidate = getter.invoke(constructed);
        if (!(candidate instanceof FrameLayout)) {
            throw new IllegalStateException("Unity getFrameLayout() returned no Android FrameLayout");
        }
        return (FrameLayout) candidate;
    }

    /**
     * A Unity player can be attached after the host Activity already received its only initial focus callback. Unity
     * 6000.3 starts with focus=false and run-without-focus is disabled in the verified export, so replay the current
     * focus synchronously after the ordinary start/resume calls. Later Android focus transitions continue through
     * {@link #onWindowFocusChanged(boolean)}.
     */
    private static void startAndResumePlayerOnMain(Object constructed, boolean hasWindowFocus) throws Exception {
        invoke(constructed, "onStart");
        synchronized (UnityPracticeHost.class) {
            if (constructed == player) playerStarted = true;
        }
        invoke(constructed, "onResume");
        synchronized (UnityPracticeHost.class) {
            if (constructed == player) playerPaused = false;
        }
        invoke(constructed, "windowFocusChanged", new Class<?>[] { boolean.class }, hasWindowFocus);
    }

    /**
     * Admission is deliberately exact and fail closed. A different Unity patch/API shape remains on the retained
     * Three.js/Classic renderer until this host is reviewed against that export.
     */
    private static void verifyPlayerApi() throws Exception {
        Class<?> type = Class.forName(PLAYER_CLASS);
        Class<?> lifecycleType = Class.forName(LIFECYCLE_EVENTS_CLASS);
        Class<?> memoryUsageType = Class.forName(MEMORY_USAGE_CLASS);
        UnityPlayerConstructorResolver.resolve(type, lifecycleType);
        UnityPlayerConstructorResolver.resolveFrameLayoutGetter(type);
        UnityPlayerConstructorResolver.resolveViewGetter(type);
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "onStart");
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "onStop");
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "onResume");
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "onPause");
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "windowFocusChanged", boolean.class);
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "unload");
        UnityPlayerConstructorResolver.resolveVoidMethod(type, "onTrimMemory", memoryUsageType);
        UnityPlayerConstructorResolver.resolveStaticVoidMethod(
            type,
            "UnitySendMessage",
            String.class,
            String.class,
            String.class
        );
        UnityPlayerConstructorResolver.resolveMemoryUsage(memoryUsageType, "Medium");
        UnityPlayerConstructorResolver.resolveMemoryUsage(memoryUsageType, "High");
        UnityPlayerConstructorResolver.resolveMemoryUsage(memoryUsageType, "Critical");
    }

    private static Object lifecycleCallback(Object proxy, Method method, Object[] args, String requestedOperationId) {
        String name = method.getName();
        if (method.getDeclaringClass() == Object.class) {
            if ("toString".equals(name)) return "VandeUnityLifecycle";
            if ("hashCode".equals(name)) return System.identityHashCode(proxy);
            if ("equals".equals(name)) return args != null && args.length == 1 && proxy == args[0];
        }
        if ("onUnityPlayerUnloaded".equals(name)) {
            logMilestone("onUnityPlayerUnloaded", requestedOperationId);
            MAIN.post(() -> finishUnloadOnMain(requestedOperationId));
        } else if ("onUnityPlayerQuitted".equals(name)) {
            logMilestone("onUnityPlayerQuitted", requestedOperationId);
            MAIN.post(() -> blockRuntimeOnMain(
                requestedOperationId,
                "lifecycle",
                "Unity quit unexpectedly; a second player is blocked for this app process."
            ));
        }
        return primitiveDefault(method.getReturnType());
    }

    private static Object primitiveDefault(Class<?> type) {
        if (!type.isPrimitive() || type == void.class) return null;
        if (type == boolean.class) return false;
        if (type == char.class) return '\0';
        if (type == byte.class) return (byte) 0;
        if (type == short.class) return (short) 0;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        if (type == float.class) return 0f;
        return 0d;
    }

    /** Called by C# during VandeBridge.Awake so it can bind every callback to this launch generation. */
    public static synchronized String pendingOperationIdFromUnity() {
        return state == State.LOADING && operationId != null ? operationId : "";
    }

    /** C# endpoint is alive; release the pending host.initialize packet, but do not resolve launch yet. */
    public static void runtimeLoadedFromUnity(String requestedOperationId) {
        logMilestone("runtimeLoadedFromUnity_received", requestedOperationId);
        MAIN.post(() -> {
            String initial;
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state != State.LOADING) return;
                runtimeEndpointLoaded = true;
                state = State.INITIALIZING;
                initial = pendingInitialPacket;
                pendingInitialPacket = null;
            }
            logMilestone("runtime_endpoint_loaded", requestedOperationId);
            if (initial == null) {
                failAndUnloadOnMain(requestedOperationId, "lifecycle", "Unity loaded without a pending initialize packet.");
                return;
            }
            try {
                sendUnityMessage(RECEIVE_METHOD, initial);
            } catch (Throwable error) {
                failAndUnloadOnMain(requestedOperationId, "unity_runtime", rootMessage(error));
            }
        });
    }

    /** C# calls this only after it validates host.initialize and constructs a valid unity.ready packet. */
    public static void readyFromUnity(String requestedOperationId, String packet) {
        final UnityPracticePacketValidator.ValidatedPacket ready;
        try {
            ready = UnityPracticePacketValidator.validate(packet, UnityPracticePacketValidator.Direction.UNITY);
            if (!"unity.ready".equals(ready.type) || ready.deliveryId != null) {
                throw new UnityPracticePacketValidator.ValidationException(
                    "invalid_message",
                    "readyFromUnity requires one session-scoped unity.ready packet."
                );
            }
        } catch (UnityPracticePacketValidator.ValidationException error) {
            failAsyncIfCurrent(requestedOperationId, error.code, error.getMessage());
            return;
        }

        MAIN.post(() -> {
            Callback events;
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state != State.INITIALIZING) return;
                if (launchDeadlineExpiredLocked(requestedOperationId)) {
                    failAndUnloadOnMain(
                        requestedOperationId,
                        "timeout",
                        "Unity became ready only after the reserved native deadline."
                    );
                    return;
                }
                String mismatch = sessionMismatch(ready);
                if (mismatch != null) {
                    failAndUnloadOnMain(requestedOperationId, "invalid_message", mismatch);
                    return;
                }
                String runtimeVersion = ready.payload.optString("unityVersion", "");
                if (!BuildConfig.VANDE_UNITY_EDITOR_VERSION.equals(runtimeVersion)) {
                    failAndUnloadOnMain(
                        requestedOperationId,
                        "version_mismatch",
                        "Loaded Unity runtime does not match the exact editor patch selected for this build."
                    );
                    return;
                }
                PacketDecision decision = unityMessages.accept(ready);
                if (decision == PacketDecision.DUPLICATE) return;
                if (decision == PacketDecision.OUT_OF_ORDER) {
                    failAndUnloadOnMain(requestedOperationId, "out_of_order", "unity.ready is out of order.");
                    return;
                }
                state = State.READY;
                launchDeadlineElapsedRealtimeMs = 0L;
                cancelLaunchTimeoutLocked();
                events = callback;
            }
            logMilestone("unity_ready_validated", requestedOperationId);
            if (events != null) events.onReady(requestedOperationId, ready.packet);
        });
    }

    /** C# uses this for complete, checksummed packets destined for TypeScript. */
    public static void emitFromUnity(String requestedOperationId, String packet) {
        final UnityPracticePacketValidator.ValidatedPacket message;
        try {
            message = UnityPracticePacketValidator.validate(packet, UnityPracticePacketValidator.Direction.UNITY);
            if ("unity.ready".equals(message.type)) {
                throw new UnityPracticePacketValidator.ValidationException(
                    "invalid_message",
                    "unity.ready must use readyFromUnity."
                );
            }
        } catch (UnityPracticePacketValidator.ValidationException error) {
            failAsyncIfCurrent(requestedOperationId, error.code, error.getMessage());
            return;
        }

        MAIN.post(() -> {
            Callback events;
            boolean fatalUnityError;
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || !canReceiveUnityMessage(message.type)) return;
                String mismatch = sessionMismatch(message);
                if (mismatch != null) {
                    failAndUnloadOnMain(requestedOperationId, "invalid_message", mismatch);
                    return;
                }
                PacketDecision decision = unityMessages.accept(message);
                if (decision == PacketDecision.DUPLICATE) return;
                if (decision == PacketDecision.OUT_OF_ORDER) {
                    failAndUnloadOnMain(requestedOperationId, "out_of_order", "Unity packet is out of order.");
                    return;
                }
                events = callback;
                fatalUnityError = "unity.error".equals(message.type) && !message.payload.optBoolean("recoverable", false);
            }
            if (events != null) events.onMessage(requestedOperationId, message.packet);
            if ("bridge.ack".equals(message.type)) {
                completeLifecyclePauseAfterAckOnMain(
                    requestedOperationId,
                    message.payload.optString("acknowledgedMessageId", "")
                );
            }
            if (fatalUnityError) {
                failAndUnloadOnMain(requestedOperationId, "unity_runtime", "Unity reported a non-recoverable protocol error.");
            }
        });
    }

    /**
     * Legacy C# advisory only. A managed object can be destroyed before the native player has physically unloaded,
     * so this entry point can never complete unload or release the single-runtime guard.
     */
    public static void unloadedFromUnity(String requestedOperationId) {
        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return;
                if (state == State.UNLOADING) return;
            }
            blockRuntimeOnMain(
                requestedOperationId,
                "lifecycle",
                "Unity reported a managed unload outside the requested unload boundary; a second player is blocked."
            );
        });
    }

    /** Returns true when a valid host packet was accepted into the main-thread Unity queue. */
    public static boolean send(String requestedOperationId, String packet) {
        final UnityPracticePacketValidator.ValidatedPacket message;
        try {
            message = UnityPracticePacketValidator.validate(packet, UnityPracticePacketValidator.Direction.HOST);
            if ("host.initialize".equals(message.type)) {
                throw new UnityPracticePacketValidator.ValidationException(
                    "invalid_message",
                    "host.initialize is accepted only by launch."
                );
            }
        } catch (UnityPracticePacketValidator.ValidationException error) {
            failAsyncIfCurrent(requestedOperationId, error.code, error.getMessage());
            return false;
        }

        final PacketDecision decision;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state != State.READY) return false;
            if (sessionMismatch(message) != null) {
                failAsyncIfCurrent(requestedOperationId, "invalid_message", "Host packet does not match the active build/session.");
                return false;
            }
            decision = hostMessages.accept(message);
            if (decision == PacketDecision.ACCEPT && "host.pause".equals(message.type) && activityPaused) {
                pendingLifecyclePauseMessageId = message.messageId;
            }
        }
        if (decision == PacketDecision.DUPLICATE) return true;
        if (decision == PacketDecision.OUT_OF_ORDER) {
            failAsyncIfCurrent(requestedOperationId, "out_of_order", "Host packet is out of order.");
            return false;
        }

        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state != State.READY) return;
            }
            try {
                sendUnityMessage(RECEIVE_METHOD, message.packet);
            } catch (Throwable error) {
                failAndUnloadOnMain(requestedOperationId, "unity_runtime", rootMessage(error));
            }
        });
        return true;
    }

    /** Cancels a timed-out launch generation and prevents any late ready callback from exposing its overlay. */
    public static boolean cancelLaunch(String requestedOperationId) {
        if (!UnityPracticePacketValidator.validOperationId(requestedOperationId)) return false;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return false;
            cancelRequested = true;
        }
        logMilestone("cancel_launch_requested", requestedOperationId);
        MAIN.post(() -> beginUnloadOnMain(requestedOperationId));
        return true;
    }

    public static boolean unload(String requestedOperationId) {
        if (!UnityPracticePacketValidator.validOperationId(requestedOperationId)) return false;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return false;
        }
        logMilestone("unload_requested", requestedOperationId);
        MAIN.post(() -> beginUnloadOnMain(requestedOperationId));
        return true;
    }

    /** Operation-scoped visibility for the transitional slice; completion follows the actual main-thread mutation. */
    public static void setVisible(String requestedOperationId, boolean visible, VisibilityCallback completion) {
        if (completion == null) return;
        Runnable apply = () -> completion.onApplied(applyVisibility(requestedOperationId, visible));
        if (Looper.myLooper() == Looper.getMainLooper()) apply.run();
        else MAIN.post(apply);
    }

    /**
     * Shows the acknowledged Unity scene with one localized, non-interactive cue.
     * Input remains unarmed until the later validated host.delivery packet.
     */
    public static void setReadyVisible(
        String requestedOperationId,
        boolean visible,
        String hint,
        VisibilityCallback completion
    ) {
        if (completion == null) return;
        Runnable apply = () -> completion.onApplied(
            applyReadyVisibility(requestedOperationId, visible, hint)
        );
        if (Looper.myLooper() == Looper.getMainLooper()) apply.run();
        else MAIN.post(apply);
    }

    private static boolean applyVisibility(String requestedOperationId, boolean visible) {
        final FrameLayout layer;
        final Activity host;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state != State.READY || overlay == null || player == null) return false;
            layer = overlay;
            host = activity;
        }
        if (host == null || host.isFinishing() || host.isDestroyed() || layer.getParent() == null) return false;
        TextView hintView;
        synchronized (UnityPracticeHost.class) {
            hintView = readyHintView;
        }
        if (hintView != null) hintView.setVisibility(View.GONE);
        if (visible) {
            coverWebContent(host);
            layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            layer.setVisibility(View.VISIBLE);
            layer.requestFocus();
        } else {
            layer.setVisibility(View.INVISIBLE);
            layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            restoreWebContent();
        }
        return layer.getVisibility() == (visible ? View.VISIBLE : View.INVISIBLE);
    }

    private static boolean applyReadyVisibility(
        String requestedOperationId,
        boolean visible,
        String hint
    ) {
        final FrameLayout layer;
        final TextView hintView;
        final Activity host;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state != State.READY || overlay == null ||
                readyHintView == null || player == null) return false;
            layer = overlay;
            hintView = readyHintView;
            host = activity;
        }
        if (host == null || host.isFinishing() || host.isDestroyed() || layer.getParent() == null) return false;
        if (visible) {
            coverWebContent(host);
            hintView.setText(hint);
            hintView.setVisibility(View.VISIBLE);
            layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_YES);
            layer.setVisibility(View.VISIBLE);
            layer.requestFocus();
        } else {
            hintView.setVisibility(View.GONE);
            layer.setVisibility(View.INVISIBLE);
            layer.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            restoreWebContent();
        }
        return layer.getVisibility() == (visible ? View.VISIBLE : View.INVISIBLE) &&
            hintView.getVisibility() == (visible ? View.VISIBLE : View.GONE);
    }

    public static void onHostStart() {
        Runnable start = UnityPracticeHost::startPlayerOnMain;
        synchronized (UnityPracticeHost.class) {
            activityStarted = true;
        }
        if (Looper.myLooper() == Looper.getMainLooper()) start.run();
        else MAIN.post(start);
    }

    public static void onHostResume() {
        Runnable resume = UnityPracticeHost::resumePlayerOnMain;
        if (Looper.myLooper() == Looper.getMainLooper()) resume.run();
        else MAIN.post(resume);
    }

    public static void onHostPause() {
        String active;
        boolean cancelLoading;
        synchronized (UnityPracticeHost.class) {
            activityPaused = true;
            pendingLifecyclePauseMessageId = null;
            cancelLifecyclePauseTimeoutLocked();
            active = operationId;
            cancelLoading = state == State.LOADING || state == State.INITIALIZING;
            if (active == null || state == State.IDLE || state == State.BLOCKED || state == State.UNLOADING) return;
            if (!cancelLoading) {
                lifecyclePauseTimeout = () -> pausePlayerOnMain(active);
                MAIN.postDelayed(lifecyclePauseTimeout, LIFECYCLE_PAUSE_ACK_GRACE_MS);
            }
        }
        // A half-created runtime cannot perform the protocol pause handshake. Cancel it instead of resuming a new
        // UnityPlayer behind a paused Activity; the normal optional-renderer fallback remains authoritative.
        if (cancelLoading) {
            if (Looper.myLooper() == Looper.getMainLooper()) beginUnloadOnMain(active);
            else MAIN.post(() -> beginUnloadOnMain(active));
        }
    }

    public static void onHostStop() {
        final String active;
        synchronized (UnityPracticeHost.class) {
            activityStarted = false;
            activityPaused = true;
            active = operationId;
            if (active == null || state == State.IDLE || state == State.BLOCKED || state == State.UNLOADING) return;
        }
        Runnable stop = () -> {
            // Android always pauses before stopping, but do not let a delayed protocol ACK leave Unity running once
            // the Activity is no longer visible.
            pausePlayerOnMain(active);
            stopPlayerOnMain(active);
        };
        if (Looper.myLooper() == Looper.getMainLooper()) stop.run();
        else MAIN.post(stop);
    }

    public static void onWindowFocusChanged(boolean hasFocus) {
        withPlayer("windowFocusChanged", new Class<?>[] { boolean.class }, hasFocus);
    }

    public static void onConfigurationChanged(Configuration configuration) {
        if (configuration != null) withPlayer("configurationChanged", new Class<?>[] { Configuration.class }, configuration);
    }

    public static void onNewIntent(Intent intent) {
        if (intent != null) withPlayer("newIntent", new Class<?>[] { Intent.class }, intent);
    }

    public static void onLowMemory() {
        withPlayerMemoryUsage("Critical");
    }

    public static void onTrimMemory(int level) {
        switch (level) {
            case ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE:
                withPlayerMemoryUsage("Medium");
                break;
            case ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW:
                withPlayerMemoryUsage("High");
                break;
            case ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL:
                withPlayerMemoryUsage("Critical");
                break;
            default:
                // Match Unity 6000.3's generated Activity: background/UI-hidden levels are not forwarded.
                break;
        }
    }

    /**
     * @return true when Unity owns the visible surface and Back must be consumed.
     *
     * <p>Back remains inert during a ready/live delivery, but the retained dead-ball surface must not trap the
     * player. The Unity session owns the phase guard, so every visible-overlay Back is offered to its dedicated
     * dead-ball pause endpoint. That endpoint emits the existing validated pause request only for the current,
     * actionable dead ball and otherwise no-ops. TypeScript still owns the pause transition and hides this overlay
     * before showing React's pause surface; Android never manufactures a lifecycle change or advances a ball.
     */
    public static boolean onBackPressed() {
        final String active;
        synchronized (UnityPracticeHost.class) {
            if (overlay == null || overlay.getParent() == null || overlay.getVisibility() != View.VISIBLE || operationId == null || state == State.IDLE) return false;
            active = operationId;
        }
        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (!matches(active) || state != State.READY || !runtimeEndpointLoaded || overlay == null ||
                    overlay.getParent() == null || overlay.getVisibility() != View.VISIBLE) return;
            }
            try {
                sendUnityMessage(NATIVE_BACK_PAUSE_METHOD, "");
            } catch (Throwable error) {
                failAndUnloadOnMain(active, "unity_runtime", rootMessage(error));
            }
        });
        return true;
    }

    public static void onHostDestroyed(Activity host) {
        MAIN.post(() -> {
            String active;
            synchronized (UnityPracticeHost.class) {
                if (activity != host || operationId == null || state == State.IDLE) return;
                active = operationId;
            }
            // Uncover and release WebView state immediately; retain UnityPlayer until unload confirms.
            removeOverlayAndRestoreWebContent();
            synchronized (UnityPracticeHost.class) {
                activity = null;
            }
            failAndUnloadOnMain(active, "lifecycle", "The Android host Activity was destroyed during Unity Practice.");
        });
    }

    public static synchronized void releaseCallback(Callback owner) {
        if (callback == owner) callback = null;
    }

    private static boolean canReceiveUnityMessage(String type) {
        if (state == State.INITIALIZING) return "bridge.ack".equals(type) || "unity.error".equals(type);
        if (state == State.READY) return true;
        if (state == State.UNLOADING) {
            return "bridge.ack".equals(type) || "unity.unloaded".equals(type) || "unity.error".equals(type);
        }
        return false;
    }

    private static String sessionMismatch(UnityPracticePacketValidator.ValidatedPacket packet) {
        if (!packet.buildId.equals(buildId)) return "Packet buildId does not match the active launch.";
        if (!packet.sessionId.equals(sessionId)) return "Packet sessionId does not match the active launch.";
        return null;
    }

    private static synchronized boolean matches(String requestedOperationId) {
        return requestedOperationId != null && requestedOperationId.equals(operationId);
    }

    private static void beginUnloadOnMain(String requestedOperationId) {
        Object current;
        Callback completedWithoutPlayer = null;
        boolean quarantineBeforeManagedEndpoint;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return;
            if (state == State.UNLOADING) return;
            current = player;
            quarantineBeforeManagedEndpoint = current != null && !runtimeEndpointLoaded;
            if (!quarantineBeforeManagedEndpoint) {
                state = State.UNLOADING;
                launchDeadlineElapsedRealtimeMs = 0L;
                pendingInitialPacket = null;
                cancelLaunchTimeoutLocked();
                cancelLifecyclePauseTimeoutLocked();
                pendingLifecyclePauseMessageId = null;
                if (current == null) completedWithoutPlayer = callback;
            }
        }
        if (quarantineBeforeManagedEndpoint) {
            // Unity's managed endpoint cannot acknowledge PrepareForUnload yet. Retain and quarantine this player
            // instead of asking a partially initialized runtime to unload inside the shared Capacitor process.
            suspendPlayerForQuarantineOnMain(current);
            logMilestone("pre_endpoint_player_quarantined", requestedOperationId);
            blockRuntimeOnMain(
                requestedOperationId,
                "lifecycle",
                "Unity failed before its managed endpoint loaded; the retained player is quarantined until app restart."
            );
            return;
        }
        logMilestone("physical_unload_started", requestedOperationId);
        if (current == null) {
            synchronized (UnityPracticeHost.class) {
                if (matches(requestedOperationId)) clearStateLocked();
            }
            removeOverlayAndRestoreWebContent();
            logMilestone("physical_unload_confirmed_no_player", requestedOperationId);
            if (completedWithoutPlayer != null) completedWithoutPlayer.onUnloaded(requestedOperationId);
            return;
        }

        try {
            sendUnityMessage(PREPARE_UNLOAD_METHOD, "");
        } catch (Throwable error) {
            reportErrorOnce(requestedOperationId, "unity_runtime", rootMessage(error));
        }
        scheduleUnloadTimeout(requestedOperationId);
        MAIN.postDelayed(() -> {
            Object activePlayer;
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state != State.UNLOADING) return;
                activePlayer = player;
            }
            if (activePlayer == null) {
                blockRuntimeOnMain(
                    requestedOperationId,
                    "lifecycle",
                    "UnityPlayer disappeared without the native lifecycle unload callback; a second player is blocked."
                );
                return;
            }
            try {
                // Never invoke quit(): Unity documents that it terminates the process hosting the runtime.
                logMilestone("player_unload_invoked", requestedOperationId);
                invoke(activePlayer, "unload");
            } catch (Throwable error) {
                blockRuntimeOnMain(requestedOperationId, "lifecycle", rootMessage(error));
            }
        }, PREPARE_UNLOAD_GRACE_MS);
    }

    private static void finishUnloadOnMain(String requestedOperationId) {
        Callback events;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state != State.UNLOADING) return;
            events = callback;
            clearStateLocked();
        }
        removeOverlayAndRestoreWebContent();
        logMilestone("physical_unload_confirmed", requestedOperationId);
        if (events != null) events.onUnloaded(requestedOperationId);
    }

    /** Best-effort inerting for a retained, partially initialized player that must not be unloaded or resumed. */
    private static void suspendPlayerForQuarantineOnMain(Object retainedPlayer) {
        boolean shouldPause;
        boolean shouldStop;
        synchronized (UnityPracticeHost.class) {
            if (retainedPlayer == null || retainedPlayer != player) return;
            shouldPause = playerStarted && !playerPaused;
            shouldStop = playerStarted;
        }
        if (shouldPause) {
            try {
                invoke(retainedPlayer, "onPause");
                synchronized (UnityPracticeHost.class) {
                    if (retainedPlayer == player) playerPaused = true;
                }
            } catch (Throwable ignored) {
                // Quarantine remains fail-closed even if partial initialization cannot accept a pause callback.
            }
        }
        if (shouldStop) {
            try {
                invoke(retainedPlayer, "onStop");
                synchronized (UnityPracticeHost.class) {
                    if (retainedPlayer == player) playerStarted = false;
                }
            } catch (Throwable ignored) {
                // The retained reference and BLOCKED state still prevent a second player or later resume.
            }
        }
    }

    private static void failAsyncIfCurrent(String requestedOperationId, String code, String detail) {
        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return;
            }
            failAndUnloadOnMain(requestedOperationId, code, detail);
        });
    }

    private static void failAndUnloadOnMain(String requestedOperationId, String code, String detail) {
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state == State.IDLE || state == State.BLOCKED) return;
        }
        reportErrorOnce(requestedOperationId, code, detail);
        beginUnloadOnMain(requestedOperationId);
    }

    private static void reportErrorOnce(String requestedOperationId, String code, String detail) {
        Callback events;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || failureReported) return;
            failureReported = true;
            events = callback;
        }
        if (events != null) events.onError(requestedOperationId, code, boundedDetail(detail));
    }

    private static void blockRuntimeOnMain(String requestedOperationId, String code, String detail) {
        Callback events;
        boolean shouldReport;
        synchronized (UnityPracticeHost.class) {
            if (!matches(requestedOperationId) || state == State.IDLE) return;
            shouldReport = !failureReported;
            failureReported = true;
            cancelLaunchTimeoutLocked();
            cancelUnloadTimeoutLocked();
            cancelLifecyclePauseTimeoutLocked();
            state = State.BLOCKED;
            launchDeadlineElapsedRealtimeMs = 0L;
            pendingInitialPacket = null;
            pendingLifecyclePauseMessageId = null;
            events = callback;
            callback = null;
            activity = null;
        }
        removeOverlayAndRestoreWebContent();
        logMilestone("runtime_blocked", requestedOperationId);
        if (shouldReport && events != null) events.onError(requestedOperationId, code, boundedDetail(detail));
    }

    private static void scheduleLaunchTimeout(String requestedOperationId) {
        synchronized (UnityPracticeHost.class) {
            cancelLaunchTimeoutLocked();
            launchTimeout = () -> {
                logMilestone("native_launch_timeout", requestedOperationId);
                failAndUnloadOnMain(
                    requestedOperationId,
                    "timeout",
                    "Unity did not validate initialize and become ready before the native deadline."
                );
            };
            long remainingMs = Math.max(0L, launchDeadlineElapsedRealtimeMs - SystemClock.elapsedRealtime());
            MAIN.postDelayed(launchTimeout, remainingMs);
        }
    }

    private static boolean failIfLaunchDeadlineExpiredOnMain(String requestedOperationId, String milestone) {
        synchronized (UnityPracticeHost.class) {
            if (!launchDeadlineExpiredLocked(requestedOperationId)) return false;
        }
        logMilestone("native_launch_deadline_expired_at_" + milestone, requestedOperationId);
        failAndUnloadOnMain(
            requestedOperationId,
            "timeout",
            "Unity exceeded the reserved native deadline before " + milestone + "."
        );
        return true;
    }

    private static boolean launchDeadlineExpiredLocked(String requestedOperationId) {
        return matches(requestedOperationId)
            && launchDeadlineElapsedRealtimeMs > 0L
            && SystemClock.elapsedRealtime() >= launchDeadlineElapsedRealtimeMs;
    }

    private static void scheduleUnloadTimeout(String requestedOperationId) {
        synchronized (UnityPracticeHost.class) {
            cancelUnloadTimeoutLocked();
            unloadTimeout = () -> blockRuntimeOnMain(
                requestedOperationId,
                "lifecycle",
                "Unity did not confirm unload; a second player is blocked for this app process."
            );
            MAIN.postDelayed(unloadTimeout, UNLOAD_TIMEOUT_MS);
        }
    }

    private static void cancelLaunchTimeoutLocked() {
        if (launchTimeout != null) MAIN.removeCallbacks(launchTimeout);
        launchTimeout = null;
    }

    private static void cancelUnloadTimeoutLocked() {
        if (unloadTimeout != null) MAIN.removeCallbacks(unloadTimeout);
        unloadTimeout = null;
    }

    private static void cancelLifecyclePauseTimeoutLocked() {
        if (lifecyclePauseTimeout != null) MAIN.removeCallbacks(lifecyclePauseTimeout);
        lifecyclePauseTimeout = null;
    }

    /** Called on main after the matching C# ACK has already crossed the runtime boundary. */
    private static void completeLifecyclePauseAfterAckOnMain(String requestedOperationId, String acknowledgedMessageId) {
        synchronized (UnityPracticeHost.class) {
            if (!activityPaused || !matches(requestedOperationId) || state != State.READY ||
                pendingLifecyclePauseMessageId == null ||
                !pendingLifecyclePauseMessageId.equals(acknowledgedMessageId)) return;
            pendingLifecyclePauseMessageId = null;
            cancelLifecyclePauseTimeoutLocked();
        }
        pausePlayerOnMain(requestedOperationId);
    }

    private static void startPlayerOnMain() {
        final Object current;
        final String active;
        synchronized (UnityPracticeHost.class) {
            if (!activityStarted || state != State.READY || player == null || playerStarted) return;
            current = player;
            active = operationId;
        }
        try {
            invoke(current, "onStart");
            synchronized (UnityPracticeHost.class) {
                if (current == player && activityStarted && state == State.READY) playerStarted = true;
            }
        } catch (Throwable error) {
            failAndUnloadOnMain(active, "lifecycle", rootMessage(error));
        }
    }

    /** Bounded fallback when JavaScript/C# cannot complete the normal background-pause handshake. */
    private static void pausePlayerOnMain(String requestedOperationId) {
        final Object current;
        synchronized (UnityPracticeHost.class) {
            if (!activityPaused || !matches(requestedOperationId) || state != State.READY ||
                player == null || playerPaused) return;
            cancelLifecyclePauseTimeoutLocked();
            current = player;
        }
        try {
            invoke(current, "onPause");
            synchronized (UnityPracticeHost.class) {
                if (current == player && activityPaused) playerPaused = true;
            }
        } catch (Throwable error) {
            failAndUnloadOnMain(requestedOperationId, "lifecycle", rootMessage(error));
        }
    }

    private static void stopPlayerOnMain(String requestedOperationId) {
        final Object current;
        synchronized (UnityPracticeHost.class) {
            if (activityStarted || !matches(requestedOperationId) || state != State.READY ||
                player == null || !playerStarted) return;
            current = player;
        }
        try {
            invoke(current, "onStop");
            synchronized (UnityPracticeHost.class) {
                if (current == player && !activityStarted) playerStarted = false;
            }
        } catch (Throwable error) {
            failAndUnloadOnMain(requestedOperationId, "lifecycle", rootMessage(error));
        }
    }

    private static void resumePlayerOnMain() {
        final Object current;
        final String active;
        synchronized (UnityPracticeHost.class) {
            activityPaused = false;
            pendingLifecyclePauseMessageId = null;
            cancelLifecyclePauseTimeoutLocked();
            // Resume only a player that this host successfully paused and still owns as the ready runtime. A player
            // retained in UNLOADING/BLOCKED is deliberately unsafe to restart, and a fast pause/resume that never
            // crossed the pause gate needs no compensating native resume call.
            if (!activityStarted || state != State.READY || !playerStarted || !playerPaused) return;
            current = player;
            active = operationId;
        }
        if (current == null) return;
        try {
            invoke(current, "onResume");
            synchronized (UnityPracticeHost.class) {
                if (current == player) playerPaused = false;
            }
        } catch (Throwable error) {
            failAndUnloadOnMain(active, "lifecycle", rootMessage(error));
        }
    }

    private static void clearStateLocked() {
        cancelLaunchTimeoutLocked();
        cancelUnloadTimeoutLocked();
        cancelLifecyclePauseTimeoutLocked();
        state = State.IDLE;
        player = null;
        readyHintView = null;
        activity = null;
        callback = null;
        operationId = null;
        pendingInitialPacket = null;
        buildId = null;
        sessionId = null;
        hostMessages = null;
        unityMessages = null;
        failureReported = false;
        cancelRequested = false;
        runtimeEndpointLoaded = false;
        launchDeadlineElapsedRealtimeMs = 0L;
        playerStarted = false;
        playerPaused = false;
        pendingLifecyclePauseMessageId = null;
    }

    /** Bounded, packet-free lifecycle telemetry retained by the sealed Android evidence harness. */
    private static void logMilestone(String event, String requestedOperationId) {
        final State snapshot;
        synchronized (UnityPracticeHost.class) {
            snapshot = state;
        }
        String safeOperation = requestedOperationId == null
            ? "null"
            : requestedOperationId.replace('\r', ' ').replace('\n', ' ');
        if (safeOperation.length() > MAX_LOG_OPERATION_ID) {
            safeOperation = safeOperation.substring(0, MAX_LOG_OPERATION_ID);
        }
        Log.i(
            LOG_TAG,
            "event=" + event + " operationId=" + safeOperation + " state=" + snapshot
                + " pid=" + android.os.Process.myPid()
        );
    }

    private static void withPlayer(String method) {
        withPlayer(method, new Class<?>[0]);
    }

    private static void withPlayer(String method, Class<?>[] parameterTypes, Object... arguments) {
        Object current;
        synchronized (UnityPracticeHost.class) {
            current = player;
        }
        if (current == null) return;
        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (current != player || state == State.IDLE || state == State.UNLOADING || state == State.BLOCKED) return;
            }
            try {
                current.getClass().getMethod(method, parameterTypes).invoke(current, arguments);
            } catch (Throwable ignored) {
                // Exact export APIs differ by patch; physical lifecycle evidence is required before enabling Unity.
            }
        });
    }

    private static void withPlayerMemoryUsage(String name) {
        final Object current;
        final String active;
        synchronized (UnityPracticeHost.class) {
            current = player;
            active = operationId;
        }
        if (current == null || active == null) return;
        MAIN.post(() -> {
            synchronized (UnityPracticeHost.class) {
                if (current != player || state == State.IDLE || state == State.BLOCKED) return;
            }
            try {
                Class<?> memoryUsageType = Class.forName(MEMORY_USAGE_CLASS);
                Object usage = UnityPlayerConstructorResolver.resolveMemoryUsage(memoryUsageType, name);
                Method trim = UnityPlayerConstructorResolver.resolveVoidMethod(
                    current.getClass(),
                    "onTrimMemory",
                    memoryUsageType
                );
                trim.invoke(current, usage);
            } catch (Throwable error) {
                failAndUnloadOnMain(active, "lifecycle", rootMessage(error));
            }
        });
    }

    private static void sendUnityMessage(String method, String value) throws Exception {
        Method send = Class.forName(PLAYER_CLASS).getMethod("UnitySendMessage", String.class, String.class, String.class);
        send.invoke(null, BRIDGE_OBJECT, method, value);
    }

    private static void invoke(Object target, String name) throws Exception {
        invoke(target, name, new Class<?>[0]);
    }

    private static void invoke(Object target, String name, Class<?>[] parameterTypes, Object... arguments) throws Exception {
        target.getClass().getMethod(name, parameterTypes).invoke(target, arguments);
    }

    private static void coverWebContent(Activity host) {
        synchronized (UnityPracticeHost.class) {
            if (coveredWebView != null) return;
        }
        View content = host.findViewById(android.R.id.content);
        View webView = findWebView(content);
        if (webView == null) return;
        synchronized (UnityPracticeHost.class) {
            coveredWebView = webView;
            coveredAccessibility = webView.getImportantForAccessibility();
            coveredHadFocus = webView.hasFocus() || webView.findFocus() != null;
            if (webView instanceof ViewGroup) {
                coveredDescendantFocusability = ((ViewGroup) webView).getDescendantFocusability();
            }
        }
        // Unity owns pixels and ordinary touch/keyboard focus while this layer is visible, but React deliberately
        // remains the semantic mirror for score, Pause and the batting gesture. Hiding the WebView descendants here
        // removes that complete TalkBack tree and leaves only a generic Unity surface. Preserve both accessibility
        // importance and descendant focusability; applyVisibility() moves ordinary focus to the overlay separately.
        // Accessibility focus is independent and must remain able to traverse the semantic DOM underneath.
    }

    private static View findWebView(View node) {
        if (node instanceof WebView) return node;
        if (!(node instanceof ViewGroup)) return null;
        ViewGroup group = (ViewGroup) node;
        for (int index = 0; index < group.getChildCount(); index++) {
            View match = findWebView(group.getChildAt(index));
            if (match != null) return match;
        }
        return null;
    }

    private static void removeOverlayAndRestoreWebContent() {
        FrameLayout layer;
        synchronized (UnityPracticeHost.class) {
            layer = overlay;
            overlay = null;
            readyHintView = null;
        }
        if (layer != null && layer.getParent() instanceof ViewGroup) {
            ((ViewGroup) layer.getParent()).removeView(layer);
        }
        restoreWebContent();
    }

    private static TextView createReadyHintView(Activity host) {
        TextView hint = new TextView(host);
        hint.setVisibility(View.GONE);
        hint.setGravity(Gravity.CENTER);
        hint.setTextColor(Color.rgb(244, 247, 250));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f);
        hint.setPadding(dp(host, 18), dp(host, 12), dp(host, 18), dp(host, 12));
        hint.setClickable(false);
        hint.setFocusable(false);
        hint.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        GradientDrawable background = new GradientDrawable();
        background.setColor(0xe61b2029);
        background.setCornerRadius(dp(host, 18));
        background.setStroke(dp(host, 1), 0x6659cee8);
        hint.setBackground(background);
        return hint;
    }

    static void applyReadyHintInsets(Activity host, TextView hint, int sideMargin, Insets safe) {
        if (host == null || hint == null || safe == null || !(hint.getLayoutParams() instanceof FrameLayout.LayoutParams)) return;
        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) hint.getLayoutParams();
        params.setMargins(
            sideMargin + Math.max(0, safe.left),
            Math.max(0, safe.top),
            sideMargin + Math.max(0, safe.right),
            dp(host, 22) + Math.max(0, safe.bottom)
        );
        hint.setLayoutParams(params);
    }

    private static int dp(Activity host, int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            host.getResources().getDisplayMetrics()
        ));
    }

    private static void restoreWebContent() {
        View webView;
        int accessibility;
        int descendantFocusability;
        boolean restoreFocus;
        synchronized (UnityPracticeHost.class) {
            webView = coveredWebView;
            coveredWebView = null;
            accessibility = coveredAccessibility;
            descendantFocusability = coveredDescendantFocusability;
            restoreFocus = coveredHadFocus;
            coveredHadFocus = false;
        }
        if (webView != null) {
            webView.setImportantForAccessibility(accessibility);
            if (webView instanceof ViewGroup) ((ViewGroup) webView).setDescendantFocusability(descendantFocusability);
            if (restoreFocus) webView.requestFocus();
        }
    }

    private static String rootMessage(Throwable error) {
        Throwable root = error;
        while (root.getCause() != null) root = root.getCause();
        String message = root.getMessage();
        return root.getClass().getSimpleName() + (message == null ? "" : ": " + message);
    }

    private static String boundedDetail(String detail) {
        if (detail == null || detail.isEmpty()) return "Unity Practice failed without diagnostic detail.";
        return detail.length() <= 512 ? detail : detail.substring(0, 512);
    }
}
