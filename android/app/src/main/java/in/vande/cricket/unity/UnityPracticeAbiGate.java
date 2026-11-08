package in.vande.cricket.unity;

import android.os.Build;
import android.os.Process;

/**
 * Fail-closed native ABI preflight for the optional ARM64-only Unity export.
 *
 * <p>The retained renderer supports cohorts that cannot load the Unity native libraries. Keep this check independent
 * of Unity classes so it can run before {@code Class.forName("com.unity3d.player.UnityPlayer")} and be unit-tested
 * without an Android device.
 */
final class UnityPracticeAbiGate {
    static final String REQUIRED_ABI = "arm64-v8a";

    enum Decision {
        ALLOW,
        PROCESS_32_BIT,
        UNSUPPORTED_ABI,
        SIGNAL_UNAVAILABLE
    }

    private UnityPracticeAbiGate() {}

    static Decision inspect() {
        try {
            return fromSignals(Process.is64Bit(), Build.SUPPORTED_ABIS);
        } catch (RuntimeException | LinkageError ignored) {
            // A missing or broken platform signal must not become permission to load ARM64-only native code.
            return Decision.SIGNAL_UNAVAILABLE;
        }
    }

    static Decision fromSignals(Boolean processIs64Bit, String[] supportedAbis) {
        if (processIs64Bit == null) return Decision.SIGNAL_UNAVAILABLE;
        if (!processIs64Bit) return Decision.PROCESS_32_BIT;
        if (supportedAbis == null || supportedAbis.length == 0) return Decision.SIGNAL_UNAVAILABLE;

        String preferredAbi = supportedAbis[0];
        if (preferredAbi == null || preferredAbi.trim().isEmpty()) return Decision.SIGNAL_UNAVAILABLE;
        return REQUIRED_ABI.equals(preferredAbi) ? Decision.ALLOW : Decision.UNSUPPORTED_ABI;
    }
}
