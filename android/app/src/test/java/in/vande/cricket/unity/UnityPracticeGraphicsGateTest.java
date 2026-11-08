package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class UnityPracticeGraphicsGateTest {
    @Test
    public void allowsOpenGlEsThreeAndNewer() {
        assertEquals(
            UnityPracticeGraphicsGate.Decision.ALLOW,
            UnityPracticeGraphicsGate.fromRequiredVersion(0x00030000)
        );
        assertEquals(
            UnityPracticeGraphicsGate.Decision.ALLOW,
            UnityPracticeGraphicsGate.fromRequiredVersion(0x00030002)
        );
    }

    @Test
    public void retainsTheFallbackBelowOpenGlEsThree() {
        assertEquals(
            UnityPracticeGraphicsGate.Decision.UNSUPPORTED_GLES,
            UnityPracticeGraphicsGate.fromRequiredVersion(0x00020000)
        );
    }

    @Test
    public void missingOrInvalidSignalsFailClosed() {
        assertEquals(
            UnityPracticeGraphicsGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeGraphicsGate.fromRequiredVersion(null)
        );
        assertEquals(
            UnityPracticeGraphicsGate.Decision.SIGNAL_UNAVAILABLE,
            UnityPracticeGraphicsGate.fromRequiredVersion(0)
        );
    }
}
