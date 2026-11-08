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
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UNITY-7 task C, the stroke table's leave row on Unity: a leave stays in TRACKB's ready hold (the bat at its compact top)
    /// and the clip bat_leave turns the head to watch the ball past; it used to be re-sampled to the code-authored stance by the
    /// result (a bat that dropped 37 cm and a trunk that turned 10 degrees in one frame, no head turn). The golden complete-miss
    /// delivery played with no input and its result made a leave (what the host sends for a ball the player let go).
    /// </summary>
    public sealed class ProductionLeaveOverlayTests
    {
        private const double Step = 1.0 / 60.0;

        private static readonly ProductionCharacterJoint[] Torso =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head
        };

        private static readonly double[] TorsoCaps = { 600.0, 600.0, 600.0, 720.0, 720.0 };

        private sealed class Frame
        {
            public double T;
            public Quaternion[] Joints;
            public Vector3 BatCap;
        }

        private static List<Frame> Play(bool overlay, string hand, out int acceptIndex)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == "complete-miss");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = hand;
            result.ShotIntent = "leave";
            result.SwingStartT = null;
            result.SwingDirectionDeg = 0.0;
            result.Footwork = null;
            result.ContactKind = "leave";
            result.ContactTiming = "none";
            result.Trace.bat = new BatTraceSample[0];
            result.Trace.batterMotion = null;
            result.Trace.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            result.Trace.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
            var root = new GameObject("leave overlay test");
            acceptIndex = -1;
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play", Handedness = hand, Locale = "en-IN", Quality = PracticePresentationQuality.Standard
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                world.LeaveOverlayEnabled = overlay;
                var striker = world.PresentedHumansForEvidence().Single(pair => pair.Key == "striker").Value;
                var flightEnd = delivery.Flight[delivery.Flight.Length - 1].t;
                world.Tick(delivery.IdealContactT - 0.6 - world.TimelineForEvidence);
                var frames = new List<Frame>();
                var passed = false;
                var countdown = 4;
                for (var step = 0; step < 300; step++)
                {
                    if (!passed && world.TimelineForEvidence >= flightEnd - 1e-9) passed = true;
                    if (passed && acceptIndex < 0)
                    {
                        if (countdown == 0)
                        {
                            world.AcceptResult(result);
                            acceptIndex = frames.Count;
                        }
                        else countdown--;
                    }
                    world.Tick(Step);
                    frames.Add(new Frame
                    {
                        T = world.TimelineForEvidence,
                        Joints = Torso.Select(striker.VisibleJointWorldRotation).ToArray(),
                        BatCap = striker.Bat.position
                    });
                    if (acceptIndex >= 0 && frames.Count > acceptIndex + 45) break;
                }
                return frames;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [TestCase("right")]
        [TestCase("left")]
        public void ALeaveStaysInTheReadyHold_NothingPopsAtTheResult_AndTheHeadTurnsToWatchTheBallPast(string hand)
        {
            int accept;
            var frames = Play(true, hand, out accept);
            Assert.That(accept, Is.GreaterThan(3));
            var at = frames[accept];
            var before = frames[accept - 1];
            Assert.That(Vector3.Distance(at.BatCap, before.BatCap), Is.LessThan(0.02f), "the bat does not move at the result (it moved 37 cm)");
            for (var index = accept; index < frames.Count; index++)
            {
                var dt = frames[index].T - frames[index - 1].T;
                if (dt <= 0.0) continue;
                for (var joint = 0; joint < Torso.Length; joint++)
                    Assert.That(Quaternion.Angle(frames[index - 1].Joints[joint], frames[index].Joints[joint]) / dt, Is.LessThanOrEqualTo(TorsoCaps[joint]),
                        Torso[joint] + " " + (index - accept) + " frames after the result");
            }
            var head = Array.IndexOf(Torso, ProductionCharacterJoint.Head);
            Assert.That(Quaternion.Angle(before.Joints[head], frames[Math.Min(frames.Count - 1, accept + 40)].Joints[head]), Is.GreaterThan(10f),
                "the head turns to watch the ball past");
            var hips = Array.IndexOf(Torso, ProductionCharacterJoint.Hips);
            Assert.That(Quaternion.Angle(before.Joints[hips], frames[Math.Min(frames.Count - 1, accept + 40)].Joints[hips]), Is.LessThan(3f),
                "the body stays in the stance");
        }

        [Test]
        public void TheSeamKeepsTheOldLeave_TheControl()
        {
            int accept;
            var frames = Play(false, "right", out accept);
            Assert.That(Vector3.Distance(frames[accept].BatCap, frames[accept - 1].BatCap), Is.GreaterThan(0.2f),
                "without the overlay the result drops the bat to the code-authored stance");
        }

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
