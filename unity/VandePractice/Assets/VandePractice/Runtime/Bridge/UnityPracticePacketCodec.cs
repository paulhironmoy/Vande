using System;
using System.Globalization;
using System.Text;

namespace Vande.Practice.Bridge
{
    public static class UnityPracticePacketCodec
    {
        public static DecodedUnityPracticePacket Decode(string packetJson)
        {
            return BridgeValidator.ParseAndValidatePacket(packetJson);
        }

        public static string EncodeUnityPacket(
            string buildId,
            string sessionId,
            string deliveryId,
            string messageId,
            long sequence,
            string type,
            string canonicalPayloadJson)
        {
            var envelope = new UnityPracticeEnvelope
            {
                contractVersion = BridgeConstants.ContractVersion,
                simVersion = BridgeConstants.SimulationVersion,
                buildId = buildId,
                sessionId = sessionId,
                deliveryId = deliveryId,
                messageId = messageId,
                sequence = sequence,
                sender = "unity",
                type = type,
                payloadJson = canonicalPayloadJson
            };
            BridgeValidator.ValidateEnvelope(envelope);

            // Matches canonicalUnityPracticeJson(): keys sorted by ordinal code unit.
            var body = CanonicalJson.Object(
                "buildId", CanonicalJson.String(envelope.buildId),
                "contractVersion", envelope.contractVersion.ToString(CultureInfo.InvariantCulture),
                "deliveryId", CanonicalJson.String(envelope.deliveryId),
                "messageId", CanonicalJson.String(envelope.messageId),
                "payload", envelope.payloadJson,
                "sender", CanonicalJson.String(envelope.sender),
                "sequence", envelope.sequence.ToString(CultureInfo.InvariantCulture),
                "sessionId", CanonicalJson.String(envelope.sessionId),
                "simVersion", envelope.simVersion.ToString(CultureInfo.InvariantCulture),
                "type", CanonicalJson.String(envelope.type));
            if (System.Text.Encoding.UTF8.GetByteCount(body) > BridgeConstants.MaxPacketBytes)
                throw new BridgeValidationException("Packet body exceeds the local bridge limit.");

            return CanonicalJson.Object(
                "body", CanonicalJson.String(body),
                "sha256", CanonicalJson.String(Sha256Digest.OfUtf8(body)));
        }

        public static string AckPayload(string acknowledgedMessageId)
        {
            BridgeValidator.ValidateRestrictedText(
                acknowledgedMessageId, BridgeConstants.MaxIdentifierLength, "acknowledgedMessageId");
            return CanonicalJson.Object(
                "acknowledgedMessageId", CanonicalJson.String(acknowledgedMessageId));
        }

        public static string ReadyPayload(string renderer, string unityVersion)
        {
            RequireText(renderer, "renderer");
            RequireText(unityVersion, "unityVersion");
            return CanonicalJson.Object(
                "renderer", CanonicalJson.String(renderer),
                "unityVersion", CanonicalJson.String(unityVersion));
        }

        public static string ClockSyncPayload(
            string sampleId,
            double hostSendPerfMs,
            double unityReceiveMs,
            double unitySendMs)
        {
            RequireText(sampleId, "sampleId");
            return CanonicalJson.Object(
                "hostSendPerfMs", CanonicalJson.Number(hostSendPerfMs),
                "sampleId", CanonicalJson.String(sampleId),
                "unityReceiveMs", CanonicalJson.Number(unityReceiveMs),
                "unitySendMs", CanonicalJson.Number(unitySendMs));
        }

        public static string ReleasePayload(string clockSampleId, double releaseUnityMs)
        {
            RequireText(clockSampleId, "clockSampleId");
            return CanonicalJson.Object(
                "clockSampleId", CanonicalJson.String(clockSampleId),
                "releaseUnityMs", CanonicalJson.Number(releaseUnityMs));
        }

        public static string PointerPayload(
            string phase,
            double atUnityMs,
            string clockSampleId,
            string pointer)
        {
            if (phase != "down" && phase != "cancel")
                throw new BridgeValidationException("Pointer phase is unsupported.");
            if (pointer != "touch" && pointer != "mouse" && pointer != "pen" && pointer != "keyboard")
                throw new BridgeValidationException("Pointer type is unsupported.");
            RequireText(clockSampleId, "clockSampleId");
            return CanonicalJson.Object(
                "atUnityMs", CanonicalJson.Number(atUnityMs),
                "clockSampleId", CanonicalJson.String(clockSampleId),
                "phase", CanonicalJson.String(phase),
                "pointer", CanonicalJson.String(pointer));
        }

        public static string ErrorPayload(string code, bool recoverable, string detail, string fallback)
        {
            RequireText(code, "code");
            RequireText(detail, "detail");
            RequireText(fallback, "fallback");
            return CanonicalJson.Object(
                "code", CanonicalJson.String(code),
                "detail", CanonicalJson.String(detail),
                "fallback", CanonicalJson.String(fallback),
                "recoverable", recoverable ? "true" : "false");
        }

        public static string QuietPayload(bool quiet)
        {
            return CanonicalJson.Object("quiet", quiet ? "true" : "false");
        }

        public static string PauseRequestPayload()
        {
            return CanonicalJson.Object("reason", CanonicalJson.String("player"));
        }

        public static string DeadBallActionPayload(string action, string replayDigest)
        {
            if (action != "practice_ball" && action != "next_ball")
                throw new BridgeValidationException("Dead-ball action is unsupported.");
            if (!Sha256Digest.IsLowerHexSha256(replayDigest))
                throw new BridgeValidationException("replayDigest is invalid.");
            return CanonicalJson.Object(
                "action", CanonicalJson.String(action),
                "replayDigest", CanonicalJson.String(replayDigest));
        }

        public static string ProtectedRegionsPayload(
            int viewportWidth,
            int viewportHeight,
            UnityPracticeProtectedRegion[] regions)
        {
            if (regions == null || regions.Length < 1 ||
                regions.Length > BridgeConstants.MaxProtectedRegions)
                throw new BridgeValidationException("Protected regions are missing or exceed the limit.");

            var encoded = new StringBuilder(regions.Length * 96);
            encoded.Append('[');
            for (var index = 0; index < regions.Length; index++)
            {
                var region = regions[index] ??
                             throw new BridgeValidationException("Protected region is missing.");
                if (index > 0) encoded.Append(',');
                encoded.Append(CanonicalJson.Object(
                    "height", CanonicalJson.Number(region.Height),
                    "kind", CanonicalJson.String(region.Kind),
                    "width", CanonicalJson.Number(region.Width),
                    "x", CanonicalJson.Number(region.X),
                    "y", CanonicalJson.Number(region.Y)));
            }
            encoded.Append(']');
            return CanonicalJson.Object(
                "regions", encoded.ToString(),
                "viewportHeight", viewportHeight.ToString(CultureInfo.InvariantCulture),
                "viewportWidth", viewportWidth.ToString(CultureInfo.InvariantCulture));
        }

        public static string StatsPayload(
            string quality,
            int sampleCount,
            int spikes,
            double fps,
            double averageFrameMs,
            double p95FrameMs,
            double p99FrameMs,
            double worstFrameMs,
            double? inputToVisibleBatMs,
            double? memoryMb,
            string thermalState)
        {
            if (quality != "lite" && quality != "standard" && quality != "high")
                throw new BridgeValidationException("quality is unsupported.");
            if (sampleCount < 0 || sampleCount > BridgeConstants.MaxBenchmarkIntervals)
                throw new BridgeValidationException("sampleCount is outside the contract.");
            if (spikes < 0 || spikes > sampleCount)
                throw new BridgeValidationException("spikes is outside the delivery sample window.");
            if (thermalState != "unknown" && thermalState != "nominal" && thermalState != "fair" &&
                thermalState != "serious" && thermalState != "critical")
                throw new BridgeValidationException("thermalState is unsupported.");
            return CanonicalJson.Object(
                "avgFrameMs", CanonicalJson.Number(averageFrameMs),
                "fps", CanonicalJson.Number(fps),
                "inputToVisibleBatMs", inputToVisibleBatMs.HasValue
                    ? CanonicalJson.Number(inputToVisibleBatMs.Value)
                    : "null",
                "memoryMb", memoryMb.HasValue ? CanonicalJson.Number(memoryMb.Value) : "null",
                "p95FrameMs", CanonicalJson.Number(p95FrameMs),
                "p99FrameMs", CanonicalJson.Number(p99FrameMs),
                "quality", CanonicalJson.String(quality),
                "sampleCount", sampleCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "spikes", spikes.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "thermalState", CanonicalJson.String(thermalState),
                "worstFrameMs", CanonicalJson.Number(worstFrameMs));
        }

        public static string BenchmarkPayload(
            string benchmarkId,
            string quality,
            double[] frameIntervalsMs,
            int warmupFrames,
            double warmupDurationMs,
            bool shaderWarmupCompleted,
            double? shaderWarmupMs,
            string graphicsApi,
            string graphicsDevice,
            long? contextGeneration,
            long? contextLosses,
            double? memoryMb,
            string thermalState)
        {
            BridgeValidator.ValidateRestrictedText(
                benchmarkId, BridgeConstants.MaxIdentifierLength, "benchmarkId");
            if (quality != "lite" && quality != "standard" && quality != "high")
                throw new BridgeValidationException("quality is unsupported.");
            if (frameIntervalsMs == null || frameIntervalsMs.Length < 1 ||
                frameIntervalsMs.Length > BridgeConstants.MaxBenchmarkIntervals)
                throw new BridgeValidationException("Benchmark frame intervals are missing or exceed the limit.");
            if (warmupFrames < 0 || warmupFrames > BridgeConstants.MaxBenchmarkWarmupFrames ||
                double.IsNaN(warmupDurationMs) || double.IsInfinity(warmupDurationMs) || warmupDurationMs < 0.0)
                throw new BridgeValidationException("Benchmark warmup metadata is invalid.");
            if (shaderWarmupMs.HasValue &&
                (double.IsNaN(shaderWarmupMs.Value) || double.IsInfinity(shaderWarmupMs.Value) ||
                 shaderWarmupMs.Value < 0.0))
                throw new BridgeValidationException("Benchmark shader warmup duration is invalid.");
            if (string.IsNullOrEmpty(graphicsApi) || string.IsNullOrEmpty(graphicsDevice))
                throw new BridgeValidationException("Benchmark graphics metadata is required.");
            if ((contextGeneration.HasValue && contextGeneration.Value < 0) ||
                (contextLosses.HasValue && contextLosses.Value < 0))
                throw new BridgeValidationException("Benchmark context metadata is invalid.");
            if (thermalState != "unknown" && thermalState != "nominal" && thermalState != "fair" &&
                thermalState != "serious" && thermalState != "critical")
                throw new BridgeValidationException("thermalState is unsupported.");

            var intervals = new StringBuilder(frameIntervalsMs.Length * 12);
            intervals.Append('[');
            for (var index = 0; index < frameIntervalsMs.Length; index++)
            {
                var value = frameIntervalsMs[index];
                if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0.0 || value > 10_000.0)
                    throw new BridgeValidationException("Benchmark frame interval is outside the contract.");
                if (index > 0) intervals.Append(',');
                intervals.Append(CanonicalJson.Number(value));
            }
            intervals.Append(']');

            var graphics = CanonicalJson.Object(
                "api", CanonicalJson.String(graphicsApi),
                "contextGeneration", contextGeneration.HasValue
                    ? contextGeneration.Value.ToString(CultureInfo.InvariantCulture)
                    : "null",
                "contextLosses", contextLosses.HasValue
                    ? contextLosses.Value.ToString(CultureInfo.InvariantCulture)
                    : "null",
                "device", CanonicalJson.String(graphicsDevice));
            var warmup = CanonicalJson.Object(
                "durationMs", CanonicalJson.Number(warmupDurationMs),
                "frames", warmupFrames.ToString(CultureInfo.InvariantCulture),
                "shaderWarmupCompleted", shaderWarmupCompleted ? "true" : "false",
                "shaderWarmupMs", shaderWarmupMs.HasValue
                    ? CanonicalJson.Number(shaderWarmupMs.Value)
                    : "null");
            return CanonicalJson.Object(
                "benchmarkId", CanonicalJson.String(benchmarkId),
                "frameIntervalsMs", intervals.ToString(),
                "graphics", graphics,
                "memoryMb", memoryMb.HasValue ? CanonicalJson.Number(memoryMb.Value) : "null",
                "quality", CanonicalJson.String(quality),
                "thermalState", CanonicalJson.String(thermalState),
                "warmup", warmup);
        }

        public static string UnloadedPayload(double? retainedMemoryMb)
        {
            return CanonicalJson.Object(
                "retainedMemoryMb",
                retainedMemoryMb.HasValue ? CanonicalJson.Number(retainedMemoryMb.Value) : "null");
        }

        private static void RequireText(string value, string fieldName)
        {
            if (string.IsNullOrEmpty(value))
                throw new BridgeValidationException(fieldName + " is required.");
        }
    }
}
