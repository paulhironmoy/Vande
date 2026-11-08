using NUnit.Framework;
using UnityEngine;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionHudLayoutTests
    {
        [Test]
        public void LockedReferenceViewport_UsesOneCompactTopRadarWithPauseBelow()
        {
            var layout = ProductionHudLayout.Calculate(
                844, 390, new Rect(0f, 0f, 844f, 390f), 160f, 1f);

            Assert.That(layout.FieldPip, Is.EqualTo(new Rect(750f, 296f, 84f, 84f)));
            Assert.That(layout.Pause, Is.EqualTo(new Rect(786f, 242f, 48f, 48f)));
            Assert.That(layout.Score, Is.EqualTo(new Rect(10f, 334f, 126f, 46f)));
            // Wedge phase 3: the conditions rail holds its two lines at the requested 10.5 dp in both licensed fonts
            // (2 x 1.48 x 10.5 + 6 = 37.08 dp; the TextMesh-era 28 dp could not), and the caption sits below the
            // setup target's 48 dp hit area so a caption never covers that control.
            AssertRect(layout.Conditions, new Rect(10f, 290.92f, 146f, 37.08f));
            AssertRect(layout.Caption, new Rect(10f, 243.46f, 146f, 36f));
            Assert.That(layout.Caption.Overlaps(layout.SetupBriefTarget), Is.False);
            AssertContains(layout.Score, layout.Timeline);
            Assert.That(layout.FieldPip.Overlaps(layout.Pause), Is.False);
        }

        [Test]
        public void Layout_RespectsSafeAreaAndDensityCorrectPauseTarget()
        {
            var safe = new Rect(80f, 24f, 2240f, 1032f);
            var layout = ProductionHudLayout.Calculate(2400, 1080, safe, 320f, 1f);

            Assert.That(layout.Pause.width, Is.EqualTo(96f).Within(0.001f));
            Assert.That(layout.Pause.height, Is.EqualTo(96f).Within(0.001f));
            AssertInside(layout.Pause, safe);
            AssertInside(layout.Score, safe);
            AssertInside(layout.Timeline, safe);
            AssertInside(layout.Conditions, safe);
            AssertInside(layout.Caption, safe);
            AssertInside(layout.SetupBriefTarget, safe);
            AssertInside(layout.SetupBriefSurface, safe);
            AssertInside(layout.SetupBriefCopy, layout.SetupBriefSurface);
            AssertInside(layout.SetupBriefClose, layout.SetupBriefSurface);
            AssertInside(layout.FieldPip, safe);
            AssertInside(layout.Outcome, safe);
            AssertInside(layout.DeadBallSurface, safe);
            AssertInside(layout.DeadBallPrimaryAction, layout.DeadBallSurface);
            AssertInside(layout.DeadBallPrimaryActionWithSecondary, layout.DeadBallSurface);
            AssertInside(layout.DeadBallSecondaryAction, layout.DeadBallSurface);
            Assert.That(layout.DeadBallPrimaryAction.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.DeadBallSecondaryAction.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.width,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.DeadBallSecondaryAction.width,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.SetupBriefTarget.width,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.SetupBriefTarget.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.SetupBriefClose.width,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.SetupBriefClose.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            AssertContains(layout.Score, layout.Timeline);
        }

        [Test]
        public void Layout_AtTwoHundredPercent_KeepsPeripheralRegionsSeparate()
        {
            var safe = new Rect(0f, 0f, 1280f, 720f);
            var layout = ProductionHudLayout.Calculate(1280, 720, safe, 320f, 2f);

            Assert.That(layout.Score.Overlaps(layout.FieldPip), Is.False);
            Assert.That(layout.Timeline.Overlaps(layout.FieldPip), Is.False);
            AssertContains(layout.Score, layout.Timeline);
            Assert.That(layout.Conditions.Overlaps(layout.FieldPip), Is.False);
            Assert.That(layout.Caption.Overlaps(layout.Conditions), Is.False);
            Assert.That(layout.Caption.Overlaps(layout.FieldPip), Is.False);
            AssertInside(layout.Outcome, safe);
            AssertInside(layout.DeadBallSurface, safe);
            AssertInside(layout.DeadBallOutcome, layout.DeadBallSurface);
            AssertInside(layout.DeadBallReason, layout.DeadBallSurface);
            AssertInside(layout.DeadBallRecommendation, layout.DeadBallSurface);
            Assert.That(layout.Outcome.xMax, Is.LessThanOrEqualTo(safe.center.x));
            Assert.That(layout.DeadBallSurface.xMax, Is.LessThanOrEqualTo(safe.center.x));
            Assert.That(layout.Outcome.Overlaps(layout.FieldPip), Is.False);
        }

        [TestCase(640, 360)]
        [TestCase(844, 390)]
        [TestCase(915, 412)]
        [TestCase(1280, 800)]
        [TestCase(1920, 1080)]
        public void LockedLandscapeViewports_KeepMandatoryChromePeripheralAtTwoHundredPercent(
            int width,
            int height)
        {
            var safe = new Rect(0f, 0f, width, height);
            var layout = ProductionHudLayout.Calculate(width, height, safe, 160f, 2f);

            AssertInside(layout.Score, safe);
            AssertInside(layout.Timeline, safe);
            AssertInside(layout.Conditions, safe);
            AssertInside(layout.Caption, safe);
            AssertInside(layout.FieldPip, safe);
            AssertInside(layout.Pause, safe);
            AssertContains(layout.Score, layout.Timeline);
            Assert.That(layout.Timeline.Overlaps(layout.Conditions), Is.False);
            Assert.That(layout.Conditions.Overlaps(layout.Caption), Is.False);
            Assert.That(layout.FieldPip.Overlaps(layout.Pause), Is.False);
            Assert.That(layout.Conditions.xMax, Is.LessThan(safe.center.x));
            Assert.That(layout.Caption.xMax, Is.LessThan(safe.center.x));
        }

        [Test]
        public void HighDensitySmallViewport_CapsVisualScaleBeforePeripheralRegionsOverlap()
        {
            var safe = new Rect(0f, 0f, 640f, 360f);
            var layout = ProductionHudLayout.Calculate(640, 360, safe, 480f, 2f);

            Assert.That(layout.DpScale, Is.LessThan(3f));
            AssertInside(layout.Caption, safe);
            AssertContains(layout.Score, layout.Timeline);
            Assert.That(layout.Timeline.Overlaps(layout.Conditions), Is.False);
            Assert.That(layout.Conditions.Overlaps(layout.Caption), Is.False);
            Assert.That(layout.Pause.width, Is.GreaterThanOrEqualTo(48f * layout.DpScale));
            AssertInside(layout.DeadBallSurface, safe);
            Assert.That(layout.DeadBallPrimaryAction.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.DeadBallSecondaryAction.height,
                Is.GreaterThanOrEqualTo(48f * layout.TouchDpScale));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.width,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.height,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallSecondaryAction.width,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallSecondaryAction.height,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefTarget.width, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefTarget.height, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefClose.width, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefClose.height, Is.GreaterThanOrEqualTo(143.99f));
            AssertInside(layout.SetupBriefTarget, safe);
            AssertInside(layout.SetupBriefSurface, safe);
            AssertInside(layout.SetupBriefCopy, layout.SetupBriefSurface);
            AssertInside(layout.SetupBriefClose, layout.SetupBriefSurface);
            Assert.That(layout.DeadBallActionsStacked, Is.False,
                "the dead-ball surface should expand before stacking when both 48 dp targets fit horizontally");
        }

        [Test]
        public void NarrowDeadBallSurface_StacksBothDensityCorrectActionTargets()
        {
            var safe = new Rect(0f, 0f, 170f, 420f);
            var layout = ProductionHudLayout.Calculate(170, 420, safe, 160f, 2f);

            Assert.That(layout.DeadBallActionsStacked, Is.True);
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.width, Is.GreaterThanOrEqualTo(48f));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.height, Is.GreaterThanOrEqualTo(48f));
            Assert.That(layout.DeadBallSecondaryAction.width, Is.GreaterThanOrEqualTo(48f));
            Assert.That(layout.DeadBallSecondaryAction.height, Is.GreaterThanOrEqualTo(48f));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.yMin,
                Is.GreaterThan(layout.DeadBallSecondaryAction.yMax));
            AssertInside(layout.DeadBallPrimaryActionWithSecondary, layout.DeadBallSurface);
            AssertInside(layout.DeadBallSecondaryAction, layout.DeadBallSurface);
        }

        [Test]
        public void AuthoritativeAndroidDensity_WinsWhenUnityScreenDpiIsUnknown()
        {
            var safe = new Rect(0f, 0f, 640f, 360f);
            var layout = ProductionHudLayout.Calculate(640, 360, safe, 0f, 2f, 3f);

            Assert.That(layout.TouchDpScale, Is.EqualTo(3f));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.width,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallPrimaryActionWithSecondary.height,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallSecondaryAction.width,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.DeadBallSecondaryAction.height,
                Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefTarget.width, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefTarget.height, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefClose.width, Is.GreaterThanOrEqualTo(143.99f));
            Assert.That(layout.SetupBriefClose.height, Is.GreaterThanOrEqualTo(143.99f));
            AssertInside(layout.SetupBriefSurface, safe);
            AssertInside(layout.SetupBriefClose, layout.SetupBriefSurface);
        }

        [Test]
        public void Layout_InvalidReportedSafeArea_FallsBackToWholeViewport()
        {
            var layout = ProductionHudLayout.Calculate(
                1280, 720,
                new Rect(float.NaN, 0f, 0f, 0f),
                0f,
                1f);

            Assert.That(layout.SafeArea, Is.EqualTo(new Rect(0f, 0f, 1280f, 720f)));
            Assert.That(layout.DpScale, Is.GreaterThanOrEqualTo(1f));
            Assert.That(layout.TouchDpScale,
                Is.EqualTo(ProductionHudLayout.PixelsPerDp(0f)).Within(0.001f));
            Assert.That(layout.Pause.width,
                Is.EqualTo(ProductionHudLayout.PauseTargetDp * layout.TouchDpScale).Within(0.001f));
            AssertInside(layout.Pause, layout.SafeArea);
        }

        [Test]
        public void FieldProjection_MirrorsOnlyHorizontalAxisForLeftHandedPresentation()
        {
            var bounds = new Rect(100f, 50f, 300f, 180f);
            var right = ProductionFieldPipProjection.Project(30d, 24d, false, bounds);
            var left = ProductionFieldPipProjection.Project(30d, 24d, true, bounds);

            Assert.That(left.x, Is.EqualTo(bounds.center.x * 2f - right.x).Within(0.001f));
            Assert.That(left.y, Is.EqualTo(right.y).Within(0.001f));
        }

        [Test]
        public void FieldProjection_ClampsEveryMarkerInsideFullFieldBounds()
        {
            var bounds = new Rect(20f, 30f, 200f, 120f);
            var point = ProductionFieldPipProjection.Project(900d, -900d, false, bounds);

            // Off side right; the bowler's end (physics -z) at the top, like the rear batting view (2026-11-04).
            Assert.That(point.x, Is.EqualTo(bounds.xMax));
            Assert.That(point.y, Is.EqualTo(bounds.yMax));
        }

        private static void AssertInside(Rect value, Rect container)
        {
            Assert.That(value.xMin, Is.GreaterThanOrEqualTo(container.xMin));
            Assert.That(value.yMin, Is.GreaterThanOrEqualTo(container.yMin));
            Assert.That(value.xMax, Is.LessThanOrEqualTo(container.xMax));
            Assert.That(value.yMax, Is.LessThanOrEqualTo(container.yMax));
        }

        private static void AssertContains(Rect container, Rect value)
        {
            AssertInside(value, container);
        }

        private static void AssertRect(Rect actual, Rect expected)
        {
            Assert.That(actual.x, Is.EqualTo(expected.x).Within(0.01f), "x");
            Assert.That(actual.y, Is.EqualTo(expected.y).Within(0.01f), "y");
            Assert.That(actual.width, Is.EqualTo(expected.width).Within(0.01f), "width");
            Assert.That(actual.height, Is.EqualTo(expected.height).Within(0.01f), "height");
        }
    }
}
