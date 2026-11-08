using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Audio;
using Vande.Practice.Input;
using Vande.Practice.Performance;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class PracticeBenchmarkAndInputTests
    {
        private GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) UnityEngine.Object.DestroyImmediate(root);
        }

        [Test]
        public void BenchmarkSampler_ExcludesWarmupAndStopsAtBoundedSampleCap()
        {
            var sampler = new PracticeBenchmarkSampler(10_000, 2, 3);
            sampler.Advance(16);
            sampler.Advance(17);
            sampler.Advance(18);
            sampler.Advance(19);
            sampler.Advance(20);

            Assert.That(sampler.Complete, Is.True);
            Assert.That(sampler.WarmupFrames, Is.EqualTo(2));
            Assert.That(sampler.WarmupDurationMs, Is.EqualTo(33));
            Assert.That(sampler.Snapshot(), Is.EqualTo(new[] { 18d, 19d, 20d }));
        }

        [Test]
        public void BenchmarkSampler_RejectsUnboundedOrNonFiniteRequestsAndFrames()
        {
            Assert.Throws<BridgeValidationException>(() =>
                new PracticeBenchmarkSampler(10_001, 0, 2));
            Assert.Throws<BridgeValidationException>(() =>
                new PracticeBenchmarkSampler(1_000, 301, 2));
            Assert.Throws<BridgeValidationException>(() =>
                new PracticeBenchmarkSampler(1_000, 0, 1_201));
            var sampler = new PracticeBenchmarkSampler(1_000, 0, 2);
            Assert.Throws<BridgeValidationException>(() => sampler.Advance(double.NaN));
            Assert.Throws<BridgeValidationException>(() => sampler.Advance(10_001));
        }

        [Test]
        public void DeliveryFrameStats_CountsOnlyStrictlyOverFiftyMillisecondSpikesAndResets()
        {
            var stats = new PracticeFrameStats(4);
            stats.AddSeconds(0.016);
            stats.AddSeconds(0.050);
            stats.AddSeconds(0.051);
            var snapshot = stats.Snapshot();

            Assert.That(snapshot.SampleCount, Is.EqualTo(3));
            Assert.That(snapshot.Spikes, Is.EqualTo(1));
            Assert.That(snapshot.WorstFrameMs, Is.EqualTo(51).Within(0.001));

            stats.Reset();
            Assert.That(stats.Snapshot().SampleCount, Is.Zero);
            Assert.That(stats.Snapshot().Spikes, Is.Zero);
        }

        [Test]
        public void BattingRegion_IsOnlyTheLowerFortySixPercent()
        {
            Assert.That(PracticeBattingInputRegion.Contains(200, 431, 400, 800), Is.False);
            Assert.That(PracticeBattingInputRegion.Contains(200, 432, 400, 800), Is.True);
            Assert.That(PracticeBattingInputRegion.Contains(401, 700, 400, 800), Is.False);
        }

        [Test]
        public void KeyboardCapture_ArrowWaitsForChordThenEmitsCanonicalAttackOnce()
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            var preparations = 0;
            root = new GameObject("VandeTouchInputCapture-KeyboardArrowTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => preparations++,
                () => { },
                _ => Assert.Fail("Input capture failed."));

            capture.BeginDelivery();
            capture.CaptureKey("ArrowUp", 50, false, false, 400, 800);
            Assert.That(gestures, Is.Empty, "keyboard input must stay disarmed before release");
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureKey("ArrowUp", 100, false, false, 400, 800);

            Assert.That(preparations, Is.EqualTo(1));
            Assert.That(pointers, Is.EqualTo(new[] { "down:keyboard" }));
            Assert.That(capture.InputArmed, Is.False, "the pending chord owns the one shot");
            capture.AdvanceKeyboard(139.999);
            Assert.That(gestures, Is.Empty);
            capture.AdvanceKeyboard(140);

            Assert.That(gestures, Has.Count.EqualTo(1));
            Assert.That(gestures[0], Is.EqualTo(
                "{\"footwork\":\"auto\",\"key\":{\"kind\":\"attack\",\"loft\":false," +
                "\"screenBearingDeg\":0},\"pointer\":\"keyboard\",\"samples\":[{\"t\":100," +
                "\"x\":200,\"y\":184}],\"surface\":{\"height\":368,\"width\":400}}"));
            capture.CaptureKey("ArrowRight", 150, false, false, 400, 800);
            Assert.That(gestures, Has.Count.EqualTo(1), "a second shot in the delivery must be ignored");
        }

        [Test]
        public void KeyboardCapture_SpaceDefendsImmediatelyAndRepeatDoesNotSpendTheShot()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-KeyboardDefendTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureKey("Space", 190, true, false, 400, 800);
            Assert.That(gestures, Is.Empty);
            Assert.That(capture.InputArmed, Is.True);
            capture.CaptureKey("Space", 200, false, false, 400, 800);

            Assert.That(gestures, Has.Count.EqualTo(1));
            Assert.That(gestures[0], Is.EqualTo(
                "{\"footwork\":\"auto\",\"key\":{\"kind\":\"defend\",\"loft\":false," +
                "\"screenBearingDeg\":0},\"pointer\":\"keyboard\",\"samples\":[{\"t\":200," +
                "\"x\":200,\"y\":184}],\"surface\":{\"height\":368,\"width\":400}}"));
        }

        [Test]
        public void KeyboardCapture_ChordsLoftAndFootworkMatchTheDocumentedDesktopContract()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-KeyboardChordTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.ConfigureHandedness("right");
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureKey("KeyW", 10, false, false, 400, 800);
            capture.CaptureKey("KeyW", 300, false, false, 400, 800);
            capture.CaptureKey("ArrowUp", 400, false, false, 400, 800);
            capture.CaptureKey("ShiftLeft", 420, false, true, 400, 800);
            capture.CaptureKey("ArrowRight", 430, false, true, 400, 800);

            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.Contains("\"footwork\":\"down_track\"", gestures[0]);
            StringAssert.Contains("\"kind\":\"attack\",\"loft\":true,\"screenBearingDeg\":45", gestures[0]);
            StringAssert.Contains("\"samples\":[{\"t\":400", gestures[0],
                "the first arrow owns the shot timestamp");

            capture.EndDelivery();
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureKey("KeyD", 500, false, false, 400, 800);
            capture.CaptureDown("mouse", 1, 510, 100, 700, 400, 800);
            capture.CaptureUp(1, 550, 140, 660);
            Assert.That(gestures, Has.Count.EqualTo(2));
            StringAssert.Contains("\"footwork\":\"across\"", gestures[1],
                "right-handed off-side footwork must carry into pointer shots too");

            capture.ConfigureHandedness("left");
            capture.EndDelivery();
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureKey("KeyD", 600, false, false, 400, 800);
            capture.CaptureKey("Numpad9", 610, false, false, 400, 800);
            Assert.That(gestures, Has.Count.EqualTo(3));
            StringAssert.Contains("\"footwork\":\"auto\"", gestures[2],
                "the leg-side letter mirrors with handedness");
        }

        [Test]
        public void KeyboardCapture_PauseCancelsPendingChordAndLateDeadlineCannotEmitIt()
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-KeyboardPauseTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => { },
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureKey("ArrowUp", 100, false, false, 400, 800);

            capture.SetPaused(true);
            capture.AdvanceKeyboard(500);
            capture.CaptureKey("Space", 510, false, false, 400, 800);
            Assert.That(gestures, Is.Empty);
            Assert.That(pointers, Is.EqualTo(new[] { "down:keyboard", "cancel:keyboard" }));
            Assert.That(cancellations, Is.EqualTo(1));

            capture.SetPaused(false);
            capture.CaptureKey("ArrowUp", 600, false, false, 400, 800);
            capture.AdvanceKeyboard(640);
            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.Contains("\"samples\":[{\"t\":600", gestures[0]);
        }

        [Test]
        public void TouchCapture_ArmsAtReleaseAndLongRestIsNotAShot()
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            var preparations = 0;
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-Test");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, time) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => preparations++,
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."));

            capture.BeginDelivery();
            capture.CaptureDown("touch", 1, 100, 200, 700, 400, 800);
            Assert.That(preparations, Is.Zero, "pre-release touch must be ignored");

            capture.MarkReleaseReached(new[] { 1 }, false);
            capture.CaptureDown("touch", 1, 200, 200, 700, 400, 800);
            Assert.That(preparations, Is.Zero, "finger resting at release must stay ignored");

            capture.CaptureDown("touch", 2, 300, 200, 700, 400, 800);
            capture.CaptureUp(2, 551, 201, 701);
            Assert.That(gestures, Is.Empty, "an unmoved hold beyond 250 ms is waiting, not defence");
            Assert.That(cancellations, Is.EqualTo(1));
            Assert.That(pointers, Is.EqualTo(new[] { "down:touch", "cancel:touch" }));

            capture.CaptureDown("touch", 3, 600, 200, 700, 400, 800);
            capture.CaptureUp(3, 700, 201, 701);
            Assert.That(gestures.Count, Is.EqualTo(1), "a later quick tap remains available");
        }

        [TestCase("touch", 4)]
        [TestCase("mouse", -1)]
        public void PointerCapture_StationaryPollingCannotTurnALongHoldIntoDefence(
            string pointerKind,
            int pointerId)
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-StationaryHoldTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => { },
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown(pointerKind, pointerId, 100, 100, 700, 400, 800);
            capture.CaptureMove(pointerId, 360, 100, 700);
            capture.CaptureMove(pointerId, 620, 100, 700);
            capture.CaptureUp(pointerId, 700, 100, 700);

            Assert.That(gestures, Is.Empty,
                "stationary callbacks may rebase raw transport but cannot reset physical hold duration");
            Assert.That(cancellations, Is.EqualTo(1));
            Assert.That(pointers, Is.EqualTo(new[]
            {
                "down:" + pointerKind,
                "cancel:" + pointerKind
            }));
            Assert.That(capture.InputArmed, Is.True,
                "an intentional hold must leave the delivery available");

            capture.CaptureDown(pointerKind, pointerId, 800, 100, 700, 400, 800);
            capture.CaptureUp(pointerId, 850, 101, 699);
            Assert.That(gestures, Has.Count.EqualTo(1),
                "a fresh quick contact still owns the available defence");
        }

        [TestCase("touch", 5)]
        [TestCase("mouse", -1)]
        public void PointerCapture_LongStationaryHoldThenIntentionalStrokeEmitsExactlyOnce(
            string pointerKind,
            int pointerId)
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-HoldThenStrokeTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown(pointerKind, pointerId, 100, 100, 700, 400, 800);
            capture.CaptureMove(pointerId, 360, 100, 700);
            capture.CaptureMove(pointerId, 620, 100, 700);
            capture.CaptureMove(pointerId, 640, 100, 740);
            capture.CaptureMove(pointerId, 680, 100, 650);
            capture.CaptureUp(pointerId, 720, 100, 600);
            capture.CaptureUp(pointerId, 730, 100, 590);

            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.DoesNotContain("\"t\":100,", gestures[0],
                "the pre-intent wait must stay outside the bounded raw packet");
            StringAssert.Contains("\"t\":620", gestures[0]);
            StringAssert.Contains("\"t\":720", gestures[0]);
        }

        [Test]
        public void TouchCapture_ActiveLongHoldDenseSlowDriftStaysUncommittedAndRearms()
        {
            var gestures = new List<string>();
            var pointers = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-ActiveSlowDriftTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => { },
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 1, 100, 100, 620, 400, 800);

            // After the contact becomes a long hold, each 1.4 px / 20 ms
            // segment is below the canonical 0.08 px/ms onset speed. The
            // absolute drift exceeds the threshold only if the rest is stale.
            for (var index = 1; index <= 20; index++)
                capture.CaptureMove(1, 380 + index * 20, 100, 620 + index * 1.4);
            capture.CaptureUp(1, 800, 100, 648);

            Assert.That(gestures, Is.Empty);
            Assert.That(cancellations, Is.EqualTo(1));
            Assert.That(pointers, Is.EqualTo(new[] { "down:touch", "cancel:touch" }));
            Assert.That(capture.InputArmed, Is.True,
                "slow drift after a physical hold cannot consume the available shot");
        }

        [Test]
        public void TouchCapture_ActiveLongHoldFastRunAfterSlowDriftEmitsOnceFromLatestRest()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-ActiveDriftThenStrokeTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 1, 100, 100, 620, 400, 800);

            for (var index = 1; index <= 10; index++)
                capture.CaptureMove(1, 380 + index * 20, 100, 620 + index * 1.4);
            // Latest drifted rest: t=580, y=634. A qualifying pullback run
            // begins there, then reverses into the committed stroke.
            capture.CaptureMove(1, 590, 100, 638);
            capture.CaptureMove(1, 600, 100, 642);
            capture.CaptureMove(1, 610, 100, 646);
            capture.CaptureMove(1, 620, 100, 650);
            capture.CaptureMove(1, 640, 104, 610);
            capture.CaptureUp(1, 650, 108, 590);
            capture.CaptureUp(1, 660, 110, 580);

            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.DoesNotContain("\"t\":100", gestures[0],
                "the physical hold and drift stay outside the bounded raw packet");
            StringAssert.Contains("\"t\":580", gestures[0],
                "the qualifying run starts at the latest rebased rest");
            StringAssert.Contains("\"t\":620", gestures[0]);
            StringAssert.Contains("\"t\":640", gestures[0]);
            Assert.That(capture.InputArmed, Is.False);
        }

        [Test]
        public void TouchCapture_KeepsPullbackHoldAndForwardInOneRawTraceUntilLift()
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-OneContactTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown("touch", 1, 100, 100, 620, 400, 800);
            capture.CaptureMove(1, 120, 100, 700); // pull back
            capture.CaptureMove(1, 420, 100, 700); // hold past the old 140 ms cap
            Assert.That(gestures, Is.Empty);
            Assert.That(capture.InputArmed, Is.True);
            capture.CaptureMove(1, 450, 108, 665); // forward reversal
            capture.CaptureMove(1, 490, 125, 590); // stable forward evidence
            Assert.That(gestures, Is.Empty,
                "raw transport must not classify or complete a pointer that is still down");
            capture.CaptureUp(1, 510, 130, 575);

            Assert.That(gestures, Has.Count.EqualTo(1));
            Assert.That(capture.InputArmed, Is.False);
            Assert.That(pointers, Is.EqualTo(new[] { "down:touch" }));
            var packet = gestures[0];
            var press = packet.IndexOf("\"t\":100", StringComparison.Ordinal);
            var pullback = packet.IndexOf("\"t\":120", StringComparison.Ordinal);
            var hold = packet.IndexOf("\"t\":420", StringComparison.Ordinal);
            var reversal = packet.IndexOf("\"t\":450", StringComparison.Ordinal);
            var forward = packet.IndexOf("\"t\":490", StringComparison.Ordinal);
            var lift = packet.IndexOf("\"t\":510", StringComparison.Ordinal);
            Assert.That(press, Is.GreaterThanOrEqualTo(0));
            Assert.That(pullback, Is.GreaterThan(press));
            Assert.That(hold, Is.GreaterThan(pullback));
            Assert.That(reversal, Is.GreaterThan(hold));
            Assert.That(forward, Is.GreaterThan(reversal));
            Assert.That(lift, Is.GreaterThan(forward),
                "the packet must retain the complete monotonic event-time path");

            capture.CaptureUp(1, 520, 135, 570);
            Assert.That(gestures, Has.Count.EqualTo(1),
                "one continuous contact may emit at most one raw packet");
        }

        [Test]
        public void TouchCapture_CancelDuringLoadedHoldEmitsNoGestureAndRearms()
        {
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-OneContactCancelTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { },
                () => cancellations++, _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown("touch", 1, 100, 100, 620, 400, 800);
            capture.CaptureMove(1, 125, 100, 700);
            capture.CaptureMove(1, 425, 100, 700);
            capture.CaptureCancel(430);

            Assert.That(gestures, Is.Empty,
                "transport cancellation must never fabricate a shot packet");
            Assert.That(cancellations, Is.EqualTo(1));
            Assert.That(capture.InputArmed, Is.True,
                "a pre-lift cancellation leaves the delivery available");
        }

        [Test]
        public void TouchCapture_CancelBeforeForwardThresholdStillAbortsAndRearms()
        {
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-PreCommitCancelBoundaryTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { },
                () => cancellations++, _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown("touch", 1, 100, 100, 620, 400, 800);
            capture.CaptureMove(1, 125, 100, 700); // dominant pullback
            capture.CaptureMove(1, 150, 100, 692); // reversal remains below threshold
            capture.CaptureCancel(155);

            Assert.That(gestures, Is.Empty);
            Assert.That(cancellations, Is.EqualTo(1));
            Assert.That(capture.InputArmed, Is.True,
                "sub-threshold reversal is not an irreversible shot");
        }

        [TestCase("touch", 2)]
        [TestCase("mouse", -1)]
        public void PointerCapture_CancelAfterForwardCommitPreservesExactlyOneStroke(
            string pointerKind,
            int pointerId)
        {
            var pointers = new List<string>();
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-PostCommitCancelTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add,
                _ => { },
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown(pointerKind, pointerId, 100, 100, 620, 400, 800);
            capture.CaptureMove(pointerId, 125, 100, 700); // dominant pullback
            capture.CaptureMove(pointerId, 150, 104, 660); // > threshold forward reversal
            capture.CaptureCancel(155);

            Assert.That(gestures, Has.Count.EqualTo(1),
                "cancellation cannot erase an irreversibly committed stroke");
            Assert.That(cancellations, Is.Zero,
                "post-commit cancellation must not reset the committed bat pose");
            Assert.That(pointers, Is.EqualTo(new[] { "down:" + pointerKind }),
                "post-commit cancellation is resolved by the gesture, not an abort event");
            StringAssert.Contains("\"t\":125", gestures[0]);
            StringAssert.Contains("\"t\":150", gestures[0]);
            StringAssert.DoesNotContain("\"t\":155", gestures[0],
                "platform cancellation has no coordinate and must not invent a final sample");
            Assert.That(capture.InputArmed, Is.False);

            capture.CaptureCancel(160);
            capture.CaptureUp(pointerId, 170, 108, 640);
            capture.CaptureDown(pointerKind, pointerId, 180, 100, 620, 400, 800);
            capture.CaptureUp(pointerId, 200, 100, 620);
            Assert.That(gestures, Has.Count.EqualTo(1),
                "the cancelled committed contact spends the delivery exactly once");
        }

        [Test]
        public void TouchCapture_AllowsTenSecondRestBeforeOneBoundedSwipe()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-LongRestTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 1, 100, 100, 700, 400, 800);
            capture.CaptureMove(1, 10_100, 100, 700);
            capture.CaptureMove(1, 10_120, 130, 670);
            capture.CaptureMove(1, 10_260, 190, 610);
            Assert.That(gestures, Is.Empty);
            capture.CaptureUp(1, 10_280, 200, 600);

            Assert.That(gestures.Count, Is.EqualTo(1));
            StringAssert.DoesNotContain("\"t\":100,", gestures[0],
                "the ten-second pre-intent wait must not enter the gesture packet");
        }

        [Test]
        public void TouchCapture_RestingAtReleaseMaySwipeButLiftAloneIsNotAShot()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-RestingAtReleaseTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));

            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 7 }, false);
            capture.CaptureRestingMove("touch", 7, 100, 100, 700, 400, 800);
            capture.CaptureUp(7, 200, 100, 700);
            Assert.That(gestures, Is.Empty, "a resting finger lift is not a shot");

            capture.EndDelivery();
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 8 }, false);
            capture.CaptureRestingMove("touch", 8, 10_000, 100, 700, 400, 800);
            capture.CaptureRestingMove("touch", 8, 20_000, 140, 660, 400, 800);
            capture.CaptureMove(8, 20_150, 200, 600);
            Assert.That(gestures, Is.Empty);
            capture.CaptureUp(8, 20_170, 210, 590);

            Assert.That(gestures.Count, Is.EqualTo(1),
                "intentional post-release movement from a resting finger must remain playable");
        }

        [Test]
        public void TouchCapture_RestingAtReleaseDenseSlowDriftRebasesAndNeverSwings()
        {
            var gestures = new List<string>();
            var preparations = 0;
            root = new GameObject("VandeTouchInputCapture-RestingSlowDriftTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => preparations++, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 7 }, false);
            capture.CaptureRestingMove("touch", 7, 100, 100, 700, 400, 800);

            // Each 0.5 px / 10 ms segment is below the canonical 0.08 px/ms
            // intentional-run threshold. Its cumulative distance exceeds the
            // movement threshold only if the coordinate anchor stays stale.
            for (var index = 1; index <= 40; index++)
                capture.CaptureRestingMove(
                    "touch", 7, 100 + index * 10, 100, 700 + index * 0.5, 400, 800);
            // Gapped 4 px steps are individually real motion, but each gap
            // ends the canonical moving run; they also must not accumulate.
            for (var index = 1; index <= 6; index++)
                capture.CaptureRestingMove(
                    "touch", 7, 500 + index * 50, 100, 720 + index * 4, 400, 800);
            capture.CaptureUp(7, 820, 100, 744);

            Assert.That(gestures, Is.Empty);
            Assert.That(preparations, Is.Zero,
                "slow or gapped pre-held drift must never be compressed into a swipe");
            Assert.That(capture.InputArmed, Is.True);
        }

        [Test]
        public void TouchCapture_RestingAtReleaseFastSwipeAfterSlowDriftEmitsOnceFromNewAnchor()
        {
            var gestures = new List<string>();
            var pointers = new List<string>();
            root = new GameObject("VandeTouchInputCapture-RestingDriftThenSwipeTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((phase, pointer, _) => pointers.Add(phase + ":" + pointer),
                gestures.Add, _ => { }, () => { }, _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 8 }, false);
            capture.CaptureRestingMove("touch", 8, 100, 100, 700, 400, 800);

            for (var index = 1; index <= 20; index++)
                capture.CaptureRestingMove(
                    "touch", 8, 100 + index * 10, 100, 700 + index * 0.5, 400, 800);
            // A new dense run at 0.4 px/ms starts from the drifted rest.
            capture.CaptureRestingMove("touch", 8, 310, 100, 714, 400, 800);
            capture.CaptureRestingMove("touch", 8, 320, 100, 718, 400, 800);
            capture.CaptureRestingMove("touch", 8, 330, 100, 722, 400, 800);
            capture.CaptureRestingMove("touch", 8, 340, 100, 726, 400, 800);
            capture.CaptureUp(8, 350, 100, 730);
            capture.CaptureUp(8, 360, 100, 734);

            Assert.That(gestures, Has.Count.EqualTo(1));
            Assert.That(pointers, Is.EqualTo(new[] { "down:touch" }));
            StringAssert.DoesNotContain("\"t\":100", gestures[0],
                "the pre-swipe hold and drift must stay outside the raw packet");
            StringAssert.Contains("\"t\":320", gestures[0],
                "the bounded packet begins at the latest rebased rest coordinate");
            StringAssert.Contains("\"t\":340", gestures[0]);
            Assert.That(capture.InputArmed, Is.False);
        }

        [Test]
        public void TouchCapture_RestingDenseRunUsesCanonicalDepartureForNearDeadlineAuthorization()
        {
            var gestures = new List<string>();
            var preparations = new List<double>();
            var pointerDowns = new List<double>();
            root = new GameObject("VandeTouchInputCapture-RestingDenseOnsetTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, _, time) =>
                {
                    if (phase == "down") pointerDowns.Add(time);
                },
                gestures.Add,
                preparations.Add,
                () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 9 }, false);
            capture.CaptureRestingMove("touch", 9, 100, 100, 700, 400, 800);
            capture.CaptureRestingMove("touch", 9, 110, 104, 700, 400, 800);
            capture.CaptureRestingMove("touch", 9, 120, 108, 700, 400, 800);
            capture.CaptureRestingMove("touch", 9, 130, 112, 700, 400, 800);
            capture.CaptureRestingMove("touch", 9, 140, 116, 700, 400, 800);

            // Canonical swipeStart: leave the 2.5 px departure circle during
            // the first 4 px / 10 ms segment: 100 + (2.5/4)*10 = 106.25.
            Assert.That(preparations, Has.Count.EqualTo(1));
            Assert.That(pointerDowns, Has.Count.EqualTo(1));
            Assert.That(preparations[0], Is.EqualTo(106.25).Within(0.001));
            Assert.That(pointerDowns[0], Is.EqualTo(106.25).Within(0.001));
            Assert.That(preparations[0], Is.LessThanOrEqualTo(110.0),
                "onset before the deadline remains authorized even though threshold crossing is later");
            Assert.That(140.0, Is.GreaterThan(110.0));

            capture.CaptureUp(9, 150, 120, 700);
            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.Contains("\"t\":100", gestures[0]);
            StringAssert.Contains("\"t\":110", gestures[0]);
            StringAssert.Contains("\"t\":140", gestures[0]);
        }

        [Test]
        public void TouchCapture_RestingGapUsesCanonicalCarryBackAndPreservesFollowingSample()
        {
            var gestures = new List<string>();
            var preparations = new List<double>();
            var pointerDowns = new List<double>();
            root = new GameObject("VandeTouchInputCapture-RestingGapOnsetTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (phase, _, time) =>
                {
                    if (phase == "down") pointerDowns.Add(time);
                },
                gestures.Add,
                preparations.Add,
                () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 10 }, false);
            capture.CaptureRestingMove("touch", 10, 100, 100, 700, 400, 800);
            capture.CaptureRestingMove("touch", 10, 200, 108, 700, 400, 800);
            capture.CaptureRestingMove("touch", 10, 210, 116, 700, 400, 800);

            // First moving distance is 8 px; the following segment advances
            // another 8 px in 10 ms, so canonical gap carry-back uses 0.8
            // px/ms: 200 - (8 - 2.5) / 0.8 = 193.125.
            Assert.That(preparations, Has.Count.EqualTo(1));
            Assert.That(pointerDowns, Has.Count.EqualTo(1));
            Assert.That(preparations[0], Is.EqualTo(193.125).Within(0.001));
            Assert.That(pointerDowns[0], Is.EqualTo(193.125).Within(0.001));

            capture.CaptureUp(10, 220, 120, 700);
            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.Contains("\"t\":200", gestures[0]);
            StringAssert.Contains("\"t\":210", gestures[0],
                "TypeScript must receive the following sample used by canonical carry-back");
        }

        [Test]
        public void TouchCapture_LocalBatPreviewWaitsForReleaseAndIntentThenStaysBounded()
        {
            var previews = new List<PracticeLocalBatPreview>();
            root = new GameObject("VandeTouchInputCapture-LocalPreviewThresholdTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (_, __, ___) => { },
                _ => { },
                _ => { },
                () => { },
                _ => Assert.Fail("Input capture failed."),
                previews.Add);

            capture.BeginDelivery();
            capture.CaptureDown("touch", 1, 100, 100, 700, 400, 800);
            capture.CaptureMove(1, 110, 200, 600);
            Assert.That(previews, Is.Empty, "a local bat must never move before release");

            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 2, 200, 100, 700, 400, 800);
            capture.CaptureMove(2, 210, 108, 700);
            Assert.That(previews, Is.Empty, "sub-threshold touch jitter is not player intent");

            capture.CaptureMove(2, 220, 5000, -5000);
            Assert.That(previews, Has.Count.EqualTo(1));
            Assert.That(previews[0].Horizontal, Is.InRange(-1f, 1f));
            Assert.That(previews[0].Vertical, Is.InRange(-1f, 1f));
            Assert.That(previews[0].Reach, Is.InRange(0f, 1f));
            Assert.That(previews[0].Horizontal, Is.EqualTo(1f));
            Assert.That(previews[0].Vertical, Is.EqualTo(1f));
            Assert.That(previews[0].Reach, Is.EqualTo(1f));
            Assert.That(capture.LocalPreviewActive, Is.True);
        }

        [Test]
        public void TouchCapture_LocalPreviewMovesBackliftHoldForwardWithoutRewinding()
        {
            var previews = new List<PracticeLocalBatPreview>();
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-OneContactPreviewTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."), previews.Add);
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            capture.CaptureDown("touch", 1, 100, 100, 600, 400, 800);
            capture.CaptureMove(1, 125, 100, 680);
            var loaded = previews[previews.Count - 1];
            capture.CaptureMove(1, 425, 100, 680);
            var held = previews[previews.Count - 1];
            capture.CaptureMove(1, 455, 108, 645);
            var reversing = previews[previews.Count - 1];
            capture.CaptureMove(1, 495, 126, 575);
            var forward = previews[previews.Count - 1];
            capture.CaptureMove(1, 505, 125, 585);
            var forwardJitter = previews[previews.Count - 1];

            Assert.That(loaded.Backlift, Is.GreaterThan(0f));
            Assert.That(loaded.Forward, Is.Zero);
            Assert.That(held.Backlift, Is.EqualTo(loaded.Backlift).Within(0.0001f));
            Assert.That(held.Forward, Is.Zero);
            Assert.That(held.Reach, Is.EqualTo(loaded.Reach).Within(0.0001f),
                "holding the loaded pose must not advance or rewind the bat");
            Assert.That(reversing.Forward, Is.GreaterThan(held.Forward));
            Assert.That(reversing.Reach, Is.GreaterThan(held.Reach));
            Assert.That(forward.Forward, Is.GreaterThan(reversing.Forward));
            Assert.That(forward.Reach, Is.GreaterThan(reversing.Reach));
            Assert.That(forwardJitter.Reach, Is.EqualTo(forward.Reach).Within(0.0001f),
                "minor return-path jitter must not visually rewind a committed forward pose");
            Assert.That(gestures, Is.Empty,
                "local pose feedback cannot emit or normalize the authoritative shot");

            capture.CaptureUp(1, 515, 130, 560);
            Assert.That(gestures, Has.Count.EqualTo(1));
        }

        [Test]
        public void TouchCapture_HeldLateralRefinementDoesNotBecomeForwardPreviewAim()
        {
            var previews = new List<PracticeLocalBatPreview>();
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-LateralPreviewAnchorTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."), previews.Add);
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            CaptureHeldLateralStraightReversal(capture);

            Assert.That(gestures, Has.Count.EqualTo(1));
            Assert.That(previews, Has.Count.GreaterThanOrEqualTo(4));
            var lateralHold = previews[1];
            var forward = previews[previews.Count - 1];
            Assert.That(lateralHold.Horizontal, Is.GreaterThan(0f),
                "the loaded lateral refinement remains visible as stance intent");
            Assert.That(forward.Forward, Is.GreaterThan(0f));
            Assert.That(forward.Horizontal, Is.EqualTo(0f).Within(0.0001f),
                "a straight reversal must aim from the latest held anchor, not the original pullback x");
            var withPreview = gestures[0];
            StringAssert.Contains("\"t\":225,\"x\":150,\"y\":248", withPreview,
                "the display-only anchor must not rewrite the authoritative raw lateral sample");

            capture.EndDelivery();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            CaptureHeldLateralStraightReversal(capture);

            Assert.That(gestures, Has.Count.EqualTo(2));
            Assert.That(gestures[1], Is.EqualTo(withPreview),
                "local preview anchoring cannot change the raw packet sent to TypeScript");
        }

        [Test]
        public void TouchCapture_RealFootworkStartsWithTheImmediateBatPreview()
        {
            var previews = new List<PracticeLocalBatPreview>();
            root = new GameObject("VandeTouchInputCapture-PreviewFootworkTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, _ => { }, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."), previews.Add);
            capture.ConfigureAssistance("real");
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);

            // Native batting area is y=432..800; this origin is in its upper
            // forward-foot band and the drag crosses the intent threshold.
            capture.CaptureDown("touch", 1, 100, 100, 500, 400, 800);
            capture.CaptureMove(1, 120, 140, 470);

            Assert.That(previews, Has.Count.EqualTo(1));
            Assert.That(previews[0].Footwork, Is.EqualTo("forward"));
        }

        [Test]
        public void TouchCapture_LocalBatPreviewCancelAndDeliveryEndClearAllPreviewState()
        {
            var gestures = new List<string>();
            var cancellations = 0;
            root = new GameObject("VandeTouchInputCapture-LocalPreviewResetTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (_, __, ___) => { },
                gestures.Add,
                _ => { },
                () => cancellations++,
                _ => Assert.Fail("Input capture failed."),
                _ => { });

            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 1, 100, 100, 700, 400, 800);
            capture.CaptureMove(1, 110, 140, 660);
            Assert.That(capture.LocalPreviewActive, Is.True);
            capture.CaptureCancel(120);
            Assert.That(capture.LocalPreviewActive, Is.False);
            Assert.That(gestures, Is.Empty);
            Assert.That(cancellations, Is.EqualTo(1));

            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 2, 200, 100, 700, 400, 800);
            capture.CaptureMove(2, 210, 140, 660);
            Assert.That(capture.LocalPreviewActive, Is.True);
            capture.EndDelivery();
            Assert.That(capture.LocalPreviewActive, Is.False);
            Assert.That(cancellations, Is.EqualTo(2));
        }

        [Test]
        public void TouchCapture_LocalBatPreviewCannotChangeTheAuthoritativeGesturePacket()
        {
            var gestures = new List<string>();
            root = new GameObject("VandeTouchInputCapture-LocalPreviewAuthorityTest");
            var capture = root.AddComponent<VandeTouchInputCapture>();
            capture.Configure(
                (_, __, ___) => { },
                gestures.Add,
                _ => { },
                () => { },
                _ => Assert.Fail("Input capture failed."),
                _ => { });
            CaptureIdenticalSwipe(capture);
            Assert.That(gestures, Has.Count.EqualTo(1));
            var withPreview = gestures[0];

            capture.EndDelivery();
            capture.Configure(
                (_, __, ___) => { },
                gestures.Add,
                _ => { },
                () => { },
                _ => Assert.Fail("Input capture failed."));
            CaptureIdenticalSwipe(capture);

            Assert.That(gestures, Has.Count.EqualTo(2));
            Assert.That(gestures[1], Is.EqualTo(withPreview),
                "the display-only callback must not normalize, rewrite or score the raw gesture");
        }

        [Test]
        public void ProductionWorld_LocalBatPreviewIsPostReleaseAndHostIntentOverridesIt()
        {
            root = new GameObject("ProceduralPracticeWorld-LocalBatPreviewTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));
            world.BeginDelivery(Delivery());
            // Lead rulings 2026-11-04 (striker anticipation and trigger: TRACKB's live stance, the trigger 0.55 s before the
            // presented release, the backlift from it): the bat lives before release without any input. The rest pose
            // is therefore that anticipation at this same instant (Tick(0)), so the assertion below still isolates the
            // preview's own effect. Before the ruling the rest pose was the static code-authored stance from BeginDelivery.
            world.Tick(0.0);
            var bat = Child("BatProxy");
            var restRotation = bat.localRotation;
            var preview = PracticeLocalBatPreview.FromRawDisplacement(
                90, -70, 400, 368, "forward");

            world.BeginLocalPreparation();
            world.ApplyLocalBatPreview(preview);
            world.Tick(0.0);
            Assert.That(world.LocalBatPreviewActive, Is.False);
            Assert.That(Quaternion.Angle(restRotation, bat.localRotation), Is.LessThan(0.01f),
                "preview must not animate during the bowler's pre-release approach");

            world.Tick(2.41);
            world.BeginLocalPreparation();
            world.ApplyLocalBatPreview(preview);
            world.Tick(0.0);
            Assert.That(world.LocalBatPreviewActive, Is.True);
            Assert.That(
                Mathf.Abs(Descendant(Child("BatterTorsoProxy"), "MotionRoot").localPosition.z),
                Is.GreaterThan(0.001f),
                "press-origin footwork must move with the immediate backlift preview");
            Assert.That(Quaternion.Angle(restRotation, bat.localRotation), Is.GreaterThan(0.5f),
                "an intentional active drag needs visible, presentation-only bat feedback");

            world.ApplyProvisionalSwing(new PracticeSwingPresentation
            {
                Kind = "attack",
                StartT = world.Timeline,
                DirectionDeg = 28,
                Power = 0.72,
                Elevation = 0.18,
                Footwork = "forward"
            });
            Assert.That(world.LocalBatPreviewActive, Is.False,
                "host-normalized intent must synchronously retire the raw local preview");
            world.ApplyLocalBatPreview(preview);
            Assert.That(world.LocalBatPreviewActive, Is.False,
                "a raw preview can never overwrite a host-normalized provisional swing");

            world.CancelLocalPreparation();
            Assert.That(world.LocalBatPreviewActive, Is.False);
        }

        [Test]
        public void VisibleLatency_CompletesOnlyAfterARenderTimestamp()
        {
            var probe = new PracticeVisibleLatencyProbe();
            probe.Begin(1000);
            Assert.That(probe.Pending, Is.True);
            Assert.That(probe.Complete(1016), Is.EqualTo(16));
            Assert.That(probe.Complete(1032), Is.Null);
            probe.Begin(2000);
            probe.Cancel();
            Assert.That(probe.Complete(2016), Is.Null);
        }

        [TestCase(16f / 9f)]
        [TestCase(20f / 9f)]
        [TestCase(4f / 3f)]
        public void BatterCamera_PreservesConfiguredHorizontalFov(float aspect)
        {
            var vertical = ProceduralPracticeWorld.VerticalFovForHorizontal(
                ProceduralPracticeWorld.TargetHorizontalFovDegrees, aspect);
            var horizontal = Camera.VerticalToHorizontalFieldOfView(vertical, aspect);
            Assert.That(horizontal, Is.EqualTo(ProceduralPracticeWorld.TargetHorizontalFovDegrees).Within(0.01f));
            Assert.That(horizontal, Is.InRange(55f, 75f));
        }

        // `mirror` is the physics-to-Unity world reflection (owner ruling 2026-11-04): -1 for a right-hander.
        [TestCase("right", -1f)]
        [TestCase("left", 1f)]
        public void BatterCamera_ShowsEmbodiedBatterBesideAnUnobstructedReleaseCorridor(
            string handedness, float mirror)
        {
            root = new GameObject("ProceduralPracticeWorld-CameraCompositionTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "learn",
                Handedness = handedness,
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene(handedness));

            var camera = Child("BatterEyeCamera").GetComponent<Camera>();
            camera.aspect = 16f / 9f;
            camera.fieldOfView = ProceduralPracticeWorld.VerticalFovForHorizontal(
                ProceduralPracticeWorld.TargetHorizontalFovDegrees, camera.aspect);
            var batter = Child("BatterTorsoProxy");
            var keeper = Child("FielderProxy-fielder-0");
            var head = Descendant(batter, "Joint-Head");
            var hips = Descendant(batter, "Joint-Hips");
            var leftFoot = Descendant(batter, "Joint-FootLeft");
            var rightFoot = Descendant(batter, "Joint-FootRight");
            var releaseCorridor = camera.WorldToViewportPoint(new Vector3(0f, 1.65f, -8.69f));
            var headViewport = camera.WorldToViewportPoint(head.position);
            var hipsViewport = camera.WorldToViewportPoint(hips.position);
            var leftFootViewport = camera.WorldToViewportPoint(leftFoot.position);
            var rightFootViewport = camera.WorldToViewportPoint(rightFoot.position);
            var lowerFootY = Mathf.Min(leftFootViewport.y, rightFootViewport.y);
            var jointFigureHeight = headViewport.y - lowerFootY;

            var expectedPosition = ProceduralPracticeWorld.BatterCameraPosition(0f, 0f, mirror);
            Assert.That(expectedPosition.x,
                Is.EqualTo(mirror * ProceduralPracticeWorld.BatterCameraLateralOffsetMetres)
                    .Within(0.000001f));
            Assert.That(expectedPosition.y,
                Is.EqualTo(ProceduralPracticeWorld.BatterCameraHeightMetres).Within(0.000001f));
            Assert.That(expectedPosition.z,
                Is.EqualTo(9.25f + ProceduralPracticeWorld.BatterCameraRearDistanceMetres)
                    .Within(0.000001f));
            var cameraRadius = Mathf.Sqrt(
                ProceduralPracticeWorld.BatterCameraRearDistanceMetres *
                ProceduralPracticeWorld.BatterCameraRearDistanceMetres +
                ProceduralPracticeWorld.BatterCameraLateralOffsetMetres *
                ProceduralPracticeWorld.BatterCameraLateralOffsetMetres);
            var cameraAzimuth = Mathf.Atan2(
                ProceduralPracticeWorld.BatterCameraLateralOffsetMetres,
                ProceduralPracticeWorld.BatterCameraRearDistanceMetres) * Mathf.Rad2Deg;
            Assert.That(cameraRadius, Is.InRange(4.42f, 4.46f),
                "rear-three-quarter correction must preserve foreground player scale");
            Assert.That(cameraAzimuth, Is.InRange(22f, 23f),
                "camera must expose the helmet aperture and cheek rather than look straight at its rear shell");
            Assert.That(ProceduralPracticeWorld.BatterCameraTarget(0f).y,
                Is.EqualTo(ProceduralPracticeWorld.BatterCameraTargetHeightMetres)
                    .Within(0.000001f));

            Assert.That(headViewport.z, Is.GreaterThan(0f));
            Assert.That(hipsViewport.z, Is.GreaterThan(0f));
            Assert.That(leftFootViewport.z, Is.GreaterThan(0f));
            Assert.That(rightFootViewport.z, Is.GreaterThan(0f));
            Assert.That(headViewport.x, Is.InRange(0.08f, 0.92f));
            Assert.That(headViewport.y, Is.InRange(0.08f, 0.95f));
            Assert.That(hipsViewport.x, Is.InRange(0.08f, 0.92f));
            Assert.That(hipsViewport.y, Is.InRange(0.02f, 0.82f));
            Assert.That(leftFootViewport.y, Is.InRange(0.02f, 0.28f));
            Assert.That(rightFootViewport.y, Is.InRange(0.02f, 0.28f));
            Assert.That(jointFigureHeight, Is.InRange(0.54f, 0.82f),
                "the complete player must be large enough to read yet retain safe head-and-foot margins");
            // Owner ruling 2026-11-04 (option A): the camera stays on the striker's off side, now drawn correctly
            // on screen right, so a right-hander (mirror -1) reads lower-LEFT and a left-hander lower-right.
            Assert.That((headViewport.x - 0.5f) * mirror, Is.InRange(0.16f, 0.42f),
                "the off-side rear camera keeps a right-handed batter lower-left; left-handed play mirrors it once");
            Assert.That(releaseCorridor.z, Is.GreaterThan(0f));
            Assert.That(releaseCorridor.x, Is.EqualTo(0.5f).Within(0.08f));
            Assert.That(releaseCorridor.y, Is.InRange(0.30f, 0.78f));
            // Owner 2026-11-03 (HUM U9): the keeper is always visible; it reverses the 2026-10-28 rear-camera
            // exclusion. A standing-up keeper over the striker is screen-door faded only there (ProductionOcclusionFade).
            Assert.That(camera.cullingMask & (1 << keeper.gameObject.layer), Is.Not.Zero,
                "the behind-batter camera must render the wicketkeeper");
            Assert.That(camera.cullingMask & (1 << batter.gameObject.layer), Is.Not.Zero,
                "the requested embodied batter must remain rendered");
        }

        [Test]
        public void ProductionWorld_UsesCloseUpForegroundBatterOnlyOnHighProfile()
        {
            root = new GameObject("ProceduralPracticeWorld-ForegroundBatterLodTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.High
            }, new NullPracticeFeedbackSink());

            var batter = Child("BatterTorsoProxy");
            Assert.That(VisibleTriangleCount(batter.gameObject), Is.EqualTo(39_454),
                "High alone opts the foreground striker into the already-admitted close-up body, gear and bat");

            world.RequestProfile(PracticePresentationQuality.Standard);
            Assert.That(VisibleTriangleCount(batter.gameObject), Is.EqualTo(7_639),
                "Standard must restore the bounded live batter rather than retain High's close-up selection");

            world.RequestProfile(PracticePresentationQuality.Lite);
            Assert.That(VisibleTriangleCount(batter.gameObject), Is.EqualTo(6_408),
                "Lite must keep complete gear and bat while selecting its lower-cost live body");

            world.RequestProfile(PracticePresentationQuality.High);
            Assert.That(VisibleTriangleCount(batter.gameObject), Is.EqualTo(39_454),
                "a between-ball return to High deterministically restores the close-up foreground striker");
        }

        [Test]
        public void ProductionWorld_IdleLiveSamplesPreserveStableDistinctFielderReadyPoses()
        {
            root = new GameObject("ProceduralPracticeWorld-StableFielderReadyTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));

            var point = Child("FielderProxy-fielder-2");
            var cover = Child("FielderProxy-fielder-3");
            var pointMotion = Descendant(point, "MotionRoot");
            var coverMotion = Descendant(cover, "MotionRoot");
            var pointReady = pointMotion.localPosition;
            var coverReady = coverMotion.localPosition;
            Assert.That(pointReady.y, Is.LessThan(-0.15f),
                "configured fielders must begin in the flexed ready stance, not Stand");
            Assert.That(Vector3.Distance(pointReady, coverReady), Is.GreaterThan(0.005f),
                "stable id/index phases must prevent identical ready-pose clones");

            world.SetFielder("fielder-2", new Vande.Practice.Trace.FielderTraceSample
            {
                t = 0.37,
                x = -3,
                z = 4,
                action = "idle"
            });
            Assert.That(Vector3.Distance(pointMotion.localPosition, pointReady), Is.LessThan(0.000001f),
                "the first live idle sample must retain the configured identity-derived phase");
            world.SetFielder("fielder-2", new Vande.Practice.Trace.FielderTraceSample
            {
                t = 8.91,
                x = -3,
                z = 4,
                action = "idle"
            });
            Assert.That(Vector3.Distance(pointMotion.localPosition, pointReady), Is.LessThan(0.000001f),
                "trace time must not animate or reset a static ready-phase sample");

            var actions = new[] { "run", "dive", "throw" };
            var actionTimes = new[] { 0.155, 0.50, 0.45 };
            for (var actionIndex = 0; actionIndex < actions.Length; actionIndex++)
            {
                world.SetFielder("fielder-2", new Vande.Practice.Trace.FielderTraceSample
                {
                    t = actionTimes[actionIndex],
                    x = -3,
                    z = 4,
                    action = actions[actionIndex]
                });
                Assert.That(Vector3.Distance(pointMotion.localPosition, pointReady), Is.GreaterThan(0.04f),
                    actions[actionIndex] + " must still sample its authoritative action presentation");
                world.SetFielder("fielder-2", new Vande.Practice.Trace.FielderTraceSample
                {
                    t = 12 + actionIndex,
                    x = -3,
                    z = 4,
                    action = "idle"
                });
                Assert.That(Vector3.Distance(pointMotion.localPosition, pointReady), Is.LessThan(0.000001f),
                    "idle after " + actions[actionIndex] + " must restore the same stable ready phase");
            }

            world.SetFielder("fielder-0", new Vande.Practice.Trace.FielderTraceSample
            {
                t = 0.3,
                x = -5,
                z = 0,
                action = "idle"
            });
            Assert.That(Descendant(Child("FielderProxy-fielder-0"), "MotionRoot").localPosition.y,
                Is.LessThan(-0.4f), "the keeper must remain in KeeperCrouch during live idle samples");
        }

        [Test]
        public void ProductionWorld_FielderHeightsAreBoundedDeterministicAndDistinctByStableSlot()
        {
            var expectedMillimetres = new HashSet<int>();
            for (var slot = 1; slot < 11; slot++)
            {
                var first = ProceduralPracticeWorld.StableFielderHeightMetres(slot);
                var repeated = ProceduralPracticeWorld.StableFielderHeightMetres(slot);
                Assert.That(repeated, Is.EqualTo(first));
                Assert.That(first, Is.InRange(
                    ProceduralPracticeWorld.MinimumFielderHeightMetres,
                    ProceduralPracticeWorld.MaximumFielderHeightMetres));
                expectedMillimetres.Add(Mathf.RoundToInt(first * 1000f));
            }
            Assert.That(expectedMillimetres.Count, Is.GreaterThanOrEqualTo(8),
                "ten stable construction slots must not collapse back into cloned heights");
            Assert.That(() => ProceduralPracticeWorld.StableFielderHeightMetres(-1),
                Throws.TypeOf<ArgumentOutOfRangeException>());

            root = new GameObject("ProceduralPracticeWorld-FielderHeightVariationTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));

            var actualMillimetres = new HashSet<int>();
            for (var slot = 1; slot < 11; slot++)
            {
                var character = Child("FielderProxy-fielder-" + slot);
                var actualHeight = character.localScale.y * ProductionCharacterRig.ReferenceHeightMetres;
                Assert.That(actualHeight,
                    Is.EqualTo(ProceduralPracticeWorld.StableFielderHeightMetres(slot)).Within(0.0001f));
                Assert.That(actualHeight, Is.InRange(
                    ProceduralPracticeWorld.MinimumFielderHeightMetres,
                    ProceduralPracticeWorld.MaximumFielderHeightMetres));
                actualMillimetres.Add(Mathf.RoundToInt(actualHeight * 1000f));
            }
            Assert.That(actualMillimetres.Count, Is.GreaterThanOrEqualTo(8));

            var keeper = Child("FielderProxy-fielder-0");
            var keeperHeight = keeper.localScale.y * ProductionCharacterRig.ReferenceHeightMetres;
            Assert.That(keeperHeight, Is.EqualTo(ProductionCharacterRig.ReferenceHeightMetres).Within(0.0001f),
                "keeper construction must retain its dedicated role specification");
        }

        [Test]
        public void ProductionWorld_SelectsFielderLodFromActualStrikerDistanceAcrossProfilesAndBenchmark()
        {
            root = new GameObject("ProceduralPracticeWorld-FielderDistanceLodTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.High
            }, new NullPracticeFeedbackSink());

            var scene = Scene("right");
            scene.BatterLateralM = 0.4;
            scene.BatterCreaseOffsetM = 0.2;
            scene.Fielders[2].Id = "near-ring";
            scene.Fielders[2].X = 0.4;
            scene.Fielders[2].Z = -10.95; // 20 m from the actual 9.05 m striker reference.
            scene.Fielders[3].Id = "deep-cover";
            scene.Fielders[3].X = 0.4;
            scene.Fielders[3].Z = -25.95; // 35 m from the actual striker reference.
            world.ConfigureScene(scene);

            var near = Child("FielderProxy-near-ring");
            var deep = Child("FielderProxy-deep-cover");
            var bowler = Child("BowlerProxy");
            var nearMesh = Descendant(near, "BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
            var deepMesh = Descendant(deep, "BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
            var bowlerMesh = Descendant(bowler, "BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
            var nearHighTriangles = (int)(nearMesh.sharedMesh.GetIndexCount(0) / 3);
            var deepHighTriangles = (int)(deepMesh.sharedMesh.GetIndexCount(0) / 3);

            Assert.That(nearHighTriangles, Is.InRange(2_001, 4_000),
                "the 20 m close/ring fielder keeps gameplay LOD1");
            Assert.That(deepHighTriangles,
                Is.InRange(1, ProductionBakedCharacterMesh.DistantPremiumTriangleBudget),
                "the 35 m fielder uses Premium LOD2 rather than a hero or close mesh");
            Assert.That(VisibleTriangleCount(bowler.gameObject), Is.LessThanOrEqualTo(4_000),
                "the live 20 m bowler's complete visible presentation stays inside the mobile budget");

            world.RequestProfile(PracticePresentationQuality.Standard);
            Assert.That((int)(nearMesh.sharedMesh.GetIndexCount(0) / 3), Is.EqualTo(nearHighTriangles),
                "profile changes preserve the latched real position and close LOD1");
            Assert.That((int)(deepMesh.sharedMesh.GetIndexCount(0) / 3),
                Is.InRange(1, ProductionBakedCharacterMesh.DistantBalancedTriangleBudget));

            world.BeginBenchmarkWorkload();
            Assert.That((int)(deepMesh.sharedMesh.GetIndexCount(0) / 3), Is.EqualTo(nearHighTriangles),
                "benchmark position changes recompute distance instead of retaining a stale deep-field LOD");
            world.EndBenchmarkWorkload();
            Assert.That((int)(deepMesh.sharedMesh.GetIndexCount(0) / 3),
                Is.InRange(1, ProductionBakedCharacterMesh.DistantBalancedTriangleBudget),
                "restoring the authoritative field restores its distance-selected LOD2");
        }

        [Test]
        public void BowlerRootTravel_MatchesRunPlantAndReleaseWithoutRootSkate()
        {
            var motions = new[]
            {
                ProductionCharacterMotion.PaceBowling,
                ProductionCharacterMotion.SpinBowling
            };
            for (var motionIndex = 0; motionIndex < motions.Length; motionIndex++)
            {
                var motion = motions[motionIndex];
                var pace = motion == ProductionCharacterMotion.PaceBowling;
                var release = pace
                    ? ProductionCharacterMotionSampler.PaceRelease
                    : ProductionCharacterMotionSampler.SpinRelease;
                var runEnd = (pace
                    ? ProductionCharacterMotionSampler.PaceRunUpComplete
                    : ProductionCharacterMotionSampler.SpinApproachComplete) / release;
                var plantAt = (pace
                    ? ProductionCharacterMotionSampler.PaceFrontFootPlant
                    : ProductionCharacterMotionSampler.SpinFrontFootPlant) / release;
                var expectedRunShare = pace ? 0.78f : 0.70f;
                var expectedPlantShare = pace ? 0.95f : 0.94f;

                Assert.That(ProceduralPracticeWorld.BowlerRootTravelNormalized(0f, motion), Is.Zero);
                Assert.That(ProceduralPracticeWorld.BowlerRootTravelNormalized(1f, motion), Is.EqualTo(1f));
                Assert.That(ProceduralPracticeWorld.BowlerRootTravelNormalized(runEnd, motion),
                    Is.EqualTo(expectedRunShare).Within(0.0001f));
                Assert.That(ProceduralPracticeWorld.BowlerRootTravelNormalized(plantAt, motion),
                    Is.EqualTo(expectedPlantShare).Within(0.0001f),
                    "only the final braced stride may remain after front-foot plant");
                var previous = 0f;
                for (var step = 1; step <= 100; step++)
                {
                    var current = ProceduralPracticeWorld.BowlerRootTravelNormalized(step / 100f, motion);
                    Assert.That(current, Is.GreaterThan(previous), motion + " step " + step);
                    previous = current;
                }
            }
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ProceduralPracticeWorld.BowlerRootTravelNormalized(
                    float.NaN, ProductionCharacterMotion.PaceBowling));
            Assert.Throws<ArgumentOutOfRangeException>(() =>
                ProceduralPracticeWorld.BowlerRootTravelNormalized(
                    0.5f, ProductionCharacterMotion.BatterStroke));
        }

        [Test]
        public void ProductionWorld_ProvidesCricketArtifactsAndPostReleaseFollowThrough()
        {
            root = new GameObject("ProceduralPracticeWorld-BodyTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "learn",
                Handedness = "left",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("left"));
            var delivery = Delivery();
            delivery.LearnCue = true;
            world.BeginDelivery(delivery);

            var torso = Child("BatterTorsoProxy");
            var bat = Child("BatProxy");
            var bowler = Child("BowlerProxy");
            var ball = Child("ProductionCricketBall");
            var releaseHand = Descendant(bowler, "ReleaseHandAnchor");
            Assert.That(torso.gameObject.activeSelf, Is.True);
            Assert.That(Descendant(torso, "LawScaleBlade"), Is.Not.Null);
            Assert.That(bat.GetComponentInChildren<Renderer>(), Is.Not.Null);
            Assert.That(Vector3.Distance(ball.position, releaseHand.position), Is.LessThan(0.01f),
                "the visible ball starts in the authoritative bowler's release hand");
            Assert.That(Child("PitchSurface"), Is.Not.Null);
            Assert.That(Descendant(ball, "RaisedDoubleSeam"), Is.Not.Null);
            Assert.That(ProceduralPracticeWorld.DefaultPracticeLight, Is.EqualTo(ProductionLight.Day),
                "the default drill must prioritize ball and player readability on small screens");
            Assert.That(Child("BatterEyeCamera").GetComponent<Camera>().allowMSAA, Is.True,
                "standard/high presentation enables bounded 2x edge smoothing; Lite disables it");

            // ApproachSeconds is stored as a float, so advance just beyond the
            // nominal 2.40-second release boundary instead of depending on a
            // float-to-double representation landing at exactly zero.
            world.Tick(2.41);
            Assert.That(Child("AllowedPostReleaseGuidance").gameObject.activeSelf, Is.False,
                "ordinary Learn must not expose a predicted full-flight arc");
            Assert.That(Child("AuthoritativeLandingArea").gameObject.activeSelf, Is.True,
                "ordinary Learn exposes only the authoritative pitch location after release");
            Assert.That(Child("BallReadabilityFocus").gameObject.activeSelf, Is.False,
                "focus defaults off until the host contract carries its setting");
            var releaseZ = bowler.position.z;
            world.Tick(0.4);
            Assert.That(bowler.position.z, Is.GreaterThan(releaseZ + 0.1f),
                "the bowler must continue through the crease after release");
        }

        [Test]
        public void DelayedResult_ReconcilesContactStateWithoutReplayingPastFeedback()
        {
            root = new GameObject("ProceduralPracticeWorld-DelayedResultTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "learn",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
                fielders[index] = new PracticeFielderPresentation
                    {
                        Id = "fielder-" + index,
                        Role = index == 1 ? "bowler" : "point",
                        X = index - 5,
                        Z = index * 2
                    };
            world.ConfigureScene(new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "red",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = "right"
            });
            world.BeginDelivery(new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new Vande.Practice.Trace.BallTraceSample
                    {
                        t = 0, p = Vector(0, 2, -8), v = Vector(0, -1, 35)
                    },
                    new Vande.Practice.Trace.BallTraceSample
                    {
                        t = 1, p = Vector(0, 0.4, 9), v = Vector(0, 0, 20)
                    }
                },
                SeamAxis = Vector(0, 1, 0),
                ShineDirection = Vector(1, 0, 0),
                SpinAxis = Vector(0, 1, 0),
                SpinRps = 10
            });
            world.Tick(3.0);
            var emitted = 0;
            world.TraceEvent += _ => emitted++;

            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = CanonicalTraceTestFixture.Create(),
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('a', 64),
                PlaybackSpeed = 1,
                IsReplay = false
            });

            Assert.That(world.ContactHasOccurred, Is.True);
            Assert.That(emitted, Is.Zero, "historical audio/haptic events must not replay late");
        }

        [Test]
        public void Replay_ResetsPlaybackCompletionAndCompletesExactlyOnceAgain()
        {
            root = new GameObject("ProceduralPracticeWorld-ReplayTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));
            world.BeginDelivery(Delivery());
            var completions = 0;
            var quietEnds = 0;
            world.DeliveryCompleted += (_, __) => completions++;
            world.QuietChanged += value =>
            {
                if (!value) quietEnds++;
            };
            var trace = CanonicalTraceTestFixture.Create();
            var digest = new string('b', 64);

            world.Tick(2.4);
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = digest,
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "forward"
            });
            Assert.That(world.CanonicalFootwork, Is.EqualTo(ProductionBatterFootwork.Forward));
            world.Tick(1.0);
            Assert.That(completions, Is.Zero,
                "trace completion must preserve an unobstructed balanced recovery before dead-ball UI");
            Assert.That(quietEnds, Is.Zero,
                "dead-ball UI must remain hidden while the balanced recovery first reads");
            var canonicalEndTime = world.Timeline;
            var heldCanonicalBat = world.BatterBatWorldPosition;
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds * 0.5);
            var middleRecoveryBat = world.BatterBatWorldPosition;
            Assert.That(world.Timeline, Is.EqualTo(canonicalEndTime).Within(0.000001),
                "presentation-only recovery must never extend or rewrite canonical trace time");
            Assert.That(Vector3.Distance(middleRecoveryBat, heldCanonicalBat), Is.GreaterThan(0.01f),
                "the first half of the recovery beat must visibly resolve the held canonical bat");
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds * 0.5 - 0.001);
            Assert.That(completions, Is.Zero,
                "the recovery beat must not report completion early");
            Assert.That(quietEnds, Is.Zero);
            world.Tick(0.001);
            Assert.That(Vector3.Distance(world.BatterBatWorldPosition, middleRecoveryBat),
                Is.GreaterThan(0.01f),
                "the second half of the recovery beat must continue into the balanced finish");
            Assert.That(quietEnds, Is.EqualTo(1),
                "outcome presentation may reveal only after the recovery beat completes");
            world.Tick(0.45);
            Assert.That(completions, Is.EqualTo(1));

            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = digest,
                PlaybackSpeed = 1,
                IsReplay = true,
                Footwork = "back"
            });
            Assert.That(world.CanonicalFootwork, Is.EqualTo(ProductionBatterFootwork.Back),
                "replay body motion must use authoritative result footwork, not stale provisional motion");
            world.Tick(1.0);
            var replayHeldBat = world.BatterBatWorldPosition;
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds * 0.5);
            var replayMiddleBat = world.BatterBatWorldPosition;
            Assert.That(Vector3.Distance(replayMiddleBat, replayHeldBat), Is.GreaterThan(0.01f),
                "replay must visibly include the first half of the authored recovery");
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds * 0.5);
            Assert.That(Vector3.Distance(world.BatterBatWorldPosition, replayMiddleBat),
                Is.GreaterThan(0.01f),
                "replay must visibly include the second half of the authored recovery");
            Assert.That(quietEnds, Is.EqualTo(2),
                "replay must apply the same recovery-before-outcome contract exactly once");
            world.Tick(0.45);
            world.Tick(1.0);
            Assert.That(completions, Is.EqualTo(2), "each replay must complete once, not hang or duplicate");
        }

        [TestCase(0, TestName = "NoShotTrace_EmptyBat_DoesNotInventARecoveryStroke")]
        [TestCase(1, TestName = "NoShotTrace_MinimalTimedHeldBat_DoesNotInventARecoveryStroke")]
        [TestCase(2, TestName = "NoShotTrace_TimedHeldBat_DoesNotInventARecoveryStroke")]
        public void NoShotTrace_DoesNotInventARecoveryStroke(int batMode)
        {
            root = new GameObject("ProceduralPracticeWorld-NoShotRecoveryTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));
            world.BeginDelivery(Delivery());
            world.Tick(2.4);

            var trace = CanonicalTraceTestFixture.Create();
            trace.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            trace.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
            var held = trace.bat[0];
            if (batMode == 0)
            {
                trace.bat = Array.Empty<BatTraceSample>();
                trace.batterMotion = null;
            }
            else if (batMode == 1)
            {
                trace.bat = new[]
                {
                    held,
                    new BatTraceSample
                    {
                        t = 0.05,
                        grip = held.grip,
                        toe = held.toe,
                        face = held.face
                    },
                    new BatTraceSample
                    {
                        t = 0.1,
                        grip = held.grip,
                        toe = held.toe,
                        face = held.face
                    }
                };
                trace.batterMotion = new TraceBatterMotion
                {
                    startT = held.t,
                    contactT = 0.05,
                    endT = 0.1
                };
            }
            else
            {
                trace.bat = new[]
                {
                    held,
                    new BatTraceSample
                    {
                        t = trace.durationSeconds * 0.5,
                        grip = held.grip,
                        toe = held.toe,
                        face = held.face
                    },
                    new BatTraceSample
                    {
                        t = trace.durationSeconds,
                        grip = held.grip,
                        toe = held.toe,
                        face = held.face
                    }
                };
                trace.batterMotion = new TraceBatterMotion
                {
                    startT = held.t,
                    contactT = trace.durationSeconds * 0.5,
                    endT = trace.durationSeconds
                };
            }
            trace.events = new[] { trace.events[0] };

            var quietEnds = 0;
            world.QuietChanged += quiet =>
            {
                if (!quiet) quietEnds++;
            };
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('e', 64),
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "forward"
            });
            // UNITY phase 2: acceptance no longer snaps the body to the planted frame in one frame; a bounded carry
            // (here at most max(CanonicalBodyBlendSeconds, 0.32 m / BatterCarryAverageMetresPerSecond) = 0.2 s)
            // brings it there. After that carry nothing may move the pelvis or head through playback.
            const double carrySettleSeconds = 0.25;
            world.Tick(carrySettleSeconds);
            var acceptedHips = world.BatterHipsWorldPosition;
            var acceptedHead = world.BatterHeadWorldPosition;
            world.Tick(trace.durationSeconds - carrySettleSeconds);

            Assert.That(quietEnds, Is.EqualTo(1),
                "a no-shot trace must enter normal outcome timing without a fabricated drive recovery");
            Assert.That(Vector3.Distance(world.BatterHipsWorldPosition, acceptedHips),
                Is.LessThan(0.001f),
                "timed held bat samples must not fabricate a pelvis drive through playback");
            Assert.That(Vector3.Distance(world.BatterHeadWorldPosition, acceptedHead),
                Is.LessThan(0.001f),
                "timed held bat samples must not fabricate a torso or head stroke through playback");
            var acceptedTerminalBat = world.BatterBatWorldPosition;
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds);
            Assert.That(Vector3.Distance(world.BatterBatWorldPosition, acceptedTerminalBat),
                Is.LessThan(0.000001f),
                "dead-ball time must hold the accepted no-shot presentation exactly");
            Assert.That(quietEnds, Is.EqualTo(1));
        }

        [Test]
        public void NoShotAfterProvisionalSwing_BeginsFromTheVisibleBodyWithoutAResolvePop()
        {
            root = new GameObject("ProceduralPracticeWorld-NoShotProvisionalBlendTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));
            world.BeginDelivery(Delivery());
            world.Tick(2.41);
            world.BeginLocalPreparation();
            world.ApplyProvisionalSwing(new PracticeSwingPresentation
            {
                Kind = "attack",
                StartT = world.Timeline,
                DirectionDeg = 28,
                Power = 0.72,
                Elevation = 0.18,
                Footwork = "forward"
            });
            world.Tick(1.20);
            var provisionalHips = world.BatterHipsWorldPosition;
            var provisionalHead = world.BatterHeadWorldPosition;

            var trace = CanonicalTraceTestFixture.Create();
            trace.batterRootOffset = new TraceVector2 { x = 0.0, z = 0.0 };
            trace.batterPosture = new TraceBatterPosture { crouchM = 0.0 };
            var held = trace.bat[0];
            trace.bat = new[]
            {
                held,
                new BatTraceSample
                {
                    t = trace.durationSeconds * 0.5,
                    grip = held.grip,
                    toe = held.toe,
                    face = held.face
                },
                new BatTraceSample
                {
                    t = trace.durationSeconds,
                    grip = held.grip,
                    toe = held.toe,
                    face = held.face
                }
            };
            trace.batterMotion = new TraceBatterMotion
            {
                startT = held.t,
                contactT = trace.durationSeconds * 0.5,
                endT = trace.durationSeconds
            };
            trace.events = new[] { trace.events[0] };
            var quietEnds = 0;
            world.QuietChanged += quiet =>
            {
                if (!quiet) quietEnds++;
            };
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('f', 64),
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "forward"
            });

            Assert.That(Vector3.Distance(world.BatterHipsWorldPosition, provisionalHips),
                Is.LessThan(0.001f),
                "accepting a no-shot result must begin at the already visible provisional pelvis pose");
            Assert.That(Vector3.Distance(world.BatterHeadWorldPosition, provisionalHead),
                Is.LessThan(0.001f),
                "accepting a no-shot result must begin at the already visible provisional head pose");
            var beforeFirstFrame = world.BatterHeadWorldPosition;
            world.Tick(1.0 / 60.0);
            Assert.That(Vector3.Distance(world.BatterHeadWorldPosition, beforeFirstFrame),
                Is.LessThan(0.08f),
                "the first 60 Hz no-shot blend frame must remain a bounded recovery towards address");
            Assert.That(quietEnds, Is.Zero,
                "a late no-shot result must finish its bounded address blend before outcome UI reveals");
            world.Tick(ProceduralPracticeWorld.CanonicalBodyBlendSeconds - 1.0 / 60.0 - 0.001);
            Assert.That(quietEnds, Is.Zero);
            world.Tick(0.001);
            Assert.That(quietEnds, Is.EqualTo(1),
                "late no-shot outcome timing may start once the complete address reconciliation is visible");
        }

        [Test]
        public void Recovery_StopCancelsOldCompletionAndAllowsACleanNextDelivery()
        {
            root = new GameObject("ProceduralPracticeWorld-RecoveryStopTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "right",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("right"));
            world.BeginDelivery(Delivery());
            var completions = 0;
            world.DeliveryCompleted += (_, __) => completions++;
            world.Tick(2.4);
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = CanonicalTraceTestFixture.Create(),
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('c', 64),
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "auto"
            });
            world.Tick(1.0);
            var canonicalEndTime = world.Timeline;

            Assert.That(world.DeliveryActive, Is.True,
                "the delivery remains active during its unobstructed recovery beat");
            Assert.That(canonicalEndTime, Is.EqualTo(1.0).Within(0.000001));
            world.Stop();
            Assert.That(world.DeliveryActive, Is.False);
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds + 1.0);
            Assert.That(world.Timeline, Is.EqualTo(canonicalEndTime).Within(0.000001),
                "stopping recovery must not mutate the accepted canonical playback time");
            Assert.That(completions, Is.Zero,
                "a stopped recovery must never emit the cancelled delivery's completion");

            world.BeginDelivery(Delivery());
            Assert.That(world.DeliveryActive, Is.True,
                "Stop must leave the world ready for a clean next delivery");
            world.Stop();
            world.Tick(2.0);
            Assert.That(completions, Is.Zero,
                "starting and stopping the next delivery must not resurrect an old completion");
        }

        [Test]
        public void Recovery_PauseFreezesClockAndResumeCompletesExactlyOnce()
        {
            root = new GameObject("ProceduralPracticeWorld-RecoveryPauseTest");
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = "left",
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene("left"));
            world.BeginDelivery(Delivery());
            var completions = 0;
            world.DeliveryCompleted += (_, __) => completions++;
            world.Tick(2.4);
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = CanonicalTraceTestFixture.Create(),
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('d', 64),
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "across"
            });
            world.Tick(1.0);
            var canonicalEndTime = world.Timeline;

            world.SetPaused(true);
            Assert.That(world.DeliveryActive, Is.True,
                "a paused recovery remains the same protected delivery");
            world.Tick(2.0);
            Assert.That(world.Timeline, Is.EqualTo(canonicalEndTime).Within(0.000001),
                "pause must not advance or rewind canonical playback time");
            Assert.That(completions, Is.Zero);

            world.SetPaused(false);
            world.Tick(ProceduralPracticeWorld.DeadBallRecoverySeconds);
            Assert.That(world.Timeline, Is.EqualTo(canonicalEndTime).Within(0.000001),
                "presentation recovery must not extend canonical trace time");
            Assert.That(completions, Is.Zero);
            world.Tick(0.45);
            Assert.That(completions, Is.EqualTo(1));
            world.Tick(2.0);
            Assert.That(completions, Is.EqualTo(1),
                "resume may complete the delivery exactly once, never once per later tick");
            Assert.That(world.Timeline, Is.EqualTo(canonicalEndTime).Within(0.000001));
        }

        // `mirror` is the physics-to-Unity world reflection (owner ruling 2026-11-04): -1 for a right-hander.
        [TestCase("right", -1f)]
        [TestCase("left", 1f)]
        public void CanonicalBatterRoot_IsStaticMirrorsXOncePreservesZAndResetsAtNextBall(
            string handedness,
            float expectedXSign)
        {
            root = new GameObject("ProceduralPracticeWorld-CanonicalRoot-" + handedness);
            var world = root.AddComponent<ProceduralPracticeWorld>();
            world.Configure(new PracticePresentationSettings
            {
                Assistance = "play",
                Handedness = handedness,
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard
            }, new NullPracticeFeedbackSink());
            world.ConfigureScene(Scene(handedness));
            var nominal = world.BatterRootWorldPosition;
            world.BeginDelivery(Delivery());
            world.Tick(2.4);

            var trace = CanonicalTraceTestFixture.Create();
            trace.batterRootOffset = new TraceVector2 { x = 0.06, z = -0.04 };
            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('9', 64),
                PlaybackSpeed = 1,
                IsReplay = false,
                Footwork = "forward"
            });

            // UNITY phase 2 (lead, from TRACKB P1 §6): a live result no longer moves the athlete in one frame. The
            // root is carried continuously from what was on screen and is the full static root by the end of the
            // bounded carry (at the latest the authored contact anchor), latched from then on.
            Assert.That(world.BatterRootWorldPosition, Is.EqualTo(nominal),
                "result acceptance never moves the visible root in the same frame");
            world.Tick(0.001);
            var midway = world.BatterRootWorldPosition - nominal;
            Assert.That(midway.x * expectedXSign, Is.GreaterThan(0f).And.LessThan(0.06f), "carried, not latched");
            Assert.That(midway.z, Is.LessThan(0f).And.GreaterThan(-0.04f));
            world.Tick(0.25);
            Assert.That(world.BatterRootWorldPosition.x,
                Is.EqualTo(nominal.x + expectedXSign * 0.06f).Within(0.000001f),
                "the carry ends at the full static root and mirrors only its lateral component");
            Assert.That(world.BatterRootWorldPosition.z,
                Is.EqualTo(nominal.z - 0.04f).Within(0.000001f),
                "the static root preserves the striker-frame z direction");
            world.Tick(0.25);
            Assert.That(world.BatterRootWorldPosition.x,
                Is.EqualTo(nominal.x + expectedXSign * 0.06f).Within(0.000001f),
                "once carried, the static root stays latched");
            Assert.That(world.BatterRootWorldPosition.z,
                Is.EqualTo(nominal.z - 0.04f).Within(0.000001f));

            world.AcceptResult(new PracticeResultPresentation
            {
                Trace = trace,
                BatterBodyFrame = CanonicalBatterBodyFrame(),
                ReplayDigest = new string('9', 64),
                PlaybackSpeed = 1,
                IsReplay = true,
                Footwork = "forward"
            });
            Assert.That(world.BatterRootWorldPosition.x,
                Is.EqualTo(nominal.x + expectedXSign * 0.06f).Within(0.000001f),
                "replay must synchronously reapply the same static authoritative root");
            Assert.That(world.BatterRootWorldPosition.z,
                Is.EqualTo(nominal.z - 0.04f).Within(0.000001f));

            world.Stop();
            Assert.That(world.BatterRootWorldPosition.x,
                Is.EqualTo(nominal.x + expectedXSign * 0.06f).Within(0.000001f),
                "the accepted result root remains latched through dead-ball/stop presentation");
            Assert.That(world.BatterRootWorldPosition.z,
                Is.EqualTo(nominal.z - 0.04f).Within(0.000001f));
            world.BeginDelivery(Delivery());
            Assert.That(world.BatterRootWorldPosition, Is.EqualTo(nominal),
                "the next ball must always start from its configured nominal root");
        }

        private static PracticeBatterBodyFramePresentation CanonicalBatterBodyFrame()
        {
            return new PracticeBatterBodyFramePresentation
            {
                Stance = new TraceVector2 { x = -0.15, z = 8.96 },
                TorsoTop = Vector(-0.3, 1.42, 8.94),
                HeadCentre = Vector(-0.2, 1.62, 8.86)
            };
        }

        private static Vande.Practice.Trace.TraceVector3 Vector(double x, double y, double z)
        {
            return new Vande.Practice.Trace.TraceVector3 { x = x, y = y, z = z };
        }

        private PracticeScenePresentation Scene(string handedness)
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
                fielders[index] = new PracticeFielderPresentation
                    {
                        Id = "fielder-" + index,
                        Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "point",
                        X = index - 5,
                        Z = index * 2
                    };
            return new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "red",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = handedness
            };
        }

        private static PracticeDeliveryPresentation Delivery()
        {
            return new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new Vande.Practice.Trace.BallTraceSample
                        { t = 0, p = Vector(0, 2, -8), v = Vector(0, -1, 35) },
                    new Vande.Practice.Trace.BallTraceSample
                        { t = 1, p = Vector(0, 0.4, 9), v = Vector(0, 0, 20) }
                },
                SeamAxis = Vector(0, 1, 0),
                ShineDirection = Vector(1, 0, 0),
                SpinAxis = Vector(0, 1, 0),
                SpinRps = 10
            };
        }

        private static void CaptureHeldLateralStraightReversal(VandeTouchInputCapture capture)
        {
            capture.CaptureDown("touch", 8, 100, 100, 600, 400, 800);
            capture.CaptureMove(8, 125, 100, 680);
            capture.CaptureMove(8, 225, 150, 680);
            capture.CaptureMove(8, 255, 150, 645);
            capture.CaptureMove(8, 295, 150, 575);
            capture.CaptureUp(8, 315, 150, 560);
        }

        private static void CaptureIdenticalSwipe(VandeTouchInputCapture capture)
        {
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            capture.CaptureDown("touch", 9, 100, 120, 700, 400, 800);
            capture.CaptureMove(9, 110, 150, 670);
            capture.CaptureUp(9, 120, 190, 630);
        }

        private Transform Child(string name)
        {
            var values = root.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < values.Length; index++)
                if (values[index].name == name) return values[index];
            Assert.Fail("Missing Practice presentation object " + name + ".");
            return null;
        }

        private static Transform Descendant(Transform parent, string name)
        {
            var values = parent.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < values.Length; index++)
                if (values[index].name == name) return values[index];
            Assert.Fail("Missing production child " + name + " under " + parent.name + ".");
            return null;
        }

        private static int VisibleTriangleCount(GameObject character)
        {
            var result = 0;
            var renderers = character.GetComponentsInChildren<Renderer>(true);
            for (var rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
            {
                var renderer = renderers[rendererIndex];
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                Mesh mesh = null;
                var skinned = renderer as SkinnedMeshRenderer;
                if (skinned != null) mesh = skinned.sharedMesh;
                else
                {
                    var filter = renderer.GetComponent<MeshFilter>();
                    if (filter != null) mesh = filter.sharedMesh;
                }
                if (mesh == null) continue;
                for (var subMesh = 0; subMesh < mesh.subMeshCount; subMesh++)
                    result += checked((int)(mesh.GetIndexCount(subMesh) / 3));
            }
            return result;
        }

        private sealed class NullPracticeFeedbackSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }

    }
}
