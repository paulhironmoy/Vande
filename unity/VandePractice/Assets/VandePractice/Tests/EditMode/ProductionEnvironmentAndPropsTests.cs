using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    public sealed class ProductionEnvironmentAndPropsTests
    {
        private GameObject host;

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("ProductionEnvironment-TestHost");
        }

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
        }

        [Test]
        public void PitchLooks_MatchAuthoritativePhysicsMetadata_AndUnknownFallsBack()
        {
            AssertLook("balanced", 0.60f, 0.30f, 0.014f, 0.55f, 1.00f);
            AssertLook("green", 0.58f, 0.27f, 0.026f, 0.45f, 1.45f);
            AssertLook("hard", 0.67f, 0.25f, 0.012f, 0.50f, 0.85f);
            AssertLook("turning", 0.55f, 0.40f, 0.012f, 0.95f, 0.80f);
            Assert.That(ProductionPitchLooks.For("not-a-condition").Key, Is.EqualTo("balanced"));
        }

        [Test]
        public void Environment_BuildsLawScaleFieldAndRetainedPreUnityStructures_WithoutColliders()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Standard,
                    "balanced",
                    "white"));

            Assert.That(environment.PitchCondition, Is.EqualTo("balanced"));
            Assert.That(environment.PitchRenderer, Is.Not.Null);
            Assert.That(environment.PitchRenderer.sharedMaterial.mainTexture, Is.Not.Null,
                "the original generated pitch texture should be loaded once at build time");
            var pitchBounds = environment.PitchRenderer.GetComponent<MeshFilter>().sharedMesh.bounds.size;
            Assert.That(pitchBounds.x, Is.EqualTo(CricketEnvironmentDimensions.PitchWidth).Within(0.001f));
            Assert.That(pitchBounds.z,
                Is.EqualTo(CricketEnvironmentDimensions.PitchHalf * 2f).Within(0.001f));
            var outfield = environment.Root.transform.Find("Outfield-Mown")
                .GetComponent<Renderer>();
            Assert.That(outfield.sharedMaterials, Has.Length.EqualTo(2));
            Assert.That(outfield.sharedMaterials[0].mainTexture, Is.Not.Null);
            Assert.That(outfield.shadowCastingMode,
                Is.EqualTo(UnityEngine.Rendering.ShadowCastingMode.Off),
                "the flat outfield must not spend fill rate casting a shadow");
            Assert.That(outfield.receiveShadows, Is.True,
                "standard players and ball should remain grounded by received shadows");

            Assert.That(environment.CreaseMarkings, Is.Not.Null);
            var creaseMesh = environment.CreaseMarkings.GetComponent<MeshFilter>().sharedMesh;
            var creaseBounds = creaseMesh.bounds;
            Assert.That(creaseBounds.max.x,
                Is.EqualTo(CricketEnvironmentDimensions.PoppingCreaseHalfWidth).Within(0.002f),
                "the popping crease must extend at least six feet from the middle on both sides");
            Assert.That(creaseBounds.max.z,
                Is.EqualTo(CricketEnvironmentDimensions.PitchHalf -
                           CricketEnvironmentDimensions.PoppingCrease +
                           CricketEnvironmentDimensions.ReturnCreaseLength).Within(0.002f));
            Assert.That(creaseBounds.size.y, Is.LessThan(0.0001f),
                "crease paint must be planar rather than raised boxes with bright side faces");
            for (var index = 0; index < creaseMesh.normals.Length; index++)
                Assert.That(Vector3.Dot(creaseMesh.normals[index], Vector3.up),
                    Is.GreaterThan(0.999f));

            foreach (var detailName in new[]
                     {
                         "PitchWearAndFootmarks",
                         "PitchGrassCover",
                         "PitchCracksAndRough"
                     })
            {
                var detailBounds = environment.Root.transform.Find(detailName)
                    .GetComponent<MeshFilter>().sharedMesh.bounds;
                Assert.That(detailBounds.max.y, Is.LessThan(creaseBounds.min.y),
                    detailName + " must never fragment or cover legal crease paint");
            }

            var ringMesh = environment.FieldingRing.GetComponent<MeshFilter>().sharedMesh;
            Assert.That(ringMesh.bounds.size.y, Is.LessThan(0.0001f),
                "the 30-yard marking should be flat paint, not a faceted reflective tube");
            for (var index = 0; index < ringMesh.normals.Length; index++)
                Assert.That(Vector3.Dot(ringMesh.normals[index], Vector3.up),
                    Is.GreaterThan(0.999f));

            Assert.That(environment.BowlerWicket.Root.transform.localPosition.z,
                Is.EqualTo(-CricketEnvironmentDimensions.PitchHalf).Within(0.0001f));
            Assert.That(environment.StrikerWicket.Root.transform.localPosition.z,
                Is.EqualTo(CricketEnvironmentDimensions.PitchHalf).Within(0.0001f));
            Assert.That(environment.BoundaryRope, Is.Not.Null);
            Assert.That(environment.FieldingRing, Is.Not.Null);
            Assert.That(environment.SightScreens, Is.Not.Null);
            Assert.That(environment.SkyDome, Is.Not.Null);
            Assert.That(environment.Stadium.Find("LowerSeatingTier"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("UpperSeatingTier"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("BoundaryCushions"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("LowerStandFascia"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("LowerTierRail"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("UpperTierRail"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("PavilionAndScoreboard"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("ScoreboardFace"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("ScoreboardInformation"), Is.Not.Null);
            Assert.That(environment.Stadium.Find("FloodlightTowers"), Is.Not.Null);
            Assert.That(environment.StadiumReverb, Is.Not.Null);
            Assert.That(environment.StadiumReverb.reverbPreset, Is.EqualTo(AudioReverbPreset.User));
            Assert.That(environment.StadiumReverb.maxDistance,
                Is.GreaterThan(CricketEnvironmentDimensions.BoundaryRadius));
            Assert.That(environment.Crowd.Count, Is.EqualTo(768));
            var crowdMesh = environment.Stadium.Find("CrowdSection-0/Spectators")
                .GetComponent<MeshFilter>().sharedMesh;
            Assert.That(crowdMesh.bounds.max.y, Is.GreaterThan(14f),
                "standard crowd depth should occupy both retained stadium tiers");
            var keyLight = environment.Root.transform.Find("ProductionEnvironmentKeyLight")
                .GetComponent<Light>();
            Assert.That(keyLight.shadows, Is.EqualTo(LightShadows.Soft));
            Assert.That(environment.Root.GetComponentsInChildren<Collider>(true), Is.Empty,
                "presentation geometry must not add a second collision authority");
            Assert.That(environment.MeshVertexCount, Is.LessThan(24000),
                "the standard source-only environment should stay inside its procedural mobile mesh budget");

            environment.Dispose();
            Assert.That(environment.IsDisposed, Is.True);
            Assert.That(host.transform.childCount, Is.EqualTo(0));
        }

        [Test]
        public void LateAfternoonSky_UsesRegisteredInwardPanorama_AndRestoresGlobalAtmosphere()
        {
            var priorFog = RenderSettings.fog;
            var priorFogColour = RenderSettings.fogColor;
            ProductionCricketEnvironment environment = null;
            try
            {
                environment = ProductionCricketEnvironment.Create(
                    host.transform,
                    new ProductionEnvironmentSpec(
                        PracticePresentationQuality.Lite,
                        "balanced",
                        "white",
                        ProductionLight.LateAfternoon,
                        ProductionSky.Clear));

                Assert.That(environment.UsesSkyPanorama, Is.True);
                Assert.That(environment.StadiumReverb, Is.Null,
                    "Lite devices keep the physical mix dry and avoid realtime reverb DSP");
                var skyRenderer = environment.SkyDome.GetComponent<Renderer>();
                Assert.That(skyRenderer.sharedMaterial.mainTexture, Is.Not.Null);
                Assert.That(skyRenderer.sharedMaterial.mainTexture.name,
                    Is.EqualTo("sky-late-afternoon-panorama"));
                var skyMesh = environment.SkyDome.GetComponent<MeshFilter>().sharedMesh;
                Assert.That(skyMesh.vertexCount, Is.LessThan(300),
                    "Lite sky should remain a small inward dome, not a high-poly sphere");
                Assert.That(Vector3.Dot(skyMesh.vertices[0], skyMesh.normals[0]), Is.LessThan(-100f),
                    "sky normals must face the player inside the dome");
                Assert.That(RenderSettings.fog, Is.True);
                Assert.That(environment.SightScreens.GetComponent<Renderer>()
                    .sharedMaterial.color.maxColorComponent, Is.LessThan(0.1f),
                    "white-ball contrast remains protected in the panorama look");

                var cameraObject = new GameObject("AtmosphereTestCamera");
                cameraObject.transform.SetParent(host.transform, false);
                var camera = cameraObject.AddComponent<Camera>();
                environment.ConfigureCamera(camera);
                Assert.That(camera.clearFlags, Is.EqualTo(CameraClearFlags.SolidColor));
                Assert.That(camera.allowHDR, Is.False);
                Assert.That(camera.backgroundColor.maxColorComponent, Is.GreaterThan(0.2f));
            }
            finally
            {
                environment?.Dispose();
            }

            Assert.That(RenderSettings.fog, Is.EqualTo(priorFog));
            Assert.That(RenderSettings.fogColor, Is.EqualTo(priorFogColour));
        }

        [Test]
        public void DayEnvironment_UsesOriginalDepthTestedStadiumFacade_BeyondBoundary()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Standard,
                    "balanced",
                    "white",
                    ProductionLight.Day,
                    ProductionSky.Clear));

            Assert.That(environment.UsesStadiumBackdrop, Is.True);
            Assert.That(environment.StadiumBackdrop, Is.Not.Null);
            Assert.That(environment.StadiumBackdrop.localPosition.z,
                Is.EqualTo(-CricketEnvironmentDimensions.StadiumBackdropDistance).Within(0.001f));
            Assert.That(environment.StadiumBackdrop.localPosition.y,
                Is.EqualTo(CricketEnvironmentDimensions.StadiumBackdropCenterY).Within(0.001f));
            Assert.That(Mathf.Abs(environment.StadiumBackdrop.localPosition.z),
                Is.GreaterThan(CricketEnvironmentDimensions.BoundaryRadius));
            Assert.That(Mathf.Abs(environment.StadiumBackdrop.localPosition.z),
                Is.LessThan(CricketEnvironmentDimensions.SightScreenDistance),
                "the facade hides the old far shell but can reveal the physical red-ball sight screen through its cutout");

            var renderer = environment.StadiumBackdrop.GetComponent<Renderer>();
            Assert.That(renderer.sharedMaterial.shader.name,
                Is.EqualTo("Vande/Practice/StadiumBackdrop"));
            Assert.That(renderer.sharedMaterial.mainTexture, Is.Not.Null);
            Assert.That(renderer.sharedMaterial.mainTexture.name,
                Is.EqualTo("stadium-day-background-v2"));
            Assert.That(renderer.sharedMaterial.GetFloat("_ScreenCutout"), Is.EqualTo(0f));
            var screenBounds = renderer.sharedMaterial.GetVector("_ScreenBounds");
            Assert.That(screenBounds, Is.EqualTo(
                ProductionCricketEnvironment.StadiumBackdropScreenUvBounds()));
            Assert.That(screenBounds.x, Is.InRange(0.40f, 0.41f));
            Assert.That(screenBounds.y, Is.InRange(0.59f, 0.60f));
            Assert.That(screenBounds.z, Is.InRange(0.24f, 0.27f));
            Assert.That(screenBounds.w, Is.InRange(0.44f, 0.47f));
            Assert.That(renderer.sharedMaterial.GetFloat("_CrowdReveal"), Is.GreaterThan(0f),
                "the emotion-driven 3D crowd must remain visible through the static facade band");
            Assert.That(renderer.sharedMaterial.GetFloat("_HorizonHaze"),
                Is.InRange(0.01f, 0.15f),
                "the original facade should share restrained realtime atmosphere grading");
            Assert.That(renderer.sharedMaterial.GetFloat("_FieldBlend"),
                Is.InRange(0.01f, 0.25f),
                "the facade field and realtime outfield should not expose a hard colour seam");
            Assert.That(renderer.sharedMaterial.GetColor("_Tint").maxColorComponent,
                Is.LessThan(1f),
                "the photographic facade must not sit at a brighter exposure than the field");

            var daylightOutfield = environment.Root.transform.Find("Outfield-Mown")
                .GetComponent<Renderer>().sharedMaterials;
            for (var index = 0; index < daylightOutfield.Length; index++)
            {
                Assert.That(daylightOutfield[index].GetFloat("_Saturation"),
                    Is.InRange(0.25f, 0.45f),
                    "daylight grass must remain inside the restrained palette bound");
                Assert.That(daylightOutfield[index].GetFloat("_AlbedoGain"),
                    Is.InRange(0.65f, 0.82f),
                    "daylight grass must not overpower the stadium exposure");
            }

            var daylightPitch = environment.PitchRenderer.sharedMaterial;
            Assert.That(daylightPitch.GetFloat("_Saturation"), Is.LessThanOrEqualTo(0.45f));
            Assert.That(daylightPitch.GetFloat("_AlbedoGain"), Is.LessThanOrEqualTo(0.65f));
            Assert.That(Mathf.Abs(daylightPitch.color.r - daylightPitch.color.b),
                Is.LessThan(0.12f),
                "balanced pitch tint must not reintroduce a strong yellow cast");
            Assert.That(renderer.shadowCastingMode,
                Is.EqualTo(UnityEngine.Rendering.ShadowCastingMode.Off));
            Assert.That(renderer.receiveShadows, Is.False);
            Assert.That(environment.StadiumBackdrop.GetComponent<Collider>(), Is.Null);

            var backdropMesh = environment.StadiumBackdrop.GetComponent<MeshFilter>().sharedMesh;
            var bounds = backdropMesh.bounds;
            var expectedChordWidth = 2f * CricketEnvironmentDimensions.StadiumBackdropDistance *
                Mathf.Sin(CricketEnvironmentDimensions.StadiumBackdropHalfAngleRadians);
            Assert.That(bounds.size.x,
                Is.EqualTo(expectedChordWidth).Within(0.001f));
            Assert.That(bounds.size.y,
                Is.EqualTo(CricketEnvironmentDimensions.StadiumBackdropWidth /
                           CricketEnvironmentDimensions.StadiumBackdropAspect).Within(0.001f));
            Assert.That(backdropMesh.vertexCount,
                Is.EqualTo((CricketEnvironmentDimensions.StadiumBackdropArcSegments + 1) * 2));
            Assert.That(backdropMesh.triangles.Length / 3,
                Is.EqualTo(CricketEnvironmentDimensions.StadiumBackdropArcSegments * 2));
            var backdropVertices = backdropMesh.vertices;
            var backdropNormals = backdropMesh.normals;
            for (var index = 0; index < backdropVertices.Length; index++)
            {
                var worldX = backdropVertices[index].x;
                var worldZ = backdropVertices[index].z -
                    CricketEnvironmentDimensions.StadiumBackdropDistance;
                Assert.That(Mathf.Sqrt(worldX * worldX + worldZ * worldZ),
                    Is.EqualTo(CricketEnvironmentDimensions.StadiumBackdropDistance).Within(0.001f),
                    "every facade vertex must stay on the 64.8 m inward arc");
                Assert.That(Vector3.Dot(
                    new Vector3(worldX, 0f, worldZ).normalized,
                    backdropNormals[index]),
                    Is.LessThan(-0.999f),
                    "every facade normal must face into the field");
            }
            Assert.That(CricketEnvironmentDimensions.StadiumBackdropDistance,
                Is.LessThan(70f),
                "the complete facade arc must remain closer to the camera than the lower seating tier");

            environment.SetSightScreensForBall("red");
            Assert.That(renderer.sharedMaterial.GetFloat("_ScreenCutout"), Is.EqualTo(1f));
            environment.SetSightScreensForBall("white");
            Assert.That(renderer.sharedMaterial.GetFloat("_ScreenCutout"), Is.EqualTo(0f));

            environment.Dispose();
        }

        [Test]
        public void EveningEnvironment_DoesNotMixInDaylightFacade()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Standard,
                    "balanced",
                    "white",
                    ProductionLight.Evening,
                    ProductionSky.Clear));

            Assert.That(environment.UsesStadiumBackdrop, Is.False);
            Assert.That(environment.StadiumBackdrop, Is.Null);
            environment.Dispose();
        }

        [Test]
        public void PitchSightScreenAndCrowdHooks_ApplyOnlyPresentationState()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Lite,
                    "green",
                    "red",
                    reducedMotion: false));
            var cracks = environment.Root.transform.Find("PitchCracksAndRough");
            var grass = environment.Root.transform.Find("PitchGrassCover");
            Assert.That(grass.gameObject.activeSelf, Is.True);
            Assert.That(cracks.gameObject.activeSelf, Is.False);

            environment.ApplyPitchCondition("turning");
            Assert.That(environment.PitchCondition, Is.EqualTo("turning"));
            Assert.That(grass.gameObject.activeSelf, Is.False);
            Assert.That(cracks.gameObject.activeSelf, Is.True);

            environment.SetSightScreensForBall("white");
            var screenColour = environment.SightScreens.GetComponent<Renderer>().sharedMaterial.color;
            Assert.That(screenColour.maxColorComponent, Is.LessThan(0.1f));
            environment.SetSightScreensForBall("red");
            screenColour = environment.SightScreens.GetComponent<Renderer>().sharedMaterial.color;
            Assert.That(screenColour.maxColorComponent, Is.GreaterThan(0.8f));

            var firstSection = environment.Stadium.Find("CrowdSection-0");
            environment.SetCrowdEmotion(0.8f, 1f, Vector3.forward * 50f);
            Assert.That(firstSection.localPosition.y, Is.GreaterThan(0f));
            environment.SetDeliveryQuiet(true);
            Assert.That(firstSection.localPosition, Is.EqualTo(Vector3.zero));
            environment.SetCrowdEmotion(1f, 1f);
            Assert.That(firstSection.localPosition, Is.EqualTo(Vector3.zero),
                "Delivery Quiet Mode must freeze decorative crowd movement");
            environment.SetDeliveryQuiet(false);
            environment.SetCrowdEmotion(0f, 0.1f);
            Assert.That(firstSection.localPosition, Is.EqualTo(Vector3.zero),
                "the crowd remains still at a hush");

            environment.Dispose();
        }

        [Test]
        public void CrowdReset_ClearsPendingOutcomeMotionAndRestoresBaseColours()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Lite,
                    "balanced",
                    "white",
                    reducedMotion: false));
            var firstSection = environment.Stadium.Find("CrowdSection-0");
            var renderer = firstSection.Find("Spectators").GetComponent<Renderer>();
            var materials = renderer.sharedMaterials;
            var baseColours = new Color[materials.Length];
            for (var index = 0; index < materials.Length; index++)
                baseColours[index] = materials[index].color;

            environment.SetCrowdEmotion(-0.9f, 1f, Vector3.forward * 50f);
            Assert.That(firstSection.localPosition.y, Is.GreaterThan(0f));
            Assert.That(materials[0].color, Is.Not.EqualTo(baseColours[0]));
            environment.SetDeliveryQuiet(true);
            environment.ResetDeliveryConsequences();
            environment.SetDeliveryQuiet(false);

            Assert.That(firstSection.localPosition, Is.EqualTo(Vector3.zero),
                "ending Quiet Mode must not replay the prior outcome motion");
            Assert.That(firstSection.localRotation, Is.EqualTo(Quaternion.identity));
            for (var index = 0; index < materials.Length; index++)
                Assert.That(materials[index].color, Is.EqualTo(baseColours[index]),
                    "crowd shirt tint must return to its base colour");

            environment.Dispose();
        }

        [Test]
        public void Props_KeepLawDimensionsSeparatePartsAndDeterministicCleanup()
        {
            var wicket = ProductionCricketProps.CreateWicket(
                host.transform, "TestWicket", ProductionPropQuality.High, true);
            Assert.That(wicket.Stumps, Has.Length.EqualTo(3));
            Assert.That(wicket.Bails, Has.Length.EqualTo(2));
            Assert.That(wicket.Stumps[0].localPosition.x,
                Is.EqualTo(-CricketPropDimensions.StumpSpacing).Within(0.0001f));
            Assert.That(wicket.Stumps[2].localPosition.x,
                Is.EqualTo(CricketPropDimensions.StumpSpacing).Within(0.0001f));
            Assert.That(wicket.Bails[0].localPosition.y,
                Is.EqualTo(CricketPropDimensions.BailAxisHeight).Within(0.0001f));
            var stumpBounds = wicket.Stumps[1].GetComponent<MeshFilter>().sharedMesh.bounds;
            Assert.That(stumpBounds.max.y,
                Is.EqualTo(CricketPropDimensions.StumpHeight).Within(0.004f));

            var bat = ProductionCricketProps.CreateBat(
                host.transform, "TestBat", ProductionPropQuality.High, true);
            var bladeBounds = bat.Blade.GetComponent<MeshFilter>().sharedMesh.bounds;
            Assert.That(bladeBounds.size.x,
                Is.EqualTo(CricketPropDimensions.BladeWidth).Within(0.004f));
            Assert.That(bat.SweetSpotLocal.y,
                Is.EqualTo(-CricketPropDimensions.TotalBatLength +
                           CricketPropDimensions.SweetSpotFractionFromToe *
                           CricketPropDimensions.BladeLength).Within(0.0001f));
            Assert.That(bat.Blade.GetComponent<Renderer>().sharedMaterial.mainTexture, Is.Not.Null,
                "the original generated willow texture should be reused");

            var ball = ProductionCricketProps.CreateBall(
                host.transform, "TestBall", ProductionPropQuality.High, true);
            var body = ball.Root.transform.Find("ShineOrientation/LawScaleBallBody");
            var bodyMesh = body.GetComponent<MeshFilter>().sharedMesh;
            Assert.That(bodyMesh.subMeshCount, Is.EqualTo(2),
                "the rough and polished hemispheres must remain visually distinct");
            Assert.That(bodyMesh.bounds.extents.x,
                Is.EqualTo(CricketPropDimensions.BallRadius).Within(0.001f));
            var ballMaterials = body.GetComponent<Renderer>().sharedMaterials;
            Assert.That(ballMaterials, Has.Length.EqualTo(2));
            Assert.That(ballMaterials[0].GetFloat("_Smoothness"), Is.LessThan(0.2f),
                "the rough hemisphere should scatter highlights");
            Assert.That(ballMaterials[1].GetFloat("_Smoothness"), Is.GreaterThan(0.75f),
                "the polished hemisphere should carry a readable moving highlight");
            ball.SetAppearance("white", "worn");
            Assert.That(ballMaterials[1].GetFloat("_Smoothness"), Is.EqualTo(0.58f).Within(0.001f),
                "wear should reduce the polished response without erasing the canonical shiny side");
            Assert.That(ball.Root.transform.Find("SeamOrientation/RaisedDoubleSeam"), Is.Not.Null);
            ball.ConfigureOrientation(Vector3.up, Vector3.right);
            ball.SetPose(new Vector3(1f, 2f, 3f), Vector3.up, 15.0, 0.25);
            Assert.That(ball.Root.transform.position, Is.EqualTo(new Vector3(1f, 2f, 3f)));

            wicket.Dispose();
            bat.Dispose();
            ball.Dispose();
            Assert.That(wicket.IsDisposed && bat.IsDisposed && ball.IsDisposed, Is.True);
            Assert.That(host.transform.childCount, Is.EqualTo(0));
        }

        [Test]
        public void BallOrientation_UprightSeamMatchesBallRotationAndCarriesThroughBounce()
        {
            var ball = ProductionCricketProps.CreateBall(
                host.transform, "UprightSeamBall", ProductionPropQuality.Standard, false);
            var body = ball.Root.transform.Find("ShineOrientation");
            var seam = ball.Root.transform.Find("SeamOrientation");
            var seamAxis = Vector3.right;
            var releaseSpin = Vector3.back * (10f * Mathf.PI * 2f);
            var afterBounceSpin = Vector3.left * (3f * Mathf.PI * 2f);
            const double bounceT = 0.4;
            var baseOrientation = Quaternion.FromToRotation(Vector3.forward, Vector3.right);

            Assert.That(ProductionBallVisual.UsesUprightSeamRotation(
                seamAxis, releaseSpin, 0.0), Is.True);
            ball.ConfigureFlightOrientation(
                seamAxis,
                Vector3.right,
                0.0,
                releaseSpin,
                afterBounceSpin,
                bounceT,
                false);

            ball.SetPose(Vector3.zero, 0.2);
            var expectedBefore = Quaternion.AngleAxis(6f * 360f * 0.2f, Vector3.right) *
                                 baseOrientation;
            Assert.That(Quaternion.Angle(body.localRotation, expectedBefore), Is.LessThan(0.001f));
            Assert.That(Quaternion.Angle(seam.localRotation, expectedBefore), Is.LessThan(0.001f));

            ball.SetPose(Vector3.zero, 0.65);
            var carried = Quaternion.AngleAxis(6f * 360f * (float)bounceT, Vector3.right);
            var after = Quaternion.AngleAxis(3f * 360f * 0.25f, Vector3.left);
            var expectedAfter = after * carried * baseOrientation;
            Assert.That(Quaternion.Angle(body.localRotation, expectedAfter), Is.LessThan(0.001f));
            Assert.That(Quaternion.Angle(seam.localRotation, expectedAfter), Is.LessThan(0.001f),
                "the complete seam/shine surface must be carried to the bounce before the new spin applies");

            ball.Dispose();
        }

        [Test]
        public void BallOrientation_ScrambledSeamUsesAuthoritativePreAndPostBounceSpinAxes()
        {
            var ball = ProductionCricketProps.CreateBall(
                host.transform, "ScrambledSeamBall", ProductionPropQuality.Standard, false);
            var body = ball.Root.transform.Find("ShineOrientation");
            var baseOrientation = Quaternion.FromToRotation(Vector3.forward, Vector3.right);
            var releaseSpin = Vector3.forward * (4f * Mathf.PI * 2f);
            var afterBounceSpin = Vector3.up * (5f * Mathf.PI * 2f);
            const double bounceT = 0.3;

            Assert.That(ProductionBallVisual.UsesUprightSeamRotation(
                Vector3.right, releaseSpin, 0.55), Is.False);
            ball.ConfigureFlightOrientation(
                Vector3.right,
                Vector3.right,
                0.55,
                releaseSpin,
                afterBounceSpin,
                bounceT,
                false);

            ball.SetPose(Vector3.zero, 0.2);
            var expectedBefore = Quaternion.AngleAxis(4f * 360f * 0.2f, Vector3.forward) *
                                 baseOrientation;
            Assert.That(Quaternion.Angle(body.localRotation, expectedBefore), Is.LessThan(0.001f));

            ball.SetPose(Vector3.zero, 0.45);
            var carried = Quaternion.AngleAxis(4f * 360f * (float)bounceT, Vector3.forward);
            var after = Quaternion.AngleAxis(5f * 360f * 0.15f, Vector3.up);
            Assert.That(Quaternion.Angle(
                    body.localRotation,
                    after * carried * baseOrientation),
                Is.LessThan(0.001f),
                "post-bounce orientation must use flight.spin.afterBounce rather than release spin");

            ball.Dispose();
        }

        [Test]
        public void BallOrientation_AbsoluteSamplingIsIdenticalAtThirtyAndSixtyFps()
        {
            var ball = ProductionCricketProps.CreateBall(
                host.transform, "CadenceParityBall", ProductionPropQuality.Standard, false);
            var body = ball.Root.transform.Find("ShineOrientation");
            var seam = ball.Root.transform.Find("SeamOrientation");
            ball.ConfigureFlightOrientation(
                new Vector3(0.8f, 0f, 0.6f).normalized,
                new Vector3(0.8f, 0f, 0.6f).normalized,
                0.42,
                new Vector3(4f, 9f, -17f),
                new Vector3(-7f, 14f, 3f),
                0.37,
                true);

            for (var frame30 = 0; frame30 <= 30; frame30++)
            {
                var at30 = frame30 / 30.0;
                var at60 = frame30 * 2 / 60.0;
                ball.SetPose(Vector3.zero, at30);
                var bodyAt30 = body.localRotation;
                var seamAt30 = seam.localRotation;
                // Seek through a different time first: orientation must be a
                // pure function of authoritative time, never accumulated frames.
                ball.SetPose(Vector3.zero, 1.0 - at60 * 0.25);
                ball.SetPose(Vector3.zero, at60);
                Assert.That(Quaternion.Angle(bodyAt30, body.localRotation),
                    Is.LessThan(0.0001f), "body frame " + frame30);
                Assert.That(Quaternion.Angle(seamAt30, seam.localRotation),
                    Is.LessThan(0.0001f), "seam frame " + frame30);
            }

            ball.Dispose();
        }

        [Test]
        public void Wicket_ReactsOnlyWhenExplicitlyTriggered_ThenResetsExactly()
        {
            var wicket = ProductionCricketProps.CreateWicket(
                host.transform, "ReactiveWicket", ProductionPropQuality.Standard, false);
            var leftRest = wicket.Bails[0].localPosition;
            var rightRest = wicket.Bails[1].localPosition;
            var middleRest = wicket.Stumps[1].localRotation;

            wicket.TickReaction(1f);
            Assert.That(wicket.IsBroken, Is.False,
                "time alone must not manufacture a wicket consequence");
            Assert.That(wicket.Bails[0].localPosition, Is.EqualTo(leftRest));

            wicket.ReactToAuthoritativeImpact(-0.01f, false);
            Assert.That(wicket.IsBroken, Is.True);
            Assert.That(wicket.DislodgedBailIndex, Is.EqualTo(0));
            wicket.TickReaction(0.36f);
            Assert.That(wicket.Bails[0].localPosition, Is.Not.EqualTo(leftRest));
            Assert.That(wicket.Bails[1].localPosition, Is.EqualTo(rightRest),
                "an authored reaction must not imply an unsupported second bail impact");
            Assert.That(Quaternion.Angle(wicket.Stumps[1].localRotation, middleRest), Is.GreaterThan(0f));

            wicket.TickReaction(1f);
            Assert.That(wicket.Bails[0].localPosition.y, Is.EqualTo(0.018f).Within(0.001f));
            wicket.ResetReaction();
            Assert.That(wicket.IsBroken, Is.False);
            Assert.That(wicket.DislodgedBailIndex, Is.EqualTo(-1));
            Assert.That(wicket.Bails[0].localPosition, Is.EqualTo(leftRest));
            Assert.That(wicket.Bails[1].localPosition, Is.EqualTo(rightRest));
            Assert.That(wicket.Stumps[1].localRotation, Is.EqualTo(middleRest));
            wicket.Dispose();
        }

        [Test]
        public void FieldState_ProjectsCompleteFieldAndTracksOnlyAuthoritativeSamples()
        {
            var state = new ProductionFieldState();
            var field = TestField();
            field[2].X = 30d;
            field[2].Z = 24d;
            state.Configure(field);

            Assert.That(state.Count, Is.EqualTo(11));
            var right = state.NormalizedRadarPoint(2, false);
            var left = state.NormalizedRadarPoint(2, true);
            Assert.That(left.x, Is.EqualTo(1f - right.x).Within(0.0001f));
            Assert.That(left.y, Is.EqualTo(right.y).Within(0.0001f));

            var version = state.Version;
            state.ApplyAuthoritativeSample("fielder-2", new FielderTraceSample
            {
                t = 0.5,
                x = 11d,
                z = -16d,
                action = "run"
            });
            Assert.That(state.Version, Is.EqualTo(version + 1));
            Assert.That(state.Point(2).X, Is.EqualTo(11d));
            Assert.That(state.Point(2).Z, Is.EqualTo(-16d));
            Assert.That(state.Point(2).Action, Is.EqualTo("run"));
            Assert.Throws<BridgeValidationException>(() =>
                state.ApplyAuthoritativeSample("not-in-field", new FielderTraceSample
                {
                    x = 0d,
                    z = 0d,
                    action = "set"
                }));
        }

        [Test]
        public void EnvironmentRebuild_RetainsCanonicalFieldStateForHudBinding()
        {
            var first = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Lite,
                    "balanced",
                    "white"));
            first.ConfigureField(TestField());
            first.ApplyAuthoritativeFielderSample("fielder-2", new FielderTraceSample
            {
                t = 0.4,
                x = 18d,
                z = -7d,
                action = "run"
            });
            var retained = first.FieldState;
            var version = retained.Version;
            first.Dispose();

            var rebuilt = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.High,
                    "balanced",
                    "white"),
                retained);

            Assert.That(rebuilt.FieldState, Is.SameAs(retained));
            Assert.That(rebuilt.FieldState.Version, Is.EqualTo(version));
            Assert.That(rebuilt.FieldState.Point(2).X, Is.EqualTo(18d));
            Assert.That(rebuilt.FieldState.Point(2).Z, Is.EqualTo(-7d));
            rebuilt.Dispose();
        }

        [Test]
        public void Environment_ShowsOnlyCanonicalWicketAndNamedFielderConsequences()
        {
            var environment = ProductionCricketEnvironment.Create(
                host.transform,
                new ProductionEnvironmentSpec(
                    PracticePresentationQuality.Lite,
                    "balanced",
                    "white"));
            environment.ConfigureField(TestField());
            var fielder = new GameObject("NamedFielder");
            fielder.transform.SetParent(host.transform, false);
            fielder.transform.position = new Vector3(8f, 0f, 22f);

            Assert.That(environment.HandleAuthoritativeTraceEvent(
                new CanonicalTraceEvent
                {
                    kind = "contact",
                    p = new TraceVector3 { x = 0d, y = 0.8d, z = 9d }
                }, 1f), Is.False);
            Assert.That(environment.StrikerWicket.IsBroken, Is.False);
            Assert.That(environment.FieldConsequences.Visible, Is.False);

            Assert.That(environment.HandleAuthoritativeTraceEvent(
                new CanonicalTraceEvent
                {
                    kind = "stumps",
                    p = new TraceVector3 { x = 0.08d, y = 0.5d, z = 10.06d }
                }, 1f), Is.True);
            Assert.That(environment.StrikerWicket.IsBroken, Is.True);
            Assert.That(environment.BowlerWicket.IsBroken, Is.False);

            Assert.That(environment.HandleAuthoritativeTraceEvent(
                new CanonicalTraceEvent
                {
                    kind = "field",
                    fielderId = "fielder-2",
                    p = new TraceVector3 { x = 8d, y = 0.1d, z = 22d }
                }, 1f, fielder.transform), Is.True);
            Assert.That(environment.FieldConsequences.Visible, Is.True);
            Assert.That(environment.FieldConsequences.EventKind, Is.EqualTo("field"));
            Assert.That(environment.FieldConsequences.Position.x, Is.EqualTo(8f).Within(0.001f));
            var consequence = environment.Root.transform.Find("AuthoritativeFielderConsequence")
                .GetComponent<Renderer>();
            Assert.That(consequence.sharedMaterial.shader.name,
                Is.EqualTo("Vande/Practice/DeliveryEffects"));
            Assert.That(consequence.sharedMaterial.renderQueue, Is.GreaterThanOrEqualTo(3000));
            Assert.That(consequence.sharedMaterial.GetFloat("_UseVertexColor"), Is.EqualTo(0f));
            var initialOpacity = consequence.sharedMaterial.color.a;
            environment.TickConsequences(0.5f);
            Assert.That(consequence.sharedMaterial.color.a, Is.LessThan(initialOpacity),
                "the canonical consequence should visibly fade rather than only changing an opaque tint");

            fielder.transform.position = new Vector3(10f, 0f, 18f);
            environment.TickConsequences(0.1f);
            Assert.That(environment.FieldConsequences.Position.x, Is.EqualTo(10f).Within(0.001f),
                "the marker should identify the trace-named fielder as that fielder moves");
            environment.TickConsequences(1f);
            Assert.That(environment.FieldConsequences.Visible, Is.False);

            environment.ResetDeliveryConsequences();
            Assert.That(environment.StrikerWicket.IsBroken, Is.False);
            Assert.That(environment.BowlerWicket.IsBroken, Is.False);
            environment.Dispose();
        }

        private static PracticeFielderPresentation[] TestField()
        {
            var values = new PracticeFielderPresentation[11];
            for (var index = 0; index < values.Length; index++)
            {
                values[index] = new PracticeFielderPresentation
                {
                    Id = "fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "point",
                    X = index - 5,
                    Z = 12 + index
                };
            }
            return values;
        }

        private static void AssertLook(
            string key,
            float restitution,
            float friction,
            float seamGrip,
            float turnGrip,
            float swingFactor)
        {
            var look = ProductionPitchLooks.For(key);
            Assert.That(look.Key, Is.EqualTo(key));
            Assert.That(look.Restitution, Is.EqualTo(restitution));
            Assert.That(look.Friction, Is.EqualTo(friction));
            Assert.That(look.SeamGrip, Is.EqualTo(seamGrip));
            Assert.That(look.TurnGrip, Is.EqualTo(turnGrip));
            Assert.That(look.SwingFactor, Is.EqualTo(swingFactor));
        }
    }
}
