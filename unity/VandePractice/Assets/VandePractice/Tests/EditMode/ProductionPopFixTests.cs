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
    /// UNITY-9: the whole-delivery pop fixes (the scanner that found them is Editor/Evidence/VandeHumansEvidence.Pops.cs). Each test plays a golden
    /// delivery through the production world at 60 Hz exactly as the host does (the scene between balls, BeginDelivery, the press at the swing start, the
    /// commitment 50 ms later, the result some frames after it) and steps a bone every frame. Each fix has an internal seam whose default is the new
    /// behaviour; every test also plays the delivery with the seam off and asserts that the old behaviour had the defect, so the test fails if the fix is lost.
    /// </summary>
    public sealed class ProductionPopFixTests
    {
        private const double Step = 1.0 / 60.0;
        private GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = null;
        }

        [Serializable] private sealed class Fixture { public Case[] cases; }
        [Serializable] private sealed class Case { public string id; public Wire wire; }
        [Serializable] private sealed class Wire { public Packets packets; }
        [Serializable] private sealed class Packets
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

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static readonly ProductionCharacterJoint[] Watched =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Chest, ProductionCharacterJoint.Head,
            ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft,
            ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight
        };

        /// <summary>One played ball: per frame, the world state, the time against the release and the watched bones' world rotations of both actors; the bat's position.</summary>
        private sealed class Played
        {
            public readonly List<double> T = new List<double>();
            public readonly List<string> State = new List<string>();
            public readonly List<Quaternion[]> Bowler = new List<Quaternion[]>();
            public readonly List<Quaternion[]> Striker = new List<Quaternion[]>();
            public readonly List<Vector3> Bat = new List<Vector3>();
            public int AcceptFrame = -1;
            public List<float> ThrowGaps = new List<float>();

            public double Step(List<Quaternion[]> actor, int bone, int frame) =>
                frame <= 0 ? 0.0 : Quaternion.Angle(actor[frame - 1][bone], actor[frame][bone]);

            /// <summary>The largest one-frame turn of a watched bone of an actor between two times against the release (seconds).</summary>
            public double Worst(List<Quaternion[]> actor, ProductionCharacterJoint joint, double fromT, double toT)
            {
                var bone = Array.IndexOf(Watched, joint);
                var worst = 0.0;
                for (var frame = 1; frame < T.Count; frame++)
                    if (T[frame] >= fromT && T[frame] <= toT) worst = Math.Max(worst, Step(actor, bone, frame));
                return worst;
            }

            public double WorstBatStepCm(double fromT, double toT)
            {
                var worst = 0.0;
                for (var frame = 1; frame < T.Count; frame++)
                    if (T[frame] >= fromT && T[frame] <= toT) worst = Math.Max(worst, Vector3.Distance(Bat[frame - 1], Bat[frame]) * 100.0);
                return worst;
            }
        }

        /// <summary>
        /// The host's flow for a golden delivery: 180 frames of the scene between balls, the press at the recorded swing start, the commitment `commit` s after it, the
        /// result `late` frames after the commitment, then until `until` s after the release. `setup` may switch seams before the delivery.
        /// </summary>
        private Played Play(string caseId, string hand, int late, double until, Action<ProceduralPracticeWorld> setup = null, bool director = false)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == caseId);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = hand;
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = new GameObject("pop fix test");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.DirectorEnabled = director;
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play", Handedness = hand, Locale = "en-IN", Quality = PracticePresentationQuality.Standard
            }, new NullSink());
            world.ConfigureScene(scene);
            if (setup != null) setup(world);
            var humans = world.PresentedHumansForEvidence();
            var bowler = humans.First(pair => pair.Key == "bowler").Value;
            var striker = humans.First(pair => pair.Key == "striker").Value;
            var played = new Played();
            var releaseFrame = -1;
            Action tick = () =>
            {
                world.Tick(Step);
                played.T.Add(releaseFrame < 0 ? double.NaN : (played.T.Count - releaseFrame) * Step);
                played.State.Add(world.StateForEvidence);
                played.Bowler.Add(Watched.Select(bowler.VisibleJointWorldRotation).ToArray());
                played.Striker.Add(Watched.Select(striker.VisibleJointWorldRotation).ToArray());
                played.Bat.Add(striker.Bat != null ? striker.Bat.position : Vector3.zero);
                if (releaseFrame < 0 && world.StateForEvidence != "Idle" && world.StateForEvidence != "RunUp" && world.TimelineForEvidence >= -1e-9)
                {
                    releaseFrame = played.T.Count - 1;
                    played.T[releaseFrame] = 0.0;
                }
            };
            for (var k = 0; k < 180; k++) tick();
            world.BeginDelivery(delivery);
            var swingStart = result.SwingStartT ?? 0.15;
            while (world.TimelineForEvidence < swingStart - 1e-9) tick();
            world.BeginLocalPreparation();
            var committed = false;
            var accepted = false;
            var countdown = late;
            for (var guard = 0; guard < 2000; guard++)
            {
                if (!committed && world.TimelineForEvidence >= swingStart + 0.05 - 1e-9)
                {
                    world.ApplyProvisionalSwing(new PracticeSwingPresentation
                    {
                        Kind = "attack", StartT = swingStart, DirectionDeg = result.SwingDirectionDeg, Power = 0.7, Elevation = 0.1,
                        Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                    });
                    committed = true;
                }

                if (committed && !accepted)
                {
                    if (countdown <= 0)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                        played.AcceptFrame = played.T.Count;
                    }
                    else countdown--;
                }

                tick();
                if (accepted && releaseFrame >= 0 && played.T.Count > releaseFrame + (int)(until / Step)) break;
            }

            played.ThrowGaps.AddRange(world.HeldBallReleaseHandGapsForEvidence());
            return played;
        }

        // --- Fix 1: the bowler's heading after the planner has him ------------------------------------------------------------------------------------

        [Test]
        public void FollowHeading_TurnsTheShortWayAtABoundedRateAndAcceleration()
        {
            float rate = 0f;
            var yaw = 170f;
            var worstRate = 0f;
            var worstAcceleration = 0f;
            var previousRate = 0f;
            for (var frame = 0; frame < 240; frame++)
            {
                yaw = ProceduralPracticeWorld.FollowHeadingDegrees(yaw, ref rate, -170f, (float)Step);
                worstRate = Mathf.Max(worstRate, Mathf.Abs(rate));
                worstAcceleration = Mathf.Max(worstAcceleration, Mathf.Abs(rate - previousRate) / (float)Step);
                previousRate = rate;
            }

            Assert.That(Mathf.Abs(Mathf.DeltaAngle(yaw, -170f)), Is.LessThan(0.5f), "settles on the heading");
            Assert.That(worstRate, Is.LessThanOrEqualTo(ProceduralPracticeWorld.BowlerHeadingMaxDegreesPerSecond + 0.01f));
            Assert.That(worstAcceleration, Is.LessThanOrEqualTo(ProceduralPracticeWorld.BowlerHeadingAccelerationDegreesPerSecond2 + 1f));
            // 170 to -170 is a 20 degree turn across the wrap, not 340 the long way: it never passes through 0.
            var again = 170f;
            var againRate = 0f;
            for (var frame = 0; frame < 30; frame++)
            {
                again = ProceduralPracticeWorld.FollowHeadingDegrees(again, ref againRate, -170f, (float)Step);
                Assert.That(Mathf.Abs(Mathf.DeltaAngle(again, 180f)), Is.LessThan(25f), "stays near the wrap");
            }
        }

        [Test]
        public void FollowHeading_NeverOvershootsAndStandsStill()
        {
            for (var start = -180f; start < 180f; start += 37f)
                foreach (var target in new[] { -150f, -10f, 0f, 90f, 179f })
                {
                    var yaw = start;
                    var rate = 0f;
                    for (var frame = 0; frame < 600; frame++)
                    {
                        var before = Mathf.DeltaAngle(yaw, target);
                        yaw = ProceduralPracticeWorld.FollowHeadingDegrees(yaw, ref rate, target, (float)Step);
                        var after = Mathf.DeltaAngle(yaw, target);
                        Assert.That(before * after, Is.GreaterThanOrEqualTo(-1e-3f), "no overshoot from " + start + " to " + target + " at frame " + frame);
                    }

                    Assert.That(Mathf.Abs(Mathf.DeltaAngle(yaw, target)), Is.LessThan(0.2f));
                }

            var still = 33f;
            var stillRate = 0f;
            Assert.That(ProceduralPracticeWorld.FollowHeadingDegrees(still, ref stillRate, 90f, 0f), Is.EqualTo(33f), "no time, no turn");
        }

        [TestCase("deliberate-loft", "right")]
        [TestCase("thin-edge", "left")]
        [TestCase("grounded-attack", "right")]
        public void BowlerAfterAHitBall_TurnsHisHipsNoFasterThanTheSpineCap(string caseId, string hand)
        {
            // MOTION-SPEC section 9: hips, spine and chest <= 600 deg/s = 10 deg a frame. The old slerp from the follow-through heading to the planner's moving
            // heading turned them 20 to 25 degrees in one frame at release + 1.1 to 1.2 s.
            var played = Play(caseId, hand, 6, 3.0);
            var legacy = Play(caseId, hand, 6, 3.0, w => w.BowlerHeadingFollowerEnabled = false);
            var now = played.Worst(played.Bowler, ProductionCharacterJoint.Hips, 0.3, 3.0);
            var before = legacy.Worst(legacy.Bowler, ProductionCharacterJoint.Hips, 0.3, 3.0);
            TestContext.WriteLine(caseId + " " + hand + ": the bowler's hips, largest one-frame turn: " + now.ToString("0.0") + " deg now, " + before.ToString("0.0") + " deg with the seam off");
            Assert.That(now, Is.LessThanOrEqualTo(10.6), "hips step after the hand-over");
            Assert.That(before, Is.GreaterThan(now + 2.0), "the old heading turned the hips faster (the seam is the test's control)");
        }

        [Test]
        public void BowlerAfterAHitBall_HeadMovesNoFasterThanTheNeckAndHeadCapInTheWorld()
        {
            var played = Play("deliberate-loft", "right", 6, 3.0);
            var legacy = Play("deliberate-loft", "right", 6, 3.0, w => w.BowlerHeadingFollowerEnabled = false);
            var now = played.Worst(played.Bowler, ProductionCharacterJoint.Head, 0.3, 3.0) * 60.0;
            var before = legacy.Worst(legacy.Bowler, ProductionCharacterJoint.Head, 0.3, 3.0) * 60.0;
            TestContext.WriteLine("the bowler's head in the world after a lofted ball: " + now.ToString("0") + " deg/s now, " + before.ToString("0") + " with the seam off (cap 720)");
            Assert.That(now, Is.LessThanOrEqualTo(720.0));
            Assert.That(before, Is.GreaterThan(720.0));
        }

        [Test]
        public void BowlerWalkingBackWithTheDirectorOn_HisHeadNeverTurnsFasterInTheWorldThanTheCap()
        {
            // The Director's head pass looks back at the batter over the shoulder while the bowler turns to walk back: the neck's 600 deg/s and the head's 600 deg/s
            // add in the world. The pass now holds the head the viewer sees to 600 deg/s (section 9 allows 720) whatever its two bones ask.
            var played = Play("grounded-attack", "left", 6, 3.0, null, true);
            var legacy = Play("grounded-attack", "left", 6, 3.0, w => w.DirectorHeadWorldCapEnabled = false, true);
            var now = played.Worst(played.Bowler, ProductionCharacterJoint.Head, 0.3, 3.0) * 60.0;
            var before = legacy.Worst(legacy.Bowler, ProductionCharacterJoint.Head, 0.3, 3.0) * 60.0;
            TestContext.WriteLine("grounded-attack left, Director on: the bowler's head in the world, largest speed " + now.ToString("0") + " deg/s now, " + before.ToString("0") + " with the seam off");
            Assert.That(now, Is.LessThanOrEqualTo(601.0));
            Assert.That(before, Is.GreaterThan(720.0), "the control: without the cap the Director's look back drew the head faster");
        }

        // --- Fix 2: the bowler's throw reach ------------------------------------------------------------------------------------------------------------

        [TestCase("right")]
        [TestCase("left")]
        public void BowlerThrowingTheBallBack_KeepsEveryArmBoneUnderTheArmCap(string hand)
        {
            // defensive-tap: the ball comes back to the bowler, he gathers it and throws at release + 3.414 s. The reach of his throwing palm onto the physics
            // release point flickered the elbow plane: the left upper arm turned 164 to 178 degrees in one frame, the hand 130 to 160 for five frames in a row.
            var played = Play("defensive-tap", hand, 6, 4.2);
            var legacy = Play("defensive-tap", hand, 6, 4.2, w => { w.ThrowReachFollowsThrough = false; w.ThrowReachStablePole = false; });
            double now = 0.0;
            double before = 0.0;
            foreach (var joint in new[]
            {
                ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft,
                ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight
            })
            {
                // world rotations of the bones under a moving chest: the section 9 cap for the throwing arm is 1800 deg/s = 30 deg a frame
                now = Math.Max(now, played.Worst(played.Bowler, joint, 3.0, 4.0));
                before = Math.Max(before, legacy.Worst(legacy.Bowler, joint, 3.0, 4.0));
            }

            TestContext.WriteLine("defensive-tap " + hand + ": the bowler's arm bones, largest one-frame turn in the world through the throw: " + now.ToString("0") + " deg now, " + before.ToString("0") + " deg with the seams off");
            Assert.That(now, Is.LessThanOrEqualTo(40.0), "no arm bone flips");
            Assert.That(before, Is.GreaterThan(100.0), "the old reach flipped the arm (the seams are the test's control)");
        }

        [Test]
        public void BowlerThrowingTheBallBack_HisPalmStillMeetsThePhysicsReleasePoint()
        {
            // The lead ruling (held ball): the thrower's hand reaches the physics release point at the release, within 10 cm.
            var played = Play("defensive-tap", "right", 6, 4.2);
            var legacy = Play("defensive-tap", "right", 6, 4.2, w => { w.ThrowReachFollowsThrough = false; w.ThrowReachStablePole = false; });
            Assert.That(played.ThrowGaps.Count, Is.EqualTo(1));
            TestContext.WriteLine("hand to the physics release point at the throw: " + played.ThrowGaps[0].ToString("0.000") + " m now, " + legacy.ThrowGaps[0].ToString("0.000") + " m before");
            Assert.That(played.ThrowGaps[0], Is.LessThanOrEqualTo(0.10f));
            Assert.That(played.ThrowGaps[0], Is.LessThanOrEqualTo(legacy.ThrowGaps[0] + 0.02f), "the reach is no worse than it was");
        }

        // --- Fix 5: the end of the ball -------------------------------------------------------------------------------------------------------------

        [TestCase("grounded-attack")]
        [TestCase("early-attack")]
        public void TheEndOfTheBall_TheStrikersHandsDoNotFlipAsTheSceneBetweenBallsReturns(string caseId)
        {
            // Every ball ended with the striker's bat jumping 32 cm and 141 degrees to the waiting stance in one frame (the last delivery's canonical bat was still
            // latched, so the hand-over did not move it) and his arms following it 90 to 130 degrees. The hand-over now moves the bat too, over 0.4 s.
            var played = Play(caseId, "right", 6, 6.5);
            var legacy = Play(caseId, "right", 6, 6.5, w => w.IdleHandOverMovesBat = false);
            Func<Played, double> idleStart = p =>
            {
                for (var frame = Math.Max(1, p.AcceptFrame); frame < p.T.Count; frame++)
                    if (p.State[frame] == "Idle") return p.T[frame];
                return double.NaN;
            };
            var from = idleStart(played);
            Assert.That(double.IsNaN(from), Is.False, "the ball ended");
            Func<Played, double> hands = p => Math.Max(
                p.Worst(p.Striker, ProductionCharacterJoint.HandLeft, from, from + 1.0),
                p.Worst(p.Striker, ProductionCharacterJoint.HandRight, from, from + 1.0));
            var now = hands(played);
            var before = hands(legacy);
            var batNow = played.WorstBatStepCm(from, from + 1.0);
            var batBefore = legacy.WorstBatStepCm(from, from + 1.0);
            TestContext.WriteLine(caseId + " the end of the ball: hands " + now.ToString("0") + " deg now, " + before.ToString("0") + " with the seam off; bat step " + batNow.ToString("0.0") + " cm now, " + batBefore.ToString("0.0") + " before");
            Assert.That(now, Is.LessThanOrEqualTo(45.0));
            Assert.That(batNow, Is.LessThanOrEqualTo(8.0));
            Assert.That(before, Is.GreaterThan(now + 20.0), "the control: the old hand-over flipped the hands");
            Assert.That(batBefore, Is.GreaterThan(20.0), "the control: the old hand-over jumped the bat");
        }

        // --- Fix 4: a result that arrives late ----------------------------------------------------------------------------------------------------------

        [TestCase("defensive-tap")]
        [TestCase("deliberate-loft")]
        public void ALateResult_DoesNotThrowTheBatOrFlipTheArms(string caseId)
        {
            // 60 frames after the commitment (a second): the contact is long past. The accept's own re-sample of the code-authored backlift moved the bat 0.67 m
            // in one frame and the arms followed it (the hands 120 to 177 degrees in that frame).
            var played = Play(caseId, "right", 60, 3.0);
            var legacy = Play(caseId, "right", 60, 3.0, w => w.LateResultSettleEnabled = false);
            Assert.That(played.AcceptFrame, Is.GreaterThan(0));
            var acceptT = played.T[Math.Min(played.AcceptFrame + 1, played.T.Count - 1)];
            var bat = played.WorstBatStepCm(acceptT - 0.02, acceptT + 1.0);
            var batBefore = legacy.WorstBatStepCm(acceptT - 0.02, acceptT + 1.0);
            var hands = Math.Max(
                played.Worst(played.Striker, ProductionCharacterJoint.HandLeft, acceptT - 0.02, acceptT + 1.0),
                played.Worst(played.Striker, ProductionCharacterJoint.HandRight, acceptT - 0.02, acceptT + 1.0));
            var handsBefore = Math.Max(
                legacy.Worst(legacy.Striker, ProductionCharacterJoint.HandLeft, acceptT - 0.02, acceptT + 1.0),
                legacy.Worst(legacy.Striker, ProductionCharacterJoint.HandRight, acceptT - 0.02, acceptT + 1.0));
            TestContext.WriteLine(caseId + " 60 frames late: bat step " + bat.ToString("0.0") + " cm now, " + batBefore.ToString("0.0") + " with the seam off; hands " + hands.ToString("0") + " deg now, " + handsBefore.ToString("0") + " before");
            Assert.That(bat, Is.LessThanOrEqualTo(15.0), "the bat is carried from where it was on screen");
            Assert.That(hands, Is.LessThanOrEqualTo(70.0), "the hands follow it without flipping");
        }

        [TestCase("right")]
        [TestCase("left")]
        public void AResultWhileTheStrokeIsStillDrawn_TheLateCarryDoesNotOutliveTheStroke(string hand)
        {
            // thin-edge, the result 8 frames after the commitment (just after the contact): TRACKB's stroke draws the bat until its window ends at about 0.88 s. A carry that
            // was stretched to a swing's pace (0.25 to 0.5 s) and was still running then snapped the rest of its offset in one frame: the right upper arm turned 177 degrees.
            var played = Play("thin-edge", hand, 8, 2.0);
            var worst = 0.0;
            foreach (var joint in new[] { ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.HandLeft, ProductionCharacterJoint.HandRight })
                worst = Math.Max(worst, played.Worst(played.Striker, joint, 0.6, 1.2));
            TestContext.WriteLine("thin-edge " + hand + ", a result 8 frames late: the striker's upper arms and hands, largest one-frame turn from 0.6 to 1.2 s: " + worst.ToString("0") + " deg");
            Assert.That(worst, Is.LessThanOrEqualTo(60.0));
        }

        [Test]
        public void ALateResult_TheBatOnScreenIsTheBatAtTheAccept()
        {
            var played = Play("defensive-tap", "right", 60, 2.0);
            var legacy = Play("defensive-tap", "right", 60, 2.0, w => w.LateResultSettleEnabled = false);
            var frame = played.AcceptFrame;
            var jump = Vector3.Distance(played.Bat[frame - 1], played.Bat[frame]) * 100.0;
            var jumpBefore = Vector3.Distance(legacy.Bat[frame - 1], legacy.Bat[frame]) * 100.0;
            TestContext.WriteLine("the bat's step in the accept frame: " + jump.ToString("0.0") + " cm now, " + jumpBefore.ToString("0.0") + " cm with the seam off");
            Assert.That(jump, Is.LessThanOrEqualTo(10.0));
            Assert.That(jumpBefore, Is.GreaterThan(30.0), "the control: the old accept moved the bat");
        }
    }
}
