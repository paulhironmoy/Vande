package in.vande.cricket.unity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Small, fail-closed validation layer at the native boundary.
 *
 * <p>The TypeScript and C# protocol validators remain responsible for payload-specific validation and canonical JSON.
 * Android independently enforces the transport ceiling, checksum, protocol/simulation versions, identity fields and
 * direction before bytes are allowed to cross the WebView/Unity boundary. This prevents either runtime from using the
 * native bridge as an unchecked, unbounded message pipe.
 */
final class UnityPracticePacketValidator {
    static final int CONTRACT_VERSION = 7;
    static final int SIM_VERSION = 3;
    static final int MAX_BODY_BYTES = 1024 * 1024;
    /** JSON string escaping can approach 2x the canonical body; the extra 4 KiB covers the checksum/envelope. */
    static final int MAX_OUTER_PACKET_BYTES = (MAX_BODY_BYTES * 2) + (4 * 1024);
    static final int MAX_OPERATION_ID_CHARS = 128;

    private static final long MAX_SAFE_JSON_INTEGER = 9_007_199_254_740_991L;
    private static final int MAX_BUILD_ID_CHARS = 256;
    private static final int MAX_ID_CHARS = 256;
    private static final Pattern SHA_256 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern OPERATION_ID = Pattern.compile("[A-Za-z0-9._+-]{1," + MAX_OPERATION_ID_CHARS + "}");

    private static final Set<String> HOST_TYPES = unmodifiableSet(
        "host.initialize",
        "host.clock_sync",
        "host.clock_selected",
        "host.locale",
        "host.scene",
        "host.delivery",
        "host.provisional_swing",
        "host.result",
        "host.dead_ball_ui",
        "host.replay",
        "host.demonstration",
        "host.demonstration_cancel",
        "host.profile",
        "host.benchmark",
        "host.pause",
        "host.resume",
        "host.dispose"
    );

    private static final Set<String> UNITY_TYPES = unmodifiableSet(
        "unity.ready",
        "unity.clock_sync",
        "unity.release",
        "unity.pointer",
        "unity.gesture",
        "unity.dead",
        "unity.stats",
        "unity.benchmark",
        "unity.pause_request",
        "unity.dead_ball_action",
        "unity.protected_regions",
        "unity.quiet",
        "unity.unloaded",
        "unity.error"
    );

    private static final Set<String> DELIVERY_TYPES = unmodifiableSet(
        "host.delivery",
        "host.provisional_swing",
        "host.result",
        "host.dead_ball_ui",
        "host.replay",
        "host.demonstration",
        "host.demonstration_cancel",
        "unity.release",
        "unity.pointer",
        "unity.gesture",
        "unity.dead",
        "unity.dead_ball_action",
        "unity.protected_regions"
    );

    enum Direction {
        HOST("host"),
        UNITY("unity");

        final String sender;

        Direction(String sender) {
            this.sender = sender;
        }
    }

    static final class ValidatedPacket {
        final String packet;
        final String buildId;
        final String sessionId;
        final String deliveryId;
        final String messageId;
        final long sequence;
        final String sender;
        final String type;
        final JSONObject payload;

        private ValidatedPacket(
            String packet,
            String buildId,
            String sessionId,
            String deliveryId,
            String messageId,
            long sequence,
            String sender,
            String type,
            JSONObject payload
        ) {
            this.packet = packet;
            this.buildId = buildId;
            this.sessionId = sessionId;
            this.deliveryId = deliveryId;
            this.messageId = messageId;
            this.sequence = sequence;
            this.sender = sender;
            this.type = type;
            this.payload = payload;
        }
    }

    static final class ValidationException extends Exception {
        final String code;

        ValidationException(String code, String detail) {
            super(detail);
            this.code = code;
        }
    }

    private UnityPracticePacketValidator() {}

    static boolean validOperationId(String value) {
        return value != null && OPERATION_ID.matcher(value).matches();
    }

    static ValidatedPacket validate(String packet, Direction expectedDirection) throws ValidationException {
        if (packet == null) throw invalid("Packet is required.");
        byte[] outerBytes = packet.getBytes(StandardCharsets.UTF_8);
        if (outerBytes.length > MAX_OUTER_PACKET_BYTES) {
            throw invalid("Outer packet exceeds the native bridge limit.");
        }

        final JSONObject outer;
        final String body;
        final String claimedSha;
        try {
            outer = new JSONObject(packet);
            if (outer.length() != 2 || !outer.has("body") || !outer.has("sha256")) {
                throw invalid("Outer packet must contain only body and sha256.");
            }
            Object rawBody = outer.get("body");
            Object rawSha = outer.get("sha256");
            if (!(rawBody instanceof String) || !(rawSha instanceof String)) {
                throw invalid("Outer packet body and sha256 must be strings.");
            }
            body = (String) rawBody;
            claimedSha = (String) rawSha;
        } catch (ValidationException error) {
            throw error;
        } catch (JSONException error) {
            throw invalid("Outer packet is not valid JSON.");
        }

        byte[] bodyBytes = body.getBytes(StandardCharsets.UTF_8);
        if (bodyBytes.length > MAX_BODY_BYTES) throw invalid("Packet body exceeds the 1 MiB native bridge limit.");
        if (!SHA_256.matcher(claimedSha).matches()) throw integrity("Packet checksum is not lower-case SHA-256.");
        byte[] claimedBytes = hexBytes(claimedSha);
        if (!MessageDigest.isEqual(sha256(bodyBytes), claimedBytes)) throw integrity("Packet checksum does not match its body.");

        final JSONObject message;
        try {
            message = new JSONObject(body);
        } catch (JSONException error) {
            throw invalid("Packet body is not valid JSON.");
        }

        if (message.length() != 10 ||
            !message.has("contractVersion") ||
            !message.has("simVersion") ||
            !message.has("buildId") ||
            !message.has("sessionId") ||
            !message.has("deliveryId") ||
            !message.has("messageId") ||
            !message.has("sequence") ||
            !message.has("sender") ||
            !message.has("type") ||
            !message.has("payload")) {
            throw invalid("Packet body is not one exact protocol envelope.");
        }

        int contractVersion = exactInt(message, "contractVersion");
        if (contractVersion != CONTRACT_VERSION) {
            throw new ValidationException("contract_version", "Unsupported Unity Practice contract version.");
        }
        int simVersion = exactInt(message, "simVersion");
        if (simVersion != SIM_VERSION) {
            throw new ValidationException("simulation_version", "Unsupported Practice simulation version.");
        }

        try {
            String buildId = boundedString(message, "buildId", MAX_BUILD_ID_CHARS);
            String sessionId = boundedString(message, "sessionId", MAX_ID_CHARS);
            String messageId = boundedString(message, "messageId", MAX_ID_CHARS);
            String sender = boundedString(message, "sender", 5);
            String type = boundedString(message, "type", 64);
            long sequence = safeInteger(message, "sequence");
            JSONObject payload = message.getJSONObject("payload");

            if (!expectedDirection.sender.equals(sender)) {
                throw invalid("Packet sender does not match its native bridge direction.");
            }
            if (!("bridge.ack".equals(type) || typesFor(expectedDirection).contains(type))) {
                throw invalid("Packet type does not match its sender.");
            }

            String deliveryId = null;
            if (!message.isNull("deliveryId")) deliveryId = boundedString(message, "deliveryId", MAX_ID_CHARS);
            if (DELIVERY_TYPES.contains(type) && deliveryId == null) {
                throw invalid("Delivery-scoped packet is missing deliveryId.");
            }
            return new ValidatedPacket(packet, buildId, sessionId, deliveryId, messageId, sequence, sender, type, payload);
        } catch (ValidationException error) {
            throw error;
        } catch (JSONException error) {
            throw invalid("Packet envelope contains an invalid field.");
        }
    }

    private static Set<String> typesFor(Direction direction) {
        return direction == Direction.HOST ? HOST_TYPES : UNITY_TYPES;
    }

    private static int exactInt(JSONObject object, String key) throws ValidationException {
        long value = safeInteger(object, key);
        if (value > Integer.MAX_VALUE) throw invalid(key + " is outside the supported range.");
        return (int) value;
    }

    private static long safeInteger(JSONObject object, String key) throws ValidationException {
        try {
            Object raw = object.get(key);
            if (!(raw instanceof Number)) throw invalid(key + " must be an integer.");
            if (raw instanceof Float || raw instanceof Double) throw invalid(key + " must use canonical integer syntax.");
            double number = ((Number) raw).doubleValue();
            if (!Double.isFinite(number) || number < 0 || number > MAX_SAFE_JSON_INTEGER || Math.rint(number) != number) {
                throw invalid(key + " must be a non-negative safe integer.");
            }
            return (long) number;
        } catch (ValidationException error) {
            throw error;
        } catch (JSONException error) {
            throw invalid(key + " is required.");
        }
    }

    private static String boundedString(JSONObject object, String key, int maxChars) throws ValidationException {
        try {
            Object raw = object.get(key);
            if (!(raw instanceof String)) throw invalid(key + " must be a string.");
            String value = (String) raw;
            if (value.isEmpty() || value.length() > maxChars || containsControlCharacter(value)) {
                throw invalid(key + " is empty, too long or contains a control character.");
            }
            return value;
        } catch (ValidationException error) {
            throw error;
        } catch (JSONException error) {
            throw invalid(key + " is required.");
        }
    }

    private static boolean containsControlCharacter(String value) {
        for (int index = 0; index < value.length(); index++) {
            if (Character.isISOControl(value.charAt(index))) return true;
        }
        return false;
    }

    private static byte[] sha256(byte[] value) throws ValidationException {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (NoSuchAlgorithmException impossibleOnAndroid) {
            throw new ValidationException("integrity", "SHA-256 is unavailable on this Android runtime.");
        }
    }

    private static byte[] hexBytes(String value) throws ValidationException {
        byte[] bytes = new byte[value.length() / 2];
        for (int index = 0; index < value.length(); index += 2) {
            int high = Character.digit(value.charAt(index), 16);
            int low = Character.digit(value.charAt(index + 1), 16);
            if (high < 0 || low < 0) throw integrity("Packet checksum is not valid hexadecimal.");
            bytes[index / 2] = (byte) ((high << 4) | low);
        }
        return bytes;
    }

    private static ValidationException invalid(String detail) {
        return new ValidationException("invalid_message", detail);
    }

    private static ValidationException integrity(String detail) {
        return new ValidationException("integrity", detail);
    }

    private static Set<String> unmodifiableSet(String... values) {
        return Collections.unmodifiableSet(new HashSet<>(Arrays.asList(values)));
    }
}
