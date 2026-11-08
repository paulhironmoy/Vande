package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class UnityPracticeMemoryGateTest {
    @Test
    public void allowsOnlyWhenNeitherOfficialSignalReportsMemoryRisk() {
        assertEquals(
            UnityPracticeMemoryGate.Decision.ALLOW,
            UnityPracticeMemoryGate.fromSignals(false, false, 3_000_000_001L)
        );
    }

    @Test
    public void lowRamDeviceAlwaysRefusesUnity() {
        assertEquals(
            UnityPracticeMemoryGate.Decision.LOW_RAM_DEVICE,
            UnityPracticeMemoryGate.fromSignals(true, false, 8_000_000_000L)
        );
        assertEquals(
            UnityPracticeMemoryGate.Decision.LOW_RAM_DEVICE,
            UnityPracticeMemoryGate.fromSignals(true, true, 8_000_000_000L)
        );
    }

    @Test
    public void currentLowMemoryRefusesUnityOnAnOtherwiseCapableDevice() {
        assertEquals(
            UnityPracticeMemoryGate.Decision.LOW_MEMORY,
            UnityPracticeMemoryGate.fromSignals(false, true, 8_000_000_000L)
        );
    }

    @Test
    public void threeDecimalGigabytesOrLessRefusesUnity() {
        assertEquals(
            UnityPracticeMemoryGate.Decision.TOTAL_MEMORY_AT_OR_BELOW_FLOOR,
            UnityPracticeMemoryGate.fromSignals(false, false, 3_000_000_000L)
        );
        assertEquals(
            UnityPracticeMemoryGate.Decision.TOTAL_MEMORY_AT_OR_BELOW_FLOOR,
            UnityPracticeMemoryGate.fromSignals(false, false, 2_000_000_000L)
        );
    }

    @Test
    public void missingOrInvalidTotalMemoryFailsClosed() {
        assertEquals(
            UnityPracticeMemoryGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeMemoryGate.fromSignals(false, false, 0L)
        );
        assertEquals(
            UnityPracticeMemoryGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeMemoryGate.fromSignals(false, false, -1L)
        );
    }
}
