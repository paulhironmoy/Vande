using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Audio;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Vande.Practice.Tests.DirectorTests;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The face-and-life Director on the production world (UNITY-E2): a golden ball is played through a fresh world with the Director off, on, and on in
    /// Reduced Motion, frame for frame. Reduced Motion has no life, so every bone but the neck and head is the Director-off world's, bit for bit, the whole
    /// ball through (the head pass reads and moves nothing else); in the bowler's quiet window every bone but the neck and head is the same bit for bit; in
    /// the striker's quiet window the trunk, legs, bat and root are (the arms follow the world's own solver, which remembers the breathing before the window
    /// by a fraction of a millimetre); the neck and head hold the section 9 caps through the whole ball, the scene between balls and the seam included;
    /// and nothing the pass does is left on the bones for the next frame's solves. Golden practice-v3 (tests/fixtures/unity-practice/practice-v3.json).
    /// Builder measurements, never a player's or an evaluator's result.
    /// </summary>
    public sealed class DirectorWorldTests
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
        [Serializable] private sealed class Packets { public UnityPracticePacket scene; public UnityPracticePacket delivery; public UnityPracticePacket result; }

        private sealed class NullSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) => UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static Case Load(string id)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            return JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == id);
        }

        private sealed class Frame
        {
            public string Kind = "none";
            public double SceneMs;
            public double ReleaseMs = double.NaN;
            public double StrokeEndMs = double.NaN;
            public double RunStartMs = double.NaN;
            public float[][] Pose = new float[2][];
            public Quaternion[][] Local = new Quaternion[2][];
            public bool LifeActive;
            public float GloveOffMm;
        }

        private static readonly ProductionCharacterJoint[] Joints = Enumerable.Range(0, (int)ProductionCharacterJoint.Count).Select(i => (ProductionCharacterJoint)i).ToArray();

        private static float[] PoseOf(ProductionCharacterRig rig)
        {
            var v = new List<float>();
            foreach (var j in Joints)
            {
                var p = rig.VisibleJointWorldPosition(j);
                var q = rig.VisibleJointWorldRotation(j);
                v.AddRange(new[] { p.x, p.y, p.z, q.x, q.y, q.z, q.w });
            }
            if (rig.Bat != null) v.AddRange(new[] { rig.Bat.position.x, rig.Bat.position.y, rig.Bat.position.z, rig.Bat.rotation.x, rig.Bat.rotation.y, rig.Bat.rotation.z, rig.Bat.rotation.w });
            var r = rig.Root.position;
            v.AddRange(new[] { r.x, r.y, r.z });
            return v.ToArray();
        }

        private static Quaternion Rot(float[] pose, ProductionCharacterJoint j) => new Quaternion(pose[(int)j * 7 + 3], pose[(int)j * 7 + 4], pose[(int)j * 7 + 5], pose[(int)j * 7 + 6]);

        private static Quaternion LocalOf(float[] pose, ProductionCharacterJoint j) =>
            j == ProductionCharacterJoint.Neck
                ? Quaternion.Inverse(Rot(pose, ProductionCharacterJoint.Chest)) * Rot(pose, ProductionCharacterJoint.Neck)
                : Quaternion.Inverse(Rot(pose, ProductionCharacterJoint.Neck)) * Rot(pose, ProductionCharacterJoint.Head);

        /// <summary>The scene between balls (3 s), a ball (the press at the swing start, the commitment 50 ms later, the result 3 frames later, 5 s after it), the scene again (2 s).</summary>
        private int lastPressIndex, lastCommitIndex, lastAcceptIndex;

        private List<Frame> Play(string id, string hand, bool director, bool reduced, int acceptFrames = 3, bool hold = true)
        {
            var item = Load(id);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = hand;
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
            root = new GameObject("director world test " + id + " " + hand);
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.DirectorEnabled = director;
            world.DirectorHoldsHeadInCommittedSwing = hold;
            world.Configure(new PracticePresentationSettings { Assistance = "play", Handedness = hand, Locale = "en-IN", Quality = PracticePresentationQuality.Standard, ReducedMotion = reduced }, new NullSink());
            world.ConfigureScene(scene);
            var humans = world.PresentedHumansForEvidence();
            var striker = humans.First(p => p.Key == "striker").Value;
            var bowler = humans.First(p => p.Key == "bowler").Value;
            var frames = new List<Frame>();
            Action tick = () =>
            {
                world.Tick(Step);
                var f = new Frame { SceneMs = world.DirectorSceneMsForEvidence };
                var script = world.DirectorScriptForEvidence;
                if (script != null)
                {
                    f.Kind = script.ScriptKind.ToString();
                    if (script.ScriptKind != StageKind.Idle)
                    {
                        f.ReleaseMs = script.ScriptSpec.Bowler.Release ?? double.NaN;
                        f.StrokeEndMs = script.ScriptSpec.Striker.StrokeEnd ?? double.NaN;
                        f.RunStartMs = script.ScriptSpec.Bowler.RunStart ?? double.NaN;
                    }
                }
                f.LifeActive = world.DirectedLifeForEvidence(DirectorRole.Bowler).Active || world.DirectedLifeForEvidence(DirectorRole.Striker).Active;
                f.Pose[0] = PoseOf(bowler);
                f.Pose[1] = PoseOf(striker);
                f.GloveOffMm = striker.Bat != null && !striker.BatterOneHandCarry
                    ? Math.Max(Vector3.Distance(striker.HeroHandWorldPosition(true), striker.HeroBatterGripTargetWorld(true)), Vector3.Distance(striker.HeroHandWorldPosition(false), striker.HeroBatterGripTargetWorld(false))) * 1000f
                    : 0f;
                frames.Add(f);
            };
            for (var k = 0; k < 180; k++) tick();
            world.BeginDelivery(delivery);
            var swingStart = result.SwingStartT ?? 0.15;
            while (world.TimelineForEvidence < swingStart - 1e-9) tick();
            world.BeginLocalPreparation();
            lastPressIndex = frames.Count;
            var commitAt = swingStart + 0.05;
            var committed = false;
            var accepted = false;
            var countdown = acceptFrames;
            var acceptedAt = -1;
            lastCommitIndex = -1;
            for (var guard = 0; guard < 900; guard++)
            {
                if (!committed && world.TimelineForEvidence >= commitAt - 1e-9)
                {
                    world.ApplyProvisionalSwing(new PracticeSwingPresentation
                    {
                        Kind = "attack", StartT = swingStart, DirectionDeg = result.SwingDirectionDeg, Power = 0.7, Elevation = 0.1,
                        Footwork = string.IsNullOrEmpty(result.Footwork) ? "auto" : result.Footwork
                    });
                    committed = true;
                    lastCommitIndex = frames.Count;
                }
                if (committed && !accepted)
                {
                    if (countdown == 0)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                        acceptedAt = frames.Count;
                        lastAcceptIndex = acceptedAt;
                    }
                    else countdown--;
                }
                tick();
                if (accepted && frames.Count > acceptedAt + 420) break;
            }
            for (var k = 0; k < 180; k++) tick();
            Assert.That(world.DirectorFailureForEvidence, Is.Null.Or.Empty, "the Director switched itself off: " + world.DirectorFailureForEvidence);
            return frames;
        }

        private static bool ExceptNeckAndHead(int k) => !(k >= (int)ProductionCharacterJoint.Neck * 7 && k < ((int)ProductionCharacterJoint.Head + 1) * 7);

        [Test]
        public void TheWorld_IsDeterministic_SoTheComparisonsBelowMeanSomething()
        {
            var a = Play("grounded-attack", "right", false, false);
            var b = Play("grounded-attack", "right", false, false);
            Assert.That(a.Count, Is.EqualTo(b.Count));
            for (var i = 0; i < a.Count; i++)
                for (var r = 0; r < 2; r++)
                    Assert.That(a[i].Pose[r].SequenceEqual(b[i].Pose[r]), Is.True, "frame " + i + " rig " + r);
        }

        [TestCase("right")]
        [TestCase("left")]
        public void ReducedMotion_HasNoLife_AndEveryBoneButTheNeckAndHeadIsTheDirectorOffWorlds_Always(string hand)
        {
            var off = Play("deliberate-loft", hand, false, false);
            var rm = Play("deliberate-loft", hand, true, true);
            Assert.That(rm.Count, Is.EqualTo(off.Count));
            var neckHeadDiffers = 0;
            for (var i = 0; i < off.Count; i++)
            {
                Assert.That(rm[i].LifeActive, Is.False, "life in Reduced Motion at frame " + i);
                for (var r = 0; r < 2; r++)
                {
                    var a = off[i].Pose[r];
                    var b = rm[i].Pose[r];
                    for (var k = 0; k < a.Length; k++)
                    {
                        if (!ExceptNeckAndHead(k) && k < Joints.Length * 7) { if (a[k] != b[k]) neckHeadDiffers++; continue; }
                        if (a[k] != b[k]) Assert.Fail("frame " + i + " rig " + r + " float " + k + " differs by " + Math.Abs(a[k] - b[k]) + " (kind " + rm[i].Kind + "): the Director in Reduced Motion moved something but the neck and head");
                    }
                }
            }
            Assert.That(neckHeadDiffers, Is.GreaterThan(0), "the head pass did turn the neck and head (the comparison is not vacuous)");
        }

        [TestCase("grounded-attack", "right")]
        [TestCase("complete-miss", "left")]
        public void TheQuietWindows_MoveNoBone_ButTheNeckAndHead(string id, string hand)
        {
            var off = Play(id, hand, false, false);
            var on = Play(id, hand, true, false);
            Assert.That(on.Count, Is.EqualTo(off.Count));
            int bowlerFrames = 0, strikerFrames = 0, actedOutside = 0;
            double worstArmMm = 0, worstHandMm = 0, worstGlove = 0;
            for (var i = 0; i < on.Count; i++)
            {
                var f = on[i];
                var live = f.Kind == "Live" || f.Kind == "Result" || f.Kind == "Replay";
                if (live && f.SceneMs >= f.RunStartMs && f.SceneMs <= f.ReleaseMs + 150)
                {
                    bowlerFrames++;
                    var a = off[i].Pose[0];
                    var b = f.Pose[0];
                    for (var k = 0; k < a.Length; k++)
                        if (ExceptNeckAndHead(k) || k >= Joints.Length * 7)
                            Assert.That(b[k], Is.EqualTo(a[k]), "bowler frame " + i + " float " + k + ": the Director moved the bowler in his quiet window");
                }
                if (live && f.SceneMs >= f.ReleaseMs - 600 && f.SceneMs <= (double.IsNaN(f.StrokeEndMs) ? double.PositiveInfinity : f.StrokeEndMs + 800))
                {
                    strikerFrames++;
                    var a = off[i].Pose[1];
                    var b = f.Pose[1];
                    foreach (var j in Joints)
                    {
                        var isArm = j == ProductionCharacterJoint.UpperArmLeft || j == ProductionCharacterJoint.ForearmLeft || j == ProductionCharacterJoint.UpperArmRight || j == ProductionCharacterJoint.ForearmRight;
                        var isHand = j == ProductionCharacterJoint.HandLeft || j == ProductionCharacterJoint.HandRight;
                        if (j == ProductionCharacterJoint.Neck || j == ProductionCharacterJoint.Head) continue;
                        var pd = Vector3.Distance(new Vector3(a[(int)j * 7], a[(int)j * 7 + 1], a[(int)j * 7 + 2]), new Vector3(b[(int)j * 7], b[(int)j * 7 + 1], b[(int)j * 7 + 2])) * 1000.0;
                        if (isArm) worstArmMm = Math.Max(worstArmMm, pd);
                        else if (isHand) worstHandMm = Math.Max(worstHandMm, pd);
                        else
                            for (var k = (int)j * 7; k < (int)j * 7 + 7; k++)
                                Assert.That(b[k], Is.EqualTo(a[k]), "striker frame " + i + " " + j + ": the Director moved the trunk, hips or legs in his quiet window");
                    }
                    for (var k = Joints.Length * 7; k < a.Length; k++)
                        Assert.That(b[k], Is.EqualTo(a[k]), "striker frame " + i + " bat/root float " + k);
                    worstGlove = Math.Max(worstGlove, f.GloveOffMm);
                }
                if (!live && on[i].LifeActive) actedOutside++;
            }
            Console.WriteLine(id + " " + hand + ": quiet frames bowler " + bowlerFrames + ", striker " + strikerFrames + "; striker arms differ by at most " + worstArmMm.ToString("0.000") + " mm, hands " + worstHandMm.ToString("0.0000") + " mm, glove-to-grip gap " + worstGlove.ToString("0.000") + " mm");
            Assert.That(bowlerFrames, Is.GreaterThan(100));
            Assert.That(strikerFrames, Is.GreaterThan(100));
            Assert.That(actedOutside, Is.GreaterThan(30), "the Director acts in the scene between balls");
            Assert.That(worstHandMm, Is.LessThan(0.05), "the hands do not leave the bat");
            Assert.That(worstGlove, Is.LessThan(2.0), "hands on the bat within 2 mm");
        }

        [Test]
        public void TheNeckAndHead_KeepTheSectionNineCaps_ThroughTheWholeBall_TheSceneBetweenBallsAndTheSeamIncluded()
        {
            var on = Play("grounded-attack", "right", true, false);
            foreach (var r in new[] { 0, 1 })
                foreach (var j in new[] { ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head })
                {
                    double previous = double.NaN;
                    double worstSpeed = 0, worstChange = 0;
                    for (var i = 1; i < on.Count; i++)
                    {
                        var speed = Quaternion.Angle(LocalOf(on[i - 1].Pose[r], j), LocalOf(on[i].Pose[r], j)) / Step;
                        worstSpeed = Math.Max(worstSpeed, speed);
                        if (!double.IsNaN(previous)) worstChange = Math.Max(worstChange, Math.Abs(speed - previous));
                        previous = speed;
                    }
                    Console.WriteLine((r == 0 ? "bowler " : "striker ") + j + ": worst speed " + worstSpeed.ToString("0.0") + " deg/s, worst change of speed " + worstChange.ToString("0.0") + " deg/s per frame");
                    Assert.That(worstSpeed, Is.LessThan(720), (r == 0 ? "bowler " : "striker ") + j + " speed");
                    Assert.That(worstChange, Is.LessThan(300), (r == 0 ? "bowler " : "striker ") + j + " change of speed");
                }
        }

        [TestCase("grounded-attack", "right", 3)]
        [TestCase("grounded-attack", "left", 8)]
        [TestCase("thin-edge", "right", 10)]
        public void TheStrikersHead_StandsStillInSpaceFromThePressToTheResult_AndThenGoesToThePlanUnderTheCaps(string id, string hand, int acceptFrames)
        {
            var held = Play(id, hand, true, false, acceptFrames, true);
            var press = lastPressIndex;
            var commit = lastCommitIndex;
            var accept = lastAcceptIndex;
            Assert.That(commit, Is.GreaterThan(press), "the commitment follows the press");
            Assert.That(accept, Is.GreaterThan(commit));
            // from the frame the commitment is made until the frame before the result: the head's line of sight does not move (it stopped within
            // a few frames of the press, at the brake's stopping point)
            var before = Rot(held[commit - 1].Pose[1], ProductionCharacterJoint.Head) * Vector3.forward;
            double worst = 0;
            for (var i = commit; i < accept; i++)
                worst = Math.Max(worst, Vector3.Angle(before, Rot(held[i].Pose[1], ProductionCharacterJoint.Head) * Vector3.forward));
            Console.WriteLine(id + " " + hand + " accept +" + acceptFrames + ": the head moved " + worst.ToString("0.000") + " degrees in space from the commitment to the result");
            Assert.That(worst, Is.LessThan(1.0), "the head stands still through the committed swing");
            // and without the hold it follows the ball: the comparison is not vacuous
            var follows = Play(id, hand, true, false, acceptFrames, false);
            var beforeFollows = Rot(follows[lastCommitIndex - 1].Pose[1], ProductionCharacterJoint.Head) * Vector3.forward;
            double followed = 0;
            for (var i = lastCommitIndex; i < lastAcceptIndex; i++)
                followed = Math.Max(followed, Vector3.Angle(beforeFollows, Rot(follows[i].Pose[1], ProductionCharacterJoint.Head) * Vector3.forward));
            Console.WriteLine(id + " " + hand + " accept +" + acceptFrames + ": without the hold the head follows the ball " + followed.ToString("0.00") + " degrees");
            Assert.That(followed, Is.GreaterThan(worst), "the hold is what keeps it still");
            // after the result: the world speeds of the neck and head (what a viewer sees, what the section 9 gate measures) hold the caps through the give-back
            foreach (var j in new[] { ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head })
            {
                double speed = 0;
                for (var i = accept; i < Math.Min(held.Count, accept + 90); i++)
                    speed = Math.Max(speed, Quaternion.Angle(Rot(held[i - 1].Pose[1], j), Rot(held[i].Pose[1], j)) / Step);
                Console.WriteLine(id + " " + hand + " accept +" + acceptFrames + ": " + j + " world speed after the result at most " + speed.ToString("0.0") + " deg/s");
                Assert.That(speed, Is.LessThanOrEqualTo(720 * 1.01), j + " world speed after the result");
            }
        }

        [Test]
        public void AcceptingAResult_LeavesTheDirectorsTurnOnTheHeads_BeforeAnyFrameIsDrawn()
        {
            // The accept re-poses the rig between two frames (and carries the striker's root to the physics body's; the Director off world does that
            // too). The turn the Director had put on the heads is given back on the new base: across the accept the gap between the directed world's
            // heads and the undirected world's does not change.
            double[] Run(bool director)
            {
                var item = Load("grounded-attack");
                var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
                var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
                var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
                scene.Handedness = "right";
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                root = new GameObject("director accept test");
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.DirectorEnabled = director;
                world.Configure(new PracticePresentationSettings { Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.Standard }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                var humans = world.PresentedHumansForEvidence();
                var striker = humans.First(p => p.Key == "striker").Value;
                var bowler = humans.First(p => p.Key == "bowler").Value;
                var swingStart = result.SwingStartT ?? 0.15;
                while (world.TimelineForEvidence < swingStart + 0.05) world.Tick(Step);
                var values = new List<double>();
                foreach (var rig in new[] { striker, bowler })
                {
                    values.AddRange(new double[] { rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).x, rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).y, rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).z });
                    var look = rig.VisibleJointWorldRotation(ProductionCharacterJoint.Head) * Vector3.forward;
                    values.AddRange(new double[] { look.x, look.y, look.z });
                }
                world.AcceptResult(result);
                foreach (var rig in new[] { striker, bowler })
                {
                    values.AddRange(new double[] { rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).x, rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).y, rig.VisibleJointWorldPosition(ProductionCharacterJoint.Head).z });
                    var look = rig.VisibleJointWorldRotation(ProductionCharacterJoint.Head) * Vector3.forward;
                    values.AddRange(new double[] { look.x, look.y, look.z });
                }
                return values.ToArray();
            }
            var off = Run(false);
            var on = Run(true);
            // layout: [before: striker pos(3) look(3), bowler pos(3) look(3)] [after: same]
            for (var rig = 0; rig < 2; rig++)
            {
                var b = rig * 6;
                var a = 12 + rig * 6;
                var gapBeforeMm = Vector3.Distance(new Vector3((float)on[b], (float)on[b + 1], (float)on[b + 2]), new Vector3((float)off[b], (float)off[b + 1], (float)off[b + 2])) * 1000.0;
                var gapAfterMm = Vector3.Distance(new Vector3((float)on[a], (float)on[a + 1], (float)on[a + 2]), new Vector3((float)off[a], (float)off[a + 1], (float)off[a + 2])) * 1000.0;
                var turnBefore = Vector3.Angle(new Vector3((float)on[b + 3], (float)on[b + 4], (float)on[b + 5]), new Vector3((float)off[b + 3], (float)off[b + 4], (float)off[b + 5]));
                var turnAfter = Vector3.Angle(new Vector3((float)on[a + 3], (float)on[a + 4], (float)on[a + 5]), new Vector3((float)off[a + 3], (float)off[a + 4], (float)off[a + 5]));
                Console.WriteLine((rig == 0 ? "striker" : "bowler") + " head: directed against undirected, before the accept " + gapBeforeMm.ToString("0.0") + " mm / " + turnBefore.ToString("0.0") + " deg, after " + gapAfterMm.ToString("0.0") + " mm / " + turnAfter.ToString("0.0") + " deg");
                Assert.That(turnBefore, Is.GreaterThan(3.0), (rig == 0 ? "striker" : "bowler") + ": the Director has turned the head (the comparison is not vacuous)");
                // (the turn is given back as the same local turns on the re-posed bones, so it is the same within what the base itself changed by across the accept)
                Assert.That(Math.Abs(turnAfter - turnBefore), Is.LessThan(5.0), (rig == 0 ? "striker" : "bowler") + " head direction: the turn is still on across the accept");
                Assert.That(Math.Abs(gapAfterMm - gapBeforeMm), Is.LessThan(5.0), (rig == 0 ? "striker" : "bowler") + " head position: the turn is still on across the accept");
            }
        }

        [Test]
        public void ADeliveryTheHostDidNotTime_IsDrawnUndirected_ExactlyAsTheDirectorOffWorldDrawsIt()
        {
            // a hand-made delivery with no ideal contact (the legacy tests'): nothing to direct, nothing is
            Frame[] Run(bool director)
            {
                if (root != null) UnityEngine.Object.DestroyImmediate(root);
                root = new GameObject("undirected delivery");
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.DirectorEnabled = director;
                world.Configure(new PracticePresentationSettings { Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.Standard }, new NullSink());
                var fielders = new PracticeFielderPresentation[11];
                for (var f = 0; f < fielders.Length; f++)
                    fielders[f] = new PracticeFielderPresentation { Id = "fielder-" + f, Role = f == 0 ? "keeper" : f == 1 ? "bowler" : "point", X = f - 5, Z = f * 2 };
                world.ConfigureScene(new PracticeScenePresentation { BallAge = "new", BallColour = "red", BatterCreaseOffsetM = 0, BatterLateralM = 0, BowlerArm = "right", BowlerFamily = "pace", Conditions = "balanced", Handedness = "right", Fielders = fielders });
                // the scene between balls first (the Director acts there), then a delivery nobody timed
                for (var k = 0; k < 200; k++) world.Tick(Step);
                if (director) Assert.That(world.DirectedLifeForEvidence(DirectorRole.Striker).Active || world.DirectedLifeForEvidence(DirectorRole.Bowler).Active, Is.True, "the scene between balls is alive (the comparison is not vacuous)");
                world.BeginDelivery(new PracticeDeliveryPresentation
                {
                    Flight = new[]
                    {
                        new Vande.Practice.Trace.BallTraceSample { t = 0, p = new Vande.Practice.Trace.TraceVector3 { x = 0, y = 2, z = -8 }, v = new Vande.Practice.Trace.TraceVector3 { x = 0, y = -1, z = 35 } },
                        new Vande.Practice.Trace.BallTraceSample { t = 1, p = new Vande.Practice.Trace.TraceVector3 { x = 0, y = 0.4, z = 9 }, v = new Vande.Practice.Trace.TraceVector3 { x = 0, y = 0, z = 20 } }
                    },
                    SeamAxis = new Vande.Practice.Trace.TraceVector3 { x = 0, y = 1, z = 0 },
                    ShineDirection = new Vande.Practice.Trace.TraceVector3 { x = 1, y = 0, z = 0 },
                    SpinAxis = new Vande.Practice.Trace.TraceVector3 { x = 0, y = 1, z = 0 },
                    SpinRps = 10
                });
                var humans = world.PresentedHumansForEvidence();
                var frames = new Frame[2];
                for (var k = 0; k < 150; k++) world.Tick(Step);
                Assert.That(world.DirectorScriptForEvidence == null || world.DirectorScriptForEvidence.ScriptKind == StageKind.Idle || !director, Is.True, "no live script for a delivery the host did not time");
                frames[0] = new Frame { Pose = { [1] = PoseOf(humans.First(p => p.Key == "striker").Value), [0] = PoseOf(humans.First(p => p.Key == "bowler").Value) } };
                return frames;
            }
            var off = Run(false);
            var on = Run(true);
            // The bowler is drawn bit for bit as the undirected world draws him. The striker's arms keep the world's own solver memory (swivel and grip
            // roll hysteresis) of the breathing the scene between balls had given them, so the striker agrees to a fraction of a millimetre and a degree.
            Assert.That(on[0].Pose[0].SequenceEqual(off[0].Pose[0]), Is.True, "the bowler is drawn as the undirected world draws him");
            double worstMm = 0, worstDeg = 0;
            for (var j = 0; j < Joints.Length; j++)
            {
                var a = off[0].Pose[1];
                var b = on[0].Pose[1];
                worstMm = Math.Max(worstMm, Vector3.Distance(new Vector3(a[j * 7], a[j * 7 + 1], a[j * 7 + 2]), new Vector3(b[j * 7], b[j * 7 + 1], b[j * 7 + 2])) * 1000.0);
                worstDeg = Math.Max(worstDeg, Quaternion.Angle(Rot(a, Joints[j]), Rot(b, Joints[j])));
            }
            Console.WriteLine("undirected delivery after a scene between balls: striker differs from the Director-off world by at most " + worstMm.ToString("0.000") + " mm, " + worstDeg.ToString("0.000") + " deg");
            Assert.That(worstMm, Is.LessThan(1.0), "the striker is drawn as the undirected world draws him (mm)");
            Assert.That(worstDeg, Is.LessThan(1.0), "(degrees)");
        }

        [Test]
        public void TheWorldsFramePath_OfTheDirector_AllocatesNothing()
        {
            // The two halves of the Director's frame in the world (the plans sampled and the life set at the top, the head passes at the end), the rig's life and the
            // undo of the passes: scanned for allocating instructions. (The spare-time bakes after them allocate a plan once per plan, off the frame path; the failure
            // path allocates its message once, when the Director switches itself off.)
            var found = new List<string>();
            var seen = new HashSet<System.Reflection.MethodBase>();
            var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance;
            StageAllocationScan.ExtraFollow = callee => callee.DeclaringType == typeof(ProceduralPracticeWorld) && callee.Name.StartsWith("Director", StringComparison.Ordinal) && callee.Name != "DirectorFail";
            // Not allocations of the frame path: the failure path (once, when the Director switches itself off), the lazy creations and the entry to the scene between balls (the runtime, each rig's pass and each scene's scripts, once), the
            // runtime's own frame and reduced-motion switch (scanned and measured by DirectorStageRuntimeTests: a frame whose plan is not yet baked is forced to bake it), the
            // spare-time bakes (a plan once per plan), the cap's re-placement, and property getters (field reads).
            StageAllocationScan.ExtraQuiet = callee =>
                (callee.DeclaringType == typeof(ProceduralPracticeWorld) && (callee.Name == "DirectorFail" || callee.Name == "EnsureDirector" || callee.Name == "DirectorHeadPassFor" || callee.Name == "DirectorEnterIdle" || callee.Name == "DirectedRig" ||
                 callee.Name.StartsWith("get_", StringComparison.Ordinal) || callee.Name.StartsWith("set_Director", StringComparison.Ordinal))) ||
                (callee.DeclaringType == typeof(UnityEngine.Component) && callee.Name == "get_gameObject") ||
                (callee.DeclaringType == typeof(ProductionCharacterRig) && (callee.Name.StartsWith("get_", StringComparison.Ordinal) || callee.Name.StartsWith("set_", StringComparison.Ordinal) || callee.Name == "FollowHeadPassWithCap" || callee.Name == "TryGetVisibleHeadBones")) ||
                (callee.DeclaringType == typeof(DirectorStageRuntime) && (callee.Name == "Work" || callee.Name == "Frame" || callee.Name == "SetReducedMotion" || callee.Name == "Drawn" || callee.Name == "Busy")) ||
                (callee.DeclaringType == typeof(UnityEngine.GameObject) && callee.Name == "get_activeInHierarchy") ||
                (callee.Name.StartsWith("get_", StringComparison.Ordinal) && (callee.DeclaringType.Namespace ?? "").StartsWith("Vande.Practice", StringComparison.Ordinal));
            try
            {
                foreach (var name in new[] { "DirectorBeginFrameCore", "DirectorEndFrameCore", "DirectorUndoHeadPasses", "DirectorRedoHeadPasses", "DirectorStrikerHeadHeld" })
                {
                    var method = typeof(ProceduralPracticeWorld).GetMethod(name, flags);
                    Assert.That(method, Is.Not.Null, name);
                    StageAllocationScan.Scan(method, seen, found);
                }
                // the head pass's frame: the hold, its release, the bone caps and the world guard
                StageAllocationScan.Scan(typeof(DirectorHeadPass).GetMethod("Apply"), seen, found);
                StageAllocationScan.Scan(typeof(DirectorHeadPass).GetMethod("Redo"), seen, found);
                StageAllocationScan.Scan(typeof(DirectorHeadPass).GetMethod("Undo"), seen, found);
                // what the rig does with the Director's life per pose
                foreach (var name in new[] { "ApplyDirectedLifeToDrivers", "StripDirectedLife" })
                    StageAllocationScan.Scan(typeof(ProductionCharacterRig).GetMethod(name, flags), seen, found);
            }
            finally
            {
                StageAllocationScan.ExtraFollow = null;
                StageAllocationScan.ExtraQuiet = null;
            }
            Assert.That(found, Is.Empty, "allocating instructions on the Director's frame path in the world: " + string.Join("; ", found));
        }

        [Test]
        public void TheDirector_ActsInTheSceneBetweenBalls_ButNeverBeforeItsPlansAreBaked_AndNothingThrows()
        {
            var on = Play("grounded-attack", "right", true, false);
            var first = on.FindIndex(f => f.LifeActive);
            Assert.That(first, Is.GreaterThan(0), "the plans are baked in spare slices, not in the frame that asks for them");
            Assert.That(first, Is.LessThan(120), "and the bodies are alive within two seconds of the scene appearing");
        }
    }
}
