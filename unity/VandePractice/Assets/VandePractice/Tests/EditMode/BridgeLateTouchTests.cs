using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Vande.Practice.Bridge;
using Vande.Practice.Input;
using Vande.Practice.Tests.Equivalence;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// A touch that is polled between Unity receiving the host.result (a large packet, decoded on a worker) and applying it.
    /// ReportPointer and ReportGesture flush the pending packets first; when that applies the result the delivery has ended, so
    /// the touch is late input and is ignored. It used to throw "A clock-synchronized delivery is not active.", which failed
    /// the runtime (unity.error unity_runtime, not recoverable) and unloaded Unity (ANDROID-FIX-1, mechanism B).
    /// A touch while nothing is pending, and a touch long after the result was applied, behave as they always did.
    /// </summary>
    public sealed class BridgeLateTouchTests
    {
        private const string Case = "grounded-attack";
        private const int ResultStep = BridgeEquivalenceScenarios.StandardResultStep;

        /// <summary>Holds the decode work until a test lets it run, so a test controls exactly when a decode finishes.</summary>
        private sealed class ManualScheduler : IDecodeScheduler
        {
            public readonly Queue<Action> Queued = new Queue<Action>();
            public void Schedule(Action work) { Queued.Enqueue(work); }
            public void RunAll() { while (Queued.Count > 0) Queued.Dequeue()(); }
        }

        private sealed class Harness
        {
            public readonly List<string> Emitted = new List<string>();
            public readonly List<string> Accepted = new List<string>();
            public readonly List<string> Diagnostics = new List<string>();
            public readonly UnityPracticeBridgeSession Session;

            public Harness()
            {
                Session = new UnityPracticeBridgeSession(
                    packet => Emitted.Add(packet), packet => Emitted.Add(packet), () => 1000.0, "6000.3.27f1",
                    envelope => Accepted.Add(envelope.type + "@" + envelope.sequence),
                    diagnostic => Diagnostics.Add(diagnostic));
            }

            public void Send(IList<string> steps, int from, int to)
            {
                for (var index = from; index < to; index++) Session.ReceivePacket(steps[index]);
            }
        }

        private static List<string> Flow()
        {
            return BridgeEquivalenceScenarios.StandardFlow(BridgeEquivalenceTests.LoadBases(), Case);
        }

        private static List<string> TypesSince(Harness h, int from)
        {
            var types = new List<string>();
            for (var index = from; index < h.Emitted.Count; index++)
                types.Add(UnityPracticePacketCodec.Decode(h.Emitted[index]).Envelope.type);
            return types;
        }

        /// <summary>One touch as the capture reports it: the exact canonical text of a short raw gesture.</summary>
        private static string Gesture()
        {
            var buffer = new PracticeRawGestureBuffer();
            buffer.Begin("touch", new PracticePointerSample(2010.0, 100.0, 500.0), 400.0, 800.0);
            Assert.That(buffer.Add(new PracticePointerSample(2020.0, 101.0, 501.0)), Is.True);
            return buffer.FinishCurrent("auto");
        }

        /// <summary>The delivery is live; the result has arrived (large, so it is queued for the worker) but is not applied.</summary>
        private static Harness ResultPending(List<string> flow, ManualScheduler scheduler)
        {
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Session.ReceivePacket(flow[ResultStep]);
            Assert.That(h.Session.PendingPackets, Is.EqualTo(1), "the result is queued, not applied");
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
            return h;
        }

        private static void AssertResultWasAppliedAndNothingElseEmitted(Harness h, int emittedBefore)
        {
            Assert.That(h.Session.PendingPackets, Is.EqualTo(0));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved), "the flush applied the result");
            Assert.That(h.Accepted.Last(), Does.StartWith("host.result@"));
            Assert.That(TypesSince(h, emittedBefore), Is.EqualTo(new[] { "bridge.ack" }),
                "the acknowledgement of the result only: no unity.pointer, no unity.gesture, no unity.error");
            Assert.That(h.Diagnostics, Is.Empty);
        }

        [Test]
        public void ATouchBeforeTheResultArrives_IsReported_AsItAlwaysWas()
        {
            var h = new Harness();
            h.Session.EnableBackgroundDecode(new ManualScheduler());
            h.Send(Flow(), 0, ResultStep);
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
            var emittedBefore = h.Emitted.Count;

            h.Session.ReportPointer("down", "touch");
            h.Session.ReportGesture(Gesture());

            Assert.That(TypesSince(h, emittedBefore), Is.EqualTo(new[] { "unity.pointer", "unity.gesture" }));
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Delivery));
            Assert.That(h.Diagnostics, Is.Empty);
        }

        [Test]
        public void APointerPolledWhileTheResultIsPending_IsLateInput_NotAFailure()
        {
            var scheduler = new ManualScheduler();
            var h = ResultPending(Flow(), scheduler);
            scheduler.RunAll();
            var emittedBefore = h.Emitted.Count;

            Assert.DoesNotThrow(() => h.Session.ReportPointer("down", "touch"));

            AssertResultWasAppliedAndNothingElseEmitted(h, emittedBefore);
        }

        [Test]
        public void AGesturePolledWhileTheResultIsPending_IsLateInput_NotAFailure()
        {
            var scheduler = new ManualScheduler();
            var h = ResultPending(Flow(), scheduler);
            scheduler.RunAll();
            var emittedBefore = h.Emitted.Count;

            Assert.DoesNotThrow(() => h.Session.ReportGesture(Gesture()));

            AssertResultWasAppliedAndNothingElseEmitted(h, emittedBefore);
        }

        [Test]
        public void ATouchThatWentDownBeforeTheResultArrived_ButLiftsAfter_IsReportedThenIgnored()
        {
            var flow = Flow();
            var scheduler = new ManualScheduler();
            var h = new Harness();
            h.Session.EnableBackgroundDecode(scheduler);
            h.Send(flow, 0, ResultStep);
            h.Session.ReportPointer("down", "touch");
            var afterPointer = h.Emitted.Count;
            Assert.That(TypesSince(h, afterPointer - 1), Is.EqualTo(new[] { "unity.pointer" }));
            h.Session.ReceivePacket(flow[ResultStep]);
            scheduler.RunAll();

            Assert.DoesNotThrow(() => h.Session.ReportGesture(Gesture()));

            AssertResultWasAppliedAndNothingElseEmitted(h, afterPointer);
        }

        [Test]
        public void ATouchWhileTheWorkerThreadStillDecodesTheResult_WaitsForItAndIsIgnored()
        {
            var flow = Flow();
            var h = new Harness();
            Assume.That(h.Session.EnableBackgroundDecode(), Is.True, "this platform has no worker thread");
            h.Send(flow, 0, ResultStep);
            h.Session.ReceivePacket(flow[ResultStep]);
            Assert.That(h.Session.PendingPackets, Is.EqualTo(1));
            var emittedBefore = h.Emitted.Count;

            Assert.DoesNotThrow(() => h.Session.ReportPointer("down", "touch"));

            AssertResultWasAppliedAndNothingElseEmitted(h, emittedBefore);
            h.Session.Dispose();
        }

        [Test]
        public void ATouchAfterTheResultWasApplied_IsStillRejected_AsBefore()
        {
            var scheduler = new ManualScheduler();
            var h = ResultPending(Flow(), scheduler);
            scheduler.RunAll();
            h.Session.Pump();
            Assert.That(h.Session.State, Is.EqualTo(BridgeLifecycleState.Resolved));

            var thrown = Assert.Throws<BridgeValidationException>(() => h.Session.ReportPointer("down", "touch"));
            StringAssert.Contains("not active", thrown.Message);
        }
    }
}
