package in.vande.cricket.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import org.junit.Test;

public final class GateAEvidenceCoreTest {
    private static final String ZERO_NONCE = "00".repeat(32);
    private static final String STATE_SHA256 = "ab".repeat(32);

    @Test
    public void parsesField22WhenProcessNameContainsSpacesAndClosingParentheses() {
        String stat =
            "321 (vande ) worker) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654321 20 21";
        assertEquals("987654321", GateAEvidenceCore.parseProcessStartTicks(stat, 321));
    }

    @Test
    public void processStatParsingFailsClosedOnPidFieldAndStartTimeAttacks() {
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "322 (vande) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 22",
                321
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks("321 (vande) S 1 2 3", 321)
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "321 (vande) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 0",
                321
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "321 (vande) S 1 2 3 4 5 6 7 8 9 10 11 12 x 14 15 16 17 18 22",
                321
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "321 (vande)S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 22",
                321
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "321 (vande) Ø 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 22",
                321
            )
        );
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.parseProcessStartTicks(
                "321 (vande) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 18446744073709551616",
                321
            )
        );
    }

    @Test
    public void stateDigestAndBootIdRequireCanonicalShapes() {
        assertEquals(STATE_SHA256, GateAEvidenceCore.requireStateSha256(STATE_SHA256));
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.requireStateSha256(STATE_SHA256.toUpperCase())
        );
        assertThrows(IllegalArgumentException.class, () -> GateAEvidenceCore.requireStateSha256("ab"));
        assertEquals(
            "123e4567-e89b-42d3-a456-426614174000",
            GateAEvidenceCore.requireBootId(" 123E4567-E89B-42D3-A456-426614174000\n")
        );
        assertThrows(IllegalArgumentException.class, () -> GateAEvidenceCore.requireBootId("not-a-boot-id"));
    }

    @Test
    public void stateBindingUsesTheFrozenDomainAndNulSeparators() {
        assertEquals(
            "912480c58efee5d224ab71af1964bd8bd74611ba4118cffac02331808f4e9942",
            GateAEvidenceCore.stateBindingSha256(ZERO_NONCE, STATE_SHA256)
        );
    }

    @Test
    public void nonceIsExactly256BitsOfLowercaseHex() {
        SecureRandom fixed = new SecureRandom() {
            @Override
            public void nextBytes(byte[] bytes) {
                for (int index = 0; index < bytes.length; index += 1) bytes[index] = (byte) index;
            }
        };
        String nonce = GateAEvidenceCore.randomNonce(fixed);
        assertEquals("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", nonce);
        assertNotEquals(ZERO_NONCE, nonce);
    }

    @Test
    public void nanosecondConversionDoesNotOverflowLongAndRejectsBadTimespecs() {
        assertEquals("9223372036854775807999999999", GateAEvidenceCore.nanoseconds(Long.MAX_VALUE, 999_999_999L));
        assertEquals("-1000000001", GateAEvidenceCore.nanoseconds(-2L, 999_999_999L));
        assertThrows(IllegalArgumentException.class, () -> GateAEvidenceCore.nanoseconds(1L, -1L));
        assertThrows(IllegalArgumentException.class, () -> GateAEvidenceCore.nanoseconds(1L, 1_000_000_000L));
    }

    @Test
    public void strictUtf8RejectsMalformedEvidence() {
        assertEquals("evidence", GateAEvidenceCore.decodeUtf8Strict("evidence".getBytes(StandardCharsets.UTF_8)));
        assertThrows(
            IllegalArgumentException.class,
            () -> GateAEvidenceCore.decodeUtf8Strict(new byte[] { (byte) 0xc3, (byte) 0x28 })
        );
    }

    @Test
    public void unsignedIdentityFieldsRemainDecimalStrings() {
        assertEquals("18446744073709551615", GateAEvidenceCore.unsignedLong(-1L));
        assertTrue(GateAEvidenceCore.LIMITATION.startsWith("LOCAL_NON_ROOT_ENGINEERING_EPOCH_"));
    }
}
