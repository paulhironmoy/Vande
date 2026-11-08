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
    /// UNITY-4 H3: the live hand-over. The player presses at the recorded swing start, lifts (the commitment,
    /// ApplyProvisionalSwing) 50 or 120 ms later, and the result is accepted 0, 1 or 3 frames after that, on the two goldens
    /// that bracket it (grounded-attack and thin-edge). At the frame the result arrives the striker must not turn faster than
    /// a body can (MOTION-SPEC section 9's caps), his root must not jump from where the same stroke without the result had it,
    /// and his hands stay on the bat. The measurements are VandeHumansEvidence.HandOverProbe's.
    /// </summary>
    public sealed class ProductionLiveHandOverTests
    {
        private const double Step = 1.0 / 60.0;

        // MOTION-SPEC section 9: hips, spine and chest 600, neck and head 720 degrees per second.
        private static readonly ProductionCharacterJoint[] Torso =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head
        };

        private static readonly double[] TorsoCaps = { 600.0, 600.0, 600.0, 720.0, 720.0 };

        private static readonly ProductionCharacterJoint[] Forearms =
        {
            ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.ForearmRight
        };

        private sealed class Frame
        {
            public double T;
            public Vector3 Root;
            public Quaternion[] Torso;
            public Quaternion[] Forearm;
            public float LeftHandOffTarget, RightHandOffTarget;
        }

        private sealed class Run
        {
            public List<Frame> Frames;
            public int AcceptIndex;
            public int CommitIndex;
            public int GovernorEngagements;
        }

        public static IEnumerable<TestCaseData> Scenarios()
        {
            foreach (var id in new[] { "grounded-attack", "thin-edge" })
            foreach (var commit in new[] { 0.05, 0.12 })
            foreach (var frames in new[] { 0, 1, 3 })
                yield return new TestCaseData(id, commit, frames);
        }

        [TestCaseSource(nameof(Scenarios))]
        public void TheTorsoStaysWithinItsSectionNineCapsAtTheFrameTheResultArrives(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true);
            // The frame of the accept, and the next few: the stroke's own pace is held as well, not only the one frame.
            for (var index = accepted.AcceptIndex; index <= Math.Min(accepted.AcceptIndex + 8, accepted.Frames.Count - 1); index++)
            {
                var before = accepted.Frames[index - 1];
                var now = accepted.Frames[index];
                var dt = now.T - before.T;
                for (var joint = 0; joint < Torso.Length; joint++)
                {
                    var degreesPerSecond = Quaternion.Angle(before.Torso[joint], now.Torso[joint]) / dt;
                    Assert.That(degreesPerSecond, Is.LessThanOrEqualTo(TorsoCaps[joint] * 1.01),
                        Torso[joint] + " at " + (index - accepted.AcceptIndex) + " frames after the accept (" + id + ")");
                }
            }
        }

        [TestCaseSource(nameof(Scenarios))]
        public void ThePackLoadProvisionalBody_NeedsNoTorsoGovernor_AndTheGovernorNeverHoldsABoneBack(string id, double commit, int acceptFrames)
        {
            // UNITY-5 F2: a committed swing keeps the body in TRACKB's load until the result arrives (and the clip begins from
            // that load), so the torso never turns faster than its section 9 cap on its own: with the governor off, the chest and
            // every other torso joint stay within the cap from the commitment on, and with it on it never holds a bone back.
            var off = Play(id, commit, acceptFrames, true, governor: false);
            for (var index = Math.Max(1, off.CommitIndex - 1); index <= Math.Min(off.AcceptIndex + 12, off.Frames.Count - 1); index++)
            {
                var before = off.Frames[index - 1];
                var now = off.Frames[index];
                var dt = now.T - before.T;
                for (var joint = 0; joint < Torso.Length; joint++)
                    Assert.That(Quaternion.Angle(before.Torso[joint], now.Torso[joint]) / dt, Is.LessThanOrEqualTo(TorsoCaps[joint]),
                        Torso[joint] + " at frame " + (index - off.AcceptIndex) + " from the accept, governor off (" + id + ")");
            }
            var on = Play(id, commit, acceptFrames, true, governor: true);
            Assert.That(on.GovernorEngagements, Is.Zero, "the governor held no bone back (" + id + ")");
        }

        [TestCaseSource(nameof(Scenarios))]
        public void ACommittedSwingDoesNotMoveTheBodyOutOfTheLoadItWasInBeforeTheResult(string id, double commit, int acceptFrames)
        {
            // The body before the commitment is TRACKB's anticipation; the code-authored stroke it used to be replaced with at the
            // commitment is gone: through the committed swing, until the result, the torso is where the press left it (the
            // anticipation's own hold moves it a few degrees: the chest 3.5 and the head 3.0 measured over the 120 ms commitments) and
            // the bat is the only thing that has moved.
            var accepted = Play(id, commit, acceptFrames, true);
            var beforeCommit = accepted.Frames[Math.Max(0, accepted.CommitIndex - 1)];
            var untilResult = Math.Max(accepted.CommitIndex, accepted.AcceptIndex - 1);
            for (var index = accepted.CommitIndex; index <= untilResult; index++)
                for (var joint = 0; joint < Torso.Length; joint++)
                    Assert.That(Quaternion.Angle(beforeCommit.Torso[joint], accepted.Frames[index].Torso[joint]), Is.LessThanOrEqualTo(5f),
                        Torso[joint] + " " + (index - accepted.CommitIndex) + " frames after the commitment (" + id + ")");
        }

        [Test]
        public void TheTorsoGovernor_Control_WithoutItTheOldProvisionalStrokesChestTurnsMoreThanTwiceItsCapAtTheAccept()
        {
            // UNITY-3 measured the chest at 1.1x its cap with the result at the commitment and 2.1x a frame later: the pose-source
            // change of ~100 degrees, spread by the 0.2 s inertial blend, and the code-authored provisional stroke's own chest drive.
            // UNITY-5 F2 removed that cause (the provisional body is TRACKB's load now: the test above), so this control, which
            // shows what the governor answers, plays the OLD provisional stroke through the builder seam (packBody: false).
            var accepted = Play("grounded-attack", 0.05, 1, true, governor: false, packBody: false);
            var before = accepted.Frames[accepted.AcceptIndex - 1];
            var now = accepted.Frames[accepted.AcceptIndex];
            var chest = Array.IndexOf(Torso, ProductionCharacterJoint.Chest);
            Assert.That(Quaternion.Angle(before.Torso[chest], now.Torso[chest]) / (now.T - before.T), Is.GreaterThan(TorsoCaps[chest] * 1.8));
        }

        [TestCaseSource(nameof(Scenarios))]
        public void TheRootNeverJumpsMoreThanFiveCentimetresFromTheSameStrokeWithoutTheResult(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true);
            var control = Play(id, commit, acceptFrames, false);
            // The result's physics root is up to 18 cm from the stance (thin-edge); the body is carried to it at no more than
            // 2.5 m/s (4.2 cm a frame), not shifted in the one frame the result arrives. The first frame of the accepted run
            // is at most 5 cm from the same frame of the stroke without the result, and no frame moves the root 5 cm.
            var at = accepted.AcceptIndex;
            Assert.That(Vector3.Distance(accepted.Frames[at].Root, control.Frames[at].Root), Is.LessThanOrEqualTo(0.05f),
                "root at the accept (" + id + ")");
            // (The carry is over within six frames; a run's set-off later in the stroke is the gait's, hidden by its own blend.)
            for (var index = at; index <= Math.Min(at + 8, accepted.Frames.Count - 1); index++)
                Assert.That(Vector3.Distance(accepted.Frames[index - 1].Root, accepted.Frames[index].Root), Is.LessThanOrEqualTo(0.05f),
                    "root step " + (index - at) + " frames after the accept (" + id + ")");
        }

        [TestCaseSource(nameof(Scenarios))]
        public void NoForearmTurnsMoreThanAHundredDegreesInAFrameAndTheGlovesStayOnTheBat(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true);
            // UNITY-3 measured forearm turns of 109 to 165 degrees in one frame at the accept. The bound here is the one the
            // geometry leaves: the physics bat can be 60 to 90 cm from the provisional stroke's bat when a late result arrives
            // (grounded-attack accepted three frames after a 50 ms commitment: the palms travel 78 cm in the frame, 97 degrees of
            // forearm), and the gloves stay on the bat.
            //
            // UNITY-5 F2 gave one class its own bound, 150: grounded-attack accepted three frames after a 50 ms commitment, where the
            // committed (code-authored) bat was at 0.96 m and the physics bat, back at TRACKB's compact top at 1.54 m, was 68 cm away
            // in the frame the result arrives (143 degrees of forearm). UNITY-7 B removed the cause (the committed bat is now the
            // swing's predicted physics bat, ProductionPredictedSwingBat, and the accept no longer overwrites the arms' elbow memory):
            // that class turns the forearm 82 degrees, and the bound is 100 in every class.
            const float forearmBound = 100f;
            for (var index = Math.Max(1, accepted.AcceptIndex - 3); index < accepted.Frames.Count; index++)
            {
                for (var arm = 0; arm < Forearms.Length; arm++)
                    Assert.That(Quaternion.Angle(accepted.Frames[index - 1].Forearm[arm], accepted.Frames[index].Forearm[arm]),
                        Is.LessThanOrEqualTo(forearmBound), Forearms[arm] + " at frame " + (index - accepted.AcceptIndex) + " from the accept (" + id + ")");
                Assert.That(accepted.Frames[index].LeftHandOffTarget, Is.LessThanOrEqualTo(0.005f), "left glove, frame " + (index - accepted.AcceptIndex));
                Assert.That(accepted.Frames[index].RightHandOffTarget, Is.LessThanOrEqualTo(0.005f), "right glove, frame " + (index - accepted.AcceptIndex));
            }
        }

        // ---- UNITY-8 B: the host's convention ---------------------------------------------------------------------------
        //
        // The tests above send the commitment's time as the swing's start (UNITY-5's probe convention). The host sends the press,
        // the normalized swing start (a tap's press), which is the better case for the body (the predicted bat's hands ease over the
        // bat's travel from the press, not from 50 or 120 ms later). These classes are the same scenarios on the host's convention,
        // with the accept classes UNITY-7 added (5, 6, 7 and 10 frames: the latency Unity's decode alone makes). Added, not replacing.

        public static IEnumerable<TestCaseData> HostScenarios()
        {
            foreach (var id in new[] { "grounded-attack", "thin-edge" })
            foreach (var commit in new[] { 0.05, 0.12 })
            foreach (var frames in new[] { 0, 1, 3, 5, 6, 7, 10 })
                yield return new TestCaseData(id, commit, frames);
        }

        [TestCaseSource(nameof(HostScenarios))]
        public void HostConvention_TheTorsoStaysWithinItsSectionNineCapsAtTheFrameTheResultArrives(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true, pressStart: true);
            for (var index = accepted.AcceptIndex; index <= Math.Min(accepted.AcceptIndex + 8, accepted.Frames.Count - 1); index++)
            {
                var before = accepted.Frames[index - 1];
                var now = accepted.Frames[index];
                var dt = now.T - before.T;
                for (var joint = 0; joint < Torso.Length; joint++)
                {
                    var degreesPerSecond = Quaternion.Angle(before.Torso[joint], now.Torso[joint]) / dt;
                    Assert.That(degreesPerSecond, Is.LessThanOrEqualTo(TorsoCaps[joint] * 1.01),
                        Torso[joint] + " at " + (index - accepted.AcceptIndex) + " frames after the accept (" + id + ", host start time)");
                }
            }
        }

        [TestCaseSource(nameof(HostScenarios))]
        public void HostConvention_TheGovernorNeverHoldsABoneBack(string id, double commit, int acceptFrames)
        {
            var on = Play(id, commit, acceptFrames, true, governor: true, pressStart: true);
            Assert.That(on.GovernorEngagements, Is.Zero, "the governor held no bone back (" + id + ", host start time)");
        }

        [TestCaseSource(nameof(HostScenarios))]
        public void HostConvention_TheRootNeverJumpsMoreThanFiveCentimetresFromTheSameStrokeWithoutTheResult(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true, pressStart: true);
            var control = Play(id, commit, acceptFrames, false, pressStart: true);
            var at = accepted.AcceptIndex;
            Assert.That(Vector3.Distance(accepted.Frames[at].Root, control.Frames[at].Root), Is.LessThanOrEqualTo(0.05f),
                "root at the accept (" + id + ", host start time)");
            for (var index = at; index <= Math.Min(at + 8, accepted.Frames.Count - 1); index++)
                Assert.That(Vector3.Distance(accepted.Frames[index - 1].Root, accepted.Frames[index].Root), Is.LessThanOrEqualTo(0.05f),
                    "root step " + (index - at) + " frames after the accept (" + id + ", host start time)");
        }

        [TestCaseSource(nameof(HostScenarios))]
        public void HostConvention_NoForearmTurnsMoreThanAHundredDegreesInAFrameAndTheGlovesStayOnTheBat(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true, pressStart: true);
            const float forearmBound = 100f;
            for (var index = Math.Max(1, accepted.AcceptIndex - 3); index < accepted.Frames.Count; index++)
            {
                for (var arm = 0; arm < Forearms.Length; arm++)
                    Assert.That(Quaternion.Angle(accepted.Frames[index - 1].Forearm[arm], accepted.Frames[index].Forearm[arm]),
                        Is.LessThanOrEqualTo(forearmBound),
                        Forearms[arm] + " at frame " + (index - accepted.AcceptIndex) + " from the accept (" + id + ", host start time)");
                Assert.That(accepted.Frames[index].LeftHandOffTarget, Is.LessThanOrEqualTo(0.005f),
                    "left glove, frame " + (index - accepted.AcceptIndex) + " (host start time)");
                Assert.That(accepted.Frames[index].RightHandOffTarget, Is.LessThanOrEqualTo(0.005f),
                    "right glove, frame " + (index - accepted.AcceptIndex) + " (host start time)");
            }
        }

        [TestCaseSource(nameof(HostScenarios))]
        public void HostConvention_ACommittedSwingDoesNotMoveTheBodyOutOfTheLoadItWasInBeforeTheResult(string id, double commit, int acceptFrames)
        {
            var accepted = Play(id, commit, acceptFrames, true, pressStart: true);
            var beforeCommit = accepted.Frames[Math.Max(0, accepted.CommitIndex - 1)];
            var untilResult = Math.Max(accepted.CommitIndex, accepted.AcceptIndex - 1);
            for (var index = accepted.CommitIndex; index <= untilResult; index++)
                for (var joint = 0; joint < Torso.Length; joint++)
                    Assert.That(Quaternion.Angle(beforeCommit.Torso[joint], accepted.Frames[index].Torso[joint]), Is.LessThanOrEqualTo(5f),
                        Torso[joint] + " " + (index - accepted.CommitIndex) + " frames after the commitment (" + id + ", host start time)");
        }

        // ---- the scenario ------------------------------------------------------------------------------------------------

        private static Run Play(string id, double commitDelay, int acceptFrames, bool accept, bool governor = true, bool packBody = true,
            bool pressStart = false)
        {
            var fixture = LoadFixture();
            var item = fixture.cases.Single(value => value.id == id);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = "right";
            var root = new GameObject("Production live hand-over " + id);
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "right",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                var striker = world.PresentedHumansForEvidence().Single(pair => pair.Key == "striker").Value;
                striker.TorsoRateGovernorEnabled = governor;
                world.ProvisionalPackBodyEnabled = packBody;
                var swingStart = result.SwingStartT ?? 0.15;
                world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                world.BeginLocalPreparation();

                var run = new Run { Frames = new List<Frame>(), AcceptIndex = -1, CommitIndex = -1 };
                var committed = false;
                var accepted = false;
                var countdown = acceptFrames;
                var commitAt = swingStart + commitDelay;
                for (var step = 0; step < 90; step++)
                {
                    if (!committed && world.TimelineForEvidence >= commitAt - 1e-9)
                    {
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack",
                            // The older tests send the commitment's time; the host sends the normalized swing start, the press
                            // (UNITY-7 B measured both): pressStart is the host's.
                            StartT = pressStart ? swingStart : world.Timeline,
                            DirectionDeg = result.SwingDirectionDeg,
                            Power = 0.7,
                            Elevation = 0.1,
                            Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                        });
                        committed = true;
                        run.CommitIndex = run.Frames.Count;
                    }
                    if (accept && committed && !accepted)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            accepted = true;
                            run.AcceptIndex = run.Frames.Count;
                        }
                        else countdown--;
                    }
                    world.Tick(Step);
                    run.Frames.Add(Capture(striker, world.TimelineForEvidence));
                    if (accepted && run.Frames.Count > run.AcceptIndex + 30) break;
                }
                run.GovernorEngagements = striker.TorsoGovernorEngagementsForEvidence;
                return run;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static Frame Capture(ProductionCharacterRig striker, double t)
        {
            var frame = new Frame
            {
                T = t,
                Root = striker.Root.position,
                Torso = Torso.Select(striker.VisibleJointWorldRotation).ToArray(),
                Forearm = Forearms.Select(striker.VisibleJointWorldRotation).ToArray()
            };
            // Running with the bat in one hand (after the stroke) the other glove is off the handle by design.
            if (!striker.BatterOneHandCarry)
            {
                frame.LeftHandOffTarget = Vector3.Distance(striker.HeroHandWorldPosition(true), striker.HeroBatterGripTargetWorld(true));
                frame.RightHandOffTarget = Vector3.Distance(striker.HeroHandWorldPosition(false), striker.HeroBatterGripTargetWorld(false));
            }
            return frame;
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static GoldenFixture LoadFixture()
        {
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore("practice-v3 shared golden is required for the live hand-over regression.");
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
