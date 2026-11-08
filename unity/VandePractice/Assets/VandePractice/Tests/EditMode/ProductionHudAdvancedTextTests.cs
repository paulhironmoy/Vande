using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// Focused technical checks for the Stage-1 HUD text renderer. These do
    /// not certify visual quality, Hindi readability, TalkBack or a physical
    /// device accessibility result.
    /// </summary>
    public sealed class ProductionHudAdvancedTextTests
    {
        private GameObject owner;
        private ProductionHudAdvancedTextLayer layer;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("Advanced text contract");
            layer = ProductionHudAdvancedTextLayer.For(owner.transform);
        }

        [TearDown]
        public void TearDown()
        {
            if (owner != null) UnityEngine.Object.DestroyImmediate(owner);
        }

        [Test]
        public void PanelSettings_CarryTheShippedThemeNotTheEditorOnlyDefault()
        {
            // The editor auto-assigns Assets/UI Toolkit/UnityThemes/UnityDefaultRuntimeTheme.tss to any
            // PanelSettings it creates; a player does not, and logs "No Theme Style Sheet set to PanelSettings
            // VANDE Production HUD Panel Settings, UI will not render properly". The HUD must assign a theme
            // that ships (a Resources asset) so the player renders what these EditMode tests measure.
            var settings = layer.PanelSettingsForTesting;
            var shipped = Resources.Load<ThemeStyleSheet>(ProductionHudAdvancedTextLayer.ThemeResource);

            Assert.That(shipped, Is.Not.Null, "the HUD theme must be loadable from Resources in a player");
            Assert.That(settings.name, Is.EqualTo("VANDE Production HUD Panel Settings"));
            Assert.That(settings.themeStyleSheet, Is.SameAs(shipped));
            var path = UnityEditor.AssetDatabase.GetAssetPath(settings.themeStyleSheet);
            Assert.That(path, Does.Contain("/Resources/"));
            Assert.That(path, Does.Not.StartWith("Assets/UI Toolkit/"),
                "the editor-only fallback theme is not referenced by any shipped object");
            Assert.That(System.IO.File.ReadAllText(path).Trim(),
                Is.EqualTo("@import url(\"unity-theme://default\");"),
                "the same Unity default runtime theme the editor applies, so editor and player match");
        }

        [Test]
        public void LicensedFonts_AreDynamicAndUseDevanagariFallback()
        {
            var latin = layer.LatinFontForTesting;
            var devanagari = layer.DevanagariFontForTesting;

            Assert.That(layer.IsReady, Is.True);
            Assert.That(latin.atlasPopulationMode, Is.EqualTo(AtlasPopulationMode.Dynamic));
            Assert.That(devanagari.atlasPopulationMode, Is.EqualTo(AtlasPopulationMode.Dynamic));
            Assert.That(latin.sourceFontFile.name, Is.EqualTo("ManropeLatin-Regular"));
            Assert.That(devanagari.sourceFontFile.name,
                Is.EqualTo("NotoSansDevanagari-Regular"));
            // Dynamic atlases hold only glyphs already used; ask them to add from the licensed source font.
            Assert.That(latin.HasCharacter('A', false, true), Is.True);
            Assert.That(devanagari.HasCharacter('ल', false, true), Is.True);
            Assert.That(latin.fallbackFontAssetTable, Does.Contain(devanagari));
        }

        [Test]
        public void ActualHindiSetupCopy_UsesAdvancedShapingAndConjunctGlyphs()
        {
            // The third argument is the coach stage (null = Practice); this test checks the Practice copy.
            var copy = ProductionHudCopy.SetupBrief(
                HindiScene(),
                "play",
                null,
                "hi");
            Assert.That(copy, Does.Contain("लक्ष्य:"));
            Assert.That(copy, Does.Contain("अभ्यास"));

            var renderer = layer.CreateLabel(
                "Setup Brief Text",
                TextAnchor.MiddleLeft,
                TextAlignment.Left);
            renderer.SetFitted(
                copy,
                Vector2.zero,
                32f,
                Color.white,
                new Rect(40f, 30f, 560f, 300f),
                new Vector2(12f, 12f));

            var element = renderer.ElementForTesting;
            Assert.That(element.panel, Is.Not.Null);
            Assert.That(element.resolvedStyle.unityTextGenerator,
                Is.EqualTo(TextGeneratorType.Advanced));
            Assert.That(ShapedGlyphCount(element, "लक्ष्य"),
                Is.LessThan(UnicodeScalarCount("लक्ष्य")),
                "Devanagari conjuncts must shape into fewer glyphs than their source scalars.");
        }

        [Test]
        public void TwoHundredPercent_RetainsCompleteEssentialCopyAtRequestedSize()
        {
            var copy = ProductionHudCopy.SetupBrief(
                HindiScene(),
                "play",
                3,
                "hi");
            var renderer = layer.CreateLabel(
                "Setup Brief Text",
                TextAnchor.MiddleLeft,
                TextAlignment.Left);
            var safe = new Rect(24f, 18f, 592f, 324f);
            const float baseFontPixels = 18f;
            renderer.SetFitted(
                copy,
                Vector2.zero,
                baseFontPixels * 2f,
                Color.white,
                safe,
                new Vector2(16f, 14f));

            Assert.That(renderer.Text, Is.EqualTo(copy));
            Assert.That(renderer.Text, Does.Not.Contain("…"));
            Assert.That(renderer.ElementForTesting.text, Is.EqualTo(copy));
            Assert.That(renderer.ElementForTesting.resolvedStyle.fontSize,
                Is.EqualTo(baseFontPixels * 2f).Within(0.01f));
            Assert.That(renderer.IsScrollable, Is.True,
                "complete setup copy must scroll rather than shrink or elide");
            AssertInlineRectInside(renderer.HostForTesting, safe);
        }

        [Test]
        public void NonInteractiveLabels_DoNotStealTheOneGestureSurface()
        {
            var score = layer.CreateLabel(
                "Score Text",
                TextAnchor.MiddleLeft,
                TextAlignment.Left);
            score.SetFitted(
                "12/0",
                Vector2.zero,
                24f,
                Color.white,
                new Rect(20f, 280f, 150f, 52f),
                new Vector2(12f, 8f));

            Assert.That(layer.RootForTesting.pickingMode, Is.EqualTo(PickingMode.Ignore));
            Assert.That(score.HostForTesting.pickingMode, Is.EqualTo(PickingMode.Ignore));
            Assert.That(score.ElementForTesting.resolvedStyle.unityTextGenerator,
                Is.EqualTo(TextGeneratorType.Advanced));
        }

        [Test]
        public void HindiTwoHundredPercent_OnSmallHighDensityViewport_ReflowsWithoutLoss()
        {
            var hudOwner = new GameObject("Hindi 200 percent HUD");
            try
            {
                var view = hudOwner.AddComponent<ProductionHudView>();
                var safe = new Rect(10f, 8f, 620f, 344f);
                view.SetViewportForTesting(640, 360, safe, 480f);
                view.Configure(new PracticePresentationSettings
                {
                    Locale = "hi",
                    Quality = PracticePresentationQuality.Standard,
                    Assistance = "play",
                    Handedness = "right",
                    ReducedMotion = true,
                    Captions = true,
                    Audio = true,
                    Haptics = true,
                    TextScale = 2f,
                    HighContrast = true,
                    PixelsPerDp = 3f
                });
                view.SetScene(HindiScene());
                view.SetDelivery(0, 0);

                const string reason = "गेंद पर बहुत देर से पहुँचे";
                const string recommendation = "80 ms पहले शुरू करें।";
                const string primary = "यह गेंद दोबारा खेलें";
                const string secondary = "अगली गेंद";
                view.SetDeadBallGuidance(
                    reason,
                    recommendation,
                    ProductionHudView.PracticeBallAction,
                    primary,
                    ProductionHudView.NextBallAction,
                    secondary);
                view.SetOutcome(0, null);

                var hudLayer = FindHudTextLayer(hudOwner);
                var root = hudLayer.RootForTesting;
                var reasonLabel = root.Q<Label>("Dead Ball Reason Text");
                var recommendationLabel = root.Q<Label>("Dead Ball Recommendation Text");
                var primaryLabel = root.Q<Label>("Dead Ball Primary Action Text");
                var secondaryLabel = root.Q<Label>("Dead Ball Secondary Action Text");

                AssertComplete(reasonLabel, reason);
                AssertComplete(recommendationLabel, recommendation);
                AssertComplete(primaryLabel, primary);
                AssertComplete(secondaryLabel, secondary);
                Assert.That(HasScrollAncestor(reasonLabel), Is.True);
                Assert.That(HasScrollAncestor(recommendationLabel), Is.True);

                var layout = view.CurrentLayout;
                AssertInside(layout.DeadBallSurface, safe);
                Assert.That(view.DeadBallPrimaryActionTargetPixels.height,
                    Is.GreaterThanOrEqualTo(48f * 3f));
                Assert.That(view.DeadBallSecondaryActionTargetPixels.height,
                    Is.GreaterThanOrEqualTo(48f * 3f));
                Assert.That(view.DeadBallPrimaryActionTargetPixels.Overlaps(
                    layout.DeadBallReason), Is.False);
                Assert.That(view.DeadBallSecondaryActionTargetPixels.Overlaps(
                    layout.DeadBallRecommendation), Is.False);

                var expectedPrimarySize = 15f * layout.DpScale * 2f;
                var expectedSecondarySize = 13f * layout.DpScale * 2f;
                var expectedCopySize = 14f * layout.DpScale * 2f;
                AssertFontSize(primaryLabel, expectedPrimarySize);
                AssertFontSize(secondaryLabel, expectedSecondarySize);
                AssertFontSize(reasonLabel, expectedCopySize);
                AssertFontSize(recommendationLabel, expectedCopySize);
                AssertTextFits(primaryLabel, primary, view.DeadBallPrimaryActionTargetPixels,
                    16f * layout.DpScale, 10f * layout.DpScale, expectedPrimarySize);
                AssertTextFits(secondaryLabel, secondary, view.DeadBallSecondaryActionTargetPixels,
                    12f * layout.DpScale, 10f * layout.DpScale, expectedSecondarySize);

                var manualRequestCount = 0;
                view.DeadBallActionRequested += _ =>
                {
                    manualRequestCount++;
                    return true;
                };
                Assert.That(view.TryRequestDeadBallActionAt(layout.DeadBallReason.center), Is.False);
                Assert.That(view.TryRequestDeadBallActionAt(
                    layout.DeadBallRecommendation.center), Is.False);
                Assert.That(manualRequestCount, Is.Zero,
                    "scroll-copy pointers must not reach either manual action target");

                Assert.That(view.TryToggleSetupBriefAt(view.SetupBriefTargetPixels.center), Is.True);
                var setupLabel = root.Q<Label>("Setup Brief Text");
                AssertComplete(setupLabel, view.SetupBriefText);
                Assert.That(HasScrollAncestor(setupLabel), Is.True);
                AssertFontSize(setupLabel, 16f * layout.DpScale * 2f);
                AssertInside(layout.SetupBriefSurface, safe);
                AssertInside(layout.SetupBriefClose, safe);
                Assert.That(layout.SetupBriefClose.height, Is.GreaterThanOrEqualTo(48f * 3f));
                Assert.That(layout.SetupBriefCopy.Overlaps(layout.SetupBriefClose), Is.False);
                Assert.That(view.TryRequestDeadBallActionAt(layout.SetupBriefCopy.center), Is.False);
                Assert.That(view.TryToggleSetupBriefAt(layout.SetupBriefCopy.center), Is.False);
                Assert.That(manualRequestCount, Is.Zero);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(hudOwner);
            }
        }

        private static PracticeScenePresentation HindiScene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "fielder",
                    X = -40d + index * 8d,
                    Z = -35d + index * 7d
                };
            }
            return new PracticeScenePresentation
            {
                Conditions = "green",
                BowlerFamily = "spin",
                BowlerArm = "right",
                BowlerSpinType = "wrist",
                BallColour = "white",
                BallAge = "new",
                FieldIntent = "spin_close_catchers",
                TrainingObjective = "predefined",
                Handedness = "right",
                Fielders = fielders
            };
        }

        private static ProductionHudAdvancedTextLayer FindHudTextLayer(GameObject root)
        {
            var layers = root.GetComponentsInChildren<ProductionHudAdvancedTextLayer>(true);
            foreach (var candidate in layers)
            {
                if (candidate.RootForTesting.Q<Label>("Score Text") != null) return candidate;
            }
            Assert.Fail("The production HUD Advanced Text layer was not created.");
            return null;
        }

        private static void AssertComplete(Label label, string expected)
        {
            Assert.That(label, Is.Not.Null);
            Assert.That(label.text, Is.EqualTo(expected));
            Assert.That(label.text, Does.Not.Contain("…"));
            Assert.That(label.resolvedStyle.unityTextGenerator,
                Is.EqualTo(TextGeneratorType.Advanced));
        }

        private static bool HasScrollAncestor(VisualElement element)
        {
            for (var current = element.parent; current != null; current = current.parent)
                if (current is ScrollView) return true;
            return false;
        }

        private static void AssertFontSize(Label label, float expected)
        {
            Assert.That(label.resolvedStyle.fontSize, Is.EqualTo(expected).Within(0.01f));
        }

        private static void AssertTextFits(
            Label label,
            string text,
            Rect target,
            float totalHorizontalPadding,
            float totalVerticalPadding,
            float fontSize)
        {
            var width = Mathf.Max(1f, target.width - totalHorizontalPadding);
            var height = Mathf.Max(1f, target.height - totalVerticalPadding);
            var measured = label.MeasureTextSize(
                text,
                width,
                VisualElement.MeasureMode.AtMost,
                height,
                VisualElement.MeasureMode.Undefined,
                fontSize);
            Assert.That(measured.x, Is.LessThanOrEqualTo(width + 0.01f));
            Assert.That(measured.y, Is.LessThanOrEqualTo(height + 0.01f),
                "action text must reflow inside its complete 48dp-or-larger target");
        }

        private static void AssertInside(Rect inner, Rect outer)
        {
            Assert.That(inner.xMin, Is.GreaterThanOrEqualTo(outer.xMin - 0.01f));
            Assert.That(inner.yMin, Is.GreaterThanOrEqualTo(outer.yMin - 0.01f));
            Assert.That(inner.xMax, Is.LessThanOrEqualTo(outer.xMax + 0.01f));
            Assert.That(inner.yMax, Is.LessThanOrEqualTo(outer.yMax + 0.01f));
        }

        private static int ShapedGlyphCount(Label element, string text)
        {
            element.text = text;
            var measured = element.MeasureTextSize(
                text,
                400f,
                VisualElement.MeasureMode.AtMost,
                160f,
                VisualElement.MeasureMode.AtMost,
                32f);
            Assert.That(measured.x, Is.GreaterThan(0f));
            Assert.That(measured.y, Is.GreaterThan(0f));

            var handleProperty = typeof(UnityEngine.UIElements.TextElement).GetProperty(
                "uitkTextHandle",
                BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            var handle = handleProperty?.GetValue(element);
            Assert.That(handle, Is.Not.Null, "UI Toolkit did not create a text handle.");

            var textGenerationInfo = FindProperty(
                handle.GetType(),
                "textGenerationInfo")?.GetValue(handle);
            Assert.That(textGenerationInfo, Is.TypeOf<IntPtr>());
            var pointer = (IntPtr)textGenerationInfo;
            Assert.That(pointer, Is.Not.EqualTo(IntPtr.Zero));

            var infoType = typeof(FontAsset).Assembly.GetType(
                "UnityEngine.TextCore.Text.TextGenerationInfo",
                true);
            var glyphCountMethod = infoType.GetMethod(
                "GetGlyphCount",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            Assert.That(glyphCountMethod, Is.Not.Null);
            return (int)glyphCountMethod.Invoke(null, new object[] { pointer });
        }

        private static PropertyInfo FindProperty(Type type, string name)
        {
            for (var current = type; current != null; current = current.BaseType)
            {
                var property = current.GetProperty(
                    name,
                    BindingFlags.Instance | BindingFlags.Public |
                    BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                if (property != null) return property;
            }
            return null;
        }

        private static int UnicodeScalarCount(string value)
        {
            var result = 0;
            for (var index = 0; index < value.Length; index++, result++)
                if (char.IsHighSurrogate(value[index])) index++;
            return result;
        }

        private static void AssertInlineRectInside(VisualElement element, Rect expected)
        {
            var left = element.style.left.value.value;
            var bottom = element.style.bottom.value.value;
            var width = element.style.width.value.value;
            var height = element.style.height.value.value;
            var actual = new Rect(left, bottom, width, height);
            Assert.That(actual.xMin, Is.GreaterThanOrEqualTo(expected.xMin));
            Assert.That(actual.yMin, Is.GreaterThanOrEqualTo(expected.yMin));
            Assert.That(actual.xMax, Is.LessThanOrEqualTo(expected.xMax));
            Assert.That(actual.yMax, Is.LessThanOrEqualTo(expected.yMax));
        }
    }
}
