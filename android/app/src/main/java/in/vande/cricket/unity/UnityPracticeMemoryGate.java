package in.vande.cricket.unity;

import android.app.ActivityManager;
import android.content.Context;

/**
 * Fail-closed memory preflight for the optional Unity runtime.
 *
 * <p>Unity-as-a-Library shares the process with the retained Capacitor WebView. Android's own low-RAM device
 * classification and current system-memory pressure signal therefore have to pass before UnityPlayer is even
 * constructed. The complete Three.js/Classic path remains available when this gate refuses Unity.
 */
final class UnityPracticeMemoryGate {
    static final long MAX_LOW_MEMORY_TOTAL_BYTES = 3_000_000_000L;

    enum Decision {
        ALLOW,
        LOW_RAM_DEVICE,
        LOW_MEMORY,
        TOTAL_MEMORY_AT_OR_BELOW_FLOOR,
        SIGNAL_UNAVAILABLE
    }

    private UnityPracticeMemoryGate() {}

    static Decision inspect(Context context) {
        if (context == null) return Decision.SIGNAL_UNAVAILABLE;
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return Decision.SIGNAL_UNAVAILABLE;

            // isLowRamDevice() is Android's stable device-class signal. Avoid allocating MemoryInfo when it already
            // refuses Unity, but always read current pressure and physical RAM for other devices.
            if (manager.isLowRamDevice()) return Decision.LOW_RAM_DEVICE;
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            manager.getMemoryInfo(memory);
            return fromSignals(false, memory.lowMemory, memory.totalMem);
        } catch (RuntimeException ignored) {
            // A missing/broken system signal must not become permission to construct the expensive optional runtime.
            return Decision.SIGNAL_UNAVAILABLE;
        }
    }

    static Decision fromSignals(boolean lowRamDevice, boolean lowMemory, long totalMemoryBytes) {
        if (lowRamDevice) return Decision.LOW_RAM_DEVICE;
        if (lowMemory) return Decision.LOW_MEMORY;
        if (totalMemoryBytes <= 0) return Decision.SIGNAL_UNAVAILABLE;
        if (totalMemoryBytes <= MAX_LOW_MEMORY_TOTAL_BYTES) return Decision.TOTAL_MEMORY_AT_OR_BELOW_FLOOR;
        return Decision.ALLOW;
    }
}
