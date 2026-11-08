using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// EVAL-WORLD ART1: Law 8 stumps. Every tier's faceted stump is at least 34.9 mm across its flats and at most
    /// 38.1 mm across its corners, and the presented stump tops stand at exactly STUMP_H = 0.7112 m above the physics
    /// ground (src/physics/geometry.ts), not 2 mm higher.
    /// </summary>
    public sealed class StumpLawGeometryTests
    {
        private GameObject host;

        [SetUp]
        public void SetUp() => host = new GameObject("stump-law-geometry-test");

        [TearDown]
        public void TearDown() => Object.DestroyImmediate(host);

        [TestCase(ProductionPropQuality.Lite)]
        [TestCase(ProductionPropQuality.Standard)]
        [TestCase(ProductionPropQuality.High)]
        public void FacetedStump_IsLawWidthAcrossFlatsAndCorners(ProductionPropQuality quality)
        {
            var wicket = ProductionCricketProps.CreateWicket(host.transform, "LawWicket", quality, false);
            var mesh = wicket.Stumps[1].GetComponent<MeshFilter>().sharedMesh;
            var vertices = mesh.vertices;
            var shaftCorners = 0f;
            var minimumAcrossFlats = float.MaxValue;
            // Sample the shaft (well below the dome) at many headings; a polygon's width in a direction is the
            // projected extent of its vertices, smallest across the flats.
            for (var heading = 0; heading < 360; heading++)
            {
                var direction = new Vector2(Mathf.Cos(heading * Mathf.Deg2Rad), Mathf.Sin(heading * Mathf.Deg2Rad));
                var min = float.MaxValue;
                var max = float.MinValue;
                foreach (var vertex in vertices)
                {
                    // The shaft is a constant-radius prism between its base rings (y 0 and 0.02 m); the dome tapers.
                    if (vertex.y > 0.03f) continue;
                    var projected = vertex.x * direction.x + vertex.z * direction.y;
                    min = Mathf.Min(min, projected);
                    max = Mathf.Max(max, projected);
                }
                minimumAcrossFlats = Mathf.Min(minimumAcrossFlats, max - min);
                shaftCorners = Mathf.Max(shaftCorners, max - min);
            }
            Assert.That(minimumAcrossFlats, Is.GreaterThanOrEqualTo(0.0349f), quality + " across flats");
            Assert.That(shaftCorners, Is.LessThanOrEqualTo(0.0381f), quality + " across corners");
            Assert.That(mesh.bounds.max.y, Is.EqualTo(CricketPropDimensions.StumpHeight).Within(0.0001f));
        }

        [Test]
        public void PresentedStumpTops_StandAtTheLawHeightAboveThePhysicsGround()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(PracticePresentationQuality.High, "balanced", "white"));
            try
            {
                foreach (var wicket in new[] { environment.BowlerWicket, environment.StrikerWicket })
                {
                    foreach (var stump in wicket.Stumps)
                    {
                        var bounds = stump.GetComponent<Renderer>().bounds;
                        Assert.That(bounds.max.y, Is.EqualTo(0.7112f).Within(0.0005f), stump.name);
                    }
                }
            }
            finally
            {
                environment.Dispose();
            }
        }
    }
}
