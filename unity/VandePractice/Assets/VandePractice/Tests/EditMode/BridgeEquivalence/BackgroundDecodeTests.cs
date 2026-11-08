using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using NUnit.Framework;
using Vande.Practice.Bridge;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// The background decode of large packets (BackgroundPacketDecoder.cs): the same decisions as the synchronous path, in packet
    /// arrival order, with teardown discarding what is pending and every failure failing the session closed.
    /// The large packets are the golden result and replay packets (280,000 to 456,000 characters).
    /// </summary>
    public sealed class BackgroundDecodeTests
    {
        private const string Case = "grounded-attack";

        /// <summary>Holds the decode work until a test lets it run, so a test controls exactly when a decode finishes.</summary>
        private sealed class ManualScheduler : IDecodeScheduler
        {
            public readonly Queue<Action> Queued = new Queue<Action>();
            public void Schedule(Action work) { Queued.Enqueue(work); }
            public void RunNext() { Queued.Dequeue()(); }
            public void RunAll() { while (Queued.Count > 0) Queued.Dequeue()(); }
        }

        private sealed class Harness
        {
            public readonly List<string> Emitted = new List<string>();
            public readonly List<string> Accepted = new List<string>();
            public readonly List<string> Diagnostics = new List<string>();
            public readonly UnityPracticeBridgeSession Session;
            public Action<UnityPracticeEnvelope> OnAccepted;

            public Harness()
            {
                Session = new UnityPracticeBridgeSession(
                    packet => Emitted.Add(packet), packet => Emitted.Add(packet), () => 1000.0, "6000.3.27f1",
                    envelope =>
                    {
                        Accepted.Add(envelope.type + "@" + envelope.sequence);
                        if (OnAccepted != null) OnAccepted(envelope);
                    },
                    diagnostic => Diagnostics.Add(diagnostic));
            }

            public void Send(IList<string> steps, int from, int to)
            {
                for (var index = from; index < to; index++) Step(steps[index]);
            }

            public void Step(string step)
            {
                if (step.StartsWith("!dead|", StringComparison.Ordinal))
                {
                    var parts = step.Split('|');
                    double deadT;
                    Assert.That(CanonicalJson.TryParseNumberExact(parts[1], out deadT), Is.True);
                    Session.ReportDeliveryDead(deadT, parts[2]);
                }
                else Session.ReceivePacket(step);
            }
        }

        private static List<string> Flow()
        {
            return BridgeEquivalenceScenarios.StandardFlow(BridgeEquivalenceTests.LoadBases(), Case);
        }

        private const int ResultStep = BridgeEquivalenceScenarios.StandardResultStep;

        [Test]
        public void ALargeResult_IsDecodedInTheBackground_AndAppliedInOrderBehindNothingElse()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
            var acceptedBefore = h.Accepted.Count;
            var emittedBefore = h.Emitted.Count;

            h.Step(flow[ResultStep]);

            Assert.That(h.Session.PendingPackets, Is.EqualTo(1), "the result is queued, not applied");
            Assert.That(scheduler.Queued.Count, Is.EqualTo(1), "its decode was handed to the scheduler");
            Assert.That(h.Accepted.Count, Is.EqualTo(acceptedBefore), "no effect before the decode is done");
            Assert.That(h.Emitted.Count, Is.EqualTo(emittedBefore), "no acknowledgement before the decode is done");
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));

            h.Session.Pump();
            Assert.That(h.Session.PendingPackets, Is.EqualTo(1), "Pump does not run past an unfinished head");

            scheduler.RunAll();
            h.Session.Pump();
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
            Assert.That(h.Accepted.Last(), Does.StartWith("host.result@"));
            Assert.That(h.Emitted.Count, Is.EqualTo(emittedBefore + 1), "one acknowledgement, after the apply");
        }

        [Test]
        public void SmallPacketsBehindAPendingLargeOne_WaitForItAndKeepTheirOrder()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            // A harmless small message (a locale update) right behind the result: it must not overtake it.
            h.Step(WireKit.Seal(WireKit.Body("host.locale", 11, null, "{\"locale\":\"en-IN\"}", "host", "unity-golden-v3", "equivalence-session")));

            Assert.That(h.Session.PendingPackets, Is.EqualTo(2));
            Assert.That(h.Accepted.Any(a => a.StartsWith("host.locale", StringComparison.Ordinal)), Is.False);

            scheduler.RunAll();
            h.Session.Pump();

            var types = h.Accepted.Select(a => a.Split('@')[0]).ToList();
            Assert.That(types.IndexOf("host.result"), Is.GreaterThanOrEqualTo(0));
            Assert.That(types.IndexOf("host.locale"), Is.GreaterThan(types.IndexOf("host.result")), "arrival order: result, then locale");
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
        }

        [Test]
        public void ADuplicate_IsAcknowledgedAgainAndNotAcceptedTwice()
        {
            var flow = Flow();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(new ImmediateScheduler());
            h.Send(flow, 0, ResultStep + 1);
            var accepted = h.Accepted.Count;
            var emitted = h.Emitted.Count;

            h.Step(flow[ResultStep]); // the very same packet again

            Assert.That(h.Accepted.Count, Is.EqualTo(accepted), "a duplicate is not accepted again");
            Assert.That(h.Emitted.Count, Is.EqualTo(emitted + 1), "but it is acknowledged again");
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
        }

        [Test]
        public void AnOutOfOrderLargePacket_FailsTheSessionClosed_LikeTheSynchronousPath()
        {
            var flow = Flow();
            var sync = new Harness();
            var background = new Harness();
            background.Session.EnableBackgroundDecode(new ImmediateScheduler());
            // The replay packet (sequence 12) before the dead-ball steps' sequence numbers: send the result, then the replay with a regressed sequence.
            var regressed = WireKit.Seal(RegressedSequence(flow[ResultStep + 3], 3));
            foreach (var harness in new[] { sync, background })
            {
                harness.Send(flow, 0, ResultStep + 1);
                harness.Step(regressed);
            }

            Assert.That(background.Session.State, Is.EqualTo(sync.Session.State));
            Assert.That(background.Session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(background.Diagnostics, Is.EqualTo(sync.Diagnostics));
            Assert.That(background.Diagnostics.Last(), Does.StartWith("bridge_out_of_order|"));
            Assert.That(background.Emitted.Count, Is.EqualTo(sync.Emitted.Count));
        }

        private static string RegressedSequence(string sealedPacket, long sequence)
        {
            var bodyStart = sealedPacket.IndexOf("\"body\":\"", StringComparison.Ordinal) + 8;
            var body = sealedPacket.Substring(bodyStart, sealedPacket.Length - bodyStart - 2).Replace("\\\"", "\"").Replace("\\\\", "\\");
            return WireKit.SetValue(body, sequence.ToString(), "sequence");
        }

        [Test]
        public void Teardown_DiscardsWhatIsPending_WithoutAnyEffect()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            Assert.That(h.Session.PendingPackets, Is.EqualTo(1));
            var accepted = h.Accepted.Count;
            var emitted = h.Emitted.Count;

            Assert.Throws<BridgeValidationException>(() => h.Session.PrepareForUnload(null),
                "the unload guard is unchanged: the host never asked for it");
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0), "the pending result was dropped");
            scheduler.RunAll(); // a decode that finishes after the teardown is ignored
            h.Session.Pump();

            Assert.That(h.Accepted.Count, Is.EqualTo(accepted));
            Assert.That(h.Emitted.Count, Is.EqualTo(emitted));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
        }

        [Test]
        public void CancelPending_And_Dispose_DropTheQueue()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            h.Session.CancelPending();
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            h.Step(flow[ResultStep]);
            Assert.That(h.Session.PendingPackets, Is.EqualTo(1));
            h.Session.Dispose();
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(h.Session.BackgroundDecodeActive, Is.False, "after Dispose the session is synchronous again");
        }

        [Test]
        public void ACorruptLargePacket_FailsClosedAfterTheDecode_WithTheSynchronousPathsDiagnostics()
        {
            var flow = Flow();
            var corrupt = flow[ResultStep].Replace("\"sha256\":\"", "\"sha256\":\"0");
            var sync = new Harness();
            sync.Send(flow, 0, ResultStep);
            sync.Step(corrupt);
            var scheduler = new ManualScheduler();
            var background = new Harness();
            background.Session.EnableBackgroundDecode(scheduler);
            background.Send(flow, 0, ResultStep);
            background.Step(corrupt);
            Assert.That(background.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery), "nothing is decided before the decode ends");
            scheduler.RunAll();
            background.Session.Pump();

            Assert.That(background.Session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(background.Session.State, Is.EqualTo(sync.Session.State));
            Assert.That(background.Diagnostics, Is.EqualTo(sync.Diagnostics));
            Assert.That(background.Emitted.Count, Is.EqualTo(sync.Emitted.Count));
            Assert.That(background.Accepted, Is.EqualTo(sync.Accepted));
        }

        [Test]
        public void AnUnexpectedExceptionOnTheWorker_IsReportedAsARuntimeFailure_AndFailsClosed()
        {
            var flow = Flow();
            var h = new Harness();
            var scheduler = new ManualScheduler();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            // The worker's decode blew up with something that is not a validation error.
            var job = scheduler.Queued.Dequeue();
            Assert.That(job, Is.Not.Null);
            h.Session.ForceDecodeFailureForTests(new InvalidOperationException("worker fault"));
            job();
            h.Session.Pump();

            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(h.Diagnostics.Last(), Does.StartWith("bridge_runtime|InvalidOperationException|worker fault"));
            Assert.That(UnityPracticePacketCodec.Decode(h.Emitted.Last()).Envelope.payloadJson, Does.Contain("\"code\":\"unity_runtime\""));
            Assert.That(h.Accepted.Any(a => a.StartsWith("host.result", StringComparison.Ordinal)), Is.False);
        }

        [Test]
        public void ABarrierCall_AppliesThePendingPacketsFirst()
        {
            var flow = Flow();
            var h = new Harness();
            Assert.That(h.Session.EnableBackgroundDecode(), Is.True, "the real worker thread starts on this platform");
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            // Straight away, without waiting for the worker: Unity reports the delivery complete. The call is a barrier: it
            // waits for the decode, applies the result, and only then evaluates against the Resolved state.
            h.Step(flow[ResultStep + 1]);

            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
            Assert.That(h.Accepted.Any(a => a.StartsWith("host.result", StringComparison.Ordinal)), Is.True);
            h.Session.Dispose();
        }

        [Test]
        public void TheRealWorkerThread_AppliesLargePackets_ThroughPumpAlone_InOrder()
        {
            var flow = Flow();
            var h = new Harness();
            Assert.That(h.Session.EnableBackgroundDecode(), Is.True);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            h.Step(WireKit.Seal(WireKit.Body("host.locale", 11, null, "{\"locale\":\"en-IN\"}", "host", "unity-golden-v3", "equivalence-session")));
            var watch = Stopwatch.StartNew();
            while (h.Session.PendingPackets > 0 && watch.Elapsed.TotalSeconds < 20) h.Session.Pump();

            Assert.That(h.Session.PendingPackets, Is.EqualTo(0), "the worker finished within 20 s");
            var types = h.Accepted.Select(a => a.Split('@')[0]).ToList();
            Assert.That(types.IndexOf("host.locale"), Is.GreaterThan(types.IndexOf("host.result")));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
            h.Session.Dispose();
        }

        [Test]
        public void ReentrantPumpAndFlush_FromTheAcceptedCallback_AreNoOps()
        {
            var flow = Flow();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(new ImmediateScheduler());
            var depth = 0;
            var maxDepth = 0;
            h.OnAccepted = envelope =>
            {
                if (envelope.type != "host.result") return;
                depth++;
                maxDepth = Math.Max(maxDepth, depth);
                h.Session.Pump();
                h.Session.Flush();
                depth--;
            };
            h.Send(flow, 0, ResultStep + 1);
            Assert.That(maxDepth, Is.EqualTo(1));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
        }

        private sealed class RefusingScheduler : IDecodeScheduler
        {
            public int Attempts;
            public void Schedule(Action work) { Attempts++; throw new InvalidOperationException("no thread"); }
        }

        [Test]
        public void AWorkerThatCannotRun_FallsBackToInlineDecoding_InOrder_AndTheSessionGoesSynchronous()
        {
            var flow = Flow();
            var scheduler = new RefusingScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);

            Assert.That(scheduler.Attempts, Is.EqualTo(1));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved), "decoded inline when the worker refused it");
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(h.Session.BackgroundDecodeActive, Is.False, "and the session stays synchronous afterwards");
            h.Step(flow[ResultStep + 1]);
            Assert.That(scheduler.Attempts, Is.EqualTo(1), "no further attempts");
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.SceneReady));
        }

        [Test]
        public void ADecodeThatNeverFinishes_IsAbandonedByABarrier_AndFailsTheSessionClosed()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler(); // never run: a stuck worker
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Step(flow[ResultStep]);
            var previous = UnityPracticeBridgeSession.FlushTimeoutMilliseconds;
            UnityPracticeBridgeSession.FlushTimeoutMilliseconds = 50;
            try
            {
                // The barrier (Unity's delivery-dead report) waits 50 ms, gives up on the stuck decode, and the abandoned result
                // fails the session closed. The report itself is then refused exactly as any report on a session that has no
                // resolved delivery is refused (the old synchronous code throws the same exception in that state).
                var refused = Assert.Throws<BridgeValidationException>(() => h.Step(flow[ResultStep + 1]));
                Assert.That(refused.Message, Is.EqualTo("A resolved delivery or replay is not active."));
            }
            finally
            {
                UnityPracticeBridgeSession.FlushTimeoutMilliseconds = previous;
            }

            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Failed));
            Assert.That(h.Diagnostics.Any(d => d.StartsWith("bridge_validation|BridgeValidationException|Background packet decode did not finish.", StringComparison.Ordinal)), Is.True);
            scheduler.RunAll(); // the stuck worker wakes up later: nothing changes
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
        }

        [Test]
        public void TheKillSwitch_WorksBothWays()
        {
            try
            {
                BackgroundDecodeSupport.SwitchOverrideForTests = false;
                var off = new Harness();
                Assert.That(off.Session.EnableBackgroundDecode(), Is.False, "switched off: the session stays synchronous");
                Assert.That(off.Session.BackgroundDecodeActive, Is.False);
                var flow = Flow();
                off.Send(flow, 0, ResultStep + 1);
                Assert.That(off.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved), "applied before ReceivePacket returned");

                BackgroundDecodeSupport.SwitchOverrideForTests = true;
                var on = new Harness();
                Assert.That(on.Session.EnableBackgroundDecode(), Is.True, "switched on: a worker thread starts");
                Assert.That(on.Session.BackgroundDecodeActive, Is.True);
                on.Send(flow, 0, ResultStep);
                on.Step(flow[ResultStep]);
                on.Session.Flush();
                Assert.That(on.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));
                on.Session.Dispose();
            }
            finally
            {
                BackgroundDecodeSupport.SwitchOverrideForTests = null;
            }
        }

        [Test]
        public void TheKillSwitch_KeepsEverythingSynchronous_WhenOff()
        {
            // The shipped value is on; the session reports whether the worker is available.
            Assert.That(BridgeConstants.BackgroundDecodeEnabled, Is.True, "background decode ships enabled");
            var off = new Harness();
            Assert.That(off.Session.BackgroundDecodeActive, Is.False, "a session that was never asked is synchronous");
            var flow = Flow();
            off.Send(flow, 0, ResultStep + 1);
            Assert.That(off.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(off.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved), "applied before ReceivePacket returned");

            var on = new Harness();
            on.Session.EnableBackgroundDecode(new ManualScheduler());
            Assert.That(on.Session.BackgroundDecodeActive, Is.True);
            Assert.That(BackgroundDecodeSupport.Available, Is.EqualTo(BridgeConstants.BackgroundDecodeEnabled));
        }

        [Test]
        public void PacketsBelowTheThreshold_AreDecodedInlineWhenNothingIsQueued()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            Assert.That(scheduler.Queued.Count, Is.EqualTo(0), "scene, delivery and control messages never reach the worker");
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(flow[ResultStep].Length, Is.GreaterThanOrEqualTo(BridgeConstants.BackgroundDecodeMinimumCharacters));
        }
    }
}
