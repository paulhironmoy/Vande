using System;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio.Production;
using Vande.Practice.Audio.Production.Outputs;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    public sealed class ProductionFeedbackOutputTests
    {
        private GameObject owner;
        private ProductionHudView hud;
        private ProductionHudCaptionOutput captions;

        [SetUp]
        public void SetUp()
        {
            owner = new GameObject("Production Feedback Output Tests");
            hud = owner.AddComponent<ProductionHudView>();
            hud.SetViewportForTesting(1280, 720, new Rect(24f, 16f, 1232f, 688f), 320f);
            hud.Configure(new PracticePresentationSettings
            {
                Locale = "en-IN",
                Quality = PracticePresentationQuality.Standard,
                Assistance = "play",
                Handedness = "right",
                ReducedMotion = false,
                Captions = true,
                Audio = true,
                Haptics = true
            });
            captions = new ProductionHudCaptionOutput(hud);
        }

        [TearDown]
        public void TearDown()
        {
            if (owner != null) UnityEngine.Object.DestroyImmediate(owner);
        }

        [Test]
        public void CaptionOutput_PresentsDuringQuietModeThenExpires()
        {
            hud.SetQuiet(true);
            captions.Present(new ProductionCaptionCue(
                ProductionCaptionId.Middle,
                "Clean bat contact",
                0.62,
                ProductionCrowdEmotion.None));

            Assert.That(hud.CaptionVisible, Is.True);
            Assert.That(hud.CaptionText, Is.EqualTo("Clean bat contact"));
            Assert.That(hud.CaptionRemainingSeconds, Is.EqualTo(1.35f).Within(0.001f));

            hud.AdvancePresentation(1.34f);
            Assert.That(hud.CaptionVisible, Is.True);
            hud.AdvancePresentation(0.02f);
            Assert.That(hud.CaptionVisible, Is.False);
            Assert.That(hud.CaptionText, Is.Empty);
        }

        [Test]
        public void CaptionOutput_ReusesOneRetainedSurfaceWithoutGrowingObjects()
        {
            var preparedObjects = hud.GeneratedObjectCount;
            for (var index = 0; index < 64; index++)
            {
                captions.Present(new ProductionCaptionCue(
                    ProductionCaptionId.Pitch,
                    "Ball pitches",
                    index * 0.1,
                    ProductionCrowdEmotion.None));
                captions.Clear();
            }

            Assert.That(hud.GeneratedObjectCount, Is.EqualTo(preparedObjects));
            Assert.That(hud.CaptionVisible, Is.False);
        }

        [Test]
        public void CaptionOutput_NoneCueClearsExistingCaption()
        {
            captions.Present(new ProductionCaptionCue(
                ProductionCaptionId.Edge,
                "Edge",
                0.5,
                ProductionCrowdEmotion.None));
            captions.Present(new ProductionCaptionCue(
                ProductionCaptionId.None,
                string.Empty,
                0.6,
                ProductionCrowdEmotion.None));

            Assert.That(hud.CaptionVisible, Is.False);
        }

        [Test]
        public void NewDelivery_ClearsAnyCaptionFromThePreviousDeadBall()
        {
            captions.Present(new ProductionCaptionCue(
                ProductionCaptionId.CrowdCelebration,
                "Crowd celebrates",
                1.2,
                ProductionCrowdEmotion.StrongRelease));

            hud.SetDelivery(0, 1);

            Assert.That(hud.CaptionVisible, Is.False);
            Assert.That(hud.CaptionText, Is.Empty);
        }

        [Test]
        public void CaptionOutput_RequiresAProductionHud()
        {
            Assert.Throws<ArgumentNullException>(() => new ProductionHudCaptionOutput(null));
        }

        [Test]
        public void AndroidHapticOutput_IsSafeNoOpInEditorAndDisposalIsIdempotent()
        {
            var output = new ProductionAndroidHapticOutput();
            try
            {
                Assert.That(output.IsAvailable, Is.False);
                Assert.DoesNotThrow(() => output.Emit(new ProductionHapticCue(
                    ProductionHapticKind.Wicket,
                    1f,
                    0.8)));
                Assert.DoesNotThrow(output.CancelAll);
            }
            finally
            {
                output.Dispose();
                output.Dispose();
            }
        }
    }
}
