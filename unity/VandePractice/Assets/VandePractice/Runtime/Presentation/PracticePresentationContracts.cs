using System;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation
{
    public enum PracticePresentationQuality
    {
        Lite,
        Standard,
        High
    }

    public sealed class PracticePresentationSettings
    {
        public string Locale { get; set; }
        public PracticePresentationQuality Quality { get; set; }
        public string Assistance { get; set; }
        public string Handedness { get; set; }
        public bool ReducedMotion { get; set; }
        public bool Captions { get; set; }
        public bool Audio { get; set; }
        public bool Haptics { get; set; }
        public float TextScale { get; set; } = 1f;
        public bool HighContrast { get; set; }
        // Zero means an isolated/editor caller did not supply the bridge-owned
        // Android density and should retain the legacy Screen.dpi fallback.
        public float PixelsPerDp { get; set; }
    }

    public sealed class PracticeScenePresentation
    {
        public string Conditions { get; set; }
        public string FieldId { get; set; }
        public string FieldIntent { get; set; }
        public string TrainingObjective { get; set; }
        public string BowlerFamily { get; set; }
        public string BowlerArm { get; set; }
        public string BowlerLookSeed { get; set; }
        public string BowlerPaceBand { get; set; }
        public string BowlerSpinType { get; set; }
        public string BallColour { get; set; }
        public string BallAge { get; set; }
        public string Handedness { get; set; }
        public double BatterLateralM { get; set; }
        public double BatterCreaseOffsetM { get; set; }
        public PracticeFielderPresentation[] Fielders { get; set; }
    }

    public sealed class PracticeFielderPresentation
    {
        public string Id { get; set; }
        public string Role { get; set; }
        public double X { get; set; }
        public double Z { get; set; }
    }

    public sealed class PracticeDeliveryPresentation
    {
        public int OverIndex { get; set; }
        public int BallIndex { get; set; }
        // The delivery record's seed (the wire's host.delivery seed, equal to flight.seed). With the over and ball
        // index it keys every deterministic take choice, exactly as the web's deliveryTakeKey().
        public string Seed { get; set; }
        // The host plan remains the single truth. Variation and speed may select
        // a physically plausible bowler cue; projected line/length are retained
        // for contract parity but deliberately never enter cue selection. Unity
        // never re-aims, re-times or re-scores the delivery.
        public string Variation { get; set; }
        public double PlannedLengthM { get; set; }
        public double PlannedLineM { get; set; }
        public double PlannedSpeedKph { get; set; }
        public BallTraceSample[] Flight { get; set; }
        public double? BounceT { get; set; }
        public double IdealContactT { get; set; }
        public double StumpsT { get; set; }
        public TraceVector3 SpinAxis { get; set; }
        public TraceVector3 AfterBounceSpinAxis { get; set; }
        public TraceVector3 SeamAxis { get; set; }
        public TraceVector3 ShineDirection { get; set; }
        public double ReleaseSpeedKph { get; set; }
        public double ReleaseSeamDeg { get; set; }
        public double SpinRps { get; set; }
        public double SeamWobble { get; set; }
        public bool LearnCue { get; set; }
        public PracticeCoachGuidePresentation CoachGuide { get; set; }
    }

    public sealed class PracticeCoachGuidePresentation
    {
        public int Stage { get; set; }
        public double? ContactT { get; set; }
        public TraceVector3 ContactPoint { get; set; }
    }

    public sealed class PracticeSwingPresentation
    {
        public string Kind { get; set; }
        public double StartT { get; set; }
        public double DirectionDeg { get; set; }
        public double Power { get; set; }
        public double Elevation { get; set; }
        public string Footwork { get; set; }
    }

    public sealed class PracticeResultPresentation
    {
        public CanonicalDeliveryTrace Trace { get; set; }
        public PracticeBatterBodyFramePresentation BatterBodyFrame { get; set; }
        public string ReplayDigest { get; set; }
        public int TotalRuns { get; set; }
        public int Wickets { get; set; }
        public int Balls { get; set; }
        public int DeliveryRuns { get; set; }
        public string Dismissal { get; set; }
        public string ShotIntent { get; set; }
        public string Footwork { get; set; }
        /// <summary>The player's normalized swing start (record.swing.startT, s after release); null for a leave.</summary>
        public double? SwingStartT { get; set; }
        /// <summary>The player's swing direction (record.swing.directionDeg, + off side); 0 for a leave.</summary>
        public double SwingDirectionDeg { get; set; }
        public double PlaybackSpeed { get; set; }
        public bool IsReplay { get; set; }
        // The record's identity (a replay keys its takes on it, so it sounds as the live ball did) and the physics'
        // contact facts and catcher, all already validated. Presentation only.
        public string RecordSeed { get; set; }
        public int RecordOverIndex { get; set; }
        public int RecordBallIndex { get; set; }
        public string ContactKind { get; set; }
        public string ContactTiming { get; set; }
        public string OutcomeFielderId { get; set; }
    }

    public sealed class PracticeDemonstrationPresentation
    {
        public PracticeDeliveryPresentation Delivery { get; set; }
        public PracticeResultPresentation Result { get; set; }
    }

    public sealed class PracticeBatterBodyFramePresentation
    {
        public TraceVector2 Stance { get; set; }
        public TraceVector3 TorsoTop { get; set; }
        public TraceVector3 HeadCentre { get; set; }
    }

    public sealed class PracticeBenchmarkRequest
    {
        public string BenchmarkId { get; set; }
        public double DurationMs { get; set; }
        public int WarmupFrames { get; set; }
        public int SampleCap { get; set; }
        public PracticePresentationQuality Quality { get; set; }
    }

    public static class PracticePresentationContractAdapter
    {
        public static PracticePresentationSettings Initialize(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.initialize");
            var value = Parse<InitializePayload>(envelope.payloadJson, "host.initialize");
            return new PracticePresentationSettings
            {
                Locale = value.locale,
                Quality = ParseQuality(value.quality),
                Assistance = value.assistance,
                Handedness = value.handedness,
                ReducedMotion = value.reducedMotion,
                Captions = value.captions,
                Audio = value.audio,
                Haptics = value.haptics,
                TextScale = value.textScale,
                HighContrast = value.highContrast,
                PixelsPerDp = value.pixelsPerDp
            };
        }

        public static PracticeScenePresentation Scene(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.scene");
            var value = Parse<ScenePayload>(envelope.payloadJson, "host.scene");
            if (value.field == null || value.field.fielders == null || value.field.fielders.Length != 11 ||
                value.bowler == null || value.ball == null || value.batterPosition == null)
            {
                throw new BridgeValidationException("host.scene is incomplete for presentation.");
            }

            var fielders = new PracticeFielderPresentation[value.field.fielders.Length];
            for (var index = 0; index < fielders.Length; index++)
            {
                var source = value.field.fielders[index];
                if (source == null) throw new BridgeValidationException("host.scene contains a null fielder.");
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = source.id,
                    Role = source.role,
                    X = source.x,
                    Z = source.z
                };
            }

            return new PracticeScenePresentation
            {
                Conditions = value.conditions,
                FieldId = value.field.id,
                FieldIntent = value.fieldIntent,
                TrainingObjective = value.trainingObjective,
                BowlerFamily = value.bowler.family,
                BowlerArm = value.bowler.arm,
                BowlerLookSeed = value.bowler.lookSeed,
                BowlerPaceBand = value.bowler.paceBand,
                BowlerSpinType = value.bowler.spinType,
                BallColour = value.ball.colour,
                BallAge = value.ball.age,
                Handedness = value.handedness,
                BatterLateralM = value.batterPosition.lateralM,
                BatterCreaseOffsetM = value.batterPosition.creaseOffsetM,
                Fielders = fielders
            };
        }

        public static PracticeDeliveryPresentation Delivery(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.delivery");
            return DeliveryFromValidatedPayload(envelope.payloadJson, "host.delivery", envelope.ParsedPayload());
        }

        internal static PracticeDemonstrationPresentation DemonstrationFromValidated(
            UnityPracticeEnvelope envelope)
        {
            if (envelope == null || envelope.type != "host.demonstration")
                throw new BridgeValidationException("host.demonstration is required.");
            var root = envelope.ParsedPayload();
            return new PracticeDemonstrationPresentation
            {
                Delivery = DeliveryFromValidatedPayload(root.Raw("delivery"), "host.demonstration.delivery", root.Object("delivery")),
                Result = ResultFromValidated(envelope)
            };
        }

        private static PracticeDeliveryPresentation DeliveryFromValidatedPayload(
            string payload,
            string name,
            StrictJsonObject payloadJson)
        {
            var value = Parse<DeliveryPayload>(payload, name);
            if (value.plan == null || value.flight == null || value.flight.samples == null ||
                value.flight.release == null ||
                value.flight.spin == null || value.flight.seam == null || value.presentation == null)
            {
                throw new BridgeValidationException(name + " is incomplete for presentation.");
            }

            var presentationJson = payloadJson.Object("presentation");
            var flightJson = payloadJson.Object("flight");
            var spinJson = flightJson.Object("spin");
            PracticeCoachGuidePresentation coachGuide = null;
            // JsonUtility materializes a default nested DTO even when the wire
            // value is explicitly null. Use the already-validated canonical JSON
            // as the source of truth for the nullable Coach branch.
            if (!presentationJson.IsNull("coach"))
            {
                var coachJson = presentationJson.Object("coach");
                coachGuide = new PracticeCoachGuidePresentation
                {
                    Stage = value.presentation.coach.stage,
                    ContactT = coachJson.IsNull("contactT")
                        ? (double?)null
                        : coachJson.Number("contactT"),
                    ContactPoint = value.presentation.coach.contactPoint
                };
            }

            return new PracticeDeliveryPresentation
            {
                OverIndex = value.overIndex,
                BallIndex = value.ballIndex,
                Seed = payloadJson.String("seed"),
                Variation = value.plan.variation,
                PlannedLengthM = value.plan.lengthM,
                PlannedLineM = value.plan.lineM,
                PlannedSpeedKph = value.plan.speedKph,
                Flight = value.flight.samples,
                BounceT = flightJson.IsNull("bounce")
                    ? (double?)null
                    : flightJson.Object("bounce").Number("t"),
                IdealContactT = flightJson.Number("idealContactT"),
                StumpsT = flightJson.Number("stumpsT"),
                SpinAxis = value.flight.spin.release,
                AfterBounceSpinAxis = spinJson.IsNull("afterBounce")
                    ? null
                    : value.flight.spin.afterBounce,
                SeamAxis = value.flight.seam.axis,
                ShineDirection = value.flight.seam.shine,
                ReleaseSpeedKph = value.flight.release.speedKph,
                ReleaseSeamDeg = value.flight.release.seamDeg,
                SpinRps = value.flight.release.spinRps,
                SeamWobble = value.flight.seam.wobble,
                LearnCue = value.presentation.learnCue,
                CoachGuide = coachGuide
            };
        }

        public static PracticeSwingPresentation ProvisionalSwing(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.provisional_swing");
            var value = Parse<ProvisionalSwingPayload>(envelope.payloadJson, "host.provisional_swing");
            if (value.swing == null)
                throw new BridgeValidationException("host.provisional_swing is missing swing intent.");
            return new PracticeSwingPresentation
            {
                Kind = value.swing.kind,
                StartT = value.swing.startT,
                DirectionDeg = value.swing.directionDeg,
                Power = value.swing.power,
                Elevation = value.swing.elevation,
                Footwork = value.swing.footwork
            };
        }

        public static PracticePresentationQuality Profile(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.profile");
            return ParseQuality(envelope.ParsedPayload().String("quality"));
        }

        public static string Locale(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.locale");
            return envelope.ParsedPayload().String("locale");
        }

        public static PracticeBenchmarkRequest Benchmark(UnityPracticeEnvelope envelope)
        {
            RequireType(envelope, "host.benchmark");
            var payload = envelope.ParsedPayload();
            return new PracticeBenchmarkRequest
            {
                BenchmarkId = payload.String("benchmarkId"),
                DurationMs = payload.Number("durationMs"),
                Quality = ParseQuality(payload.String("quality")),
                SampleCap = CheckedInt(payload.Integer("sampleCap"), "sampleCap"),
                WarmupFrames = CheckedInt(payload.Integer("warmupFrames"), "warmupFrames")
            };
        }

        public static PracticeResultPresentation Result(UnityPracticeEnvelope envelope)
        {
            if (envelope.type != "host.result" && envelope.type != "host.replay" &&
                envelope.type != "host.demonstration")
                throw new BridgeValidationException("host.result, host.replay or host.demonstration is required.");
            BridgeValidator.ValidateEnvelope(envelope);
            return ResultFromValidated(envelope);
        }

        /// <summary>
        /// Projects a result already validated by UnityPracticePacketCodec.
        /// Runtime consumers use this path so a large canonical trace is not
        /// recursively validated again after crossing the trust boundary.
        /// </summary>
        internal static PracticeResultPresentation ResultFromValidated(UnityPracticeEnvelope envelope)
        {
            if (envelope == null || (envelope.type != "host.result" && envelope.type != "host.replay" &&
                                     envelope.type != "host.demonstration"))
                throw new BridgeValidationException("host.result, host.replay or host.demonstration is required.");
            var root = envelope.ParsedPayload();
            var resolution = envelope.type == "host.result" ? root : root.Object("resolution");
            var result = resolution.Object("result");
            var record = resolution.Object("record");
            var outcome = result.Object("outcome");
            var score = resolution.Object("score");
            var batterBodyFrame = result.Object("batterBodyFrame");
            return new PracticeResultPresentation
            {
                Trace = UnityPracticeResultTraceAdapter.FromValidatedResolution(
                    envelope.deliveryId, envelope.simVersion, resolution),
                BatterBodyFrame = new PracticeBatterBodyFramePresentation
                {
                    Stance = new TraceVector2
                    {
                        x = batterBodyFrame.Object("stance").Number("x"),
                        z = batterBodyFrame.Object("stance").Number("z")
                    },
                    TorsoTop = ParseTraceVector(batterBodyFrame.Object("torsoTop")),
                    HeadCentre = ParseTraceVector(batterBodyFrame.Object("headCentre"))
                },
                ReplayDigest = resolution.String("replayDigest"),
                TotalRuns = CheckedInt(score.Integer("runs"), "score.runs"),
                Wickets = CheckedInt(score.Integer("wickets"), "score.wickets"),
                Balls = CheckedInt(score.Integer("balls"), "score.balls"),
                DeliveryRuns = CheckedInt(outcome.Integer("runs"), "outcome.runs"),
                Dismissal = outcome.String("dismissal", true),
                ShotIntent = record.IsNull("swing")
                    ? "leave"
                    : record.Object("swing").String("kind"),
                Footwork = result.String("footwork"),
                SwingStartT = record.IsNull("swing") ? (double?)null : record.Object("swing").Number("startT"),
                SwingDirectionDeg = record.IsNull("swing") ? 0.0 : record.Object("swing").Number("directionDeg"),
                PlaybackSpeed = envelope.type == "host.replay" || envelope.type == "host.demonstration"
                    ? root.Number("speed")
                    : 1.0,
                IsReplay = envelope.type == "host.replay" || envelope.type == "host.demonstration",
                RecordSeed = record.String("seed"),
                RecordOverIndex = CheckedInt(record.Integer("overIndex"), "record.overIndex"),
                RecordBallIndex = CheckedInt(record.Integer("ballIndex"), "record.ballIndex"),
                ContactKind = result.Object("contact").String("kind"),
                ContactTiming = result.Object("contact").String("timing"),
                OutcomeFielderId = outcome.String("fielderId", true)
            };
        }

        private static TraceVector3 ParseTraceVector(StrictJsonObject value)
        {
            return new TraceVector3
            {
                x = value.Number("x"),
                y = value.Number("y"),
                z = value.Number("z")
            };
        }

        public static PracticePresentationQuality ParseQuality(string value)
        {
            switch (value)
            {
                case "lite": return PracticePresentationQuality.Lite;
                case "standard": return PracticePresentationQuality.Standard;
                case "high": return PracticePresentationQuality.High;
                default: throw new BridgeValidationException("Presentation quality is unsupported.");
            }
        }

        private static void RequireType(UnityPracticeEnvelope envelope, string type)
        {
            BridgeValidator.ValidateEnvelope(envelope);
            if (envelope.sender != "host" || envelope.type != type)
                throw new BridgeValidationException(type + " is required.");
        }

        private static T Parse<T>(string json, string name)
        {
            try
            {
                var value = JsonUtility.FromJson<T>(json);
                if (value == null) throw new Exception();
                return value;
            }
            catch (Exception)
            {
                throw new BridgeValidationException(name + " could not be projected for presentation.");
            }
        }

        private static int CheckedInt(long value, string field)
        {
            if (value < int.MinValue || value > int.MaxValue)
                throw new BridgeValidationException(field + " is outside the presentation range.");
            return (int)value;
        }

        [Serializable] private sealed class InitializePayload
        {
            public string locale;
            public string quality;
            public string handedness;
            public string assistance;
            public bool reducedMotion;
            public bool captions;
            public bool audio;
            public bool haptics;
            public float textScale;
            public bool highContrast;
            public float pixelsPerDp;
        }

        [Serializable] private sealed class ScenePayload
        {
            public string conditions;
            public SceneField field;
            public string fieldIntent;
            public string trainingObjective;
            public SceneBowler bowler;
            public SceneBall ball;
            public string handedness;
            public SceneBatterPosition batterPosition;
        }

        [Serializable] private sealed class SceneField
        {
            public string id;
            public SceneFielder[] fielders;
        }
        [Serializable] private sealed class SceneFielder
        {
            public string id;
            public string role;
            public double x;
            public double z;
        }
        [Serializable] private sealed class SceneBowler
        {
            public string family;
            public string arm;
            public string lookSeed;
            public string paceBand;
            public string spinType;
        }
        [Serializable] private sealed class SceneBall { public string colour; public string age; }
        [Serializable] private sealed class SceneBatterPosition
        {
            public double lateralM;
            public double creaseOffsetM;
        }

        [Serializable] private sealed class DeliveryPayload
        {
            public int overIndex;
            public int ballIndex;
            public DeliveryPlan plan;
            public DeliveryFlight flight;
            public DeliveryPresentation presentation;
        }

        [Serializable] private sealed class DeliveryPlan
        {
            public string variation;
            public double lengthM;
            public double lineM;
            public double speedKph;
        }

        [Serializable] private sealed class DeliveryPresentation
        {
            public bool learnCue;
            public DeliveryCoachGuide coach;
        }

        [Serializable] private sealed class DeliveryCoachGuide
        {
            public int stage;
            public double contactT;
            public TraceVector3 contactPoint;
        }

        [Serializable] private sealed class DeliveryFlight
        {
            public BallTraceSample[] samples;
            public DeliveryBounce bounce;
            public DeliveryRelease release;
            public DeliverySpin spin;
            public DeliverySeam seam;
        }

        [Serializable] private sealed class DeliveryBounce { public double t; }

        [Serializable] private sealed class DeliveryRelease
        {
            public double speedKph;
            public double seamDeg;
            public double spinRps;
        }
        [Serializable] private sealed class DeliverySpin
        {
            public TraceVector3 release;
            public TraceVector3 afterBounce;
        }
        [Serializable] private sealed class DeliverySeam
        {
            public TraceVector3 axis;
            public TraceVector3 shine;
            public double wobble;
        }

        [Serializable] private sealed class ProvisionalSwingPayload { public SwingPayload swing; }
        [Serializable] private sealed class SwingPayload
        {
            public string kind;
            public double startT;
            public double directionDeg;
            public double power;
            public double elevation;
            public string footwork;
        }
    }
}
