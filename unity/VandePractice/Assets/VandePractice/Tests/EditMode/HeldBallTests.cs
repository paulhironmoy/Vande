using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Lead ruling 2026-11-04 (held ball): between the physics take and the physics throw release the ball is drawn in
    /// the holder's hand; it leaves the physics path exactly at the take and rejoins it exactly at the release, and the
    /// flight before and after is exactly the physics. Golden practice-v3 thin-edge: third man fields, then throws.
    /// </summary>
    public sealed class HeldBallTests
    {
        private const double Step = 1.0 / 60.0;
        private GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
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

        private static Vector3 PhysicsBall(CanonicalDeliveryTrace trace, double t, float mirror)
        {
            var samples = trace.ball;
            var upper = 0;
            while (upper < samples.Length && samples[upper].t < t) upper++;
            TraceVector3 p;
            if (upper == 0) p = samples[0].p;
            else if (upper >= samples.Length) p = samples[samples.Length - 1].p;
            else
            {
                var a = samples[upper - 1];
                var b = samples[upper];
                var u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0.0;
                p = new TraceVector3 { x = a.p.x + (b.p.x - a.p.x) * u, y = a.p.y + (b.p.y - a.p.y) * u, z = a.p.z + (b.p.z - a.p.z) * u };
            }
            return new Vector3(mirror * (float)p.x, (float)p.y, (float)p.z);
        }

        [Test]
        public void GoldenThinEdgeThrow_BallLeavesThePathAtTheTakeAndRejoinsItAtTheRelease()
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == "thin-edge");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            var take = result.Trace.events.Single(e => e.kind == "field");
            var release = result.Trace.events.Single(e => e.kind == "throw");
            Assert.That(take.fielderId, Is.EqualTo("third_man"));
            Assert.That(release.fielderId, Is.EqualTo("third_man"));

            root = new GameObject("held ball test");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.High
            }, new NullSink());
            world.ConfigureScene(scene);
            world.BeginDelivery(delivery);
            var ball = world.BallForEvidence;
            Assert.That(ball, Is.Not.Null);
            var holder = world.PresentedHumansForEvidence().First(pair => pair.Key == "fielder:third_man").Value;
            var accepted = false;
            var checkedBefore = 0;
            var checkedHeld = 0;
            var checkedAfter = 0;
            for (var frame = 0; frame < 20000 && world.TimelineForEvidence < release.t + 0.6; frame++)
            {
                if (!accepted && world.TimelineForEvidence >= 0.10)
                {
                    world.AcceptResult(result);
                    accepted = true;
                }
                world.Tick(Step);
                if (!accepted) continue;
                var t = world.TimelineForEvidence;
                var physics = PhysicsBall(result.Trace, t, -1f);
                if (t > take.t - 0.5 && t <= take.t)
                {
                    Assert.That(Vector3.Distance(ball.position, physics), Is.LessThan(1e-3f), "before the take at " + t);
                    checkedBefore++;
                }
                else if (t > take.t + 0.1 && t < release.t - 0.1)
                {
                    var palm = ProceduralPracticeWorld.HeldBallPalm(holder, false);
                    Assert.That(Vector3.Distance(ball.position, palm), Is.LessThan(1e-3f), "in the hand at " + t);
                    checkedHeld++;
                }
                else if (t >= release.t && t < release.t + 0.5)
                {
                    Assert.That(Vector3.Distance(ball.position, physics), Is.LessThan(1e-3f), "after the release at " + t);
                    checkedAfter++;
                }
            }
            Assert.That(checkedBefore, Is.GreaterThan(5));
            Assert.That(checkedHeld, Is.GreaterThan(5));
            Assert.That(checkedAfter, Is.GreaterThan(5));
            var gaps = world.HeldBallReleaseHandGapsForEvidence();
            Assert.That(gaps.Count, Is.EqualTo(1));
            TestContext.WriteLine("thin-edge hand to physics release point at the throw: " + gaps[0] + " m (ruling: <= 0.10)");
        }
    }
}
