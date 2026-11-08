using System;
using System.Collections.Generic;
using System.Text;

namespace Vande.Practice.Bridge
{
    public static class BridgeValidator
    {
        private static readonly HashSet<string> EnvelopeFields = new HashSet<string>(StringComparer.Ordinal)
        {
            "contractVersion", "simVersion", "buildId", "sessionId", "deliveryId",
            "messageId", "sequence", "sender", "type", "payload"
        };

        private static readonly HashSet<string> MessageTypes = new HashSet<string>(StringComparer.Ordinal)
        {
            "bridge.ack",
            "host.initialize", "host.scene", "host.delivery", "host.provisional_swing",
            "host.result", "host.dead_ball_ui", "host.replay", "host.demonstration", "host.demonstration_cancel",
            "host.profile", "host.locale", "host.clock_sync", "host.clock_selected",
            "host.pause", "host.resume", "host.benchmark", "host.dispose",
            "unity.ready", "unity.clock_sync", "unity.release", "unity.pointer", "unity.gesture", "unity.dead", "unity.stats",
            "unity.benchmark", "unity.pause_request", "unity.dead_ball_action", "unity.protected_regions",
            "unity.quiet", "unity.unloaded", "unity.error"
        };

        public static DecodedUnityPracticePacket ParseAndValidatePacket(string packetJson)
        {
            if (packetJson == null || packetJson.Length > BridgeConstants.MaxOuterPacketBytes ||
                Encoding.UTF8.GetByteCount(packetJson) > BridgeConstants.MaxOuterPacketBytes)
            {
                throw new BridgeValidationException("Packet byte length is invalid.");
            }

            string sha256, body;
            if (!OuterPacket.TryParse(packetJson, out sha256, out body))
            {
                // Not the plain {"sha256":..,"body":..} shape: the general reader accepts it (escaped keys, odd spacing) or
                // fails with the exact original error.
                var packetObject = StrictJsonObject.Parse(packetJson);
                Require(packetObject.Count == 2 && packetObject.Contains("sha256") && packetObject.Contains("body"),
                    "Packet must contain exactly body and sha256.");
                sha256 = packetObject.String("sha256");
                body = packetObject.String("body");
            }

            var packet = new UnityPracticePacket
            {
                sha256 = sha256,
                body = body
            };

            var bodyBytes = Encoding.UTF8.GetByteCount(packet.body);
            Require(bodyBytes <= BridgeConstants.MaxPacketBytes,
                "Packet body exceeds the local bridge limit.");
            Require(Sha256Digest.IsLowerHexSha256(packet.sha256),
                "Packet sha256 must be a lowercase SHA-256 digest.");
            Require(Sha256Digest.FixedTimeEqualsLowerHex(packet.sha256, Sha256Digest.OfUtf8(packet.body)),
                "Packet body failed its integrity check.");

            var envelope = ParseEnvelope(packet.body);
            return new DecodedUnityPracticePacket(packet, envelope);
        }

        public static UnityPracticeEnvelope ParseAndValidateEnvelope(string body)
        {
            if (body == null || Encoding.UTF8.GetByteCount(body) > BridgeConstants.MaxPacketBytes)
            {
                throw new BridgeValidationException("Envelope byte length is invalid.");
            }

            return ParseEnvelope(body);
        }

        private static UnityPracticeEnvelope ParseEnvelope(string body)
        {
            var source = StrictJsonObject.ParseCanonical(body);
            Require(source.Count == EnvelopeFields.Count, "Envelope has missing or unsupported fields.");
            foreach (var field in EnvelopeFields) Require(source.Contains(field), "Envelope is missing " + field + ".");

            var contractVersion = CheckedInteger(source.Integer("contractVersion"), "contractVersion");
            var simVersion = CheckedInteger(source.Integer("simVersion"), "simVersion");
            var envelope = new UnityPracticeEnvelope
            {
                contractVersion = contractVersion,
                simVersion = simVersion,
                buildId = source.String("buildId"),
                sessionId = source.String("sessionId"),
                deliveryId = source.String("deliveryId", true),
                messageId = source.String("messageId"),
                sequence = source.Integer("sequence"),
                sender = source.String("sender"),
                type = source.String("type"),
                payloadJson = source.Raw("payload")
            };

            // The body must be exactly the canonical framing of its own fields around the raw payload token. Compared in
            // three pieces (prefix, payload, suffix), which is string equality without building the 300 KB string.
            var prefix = "{\"buildId\":" + CanonicalJson.String(envelope.buildId) +
                         ",\"contractVersion\":" + envelope.contractVersion.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                         ",\"deliveryId\":" + CanonicalJson.String(envelope.deliveryId) +
                         ",\"messageId\":" + CanonicalJson.String(envelope.messageId) +
                         ",\"payload\":";
            var suffix = ",\"sender\":" + CanonicalJson.String(envelope.sender) +
                         ",\"sequence\":" + envelope.sequence.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                         ",\"sessionId\":" + CanonicalJson.String(envelope.sessionId) +
                         ",\"simVersion\":" + envelope.simVersion.ToString(System.Globalization.CultureInfo.InvariantCulture) +
                         ",\"type\":" + CanonicalJson.String(envelope.type) + "}";
            Require(body.Length == prefix.Length + envelope.payloadJson.Length + suffix.Length &&
                    string.CompareOrdinal(body, 0, prefix, 0, prefix.Length) == 0 &&
                    string.CompareOrdinal(body, prefix.Length, envelope.payloadJson, 0, envelope.payloadJson.Length) == 0 &&
                    string.CompareOrdinal(body, prefix.Length + envelope.payloadJson.Length, suffix, 0, suffix.Length) == 0,
                "Envelope body is not canonical JSON.");

            // The payload was scanned as part of the body: hand that scan to the validation below instead of scanning it again.
            StrictJsonObject payload;
            if (source.TryObject("payload", out payload)) envelope.AttachParsedPayload(payload);

            ValidateEnvelope(envelope);
            return envelope;
        }

        public static void ValidateEnvelope(UnityPracticeEnvelope envelope)
        {
            Require(envelope != null, "Envelope is required.");
            Require(envelope.contractVersion == BridgeConstants.ContractVersion,
                "Contract version is unsupported.");
            Require(envelope.simVersion == BridgeConstants.SimulationVersion,
                "Simulation version is unsupported.");
            ValidateRestrictedText(envelope.buildId, BridgeConstants.MaxBuildIdLength, "buildId");
            ValidateRestrictedText(envelope.sessionId, BridgeConstants.MaxIdentifierLength, "sessionId");
            if (envelope.deliveryId != null)
                ValidateRestrictedText(envelope.deliveryId, BridgeConstants.MaxIdentifierLength, "deliveryId");
            ValidateRestrictedText(envelope.messageId, BridgeConstants.MaxIdentifierLength, "messageId");
            Require(envelope.sequence >= 0 && envelope.sequence <= BridgeConstants.MaxJavaScriptSafeInteger,
                "sequence must be a non-negative JavaScript-safe integer.");
            Require(envelope.sender == "host" || envelope.sender == "unity", "sender is unsupported.");
            Require(MessageTypes.Contains(envelope.type), "Message type is unsupported.");
            Require(envelope.type == "bridge.ack" || envelope.type.StartsWith(envelope.sender + ".", StringComparison.Ordinal),
                "Message type does not match sender.");
            if (RequiresDeliveryId(envelope.type))
                Require(envelope.deliveryId != null, "deliveryId is required for this message type.");
            ValidatePayloadShape(envelope.type, envelope.ParsedPayload());
        }

        public static void ValidateRestrictedText(string value, int maximumLength, string fieldName)
        {
            Require(!string.IsNullOrEmpty(value) && value.Length <= maximumLength,
                fieldName + " is missing or too long.");
            for (var index = 0; index < value.Length; index++)
            {
                var character = value[index];
                Require(!char.IsControl(character), fieldName + " contains a control character.");
            }
        }

        private static void ValidateOptionalRestrictedText(string value, int maximumLength, string fieldName)
        {
            Require(value != null && value.Length <= maximumLength,
                fieldName + " is missing or too long.");
            for (var index = 0; index < value.Length; index++)
                Require(!char.IsControl(value[index]), fieldName + " contains a control character.");
        }

        private static void ValidatePayloadShape(string type, StrictJsonObject payload)
        {
            RequireExactPayloadFields(type, payload);
            switch (type)
            {
                case "bridge.ack":
                    NonEmpty(payload.String("acknowledgedMessageId"), "acknowledgedMessageId");
                    return;
                case "host.initialize":
                    ValidateRestrictedText(payload.String("locale"), 32, "locale");
                    Require(OneOf(payload.String("quality"), "lite", "standard", "high"),
                        "quality is unsupported.");
                    Require(OneOf(payload.String("deviceTier"), "full", "assisted", "below"),
                        "deviceTier is unsupported.");
                    Require(OneOf(payload.String("handedness"), "right", "left"),
                        "handedness is unsupported.");
                    Require(OneOf(payload.String("assistance"), "learn", "play", "real"),
                        "assistance is unsupported.");
                    payload.Boolean("reducedMotion");
                    payload.Boolean("captions");
                    payload.Boolean("audio");
                    payload.Boolean("haptics");
                    payload.Boolean("highContrast");
                    var textScale = payload.Number("textScale");
                    Require(textScale >= 1.0 && textScale <= 2.0,
                        "textScale is outside the supported range.");
                    var pixelsPerDp = payload.Number("pixelsPerDp");
                    Require(pixelsPerDp >= 1.0 && pixelsPerDp <= 8.0,
                        "pixelsPerDp is outside the supported range.");
                    Require(payload.String("coordinateSystem") == "vande-striker-frame-v1",
                        "coordinateSystem is unsupported.");
                    Require(payload.String("handednessPolicy") ==
                            "physics-right-handed-presentation-mirrors-once",
                        "handednessPolicy is unsupported.");
                    return;
                case "host.scene":
                    Require(OneOf(payload.String("conditions"), "balanced", "green", "hard", "turning"),
                        "conditions is unsupported.");
                    Require(OneOf(payload.String("fieldIntent"),
                            "attack_outside_off", "attack_the_stumps", "short_ball_trap",
                            "yorker_and_boundaries", "spin_close_catchers", "save_singles",
                            "protect_boundaries"),
                        "fieldIntent is unsupported.");
                    Require(OneOf(payload.String("trainingObjective"), "reference", "built", "random"),
                        "trainingObjective is unsupported.");
                    ValidateSceneObjects(payload);
                    Require(OneOf(payload.String("handedness"), "right", "left"),
                        "handedness is unsupported.");
                    {
                        var batterPosition = payload.Object("batterPosition");
                        RequireExactFields(batterPosition, "creaseOffsetM", "guard", "lateralM");
                        Require(Math.Abs(batterPosition.Number("lateralM")) <= 2.0,
                            "batterPosition.lateralM is outside the contract.");
                        Require(Math.Abs(batterPosition.Number("creaseOffsetM")) <= 3.0,
                            "batterPosition.creaseOffsetM is outside the contract.");
                        Require(OneOf(batterPosition.String("guard"), "leg", "middle", "off", "custom"),
                            "batterPosition.guard is unsupported.");
                    }
                    return;
                case "host.delivery":
                    ValidateDelivery(payload);
                    return;
                case "host.provisional_swing":
                    payload.Number("atPerfMs");
                    payload.Number("calibrationMs");
                    ValidateSwing(payload.Object("swing"));
                    return;
                case "host.result":
                    ValidateResolution(payload);
                    UnityPracticeReplayDigest.VerifyValidatedResolutionPayload(payload);
                    return;
                case "host.dead_ball_ui":
                    {
                        Require(Sha256Digest.IsLowerHexSha256(payload.String("replayDigest")),
                            "replayDigest is invalid.");
                        ValidateRestrictedText(payload.String("reason"), 160, "reason");
                        ValidateOptionalRestrictedText(payload.String("recommendation"), 160, "recommendation");
                        var primaryAction = payload.String("primaryAction");
                        Require(OneOf(primaryAction, "practice_ball", "next_ball"),
                            "primaryAction is unsupported.");
                        ValidateRestrictedText(payload.String("primaryLabel"), 64, "primaryLabel");
                        var secondaryAction = payload.String("secondaryAction", true);
                        var secondaryLabel = payload.String("secondaryLabel", true);
                        if (primaryAction == "practice_ball")
                        {
                            Require(secondaryAction == "next_ball",
                                "practice_ball requires next_ball as its secondary action.");
                            ValidateRestrictedText(secondaryLabel, 64, "secondaryLabel");
                        }
                        else
                        {
                            Require(secondaryAction == null && secondaryLabel == null,
                                "next_ball primary cannot include a secondary action.");
                        }
                    }
                    return;
                case "host.replay":
                    {
                        var replayResolution = payload.Object("resolution");
                        ValidateResolution(replayResolution);
                        UnityPracticeReplayDigest.VerifyValidatedResolutionPayload(replayResolution);
                        var replaySpeed = payload.Number("speed");
                        Require(replaySpeed > 0.0 && replaySpeed <= 4.0,
                            "Replay speed is outside the contract.");
                    }
                    payload.Boolean("diagnostics");
                    return;
                case "host.demonstration":
                    {
                        var demonstrationDelivery = payload.Object("delivery");
                        var demonstrationResolution = payload.Object("resolution");
                        ValidateDelivery(demonstrationDelivery);
                        ValidateResolution(demonstrationResolution);
                        UnityPracticeReplayDigest.VerifyValidatedResolutionPayload(demonstrationResolution);
                        var demonstrationSpeed = payload.Number("speed");
                        Require(demonstrationSpeed > 0.0 && demonstrationSpeed <= 4.0,
                            "Demonstration speed is outside the contract.");
                    }
                    return;
                case "host.demonstration_cancel":
                    return;
                case "host.profile":
                    Require(OneOf(payload.String("quality"), "lite", "standard", "high"),
                        "quality is unsupported.");
                    return;
                case "host.locale":
                    ValidateRestrictedText(payload.String("locale"), 32, "locale");
                    return;
                case "host.benchmark":
                    {
                        ValidateRestrictedText(payload.String("benchmarkId"),
                            BridgeConstants.MaxIdentifierLength, "benchmarkId");
                        var durationMs = payload.Number("durationMs");
                        var warmupFrames = payload.Integer("warmupFrames");
                        var sampleCap = payload.Integer("sampleCap");
                        Require(durationMs >= 1000.0 && durationMs <= BridgeConstants.MaxBenchmarkDurationMs,
                            "Benchmark duration is outside the contract.");
                        Require(warmupFrames >= 0 && warmupFrames <= BridgeConstants.MaxBenchmarkWarmupFrames,
                            "Benchmark warmupFrames is outside the contract.");
                        Require(sampleCap >= 2 && sampleCap <= BridgeConstants.MaxBenchmarkIntervals,
                            "Benchmark sampleCap is outside the contract.");
                        Require(OneOf(payload.String("quality"), "lite", "standard", "high"),
                            "Benchmark quality is unsupported.");
                    }
                    return;
                case "host.clock_sync":
                    NonEmpty(payload.String("sampleId"), "sampleId");
                    payload.Number("hostSendPerfMs");
                    return;
                case "host.clock_selected":
                    NonEmpty(payload.String("sampleId"), "sampleId");
                    return;
                case "host.pause":
                    Require(OneOf(payload.String("reason"), "player", "background", "interruption"),
                        "pause reason is unsupported.");
                    return;
                case "host.resume":
                    Require(OneOf(payload.String("reason"), "player", "foreground", "recreated"),
                        "resume reason is unsupported.");
                    return;
                case "host.dispose":
                    Require(OneOf(payload.String("reason"), "complete", "cancelled", "fallback", "error"),
                        "dispose reason is unsupported.");
                    return;
                case "unity.ready":
                    NonEmpty(payload.String("renderer"), "renderer");
                    NonEmpty(payload.String("unityVersion"), "unityVersion");
                    return;
                case "unity.clock_sync":
                    NonEmpty(payload.String("sampleId"), "sampleId");
                    payload.Number("hostSendPerfMs");
                    payload.Number("unityReceiveMs");
                    Require(payload.Number("unitySendMs") >= payload.Number("unityReceiveMs"),
                        "unitySendMs precedes unityReceiveMs.");
                    return;
                case "unity.release":
                    payload.Number("releaseUnityMs");
                    NonEmpty(payload.String("clockSampleId"), "clockSampleId");
                    return;
                case "unity.pointer":
                    Require(OneOf(payload.String("phase"), "down", "cancel"),
                        "pointer phase is unsupported.");
                    payload.Number("atUnityMs");
                    NonEmpty(payload.String("clockSampleId"), "clockSampleId");
                    Require(OneOf(payload.String("pointer"), "touch", "mouse", "pen", "keyboard"),
                        "pointer type is unsupported.");
                    return;
                case "unity.gesture":
                    Require(payload.String("retention") == "memory-until-resolution",
                        "Gesture retention policy is unsupported.");
                    NonEmpty(payload.String("clockSampleId"), "clockSampleId");
                    ValidateGesture(payload.Object("input"));
                    return;
                case "unity.dead":
                    payload.Number("deadT");
                    Require(Sha256Digest.IsLowerHexSha256(payload.String("replayDigest")),
                        "replayDigest is invalid.");
                    return;
                case "unity.stats":
                    Require(OneOf(payload.String("quality"), "lite", "standard", "high"),
                        "quality is unsupported.");
                    var sampleCount = payload.Integer("sampleCount");
                    var spikes = payload.Integer("spikes");
                    RequireSafeInteger(sampleCount, "stats sampleCount");
                    RequireSafeInteger(spikes, "stats spikes");
                    Require(sampleCount <= BridgeConstants.MaxBenchmarkIntervals,
                        "stats sampleCount exceeds the contract.");
                    Require(spikes <= sampleCount, "stats spikes exceed sampleCount.");
                    payload.Number("fps");
                    payload.Number("avgFrameMs");
                    payload.Number("p95FrameMs");
                    payload.Number("p99FrameMs");
                    payload.Number("worstFrameMs");
                    if (!payload.IsNull("inputToVisibleBatMs")) payload.Number("inputToVisibleBatMs");
                    if (!payload.IsNull("memoryMb")) payload.Number("memoryMb");
                    Require(OneOf(payload.String("thermalState"), "unknown", "nominal", "fair", "serious", "critical"),
                        "thermalState is unsupported.");
                    return;
                case "unity.benchmark":
                    {
                        ValidateRestrictedText(payload.String("benchmarkId"),
                            BridgeConstants.MaxIdentifierLength, "benchmarkId");
                        var intervals = payload.NumberArray(
                            "frameIntervalsMs", BridgeConstants.MaxBenchmarkIntervals);
                        Require(intervals.Length >= 1, "Benchmark requires at least one frame interval.");
                        for (var index = 0; index < intervals.Length; index++)
                            Require(intervals[index] > 0.0 && intervals[index] <= 10_000.0,
                                "Benchmark frame interval is outside the contract.");
                        Require(OneOf(payload.String("quality"), "lite", "standard", "high"),
                            "Benchmark quality is unsupported.");
                        if (!payload.IsNull("memoryMb"))
                            Require(payload.Number("memoryMb") >= 0.0, "Benchmark memoryMb is invalid.");
                        Require(OneOf(payload.String("thermalState"),
                                "unknown", "nominal", "fair", "serious", "critical"),
                            "Benchmark thermalState is unsupported.");

                        var warmup = payload.Object("warmup");
                        RequireExactFields(warmup, "durationMs", "frames", "shaderWarmupCompleted",
                            "shaderWarmupMs");
                        Require(warmup.Number("durationMs") >= 0.0, "Benchmark warmup duration is invalid.");
                        var measuredWarmupFrames = warmup.Integer("frames");
                        RequireSafeInteger(measuredWarmupFrames, "benchmark warmup frames");
                        Require(measuredWarmupFrames <= BridgeConstants.MaxBenchmarkWarmupFrames,
                            "Benchmark warmup frames exceed the contract.");
                        warmup.Boolean("shaderWarmupCompleted");
                        if (!warmup.IsNull("shaderWarmupMs"))
                            Require(warmup.Number("shaderWarmupMs") >= 0.0,
                                "Benchmark shader warmup duration is invalid.");

                        var graphics = payload.Object("graphics");
                        RequireExactFields(graphics, "api", "contextGeneration", "contextLosses", "device");
                        NonEmpty(graphics.String("api"), "graphics.api");
                        NonEmpty(graphics.String("device"), "graphics.device");
                        if (!graphics.IsNull("contextGeneration"))
                            RequireSafeInteger(graphics.Integer("contextGeneration"), "contextGeneration");
                        if (!graphics.IsNull("contextLosses"))
                            RequireSafeInteger(graphics.Integer("contextLosses"), "contextLosses");
                    }
                    return;
                case "unity.quiet":
                    payload.Boolean("quiet");
                    return;
                case "unity.pause_request":
                    Require(payload.String("reason") == "player", "Pause request reason is unsupported.");
                    return;
                case "unity.dead_ball_action":
                    Require(OneOf(payload.String("action"), "practice_ball", "next_ball"),
                        "Dead-ball action is unsupported.");
                    Require(Sha256Digest.IsLowerHexSha256(payload.String("replayDigest")),
                        "replayDigest is invalid.");
                    return;
                case "unity.protected_regions":
                    ValidateProtectedRegions(payload);
                    return;
                case "unity.unloaded":
                    if (!payload.IsNull("retainedMemoryMb")) payload.Number("retainedMemoryMb");
                    return;
                case "unity.error":
                    Require(OneOf(payload.String("code"), "contract_version", "simulation_version", "integrity",
                            "invalid_message", "out_of_order", "timeout", "unity_unavailable", "unity_load_failed",
                            "unity_runtime", "lifecycle", "low_memory"),
                        "error code is unsupported.");
                    payload.Boolean("recoverable");
                    NonEmpty(payload.String("detail"), "detail");
                    Require(OneOf(payload.String("fallback"), "three", "classic", "return_to_practice"),
                        "error fallback is unsupported.");
                    return;
                default:
                    throw new BridgeValidationException("Message type is unsupported.");
            }
        }

        private static void RequireExactPayloadFields(string type, StrictJsonObject payload)
        {
            switch (type)
            {
                case "bridge.ack":
                    RequireExactFields(payload, "acknowledgedMessageId"); return;
                case "host.initialize":
                    RequireExactFields(payload, "assistance", "audio", "captions", "coordinateSystem",
                        "deviceTier", "handedness", "handednessPolicy", "haptics", "highContrast", "locale",
                        "pixelsPerDp", "quality", "reducedMotion", "textScale"); return;
                case "host.clock_sync":
                    RequireExactFields(payload, "hostSendPerfMs", "sampleId"); return;
                case "host.clock_selected":
                    RequireExactFields(payload, "sampleId"); return;
                case "host.scene":
                    RequireExactFields(payload, "ball", "batterPosition", "bowler", "conditions", "field",
                        "fieldIntent", "handedness", "trainingObjective"); return;
                case "host.delivery":
                    RequireExactFields(payload, "ballIndex", "flight", "overIndex", "plan",
                        "presentation", "seed"); return;
                case "host.provisional_swing":
                    RequireExactFields(payload, "atPerfMs", "calibrationMs", "swing"); return;
                case "host.result":
                    RequireExactFields(payload, "record", "replayDigest", "result", "score"); return;
                case "host.dead_ball_ui":
                    RequireExactFields(payload, "primaryAction", "primaryLabel", "reason", "recommendation",
                        "replayDigest", "secondaryAction", "secondaryLabel"); return;
                case "host.replay":
                    RequireExactFields(payload, "diagnostics", "resolution", "speed"); return;
                case "host.demonstration":
                    RequireExactFields(payload, "delivery", "resolution", "speed"); return;
                case "host.demonstration_cancel":
                    RequireExactFields(payload); return;
                case "host.profile":
                    RequireExactFields(payload, "quality"); return;
                case "host.locale":
                    RequireExactFields(payload, "locale"); return;
                case "host.benchmark":
                    RequireExactFields(payload, "benchmarkId", "durationMs", "quality", "sampleCap",
                        "warmupFrames"); return;
                case "host.pause":
                case "host.resume":
                case "host.dispose":
                    RequireExactFields(payload, "reason"); return;
                case "unity.ready":
                    RequireExactFields(payload, "renderer", "unityVersion"); return;
                case "unity.clock_sync":
                    RequireExactFields(payload, "hostSendPerfMs", "sampleId", "unityReceiveMs", "unitySendMs");
                    return;
                case "unity.release":
                    RequireExactFields(payload, "clockSampleId", "releaseUnityMs"); return;
                case "unity.pointer":
                    RequireExactFields(payload, "atUnityMs", "clockSampleId", "phase", "pointer"); return;
                case "unity.gesture":
                    RequireExactFields(payload, "clockSampleId", "input", "retention"); return;
                case "unity.dead":
                    RequireExactFields(payload, "deadT", "replayDigest"); return;
                case "unity.stats":
                    RequireExactFields(payload, "avgFrameMs", "fps", "inputToVisibleBatMs", "memoryMb",
                        "p95FrameMs", "p99FrameMs", "quality", "sampleCount", "spikes", "thermalState",
                        "worstFrameMs"); return;
                case "unity.benchmark":
                    RequireExactFields(payload, "benchmarkId", "frameIntervalsMs", "graphics", "memoryMb",
                        "quality", "thermalState", "warmup"); return;
                case "unity.quiet":
                    RequireExactFields(payload, "quiet"); return;
                case "unity.pause_request":
                    RequireExactFields(payload, "reason"); return;
                case "unity.dead_ball_action":
                    RequireExactFields(payload, "action", "replayDigest"); return;
                case "unity.protected_regions":
                    RequireExactFields(payload, "regions", "viewportHeight", "viewportWidth"); return;
                case "unity.unloaded":
                    RequireExactFields(payload, "retainedMemoryMb"); return;
                case "unity.error":
                    RequireExactFields(payload, "code", "detail", "fallback", "recoverable"); return;
                default:
                    throw new BridgeValidationException("Message type is unsupported.");
            }
        }

        private static void ValidateSceneObjects(StrictJsonObject payload)
        {
            ValidateField(payload.Object("field"));
            ValidateBowler(payload.Object("bowler"));
            ValidateBallCondition(payload.Object("ball"));
        }

        private static void ValidateProtectedRegions(StrictJsonObject payload)
        {
            var viewportWidth = payload.Integer("viewportWidth");
            var viewportHeight = payload.Integer("viewportHeight");
            Require(viewportWidth >= 1 &&
                    viewportWidth <= BridgeConstants.MaxProtectedRegionViewportPixels,
                "Protected-region viewportWidth is outside the contract.");
            Require(viewportHeight >= 1 &&
                    viewportHeight <= BridgeConstants.MaxProtectedRegionViewportPixels,
                "Protected-region viewportHeight is outside the contract.");
            var regions = payload.ObjectArray("regions", BridgeConstants.MaxProtectedRegions);
            Require(regions.Length >= 1, "At least one protected region is required.");
            var kinds = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < regions.Length; index++)
            {
                var region = regions[index];
                RequireExactFields(region, "height", "kind", "width", "x", "y");
                var kind = region.String("kind");
                Require(OneOf(kind, "bowler", "release", "pitch", "ball_path", "bat", "contact"),
                    "Protected-region kind is unsupported.");
                Require(kinds.Add(kind), "Protected-region kinds must be unique.");
                var x = region.Number("x");
                var y = region.Number("y");
                var width = region.Number("width");
                var height = region.Number("height");
                Require(x >= 0.0 && y >= 0.0 && width > 0.0 && height > 0.0,
                    "Protected-region rectangle is empty or negative.");
                Require(x + width <= viewportWidth && y + height <= viewportHeight,
                    "Protected-region rectangle exceeds its viewport.");
            }
        }

        private static void ValidateField(StrictJsonObject field)
        {
            NonEmpty(field.String("id"), "field.id");
            var fielders = field.ObjectArray("fielders", 11);
            Require(fielders.Length == 11, "field must contain exactly eleven fielders.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < fielders.Length; index++)
            {
                var fielder = fielders[index];
                var id = fielder.String("id");
                NonEmpty(id, "fielder.id");
                Require(ids.Add(id), "field contains a duplicate fielder id.");
                Require(OneOf(fielder.String("role"),
                        "keeper", "bowler", "slip", "gully", "point", "backward_point", "cover",
                        "extra_cover", "mid_off", "mid_on", "midwicket", "square_leg", "fine_leg",
                        "third_man", "deep_point", "deep_cover", "long_off", "long_on",
                        "deep_midwicket", "deep_square", "short_leg", "silly_point", "leg_slip"),
                    "fielder.role is unsupported.");
                ValidatePresentationNumber(fielder, "x", "fielder.x");
                ValidatePresentationNumber(fielder, "z", "fielder.z");
            }
        }

        private static void ValidateBowler(StrictJsonObject bowler)
        {
            var family = bowler.String("family");
            Require(OneOf(family, "pace", "spin"), "bowler.family is unsupported.");
            Require(OneOf(bowler.String("arm"), "right", "left"), "bowler.arm is unsupported.");
            NonEmpty(bowler.String("lookSeed"), "bowler.lookSeed");
            if (bowler.Contains("paceBand"))
                Require(OneOf(bowler.String("paceBand"), "controlled", "fast", "express"),
                    "bowler.paceBand is unsupported.");
            if (bowler.Contains("spinType"))
                Require(OneOf(bowler.String("spinType"), "finger", "wrist"),
                    "bowler.spinType is unsupported.");
            if (family == "pace")
                Require(bowler.Contains("paceBand"),
                    "pace bowler requires a supported paceBand.");
            else
                Require(bowler.Contains("spinType"),
                    "spin bowler requires a supported spinType.");
        }

        private static void ValidateBallCondition(StrictJsonObject ball)
        {
            Require(OneOf(ball.String("colour"), "red", "white"), "ball.colour is unsupported.");
            Require(OneOf(ball.String("age"), "new", "worn"), "ball.age is unsupported.");
        }

        private static void ValidateDelivery(StrictJsonObject payload)
        {
            var overIndex = payload.Integer("overIndex");
            var ballIndex = payload.Integer("ballIndex");
            RequireSafeInteger(overIndex, "overIndex");
            RequireSafeInteger(ballIndex, "ballIndex");
            Require(overIndex < 10, "overIndex is outside Practice.");
            Require(ballIndex < 6, "ballIndex is outside an over.");
            var plan = payload.Object("plan");
            ValidatePlan(plan);
            var seed = payload.String("seed");
            NonEmpty(seed, "seed");

            var flight = payload.Object("flight");
            ValidateFlight(flight);
            Require(string.Equals(seed, flight.String("seed"), StringComparison.Ordinal),
                "flight.seed does not match delivery seed.");
            Require(string.Equals(payload.Raw("plan"), flight.Raw("plan"), StringComparison.Ordinal),
                "flight.plan does not match delivery plan.");

            var presentation = payload.Object("presentation");
            RequireExactFields(presentation, "coach", "learnCue");
            var learnCue = presentation.Boolean("learnCue");
            if (presentation.IsNull("coach")) return;

            Require(!learnCue, "Learn and Coach guidance are mutually exclusive.");
            var coach = presentation.Object("coach");
            RequireExactFields(coach, "contactPoint", "contactT", "stage");
            var stage = coach.Integer("stage");
            Require(stage >= 1 && stage <= 4, "Coach assistance stage is unsupported.");
            var contactTimeMissing = coach.IsNull("contactT");
            var contactPointMissing = coach.IsNull("contactPoint");
            Require(contactTimeMissing == contactPointMissing,
                "Coach contact time and point must be present or absent together.");
            if (!contactTimeMissing)
            {
                ValidateTraceTime(coach, "contactT", "presentation.coach.contactT");
                ValidateVector(coach.Object("contactPoint"), "presentation.coach.contactPoint");
            }
            Require(stage != 4 || contactTimeMissing,
                "Coach stage four must carry no presentation guide.");
        }

        private static void ValidateFlight(StrictJsonObject flight)
        {
            Require(flight.Integer("version") == BridgeConstants.SimulationVersion,
                "flight.version is unsupported.");
            ValidatePlan(flight.Object("plan"));
            NonEmpty(flight.String("seed"), "flight.seed");

            var release = flight.Object("release");
            ValidateVector(release.Object("p"), "flight.release.p");
            ValidateVector(release.Object("v"), "flight.release.v");
            ValidatePresentationNumber(release, "spinRps", "flight.release.spinRps");
            release.Number("seamDeg");
            release.Number("speedKph");
            if (!flight.IsNull("bounce"))
            {
                var bounce = flight.Object("bounce");
                ValidateTraceTime(bounce, "t", "flight.bounce.t");
                ValidateVector(bounce.Object("p"), "flight.bounce.p");
            }
            var spin = flight.Object("spin");
            ValidateVector(spin.Object("release"), "flight.spin.release");
            if (!spin.IsNull("afterBounce"))
                ValidateVector(spin.Object("afterBounce"), "flight.spin.afterBounce");
            var seam = flight.Object("seam");
            ValidateVector(seam.Object("axis"), "flight.seam.axis");
            ValidateVector(seam.Object("shine"), "flight.seam.shine");
            seam.Number("wobble");
            ValidateTraceTime(flight, "idealContactT", "flight.idealContactT");
            ValidateTraceTime(flight, "stumpsT", "flight.stumpsT");
            flight.Boolean("wouldHitStumps");

            var samples = flight.ObjectArray("samples", BridgeConstants.MaxTraceSamplesPerChannel);
            Require(samples.Length > 0, "flight.samples must not be empty.");
            var prior = double.NegativeInfinity;
            for (var index = 0; index < samples.Length; index++)
            {
                var sample = samples[index];
                var time = ValidateTraceTime(sample, "t", "flight.samples.t");
                Require(time >= prior, "flight.samples must be monotonic.");
                prior = time;
                ValidateVector(sample.Object("p"), "flight.samples.p");
                ValidateVector(sample.Object("v"), "flight.samples.v");
            }
        }

        private static void ValidateResolution(StrictJsonObject resolution)
        {
            var record = resolution.Object("record");
            var result = resolution.Object("result");
            var score = resolution.Object("score");
            ValidateDeliveryRecord(record);
            ValidateDeliveryResult(result);
            ValidateScore(score);
            Require(Sha256Digest.IsLowerHexSha256(resolution.String("replayDigest")),
                "replayDigest is invalid.");

            var outcome = result.Object("outcome");
            Require(record.Integer("runs") == outcome.Integer("runs"),
                "record runs do not match result outcome.");
            Require(string.Equals(record.Raw("dismissal"), outcome.Raw("dismissal"),
                    StringComparison.Ordinal),
                "record dismissal does not match result outcome.");
            Require((outcome.IsNull("dismissal") && score.Integer("wickets") == 0) ||
                    (!outcome.IsNull("dismissal") && score.Integer("wickets") == 1),
                "score wickets do not match the result dismissal.");
            Require(string.Equals(record.String("seed"), result.Object("flight").String("seed"),
                    StringComparison.Ordinal),
                "record seed does not match result flight.");
            Require(string.Equals(record.Raw("plan"), result.Object("flight").Raw("plan"),
                    StringComparison.Ordinal),
                "record plan does not match result flight.");
            Require(string.Equals(record.Raw("swing"), result.Raw("swing"), StringComparison.Ordinal),
                "record swing does not match result swing.");
        }

        private static void ValidateDeliveryRecord(StrictJsonObject record)
        {
            Require(record.Integer("version") == BridgeConstants.SimulationVersion,
                "record.version is unsupported.");
            RequireSafeInteger(record.Integer("overIndex"), "record.overIndex");
            RequireSafeInteger(record.Integer("ballIndex"), "record.ballIndex");
            ValidateBowler(record.Object("bowler"));
            ValidatePlan(record.Object("plan"));
            NonEmpty(record.String("seed"), "record.seed");
            Require(OneOf(record.String("conditions"), "balanced", "green", "hard", "turning"),
                "record.conditions is unsupported.");
            ValidateBallCondition(record.Object("ball"));
            ValidateField(record.Object("field"));
            Require(OneOf(record.String("handedness"), "right", "left"),
                "record.handedness is unsupported.");
            Require(OneOf(record.String("assist"), "learn", "play", "real"),
                "record.assist is unsupported.");
            record.Number("tierToleranceMs");
            if (!record.IsNull("swing")) ValidateSwing(record.Object("swing"));
            Require(OneOfInteger(record.Integer("runs"), 0, 1, 2, 3, 4, 6),
                "record.runs is unsupported.");
            ValidateNullableEnum(record, "dismissal", "bowled", "caught", "caught_behind", "lbw");
        }

        private static void ValidateDeliveryResult(StrictJsonObject result)
        {
            Require(result.Integer("version") == BridgeConstants.SimulationVersion,
                "result.version is unsupported.");
            var batterRootOffset = result.Object("batterRootOffset");
            var batterBodyFrame = result.Object("batterBodyFrame");
            var batterPosture = result.Object("batterPosture");
            ValidateBatterRootOffset(batterRootOffset);
            ValidateBatterBodyFrame(batterBodyFrame);
            ValidateBatterPosture(batterPosture);
            ValidateFlight(result.Object("flight"));
            if (!result.IsNull("swing")) ValidateSwing(result.Object("swing"));
            Require(OneOf(result.String("footwork"), "forward", "back", "across", "down_track"),
                "result.footwork is unsupported.");
            ValidateContact(result.Object("contact"));
            ValidateBallSamples(result.ObjectArray("ball", BridgeConstants.MaxTraceSamplesPerChannel),
                "result.ball", true);
            ValidateOutcome(result.Object("outcome"));
            var deadT = ValidateTraceTime(result, "deadT", "result.deadT");
            Require(deadT > 0.0, "result.deadT must be positive.");
            var bat = result.ObjectArray("bat", BridgeConstants.MaxTraceSamplesPerChannel);
            ValidateBatTrace(bat);
            if (bat.Length == 0)
            {
                var tolerance = BridgeConstants.EmptyBatNominalToleranceMetres;
                Require(Math.Abs(batterRootOffset.Number("x")) <= tolerance &&
                        Math.Abs(batterRootOffset.Number("z")) <= tolerance,
                    "A result without a swing must keep batterRootOffset nominal within 1e-6 m.");
                Require(Math.Abs(batterPosture.Number("crouchM")) <= tolerance,
                    "A result without a swing must keep batterPosture nominal within 1e-6 m.");
            }
            ValidateFielderPaths(result.ObjectArray("fielders", 11));
            var events = result.ObjectArray("events", BridgeConstants.MaxTraceEvents);
            ValidateEvents(events);
            ValidateBatterMotion(result, bat);
            ValidateBatContactKnot(bat, events);
            ValidateCoaching(result.Object("coaching"));
            if (!result.IsNull("lbw")) ValidateLbw(result.Object("lbw"));
        }

        private static void ValidateBatterRootOffset(StrictJsonObject value)
        {
            RequireExactFields(value, "x", "z");
            var x = value.Number("x");
            var z = value.Number("z");
            var maximum = BridgeConstants.MaxBatterRootOffsetMetres;
            Require(x * x + z * z <= maximum * maximum,
                "result.batterRootOffset exceeds the authoritative 0.18 m cap.");
        }

        private static void ValidateBatterPosture(StrictJsonObject value)
        {
            RequireExactFields(value, "crouchM");
            var crouch = value.Number("crouchM");
            Require(crouch >= 0.0 && crouch <= BridgeConstants.MaxBatterCrouchMetres,
                "result.batterPosture.crouchM is outside the inclusive 0..0.18 m domain.");
        }

        private static void ValidateBatterBodyFrame(StrictJsonObject value)
        {
            RequireExactFields(value, "headCentre", "stance", "torsoTop");
            var stance = value.Object("stance");
            RequireExactFields(stance, "x", "z");
            var stanceX = ValidatePresentationNumber(stance, "x", "result.batterBodyFrame.stance.x");
            var stanceZ = ValidatePresentationNumber(stance, "z", "result.batterBodyFrame.stance.z");
            var torsoTop = value.Object("torsoTop");
            RequireExactFields(torsoTop, "x", "y", "z");
            ValidateVector(torsoTop, "result.batterBodyFrame.torsoTop");
            var headCentre = value.Object("headCentre");
            RequireExactFields(headCentre, "x", "y", "z");
            ValidateVector(headCentre, "result.batterBodyFrame.headCentre");
            var torsoX = torsoTop.Number("x");
            var torsoY = torsoTop.Number("y");
            var torsoZ = torsoTop.Number("z");
            var headX = headCentre.Number("x");
            var headY = headCentre.Number("y");
            var headZ = headCentre.Number("z");
            Require(Math.Abs(stanceX) <= 3.0 && stanceZ >= 5.0 && stanceZ <= 11.0 &&
                    Math.Abs(torsoX) <= 3.0 && torsoY >= 0.0 && torsoY <= 3.0 &&
                    torsoZ >= 5.0 && torsoZ <= 11.0 && Math.Abs(headX) <= 3.0 &&
                    headY >= torsoY && headY <= 3.0 && headZ >= 5.0 && headZ <= 11.0,
                "result.batterBodyFrame is outside the canonical batter/pitch domain.");
            Require(Math.Sqrt((torsoX - stanceX) * (torsoX - stanceX) +
                              (torsoZ - stanceZ) * (torsoZ - stanceZ)) <= 3.0 &&
                    Math.Sqrt((headX - torsoX) * (headX - torsoX) +
                              (headY - torsoY) * (headY - torsoY) +
                              (headZ - torsoZ) * (headZ - torsoZ)) <= 1.0,
                "result.batterBodyFrame anchors are not one coherent athlete.");
        }

        private static void ValidateBatterMotion(
            StrictJsonObject result,
            StrictJsonObject[] bat)
        {
            if (bat.Length == 0)
            {
                Require(result.IsNull("batterMotion"),
                    "result.batterMotion must be null exactly when result.bat is empty.");
                return;
            }
            Require(!result.IsNull("batterMotion"),
                "result.batterMotion is required when result.bat is non-empty.");
            var motion = result.Object("batterMotion");
            RequireExactFields(motion, "contactT", "endT", "startT");
            var start = ValidateTraceTime(motion, "startT", "result.batterMotion.startT");
            var contact = ValidateTraceTime(motion, "contactT", "result.batterMotion.contactT");
            var end = ValidateTraceTime(motion, "endT", "result.batterMotion.endT");
            Require(start < end, "result.batterMotion requires startT < endT.");
            Require(contact > start && contact < end,
                "result.batterMotion.contactT must be strictly inside its motion domain.");
            Require(start == bat[0].Number("t"),
                "result.batterMotion.startT must exactly equal the first bat knot.");
            Require(end <= bat[bat.Length - 1].Number("t"),
                "result.batterMotion.endT must not exceed the last bat knot.");
            var contactKnotMatches = 0;
            var contactKnotIndex = -1;
            var endKnotMatches = 0;
            var endKnotIndex = -1;
            for (var index = 0; index < bat.Length; index++)
            {
                var time = bat[index].Number("t");
                if (Math.Abs(time - contact) <= BridgeConstants.ExactTraceTimeToleranceSeconds)
                {
                    contactKnotMatches++;
                    contactKnotIndex = index;
                }
                if (Math.Abs(time - end) <= BridgeConstants.ExactTraceTimeToleranceSeconds)
                {
                    endKnotMatches++;
                    endKnotIndex = index;
                }
            }
            Require(contactKnotMatches == 1,
                "result.batterMotion.contactT requires exactly one bat knot within 1e-12 seconds.");
            Require(endKnotMatches == 1,
                "result.batterMotion.endT requires exactly one bat knot within 1e-12 seconds.");
            Require(contactKnotIndex != endKnotIndex,
                "result.batterMotion contact and end anchors must resolve to distinct bat knots.");
            ValidateHeldBatKnots(bat, endKnotIndex);
        }

        private static void ValidateHeldBatKnots(StrictJsonObject[] bat, int endKnotIndex)
        {
            var held = bat[endKnotIndex];
            for (var index = endKnotIndex + 1; index < bat.Length; index++)
            {
                Require(BatVectorNear(held.Object("grip"), bat[index].Object("grip")) &&
                        BatVectorNear(held.Object("toe"), bat[index].Object("toe")) &&
                        BatVectorNear(held.Object("face"), bat[index].Object("face")),
                    "Every result.bat knot after batterMotion.endT must hold the exact end pose within 1e-9.");
            }
        }

        private static bool BatVectorNear(StrictJsonObject first, StrictJsonObject second)
        {
            var tolerance = BridgeConstants.HeldBatPoseToleranceMetres;
            return Math.Abs(first.Number("x") - second.Number("x")) <= tolerance &&
                   Math.Abs(first.Number("y") - second.Number("y")) <= tolerance &&
                   Math.Abs(first.Number("z") - second.Number("z")) <= tolerance;
        }

        private static void ValidateContact(StrictJsonObject contact)
        {
            Require(OneOf(contact.String("kind"), "middle", "inside_edge", "outside_edge", "top_edge",
                    "leading_edge", "pad", "body", "miss", "leave"),
                "contact.kind is unsupported.");
            Require(OneOf(contact.String("timing"), "perfect", "solid", "mistimed", "missed", "none"),
                "contact.timing is unsupported.");
            ValidateNullableNumber(contact, "t");
            ValidateNullableNumber(contact, "timingErrorMs");
            ValidateNullableNumber(contact, "bladeU");
            ValidateNullableNumber(contact, "faceBearingDeg");
            ValidateNullableNumber(contact, "batSpeedKph");
            ValidateNullableNumber(contact, "exitSpeedKph");
            ValidateNullableNumber(contact, "exitBearingDeg");
            ValidateNullableNumber(contact, "exitElevationDeg");
            ValidateNullableNumber(contact, "intendedBearingDeg");
            if (!contact.IsNull("point")) ValidateVector(contact.Object("point"), "contact.point");
        }

        private static void ValidateOutcome(StrictJsonObject outcome)
        {
            Require(OneOfInteger(outcome.Integer("runs"), 0, 1, 2, 3, 4, 6),
                "outcome.runs is unsupported.");
            if (!outcome.IsNull("boundary"))
                Require(OneOfInteger(outcome.Integer("boundary"), 4, 6),
                    "outcome.boundary is unsupported.");
            ValidateNullableEnum(outcome, "dismissal", "bowled", "caught", "caught_behind", "lbw");
            if (!outcome.IsNull("fielderId")) NonEmpty(outcome.String("fielderId"), "outcome.fielderId");
            ValidateNullableNumber(outcome, "endBearingDeg");
            ValidateNullableNumber(outcome, "endDistanceM");
            if (!outcome.IsNull("region")) NonEmpty(outcome.String("region"), "outcome.region");
        }

        private static void ValidateBatTrace(StrictJsonObject[] samples)
        {
            var prior = double.NegativeInfinity;
            for (var index = 0; index < samples.Length; index++)
            {
                var time = ValidateTraceTime(samples[index], "t", "result.bat.t");
                Require(index == 0 || time > prior, "result.bat must be strictly increasing.");
                prior = time;
                var grip = samples[index].Object("grip");
                var toe = samples[index].Object("toe");
                var face = samples[index].Object("face");
                ValidateVector(grip, "result.bat.grip");
                ValidateVector(toe, "result.bat.toe");
                ValidateVector(face, "result.bat.face");
                ValidateRigidBatKnot(grip, toe, face);
            }
        }

        private static void ValidateRigidBatKnot(
            StrictJsonObject grip,
            StrictJsonObject toe,
            StrictJsonObject face)
        {
            var axisX = grip.Number("x") - toe.Number("x");
            var axisY = grip.Number("y") - toe.Number("y");
            var axisZ = grip.Number("z") - toe.Number("z");
            var length = Math.Sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
            Require(Math.Abs(length - BridgeConstants.CanonicalBatLengthMetres) <=
                    BridgeConstants.CanonicalBatLengthToleranceMetres,
                "result.bat grip-to-toe length is not the canonical 0.86 m.");

            var faceX = face.Number("x");
            var faceY = face.Number("y");
            var faceZ = face.Number("z");
            var faceLength = Math.Sqrt(faceX * faceX + faceY * faceY + faceZ * faceZ);
            Require(Math.Abs(faceLength - 1.0) <= BridgeConstants.CanonicalBatUnitTolerance,
                "result.bat face must be a unit vector.");
            var dot = (axisX * faceX + axisY * faceY + axisZ * faceZ) / length;
            Require(Math.Abs(dot) <= BridgeConstants.CanonicalBatOrthogonalityTolerance,
                "result.bat face must be orthogonal to the bat axis.");
        }

        private static void ValidateBatContactKnot(
            StrictJsonObject[] samples,
            StrictJsonObject[] events)
        {
            var contactEvents = 0;
            var contactTime = 0.0;
            for (var index = 0; index < events.Length; index++)
            {
                if (events[index].String("kind") != "contact") continue;
                var contact = events[index].String("contact");
                if (!IsBatContact(contact)) continue;
                contactEvents++;
                contactTime = events[index].Number("t");
            }
            Require(contactEvents <= 1,
                "result.events may contain at most one blade/handle contact event.");
            if (contactEvents == 0) return;

            var matchingKnots = 0;
            for (var index = 0; index < samples.Length; index++)
            {
                if (Math.Abs(samples[index].Number("t") - contactTime) <=
                    BridgeConstants.ExactTraceTimeToleranceSeconds)
                    matchingKnots++;
            }
            Require(matchingKnots == 1,
                "A blade/handle contact event requires exactly one result.bat knot within 1e-12 seconds.");
        }

        private static bool IsBatContact(string value)
        {
            return value == "middle" || value == "inside_edge" || value == "outside_edge" ||
                   value == "top_edge" || value == "leading_edge";
        }

        private static void ValidateFielderPaths(StrictJsonObject[] paths)
        {
            Require(paths.Length == 11, "result.fielders must contain exactly eleven paths.");
            for (var pathIndex = 0; pathIndex < paths.Length; pathIndex++)
            {
                var path = paths[pathIndex];
                NonEmpty(path.String("fielderId"), "result.fielderId");
                var samples = path.ObjectArray("samples", BridgeConstants.MaxTraceSamplesPerChannel);
                Require(samples.Length > 0, "fielder path samples must not be empty.");
                var prior = double.NegativeInfinity;
                for (var index = 0; index < samples.Length; index++)
                {
                    var sample = samples[index];
                    var time = ValidateTraceTime(sample, "t", "result.fielders.samples.t");
                    Require(time >= prior, "fielder path samples must be monotonic.");
                    prior = time;
                    ValidatePresentationNumber(sample, "x", "result.fielders.samples.x");
                    ValidatePresentationNumber(sample, "z", "result.fielders.samples.z");
                    Require(OneOf(sample.String("action"), "set", "run", "dive", "catch", "drop",
                            "pickup", "throw", "celebrate", "idle"),
                        "fielder path action is unsupported.");
                }
            }
        }

        private static void ValidateEvents(StrictJsonObject[] events)
        {
            Require(events.Length > 0, "result.events must not be empty.");
            var prior = double.NegativeInfinity;
            for (var index = 0; index < events.Length; index++)
            {
                var value = events[index];
                var time = ValidateTraceTime(value, "t", "result.events.t");
                Require(time >= prior, "result.events must be monotonic.");
                prior = time;
                var kind = value.String("kind");
                Require(OneOf(kind, "release", "bounce", "contact", "pad", "stumps", "keeper_take",
                        "ball_bounce", "catch", "field", "throw", "boundary", "run", "dead"),
                    "result event kind is unsupported.");
                switch (kind)
                {
                    case "release":
                    case "dead":
                        break;
                    case "contact":
                        Require(OneOf(value.String("contact"), "middle", "inside_edge", "outside_edge",
                                "top_edge", "leading_edge", "pad", "body", "miss", "leave"),
                            "event contact is unsupported.");
                        ValidateVector(value.Object("p"), "event.p");
                        break;
                    case "catch":
                    case "field":
                    case "throw":
                        NonEmpty(value.String("fielderId"), "event.fielderId");
                        ValidateVector(value.Object("p"), "event.p");
                        break;
                    case "boundary":
                        Require(OneOfInteger(value.Integer("runs"), 4, 6),
                            "boundary event runs are unsupported.");
                        ValidateVector(value.Object("p"), "event.p");
                        break;
                    case "run":
                        var completed = value.Integer("completed");
                        RequireSafeInteger(completed, "run event completed");
                        Require(completed >= 1, "run event completed must be positive.");
                        break;
                    default:
                        ValidateVector(value.Object("p"), "event.p");
                        if (kind == "keeper_take" && value.Contains("shortM") && !value.IsNull("shortM"))
                        {
                            var shortM = value.Number("shortM");
                            Require(!double.IsNaN(shortM) && !double.IsInfinity(shortM) && shortM >= 0.0,
                                "keeper_take shortM must be a finite non-negative distance.");
                        }
                        break;
                }
            }
        }

        private static void ValidateCoaching(StrictJsonObject coaching)
        {
            Require(OneOf(coaching.String("reason"), "found_the_gap", "hit_to_fielder",
                    "cleared_the_rope", "beat_the_field", "caught_in_the_deep", "caught_in_the_ring",
                    "edged_behind", "edged_to_slip", "too_early", "too_late", "beaten_by_swing",
                    "beaten_by_seam", "beaten_by_turn", "beaten_by_pace", "beaten_by_bounce",
                    "played_across_the_line", "missed_straight_ball", "left_well", "left_and_bowled", "played_on",
                    "pad_in_line", "solid_defence", "mistimed_lofted"),
                "coaching.reason is unsupported.");
            ValidateNullableEnum(coaching, "timing", "early", "on_time", "late");
            ValidateNullableEnum(coaching, "zone", "third_man", "point", "cover", "mid_off", "mid_on",
                "midwicket", "square_leg", "fine_leg");
            ValidateNullableEnum(coaching, "fielderRole", "keeper", "bowler", "slip", "gully", "point",
                "backward_point", "cover", "extra_cover", "mid_off", "mid_on", "midwicket",
                "square_leg", "fine_leg", "third_man", "deep_point", "deep_cover", "long_off",
                "long_on", "deep_midwicket", "deep_square", "short_leg", "silly_point", "leg_slip");
            ValidateNullableEnum(coaching, "lbw", "pitched_outside_leg", "impact_outside_leg",
                "impact_outside_off", "missing", "high", "out");
        }

        private static void ValidateLbw(StrictJsonObject lbw)
        {
            lbw.Boolean("out");
            Require(OneOf(lbw.String("reason"), "pitched_outside_leg", "impact_outside_leg",
                    "impact_outside_off", "missing", "high", "out"),
                "lbw.reason is unsupported.");
            ValidateVector(lbw.Object("impact"), "lbw.impact");
            ValidateVector(lbw.Object("projected"), "lbw.projected");
        }

        private static void ValidateScore(StrictJsonObject score)
        {
            var runs = score.Integer("runs");
            RequireSafeInteger(runs, "score.runs");
            Require(runs <= 360, "score.runs exceeds ten overs of legal scoring outcomes.");
            var wickets = score.Integer("wickets");
            Require(wickets == 0 || wickets == 1, "score.wickets is unsupported.");
            var balls = score.Integer("balls");
            RequireSafeInteger(balls, "score.balls");
            Require(balls >= 1 && balls <= 60, "score.balls is outside Practice.");
            Require(score.Integer("maxOvers") == 10, "score.maxOvers must be ten.");
        }

        private static void ValidateBallSamples(StrictJsonObject[] samples, string fieldName, bool requireOne)
        {
            if (requireOne) Require(samples.Length > 0, fieldName + " must not be empty.");
            var prior = double.NegativeInfinity;
            for (var index = 0; index < samples.Length; index++)
            {
                var sample = samples[index];
                var time = ValidateTraceTime(sample, "t", fieldName + ".t");
                Require(time >= prior, fieldName + " must be monotonic.");
                prior = time;
                ValidateVector(sample.Object("p"), fieldName + ".p");
                ValidateVector(sample.Object("v"), fieldName + ".v");
            }
        }

        private static void ValidatePlan(StrictJsonObject plan)
        {
            Require(OneOf(plan.String("variation"),
                    "stock", "outswing", "inswing", "seam", "cutter", "slower", "bouncer",
                    "yorker", "flighted", "quicker", "topspinner", "arm_ball", "wrong_un"),
                "plan.variation is unsupported.");
            var length = plan.Number("lengthM");
            var speed = plan.Number("speedKph");
            plan.Number("lineM");
            Require(length >= 0.0 && length <= 12.0, "plan.lengthM is outside the contract.");
            Require(speed >= 40.0 && speed <= 180.0, "plan.speedKph is outside the contract.");
        }

        private static void ValidateSwing(StrictJsonObject swing)
        {
            Require(OneOf(swing.String("kind"), "defend", "attack"), "swing.kind is unsupported.");
            var startT = swing.Number("startT");
            Require(Math.Abs(startT) <= BridgeConstants.MaxTraceDurationSeconds,
                "swing.startT is outside the presentation time domain.");
            ValidatePresentationNumber(swing, "directionDeg", "swing.directionDeg");
            var power = swing.Number("power");
            var elevation = swing.Number("elevation");
            Require(power >= 0.0 && power <= 1.0, "swing.power is outside the contract.");
            Require(elevation >= 0.0 && elevation <= 1.0, "swing.elevation is outside the contract.");
            Require(OneOf(swing.String("footwork"), "auto", "forward", "back", "across", "down_track"),
                "swing.footwork is unsupported.");
        }

        private static void ValidateGesture(StrictJsonObject input)
        {
            var optional = (input.Contains("footwork") ? 1 : 0) + (input.Contains("key") ? 1 : 0);
            Require(input.Count == 3 + optional && input.Contains("pointer") && input.Contains("samples") &&
                    input.Contains("surface"), "Gesture input contains missing or unsupported fields.");
            Require(OneOf(input.String("pointer"), "touch", "mouse", "pen", "keyboard"),
                "Gesture pointer is unsupported.");
            var surface = input.Object("surface");
            RequireExactFields(surface, "height", "width");
            var width = surface.Number("width");
            var height = surface.Number("height");
            Require(width > 0.0 && width <= 16384.0 && height > 0.0 && height <= 16384.0,
                "Gesture surface is outside the contract.");
            var samples = input.ObjectArray("samples", BridgeConstants.MaxGestureSamples);
            Require(samples.Length > 0, "Gesture samples must not be empty.");
            var first = samples[0].Number("t");
            var prior = double.NegativeInfinity;
            for (var index = 0; index < samples.Length; index++)
            {
                RequireExactFields(samples[index], "t", "x", "y");
                var time = samples[index].Number("t");
                Require(time >= prior, "Gesture samples must be monotonic.");
                prior = time;
                samples[index].Number("x");
                samples[index].Number("y");
            }
            Require(prior - first <= 3000.0, "Gesture samples exceed the capture window.");
            if (input.Contains("footwork"))
                Require(OneOf(input.String("footwork"), "auto", "forward", "back", "across", "down_track"),
                    "Gesture footwork is unsupported.");
            if (input.Contains("key"))
            {
                var key = input.Object("key");
                RequireExactFields(key, "kind", "loft", "screenBearingDeg");
                Require(OneOf(key.String("kind"), "defend", "attack"), "Gesture key kind is unsupported.");
                key.Boolean("loft");
                key.Number("screenBearingDeg");
            }
        }

        private static void ValidateVector(StrictJsonObject value, string fieldName)
        {
            ValidatePresentationNumber(value, "x", fieldName + ".x");
            ValidatePresentationNumber(value, "y", fieldName + ".y");
            ValidatePresentationNumber(value, "z", fieldName + ".z");
        }

        private static double ValidatePresentationNumber(
            StrictJsonObject value,
            string propertyName,
            string fieldName)
        {
            var number = value.Number(propertyName);
            Require(Math.Abs(number) <= BridgeConstants.MaxPresentationMagnitude,
                fieldName + " is outside the Unity presentation domain.");
            return number;
        }

        private static double ValidateTraceTime(
            StrictJsonObject value,
            string propertyName,
            string fieldName)
        {
            var number = value.Number(propertyName);
            Require(number >= 0.0 && number <= BridgeConstants.MaxTraceDurationSeconds,
                fieldName + " is outside the trace time domain.");
            return number;
        }

        private static void ValidateNullableNumber(StrictJsonObject value, string fieldName)
        {
            if (!value.IsNull(fieldName)) value.Number(fieldName);
        }

        private static void ValidateNullableEnum(
            StrictJsonObject value,
            string fieldName,
            params string[] choices)
        {
            if (!value.IsNull(fieldName))
                Require(OneOf(value.String(fieldName), choices), fieldName + " is unsupported.");
        }

        private static bool OneOfInteger(long value, params long[] choices)
        {
            for (var index = 0; index < choices.Length; index++)
                if (value == choices[index]) return true;
            return false;
        }

        private static void RequireExactFields(StrictJsonObject value, params string[] expected)
        {
            Require(value.Count == expected.Length, "Payload contains missing or unsupported fields.");
            for (var index = 0; index < expected.Length; index++)
                Require(value.Contains(expected[index]), "Payload is missing " + expected[index] + ".");
        }

        private static void RequireSafeInteger(long value, string fieldName)
        {
            Require(value >= 0 && value <= BridgeConstants.MaxJavaScriptSafeInteger,
                fieldName + " must be a non-negative JavaScript-safe integer.");
        }

        private static int CheckedInteger(long value, string fieldName)
        {
            Require(value >= int.MinValue && value <= int.MaxValue, fieldName + " is outside the supported range.");
            return (int)value;
        }

        private static bool RequiresDeliveryId(string type)
        {
            return type == "host.delivery" || type == "host.provisional_swing" ||
                   type == "host.result" || type == "host.dead_ball_ui" || type == "host.replay" ||
                   type == "host.demonstration" || type == "host.demonstration_cancel" ||
                   type == "unity.release" || type == "unity.pointer" ||
                   type == "unity.gesture" || type == "unity.dead" ||
                   type == "unity.dead_ball_action" || type == "unity.protected_regions";
        }

        private static void NonEmpty(string value, string fieldName)
        {
            Require(!string.IsNullOrEmpty(value), fieldName + " is required.");
        }

        private static bool OneOf(string value, params string[] choices)
        {
            for (var index = 0; index < choices.Length; index++)
                if (string.Equals(value, choices[index], StringComparison.Ordinal)) return true;
            return false;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new BridgeValidationException(message);
        }
    }
}
