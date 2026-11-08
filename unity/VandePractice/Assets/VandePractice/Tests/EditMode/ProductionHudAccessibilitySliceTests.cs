using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Deterministic Stage-1 evidence for the Unity-owned live-ball rail. These
    /// tests measure retained pixel geometry and state; they are not human
    /// accessibility, typography-shaping or visual-quality certification.
    /// </summary>
    public sealed class ProductionHudAccessibilitySliceTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("Production HUD accessibility slice");
            view = owner.AddComponent<ProductionHudView>();
            view.SetViewportForTesting(844, 390, new Rect(0f, 0f, 844f, 390f), 160f);
            view.Configure(Settings());
            view.SetScene(Scene());
        }

        [TearDown]
        public void TearDown()
        {
            if (owner != null) Object.DestroyImmediate(owner);
        }

        [Test]
        public void SetupRail_IncludesCanonicalPaceBandWithoutDeliveryDisclosure()
        {
            Assert.That(view.ConditionsText, Does.Contain("Fast"));
            Assert.That(view.ConditionsText, Does.Not.Contain("Yorker"));
            Assert.That(view.ConditionsText, Does.Not.Contain("Bouncer"));
        }

        [TestCase(844, 390, 160f)]
        [TestCase(915, 412, 160f)]
        [TestCase(2400, 1080, 420f)]
        public void LiveBallRail_UsesLessThanEightPercentAndKeepsTheWorldDominant(
            int width,
            int height,
            float dpi)
        {
            var safe = new Rect(0f, 0f, width, height);
            var current = ProductionHudLayout.Calculate(width, height, safe, dpi, 1f);
            var occupied = Area(current.Score) + Area(current.Conditions) + Area(current.FieldPip) +
                           Area(current.Pause);

            Assert.That(occupied / Area(safe), Is.LessThanOrEqualTo(0.08f),
                "the constitutional live-ball rail must not become a dashboard");
            Assert.That(current.Score.Overlaps(current.FieldPip), Is.False);
            Assert.That(current.Timeline.Overlaps(current.FieldPip), Is.False);
            AssertInside(current.Timeline, current.Score);
            Assert.That(current.Conditions.Overlaps(current.FieldPip), Is.False);
        }

        [TestCase(844, 390, 160f)]
        [TestCase(915, 412, 420f)]
        [TestCase(2400, 1080, 420f)]
        public void PauseTarget_UsesUncappedDeviceDensityAndRemainsInsideSafeArea(
            int width,
            int height,
            float dpi)
        {
            var safe = new Rect(0f, 0f, width, height);
            var current = ProductionHudLayout.Calculate(width, height, safe, dpi, 2f);
            var minimumPixels = ProductionHudLayout.PauseTargetDp *
                                ProductionHudLayout.PixelsPerDp(dpi);

            Assert.That(current.TouchDpScale,
                Is.EqualTo(ProductionHudLayout.PixelsPerDp(dpi)).Within(0.001f));
            Assert.That(current.Pause.width, Is.GreaterThanOrEqualTo(minimumPixels));
            Assert.That(current.Pause.height, Is.GreaterThanOrEqualTo(minimumPixels));
            AssertInside(current.Pause, safe);
            Assert.That(current.Pause.Overlaps(current.FieldPip), Is.False);
        }

        [Test]
        public void CutoutSafeArea_ContainsEveryLiveRegionAtTwoHundredPercentText()
        {
            var safe = new Rect(44f, 20f, 847f, 372f);
            var current = ProductionHudLayout.Calculate(915, 412, safe, 160f, 2f);

            AssertInside(current.Score, safe);
            AssertInside(current.Timeline, safe);
            AssertInside(current.Conditions, safe);
            AssertInside(current.Caption, safe);
            AssertInside(current.FieldPip, safe);
            AssertInside(current.Pause, safe);
            AssertInside(current.Timeline, current.Score);
            Assert.That(current.Timeline.Overlaps(current.Conditions), Is.False);
            Assert.That(current.Conditions.Overlaps(current.Caption), Is.False);
            Assert.That(current.FieldPip.Overlaps(current.Pause), Is.False);
        }

        [Test]
        public void PortraitInterruption_KeepsRetainedTargetsSafeWithoutInventingASecondLayout()
        {
            var safe = new Rect(20f, 44f, 372f, 827f);
            var current = ProductionHudLayout.Calculate(412, 915, safe, 160f, 1f);

            AssertInside(current.Score, safe);
            AssertInside(current.Timeline, safe);
            AssertInside(current.Conditions, safe);
            AssertInside(current.Caption, safe);
            AssertInside(current.FieldPip, safe);
            AssertInside(current.Pause, safe);
            Assert.That(current.Score.Overlaps(current.FieldPip), Is.False);
            Assert.That(current.FieldPip.Overlaps(current.Pause), Is.False);
        }

        [TestCase(844, 390, 160f)]
        [TestCase(915, 412, 160f)]
        [TestCase(2400, 1080, 420f)]
        public void TwoHundredPercentText_OccupiesContainedNonOverlappingPixelGeometry(
            int width,
            int height,
            float dpi)
        {
            view.SetViewportForTesting(width, height, new Rect(0f, 0f, width, height), dpi);
            view.SetTextScale(2f);
            view.SetScore(128, 3, 5);
            view.SetDelivery(0, 5);
            view.SetQuiet(true);
            view.PresentCaption("Outside edge caught behind");

            var score = TextRect("Score Text");
            var over = TextRect("Over Text");
            var conditions = TextRect("Conditions Text");
            var caption = TextRect("Caption Text");
            var currentBall = TextRect("Ball 6 Text");

            Assert.That(Area(score), Is.GreaterThan(1f));
            Assert.That(Area(over), Is.GreaterThan(1f));
            Assert.That(Area(conditions), Is.GreaterThan(1f));
            Assert.That(Area(caption), Is.GreaterThan(1f));
            Assert.That(Area(currentBall), Is.GreaterThan(1f));
            AssertInside(score, view.CurrentLayout.Score, 1f);
            AssertInside(over, view.CurrentLayout.Score, 1f);
            AssertInside(conditions, view.CurrentLayout.Conditions, 1f);
            // The caption rail the HUD draws (it grows with wrapped copy; wedge phase 3 ruling).
            AssertInside(caption, view.CaptionPixels, 1f);
            AssertInside(view.CaptionPixels, new Rect(0f, 0f, width, height), 1f);
            AssertInside(currentBall, view.CurrentLayout.Timeline, 1f);
            Assert.That(score.Overlaps(over), Is.False,
                "score/wickets and over.ball must remain independently legible");
            Assert.That(Label("Caption Text").text, Does.Contain("\n"),
                "long causal captions should wrap in their peripheral rail, not cross the ball corridor");
        }

        [Test]
        public void QuietResolution_DoesNotPreRevealThroughTimelineOrOutcomePixels()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            Assert.That(Label("Ball 1 Text").text, Is.EqualTo("•"));

            view.SetOutcome(6, null);

            Assert.That(Label("Ball 1 Text").text, Is.EqualTo("•"),
                "the resolved marker must remain current until the world declares dead ball");
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.False);
            Assert.That(LabelVisible("Outcome Text"), Is.False);

            view.SetQuiet(false);

            Assert.That(Label("Ball 1 Text").text, Is.EqualTo("6"),
                "the visible number makes boundary state independent of colour");
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.True);
            Assert.That(LabelVisible("Outcome Text"), Is.True);
        }

        [Test]
        public void CaptionsAndDeadBallOutcome_WriteTheirActualRetainedGlyphs()
        {
            view.SetQuiet(true);
            view.PresentCaption("Clean bat contact");
            Assert.That(Label("Caption Text").text, Is.EqualTo("Clean bat contact"));
            Assert.That(Area(TextRect("Caption Text")), Is.GreaterThan(1f));

            view.SetDelivery(0, 0);
            view.SetOutcome(0, "bowled");
            Assert.That(LabelVisible("Outcome Text"), Is.False);
            view.SetReducedMotion(true);
            view.SetQuiet(false);

            Assert.That(Label("Outcome Text").text, Is.EqualTo("OUT"));
            Assert.That(Area(TextRect("Outcome Text")), Is.GreaterThan(1f));
        }

        [Test]
        public void QuietMode_LeavesOnlyConstitutionalLiveHudSurfacesVisible()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetOutcome(4, null);

            Assert.That(view.ScoreVisible, Is.True);
            Assert.That(Find("Six Ball Timeline").activeSelf, Is.True);
            Assert.That(view.ConditionsVisible, Is.True);
            Assert.That(view.FieldPipVisible, Is.True);
            Assert.That(view.PauseVisible, Is.True);
            Assert.That(view.OutcomeVisible, Is.False);
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.False);
            Assert.That(LabelVisible("Outcome Text"), Is.False);
        }

        // Wedge phase 3: HUD text is UI Toolkit; its rectangle is the measured shaped text in its host.
        private UnityEngine.UIElements.Label Label(string name) => HudLabelProbe.Label(owner, name);

        private Rect TextRect(string name) => HudLabelProbe.TextRect(Label(name));

        private bool LabelVisible(string name) => HudLabelProbe.Visible(Label(name));

        private GameObject Find(string name)
        {
            var transforms = owner.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
            {
                if (transforms[index].gameObject.name == name)
                    return transforms[index].gameObject;
            }
            Assert.Fail("Missing retained HUD object: " + name);
            return null;
        }

        private Rect RendererRect(string name)
        {
            var renderer = Find(name).GetComponent<MeshRenderer>();
            Assert.That(renderer, Is.Not.Null, "Missing retained renderer: " + name);
            var bounds = renderer.bounds;
            return Rect.MinMaxRect(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        }

        private static float Area(Rect value)
        {
            return Mathf.Max(0f, value.width) * Mathf.Max(0f, value.height);
        }

        private static void AssertInside(Rect value, Rect container, float tolerance = 0.001f)
        {
            Assert.That(value.xMin, Is.GreaterThanOrEqualTo(container.xMin - tolerance));
            Assert.That(value.yMin, Is.GreaterThanOrEqualTo(container.yMin - tolerance));
            Assert.That(value.xMax, Is.LessThanOrEqualTo(container.xMax + tolerance));
            Assert.That(value.yMax, Is.LessThanOrEqualTo(container.yMax + tolerance));
        }

        private static PracticePresentationSettings Settings()
        {
            return new PracticePresentationSettings
            {
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard,
                Assistance = "play",
                Handedness = "right",
                ReducedMotion = false,
                Captions = true,
                Audio = true,
                Haptics = true
            };
        }

        private static PracticeScenePresentation Scene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder-" + (index - 1),
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder",
                    X = -45d + index * 9d,
                    Z = -38d + index * 7d
                };
            }

            return new PracticeScenePresentation
            {
                Conditions = "green",
                BowlerFamily = "pace",
                BowlerArm = "right",
                BowlerPaceBand = "fast",
                BallColour = "white",
                BallAge = "new",
                Handedness = "right",
                BatterLateralM = 0.2d,
                BatterCreaseOffsetM = 0.1d,
                Fielders = fielders
            };
        }
    }
}
