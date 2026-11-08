using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Input;

namespace Vande.Practice.Tests
{
    public sealed class UnityPressFootworkTests
    {
        private GameObject owner;

        [TearDown]
        public void TearDown()
        {
            if (owner != null) Object.DestroyImmediate(owner);
        }

        [Test]
        public void PurePressBands_MatchTheRetainedInputContractExactly()
        {
            Assert.That(PracticeFootworkSelection.FromPress(37.9, 100), Is.EqualTo("forward"));
            Assert.That(PracticeFootworkSelection.FromPress(38, 100), Is.EqualTo("auto"));
            Assert.That(PracticeFootworkSelection.FromPress(62, 100), Is.EqualTo("auto"));
            Assert.That(PracticeFootworkSelection.FromPress(62.1, 100), Is.EqualTo("back"));
            Assert.That(PracticeFootworkSelection.ManualSelectionAvailable("real"), Is.True);
            Assert.That(PracticeFootworkSelection.ManualSelectionAvailable("learn"), Is.False);
            Assert.That(PracticeFootworkSelection.ManualSelectionAvailable("play"), Is.False);
        }

        [Test]
        public void Real_UsesPressOriginForForwardAutoAndBackWithoutASeparateControl()
        {
            StringAssert.Contains("\"footwork\":\"forward\"", CaptureGesture("real", 0.20));
            StringAssert.Contains("\"footwork\":\"auto\"", CaptureGesture("real", 0.50));
            StringAssert.Contains("\"footwork\":\"back\"", CaptureGesture("real", 0.80));
        }

        [Test]
        public void LearnAndPlay_StayAutomaticAtBothPressExtremes()
        {
            StringAssert.Contains("\"footwork\":\"auto\"", CaptureGesture("learn", 0.20));
            StringAssert.Contains("\"footwork\":\"auto\"", CaptureGesture("learn", 0.80));
            StringAssert.Contains("\"footwork\":\"auto\"", CaptureGesture("play", 0.20));
            StringAssert.Contains("\"footwork\":\"auto\"", CaptureGesture("play", 0.80));
        }

        [Test]
        public void FootworkIntent_DoesNotRewriteRawSamplesOrTimestamps()
        {
            var automatic = CaptureGesture("play", 0.20);
            var forward = CaptureGesture("real", 0.20);

            Assert.That(
                forward.Replace("\"footwork\":\"forward\"", "\"footwork\":\"auto\""),
                Is.EqualTo(automatic));
        }

        [Test]
        public void RestingPointer_UsesItsReleaseRestOriginWhenMovementBegins()
        {
            var gestures = new List<string>();
            owner = new GameObject("Resting press footwork test");
            var capture = owner.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.ConfigureAssistance("real");
            capture.BeginDelivery();
            capture.MarkReleaseReached(new[] { 7 }, false);

            // Batting area is y=432..800. The release/rest origin is in its
            // upper band, while the first moving sample travels into the lower
            // band. The origin, not the destination, must request front foot.
            capture.CaptureRestingMove("touch", 7, 100, 100, 500, 400, 800);
            capture.CaptureRestingMove("touch", 7, 200, 150, 700, 400, 800);
            capture.CaptureMove(7, 340, 210, 640);
            Assert.That(gestures, Is.Empty,
                "native capture remains raw until the continuous contact lifts");
            capture.CaptureUp(7, 360, 220, 630);

            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.Contains("\"footwork\":\"forward\"", gestures[0]);
            StringAssert.DoesNotContain("down_track", gestures[0]);
        }

        private string CaptureGesture(string assistance, double relativeY)
        {
            if (owner != null) Object.DestroyImmediate(owner);
            owner = new GameObject("Press footwork wire test");
            var gestures = new List<string>();
            var capture = owner.AddComponent<VandeTouchInputCapture>();
            capture.Configure((_, __, ___) => { }, gestures.Add, _ => { }, () => { },
                _ => Assert.Fail("Input capture failed."));
            capture.ConfigureAssistance(assistance);
            capture.BeginDelivery();
            capture.MarkReleaseReached(new int[0], false);
            const double battingTop = 432.0;
            const double battingHeight = 368.0;
            var y = battingTop + battingHeight * relativeY;
            capture.CaptureDown("touch", 1, 100, 100, y, 400, 800);
            capture.CaptureUp(1, 140, 130, y - 30);
            Assert.That(gestures, Has.Count.EqualTo(1));
            StringAssert.DoesNotContain("down_track", gestures[0]);
            return gestures[0];
        }
    }
}
