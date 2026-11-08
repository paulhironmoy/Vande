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
using Vande.Practice.Presentation.Production.Effects;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UNITY-7 task A (the lead's ruling): the world never draws a ball position the physics has not produced. From the moment a
    /// committed swing's ball reaches the bat (its ideal arrival at the footwork's contact plane), or any delivery's flight data is
    /// used up, until the result is accepted, no ball, readability ring, focus aid or inset marker is drawn; at the accept the ball is
    /// where the physics has it. A result that arrives before the ball reaches the bat gives exactly the frames of the drawing before
    /// the change, and the cues keep their times. Golden practice-v3 (tests/fixtures/unity-practice/practice-v3.json).
    /// </summary>
    public sealed class PendingBallTests
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

        private sealed class RecordingSink : IPracticeFeedbackSink
        {
            public readonly List<string> Events = new List<string>();
            public ProceduralPracticeWorld World;

            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }

            public void Handle(PracticeFeedbackEvent feedback) =>
                Events.Add(feedback.Kind + "@" + feedback.SimulationTime.ToString("R", System.Globalization.CultureInfo.InvariantCulture) +
                           " heard at " + (World != null ? World.TimelineForEvidence : double.NaN).ToString("R", System.Globalization.CultureInfo.InvariantCulture));
        }

        private struct Frame
        {
            public double T;
            public bool Drawn;
            public Vector3 Position;
            public bool Rings;
            public bool Inset;
            public bool Accepted;
        }

        private sealed class Run
        {
            public List<Frame> Frames = new List<Frame>();
            public int AcceptIndex = -1;
            public PracticeResultPresentation Result;
            public PracticeDeliveryPresentation Delivery;
            public RecordingSink Sink;
        }

        private static UnityPracticeEnvelope Decode(UnityPracticePacket packet) =>
            UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packet)).Envelope;

        private static Case Load(string id)
        {
            var path = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            return JsonUtility.FromJson<Fixture>(File.ReadAllText(path)).cases.Single(c => c.id == id);
        }

        /// <summary>The flight line (or any trace's ball) at t in the presentation's frame (x reflected once for the right-hander).</summary>
        private static Vector3 BallAt(BallTraceSample[] samples, double t)
        {
            var sample = PracticeTraceSampling.BallAt(samples, t);
            return new Vector3(-(float)sample.p.x, (float)sample.p.y, (float)sample.p.z);
        }

        private static bool InsetMarker(ProceduralPracticeWorld world)
        {
            var pip = world.FieldPipForEvidence;
            var marker = pip?.Camera?.transform.parent?.Find("Ball");
            return marker != null && marker.gameObject.activeSelf;
        }

        /// <summary>
        /// The live flow of the production world. mode "commit": the press at the recorded swing start and the commitment
        /// `commitDelay` later; "none": nothing is touched; "cancel": a press that is checked back before the ball arrives. The
        /// result is accepted `acceptFrames` frames after the commitment (after the flight data is used up for "none" and "cancel").
        /// </summary>
        private Run Play(string id, string mode, double commitDelay, int acceptFrames, bool legacy, string footwork = null, int framesAfterAccept = 8)
        {
            var item = Load(id);
            var run = new Run
            {
                Result = PracticePresentationContractAdapter.Result(Decode(item.wire.packets.result)),
                Delivery = PracticePresentationContractAdapter.Delivery(Decode(item.wire.packets.delivery)),
                Sink = new RecordingSink()
            };
            var scene = PracticePresentationContractAdapter.Scene(Decode(item.wire.packets.scene));
            root = new GameObject("pending ball test " + id + " " + mode);
            var world = root.AddComponent<ProceduralPracticeWorld>();
            run.Sink.World = world;
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play", Handedness = "right", Locale = "en-IN", Quality = PracticePresentationQuality.Standard
            }, run.Sink);
            world.ConfigureScene(scene);
            world.BeginDelivery(run.Delivery);
            world.PendingBallHidden = !legacy;
            var ball = world.BallForEvidence;
            var effects = world.DeliveryEffectsForEvidence;
            var ideal = run.Delivery.IdealContactT;
            var flightEnd = run.Delivery.Flight[run.Delivery.Flight.Length - 1].t;
            var swingStart = mode == "commit" ? run.Result.SwingStartT ?? 0.15 : ideal - 0.14;
            if (mode == "none") world.Tick(Math.Max(0.0, ideal - 0.3 - world.TimelineForEvidence));
            else
            {
                world.Tick(Math.Max(0.0, swingStart - world.TimelineForEvidence));
                world.BeginLocalPreparation();
            }
            var commitAt = mode == "commit" ? swingStart + commitDelay : flightEnd;
            var committed = false;
            var cancelled = false;
            var countdown = acceptFrames;
            for (var frame = 0; frame < 150 + framesAfterAccept; frame++)
            {
                if (mode == "cancel" && !cancelled && world.TimelineForEvidence >= swingStart + 0.12 - 1e-9)
                {
                    world.CancelLocalPreparation();
                    cancelled = true;
                }
                if (!committed && world.TimelineForEvidence >= commitAt - 1e-9)
                {
                    if (mode == "commit")
                        world.ApplyProvisionalSwing(new PracticeSwingPresentation
                        {
                            Kind = "attack",
                            StartT = world.Timeline,
                            DirectionDeg = run.Result.SwingDirectionDeg,
                            Power = 0.7,
                            Elevation = 0.1,
                            Footwork = footwork ?? (string.IsNullOrEmpty(run.Result.Footwork) ? "auto" : run.Result.Footwork)
                        });
                    committed = true;
                }
                if (committed && run.AcceptIndex < 0)
                {
                    if (countdown == 0)
                    {
                        world.AcceptResult(run.Result);
                        run.AcceptIndex = run.Frames.Count;
                    }
                    else countdown--;
                }
                world.Tick(Step);
                run.Frames.Add(new Frame
                {
                    T = world.TimelineForEvidence,
                    Drawn = ball.gameObject.activeSelf,
                    Position = ball.position,
                    Rings = effects.ReadabilityVisible || effects.FocusVisible,
                    Inset = InsetMarker(world),
                    Accepted = run.AcceptIndex >= 0
                });
                if (run.AcceptIndex >= 0 && run.Frames.Count > run.AcceptIndex + framesAfterAccept) break;
            }
            Assert.That(run.AcceptIndex, Is.GreaterThan(0), "the result was accepted");
            return run;
        }

        [TestCase("grounded-attack", 10)]
        [TestCase("grounded-attack", 14)]
        [TestCase("thin-edge", 10)]
        [TestCase("thin-edge", 14)]
        [TestCase("defensive-tap", 14)]
        [TestCase("deliberate-loft", 14)]
        [TestCase("early-attack", 14)]
        public void CommittedSwing_BallIsHeldBackFromTheBatToTheAccept_ThenIsWhereThePhysicsHasIt(string id, int acceptFrames)
        {
            var run = Play(id, "commit", 0.05, acceptFrames, legacy: false);
            var ideal = run.Delivery.IdealContactT;
            var held = 0;
            for (var index = 0; index < run.AcceptIndex; index++)
            {
                var frame = run.Frames[index];
                if (frame.T <= ideal + 1e-9)
                {
                    Assert.That(frame.Drawn, Is.True, "the ball is drawn until it reaches the bat, at " + frame.T);
                    Assert.That(Vector3.Distance(frame.Position, BallAt(run.Delivery.Flight, frame.T)), Is.LessThan(1e-4f),
                        "and is exactly the delivery's flight (which the physics ball follows before contact), at " + frame.T);
                    Assert.That(frame.Rings && frame.Inset, Is.True, "with its rings and its inset marker, at " + frame.T);
                }
                else
                {
                    held++;
                    Assert.That(frame.Drawn, Is.False, "no ball once it is at the bat and the result is pending, at " + frame.T);
                    Assert.That(frame.Rings, Is.False, "no readability ring or focus aid, at " + frame.T);
                    Assert.That(frame.Inset, Is.False, "no inset marker, at " + frame.T);
                }
            }
            Assert.That(held, Is.GreaterThanOrEqualTo(3), "the result was late enough for the ball to be held back");
            var accept = run.Frames[run.AcceptIndex];
            Assert.That(accept.Drawn, Is.True, "the ball is back in the accept frame");
            Assert.That(accept.Rings && accept.Inset, Is.True);
            var physics = BallAt(run.Result.Trace.ball, accept.T);
            Assert.That(Vector3.Distance(accept.Position, physics), Is.LessThan(1e-3f), "at the physics position (1 mm), at " + accept.T);
            for (var index = run.AcceptIndex; index < run.Frames.Count; index++)
                Assert.That(Vector3.Distance(run.Frames[index].Position, BallAt(run.Result.Trace.ball, run.Frames[index].T)), Is.LessThan(1e-3f));
        }

        [TestCase("grounded-attack", 0)]
        [TestCase("grounded-attack", 1)]
        [TestCase("grounded-attack", 3)]
        [TestCase("thin-edge", 0)]
        [TestCase("thin-edge", 1)]
        [TestCase("thin-edge", 3)]
        [TestCase("deliberate-loft", 3)]
        [TestCase("defensive-tap", 3)]
        public void ResultBeforeTheBatReachesIt_FramesAreBitIdenticalToTheDrawingBeforeTheChange(string id, int acceptFrames)
        {
            var now = Play(id, "commit", 0.05, acceptFrames, legacy: false);
            UnityEngine.Object.DestroyImmediate(root);
            root = null;
            var before = Play(id, "commit", 0.05, acceptFrames, legacy: true);
            Assert.That(now.Frames.Count, Is.EqualTo(before.Frames.Count));
            Assert.That(now.AcceptIndex, Is.EqualTo(before.AcceptIndex));
            for (var index = 0; index < now.Frames.Count; index++)
            {
                var a = now.Frames[index];
                var b = before.Frames[index];
                Assert.That(a.Drawn, Is.EqualTo(b.Drawn), "frame " + index);
                Assert.That(a.Rings, Is.EqualTo(b.Rings), "frame " + index);
                Assert.That(a.Inset, Is.EqualTo(b.Inset), "frame " + index);
                Assert.That(BitConverter.SingleToInt32Bits(a.Position.x), Is.EqualTo(BitConverter.SingleToInt32Bits(b.Position.x)), "x, frame " + index);
                Assert.That(BitConverter.SingleToInt32Bits(a.Position.y), Is.EqualTo(BitConverter.SingleToInt32Bits(b.Position.y)), "y, frame " + index);
                Assert.That(BitConverter.SingleToInt32Bits(a.Position.z), Is.EqualTo(BitConverter.SingleToInt32Bits(b.Position.z)), "z, frame " + index);
            }
        }

        [TestCase("none")]
        [TestCase("cancel")]
        public void NoSwing_BallIsDrawnToTheEndOfTheFlightDataThenHeldBackUntilTheResult(string mode)
        {
            var run = Play("grounded-attack", mode, 0.0, 6, legacy: false);
            var flightEnd = run.Delivery.Flight[run.Delivery.Flight.Length - 1].t;
            var held = 0;
            for (var index = 0; index < run.AcceptIndex; index++)
            {
                var frame = run.Frames[index];
                if (frame.T <= flightEnd + 1e-9)
                {
                    Assert.That(frame.Drawn, Is.True, "drawn while the flight data lasts, at " + frame.T);
                    Assert.That(Vector3.Distance(frame.Position, BallAt(run.Delivery.Flight, frame.T)), Is.LessThan(1e-4f));
                }
                else
                {
                    held++;
                    Assert.That(frame.Drawn || frame.Rings || frame.Inset, Is.False,
                        "no ball hangs frozen at the last flight sample once the flight data is used up, at " + frame.T);
                }
            }
            Assert.That(held, Is.GreaterThanOrEqualTo(5));
            var accept = run.Frames[run.AcceptIndex];
            Assert.That(accept.Drawn && accept.Rings && accept.Inset, Is.True);
            Assert.That(Vector3.Distance(accept.Position, BallAt(run.Result.Trace.ball, accept.T)), Is.LessThan(1e-3f));
        }

        [Test]
        public void LegacySeam_KeepsThePreContactLineThroughTheBatAndFreezesItAtTheFlightEnd()
        {
            var run = Play("grounded-attack", "commit", 0.05, 10, legacy: true);
            var flightEnd = run.Delivery.Flight[run.Delivery.Flight.Length - 1];
            var frozen = 0;
            for (var index = 0; index < run.AcceptIndex; index++)
            {
                Assert.That(run.Frames[index].Drawn, Is.True, "the pre-UNITY-7 drawing keeps a ball on screen while a result is pending");
                if (run.Frames[index].T > flightEnd.t + 1e-9)
                {
                    frozen++;
                    Assert.That(Vector3.Distance(run.Frames[index].Position,
                        new Vector3(-(float)flightEnd.p.x, (float)flightEnd.p.y, (float)flightEnd.p.z)), Is.LessThan(1e-4f));
                }
            }
            Assert.That(frozen, Is.GreaterThanOrEqualTo(1));
        }

        [Test]
        public void ExplicitFootwork_HoldsTheBallBackAtThatFootworksContactPlane()
        {
            // The ball reaches the forward plane (z = 8.26) before the back plane (z = 9.01): a swing committed to forward footwork is
            // held back from the ball's arrival there, the physics' own reference for that footwork (bat.ts idealTimeFor).
            var forward = Play("grounded-attack", "commit", 0.05, 10, legacy: false, footwork: "forward");
            UnityEngine.Object.DestroyImmediate(root);
            root = null;
            var back = Play("grounded-attack", "commit", 0.05, 10, legacy: false, footwork: "back");
            var delivery = forward.Delivery;
            var forwardAt = ProductionBatterBodyModel.IdealTimeFor(delivery.Flight, delivery.IdealContactT, "forward");
            var backAt = ProductionBatterBodyModel.IdealTimeFor(delivery.Flight, delivery.IdealContactT, "back");
            Assert.That(forwardAt, Is.LessThan(backAt - 0.005), "the forward plane is reached earlier");
            Func<Run, double> firstHeld = run => run.Frames.Take(run.AcceptIndex).First(frame => !frame.Drawn).T;
            Assert.That(firstHeld(forward), Is.GreaterThan(forwardAt));
            Assert.That(firstHeld(forward), Is.LessThanOrEqualTo(forwardAt + Step + 1e-9));
            Assert.That(firstHeld(back), Is.GreaterThan(backAt));
            Assert.That(firstHeld(back), Is.LessThanOrEqualTo(backAt + Step + 1e-9));
            Assert.That(firstHeld(forward), Is.LessThan(firstHeld(back)));
        }

        [TestCase("grounded-attack", 3)]
        [TestCase("grounded-attack", 14)]
        [TestCase("thin-edge", 3)]
        [TestCase("thin-edge", 10)]
        [TestCase("deliberate-loft", 3)]
        public void HoldingTheBallBack_DoesNotChangeWhichCuesFireOrWhen(string id, int acceptFrames)
        {
            // Ninety frames past the accept: the ball's bounces and the fielder's take are cues after the contact.
            var now = Play(id, "commit", 0.05, acceptFrames, legacy: false, framesAfterAccept: 90);
            UnityEngine.Object.DestroyImmediate(root);
            root = null;
            var before = Play(id, "commit", 0.05, acceptFrames, legacy: true, framesAfterAccept: 90);
            Assert.That(now.Sink.Events, Is.EqualTo(before.Sink.Events),
                "the audio and haptic cues (kind, simulation time and the frame they are heard in) are those of the drawing before the change");
            Assert.That(now.Sink.Events.Count, Is.GreaterThan(0), "the cues of the delivery were heard");
        }

        [Test]
        public void DeliveryEffects_HideBallEmphasisTurnsTheRingsAndFocusOffUntilTheNextBallPose()
        {
            var host = new GameObject("pending ball effects host");
            try
            {
                var effects = ProductionDeliveryEffects.Create(host.transform, PracticePresentationQuality.Standard, false);
                var flight = new[]
                {
                    new BallTraceSample { t = 0, p = new TraceVector3 { x = 0, y = 2, z = -8 }, v = new TraceVector3 { x = 0, y = 0, z = 30 } },
                    new BallTraceSample { t = 1, p = new TraceVector3 { x = 0, y = 0.4, z = 9 }, v = new TraceVector3 { x = 0, y = 0, z = 20 } }
                };
                effects.BeginDelivery(flight, new ProductionDeliveryEffectsPolicy(true, false, true));
                Action pose = () => effects.SetBallPose(new Vector3(0f, 1f, 2f), new Vector3(0f, 1.6f, 9f), Quaternion.LookRotation(Vector3.back), 40f, 540);
                pose();
                effects.MarkReleased();
                pose();
                Assert.That(effects.ReadabilityVisible && effects.FocusVisible && effects.GuidanceVisible, Is.True);
                effects.HideBallEmphasis();
                Assert.That(effects.ReadabilityVisible, Is.False);
                Assert.That(effects.FocusVisible, Is.False);
                Assert.That(effects.GuidanceVisible, Is.True, "the guidance is not the ball");
                pose();
                Assert.That(effects.ReadabilityVisible && effects.FocusVisible, Is.True, "the next ball pose shows them again");
                effects.Dispose();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(host);
            }
        }
    }
}
