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
    /// UNITY-7 task D: the spin bowler's cap is the one procedural prop of the striker and bowler that the hero path draws (the
    /// striker's helmet, pads and gloves are in his skinned gear mesh and the pace bowler has no prop at all); it was parented to the
    /// DRIVER rig's head joint and stood 1.1, 2.4, 1.4, 4.5, 4.7 and 6.5 cm off the hero's head at the run-up, gather, release, two
    /// follow-through frames and the walk back. It now hangs from a follower of the hero's head.
    /// </summary>
    public sealed class ProductionCapFollowsHeroTests
    {
        private const double Step = 1.0 / 60.0;

        private static readonly double[] Instants = { -1.40, -0.45, 0.0, 0.20, 0.45, 1.30 };

        private static float[] Gaps(bool follows)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures", "unity-practice", "practice-v3.json"));
            var item = JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == "grounded-attack");
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.BowlerFamily = "spin";
            scene.BowlerSpinType = "finger";
            var root = new GameObject("cap follows hero");
            try
            {
                var world = root.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.Standard
                }, new NullSink());
                world.ConfigureScene(scene);
                world.BeginDelivery(delivery);
                var bowler = world.PresentedHumansForEvidence().First(pair => pair.Key.StartsWith("bowler")).Value;
                bowler.CapFollowsHeroEnabled = follows;
                var gaps = new List<float>();
                var next = 0;
                var accepted = false;
                for (var step = 0; step < 700 && next < Instants.Length; step++)
                {
                    if (!accepted && world.TimelineForEvidence >= 0.0 - 1e-9)
                    {
                        world.AcceptResult(result);
                        accepted = true;
                    }
                    world.Tick(Step);
                    if (world.TimelineForEvidence + 1e-9 < Instants[next]) continue;
                    next++;
                    var worst = 0f;
                    var parts = bowler.Root.GetComponentsInChildren<Renderer>(false)
                        .Where(renderer => renderer.enabled && renderer.gameObject.name.StartsWith("SpinBowlerCap", StringComparison.Ordinal)).ToArray();
                    Assert.That(parts.Length, Is.EqualTo(2), "the cap is drawn (crown and peak)");
                    foreach (var part in parts)
                    {
                        // Where the part is carried by the driver's head, and where the hero's head would carry the same offset.
                        var driver = bowler.Joint(ProductionCharacterJoint.Head);
                        var follower = part.transform.parent;
                        var frame = follower != null && follower.name == "SpinBowlerCapFollower" ? follower : driver;
                        var offset = Quaternion.Inverse(frame.rotation) * (part.bounds.center - frame.position);
                        var hero = bowler.VisibleJointWorldPosition(ProductionCharacterJoint.Head) +
                                   bowler.VisibleJointWorldRotation(ProductionCharacterJoint.Head) * offset;
                        worst = Mathf.Max(worst, Vector3.Distance(part.bounds.center, hero) * 100f);
                    }
                    gaps.Add(worst);
                }
                return gaps.ToArray();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void TheCapSitsOnTheHeroHeadAtSixInstantsOfTheDelivery()
        {
            var gaps = Gaps(true);
            Assert.That(gaps.Length, Is.EqualTo(Instants.Length));
            for (var index = 0; index < gaps.Length; index++)
                Assert.That(gaps[index], Is.LessThanOrEqualTo(0.2f), "cap gap to the hero's head (cm) at t=" + Instants[index]);
        }

        [Test]
        public void TheControl_OnTheDriversHeadTheCapStoodMoreThanTwoCentimetresOffAtFollowThrough()
        {
            var gaps = Gaps(false);
            Assert.That(gaps.Max(), Is.GreaterThan(2f), "the cap was more than 2 cm off the hero's head (it was up to 6.5 cm)");
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
