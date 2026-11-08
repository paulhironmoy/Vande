using System;
using Vande.Practice.Bridge;

namespace Vande.Practice.Trace
{
    public static class CanonicalTraceValidator
    {
        private const double TimeTolerance = 0.000001;

        private static readonly string[] EventKinds =
        {
            "release",
            "bounce",
            "contact",
            "pad",
            "stumps",
            "keeper_take",
            "ball_bounce",
            "catch",
            "field",
            "throw",
            "boundary",
            "run",
            "dead"
        };

        public static void Validate(CanonicalDeliveryTrace trace)
        {
            Require(trace != null, "Canonical trace is required.");
            Require(trace.traceVersion == BridgeConstants.TraceVersion, "Trace version is unsupported.");
            BridgeValidator.ValidateRestrictedText(
                trace.deliveryId, BridgeConstants.MaxIdentifierLength, "deliveryId");
            Require(trace.simulationVersion == BridgeConstants.SimulationVersion,
                "Trace simulationVersion is unsupported.");
            Require(IsFinite(trace.durationSeconds) && trace.durationSeconds > 0.0 &&
                    trace.durationSeconds <= BridgeConstants.MaxTraceDurationSeconds,
                "Trace duration is invalid.");
            ValidateBatterRootOffset(trace.batterRootOffset);
            ValidateBatterPosture(trace.batterPosture);

            Require(trace.ball != null && trace.ball.Length >= 1 &&
                    trace.ball.Length <= BridgeConstants.MaxTraceSamplesPerChannel,
                "Ball samples are missing or exceed the limit.");
            Require(trace.bat != null &&
                    trace.bat.Length <= BridgeConstants.MaxTraceSamplesPerChannel,
                "Bat samples are missing or exceed the limit.");
            Require(trace.fielders != null && trace.fielders.Length == 11,
                "Exactly eleven authoritative fielder paths are required.");
            Require(trace.events != null && trace.events.Length >= 1 &&
                    trace.events.Length <= BridgeConstants.MaxTraceEvents,
                "Trace events are missing or exceed the limit.");

            // deadT is the authoritative playback completion point. Simulation
            // channels may include bounded post-dead follow-through samples for
            // interpolation, so validate them against the shared 30 s trace
            // domain rather than incorrectly requiring every channel to end at
            // exactly deadT.
            ValidateBallSamples(trace.ball, BridgeConstants.MaxTraceDurationSeconds);
            ValidateBatSamples(trace.bat, BridgeConstants.MaxTraceDurationSeconds);
            ValidateFielderPaths(trace.fielders, BridgeConstants.MaxTraceDurationSeconds);
            ValidateEvents(trace.events, BridgeConstants.MaxTraceDurationSeconds);
            ValidateBatterMotion(trace.batterMotion, trace.bat);
            ValidateBatContactKnot(trace.bat, trace.events);
            if (trace.bat.Length == 0)
            {
                var nominalTolerance = BridgeConstants.EmptyBatNominalToleranceMetres;
                Require(Math.Abs(trace.batterRootOffset.x) <= nominalTolerance &&
                        Math.Abs(trace.batterRootOffset.z) <= nominalTolerance,
                    "A trace without a swing must keep the batter at the nominal root.");
                Require(Math.Abs(trace.batterPosture.crouchM) <= nominalTolerance,
                    "A trace without a swing must keep the batter at the nominal posture.");
            }
        }

        private static void ValidateBatterRootOffset(TraceVector2 value)
        {
            Require(value != null && IsFinite(value.x) && IsFinite(value.z),
                "Batter root offset is missing or non-finite.");
            var maximum = BridgeConstants.MaxBatterRootOffsetMetres;
            Require(value.x * value.x + value.z * value.z <= maximum * maximum,
                "Batter root offset exceeds the authoritative 0.18 m cap.");
        }

        private static void ValidateBatterPosture(TraceBatterPosture value)
        {
            Require(value != null && IsFinite(value.crouchM),
                "Batter posture is missing or non-finite.");
            Require(value.crouchM >= 0.0 && value.crouchM <= BridgeConstants.MaxBatterCrouchMetres,
                "Batter crouch is outside the inclusive 0..0.18 m domain.");
        }

        private static void ValidateBatterMotion(
            TraceBatterMotion value,
            BatTraceSample[] bat)
        {
            if (bat.Length == 0)
            {
                Require(value == null, "Batter motion must be null exactly when bat samples are empty.");
                return;
            }
            Require(value != null, "Batter motion is required when bat samples are present.");
            Require(IsFinite(value.startT) && IsFinite(value.contactT) && IsFinite(value.endT),
                "Batter motion contains a non-finite time.");
            Require(value.startT >= 0.0 && value.endT <= BridgeConstants.MaxTraceDurationSeconds,
                "Batter motion is outside the canonical trace domain.");
            Require(value.startT < value.endT, "Batter motion requires startT < endT.");
            Require(value.contactT > value.startT && value.contactT < value.endT,
                "Batter motion contactT must be strictly inside its motion domain.");
            Require(value.startT == bat[0].t,
                "Batter motion startT must exactly equal the first bat knot.");
            Require(value.endT <= bat[bat.Length - 1].t,
                "Batter motion endT must not exceed the last bat knot.");
            var contactKnotMatches = 0;
            var contactKnotIndex = -1;
            var endKnotMatches = 0;
            var endKnotIndex = -1;
            for (var index = 0; index < bat.Length; index++)
            {
                if (Math.Abs(bat[index].t - value.contactT) <=
                    BridgeConstants.ExactTraceTimeToleranceSeconds)
                {
                    contactKnotMatches++;
                    contactKnotIndex = index;
                }
                if (Math.Abs(bat[index].t - value.endT) <=
                    BridgeConstants.ExactTraceTimeToleranceSeconds)
                {
                    endKnotMatches++;
                    endKnotIndex = index;
                }
            }
            Require(contactKnotMatches == 1,
                "Batter motion contactT requires exactly one bat knot within 1e-12 seconds.");
            Require(endKnotMatches == 1,
                "Batter motion endT requires exactly one bat knot within 1e-12 seconds.");
            Require(contactKnotIndex != endKnotIndex,
                "Batter motion contact and end anchors must resolve to distinct bat knots.");
            ValidateHeldBatKnots(bat, endKnotIndex);
        }

        private static void ValidateHeldBatKnots(BatTraceSample[] bat, int endKnotIndex)
        {
            var held = bat[endKnotIndex];
            for (var index = endKnotIndex + 1; index < bat.Length; index++)
            {
                Require(BatVectorNear(held.grip, bat[index].grip) &&
                        BatVectorNear(held.toe, bat[index].toe) &&
                        BatVectorNear(held.face, bat[index].face),
                    "Every bat knot after batterMotion.endT must hold the exact end pose within 1e-9.");
            }
        }

        private static bool BatVectorNear(TraceVector3 first, TraceVector3 second)
        {
            var tolerance = BridgeConstants.HeldBatPoseToleranceMetres;
            return Math.Abs(first.x - second.x) <= tolerance &&
                   Math.Abs(first.y - second.y) <= tolerance &&
                   Math.Abs(first.z - second.z) <= tolerance;
        }

        private static void ValidateBallSamples(BallTraceSample[] samples, double duration)
        {
            var previous = -1.0;
            for (var index = 0; index < samples.Length; index++)
            {
                var sample = samples[index];
                Require(sample != null, "Ball sample is null.");
                ValidateTime(sample.t, previous, duration, "ball");
                ValidateVector(sample.p, "ball position");
                ValidateVector(sample.v, "ball velocity");
                previous = sample.t;
            }

            Require(Math.Abs(samples[0].t) <= TimeTolerance, "Ball samples must begin at zero.");
        }

        private static void ValidateBatSamples(BatTraceSample[] samples, double duration)
        {
            var previous = -1.0;
            for (var index = 0; index < samples.Length; index++)
            {
                var sample = samples[index];
                Require(sample != null, "Bat sample is null.");
                ValidateTime(sample.t, previous, duration, "bat");
                if (index > 0)
                    Require(sample.t > previous, "Bat sample times must be strictly increasing.");
                ValidateVector(sample.grip, "bat grip");
                ValidateVector(sample.toe, "bat toe");
                ValidateVector(sample.face, "bat face");
                ValidateRigidBatKnot(sample);
                previous = sample.t;
            }
        }

        private static void ValidateRigidBatKnot(BatTraceSample sample)
        {
            var axisX = sample.grip.x - sample.toe.x;
            var axisY = sample.grip.y - sample.toe.y;
            var axisZ = sample.grip.z - sample.toe.z;
            var length = Math.Sqrt(axisX * axisX + axisY * axisY + axisZ * axisZ);
            Require(Math.Abs(length - BridgeConstants.CanonicalBatLengthMetres) <=
                    BridgeConstants.CanonicalBatLengthToleranceMetres,
                "Bat grip-to-toe length is not the canonical 0.86 m.");

            var faceLength = Math.Sqrt(
                sample.face.x * sample.face.x +
                sample.face.y * sample.face.y +
                sample.face.z * sample.face.z);
            Require(Math.Abs(faceLength - 1.0) <= BridgeConstants.CanonicalBatUnitTolerance,
                "Bat face must be a unit vector.");
            var dot = (axisX * sample.face.x + axisY * sample.face.y + axisZ * sample.face.z) / length;
            Require(Math.Abs(dot) <= BridgeConstants.CanonicalBatOrthogonalityTolerance,
                "Bat face must be orthogonal to the bat axis.");
        }

        private static void ValidateEvents(CanonicalTraceEvent[] events, double duration)
        {
            var previous = -1.0;
            for (var index = 0; index < events.Length; index++)
            {
                var traceEvent = events[index];
                Require(traceEvent != null, "Trace event is null.");
                ValidateTime(traceEvent.t, previous, duration, "event");
                Require(Contains(EventKinds, traceEvent.kind), "Trace event kind is unsupported.");
                switch (traceEvent.kind)
                {
                    case "release":
                    case "dead":
                        break;
                    case "contact":
                        Require(Contains(ContactKinds, traceEvent.contact),
                            "Trace contact kind is unsupported.");
                        ValidateVector(traceEvent.p, "event position");
                        break;
                    case "catch":
                    case "field":
                    case "throw":
                        BridgeValidator.ValidateRestrictedText(
                            traceEvent.fielderId, BridgeConstants.MaxIdentifierLength, "fielderId");
                        ValidateVector(traceEvent.p, "event position");
                        break;
                    case "boundary":
                        Require(traceEvent.runs == 4 || traceEvent.runs == 6,
                            "Boundary event runs are invalid.");
                        ValidateVector(traceEvent.p, "event position");
                        break;
                    case "run":
                        Require(traceEvent.completed >= 1, "Run event completion count is invalid.");
                        break;
                    default:
                        ValidateVector(traceEvent.p, "event position");
                        break;
                }
                previous = traceEvent.t;
            }
        }

        private static void ValidateBatContactKnot(
            BatTraceSample[] samples,
            CanonicalTraceEvent[] events)
        {
            var contactEvents = 0;
            var contactTime = 0.0;
            for (var index = 0; index < events.Length; index++)
            {
                if (events[index].kind != "contact" || !IsBatContact(events[index].contact)) continue;
                contactEvents++;
                contactTime = events[index].t;
            }
            Require(contactEvents <= 1, "A trace may contain at most one blade/handle contact event.");
            if (contactEvents == 0) return;

            var matchingKnots = 0;
            for (var index = 0; index < samples.Length; index++)
            {
                if (Math.Abs(samples[index].t - contactTime) <=
                    BridgeConstants.ExactTraceTimeToleranceSeconds)
                    matchingKnots++;
            }
            Require(matchingKnots == 1,
                "A blade/handle contact event requires exactly one bat knot within 1e-12 seconds.");
        }

        private static bool IsBatContact(string value)
        {
            return value == "middle" || value == "inside_edge" || value == "outside_edge" ||
                   value == "top_edge" || value == "leading_edge";
        }

        private static void ValidateFielderPaths(FielderTracePath[] paths, double duration)
        {
            var ids = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
            for (var pathIndex = 0; pathIndex < paths.Length; pathIndex++)
            {
                var path = paths[pathIndex];
                Require(path != null, "Fielder path is null.");
                BridgeValidator.ValidateRestrictedText(
                    path.fielderId, BridgeConstants.MaxIdentifierLength, "fielderId");
                Require(ids.Add(path.fielderId), "Fielder path ids must be unique.");
                Require(path.samples != null && path.samples.Length >= 1 &&
                        path.samples.Length <= BridgeConstants.MaxTraceSamplesPerChannel,
                    "Fielder samples are missing or exceed the limit.");
                var previous = -1.0;
                for (var sampleIndex = 0; sampleIndex < path.samples.Length; sampleIndex++)
                {
                    var sample = path.samples[sampleIndex];
                    Require(sample != null, "Fielder sample is null.");
                    ValidateTime(sample.t, previous, duration, "fielder");
                    Require(IsPresentationNumber(sample.x) && IsPresentationNumber(sample.z),
                        "Fielder position is outside the Unity presentation domain.");
                    Require(Contains(FielderActions, sample.action), "Fielder action is unsupported.");
                    previous = sample.t;
                }
            }
        }

        private static readonly string[] ContactKinds =
        {
            "middle", "inside_edge", "outside_edge", "top_edge", "leading_edge",
            "pad", "body", "miss", "leave"
        };

        private static readonly string[] FielderActions =
        {
            "set", "run", "dive", "catch", "drop", "pickup", "throw", "celebrate", "idle"
        };

        private static void ValidateTime(double value, double previous, double duration, string channel)
        {
            Require(IsFinite(value) && value >= 0.0 && value <= duration + TimeTolerance,
                channel + " sample time is outside the trace.");
            Require(value + TimeTolerance >= previous, channel + " sample time is not ordered.");
        }

        private static void ValidateVector(TraceVector3 vector, string field)
        {
            Require(vector != null && IsPresentationNumber(vector.x) &&
                    IsPresentationNumber(vector.y) && IsPresentationNumber(vector.z),
                field + " is outside the Unity presentation domain.");
        }

        private static bool IsPresentationNumber(double value)
        {
            return IsFinite(value) && Math.Abs(value) <= BridgeConstants.MaxPresentationMagnitude;
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static bool Contains(string[] values, string value)
        {
            for (var index = 0; index < values.Length; index++)
            {
                if (string.Equals(values[index], value, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static void Require(bool condition, string message)
        {
            if (!condition)
            {
                throw new BridgeValidationException(message);
            }
        }
    }
}
