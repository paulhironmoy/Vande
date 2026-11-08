using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Pixel-contract checks for the Stage-1 HUD reconstruction. These tests
    /// prove retained geometry and state only; they are not a visual-quality
    /// score, human accessibility result or device certification.
    /// </summary>
    public sealed class HudReconstructionContractTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("HUD reconstruction contract");
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
        public void FrozenReference_UsesCompactGateAGeometryAndIntegratedProgress()
        {
            var current = view.CurrentLayout;

            Assert.That(current.Score,
                Is.EqualTo(new Rect(10f, 334f, 126f, 46f)));
            // Wedge phase 3: two conditions lines at the requested size in both licensed fonts (see ProductionHudLayout).
            Assert.That(current.Conditions.x, Is.EqualTo(10f).Within(0.01f));
            Assert.That(current.Conditions.y, Is.EqualTo(290.92f).Within(0.01f));
            Assert.That(current.Conditions.width, Is.EqualTo(146f).Within(0.01f));
            Assert.That(current.Conditions.height, Is.EqualTo(37.08f).Within(0.01f));
            Assert.That(current.FieldPip,
                Is.EqualTo(new Rect(750f, 296f, 84f, 84f)));
            Assert.That(current.Pause,
                Is.EqualTo(new Rect(786f, 242f, 48f, 48f)));
            AssertInside(current.Timeline, current.Score);
            Assert.That(current.Timeline.Overlaps(current.Conditions), Is.False);

            var scorePanel = RendererRect("Score");
            var scoreFrame = RendererRect("Score Frame");
            var scoreShadow = RendererRect("Score Shadow");
            AssertContains(scoreFrame, scorePanel);
            Assert.That(scoreShadow.center.y, Is.LessThan(scorePanel.center.y));
        }

        [Test]
        public void CutoutSafeArea_ContainsEveryReconstructedOuterFrameAndHitTarget()
        {
            var safe = new Rect(44f, 20f, 847f, 372f);
            view.SetViewportForTesting(915, 412, safe, 160f);
            view.SetTextScale(2f);

            AssertInside(RendererRect("Score Frame"), safe);
            AssertInside(RendererRect("Conditions Frame"), safe);
            AssertInside(RendererRect("Field PIP Frame"), safe);
            AssertInside(RendererRect("Pause Frame"), safe);
            AssertInside(view.PauseTargetPixels, safe);
            Assert.That(view.PauseTargetPixels.width, Is.GreaterThanOrEqualTo(48f));
            Assert.That(view.FieldPipPixels.Overlaps(view.PauseTargetPixels), Is.False);
        }

        [Test]
        public void QuietMode_KeepsTruthRailStableAndSuppressesDeadBallChrome()
        {
            view.SetDelivery(0, 0);
            view.SetScore(0, 0, 0);
            view.SetQuiet(true);
            view.SetOutcome(6, null);
            var scoreBefore = RendererRect("Score");
            var pipBefore = RendererRect("Field PIP");

            view.AdvancePresentation(5f);

            Assert.That(RendererRect("Score"), Is.EqualTo(scoreBefore));
            Assert.That(RendererRect("Field PIP"), Is.EqualTo(pipBefore));
            Assert.That(Find("Dead Ball Outcome").activeSelf, Is.False);
            Assert.That(Find("Dead Ball Outcome Frame").activeSelf, Is.False);
            Assert.That(Find("Dead Ball Outcome Shadow").activeSelf, Is.False);
            Assert.That(HudLabelProbe.Label(owner, "Ball 1 Text").text, Is.EqualTo("•"));
            Assert.That(view.ScoreVisible, Is.True);
            Assert.That(view.FieldPipVisible, Is.True);
            Assert.That(view.PauseVisible, Is.True);
        }

        [TestCase("en-IN", "Green", "Right pace")]
        [TestCase("hi", "हरी", "दायाँ पेस")]
        [TestCase("hi-Latn", "Hari", "Daaya pace")]
        [TestCase("bn", "Green", "Right pace")]
        public void LocaleCopy_AtTwoHundredPercentRemainsInsideCompactConditionsRail(
            string locale,
            string expectedSurface,
            string expectedBowler)
        {
            view.SetTextScale(2f);
            view.SetLocale(locale);

            Assert.That(view.ConditionsText, Does.Contain(expectedSurface));
            Assert.That(view.ConditionsText, Does.Contain(expectedBowler));
            var conditionsLabel = HudLabelProbe.Label(owner, "Conditions Text");
            Assert.That(HudLabelProbe.Visible(conditionsLabel), Is.True);
            Assert.That(conditionsLabel.text, Is.EqualTo(view.ConditionsText));
            Assert.That(HudLabelProbe.Area(TextRect("Conditions Text")), Is.GreaterThan(1f));
            AssertInside(TextRect("Conditions Text"), view.CurrentLayout.Conditions, 1f);
        }

        [Test]
        public void DeadBallGuidance_WaitsForCommittedOutcomeAndHidesInQuietAndReplay()
        {
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetDeadBallGuidance(
                "Reading delivery",
                string.Empty,
                ProductionHudView.NextBallAction,
                "Next ball");

            Assert.That(view.DeadBallGuidanceConfigured, Is.True);
            Assert.That(view.DeadBallGuidanceVisible, Is.False);
            Assert.That(Find("Dead Ball Primary Action").activeSelf, Is.False);

            view.SetQuiet(true);
            view.SetOutcome(4, null);
            Assert.That(view.DeadBallGuidanceVisible, Is.False);

            view.SetQuiet(false);
            Assert.That(view.DeadBallGuidanceVisible, Is.True);
            Assert.That(view.DeadBallActionsEnabled, Is.True);
            Assert.That(Find("Dead Ball Primary Action").activeSelf, Is.True);
            Assert.That(LabelVisible("Dead Ball Recommendation Text"), Is.False);

            view.SetReplayPresentation(true);
            Assert.That(view.DeadBallGuidanceVisible, Is.False);
            Assert.That(Find("Dead Ball Primary Action").activeSelf, Is.False);

            view.SetReplayPresentation(false);
            Assert.That(view.DeadBallGuidanceVisible, Is.True);
        }

        [Test]
        public void DeadBallActions_ExposeBothIdentifiersAndConsumeBothAfterOneTap()
        {
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetDeadBallGuidance(
                "Late contact",
                "Release the gesture earlier",
                ProductionHudView.PracticeBallAction,
                "Practice this ball",
                ProductionHudView.NextBallAction,
                "Next ball");
            view.SetOutcome(0, null);
            var requested = string.Empty;
            var requestCount = 0;
            view.DeadBallActionRequested += value =>
            {
                requested = value;
                requestCount++;
                return true;
            };

            Assert.That(view.DeadBallPrimaryActionTargetPixels.height,
                Is.GreaterThanOrEqualTo(48f * view.CurrentLayout.TouchDpScale));
            Assert.That(view.DeadBallSecondaryActionTargetPixels.height,
                Is.GreaterThanOrEqualTo(48f * view.CurrentLayout.TouchDpScale));
            Assert.That(view.TryRequestDeadBallActionAt(
                view.DeadBallSecondaryActionTargetPixels.center), Is.True);
            Assert.That(requested, Is.EqualTo(ProductionHudView.NextBallAction));
            Assert.That(requestCount, Is.EqualTo(1));
            Assert.That(view.DeadBallActionConsumed, Is.True);
            Assert.That(view.DeadBallActionsEnabled, Is.False);
            Assert.That(view.TryRequestDeadBallActionAt(
                view.DeadBallPrimaryActionTargetPixels.center), Is.False);
            Assert.That(requestCount, Is.EqualTo(1));

            view.SetDeadBallGuidance(
                "Late contact",
                "Updated analysis",
                ProductionHudView.PracticeBallAction,
                "Practice this ball",
                ProductionHudView.NextBallAction,
                "Next ball");
            Assert.That(view.DeadBallActionConsumed, Is.True,
                "a late insight update must not re-enable an already consumed action row");
        }

        [Test]
        public void DeadBallAction_RejectedByAuthorityRemainsEnabledForRetry()
        {
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetDeadBallGuidance(
                "Reading delivery",
                string.Empty,
                ProductionHudView.NextBallAction,
                "Next ball");
            view.SetOutcome(1, null);
            view.DeadBallActionRequested += _ => false;

            Assert.That(view.TryRequestDeadBallActionAt(
                view.DeadBallPrimaryActionTargetPixels.center), Is.False);
            Assert.That(view.DeadBallActionConsumed, Is.False);
            Assert.That(view.DeadBallActionsEnabled, Is.True);
        }

        [Test]
        public void DeadBallInsight_CanPopulateRecommendationWithoutResettingPendingActions()
        {
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetDeadBallGuidance(
                "Reading delivery",
                string.Empty,
                ProductionHudView.NextBallAction,
                "Next ball");
            view.SetOutcome(1, null);

            Assert.That(LabelVisible("Dead Ball Recommendation Text"), Is.False);
            Assert.That(view.DeadBallActionsEnabled, Is.True);

            view.SetDeadBallGuidance(
                "Contact was late",
                "Start the gesture earlier",
                ProductionHudView.NextBallAction,
                "Next ball");

            Assert.That(LabelVisible("Dead Ball Recommendation Text"), Is.True);
            Assert.That(view.DeadBallRecommendationText,
                Is.EqualTo("Start the gesture earlier"));
            Assert.That(view.DeadBallActionsEnabled, Is.True);
        }

        [Test]
        public void DeadBallGuidance_HindiAtTwoHundredPercentStaysBoundedAndPeripheral()
        {
            var safe = new Rect(44f, 20f, 847f, 372f);
            view.SetViewportForTesting(915, 412, safe, 160f);
            view.SetTextScale(2f);
            view.SetLocale("hi");
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetDeadBallGuidance(
                "संपर्क देर से हुआ",
                "इशारा थोड़ा पहले शुरू करें",
                ProductionHudView.PracticeBallAction,
                "यही गेंद अभ्यास करें",
                ProductionHudView.NextBallAction,
                "अगली गेंद");
            view.SetOutcome(6, null);

            AssertInside(view.CurrentLayout.DeadBallSurface, safe);
            Assert.That(view.CurrentLayout.DeadBallSurface.xMax,
                Is.LessThanOrEqualTo(safe.center.x));
            AssertInside(
                TextRect("Outcome Text"),
                view.CurrentLayout.DeadBallOutcome,
                1f);
            AssertInside(
                TextRect("Dead Ball Reason Text"),
                view.CurrentLayout.DeadBallReason,
                1f);
            AssertInside(
                TextRect("Dead Ball Recommendation Text"),
                view.CurrentLayout.DeadBallRecommendation,
                1f);
            AssertInside(
                TextRect("Dead Ball Primary Action Text"),
                view.DeadBallPrimaryActionTargetPixels,
                1f);
            AssertInside(
                TextRect("Dead Ball Secondary Action Text"),
                view.DeadBallSecondaryActionTargetPixels,
                1f);
        }

        [Test]
        public void DeadBallGuidance_RejectsUnknownOrDuplicateActionIdentifiers()
        {
            Assert.Throws<System.ArgumentOutOfRangeException>(() =>
                view.SetDeadBallGuidance("Reason", "", "unknown", "Continue"));
            Assert.Throws<System.ArgumentException>(() =>
                view.SetDeadBallGuidance(
                    "Reason",
                    "Recommendation",
                    ProductionHudView.NextBallAction,
                    "Next ball",
                    ProductionHudView.NextBallAction,
                    "Again"));
        }

        private GameObject Find(string name)
        {
            var transforms = owner.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
            {
                if (transforms[index].gameObject.name == name)
                    return transforms[index].gameObject;
            }
            Assert.Fail("Missing reconstructed HUD object: " + name);
            return null;
        }

        // Wedge phase 3: HUD text is UI Toolkit; its rectangle is the measured shaped text in its host.
        private Rect TextRect(string name) => HudLabelProbe.TextRect(HudLabelProbe.Label(owner, name));

        private bool LabelVisible(string name) => HudLabelProbe.Visible(HudLabelProbe.Label(owner, name));

        private Rect RendererRect(string name)
        {
            var renderer = Find(name).GetComponent<MeshRenderer>();
            Assert.That(renderer, Is.Not.Null, "Missing retained renderer: " + name);
            var bounds = renderer.bounds;
            return Rect.MinMaxRect(bounds.min.x, bounds.min.y, bounds.max.x, bounds.max.y);
        }

        private static void AssertContains(Rect container, Rect value)
        {
            AssertInside(value, container);
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
                    Id = index == 1 ? "bowler" : "fielder-" + index,
                    Role = index == 1 ? "bowler" : index == 0 ? "keeper" : "fielder",
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
