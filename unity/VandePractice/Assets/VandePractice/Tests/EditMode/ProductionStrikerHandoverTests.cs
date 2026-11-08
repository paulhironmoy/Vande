using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    public sealed class ProductionStrikerHandoverTests
    {
        private const double Step = 1.0 / 60.0;
        private const double AcceptAfterRelease = 0.10;
        private const double HandoverWindowStart = 1.35;
        private const double HandoverWindowEnd = 1.60;
        // The legacy unedited grounded handover reversed an analytic IK branch in one 60 Hz frame: 176.868 degrees
        // (right, ForearmLeft) and 179.503 degrees (left, ForearmRight) at t=1.466667. The authored fast stroke can
        // legitimately move its exact grip target by 50-69 mm/frame and turn a continuous forearm by about 69 degrees,
        // so this regression gates the causal half-turn boundary rather than imposing an unrelated animation-speed cap.
        private const float MaximumContinuousArmStepDegrees = 90f;

        [TestCase("right")]
        [TestCase("left")]
        public void FrozenGroundedAttack_PackToCanonicalHandoverKeepsResolvedArmBranches(
            string handedness)
        {
            AssertArmsNeverPopAcross(handedness, HandoverWindowStart, HandoverWindowEnd);
        }

        // The whole stroke from the result's acceptance (UNITY-3 U-D 3): the visible hero's forearm turned 104.9 degrees and
        // its upper arm 86 in one frame at t = 0.583 s, when the elbow planes held across the pack-to-stroke handover were
        // released (the driver arms moved 4.5 degrees that frame). The same gate as above: a continuous arm turns less than
        // the causal half turn in a frame, and its elbow never changes side.
        [TestCase("right")]
        [TestCase("left")]
        public void FrozenGroundedAttack_WholeStrokeNeverPopsAnArmBranch(string handedness)
        {
            AssertArmsNeverPopAcross(handedness, 0.30, HandoverWindowEnd);
        }

        // The control: the same stroke with the old one-frame release of the handover's elbow plane
        // (ProductionCharacterRig.ElbowHandoverFixEnabled = false) does pop, so the test above can see the pop it guards against.
        [Test]
        public void FrozenGroundedAttack_WholeStroke_Control_TheOldReleasePopsAnArm()
        {
            var maximum = MaximumArmStepAcross("right", 0.30, HandoverWindowEnd, false);
            Assert.That(maximum, Is.GreaterThanOrEqualTo(MaximumContinuousArmStepDegrees),
                "the old release turned a visible arm by 104.9 degrees in one frame at t = 0.583 s; if this stroke no longer pops " +
                "without the fix, the whole-stroke test above has lost its sensitivity and needs a new control");
        }

        private static void AssertArmsNeverPopAcross(string handedness, double windowStart, double windowEnd)
        {
            MaximumArmStepAcross(handedness, windowStart, windowEnd, true);
        }

        private static float MaximumArmStepAcross(string handedness, double windowStart, double windowEnd, bool fix)
        {
            var fixture = LoadFixture();
            var item = fixture.cases.Single(value => value.id == "grounded-attack");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = handedness;

            var root = new GameObject("Production grounded pack-canonical handover " + handedness);
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = handedness,
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.High
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                world.PresentedHumansForEvidence().Single(pair => pair.Key == "striker").Value.ElbowHandoverFixEnabled = fix;

                var accepted = false;
                var sampled = 0;
                var priorLeftUpperRotation = Quaternion.identity;
                var priorLeftForearmRotation = Quaternion.identity;
                var priorRightUpperRotation = Quaternion.identity;
                var priorRightForearmRotation = Quaternion.identity;
                var priorLeftBend = Vector3.zero;
                var priorRightBend = Vector3.zero;
                var havePrior = false;
                var maximumArmStep = 0f;
                var maximumArmStepJoint = string.Empty;
                var maximumArmStepAt = 0.0;
                for (var frame = 0; frame < 1200 && world.TimelineForEvidence < windowEnd; frame++)
                {
                    if (!accepted && world.TimelineForEvidence >= AcceptAfterRelease)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                    }
                    world.Tick(Step);
                    if (world.TimelineForEvidence < windowStart) continue;

                    var striker = world.PresentedHumansForEvidence()
                        .Single(pair => pair.Key == "striker").Value;
                    Assert.That(world.StrikerRunningForTesting, Is.False,
                        "grounded-attack must exercise the two-hand pack-to-canonical handover");
                    if (fix)
                    {
                        Assert.That(Vector3.Distance(
                                striker.HeroHandWorldPosition(true),
                                striker.HeroBatterGripTargetWorld(true)),
                            Is.LessThan(0.002f), "left hand must remain on its exact ordered grip target");
                        Assert.That(Vector3.Distance(
                                striker.HeroHandWorldPosition(false),
                                striker.HeroBatterGripTargetWorld(false)),
                            Is.LessThan(0.002f), "right hand must remain on its exact ordered grip target");
                    }

                    var leftUpperRotation = striker.VisibleJointWorldRotation(
                        ProductionCharacterJoint.UpperArmLeft);
                    var leftForearmRotation = striker.VisibleJointWorldRotation(
                        ProductionCharacterJoint.ForearmLeft);
                    var rightUpperRotation = striker.VisibleJointWorldRotation(
                        ProductionCharacterJoint.UpperArmRight);
                    var rightForearmRotation = striker.VisibleJointWorldRotation(
                        ProductionCharacterJoint.ForearmRight);
                    var leftBend = ResolvedBend(striker, true);
                    var rightBend = ResolvedBend(striker, false);
                    if (havePrior)
                    {
                        var leftUpperStep = Quaternion.Angle(priorLeftUpperRotation, leftUpperRotation);
                        var leftForearmStep = Quaternion.Angle(priorLeftForearmRotation, leftForearmRotation);
                        var rightUpperStep = Quaternion.Angle(priorRightUpperRotation, rightUpperRotation);
                        var rightForearmStep = Quaternion.Angle(priorRightForearmRotation, rightForearmRotation);
                        RetainMaximumStep(ref maximumArmStep, ref maximumArmStepJoint,
                            ref maximumArmStepAt, "UpperArmLeft",
                            leftUpperStep,
                            world.TimelineForEvidence);
                        RetainMaximumStep(ref maximumArmStep, ref maximumArmStepJoint,
                            ref maximumArmStepAt, "ForearmLeft",
                            leftForearmStep,
                            world.TimelineForEvidence);
                        RetainMaximumStep(ref maximumArmStep, ref maximumArmStepJoint,
                            ref maximumArmStepAt, "UpperArmRight",
                            rightUpperStep,
                            world.TimelineForEvidence);
                        RetainMaximumStep(ref maximumArmStep, ref maximumArmStepJoint,
                            ref maximumArmStepAt, "ForearmRight",
                            rightForearmStep,
                            world.TimelineForEvidence);
                        if (fix && priorLeftBend.sqrMagnitude > 0.000001f && leftBend.sqrMagnitude > 0.000001f)
                            Assert.That(Vector3.Dot(priorLeftBend, leftBend), Is.GreaterThan(0f),
                                handedness + " left elbow branch inverted at t=" +
                                world.TimelineForEvidence.ToString("F6"));
                        if (fix && priorRightBend.sqrMagnitude > 0.000001f && rightBend.sqrMagnitude > 0.000001f)
                            Assert.That(Vector3.Dot(priorRightBend, rightBend), Is.GreaterThan(0f),
                                handedness + " right elbow branch inverted at t=" +
                                world.TimelineForEvidence.ToString("F6"));
                    }
                    priorLeftUpperRotation = leftUpperRotation;
                    priorLeftForearmRotation = leftForearmRotation;
                    priorRightUpperRotation = rightUpperRotation;
                    priorRightForearmRotation = rightForearmRotation;
                    priorLeftBend = leftBend;
                    priorRightBend = rightBend;
                    havePrior = true;
                    sampled++;
                }

                Assert.That(accepted, Is.True);
                Assert.That(sampled, Is.GreaterThanOrEqualTo(12),
                    "the focused regression must cover frames on both sides of the deterministic handover");
                if (fix)
                    Assert.That(maximumArmStep, Is.LessThan(MaximumContinuousArmStepDegrees),
                        handedness + " pack-to-canonical handover must not contain a visible arm pop at 60 Hz; " +
                        "max=" + maximumArmStep.ToString("F6") + " joint=" + maximumArmStepJoint +
                        " t=" + maximumArmStepAt.ToString("F6"));
                return maximumArmStep;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static void RetainMaximumStep(
            ref float maximum,
            ref string joint,
            ref double at,
            string candidateJoint,
            float candidate,
            double candidateAt)
        {
            if (candidate <= maximum) return;
            maximum = candidate;
            joint = candidateJoint;
            at = candidateAt;
        }

        private static Vector3 ResolvedBend(ProductionCharacterRig rig, bool left)
        {
            var shoulder = rig.VisibleJointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var elbow = rig.VisibleJointWorldPosition(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight);
            var hand = rig.VisibleJointWorldPosition(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
            var reach = hand - shoulder;
            if (reach.sqrMagnitude <= 0.000001f) return Vector3.zero;
            var direction = reach.normalized;
            var bend = elbow - shoulder;
            bend -= direction * Vector3.Dot(bend, direction);
            return bend.sqrMagnitude > 0.000001f ? bend.normalized : Vector3.zero;
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static GoldenFixture LoadFixture()
        {
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore("practice-v3 shared golden is required for the grounded handover regression.");
            return JsonUtility.FromJson<GoldenFixture>(File.ReadAllText(path));
        }

        [Serializable]
        private sealed class GoldenFixture { public GoldenCase[] cases; }

        [Serializable]
        private sealed class GoldenCase { public string id; public GoldenWire wire; }

        [Serializable]
        private sealed class GoldenWire { public GoldenPackets packets; }

        [Serializable]
        private sealed class GoldenPackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
        }

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
