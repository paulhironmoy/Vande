using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Trace;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionHudViewTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("Production HUD Test");
            view = owner.AddComponent<ProductionHudView>();
            view.SetViewportForTesting(1280, 720, new Rect(24f, 16f, 1232f, 688f), 320f);
            view.Configure(Settings());
            view.SetScene(Scene("right"));
        }

        [TearDown]
        public void TearDown()
        {
            if (owner != null) Object.DestroyImmediate(owner);
        }

        [Test]
        public void Configure_BuildsRetainedVisualsAndACompleteField()
        {
            Assert.That(view.IsBuilt, Is.True);
            Assert.That(view.GeneratedObjectCount, Is.GreaterThan(30));
            Assert.That(view.ActiveFielderCount, Is.EqualTo(11));
            Assert.That(view.ConditionsText, Does.Contain("Green"));
            Assert.That(view.ConditionsText, Does.Contain("Right pace"));
            Assert.That(view.ScoreVisible, Is.True);
            Assert.That(view.ConditionsVisible, Is.True);
            Assert.That(view.FieldPipVisible, Is.True);
            Assert.That(view.PauseVisible, Is.False,
                "pause must not be interactive in an unsupported ready scene");
            Assert.That(view.PauseGlyphVisible, Is.False);
        }

        [Test]
        public void Locale_InitialAndRuntimeCopyCoverHindiHinglishAndEnglishFallback()
        {
            view.SetLocale("hi");
            Assert.That(view.ConditionsText, Does.Contain("हरी"));
            Assert.That(view.ConditionsText, Does.Contain("दायाँ पेस"));
            Assert.That(view.ConditionsText, Does.Contain("नई सफेद"));
            Assert.That(view.ConditionsText, Does.Contain("खेलें"));

            view.SetDelivery(0, 0, 3);
            view.SetOutcome(6, null);
            Assert.That(view.OutcomeText, Is.EqualTo("छक्का"));

            view.SetLocale("hi-Latn");
            Assert.That(view.OutcomeText, Is.EqualTo("CHHAKKA"),
                "a runtime language change must refresh an outcome already on screen");
            Assert.That(view.ConditionsText, Does.Contain("Hari"));
            Assert.That(view.ConditionsText, Does.Contain("Daaya pace"));
            Assert.That(view.ConditionsText, Does.Contain("Nayi safed"));
            Assert.That(view.ConditionsText, Does.Contain("Khelo"));

            view.SetLocale("bn");
            Assert.That(view.OutcomeText, Is.EqualTo("SIX"));
            Assert.That(view.ConditionsText, Does.Contain("Green"));
            Assert.That(view.ConditionsText, Does.Contain("Right pace"));
        }

        [Test]
        public void HindiLocale_RuntimeTypefaceContainsEveryPresentedDevanagariCharacter()
        {
            view.SetLocale("hi");
            view.SetDelivery(0, 0);
            view.SetOutcome(6, null);

            var textLayer = FindTextLayer(owner);
            var latin = textLayer.LatinFontForTesting;
            var devanagari = textLayer.DevanagariFontForTesting;
            foreach (var character in view.ConditionsText + view.OutcomeText)
            {
                if (char.IsWhiteSpace(character)) continue;
                // Dynamic atlases hold only glyphs already used; ask them to add from the licensed source fonts.
                Assert.That(latin.HasCharacter(character, false, true) || devanagari.HasCharacter(character, false, true), Is.True,
                    "the pinned HUD font chain must contain Hindi character U+" +
                    ((int)character).ToString("X4"));
            }
        }

        [Test]
        public void MandatoryTextGeometry_OccupiesReadablePixelsAtTheReferenceViewport()
        {
            view.SetViewportForTesting(844, 390, new Rect(0f, 0f, 844f, 390f), 160f);
            view.SetScore(12, 1, 4);

            var scoreBounds = TextBounds(owner, "Score Text");
            var overBounds = TextBounds(owner, "Over Text");
            var conditionsBounds = TextBounds(owner, "Conditions Text");

            Assert.That(FindLabel(owner, "Score Text").resolvedStyle.fontSize,
                Is.GreaterThanOrEqualTo(14f));
            Assert.That(FindLabel(owner, "Over Text").resolvedStyle.fontSize,
                Is.GreaterThanOrEqualTo(10f));
            Assert.That(FindLabel(owner, "Conditions Text").resolvedStyle.fontSize,
                Is.GreaterThanOrEqualTo(10f));
            AssertRendererInside(scoreBounds, view.CurrentLayout.Score);
            AssertRendererInside(overBounds, view.CurrentLayout.Score);
            AssertRendererInside(conditionsBounds, view.CurrentLayout.Conditions);
        }

        [TestCase(640, 360)]
        [TestCase(844, 390)]
        [TestCase(915, 412)]
        [TestCase(1280, 800)]
        [TestCase(1920, 1080)]
        public void MandatoryTextGeometry_AtTwoHundredPercentStaysInsideItsSafeRail(
            int width,
            int height)
        {
            view.SetViewportForTesting(width, height, new Rect(0f, 0f, width, height), 160f);
            view.SetTextScale(2f);
            view.SetScore(12, 1, 4);

            var scoreBounds = TextBounds(owner, "Score Text");
            var overBounds = TextBounds(owner, "Over Text");
            var conditionsBounds = TextBounds(owner, "Conditions Text");
            AssertRendererInside(scoreBounds, view.CurrentLayout.Score);
            AssertRendererInside(overBounds, view.CurrentLayout.Score);
            AssertRendererInside(conditionsBounds, view.CurrentLayout.Conditions);
            Assert.That(scoreBounds.Intersects(overBounds), Is.False,
                "score/wickets and over/ball must remain separately legible");
        }

        [Test]
        public void MandatoryHud_RendersScoreConditionsAndAllSixProgressMarkersToPixels()
        {
            const int width = 844;
            const int height = 390;
            view.SetViewportForTesting(width, height, new Rect(0f, 0f, width, height), 160f);
            view.SetDelivery(0, 0);
            view.SetScore(0, 0, 0);
            view.SetQuiet(true);

            var camera = HudCamera();
            var target = new RenderTexture(
                width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            var pixels = new Texture2D(width, height, TextureFormat.RGBA32, false, true);
            var priorActive = RenderTexture.active;
            var priorTarget = camera.targetTexture;
            try
            {
                target.Create();
                camera.targetTexture = target;
                RenderTexture.active = target;
                GL.Clear(true, true, Color.clear);
                camera.Render();
                pixels.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                pixels.Apply(false, false);

                // Wedge phase 3: the HUD text is drawn by its UI Toolkit panel, not by this camera, so the text pixels
                // are read from that panel rendered through Unity's runtime path; the markers stay camera pixels.
                var textPixels = HudLabelProbe.RenderPanel(owner, width, height);
                try
                {
                    Assert.That(HudLabelProbe.BrightPixelCount(textPixels, view.CurrentLayout.Score, 0.55f),
                        Is.GreaterThan(20),
                        "score/wickets must produce visible pixels, not only active renderer objects");
                    Assert.That(HudLabelProbe.BrightPixelCount(textPixels, view.CurrentLayout.Conditions, 0.55f),
                        Is.GreaterThan(20),
                        "compact conditions must produce visible pixels in the exported render path");
                }
                finally
                {
                    Object.DestroyImmediate(textPixels);
                }

                var timeline = view.CurrentLayout.Timeline;
                var diameter = Mathf.Min(9f * view.CurrentLayout.DpScale, timeline.height * 0.72f);
                var start = timeline.xMin + diameter * 0.5f;
                var span = Mathf.Max(0f, timeline.width - diameter);
                for (var index = 0; index < 6; index++)
                {
                    var center = new Vector2(
                        start + span * index / 5f,
                        timeline.center.y);
                    var sample = new Rect(
                        center.x - diameter * 0.5f,
                        center.y - diameter * 0.5f,
                        diameter,
                        diameter);
                    Assert.That(BrightPixelCount(pixels, sample, 0.12f),
                        Is.GreaterThan(12),
                        "six-ball progress marker " + (index + 1) + " must remain visible in quiet mode");
                }
            }
            finally
            {
                camera.targetTexture = priorTarget;
                RenderTexture.active = priorActive;
                target.Release();
                Object.DestroyImmediate(target);
                Object.DestroyImmediate(pixels);
            }
        }

        [Test]
        public void ExternalOverlayPresentation_HidesDuplicateHudButRetainsState()
        {
            Assert.That(view.PresentationVisible, Is.True);
            view.SetExternalOverlayPresentation(true);

            Assert.That(view.ExternalOverlayPresentation, Is.True);
            Assert.That(view.PresentationVisible, Is.False);
            Assert.That(view.enabled, Is.False,
                "a hidden WebGL HUD must not continue polling its invisible pause target");

            view.SetScore(7, 1, 4);
            Assert.That(view.ScoreText, Is.EqualTo("7/1"));
            view.SetExternalOverlayPresentation(false);
            Assert.That(view.PresentationVisible, Is.True);
            Assert.That(view.enabled, Is.True);
        }

        [Test]
        public void ScoreAndTimeline_DescribeOneSixBallOverWithoutExtraWidgets()
        {
            view.SetDelivery(0, 0);
            view.SetScore(4, 0, 1);
            view.SetQuiet(true);
            view.SetOutcome(4, null);

            Assert.That(view.ScoreText, Is.EqualTo("4/0"));
            Assert.That(view.OverText, Is.EqualTo("0.1"));
            Assert.That(view.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Boundary));
            Assert.That(view.BallMarkerLabel(0), Is.EqualTo("4"));

            view.SetDelivery(0, 1);
            Assert.That(view.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Boundary));
            Assert.That(view.BallMarkerState(1), Is.EqualTo(ProductionBallMarkerState.Current));
            Assert.That(view.BallMarkerState(2), Is.EqualTo(ProductionBallMarkerState.Upcoming));
        }

        [Test]
        public void Outcome_RemainsHiddenUntilQuietModeEndsAfterDeadBall()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetOutcome(6, null);

            Assert.That(view.OutcomeText, Is.EqualTo("SIX"));
            Assert.That(view.OutcomeVisible, Is.False);

            view.SetQuiet(false);
            Assert.That(view.OutcomeVisible, Is.True);
            Assert.That(view.OutcomeOpacity, Is.Zero);
            view.AdvancePresentation(0.16f);
            Assert.That(view.OutcomeOpacity, Is.EqualTo(1f));
        }

        [Test]
        public void Outcome_CommittedAfterQuietModeEnds_RevealsImmediately()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetQuiet(false);

            view.SetOutcome(4, null);

            Assert.That(view.OutcomeText, Is.EqualTo("FOUR"));
            Assert.That(view.OutcomeVisible, Is.True);
            Assert.That(view.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Boundary));
        }

        [Test]
        public void ReducedMotion_ShowsDeadBallOutcomeWithoutATransition()
        {
            view.SetReducedMotion(true);
            view.SetDelivery(0, 0);
            view.SetQuiet(true);
            view.SetOutcome(0, "bowled");
            view.SetQuiet(false);

            Assert.That(view.OutcomeText, Is.EqualTo("OUT"));
            Assert.That(view.OutcomeVisible, Is.True);
            Assert.That(view.OutcomeOpacity, Is.EqualTo(1f));
        }

        [Test]
        public void NewOver_ResetsAllSixMarkersBeforeSelectingCurrentBall()
        {
            view.SetDelivery(0, 5);
            view.SetQuiet(true);
            view.SetOutcome(1, null);
            view.SetDelivery(1, 0);

            Assert.That(view.BallMarkerState(0), Is.EqualTo(ProductionBallMarkerState.Current));
            for (var index = 1; index < 6; index++)
                Assert.That(view.BallMarkerState(index), Is.EqualTo(ProductionBallMarkerState.Upcoming));
        }

        [Test]
        public void PauseHitTarget_IsAtLeastFortyEightDpAndRaisesOnlyInside()
        {
            view.SetDelivery(0, 0);
            var requests = 0;
            view.PauseRequested += () =>
            {
                requests++;
                return true;
            };
            var target = view.PauseTargetPixels;

            Assert.That(target.width, Is.GreaterThanOrEqualTo(96f));
            Assert.That(target.height, Is.GreaterThanOrEqualTo(96f));
            Assert.That(view.TryRequestPauseAt(target.center), Is.True);
            Assert.That(view.TryRequestPauseAt(Vector2.zero), Is.False);
            Assert.That(requests, Is.EqualTo(1));
            Assert.That(view.PauseVisible, Is.False,
                "an accepted synchronous request stays unavailable until the host resolves it");
            Assert.That(view.TryRequestPauseAt(target.center), Is.False);
        }

        [Test]
        public void PauseRequest_RejectionAndPhaseRacesNeverConsumeAnUnsupportedControl()
        {
            var target = view.PauseTargetPixels;
            Assert.That(view.TryRequestPauseAt(target.center), Is.False,
                "SceneReady without a delivery or retained dead-ball UI is unsupported");

            view.SetDelivery(0, 0);
            view.PauseRequested += () => false;
            Assert.That(view.TryRequestPauseAt(target.center), Is.False);
            Assert.That(view.PauseVisible, Is.True,
                "an authority rejection must leave a valid live-delivery control retryable");

            view.SetReplayPresentation(true);
            Assert.That(view.PauseVisible, Is.False);
            Assert.That(view.TryRequestPauseAt(target.center), Is.False);
            view.SetReplayPresentation(false);
            view.SetPauseAvailable(false);
            Assert.That(view.TryRequestPauseAt(target.center), Is.False);

            view.SetPauseAvailable(true);
            view.SetInteractionHeld(true);
            Assert.That(view.PauseVisible, Is.False);
            Assert.That(view.TryRequestPauseAt(target.center), Is.False);
            view.SetInteractionHeld(false);
            Assert.That(view.PauseVisible, Is.True);
        }

        [Test]
        public void SetupBrief_OneTapShowsOnlyAuthoritativeSetupBetweenBallsAndNeverDuringDelivery()
        {
            var target = view.SetupBriefTargetPixels;
            Assert.That(view.SetupBriefAvailable, Is.True);
            Assert.That(view.ConditionsText, Does.Contain("Setup ›"),
                "the sighted one-tap path must be visible inside the conditions capsule");
            Assert.That(target.width,
                Is.GreaterThanOrEqualTo(48f * view.CurrentLayout.TouchDpScale));
            Assert.That(target.height,
                Is.GreaterThanOrEqualTo(48f * view.CurrentLayout.TouchDpScale));
            Assert.That(view.TryToggleSetupBriefAt(target.center), Is.True);
            Assert.That(view.SetupBriefVisible, Is.True);
            Assert.That(view.SetupBriefText, Does.Contain("Practice"));
            Assert.That(view.SetupBriefText, Does.Contain("Stumps field"));
            Assert.That(view.SetupBriefText, Does.Contain("Read an unknown over ball by ball"));
            Assert.That(view.TryRequestPauseAt(view.PauseTargetPixels.center), Is.False,
                "the open setup disclosure owns interaction until it is dismissed");
            Assert.That(view.TryToggleSetupBriefAt(view.SetupBriefCloseTargetPixels.center), Is.True);
            Assert.That(view.SetupBriefVisible, Is.False);

            view.SetDelivery(0, 0, 3);
            Assert.That(view.SetupBriefAvailable, Is.False);
            Assert.That(view.TryToggleSetupBriefAt(target.center), Is.False);

            view.SetReducedMotion(true);
            view.SetOutcome(0, null);
            view.SetDeadBallGuidance(
                "Reading the delivery",
                string.Empty,
                ProductionHudView.NextBallAction,
                "Next ball");
            Assert.That(view.SetupBriefAvailable, Is.True);
            view.SetPaused(true);
            Assert.That(view.SetupBriefAvailable, Is.True,
                "a retained dead ball keeps setup readable while authoritative Pause is active");
            Assert.That(view.TryToggleSetupBriefAt(target.center), Is.True);
            Assert.That(view.SetupBriefVisible, Is.True);
            Assert.That(view.SetupBriefText, Does.Contain("Coach · stage 3"));
            Assert.That(view.TryToggleSetupBriefAt(view.SetupBriefCloseTargetPixels.center), Is.True);
            view.SetPaused(false);
            view.SetReplayPresentation(true);
            Assert.That(view.SetupBriefVisible, Is.False);
            Assert.That(view.TryToggleSetupBriefAt(target.center), Is.False);
        }

        [Test]
        public void SetupBrief_HindiTwoHundredPercentHighContrastStaysInsideSafeSurface()
        {
            var briefOwner = new GameObject("Accessible Setup Brief Test");
            try
            {
                var brief = briefOwner.AddComponent<ProductionHudView>();
                brief.SetViewportForTesting(640, 360, new Rect(0f, 0f, 640f, 360f), 0f);
                var configured = Settings();
                configured.Locale = "hi";
                configured.TextScale = 2f;
                configured.HighContrast = true;
                configured.PixelsPerDp = 3f;
                brief.Configure(configured);
                brief.SetScene(Scene("right"));

                Assert.That(brief.TryToggleSetupBriefAt(brief.SetupBriefTargetPixels.center), Is.True);
                Assert.That(brief.SetupBriefText, Does.Contain("अभ्यास"));
                Assert.That(brief.SetupBriefText, Does.Contain("स्टंप वाली फ़ील्ड"));
                Assert.That(brief.ConditionsText, Does.Not.Contain("सेटअप"),
                    "the collapsed trigger gives way to the visible close affordance while open");
                Assert.That(brief.SetupBriefTargetPixels.width, Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(brief.SetupBriefTargetPixels.height, Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(brief.SetupBriefCloseTargetPixels.width, Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(brief.SetupBriefCloseTargetPixels.height, Is.GreaterThanOrEqualTo(143.99f));
                var label = FindLabel(briefOwner, "Setup Brief Text");
                Assert.That(label.resolvedStyle.color, Is.EqualTo(Color.white));
                AssertRendererInside(
                    TextBounds(briefOwner, "Setup Brief Text"),
                    brief.CurrentLayout.SetupBriefCopy);
                AssertRendererInside(
                    Find(briefOwner, "Setup Brief Frame").GetComponent<MeshRenderer>().bounds,
                    brief.CurrentLayout.SafeArea);
                AssertRendererInside(
                    Find(briefOwner, "Setup Brief Close Frame").GetComponent<MeshRenderer>().bounds,
                    brief.CurrentLayout.SetupBriefSurface);
            }
            finally
            {
                Object.DestroyImmediate(briefOwner);
            }
        }

        [Test]
        public void Handedness_MirrorsEveryFielderWithoutChangingDepth()
        {
            var right = view.FielderPixelPosition(0);
            view.SetScene(Scene("left"));
            var left = view.FielderPixelPosition(0);
            var centre = view.FieldPipPixels.center.x;

            Assert.That(left.x, Is.EqualTo(centre * 2f - right.x).Within(0.001f));
            Assert.That(left.y, Is.EqualTo(right.y).Within(0.001f));
        }

        [Test]
        public void BoundLiveField_TracksOnlyAuthoritativeFielderSamples()
        {
            var state = new ProductionFieldState();
            state.Configure(Scene("right").Fielders);
            view.BindFieldState(state);
            var before = view.FielderPixelPosition(0);

            state.ApplyAuthoritativeSample("fielder-0", new FielderTraceSample
            {
                t = 0.7d,
                x = -24d,
                z = 18d,
                action = "run"
            });
            view.AdvancePresentation(0f);
            var after = view.FielderPixelPosition(0);

            Assert.That(after, Is.Not.EqualTo(before));
            Assert.That(view.ActiveFielderCount, Is.EqualTo(11));
        }

        [Test]
        public void TextScale_ClampsToAccessibleRangeAndReflowsConditions()
        {
            view.SetTextScale(7f);

            Assert.That(view.TextScale, Is.EqualTo(2f));
            Assert.That(view.ConditionsText, Does.Contain("\n"));
            Assert.That(view.CurrentLayout.Conditions.Overlaps(view.CurrentLayout.FieldPip), Is.False);
            Assert.That(view.CurrentLayout.Caption.Overlaps(view.CurrentLayout.Conditions), Is.False);
        }

        [Test]
        public void Configure_AppliesAccessibleTextScaleAndARealHighContrastPalette()
        {
            var highContrastOwner = new GameObject("High Contrast HUD Test");
            try
            {
                var highContrastView = highContrastOwner.AddComponent<ProductionHudView>();
                highContrastView.SetViewportForTesting(
                    844, 390, new Rect(0f, 0f, 844f, 390f), 160f);
                var configured = Settings();
                configured.TextScale = 2f;
                configured.HighContrast = true;
                highContrastView.Configure(configured);
                highContrastView.SetScene(Scene("right"));

                Assert.That(highContrastView.TextScale, Is.EqualTo(2f));
                Assert.That(highContrastView.HighContrast, Is.True);
                var scoreText = FindLabel(highContrastOwner, "Score Text");
                Assert.That(scoreText.resolvedStyle.color, Is.EqualTo(Color.white));
            }
            finally
            {
                Object.DestroyImmediate(highContrastOwner);
            }
        }

        [Test]
        public void AndroidDensity_OverridesUnknownScreenDpiForBothDeadBallActionAxes()
        {
            var densityOwner = new GameObject("Density HUD Test");
            try
            {
                var densityView = densityOwner.AddComponent<ProductionHudView>();
                densityView.SetViewportForTesting(
                    640, 360, new Rect(0f, 0f, 640f, 360f), 0f);
                var configured = Settings();
                configured.Locale = "hi";
                configured.TextScale = 2f;
                configured.ReducedMotion = true;
                configured.PixelsPerDp = 3f;
                densityView.Configure(configured);
                densityView.SetScene(Scene("right"));
                densityView.SetDelivery(0, 0);
                densityView.SetDeadBallGuidance(
                    "संपर्क देर से हुआ",
                    "इशारा थोड़ा पहले शुरू करें",
                    ProductionHudView.PracticeBallAction,
                    "यही गेंद अभ्यास करें",
                    ProductionHudView.NextBallAction,
                    "अगली गेंद");
                densityView.SetOutcome(4, null);

                Assert.That(densityView.CurrentLayout.TouchDpScale, Is.EqualTo(3f));
                Assert.That(densityView.DeadBallPrimaryActionTargetPixels.width,
                    Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(densityView.DeadBallPrimaryActionTargetPixels.height,
                    Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(densityView.DeadBallSecondaryActionTargetPixels.width,
                    Is.GreaterThanOrEqualTo(143.99f));
                Assert.That(densityView.DeadBallSecondaryActionTargetPixels.height,
                    Is.GreaterThanOrEqualTo(143.99f));
            }
            finally
            {
                Object.DestroyImmediate(densityOwner);
            }
        }

        [Test]
        public void Caption_UsesReservedPeripheralRailInsteadOfDeliveryCentre()
        {
            view.PresentCaption("Clean bat contact");

            var caption = view.CaptionTargetPixels;
            Assert.That(view.CaptionVisible, Is.True);
            Assert.That(caption, Is.EqualTo(view.CurrentLayout.Caption));
            Assert.That(caption.xMax, Is.LessThan(view.CurrentLayout.SafeArea.center.x));
            Assert.That(caption.Overlaps(view.CurrentLayout.Conditions), Is.False);
            Assert.That(caption.Overlaps(view.CurrentLayout.FieldPip), Is.False);
        }

        [Test]
        public void DeliveryQuietMode_KeepsMandatoryRailAndPauseVisible()
        {
            view.SetDelivery(0, 0);
            view.SetQuiet(true);

            Assert.That(view.ScoreVisible, Is.True);
            Assert.That(view.ConditionsVisible, Is.True);
            Assert.That(view.FieldPipVisible, Is.True);
            Assert.That(view.PauseVisible, Is.True);
            Assert.That(view.PauseGlyphVisible, Is.True);
            Assert.That(view.OutcomeVisible, Is.False);
        }

        [Test]
        public void Release_IsDeterministicAndIdempotent()
        {
            view.Release();
            view.Release();

            Assert.That(view.IsBuilt, Is.False);
            Assert.That(view.GeneratedObjectCount, Is.Zero);
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

        private static ProductionHudAdvancedTextLayer FindTextLayer(GameObject root)
        {
            var layers = root.GetComponentsInChildren<ProductionHudAdvancedTextLayer>(true);
            foreach (var candidate in layers)
                if (candidate.RootForTesting.Q<Label>("Score Text") != null) return candidate;
            Assert.Fail("Missing production HUD Advanced Text layer");
            return null;
        }

        private static Label FindLabel(GameObject root, string name)
        {
            var result = FindTextLayer(root).RootForTesting.Q<Label>(name);
            Assert.That(result, Is.Not.Null, "Missing Advanced Text label: " + name);
            return result;
        }

        // Wedge phase 3: the measured shaped text placed in its host (HudLabelProbe), not the host box: a host
        // read alone could not show text overflowing its rail, and a compact label's width was a percentage.
        private static Bounds TextBounds(GameObject root, string name)
        {
            var label = FindLabel(root, name);
            Assert.That(HudLabelProbe.Visible(label), Is.True, name + " visible");
            var rect = HudLabelProbe.TextRect(label);
            Assert.That(HudLabelProbe.Area(rect), Is.GreaterThan(1f), name + " has measured glyphs");
            return new Bounds(rect.center, new Vector3(rect.width, rect.height, 0f));
        }

        private Camera HudCamera()
        {
            var cameras = owner.GetComponentsInChildren<Camera>(true);
            for (var index = 0; index < cameras.Length; index++)
            {
                if (cameras[index].gameObject.name == "HUD Camera") return cameras[index];
            }
            Assert.Fail("Missing retained HUD camera");
            return null;
        }

        private static GameObject Find(GameObject root, string objectName)
        {
            var transforms = root.GetComponentsInChildren<Transform>(true);
            for (var index = 0; index < transforms.Length; index++)
                if (transforms[index].gameObject.name == objectName)
                    return transforms[index].gameObject;
            Assert.Fail("Missing retained HUD object: " + objectName);
            return null;
        }

        private static int BrightPixelCount(Texture2D texture, Rect bounds, float threshold)
        {
            var xMin = Mathf.Clamp(Mathf.FloorToInt(bounds.xMin), 0, texture.width);
            var xMax = Mathf.Clamp(Mathf.CeilToInt(bounds.xMax), 0, texture.width);
            var yMin = Mathf.Clamp(Mathf.FloorToInt(bounds.yMin), 0, texture.height);
            var yMax = Mathf.Clamp(Mathf.CeilToInt(bounds.yMax), 0, texture.height);
            var count = 0;
            for (var y = yMin; y < yMax; y++)
            {
                for (var x = xMin; x < xMax; x++)
                {
                    if (texture.GetPixel(x, y).grayscale >= threshold) count++;
                }
            }
            return count;
        }

        private static void AssertRendererInside(Bounds rendererBounds, Rect rail)
        {
            const float tolerance = 1f;
            Assert.That(rendererBounds.min.x, Is.GreaterThanOrEqualTo(rail.xMin - tolerance));
            Assert.That(rendererBounds.max.x, Is.LessThanOrEqualTo(rail.xMax + tolerance));
            Assert.That(rendererBounds.min.y, Is.GreaterThanOrEqualTo(rail.yMin - tolerance));
            Assert.That(rendererBounds.max.y, Is.LessThanOrEqualTo(rail.yMax + tolerance));
        }

        private static PracticeScenePresentation Scene(string handedness)
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = "fielder-" + index,
                    Role = index == 0 ? "keeper" : "fielder",
                    X = index == 0 ? 30d : -52d + index * 10d,
                    Z = -42d + index * 8d
                };
            }

            return new PracticeScenePresentation
            {
                Conditions = "green",
                FieldId = "pace-green",
                FieldIntent = "attack_the_stumps",
                TrainingObjective = "random",
                BowlerFamily = "pace",
                BowlerArm = "right",
                BallColour = "white",
                BallAge = "new",
                Handedness = handedness,
                BatterLateralM = 0.2d,
                BatterCreaseOffsetM = 0.1d,
                Fielders = fielders
            };
        }
    }
}
