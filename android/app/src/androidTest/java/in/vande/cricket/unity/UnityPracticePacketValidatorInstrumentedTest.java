package in.vande.cricket.unity;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Device-side tests because the local JVM android.jar contains only throwing org.json stubs. */
@RunWith(AndroidJUnit4.class)
public final class UnityPracticePacketValidatorInstrumentedTest {
    private static final int CONTRACT_VERSION = UnityPracticePacketValidator.CONTRACT_VERSION;
    private static final int SIM_VERSION = UnityPracticePacketValidator.SIM_VERSION;

    @Test
    public void acceptsChecksummedHostInitialize() throws Exception {
        String packet = packet(body("host", "host.initialize", JSONObject.NULL, 0, CONTRACT_VERSION, SIM_VERSION));

        UnityPracticePacketValidator.ValidatedPacket validated = UnityPracticePacketValidator.validate(
            packet,
            UnityPracticePacketValidator.Direction.HOST
        );

        assertEquals("host.initialize", validated.type);
        assertEquals("build", validated.buildId);
        assertEquals("session", validated.sessionId);
    }

    @Test
    public void acceptsDeliveryScopedUnityPointer() throws Exception {
        String packet = packet(body("unity", "unity.pointer", "delivery", 1, CONTRACT_VERSION, SIM_VERSION));

        UnityPracticePacketValidator.ValidatedPacket validated = UnityPracticePacketValidator.validate(
            packet,
            UnityPracticePacketValidator.Direction.UNITY
        );

        assertEquals("unity.pointer", validated.type);
        assertEquals("delivery", validated.deliveryId);
    }

    @Test
    public void acceptsSessionScopedBenchmarkAndPauseTypesInTheirOnlyValidDirections() throws Exception {
        assertEquals("host.benchmark", UnityPracticePacketValidator.validate(
            packet(body("host", "host.benchmark", JSONObject.NULL, 2, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ).type);
        assertEquals("unity.benchmark", UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.benchmark", JSONObject.NULL, 2, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ).type);
        assertEquals("unity.pause_request", UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.pause_request", JSONObject.NULL, 3, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ).type);
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.pause_request", JSONObject.NULL, 4, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void rejectsWrongDirectionBeforeForwarding() throws Exception {
        String packet = packet(body("unity", "unity.ready", JSONObject.NULL, 0, CONTRACT_VERSION, SIM_VERSION));
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet,
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void rejectsChecksumMismatch() throws Exception {
        JSONObject outer = new JSONObject();
        outer.put("body", body("host", "host.initialize", JSONObject.NULL, 0, CONTRACT_VERSION, SIM_VERSION));
        outer.put("sha256", repeat('0', 64));
        expectCode("integrity", () -> UnityPracticePacketValidator.validate(
            outer.toString(),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void rejectsContractAndSimulationVersionMismatch() throws Exception {
        expectCode("contract_version", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "host.initialize", JSONObject.NULL, 0, CONTRACT_VERSION - 1, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
        expectCode("contract_version", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "host.initialize", JSONObject.NULL, 0, CONTRACT_VERSION + 5, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
        expectCode("simulation_version", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "host.initialize", JSONObject.NULL, 0, CONTRACT_VERSION, SIM_VERSION + 6)),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void deadBallUiAndActionsAreDeliveryScopedAndDirectional() throws Exception {
        assertEquals("host.dead_ball_ui", UnityPracticePacketValidator.validate(
            packet(body("host", "host.dead_ball_ui", "delivery", 5, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ).type);
        assertEquals("unity.dead_ball_action", UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.dead_ball_action", "delivery", 6, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ).type);
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "host.dead_ball_ui", JSONObject.NULL, 7, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.dead_ball_action", "delivery", 8, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void contractV7DemonstrationsAreHostToUnityAndDeliveryScoped() throws Exception {
        assertEquals(7, CONTRACT_VERSION);
        assertEquals("host.demonstration", UnityPracticePacketValidator.validate(
            packet(body("host", "host.demonstration", "delivery", 20, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ).type);
        assertEquals("host.demonstration_cancel", UnityPracticePacketValidator.validate(
            packet(body("host", "host.demonstration_cancel", "delivery", 21, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ).type);
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "host.demonstration", JSONObject.NULL, 22, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("unity", "host.demonstration", "delivery", 23, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ));
    }

    @Test
    public void protectedRegionsAreUnityToHostAndDeliveryScoped() throws Exception {
        assertEquals("unity.protected_regions", UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.protected_regions", "delivery", 9, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ).type);
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("unity", "unity.protected_regions", JSONObject.NULL, 10, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ));
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("host", "unity.protected_regions", "delivery", 11, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void acceptsLocaleOnlyFromHost() throws Exception {
        assertEquals("host.locale", UnityPracticePacketValidator.validate(
            packet(body("host", "host.locale", JSONObject.NULL, 12, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.HOST
        ).type);
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            packet(body("unity", "host.locale", JSONObject.NULL, 13, CONTRACT_VERSION, SIM_VERSION)),
            UnityPracticePacketValidator.Direction.UNITY
        ));
    }

    @Test
    public void rejectsBodyBeforeHashingWhenOverOneMiB() throws Exception {
        String tooLarge = repeat('x', UnityPracticePacketValidator.MAX_BODY_BYTES + 1);
        JSONObject outer = new JSONObject();
        outer.put("body", tooLarge);
        outer.put("sha256", repeat('0', 64));
        expectCode("invalid_message", () -> UnityPracticePacketValidator.validate(
            outer.toString(),
            UnityPracticePacketValidator.Direction.HOST
        ));
    }

    @Test
    public void operationIdsAreBoundedAndCharacterRestricted() {
        assertTrue(UnityPracticePacketValidator.validOperationId("unity-1234.ab_cd+ef"));
        assertTrue(!UnityPracticePacketValidator.validOperationId("contains a space"));
        assertTrue(!UnityPracticePacketValidator.validOperationId(repeat('x', 129)));
    }

    private static String body(
        String sender,
        String type,
        Object deliveryId,
        long sequence,
        int contractVersion,
        int simVersion
    ) throws Exception {
        JSONObject value = new JSONObject();
        value.put("contractVersion", contractVersion);
        value.put("simVersion", simVersion);
        value.put("buildId", "build");
        value.put("sessionId", "session");
        value.put("deliveryId", deliveryId);
        value.put("messageId", "message-" + sequence);
        value.put("sequence", sequence);
        value.put("sender", sender);
        value.put("type", type);
        value.put("payload", new JSONObject());
        return value.toString();
    }

    private static String packet(String body) throws Exception {
        JSONObject packet = new JSONObject();
        packet.put("body", body);
        packet.put("sha256", hex(MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8))));
        return packet.toString();
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format("%02x", item & 0xff));
        return value.toString();
    }

    private static String repeat(char value, int count) {
        char[] characters = new char[count];
        java.util.Arrays.fill(characters, value);
        return new String(characters);
    }

    private static void expectCode(String code, ThrowingRunnable action) throws Exception {
        try {
            action.run();
            fail("Expected validation failure " + code);
        } catch (UnityPracticePacketValidator.ValidationException error) {
            assertEquals(code, error.code);
        }
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }
}
