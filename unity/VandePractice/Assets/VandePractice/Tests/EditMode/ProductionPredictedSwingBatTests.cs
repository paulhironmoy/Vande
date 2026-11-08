using System;
using System.Collections.Generic;
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
    /// <summary>
    /// UNITY-7 task B. The bat a committed swing draws until the result arrives is the swing's predicted physics bat
    /// (ProductionPredictedSwingBat), not the code-authored stroke's (hands 0.96 m high, 62 to 90 cm from the physics bat in the frame
    /// the result arrived); the arms' elbow memory after the accept is the frame on screen's. Golden practice-v3, the host's swing
    /// start (a tap's press), accepted 0, 1, 3, 5, 6, 7 and 10 frames after a 50 or 120 ms commitment.
    /// </summary>
    public sealed class ProductionPredictedSwingBatTests
    {
        private const double Step = 1.0 / 60.0;

        private static ProductionTouchDownBat.BatPose Waiting() => new ProductionTouchDownBat.BatPose
        {
            Grip = new Vector3(0.2f, 1.54f, 9.0f),
            Toe = new Vector3(0.2f, 1.54f - 0.5f, 9.0f + 0.7f),
            Face = new Vector3(0f, 0.7f, -0.7f)
        };

        // ---- the geometry -------------------------------------------------------------------------------------------------

        [Test]
        public void ContactPose_PutsTheSweetSpotOnTheAimWithTheWaitingBatsLengthAndFace()
        {
            var waiting = Waiting();
            var aim = new Vector3(-0.1f, 0.93f, 9.01f);
            var contact = ProductionPredictedSwingBat.ContactPose(waiting, aim);
            var length = (waiting.Toe - waiting.Grip).magnitude;
            Assert.That((contact.Toe - contact.Grip).magnitude, Is.EqualTo(length).Within(1e-5f));
            var along = (contact.Toe - contact.Grip).normalized;
            Assert.That(Vector3.Distance(contact.Grip + along * (ProductionPredictedSwingBat.SweetFromCapMetres * length / 0.86f), aim),
                Is.LessThan(1e-4f), "the sweet spot is on the ball");
            Assert.That(contact.Grip.y - aim.y, Is.EqualTo(0.7368f).Within(0.005f), "the hands 0.737 m above the sweet spot (the physics bat's)");
            // The face rolls with the swing and no more: the shortest turn from the waiting bat to the contact direction carries it.
            var turn = Quaternion.FromToRotation((waiting.Toe - waiting.Grip).normalized, along);
            Assert.That(Vector3.Distance(contact.Face, turn * waiting.Face), Is.LessThan(1e-5f));
        }

        [Test]
        public void TheBat_IsTheWaitingBatAtTheStart_NeverMovesBeforeIt_AndIsTheContactBatFromTheArrival()
        {
            var waiting = Waiting();
            var aim = new Vector3(0.3f, 0.2f, 8.3f);
            var plan = new ProductionPredictedSwingBat();
            plan.Plan(waiting, aim, 0.40, ProductionPredictedSwingBat.TravelSeconds("attack", 0.7));
            var contact = ProductionPredictedSwingBat.ContactPose(waiting, aim);
            foreach (var t in new[] { 0.0, 0.20, 0.399999 })
            {
                var before = plan.At(t);
                Assert.That(before.Grip, Is.EqualTo(waiting.Grip), "no movement before the input, at " + t);
                Assert.That(before.Toe, Is.EqualTo(waiting.Toe));
            }
            Assert.That(plan.At(0.40).Grip, Is.EqualTo(waiting.Grip));
            var arrive = 0.40 + ProductionPredictedSwingBat.TravelSeconds("attack", 0.7);
            foreach (var t in new[] { arrive, arrive + 0.05, arrive + 1.0 })
            {
                var after = plan.At(t);
                Assert.That(Vector3.Distance(after.Grip, contact.Grip), Is.LessThan(1e-5f), "the contact bat from the arrival, at " + t);
                Assert.That(Vector3.Distance(after.Toe, contact.Toe), Is.LessThan(1e-5f));
            }
        }

        [Test]
        public void TheHandsTravelStraightAndTheBladeHoldsBackUntilTheLastFortyMilliseconds()
        {
            var waiting = Waiting();
            var aim = new Vector3(0.1f, 0.93f, 9.0f);
            var plan = new ProductionPredictedSwingBat();
            const double start = 0.30;
            var travel = ProductionPredictedSwingBat.TravelSeconds("defend", 0.0);
            plan.Plan(waiting, aim, start, travel);
            var contact = ProductionPredictedSwingBat.ContactPose(waiting, aim);
            var contactDirection = (contact.Toe - contact.Grip).normalized;
            var holdEnd = start + travel - ProductionPredictedSwingBat.DownswingSeconds;
            var held = plan.At(holdEnd);
            Assert.That(Vector3.Angle((held.Toe - held.Grip).normalized, contactDirection),
                Is.EqualTo(ProductionPredictedSwingBat.HoldBackDegrees).Within(0.5f), "the blade is held 30 degrees back of the contact pose");
            Func<ProductionTouchDownBat.BatPose, Vector3> hands = pose =>
                pose.Grip + (pose.Toe - pose.Grip).normalized * ProductionTouchDownBat.HandsFromCapMetres;
            Assert.That(Vector3.Distance(hands(held), hands(contact)), Is.LessThan(1e-4f), "the hands are where the contact's are by the hold");
            var previous = Vector3.Angle((held.Toe - held.Grip).normalized, contactDirection);
            for (var k = 1; k <= 6; k++)
            {
                var pose = plan.At(holdEnd + k * 0.040 / 6.0);
                var angle = Vector3.Angle((pose.Toe - pose.Grip).normalized, contactDirection);
                Assert.That(angle, Is.LessThan(previous + 1e-3f), "the blade swings down, never back, step " + k);
                previous = angle;
            }
            Assert.That(previous, Is.LessThan(0.5f));
        }

        [Test]
        public void TheTravelIsThePhysicsBatTravel()
        {
            Assert.That(ProductionPredictedSwingBat.TravelSeconds("defend", 0.9), Is.EqualTo(0.120).Within(1e-12));
            Assert.That(ProductionPredictedSwingBat.TravelSeconds("attack", 0.0), Is.EqualTo(0.120).Within(1e-12));
            Assert.That(ProductionPredictedSwingBat.TravelSeconds("attack", 1.0), Is.EqualTo(0.150).Within(1e-12));
            Assert.That(ProductionPredictedSwingBat.TravelSeconds("attack", 5.0), Is.EqualTo(0.150).Within(1e-12));
        }

        // ---- the hand-over on the goldens ---------------------------------------------------------------------------------

        private static readonly ProductionCharacterJoint[] Arms =
        {
            ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft,
            ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight
        };

        private sealed class Frame
        {
            public double T;
            public Quaternion[] Arm;
            public float LeftOff, RightOff;
            public Vector3 BatCap, BatToe;
        }

        private sealed class Played
        {
            public List<Frame> Frames = new List<Frame>();
            public int CommitIndex = -1;
            public int AcceptIndex = -1;
        }

        public static IEnumerable<TestCaseData> Classes()
        {
            foreach (var id in new[] { "grounded-attack", "thin-edge" })
            foreach (var commit in new[] { 0.05, 0.12 })
            foreach (var frames in new[] { 0, 1, 3, 5, 6, 7, 10 })
                yield return new TestCaseData(id, commit, frames);
        }

        private static Played Play(string id, double commitDelay, int acceptFrames, string hand = "right", bool predicted = true, bool keepMemory = true)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == id);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = hand;
            var root = new GameObject("predicted swing bat " + id);
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play", Handedness = hand, Locale = "en-IN", Quality = PracticePresentationQuality.Standard
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                world.PredictedCommittedBatEnabled = predicted;
                world.KeepElbowMemoryAcrossAccept = keepMemory;
                var striker = world.PresentedHumansForEvidence().Single(pair => pair.Key == "striker").Value;
                var swingStart = result.SwingStartT ?? 0.15;
                world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                world.BeginLocalPreparation();
                var played = new Played();
                var committed = false;
                var accepted = false;
                var countdown = acceptFrames;
                for (var step = 0; step < 90; step++)
                {
                    if (!committed && world.TimelineForEvidence >= swingStart + commitDelay - 1e-9)
                    {
                        // The host's provisional swing: the normalized swing start (a tap's press), not the commitment's time.
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack", StartT = swingStart, DirectionDeg = result.SwingDirectionDeg, Power = 0.7, Elevation = 0.1,
                            Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                        });
                        committed = true;
                        played.CommitIndex = played.Frames.Count;
                    }
                    if (committed && !accepted)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                            played.AcceptIndex = played.Frames.Count;
                        }
                        else countdown--;
                    }
                    world.Tick(Step);
                    var bat = striker.Bat;
                    played.Frames.Add(new Frame
                    {
                        T = world.TimelineForEvidence,
                        Arm = Arms.Select(striker.VisibleJointWorldRotation).ToArray(),
                        // Running with the bat in one hand (after the stroke) the other glove is off the handle by design.
                        LeftOff = striker.BatterOneHandCarry ? 0f : Vector3.Distance(striker.HeroHandWorldPosition(true), striker.HeroBatterGripTargetWorld(true)),
                        RightOff = striker.BatterOneHandCarry ? 0f : Vector3.Distance(striker.HeroHandWorldPosition(false), striker.HeroBatterGripTargetWorld(false)),
                        BatCap = bat.position,
                        BatToe = bat.position + bat.TransformDirection(Vector3.down) * 0.86f
                    });
                    if (accepted && played.Frames.Count > played.AcceptIndex + 14) break;
                }
                return played;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [TestCaseSource(nameof(Classes))]
        public void TheGlovesStayOnTheHandleFromTheCommitmentOn(string id, double commit, int acceptFrames)
        {
            var played = Play(id, commit, acceptFrames);
            for (var index = played.CommitIndex; index < played.Frames.Count; index++)
            {
                Assert.That(played.Frames[index].LeftOff, Is.LessThanOrEqualTo(0.005f), "left glove, frame " + (index - played.AcceptIndex) + " from the accept (" + id + ")");
                Assert.That(played.Frames[index].RightOff, Is.LessThanOrEqualTo(0.005f), "right glove, frame " + (index - played.AcceptIndex) + " from the accept (" + id + ")");
            }
        }

        [TestCaseSource(nameof(Classes))]
        public void NoArmBoneTurnsMoreThanAHundredDegreesInAFrameOfTheHandOver_AndTheArmsStayWithinTheirNamedBound(string id, double commit, int acceptFrames)
        {
            var played = Play(id, commit, acceptFrames);
            var worstDegrees = 0f;
            var worstRatio = 0.0;
            for (var index = played.AcceptIndex - 1; index <= Math.Min(played.AcceptIndex + 2, played.Frames.Count - 1); index++)
            {
                var dt = played.Frames[index].T - played.Frames[index - 1].T;
                for (var joint = 0; joint < Arms.Length; joint++)
                {
                    var degrees = Quaternion.Angle(played.Frames[index - 1].Arm[joint], played.Frames[index].Arm[joint]);
                    if (degrees > worstDegrees) worstDegrees = degrees;
                    if (index == played.AcceptIndex) worstRatio = Math.Max(worstRatio, degrees / dt / 1800.0);
                }
            }
            Assert.That(worstDegrees, Is.LessThanOrEqualTo(100f), "an arm bone's turn in a frame at the hand-over (" + id + ")");
            // The named limit: thin-edge's physics bat is 0.65 m from the left shoulder and the load body's arms and lean hold 0.64
            // (past it the gloves leave the handle), so accepted three frames after a 50 ms commitment the bat travels 35 cm at the
            // accept: 2.15x the section 9 arm cap. Every other class is within 1.5x (the old drawing: up to 5.7x).
            var bound = id == "thin-edge" && Math.Abs(commit - 0.05) < 1e-9 && acceptFrames == 3 ? 2.3 : 1.5;
            Assert.That(worstRatio, Is.LessThanOrEqualTo(bound), "arm bones at the accept against their 1800 deg/s cap (" + id + ")");
        }

        [TestCase("grounded-attack", 3)]
        [TestCase("thin-edge", 3)]
        public void TheOldCommittedBat_WasFarWorse_ThisIsTheControl(string id, int acceptFrames)
        {
            // The same hand-over with the code-authored stroke's bat and the accept's own solves overwriting the elbow memory.
            var now = Play(id, 0.05, acceptFrames);
            var old = Play(id, 0.05, acceptFrames, predicted: false, keepMemory: false);
            Func<Played, float> worst = played =>
            {
                var degrees = 0f;
                for (var joint = 0; joint < Arms.Length; joint++)
                    degrees = Math.Max(degrees, Quaternion.Angle(played.Frames[played.AcceptIndex - 1].Arm[joint], played.Frames[played.AcceptIndex].Arm[joint]));
                return degrees;
            };
            Assert.That(worst(now), Is.LessThan(worst(old) * 0.8f), "the arm turn at the accept (" + id + ")");
            Func<Played, float> batStep = played => Math.Max(
                Vector3.Distance(played.Frames[played.AcceptIndex - 1].BatCap, played.Frames[played.AcceptIndex].BatCap),
                Vector3.Distance(played.Frames[played.AcceptIndex - 1].BatToe, played.Frames[played.AcceptIndex].BatToe));
            Assert.That(batStep(now), Is.LessThan(batStep(old) * 0.7f), "the bat's step at the accept (" + id + ")");
        }

        [Test]
        public void TheArmsMemoryAfterTheAccept_IsTheFrameOnScreens_NotTheAcceptsOwnSolves()
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == "grounded-attack");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var root = new GameObject("arm memory");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.Standard
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                var striker = world.PresentedHumansForEvidence().Single(pair => pair.Key == "striker").Value;
                var swingStart = result.SwingStartT ?? 0.15;
                world.Tick(swingStart - world.TimelineForEvidence);
                world.BeginLocalPreparation();
                for (var frame = 0; frame < 6; frame++) world.Tick(Step);
                world.ApplyProvisionalSwing(new PracticeSwingPresentation
                {
                    Kind = "attack", StartT = swingStart, DirectionDeg = result.SwingDirectionDeg, Power = 0.7, Elevation = 0.1, Footwork = "auto"
                });
                for (var frame = 0; frame < 3; frame++) world.Tick(Step);
                var before = striker.CaptureElbowMemory();
                Assert.That(before, Is.Not.Null);
                world.AcceptResult(result);
                var after = striker.CaptureElbowMemory();
                for (var arm = 0; arm < 2; arm++)
                {
                    Assert.That(after[arm].Stamp, Is.EqualTo(before[arm].Stamp), "arm " + arm);
                    Assert.That(after[arm].HasNow, Is.EqualTo(before[arm].HasNow));
                    Assert.That(Quaternion.Angle(after[arm].Now, before[arm].Now), Is.LessThan(1e-4f), "the remembered upper arm");
                    Assert.That(after[arm].NowRoll, Is.EqualTo(before[arm].NowRoll));
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        // ---- plumbing -----------------------------------------------------------------------------------------------------

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        [Serializable] private sealed class Fixture { public Case[] cases; }
        [Serializable] private sealed class Case { public string id; public Wire wire; }
        [Serializable] private sealed class Wire { public Packets packets; }
        [Serializable]
        private sealed class Packets
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
