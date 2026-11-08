using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Effects;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class ProductionCoachGuidePresentationTests
    {
        private GameObject root;
        private ProductionCoachGuidePresentation guide;

        [TearDown]
        public void TearDown()
        {
            guide?.Dispose();
            if (root != null) Object.DestroyImmediate(root);
        }

        [Test]
        public void StageTwo_UsesOnlyAuthoritativeContactAfterReleaseAndMirrorsOnce()
        {
            Create(false);
            guide.Begin(new PracticeCoachGuidePresentation
            {
                Stage = 2,
                ContactT = 0.48,
                ContactPoint = Point(0.2, 0.82, 9.1)
            }, -1f);

            Assert.That(guide.IsPrepared, Is.True);
            Assert.That(guide.IsVisible, Is.False, "a guide cannot reveal before authoritative release");
            Assert.That(guide.ContactPosition.x, Is.EqualTo(-0.2f).Within(0.0001f));
            guide.MarkReleased();
            guide.SetSimulationTime(0.1, Quaternion.identity);
            Assert.That(guide.IsVisible, Is.True);
            guide.MarkContact();
            Assert.That(guide.IsVisible, Is.False);
        }

        [Test]
        public void StageThree_IsABoundedContactCueWhileStageFourCarriesNoHelp()
        {
            Create(false);
            guide.Begin(new PracticeCoachGuidePresentation
            {
                Stage = 3,
                ContactT = 0.5,
                ContactPoint = Point(0, 0.75, 9.05)
            }, 1f);
            guide.MarkReleased();
            guide.SetSimulationTime(0.4, Quaternion.identity);
            Assert.That(guide.IsVisible, Is.False);
            guide.SetSimulationTime(0.5, Quaternion.identity);
            Assert.That(guide.IsVisible, Is.True);
            guide.SetSimulationTime(0.6, Quaternion.identity);
            Assert.That(guide.IsVisible, Is.False);

            guide.Begin(new PracticeCoachGuidePresentation
            {
                Stage = 4,
                ContactT = null,
                ContactPoint = null
            }, 1f);
            guide.MarkReleased();
            guide.SetSimulationTime(0.5, Quaternion.identity);
            Assert.That(guide.IsPrepared, Is.False);
            Assert.That(guide.IsVisible, Is.False);
        }

        private void Create(bool reducedMotion)
        {
            root = new GameObject("CoachGuideTestRoot");
            guide = ProductionCoachGuidePresentation.Create(
                root.transform, PracticePresentationQuality.Lite, reducedMotion);
        }

        private static TraceVector3 Point(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }
    }
}
