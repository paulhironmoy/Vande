using System;
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
    /// UNITY-8: a governed stride (the physics pads govern: a pad or body contact, or the ball low near the feet) plays TRACKB's
    /// stroke overlay warped from the input to its plant, as the web does (src/render3d/practice/script.ts strokeOverlayIn, strideWindow,
    /// strikerMoves). The warp is clip time P (a u + b u^2) over the window W = min(P, input-to-contact-or-arrival) with
    /// a = 2 - W / P, b = W / P - 1 (speed 1x at the plant, nothing before the input); a window shorter than the clip's minimum
    /// (233.3 ms forward, 166.7 ms back) keeps the code-authored stride that plants in it.
    /// </summary>
    public sealed class ProductionGovernedStrideTests
    {
        private const double Forward = 0.32;
        private const double Back = 0.28;

        // ---- the warp -----------------------------------------------------------------------------------------------------

        [TestCase(Forward, 0.2333)]
        [TestCase(Forward, 0.28)]
        [TestCase(Forward, 0.30)]
        [TestCase(Back, 0.1667)]
        [TestCase(Back, 0.22)]
        public void TheWarp_StartsAtTheInput_PlantsOnTheMarkerAtTheEndOfTheWindow_AndThenRunsAtItsOwnPace(double plant, double window)
        {
            Assert.That(ProceduralPracticeWorld.GovernedClipTime(0.0, plant, window), Is.EqualTo(0.0).Within(1e-12));
            Assert.That(ProceduralPracticeWorld.GovernedClipTime(window, plant, window), Is.EqualTo(plant).Within(1e-9),
                "the clip's plant lands exactly at the window's end");
            foreach (var later in new[] { 0.01, 0.1, 0.4 })
                Assert.That(ProceduralPracticeWorld.GovernedClipTime(window + later, plant, window), Is.EqualTo(plant + later).Within(1e-9),
                    "1x after the plant");
        }

        [TestCase(Forward, 0.2333)]
        [TestCase(Forward, 0.30)]
        [TestCase(Back, 0.1667)]
        [TestCase(Back, 0.25)]
        public void TheWarp_NeverLeadsTheInput_NeverRunsBackwards_AndNeverFasterThanItsFirstPiece(double plant, double window)
        {
            Assert.That(ProceduralPracticeWorld.GovernedClipTime(-0.5, plant, window), Is.EqualTo(0.0), "nothing before the input");
            var previous = 0.0;
            var fastest = 0.0;
            for (var step = 1; step <= 1000; step++)
            {
                var since = step * 0.001;
                var now = ProceduralPracticeWorld.GovernedClipTime(since, plant, window);
                Assert.That(now, Is.GreaterThanOrEqualTo(previous), "never backwards, " + since);
                Assert.That(now, Is.GreaterThanOrEqualTo(since - 1e-9), "the warp is never behind the clip's own pace");
                fastest = Math.Max(fastest, (now - previous) / 0.001);
                previous = now;
            }
            // The clip starts at (2 P / W - 1) times its pace and slows to 1x at the plant: 1.74x at the forward minimum, 2.36x at the back one.
            var start = 2.0 * plant / window - 1.0;
            Assert.That(fastest, Is.LessThanOrEqualTo(start * 1.05 + 1e-6), "the quickest the clip is played");
            Assert.That(fastest, Is.GreaterThanOrEqualTo(1.0), "and at least its own pace");
        }

        [Test]
        public void TheWarp_AtTheShortestWindowsIsAtMostTwoPointFourTimesItsOwnPace()
        {
            Assert.That(2.0 * Forward / ProceduralPracticeWorld.StrokeMinWindowForwardSeconds - 1.0, Is.EqualTo(1.743).Within(0.001));
            Assert.That(2.0 * Back / ProceduralPracticeWorld.StrokeMinWindowBackSeconds - 1.0, Is.EqualTo(2.360).Within(0.001));
        }

        [Test]
        public void TheWarp_AWindowOfTheMarkerOrMoreIsNotWarped()
        {
            foreach (var window in new[] { Forward, 0.4, 1.0 })
                foreach (var since in new[] { 0.0, 0.05, 0.2, 0.32, 0.6 })
                    Assert.That(ProceduralPracticeWorld.GovernedClipTime(since, Forward, window), Is.EqualTo(since).Within(1e-12));
            // And a natural stride (no plant marker, no window) is the clip at its own pace from the input.
            Assert.That(ProceduralPracticeWorld.GovernedClipTime(0.123, 0.0, 0.0), Is.EqualTo(0.123).Within(1e-12));
        }

        [Test]
        public void TheWarp_IsTheWebsEightPieceCurve_ExactAtThePiecesEnds()
        {
            const double plant = Forward;
            const double window = 0.25;
            var a = 2.0 - window / plant;
            var b = window / plant - 1.0;
            for (var piece = 0; piece <= 8; piece++)
            {
                var u = piece / 8.0;
                var exact = plant * (a * u + b * u * u);
                Assert.That(ProceduralPracticeWorld.GovernedClipTime(u * window, plant, window), Is.EqualTo(exact).Within(1e-9), "piece end " + piece);
            }
            // Between the ends the web draws a straight line: half way through a piece is the mean of its ends.
            for (var piece = 0; piece < 8; piece++)
            {
                var u0 = piece / 8.0;
                var u1 = (piece + 1) / 8.0;
                var mean = 0.5 * (plant * (a * u0 + b * u0 * u0) + plant * (a * u1 + b * u1 * u1));
                Assert.That(ProceduralPracticeWorld.GovernedClipTime(0.5 * (u0 + u1) * window, plant, window), Is.EqualTo(mean).Within(1e-9),
                    "the middle of piece " + piece);
            }
        }

        // ---- the decision -------------------------------------------------------------------------------------------------

        public static System.Collections.Generic.IEnumerable<TestCaseData> Decisions()
        {
            // golden, window s from the input to the contact, expected: overlay?, plant window s
            yield return new TestCaseData("thin-edge", 0.30, true, 0.30).SetName("forward 300 ms: warped to a 300 ms plant");
            yield return new TestCaseData("thin-edge", 0.25, true, 0.25).SetName("forward 250 ms: warped to a 250 ms plant");
            yield return new TestCaseData("thin-edge", 0.40, true, 0.32).SetName("forward 400 ms: the clip's own 320 ms plant, unwarped");
            yield return new TestCaseData("thin-edge", 0.20, false, 0.0).SetName("forward 200 ms: shorter than 233.3 ms, the code-authored stride");
            yield return new TestCaseData("grounded-attack", 0.25, true, 0.25).SetName("back 250 ms: warped to a 250 ms plant");
            yield return new TestCaseData("grounded-attack", 0.19, true, 0.19).SetName("back 190 ms: longer than 166.7 ms, warped to a 190 ms plant");
            yield return new TestCaseData("grounded-attack", 0.40, true, 0.28).SetName("back 400 ms: the clip's own 280 ms plant, unwarped");
            yield return new TestCaseData("grounded-attack", 0.15, false, 0.0).SetName("back 150 ms: shorter than 166.7 ms, the code-authored stride");
        }

        [TestCaseSource(nameof(Decisions))]
        public void AGovernedStride_PlaysTheOverlayWarpedToItsPlant_OrKeepsTheCodeAuthoredStrideInAShortWindow(
            string id, double window, bool overlay, double plantWindow)
        {
            var run = Accept(id, window, pad: true, governedPackStroke: true);
            Assert.That(run.Governed, Is.True, "a pad event governs the stride");
            Assert.That(run.PackValid, Is.EqualTo(overlay), "the overlay is played only when the input-to-contact window is long enough");
            if (overlay)
            {
                Assert.That(run.PlantWindow, Is.EqualTo(plantWindow).Within(1e-6));
                Assert.That(run.PlantMarker, Is.EqualTo(id == "thin-edge" ? 0.32 : 0.28).Within(1e-6), "the clip's plant marker");
                Assert.That(run.PlantT - run.InputT, Is.EqualTo(plantWindow).Within(1e-6), "the physics pads' stride lands with the clip's plant");
                Assert.That(run.PlantT, Is.GreaterThan(run.InputT), "never before the input");
            }
            else
            {
                Assert.That(run.PlantWindow, Is.Zero);
                Assert.That(run.PlantT - run.InputT, Is.EqualTo(window).Within(0.004),
                    "the code-authored stride plants in the window (at most 3x its pace), as it did");
            }
        }

        [TestCase("thin-edge", 0.30)]
        [TestCase("grounded-attack", 0.30)]
        public void TheSeam_WithTheOverlayOff_KeepsTheCodeAuthoredStride(string id, double window)
        {
            var run = Accept(id, window, pad: true, governedPackStroke: false);
            Assert.That(run.Governed, Is.True);
            Assert.That(run.PackValid, Is.False);
        }

        [TestCase("thin-edge", 0.30)]
        [TestCase("grounded-attack", 0.30)]
        public void ANaturalStride_IsUnchanged_TheOverlayAtItsOwnPace(string id, double window)
        {
            var run = Accept(id, window, pad: false, governedPackStroke: true);
            Assert.That(run.Governed, Is.False, "nothing governs this stride");
            Assert.That(run.PackValid, Is.True);
            Assert.That(run.PlantWindow, Is.Zero, "no warp");
            Assert.That(run.PlantT - run.InputT, Is.EqualTo(0.32).Within(1e-6), "planted 0.32 s in, as before");
        }

        // ---- the scenario -------------------------------------------------------------------------------------------------

        private sealed class Planned
        {
            public bool Governed, PackValid;
            public double PlantMarker, PlantWindow, InputT, DueT, PlantT;
        }

        /// <summary>
        /// A golden accepted with its swing start moved to `window` seconds before the stride is due (its contact or the ball's arrival,
        /// whichever is first; a replay: the result is known before the input), with a pad event added to the trace at the contact when
        /// `pad` (a governed stride).
        /// </summary>
        private static Planned Accept(string id, double window, bool pad, bool governedPackStroke)
        {
            var fixture = LoadFixture();
            var item = fixture.cases.Single(value => value.id == id);
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            var delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery));
            var result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result));
            scene.Handedness = "right";
            var contact = result.Trace.events.First(value => value.kind == "contact");
            // The stride is due at the physics contact or the ball's arrival at the footwork's contact plane, whichever is first.
            var arrival = ProductionBatterBodyModel.IdealTimeFor(delivery.Flight, delivery.IdealContactT, result.Footwork);
            result.SwingStartT = Math.Min(arrival, contact.t) - window;
            if (pad)
            {
                var events = result.Trace.events.ToList();
                events.Insert(events.IndexOf(contact), new CanonicalTraceEvent { t = contact.t - 0.004, kind = "pad", p = contact.p });
                result.Trace.events = events.ToArray();
            }
            var root = new GameObject("Production governed stride " + id);
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
                world.GovernedPackStrokeEnabled = governedPackStroke;
                world.Tick(0.10 - world.TimelineForEvidence);
                world.AcceptResult(result);
                var planned = new Planned { Governed = world.StrikerStrideGovernedForEvidence };
                string clip;
                double startT;
                planned.PackValid = world.PackStrokeForEvidence(out clip, out startT, out planned.PlantMarker, out planned.PlantWindow);
                world.StrikerStrideTimesForEvidence(out planned.InputT, out planned.DueT, out planned.PlantT);
                return planned;
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static GoldenFixture LoadFixture()
        {
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore("practice-v3 shared golden is required for the governed stride tests.");
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
