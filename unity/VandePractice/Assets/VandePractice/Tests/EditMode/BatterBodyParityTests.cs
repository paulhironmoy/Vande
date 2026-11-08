using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The lead's 5f body ruling (2026-11-04): Unity ports the frozen physics batterBody (src/physics/bat.ts) instead of
    /// a contract change. tests/fixtures/unity-practice/batter-body-v1.json is generated from TS on the golden
    /// practice-v3 flights for every footwork (tests/unit/practice/unity/batterBodyParity.test.ts); the C# port must
    /// equal it within 1 mm, in the physics frame and through the reflection for both hands.
    /// </summary>
    public sealed class BatterBodyParityTests
    {
        private const double ToleranceMetres = 0.001;

        [Serializable] private sealed class V { public double x; public double y; public double z; }
        [Serializable] private sealed class Cap { public V a; public V b; public double r; }
        [Serializable] private sealed class Head { public V c; public double r; }
        [Serializable] private sealed class BodyCase
        {
            public string id;
            public string footwork;
            public V stance;
            public Cap[] pads;
            public Cap torso;
            public Head head;
        }
        [Serializable] private sealed class BodyFixture { public int fixtureVersion; public BodyCase[] cases; }
        [Serializable] private sealed class Golden { public GoldenCase[] cases; }
        [Serializable] private sealed class GoldenCase { public string id; public GoldenWire wire; }
        [Serializable] private sealed class GoldenWire { public GoldenPackets packets; }
        [Serializable] private sealed class GoldenPackets { public UnityPracticePacket delivery; }

        private static string Fixture(string name) => Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..",
            "tests", "fixtures", "unity-practice", name));

        private static void Near(ProductionBatterBodyModel.Point actual, V expected, string what)
        {
            Assert.That(actual.X, Is.EqualTo(expected.x).Within(ToleranceMetres), what + ".x");
            Assert.That(actual.Y, Is.EqualTo(expected.y).Within(ToleranceMetres), what + ".y");
            Assert.That(actual.Z, Is.EqualTo(expected.z).Within(ToleranceMetres), what + ".z");
        }

        [Test]
        public void Port_EqualsTheFrozenPhysicsBody_ForEveryGoldenFlightAndFootwork()
        {
            var body = JsonUtility.FromJson<BodyFixture>(File.ReadAllText(Fixture("batter-body-v1.json")));
            var golden = JsonUtility.FromJson<Golden>(File.ReadAllText(Fixture("practice-v3.json")));
            Assert.That(body.fixtureVersion, Is.EqualTo(1));
            Assert.That(body.cases.Length, Is.EqualTo(golden.cases.Length * 5));
            foreach (var item in golden.cases)
            {
                var delivery = PracticePresentationContractAdapter.Delivery(
                    UnityPracticePacketCodec.Decode(JsonUtility.ToJson(item.wire.packets.delivery)).Envelope);
                foreach (var expected in body.cases.Where(c => c.id == item.id))
                {
                    var footwork = string.IsNullOrEmpty(expected.footwork) ? null : expected.footwork;
                    var actual = ProductionBatterBodyModel.For(footwork, delivery.Flight, delivery.IdealContactT);
                    var label = item.id + "/" + (footwork ?? "stance");
                    Near(actual.Stance, expected.stance, label + " stance");
                    Near(actual.FrontPad.A, expected.pads[0].a, label + " front pad bottom");
                    Near(actual.FrontPad.B, expected.pads[0].b, label + " front pad top");
                    Near(actual.BackPad.A, expected.pads[1].a, label + " back pad bottom");
                    Near(actual.BackPad.B, expected.pads[1].b, label + " back pad top");
                    Near(actual.Torso.A, expected.torso.a, label + " torso base");
                    Near(actual.Torso.B, expected.torso.b, label + " torso top");
                    Near(actual.HeadCentre, expected.head.c, label + " head");
                    Assert.That(actual.FrontPad.R, Is.EqualTo(expected.pads[0].r).Within(1e-12));
                    Assert.That(actual.Torso.R, Is.EqualTo(expected.torso.r).Within(1e-12));
                    Assert.That(actual.HeadR, Is.EqualTo(expected.head.r).Within(1e-12));
                }
            }
        }

        [TestCase("right")]
        [TestCase("left")]
        public void Reflection_MirrorsOnlyX(string hand)
        {
            // Option A (2026-11-04): a right-hander's world is reflected once; a left-hander keeps physics x.
            var stance = ProductionBatterBodyModel.For(null, null, 0.0).FrontPad.A;
            var m = ProceduralPracticeWorld.WorldReflectionFor(hand);
            var unity = new Vector3(m * (float)stance.X, (float)stance.Y, (float)stance.Z);
            Assert.That(unity.x, Is.EqualTo(hand == "right" ? 0.16f : -0.16f).Within(1e-6f));
            Assert.That(unity.z, Is.EqualTo((float)(10.06 - 1.44)).Within(1e-6f));
        }
    }
}
