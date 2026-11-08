package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class UnityPracticeAbiGateTest {
    @Test
    public void allowsA64BitProcessWhosePreferredAbiMatchesTheExport() {
        assertEquals(
            UnityPracticeAbiGate.Decision.ALLOW,
            UnityPracticeAbiGate.fromSignals(true, new String[] { "arm64-v8a", "armeabi-v7a" })
        );
    }

    @Test
    public void refusesA32BitProcessEvenOnAnArm64CapableDevice() {
        assertEquals(
            UnityPracticeAbiGate.Decision.PROCESS_32_BIT,
            UnityPracticeAbiGate.fromSignals(false, new String[] { "arm64-v8a", "armeabi-v7a" })
        );
    }

    @Test
    public void refusesAnUnsupportedPreferredAbiEvenWhenArm64AppearsLater() {
        assertEquals(
            UnityPracticeAbiGate.Decision.UNSUPPORTED_ABI,
            UnityPracticeAbiGate.fromSignals(true, new String[] { "x86_64", "arm64-v8a" })
        );
        assertEquals(
            UnityPracticeAbiGate.Decision.UNSUPPORTED_ABI,
            UnityPracticeAbiGate.fromSignals(true, new String[] { "armeabi-v7a" })
        );
    }

    @Test
    public void missingProcessOrAbiSignalsFailClosed() {
        assertEquals(
            UnityPracticeAbiGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeAbiGate.fromSignals(null, new String[] { "arm64-v8a" })
        );
        assertEquals(
            UnityPracticeAbiGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeAbiGate.fromSignals(true, null)
        );
        assertEquals(
            UnityPracticeAbiGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeAbiGate.fromSignals(true, new String[0])
        );
        assertEquals(
            UnityPracticeAbiGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeAbiGate.fromSignals(true, new String[] { " " })
        );
    }
}
