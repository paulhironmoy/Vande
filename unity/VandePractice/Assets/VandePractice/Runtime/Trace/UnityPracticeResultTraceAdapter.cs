using System;
using Vande.Practice.Bridge;

namespace Vande.Practice.Trace
{
    /// <summary>
    /// Projects only presentation traces out of the exact authoritative
    /// host.result payload. It deliberately has no score or collision API.
    /// </summary>
    public static class UnityPracticeResultTraceAdapter
    {
        public static CanonicalDeliveryTrace FromHostResult(UnityPracticeEnvelope envelope)
        {
            BridgeValidator.ValidateEnvelope(envelope);
            if (envelope.sender != "host" || envelope.type != "host.result" ||
                string.IsNullOrEmpty(envelope.deliveryId))
            {
                throw new BridgeValidationException("A delivery-scoped host.result is required.");
            }

            var resolution = StrictJsonObject.ParseCanonical(envelope.payloadJson);
            return FromValidatedResolution(envelope.deliveryId, envelope.simVersion, resolution);
        }

        public static CanonicalDeliveryTrace FromHostReplay(UnityPracticeEnvelope envelope)
        {
            BridgeValidator.ValidateEnvelope(envelope);
            if (envelope.sender != "host" || envelope.type != "host.replay" ||
                string.IsNullOrEmpty(envelope.deliveryId))
            {
                throw new BridgeValidationException("A delivery-scoped host.replay is required.");
            }

            var payload = StrictJsonObject.ParseCanonical(envelope.payloadJson);
            return FromValidatedResolution(
                envelope.deliveryId, envelope.simVersion, payload.Object("resolution"));
        }

        /// <summary>
        /// Projects a canonical trace after BridgeValidator has already checked
        /// the complete resolution and replay digest at the trust boundary.
        /// </summary>
        internal static CanonicalDeliveryTrace FromValidatedResolution(
            string deliveryId,
            int simulationVersion,
            StrictJsonObject payload)
        {
            try
            {
                var result = payload.Object("result");
                var trace = new CanonicalDeliveryTrace
                {
                    traceVersion = BridgeConstants.TraceVersion,
                    deliveryId = deliveryId,
                    simulationVersion = simulationVersion,
                    durationSeconds = result.Number("deadT"),
                    batterRootOffset = ParsePlanarVector(result.Object("batterRootOffset")),
                    batterPosture = ParseBatterPosture(result.Object("batterPosture")),
                    batterMotion = result.IsNull("batterMotion")
                        ? null
                        : ParseBatterMotion(result.Object("batterMotion")),
                    ball = ParseBall(result),
                    bat = ParseBat(result),
                    fielders = ParseFielders(result),
                    events = ParseEvents(result)
                };
                CanonicalTraceValidator.Validate(trace);
                return trace;
            }
            catch (BridgeValidationException)
            {
                throw;
            }
            catch (Exception)
            {
                throw new BridgeValidationException("host.result could not be projected into a presentation trace.");
            }
        }

        private static TraceBatterPosture ParseBatterPosture(StrictJsonObject value)
        {
            return new TraceBatterPosture { crouchM = value.Number("crouchM") };
        }

        private static TraceBatterMotion ParseBatterMotion(StrictJsonObject value)
        {
            return new TraceBatterMotion
            {
                startT = value.Number("startT"),
                contactT = value.Number("contactT"),
                endT = value.Number("endT")
            };
        }

        private static BallTraceSample[] ParseBall(StrictJsonObject result)
        {
            var source = result.ObjectArray("ball", BridgeConstants.MaxTraceSamplesPerChannel);
            var values = new BallTraceSample[source.Length];
            for (var index = 0; index < source.Length; index++)
            {
                values[index] = new BallTraceSample
                {
                    t = source[index].Number("t"),
                    p = ParseVector(source[index].Object("p")),
                    v = ParseVector(source[index].Object("v"))
                };
            }
            return values;
        }

        private static BatTraceSample[] ParseBat(StrictJsonObject result)
        {
            var source = result.ObjectArray("bat", BridgeConstants.MaxTraceSamplesPerChannel);
            var values = new BatTraceSample[source.Length];
            for (var index = 0; index < source.Length; index++)
            {
                values[index] = new BatTraceSample
                {
                    t = source[index].Number("t"),
                    grip = ParseVector(source[index].Object("grip")),
                    toe = ParseVector(source[index].Object("toe")),
                    face = ParseVector(source[index].Object("face"))
                };
            }
            return values;
        }

        private static FielderTracePath[] ParseFielders(StrictJsonObject result)
        {
            var source = result.ObjectArray("fielders", 11);
            var values = new FielderTracePath[source.Length];
            for (var pathIndex = 0; pathIndex < source.Length; pathIndex++)
            {
                var samples = source[pathIndex].ObjectArray(
                    "samples", BridgeConstants.MaxTraceSamplesPerChannel);
                var parsedSamples = new FielderTraceSample[samples.Length];
                for (var sampleIndex = 0; sampleIndex < samples.Length; sampleIndex++)
                {
                    parsedSamples[sampleIndex] = new FielderTraceSample
                    {
                        t = samples[sampleIndex].Number("t"),
                        x = samples[sampleIndex].Number("x"),
                        z = samples[sampleIndex].Number("z"),
                        action = samples[sampleIndex].String("action")
                    };
                }
                values[pathIndex] = new FielderTracePath
                {
                    fielderId = source[pathIndex].String("fielderId"),
                    samples = parsedSamples
                };
            }
            return values;
        }

        private static CanonicalTraceEvent[] ParseEvents(StrictJsonObject result)
        {
            var source = result.ObjectArray("events", BridgeConstants.MaxTraceEvents);
            var values = new CanonicalTraceEvent[source.Length];
            for (var index = 0; index < source.Length; index++)
            {
                var item = source[index];
                values[index] = new CanonicalTraceEvent
                {
                    t = item.Number("t"),
                    kind = item.String("kind"),
                    fielderId = OptionalString(item, "fielderId"),
                    contact = OptionalString(item, "contact"),
                    runs = OptionalInteger(item, "runs"),
                    completed = OptionalInteger(item, "completed"),
                    shortM = item.Contains("shortM") && !item.IsNull("shortM") ? item.Number("shortM") : 0.0,
                    p = item.Contains("p") && !item.IsNull("p")
                        ? ParseVector(item.Object("p"))
                        : null
                };
            }
            return values;
        }

        private static TraceVector3 ParseVector(StrictJsonObject value)
        {
            return new TraceVector3
            {
                x = value.Number("x"),
                y = value.Number("y"),
                z = value.Number("z")
            };
        }

        private static TraceVector2 ParsePlanarVector(StrictJsonObject value)
        {
            return new TraceVector2
            {
                x = value.Number("x"),
                z = value.Number("z")
            };
        }

        private static string OptionalString(StrictJsonObject value, string name)
        {
            return value.Contains(name) && !value.IsNull(name) ? value.String(name) : null;
        }

        private static int OptionalInteger(StrictJsonObject value, string name)
        {
            if (!value.Contains(name)) return 0;
            var parsed = value.Integer(name);
            if (parsed < int.MinValue || parsed > int.MaxValue)
                throw new BridgeValidationException(name + " exceeds the integer presentation domain.");
            return (int)parsed;
        }
    }
}
