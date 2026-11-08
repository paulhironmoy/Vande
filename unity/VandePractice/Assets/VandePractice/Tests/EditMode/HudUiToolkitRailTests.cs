using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Wedge phase 3 (lead): the HUD's UI Toolkit text measured against its rails at 100% and 200% text in hi,
    /// hi-Latn, en-IN and bn, and a caption that never removes or covers a control. Geometry and state only; not a
    /// human readability, TalkBack or device result.
    /// </summary>
    public sealed class HudUiToolkitRailTests
    {
        private GameObject owner;
        private ProductionHudView view;

        [TearDown]
        public void TearDown()
        {
            if (owner != null) Object.DestroyImmediate(owner);
        }

        [Test]
        public void RailText_StaysInsideItsRails_AtOneAndTwoHundredPercent_InEveryLocale(
            [Values("en-IN", "hi", "hi-Latn", "bn")] string locale,
            [Values(1f, 2f)] float textScale,
            [Values(0, 1, 2)] int viewportCase)
        {
            var (width, height, safe) = Viewport(viewportCase);
            Build(locale, width, height, safe, textScale);
            view.SetScore(128, 3, 5);
            view.SetDelivery(0, 5);
            var layout = view.CurrentLayout;

            var score = Text("Score Text");
            var over = Text("Over Text");
            var conditions = Text("Conditions Text");
            AssertInside(score, layout.Score, "score", locale, textScale, viewportCase);
            AssertInside(over, layout.Score, "over", locale, textScale, viewportCase);
            AssertInside(conditions, layout.Conditions, "conditions", locale, textScale, viewportCase);
            Assert.That(score.Overlaps(over), Is.False, "score and over stay separately legible");
            for (var ball = 1; ball <= 6; ball++)
            {
                var marker = HudLabelProbe.Label(owner, "Ball " + ball + " Text");
                if (!HudLabelProbe.Visible(marker)) continue;
                AssertInside(HudLabelProbe.TextRect(marker), layout.Timeline, "ball " + ball, locale, textScale,
                    viewportCase);
            }

            view.PresentCaption(Caption(locale));
            AssertInside(Text("Caption Text"), view.CaptionPixels, "caption", locale, textScale, viewportCase);
            AssertInside(view.CaptionPixels, safe, "caption rail", locale, textScale, viewportCase);
            Assert.That(view.CaptionPixels.xMax, Is.LessThanOrEqualTo(safe.center.x),
                "during the live ball the caption stays in the left periphery, out of the delivery corridor");

            // The dead-ball result and its actions, with the caption still on screen.
            view.ClearCaption();
            ShowDeadBall(locale);
            AssertInside(Text("Outcome Text"), view.CurrentLayout.DeadBallOutcome, "outcome", locale, textScale,
                viewportCase);
            AssertInside(Text("Dead Ball Primary Action Text"), view.DeadBallPrimaryActionTargetPixels, "primary",
                locale, textScale, viewportCase);
            AssertInside(Text("Dead Ball Secondary Action Text"), view.DeadBallSecondaryActionTargetPixels,
                "secondary", locale, textScale, viewportCase);

            if (textScale <= 1f) return;
            // Floors (lead ruling): at 200% no label renders below its 100% size; caption and outcome at least 1.5x.
            var at200 = Sizes(locale);
            var twin = owner;
            var twinView = view;
            owner = null;
            Build(locale, width, height, safe, 1f);
            view.SetScore(128, 3, 5);
            view.SetDelivery(0, 5);
            view.PresentCaption(Caption(locale));
            var at100Caption = HudLabelProbe.FontSize(HudLabelProbe.Label(owner, "Caption Text"));
            view.ClearCaption();
            ShowDeadBall(locale);
            var at100 = Sizes(locale);
            at100["Caption Text"] = at100Caption;
            Object.DestroyImmediate(owner);
            owner = twin;
            view = twinView;
            view.PresentCaption(Caption(locale));
            at200["Caption Text"] = HudLabelProbe.FontSize(HudLabelProbe.Label(owner, "Caption Text"));
            foreach (var entry in at100)
            {
                var factor = entry.Key == "Caption Text" || entry.Key == "Outcome Text" ? 1.5f : 1f;
                TestContext.WriteLine("font px " + locale + " viewport " + viewportCase + " " + entry.Key + ": 100% " +
                                      entry.Value.ToString("F2") + ", 200% " + at200[entry.Key].ToString("F2"));
                Assert.That(at200[entry.Key], Is.GreaterThanOrEqualTo(entry.Value * factor - 0.01f),
                    entry.Key + " at 200% (" + locale + ", viewport " + viewportCase + ")");
            }
        }

        [Test]
        public void PlainOutcome_StaysInItsBand_AtLeastOneAndAHalfTimesItsSize(
            [Values("en-IN", "hi", "hi-Latn", "bn")] string locale,
            [Values(0, 1, 2)] int viewportCase)
        {
            var (width, height, safe) = Viewport(viewportCase);
            var sizes = new float[2];
            for (var pass = 0; pass < 2; pass++)
            {
                if (owner != null) Object.DestroyImmediate(owner);
                Build(locale, width, height, safe, pass == 0 ? 1f : 2f);
                view.SetReducedMotion(true);
                view.SetDelivery(0, 0);
                view.SetQuiet(false);
                view.SetOutcome(6, null);
                AssertInside(Text("Outcome Text"), view.CurrentLayout.Outcome, "plain outcome", locale,
                    pass == 0 ? 1f : 2f, viewportCase);
                sizes[pass] = HudLabelProbe.FontSize(HudLabelProbe.Label(owner, "Outcome Text"));
            }
            TestContext.WriteLine("font px " + locale + " viewport " + viewportCase + " Outcome Text (plain): 100% " +
                                  sizes[0].ToString("F2") + ", 200% " + sizes[1].ToString("F2"));
            Assert.That(sizes[1], Is.GreaterThanOrEqualTo(sizes[0] * 1.5f - 0.01f));
        }

        private static string Caption(string locale) => locale == "hi"
            ? "बल्ले के बाहरी किनारे से विकेटकीपर ने कैच लिया"
            : "Outside edge, caught behind by the keeper";

        private void ShowDeadBall(string locale)
        {
            view.SetReducedMotion(true);
            view.SetDeadBallGuidance(
                locale == "hi" ? "संपर्क देर से हुआ" : "Contact was late",
                locale == "hi" ? "इशारा थोड़ा पहले शुरू करें" : "Start the gesture a little earlier",
                ProductionHudView.PracticeBallAction,
                locale == "hi" ? "यही गेंद अभ्यास करें" : "Practice this ball",
                ProductionHudView.NextBallAction,
                locale == "hi" ? "अगली गेंद" : "Next ball");
            view.SetQuiet(false);
            view.SetOutcome(4, null);
        }

        private System.Collections.Generic.Dictionary<string, float> Sizes(string locale)
        {
            var sizes = new System.Collections.Generic.Dictionary<string, float>();
            foreach (var name in new[] { "Score Text", "Over Text", "Conditions Text", "Outcome Text",
                         "Dead Ball Primary Action Text", "Dead Ball Secondary Action Text",
                         "Dead Ball Reason Text", "Dead Ball Recommendation Text" })
                sizes[name] = HudLabelProbe.FontSize(HudLabelProbe.Label(owner, name));
            for (var ball = 1; ball <= 6; ball++)
            {
                var marker = HudLabelProbe.Label(owner, "Ball " + ball + " Text");
                if (HudLabelProbe.Visible(marker)) sizes[marker.name] = HudLabelProbe.FontSize(marker);
            }
            return sizes;
        }

        [Test]
        public void Caption_NeverRemovesOrCoversTheSetupControl(
            [Values("en-IN", "hi")] string locale,
            [Values(1f, 2f)] float textScale,
            [Values(0, 1, 2)] int viewportCase)
        {
            var (width, height, safe) = Viewport(viewportCase);
            Build(locale, width, height, safe, textScale);
            view.SetDelivery(0, 0);
            view.SetReducedMotion(true);
            view.SetOutcome(0, null);
            view.SetBetweenBallReady(true);
            Assert.That(view.SetupBriefAvailable, Is.True, "setup is available between balls");

            view.PresentCaption("Ball reaches the keeper");
            Assert.That(view.CaptionVisible, Is.True);
            Assert.That(view.SetupBriefAvailable, Is.True, "a caption never removes the setup control");
            var layout = view.CurrentLayout;
            Assert.That(view.CaptionPixels.Overlaps(view.SetupBriefTargetPixels), Is.False,
                "the caption sits clear of the setup target's 48dp hit area");
            Assert.That(view.CaptionPixels.Overlaps(layout.Pause), Is.False);
            AssertInside(view.CaptionPixels, safe, "caption rail", locale, textScale, viewportCase);
            Assert.That(view.TryToggleSetupBriefAt(view.SetupBriefTargetPixels.center), Is.True,
                "one tap opens setup while the caption shows");
        }

        [Test]
        public void Caption_NeverHidesOrCoversTheDeadBallActions(
            [Values("en-IN", "hi")] string locale,
            [Values(1f, 2f)] float textScale,
            [Values(0, 1, 2)] int viewportCase)
        {
            var (width, height, safe) = Viewport(viewportCase);
            Build(locale, width, height, safe, textScale);
            view.SetDelivery(0, 0);
            ShowDeadBall(locale);
            view.PresentCaption(Caption(locale));

            Assert.That(view.CaptionVisible, Is.True);
            Assert.That(view.DeadBallGuidanceVisible, Is.True, "a caption never hides the dead-ball result");
            Assert.That(view.DeadBallActionsEnabled, Is.True, "nor its actions");
            Assert.That(HudLabelProbe.Visible(HudLabelProbe.Label(owner, "Dead Ball Primary Action Text")), Is.True);
            Assert.That(HudLabelProbe.Visible(HudLabelProbe.Label(owner, "Dead Ball Secondary Action Text")), Is.True);
            var caption = view.CaptionPixels;
            Assert.That(caption.Overlaps(view.DeadBallPrimaryActionTargetPixels), Is.False,
                "the caption never covers Practice this ball: " + caption + " / " + view.DeadBallPrimaryActionTargetPixels);
            Assert.That(caption.Overlaps(view.DeadBallSecondaryActionTargetPixels), Is.False,
                "the caption never covers Next ball: " + caption + " / " + view.DeadBallSecondaryActionTargetPixels);
            Assert.That(caption.Overlaps(view.CurrentLayout.DeadBallSurface), Is.False, "nor the result surface");
            Assert.That(caption.Overlaps(view.CurrentLayout.Pause), Is.False);
            Assert.That(caption.Overlaps(view.CurrentLayout.FieldPip), Is.False);
            AssertInside(caption, safe, "caption rail", locale, textScale, viewportCase);
            AssertInside(Text("Caption Text"), caption, "caption", locale, textScale, viewportCase);

            var requested = string.Empty;
            view.DeadBallActionRequested += value =>
            {
                requested = value;
                return true;
            };
            Assert.That(view.TryRequestDeadBallActionAt(view.DeadBallPrimaryActionTargetPixels.center), Is.True,
                "one tap on Practice this ball works while the caption shows");
            Assert.That(requested, Is.EqualTo(ProductionHudView.PracticeBallAction));
        }

        [Test]
        public void ConditionsRail_HoldsItsTwoLinesAtTheRequestedSize_InBothLicensedFonts(
            [Values("en-IN", "hi", "hi-Latn", "bn")] string locale,
            [Values(1f, 2f)] float textScale)
        {
            var (width, height, safe) = Viewport(0);
            Build(locale, width, height, safe, textScale);
            var layer = HudLabelProbe.Layer(owner);
            foreach (var font in new[] { layer.LatinFontForTesting, layer.DevanagariFontForTesting })
                Assert.That(ProductionHudLayout.ConditionsLineHeightEm,
                    Is.GreaterThanOrEqualTo(font.faceInfo.lineHeight / font.faceInfo.pointSize - 0.001f), font.name);
            var conditions = HudLabelProbe.Label(owner, "Conditions Text");
            Assert.That(conditions.text, Does.Contain("\n"), "two explicit lines");
            var host = HudLabelProbe.HostRect(conditions);
            var requested = ProductionHudLayout.ConditionsFontDp * view.CurrentLayout.DpScale * textScale;
            var atRequested = conditions.MeasureTextSize(conditions.text, 0f,
                UnityEngine.UIElements.VisualElement.MeasureMode.Undefined, 0f,
                UnityEngine.UIElements.VisualElement.MeasureMode.Undefined, requested);
            var detail = "rail " + view.CurrentLayout.Conditions + " host " + host + " copy at the requested size " +
                         atRequested + " [" + conditions.text + "]";
            if (textScale <= 1f)
                Assert.That(HudLabelProbe.FontSize(conditions), Is.EqualTo(requested).Within(0.01f),
                    "at 100% the conditions copy keeps its requested size: " + detail);
            else
                // At 200% the rail grows 1.35x in width (it must not reach into the delivery corridor), so the copy is
                // fitted to it: never below the rail's own growth, 1.35x the 100% size (known limitation, reported).
                Assert.That(HudLabelProbe.FontSize(conditions),
                    Is.GreaterThanOrEqualTo(requested * 1.35f / textScale - 0.01f), "at 200%: " + detail);
            Assert.That(HudLabelProbe.FontSize(HudLabelProbe.Label(owner, "Score Text")), Is.GreaterThanOrEqualTo(14f));
        }

        private void Build(string locale, int width, int height, Rect safe, float textScale)
        {
            owner = new GameObject("HUD UI Toolkit rails");
            view = owner.AddComponent<ProductionHudView>();
            view.SetViewportForTesting(width, height, safe, 160f);
            view.Configure(new PracticePresentationSettings
            {
                Locale = locale,
                Quality = PracticePresentationQuality.Standard,
                Assistance = "play",
                Handedness = "right",
                ReducedMotion = false,
                Captions = true,
                Audio = true,
                Haptics = true
            });
            view.SetScene(Scene());
            view.SetTextScale(textScale);
        }

        private Rect Text(string name)
        {
            var label = HudLabelProbe.Label(owner, name);
            Assert.That(HudLabelProbe.Visible(label), Is.True, name + " visible");
            var rect = HudLabelProbe.TextRect(label);
            Assert.That(HudLabelProbe.Area(rect), Is.GreaterThan(1f), name + " has measured glyphs");
            return rect;
        }

        private static (int width, int height, Rect safe) Viewport(int index)
        {
            switch (index)
            {
                case 0: return (844, 390, new Rect(0f, 0f, 844f, 390f));
                case 1: return (915, 412, new Rect(44f, 20f, 847f, 372f));
                default: return (640, 360, new Rect(0f, 0f, 640f, 360f));
            }
        }

        private static void AssertInside(Rect value, Rect container, string what, string locale, float scale, int viewport)
        {
            const float tolerance = 1f;
            var label = what + " (" + locale + ", " + (scale * 100f) + "%, viewport " + viewport + "): " + value +
                        " in " + container;
            Assert.That(value.xMin, Is.GreaterThanOrEqualTo(container.xMin - tolerance), label);
            Assert.That(value.yMin, Is.GreaterThanOrEqualTo(container.yMin - tolerance), label);
            Assert.That(value.xMax, Is.LessThanOrEqualTo(container.xMax + tolerance), label);
            Assert.That(value.yMax, Is.LessThanOrEqualTo(container.yMax + tolerance), label);
        }

        private static PracticeScenePresentation Scene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder-" + index,
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
                FieldIntent = "attack_the_stumps",
                TrainingObjective = "random",
                Handedness = "right",
                BatterLateralM = 0.2d,
                BatterCreaseOffsetM = 0.1d,
                Fielders = fielders
            };
        }
    }
}
