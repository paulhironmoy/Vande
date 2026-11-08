package in.vande.cricket.plugins;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.regex.Pattern;

/** Pure validation and encoding helpers for the read-only Gate A native epoch attestation. */
final class GateAEvidenceCore {
    static final String STATE_BINDING_DOMAIN = "VANDE_GATE_A_STATE_V1";
    static final String LIMITATION =
        "LOCAL_NON_ROOT_ENGINEERING_EPOCH_NOT_PROOF_AGAINST_ROOT_KERNEL_HOST_OR_MALICIOUS_APP";

    private static final BigInteger BILLION = BigInteger.valueOf(1_000_000_000L);
    private static final BigInteger MAX_UNSIGNED_LONG = new BigInteger("18446744073709551615");
    private static final Pattern LOWER_SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern LOWER_UUID = Pattern.compile(
        "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    );
    private static final Pattern SIGNED_DECIMAL = Pattern.compile("-?[0-9]+");

    private GateAEvidenceCore() {}

    static String requireStateSha256(String candidate) {
        if (candidate == null || !LOWER_SHA256.matcher(candidate).matches()) {
            throw new IllegalArgumentException("stateSha256 must be exactly 64 lowercase hexadecimal characters");
        }
        return candidate;
    }

    static String randomNonce(SecureRandom random) {
        if (random == null) throw new IllegalArgumentException("secure random source is required");
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return lowerHex(bytes);
    }

    static String stateBindingSha256(String bridgeNonce, String stateSha256) {
        String nonce = requireLowerSha256("bridgeNonce", bridgeNonce);
        String state = requireStateSha256(stateSha256);
        String message = STATE_BINDING_DOMAIN + '\0' + nonce + '\0' + state;
        try {
            return lowerHex(MessageDigest.getInstance("SHA-256").digest(message.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    static String parseProcessStartTicks(String procStat, int expectedPid) {
        if (procStat == null || expectedPid <= 0) {
            throw new IllegalArgumentException("process stat and positive pid are required");
        }

        String record = procStat.trim();
        int open = record.indexOf('(');
        int close = record.lastIndexOf(')');
        if (open <= 0 || close <= open || close + 2 >= record.length() || record.charAt(close + 1) != ' ') {
            throw new IllegalArgumentException("malformed /proc/self/stat framing");
        }

        String pidText = record.substring(0, open).trim();
        if (!pidText.matches("[0-9]+")) {
            throw new IllegalArgumentException("malformed /proc/self/stat pid");
        }
        BigInteger parsedPid = new BigInteger(pidText);
        if (!parsedPid.equals(BigInteger.valueOf(expectedPid))) {
            throw new IllegalArgumentException("/proc/self/stat pid does not match the running process");
        }

        String suffix = record.substring(close + 2).trim();
        String[] fields = suffix.split("\\s+");
        // suffix[0] is field 3 (state), so suffix[19] is field 22 (starttime).
        if (fields.length < 20 || !fields[0].matches("[A-Za-z]")) {
            throw new IllegalArgumentException("malformed /proc/self/stat field sequence");
        }
        for (int index = 1; index <= 19; index += 1) {
            if (!SIGNED_DECIMAL.matcher(fields[index]).matches()) {
                throw new IllegalArgumentException("malformed /proc/self/stat numeric field");
            }
        }

        BigInteger startTicks = new BigInteger(fields[19]);
        if (startTicks.signum() <= 0 || startTicks.compareTo(MAX_UNSIGNED_LONG) > 0) {
            throw new IllegalArgumentException("process start ticks must be positive");
        }
        return startTicks.toString();
    }

    static String requireBootId(String candidate) {
        if (candidate == null) throw new IllegalArgumentException("boot id is required");
        String normalized = candidate.trim().toLowerCase(Locale.ROOT);
        if (!LOWER_UUID.matcher(normalized).matches()) {
            throw new IllegalArgumentException("boot id must be a canonical UUID");
        }
        return normalized;
    }

    static String nanoseconds(long seconds, long nanos) {
        if (nanos < 0 || nanos >= 1_000_000_000L) {
            throw new IllegalArgumentException("timespec nanoseconds are out of range");
        }
        return BigInteger.valueOf(seconds).multiply(BILLION).add(BigInteger.valueOf(nanos)).toString();
    }

    static String unsignedLong(long value) {
        return Long.toUnsignedString(value);
    }

    static String decodeUtf8Strict(byte[] bytes) {
        if (bytes == null) throw new IllegalArgumentException("evidence bytes are required");
        try {
            return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException malformed) {
            throw new IllegalArgumentException("evidence is not valid UTF-8", malformed);
        }
    }

    private static String requireLowerSha256(String label, String candidate) {
        if (candidate == null || !LOWER_SHA256.matcher(candidate).matches()) {
            throw new IllegalArgumentException(label + " must be exactly 64 lowercase hexadecimal characters");
        }
        return candidate;
    }

    private static String lowerHex(byte[] bytes) {
        char[] encoded = new char[bytes.length * 2];
        char[] alphabet = "0123456789abcdef".toCharArray();
        for (int index = 0; index < bytes.length; index += 1) {
            int value = bytes[index] & 0xff;
            encoded[index * 2] = alphabet[value >>> 4];
            encoded[index * 2 + 1] = alphabet[value & 0x0f];
        }
        return new String(encoded);
    }
}
