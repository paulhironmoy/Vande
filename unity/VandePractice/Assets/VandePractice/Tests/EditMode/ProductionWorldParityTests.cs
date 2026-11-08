using System.Linq;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Effects;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// World parity with the web's Track D (wedge item 18): Practice's neutral boards and the Law 5 bat. Builder checks;
    /// visual acceptance and resemblance review belong to the evaluators.
    /// </summary>
    public sealed class ProductionWorldParityTests
    {
        private GameObject host;

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("World parity");
        }

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
        }

        [TestCase(PracticePresentationQuality.Lite, 1024, 32)]
        [TestCase(PracticePresentationQuality.Standard, 2048, 64)]
        [TestCase(PracticePresentationQuality.High, 2048, 64)]
        public void Boards_AreTheNeutralPracticePanels_WithNoWordsOrLogos(
            PracticePresentationQuality quality, int width, int height)
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform, new ProductionEnvironmentSpec(quality, "balanced", "white"));
            try
            {
                var boards = environment.Stadium.Find("BoundaryCushions").GetComponent<MeshRenderer>();
                Assert.That(boards.sharedMaterials, Has.Length.EqualTo(1));
                Assert.That(boards.sharedMaterials[0].mainTexture, Is.SameAs(environment.PracticeBoardsTexture));
                Assert.That(environment.PracticeBoardsTexture.width, Is.EqualTo(width));
                Assert.That(environment.PracticeBoardsTexture.height, Is.EqualTo(height));
                Assert.That(environment.Root.GetComponentsInChildren<Renderer>(true)
                        .SelectMany(renderer => renderer.sharedMaterials)
                        .Any(material => material != null && material.name.Contains("amber")), Is.False,
                    "the former amber/navy cushions are gone");
                Assert.That(environment.Root.GetComponentsInChildren<TextMesh>(true), Is.Empty, "no words anywhere");

                var mesh = boards.GetComponent<MeshFilter>().sharedMesh;
                var uv = mesh.uv;
                var repeats = uv.Max(value => value.x);
                Assert.That(repeats, Is.EqualTo(Mathf.Round(repeats)).Within(1e-4f), "a whole number of strips: no seam");
                var bounds = mesh.bounds;
                var radius = bounds.extents.x;
                var panelWidth = 2f * Mathf.PI * radius / (repeats * ProductionPracticeBoards.Panels);
                var panelAspect = panelWidth / bounds.size.y;
                Assert.That(panelAspect, Is.EqualTo(ProductionPracticeBoards.StripAspect / ProductionPracticeBoards.Panels)
                    .Within(0.05f * ProductionPracticeBoards.StripAspect / ProductionPracticeBoards.Panels),
                    "panels keep the painted 4:1 aspect, so the ball stays a disc");
                Assert.That(uv.Min(value => value.y), Is.Zero);
                Assert.That(uv.Max(value => value.y), Is.EqualTo(1f));
            }
            finally
            {
                environment.Dispose();
            }
        }

        [Test]
        public void BoardPanels_AreDarkAndMuted_AndTheInkStaysRestrained()
        {
            var pixels = ProductionPracticeBoards.PaintCanvas(1f, out var width, out var height);
            var panelWidth = width / ProductionPracticeBoards.Panels;
            for (var panel = 0; panel < ProductionPracticeBoards.Panels; panel++)
            {
                // Inside the frame, clear of the pictogram and the scan lines.
                var background = pixels[(int)(height * 0.86f) * width + panel * panelWidth + 14];
                Hsl(background, out var saturation, out var lightness);
                Assert.That(lightness, Is.LessThan(0.2f), "panel " + panel + " is dark (web: HSL L < 0.2)");
                Assert.That(saturation, Is.LessThan(0.45f), "panel " + panel + " is muted (web: HSL S < 0.45)");
            }
            var brightest = pixels.Max(value => Mathf.Max(value.r, Mathf.Max(value.g, value.b)));
            Assert.That(brightest, Is.LessThan(0.6f), "no bright signage, lettering or logo");
            Assert.That(brightest, Is.GreaterThan(0.25f), "the pictograms are present");
        }

        [Test]
        public void Bat_IsWithinLaw5_AtMost10Point80CentimetresWide_InEveryForm()
        {
            const float law5 = 0.1080f;
            foreach (var quality in new[] { ProductionPropQuality.Lite, ProductionPropQuality.Standard, ProductionPropQuality.High })
            {
                var bat = ProductionCricketProps.CreateBat(host.transform, "Law5Bat-" + quality, quality, true);
                var blade = bat.Blade.GetComponent<MeshFilter>().sharedMesh;
                var width = blade.vertices.Max(vertex => vertex.x) - blade.vertices.Min(vertex => vertex.x);
                TestContext.WriteLine("Procedural blade (" + quality + ") width " + (width * 100f).ToString("F3") + " cm");
                Assert.That(width, Is.LessThanOrEqualTo(law5 + 1e-6f), "procedural blade " + quality);
            }

            foreach (var detail in new[] { ProductionCharacterDetail.High, ProductionCharacterDetail.Low })
            {
                ProductionCharacterRig rig = null;
                try
                {
                    rig = ProductionCharacterFactory.Create(host.transform,
                        ProductionCharacterSpec.For(ProductionCharacterRole.Batter, detail));
                    var part = rig.FindPart("HeroCricketBatMesh");
                    if (part == null) continue;
                    var mesh = part.GetComponent<MeshFilter>().sharedMesh;
                    var vertices = mesh.vertices;
                    var width = vertices.Max(vertex => vertex.x) - vertices.Min(vertex => vertex.x);
                    var scale = part.lossyScale.x / host.transform.lossyScale.x;
                    TestContext.WriteLine("Hero bat (" + detail + ") mesh width " + (width * 100f).ToString("F3") +
                                          " cm, drawn at scale " + scale.ToString("F4"));
                    Assert.That(width, Is.LessThanOrEqualTo(law5 + 1e-6f), "hero bat mesh " + detail);
                    Assert.That(width * scale, Is.LessThanOrEqualTo(law5 + 1e-5f),
                        "the bat as drawn (mesh width × the rig's scale) " + detail);
                }
                finally
                {
                    rig?.Dispose();
                }
            }
        }

        [Test]
        public void DaySun_IsTheWebStagesSun_BehindTheBatter_SoTheBatterSeesTheLitFaceOfTheBall()
        {
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "..", ".."));
            var stadium = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/render3d/three/stadium.ts"));
            var match = System.Text.RegularExpressions.Regex.Match(stadium,
                @"\n  day: \{\s*clear: \{[^}]*sun: \{ azimuth: deg\(([0-9.]+)\), elevation: deg\(([0-9.]+)\)");
            Assert.That(match.Success, Is.True, "the web stage's day sun");
            Assert.That(float.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
                Is.EqualTo(ProductionEnvironmentLook.DaySunAzimuthDegrees));
            Assert.That(float.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture),
                Is.EqualTo(ProductionEnvironmentLook.DaySunElevationDegrees));

            foreach (var sky in new[] { ProductionSky.Clear, ProductionSky.LightOvercast })
            {
                var environment = ProductionCricketEnvironment.Create(host.transform, new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Standard, "balanced", "white", ProductionLight.Day, sky));
                try
                {
                    var key = environment.Root.transform.Find("ProductionEnvironmentKeyLight");
                    var towardSun = -key.forward;
                    Assert.That(towardSun.z, Is.GreaterThan(0.25f),
                        "the sun is behind the batter, who looks down -z at the bowler (" + sky + ")");
                    Assert.That(Mathf.Asin(towardSun.y) * Mathf.Rad2Deg,
                        Is.EqualTo(ProductionEnvironmentLook.DaySunElevationDegrees).Within(0.01f));
                    Assert.That(Mathf.Atan2(towardSun.x, towardSun.z) * Mathf.Rad2Deg,
                        Is.EqualTo(ProductionEnvironmentLook.DaySunAzimuthDegrees).Within(0.01f));
                    // The face of a ball the batter sees (normal +z) takes direct sun.
                    Assert.That(Vector3.Dot(Vector3.forward, towardSun), Is.GreaterThan(0f));
                }
                finally
                {
                    environment.Dispose();
                }
            }
        }

        [Test]
        public void LateAfternoonSun_IsTheWebStagesSun_AndTheSkyPanoramaGlowsWhereItShines()
        {
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "..", ".."));
            var stadium = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/render3d/three/stadium.ts"));
            var match = System.Text.RegularExpressions.Regex.Match(stadium,
                @"\n  late_afternoon: \{\s*clear: \{[^}]*sun: \{ azimuth: deg\(([0-9.]+)\), elevation: deg\(([0-9.]+)\)");
            Assert.That(match.Success, Is.True, "the web stage's late-afternoon sun");
            Assert.That(float.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
                Is.EqualTo(ProductionEnvironmentLook.LateAfternoonSunAzimuthDegrees));
            Assert.That(float.Parse(match.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture),
                Is.EqualTo(ProductionEnvironmentLook.LateAfternoonSunElevationDegrees));
            // TEXTURES paints the panorama's glow round the same direction (scripts/unity-textures/textures/sky.mjs).
            var sky = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "scripts/unity-textures/textures/sky.mjs"));
            Assert.That(sky, Does.Contain("const SUN_AZ = (104 * Math.PI) / 180;"));
            Assert.That(sky, Does.Contain("const SUN_EL = (15 * Math.PI) / 180;"));

            var environment = ProductionCricketEnvironment.Create(host.transform, new ProductionEnvironmentSpec(
                PracticePresentationQuality.Standard, "balanced", "white", ProductionLight.LateAfternoon));
            try
            {
                var towardSun = -environment.Root.transform.Find("ProductionEnvironmentKeyLight").forward;
                Assert.That(Mathf.Asin(towardSun.y) * Mathf.Rad2Deg,
                    Is.EqualTo(ProductionEnvironmentLook.LateAfternoonSunElevationDegrees).Within(0.01f));
                Assert.That(Mathf.Atan2(towardSun.x, towardSun.z) * Mathf.Rad2Deg,
                    Is.EqualTo(ProductionEnvironmentLook.LateAfternoonSunAzimuthDegrees).Within(0.01f));
                Assert.That(environment.UsesSkyPanorama, Is.True);
            }
            finally
            {
                environment.Dispose();
            }
        }

        [Test]
        public void BallShade_IsTheWebShade_DarkNeverAGlow_OnTheSightLine_AtTheSameApparentSize()
        {
            var root = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "..", ".."));
            var look = System.IO.File.ReadAllText(System.IO.Path.Combine(root, "src/render3d/practice/ballLook.ts"));
            Assert.That(look, Does.Contain("shade: Object.freeze({ px: 12, rimPx: 1.25, rimOpacity: 0.86, opacity: 0.62, color: '#05060f' })"));
            Assert.That(ProductionDeliveryEffects.ShadePixels, Is.EqualTo(12f));
            Assert.That(ProductionDeliveryEffects.ShadeRimPixels, Is.EqualTo(1.25f));
            Assert.That(ProductionDeliveryEffects.ShadeRimOpacity, Is.EqualTo(0.86f));
            Assert.That(ProductionDeliveryEffects.ShadeOpacity, Is.EqualTo(0.62f));
            Assert.That((Color32)ProductionDeliveryEffects.ShadeColour, Is.EqualTo(new Color32(5, 6, 15, 255)));

            foreach (var quality in new[]
                     {
                         PracticePresentationQuality.Lite, PracticePresentationQuality.Standard,
                         PracticePresentationQuality.High
                     })
            foreach (var reducedMotion in new[] { false, true })
            {
                var effects = ProductionDeliveryEffects.Create(host.transform, quality, reducedMotion);
                try
                {
                    var flight = new BallTraceSample[8];
                    for (var index = 0; index < flight.Length; index++)
                        flight[index] = new BallTraceSample
                        {
                            t = index * 0.05,
                            p = new TraceVector3 { x = 0.02 * index, y = 1.8 - 0.2 * index, z = -9 + 2.0 * index },
                            v = new TraceVector3 { x = 0.4, y = -4, z = 40 }
                        };
                    effects.BeginDelivery(flight, new ProductionDeliveryEffectsPolicy(false, false, false));
                    var camera = new Vector3(0.1f, 1.62f, 10.2f);
                    var rotation = Quaternion.LookRotation(new Vector3(0f, -0.17f, -1f));
                    const float verticalFov = 28f;
                    const int height = 824;
                    var ball = new Vector3(0.35f, 0.05f, 2.0f);
                    effects.SetBallPose(ball, camera, rotation, verticalFov, height);
                    Assert.That(effects.ShadeTransform.gameObject.activeInHierarchy, Is.False, "never before release");
                    effects.MarkReleased();
                    effects.SetBallPose(ball, camera, rotation, verticalFov, height);
                    Assert.That(effects.ShadeTransform.gameObject.activeInHierarchy, Is.True, quality.ToString());

                    // On the ball's sight line, ShadeCameraPull of the way to the camera.
                    var centre = effects.ShadeTransform.position;
                    var expectedCentre = Vector3.Lerp(ball, camera, ProductionDeliveryEffects.ShadeCameraPull);
                    Assert.That(Vector3.Distance(centre, expectedCentre), Is.LessThan(1e-4f));
                    Assert.That(Vector3.Dot(effects.ShadeTransform.forward, rotation * Vector3.forward),
                        Is.GreaterThan(0.9999f), "camera-facing");

                    // Every ring keeps the web's apparent size: the ball's edge plus its CSS px offset.
                    var forward = rotation * Vector3.forward;
                    var ballDepth = Vector3.Dot(ball - camera, forward);
                    var worldUnitsPerPixel = 2f * ballDepth * Mathf.Tan(verticalFov * Mathf.Deg2Rad * 0.5f) / height;
                    var css = ProductionDeliveryEffects.ShadeCssPixelScale(height);
                    Assert.That(css, Is.EqualTo(2f).Within(1e-5f), "824 px tall = two pixels per reference CSS px");
                    var vertices = effects.ShadeMesh.vertices;
                    var colours = effects.ShadeMesh.colors;
                    var shadeDepth = Vector3.Dot(centre - camera, forward);
                    var innerPixels = float.MaxValue;
                    var outerPixels = 0f;
                    foreach (var vertex in vertices)
                    {
                        var world = effects.ShadeTransform.TransformPoint(vertex);
                        var apparent = Vector3.Distance(world, centre) * ballDepth / shadeDepth / worldUnitsPerPixel;
                        innerPixels = Mathf.Min(innerPixels, apparent);
                        outerPixels = Mathf.Max(outerPixels, apparent);
                    }
                    var ballPixels = effects.ReadabilityWorldRadius / worldUnitsPerPixel;
                    Assert.That(innerPixels, Is.EqualTo(ballPixels).Within(0.01f), "the hole is the ball: no shade on it");
                    Assert.That(outerPixels, Is.EqualTo(ballPixels + 12f * css).Within(0.01f));
                    Assert.That(effects.ShadeProjectedDiameterPixels, Is.EqualTo(2f * outerPixels).Within(0.02f));

                    // Dark everywhere, rim then a smooth fall to nothing: within 0.02 of the web's curve between rings.
                    var maxAlpha = 0f;
                    foreach (var colour in colours)
                    {
                        Assert.That(0.2126f * colour.r + 0.7152f * colour.g + 0.0722f * colour.b, Is.LessThan(0.03f),
                            "a shadow, never a glow");
                        maxAlpha = Mathf.Max(maxAlpha, colour.a);
                    }
                    Assert.That(maxAlpha, Is.EqualTo(0.86f).Within(1e-6f));
                    Assert.That(colours[0].a, Is.EqualTo(0.86f).Within(1e-6f), "the rim at the ball's edge");
                    Assert.That(colours[colours.Length - 1].a, Is.EqualTo(0f).Within(1e-6f), "gone 12 px out");
                    for (var px = 1.3f; px < 12f; px += 0.05f)
                    {
                        var target = ballPixels + px * css;
                        // The ring vertices bracketing this apparent radius, along the first spoke.
                        var lower = 0;
                        for (var index = 0; index < vertices.Length; index += 24)
                            if (Vector3.Distance(effects.ShadeTransform.TransformPoint(vertices[index]), centre) *
                                ballDepth / shadeDepth / worldUnitsPerPixel <= target) lower = index;
                        var upper = Mathf.Min(lower + 24, vertices.Length - 24);
                        var r0 = Vector3.Distance(effects.ShadeTransform.TransformPoint(vertices[lower]), centre) *
                                 ballDepth / shadeDepth / worldUnitsPerPixel;
                        var r1 = Vector3.Distance(effects.ShadeTransform.TransformPoint(vertices[upper]), centre) *
                                 ballDepth / shadeDepth / worldUnitsPerPixel;
                        var drawn = r1 > r0
                            ? Mathf.Lerp(colours[lower].a, colours[upper].a, (target - r0) / (r1 - r0))
                            : colours[lower].a;
                        Assert.That(drawn, Is.EqualTo(ProductionDeliveryEffects.ShadeOpacityAt(px)).Within(0.02f),
                            px + " CSS px");
                    }

                    effects.MarkDead();
                    Assert.That(effects.ShadeTransform.gameObject.activeInHierarchy, Is.False, "gone with the dead ball");
                }
                finally
                {
                    effects.Dispose();
                }
            }
        }

        private static void Hsl(Color colour, out float saturation, out float lightness)
        {
            var max = Mathf.Max(colour.r, Mathf.Max(colour.g, colour.b));
            var min = Mathf.Min(colour.r, Mathf.Min(colour.g, colour.b));
            lightness = (max + min) / 2f;
            var chroma = max - min;
            saturation = chroma <= 0f ? 0f : chroma / (1f - Mathf.Abs(2f * lightness - 1f));
        }
    }
}
