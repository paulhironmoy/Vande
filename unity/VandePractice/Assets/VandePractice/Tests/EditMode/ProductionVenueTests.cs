using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The baked venue as a sideload add-on on the Unity stage (ASSETS-VENUE, R-41): a default build carries none of it and the stage keeps its stand-in; with the add-on the
    /// 60-wedge ring is built the way the web builds it (levels of detail, sight-screen gaps, azimuth 0 towards the striker's end) and the stand-in's tiers, backdrop and
    /// instanced crowd are hidden. Builder evidence only: no player, no device, no look judged.
    /// </summary>
    public sealed class ProductionVenueTests
    {
        private const string VenueFolder = "Assets/VandePractice/Runtime/Presentation/Production/Venue";
        private const string AddonAssetPath = "Assets/VandePractice/Runtime/Presentation/Resources/VandeVenueAddon.asset";

        private GameObject host;

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("venue test host");
            ProductionVenueRing.AddonOverride = null;
        }

        [TearDown]
        public void TearDown()
        {
            ProductionVenueRing.AddonOverride = null;
            Object.DestroyImmediate(host);
        }

        private static ProductionVenueAddon FromProject()
        {
            var addon = ScriptableObject.CreateInstance<ProductionVenueAddon>();
            addon.hideFlags = HideFlags.DontSave;
            addon.Wedge0 = AssetDatabase.LoadAllAssetsAtPath(VenueFolder + "/wedge-lod0.fbx").OfType<Mesh>().FirstOrDefault();
            addon.Wedge1 = AssetDatabase.LoadAllAssetsAtPath(VenueFolder + "/wedge-lod1.fbx").OfType<Mesh>().FirstOrDefault();
            addon.Wedge2 = AssetDatabase.LoadAllAssetsAtPath(VenueFolder + "/wedge-lod2.fbx").OfType<Mesh>().FirstOrDefault();
            addon.Atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(VenueFolder + "/venue-atlas.png");
            return addon;
        }

        private ProductionCricketEnvironment Environment() =>
            ProductionCricketEnvironment.Create(host.transform,
                new ProductionEnvironmentSpec(PracticePresentationQuality.Standard, "balanced", "white", ProductionLight.Day, ProductionSky.Clear));

        [Test]
        public void TheRingHasSixtyWedges_InThreeLevels_ByTheWebsRule()
        {
            Assert.That(ProductionVenueRing.Wedges, Is.EqualTo(60));
            var gap = new[] { 59, 0, 1, 29, 30, 31 };
            for (var i = 0; i < 60; i++)
            {
                var lod = ProductionVenueRing.LodOf(i);
                if (gap.Contains(i)) Assert.That(lod, Is.EqualTo(2), "wedge " + i + " stands behind a sight screen");
                else if (i >= 20 && i <= 40) Assert.That(lod, Is.EqualTo(0), "wedge " + i + " is within 60 degrees of the bowler's end");
                else Assert.That(lod, Is.EqualTo(1), "wedge " + i);
            }

            Assert.That(Enumerable.Range(0, 60).Count(i => ProductionVenueRing.LodOf(i) == 0), Is.EqualTo(18));
            Assert.That(Enumerable.Range(0, 60).Count(i => ProductionVenueRing.LodOf(i) == 1), Is.EqualTo(36));
            Assert.That(Enumerable.Range(0, 60).Count(i => ProductionVenueRing.LodOf(i) == 2), Is.EqualTo(6));
            Assert.That(ProductionVenueRing.SightScreenGapHalfDegrees, Is.EqualTo(8.71f).Within(0.01f));
        }

        [Test]
        public void ADefaultBuildCarriesNoAddon_AndTheStageKeepsItsStandIn()
        {
            Assert.That(AssetDatabase.LoadAssetAtPath<ProductionVenueAddon>(AddonAssetPath), Is.Null,
                "the add-on asset exists only inside an export that carries the venue (it is created and deleted by it)");
            Assert.That(Resources.Load<ProductionVenueAddon>(ProductionVenueRing.ResourceName), Is.Null);
            Assert.That(ProductionVenueRing.Load(), Is.Null);
            var environment = Environment();
            try
            {
                Assert.That(environment.BakedVenue, Is.Null);
                Assert.That(environment.Stadium.Find("LowerSeatingTier").gameObject.activeSelf, Is.True);
                Assert.That(environment.Stadium.Find("UpperSeatingTier").gameObject.activeSelf, Is.True);
                Assert.That(environment.StadiumBackdrop.gameObject.activeSelf, Is.True);
            }
            finally
            {
                environment.Dispose();
            }
        }

        [Test]
        public void TheVenueFilesImportAsWedgesTowardsTheStrikersEnd()
        {
            var addon = FromProject();
            Assert.That(addon.IsComplete, Is.True, "the three wedges and the atlas import");
            Assert.That(addon.Wedge0, Is.Not.Null);
            foreach (var mesh in new[] { addon.Wedge0, addon.Wedge1, addon.Wedge2 })
            {
                // one wedge centred on +z (azimuth 0, the striker's end), 69 to 110 m out, up to 33 m high, symmetric about x = 0
                Assert.That(mesh.bounds.center.x, Is.EqualTo(0f).Within(0.5f), mesh.name);
                Assert.That(mesh.bounds.min.z, Is.EqualTo(69.4f).Within(1.0f), mesh.name);
                Assert.That(mesh.bounds.max.z, Is.EqualTo(110.5f).Within(1.0f), mesh.name);
                Assert.That(mesh.bounds.max.y, Is.EqualTo(33.35f).Within(1.0f), mesh.name);
                Assert.That(mesh.bounds.min.y, Is.EqualTo(0f).Within(0.2f), mesh.name);
                Assert.That(mesh.colors.Length + mesh.colors32.Length, Is.GreaterThan(0), mesh.name + " carries its baked vertex colour");
                Assert.That(mesh.uv.Length, Is.EqualTo(mesh.vertexCount), mesh.name + " carries the atlas UVs");
            }
        }

        [Test]
        public void WithTheAddon_TheRingIsBuilt_AzimuthZeroOnTheStrikersEnd_AndTheStandInIsHidden()
        {
            var addon = FromProject();
            ProductionVenueRing.AddonOverride = addon;
            var environment = Environment();
            try
            {
                var ring = environment.BakedVenue;
                Assert.That(ring, Is.Not.Null);
                Assert.That(ring.childCount, Is.EqualTo(60));
                var triangles = 0;
                for (var i = 0; i < 60; i++)
                {
                    var wedge = ring.GetChild(i);
                    var filter = wedge.GetComponent<MeshFilter>();
                    var lod = ProductionVenueRing.LodOf(i);
                    var expected = lod == 0 ? addon.Wedge0 : lod == 1 ? addon.Wedge1 : addon.Wedge2;
                    Assert.That(filter.sharedMesh, Is.SameAs(expected), "wedge " + i + " uses level " + lod);
                    var renderer = wedge.GetComponent<MeshRenderer>();
                    Assert.That(renderer.shadowCastingMode, Is.EqualTo(UnityEngine.Rendering.ShadowCastingMode.Off));
                    triangles += filter.sharedMesh.triangles.Length / 3;
                    // where the wedge stands in the world: azimuth a, radius r is (r sin a, y, r cos a)
                    var centre = renderer.bounds.center;
                    var azimuth = i * 6f * Mathf.Deg2Rad;
                    var expectedDirection = new Vector3(Mathf.Sin(azimuth), 0f, Mathf.Cos(azimuth));
                    var direction = new Vector3(centre.x, 0f, centre.z).normalized;
                    Assert.That(Vector3.Angle(direction, expectedDirection), Is.LessThan(1.5f), "wedge " + i + " stands at azimuth " + i * 6 + " degrees");
                    Assert.That(new Vector3(centre.x, 0f, centre.z).magnitude, Is.InRange(80f, 100f), "wedge " + i + " radius");
                }

                Assert.That(ring.GetChild(0).GetComponent<MeshRenderer>().bounds.center.z, Is.GreaterThan(80f), "azimuth 0 is the striker's end (+z)");
                Assert.That(ring.GetChild(30).GetComponent<MeshRenderer>().bounds.center.z, Is.LessThan(-80f), "azimuth 180 is the bowler's end (-z)");
                Assert.That(triangles, Is.EqualTo(18 * addon.Wedge0.triangles.Length / 3 + 36 * addon.Wedge1.triangles.Length / 3 + 6 * addon.Wedge2.triangles.Length / 3));
                Assert.That(environment.Stadium.Find("LowerSeatingTier").gameObject.activeSelf, Is.False, "the stand-in's lower tier is replaced");
                Assert.That(environment.Stadium.Find("UpperSeatingTier").gameObject.activeSelf, Is.False, "the stand-in's upper tier is replaced");
                Assert.That(environment.StadiumBackdrop.gameObject.activeSelf, Is.False, "the painted backdrop is replaced");
                for (var i = 0; i < 8; i++) Assert.That(environment.Stadium.Find("CrowdSection-" + i).gameObject.activeSelf, Is.False, "the instanced crowd is in the atlas now");
                // the shared meshes and the atlas are the add-on's: disposing the stage must not destroy them
                environment.Dispose();
                environment = null;
                Assert.That(addon.Wedge1 != null && addon.Wedge2 != null && addon.Atlas != null, Is.True);
            }
            finally
            {
                environment?.Dispose();
                ProductionVenueRing.AddonOverride = null;
                Object.DestroyImmediate(addon);
            }
        }

        [Test]
        public void TheVenueIsPurePresentation_TheWorldPlaysWithAndWithoutIt()
        {
            // building the ring changes no pose, ball or result: the stage still ticks and the stand-in comes back when the add-on is gone
            var addon = FromProject();
            ProductionVenueRing.AddonOverride = addon;
            var with = Environment();
            ProductionVenueRing.AddonOverride = null;
            var without = Environment();
            try
            {
                Assert.That(with.BakedVenue, Is.Not.Null);
                Assert.That(without.BakedVenue, Is.Null);
                Assert.That(without.Stadium.Find("LowerSeatingTier").gameObject.activeSelf, Is.True);
                Assert.That(with.PitchRenderer.bounds.size, Is.EqualTo(without.PitchRenderer.bounds.size));
            }
            finally
            {
                with.Dispose();
                without.Dispose();
                Object.DestroyImmediate(addon);
            }
        }
    }
}
