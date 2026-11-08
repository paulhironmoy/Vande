package in.vande.cricket.unity;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.ConfigurationInfo;

/**
 * Fail-closed graphics preflight for the optional Unity renderer.
 *
 * <p>The app manifest deliberately does not make OpenGL ES 3 an install filter because the retained renderer remains
 * usable on older devices. This gate must therefore run before any Unity class or native library is touched.
 */
final class UnityPracticeGraphicsGate {
    static final int REQUIRED_GLES_VERSION = 0x00030000;

    enum Decision {
        ALLOW,
        UNSUPPORTED_GLES,
        SIGNAL_UNAVAILABLE
    }

    private UnityPracticeGraphicsGate() {}

    static Decision inspect(Context context) {
        if (context == null) return Decision.SIGNAL_UNAVAILABLE;
        try {
            ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            if (manager == null) return Decision.SIGNAL_UNAVAILABLE;
            ConfigurationInfo configuration = manager.getDeviceConfigurationInfo();
            return fromRequiredVersion(configuration == null ? null : configuration.reqGlEsVersion);
        } catch (RuntimeException | LinkageError ignored) {
            return Decision.SIGNAL_UNAVAILABLE;
        }
    }

    static Decision fromRequiredVersion(Integer requiredVersion) {
        if (requiredVersion == null || requiredVersion <= 0) return Decision.SIGNAL_UNAVAILABLE;
        return requiredVersion >= REQUIRED_GLES_VERSION ? Decision.ALLOW : Decision.UNSUPPORTED_GLES;
    }
}
