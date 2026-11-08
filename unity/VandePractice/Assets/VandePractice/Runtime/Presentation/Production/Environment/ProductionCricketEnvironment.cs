using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>Metres; mirrors src/physics/geometry.ts and src/render3d/three/stadium.ts.</summary>
    public static class CricketEnvironmentDimensions
    {
        public const float PitchHalf = 10.06f;
        public const float PitchWidth = 3.05f;
        public const float PoppingCrease = 1.22f;
        public const float PoppingCreaseHalfWidth = 1.83f;
        public const float ReturnCreaseX = 1.32f;
        public const float ReturnCreaseLength = 2.44f;
        public const float CreaseLineWidth = 0.05f;
        public const float FieldingRingRadius = 27.43f;
        public const float BoundaryRadius = 62f;
        public const float SightScreenWidth = 18f;
        public const float SightScreenHeight = 7.5f;
        public const float SightScreenDistance = BoundaryRadius + 6.5f;
        public const float StadiumBackdropDistance = BoundaryRadius + 2.8f;
        public const float StadiumBackdropWidth = 112f;
        public const float StadiumBackdropAspect = 2172f / 724f;
        public const float StadiumBackdropCenterY = 9.2f;
        public const int StadiumBackdropArcSegments = 24;
        public static float StadiumBackdropHalfAngleRadians =>
            Mathf.Atan(StadiumBackdropWidth * 0.5f / StadiumBackdropDistance);
        public const float FloodlightRadius = BoundaryRadius + 52f;
        public const float FloodlightHeight = 58f;
    }

    /// <summary>
    /// Mobile-efficient production-intent cricket environment. Everything is
    /// generated at scene setup; no mesh, material or resource is created or
    /// loaded during a delivery.
    /// </summary>
    public sealed class ProductionCricketEnvironment : ProductionOwnedVisual
    {
        private readonly ProductionWicketVisual[] wickets = new ProductionWicketVisual[2];
        private Material pitchMaterial;
        private Material pitchWearMaterial;
        private Material pitchGrassMaterial;
        private Material pitchCrackMaterial;
        private Material sightScreenMaterial;
        private Material stadiumBackdropMaterial;
        private GameObject pitchGrassDetails;
        private GameObject pitchCrackDetails;
        private bool reducedMotion;
        private string sightScreenBallColour;
        private readonly ProductionRenderSettingsSnapshot priorRenderSettings;
        private ProductionEnvironmentLook atmosphere;
        private bool renderSettingsApplied;

        private ProductionCricketEnvironment(GameObject root) : base(root)
        {
            priorRenderSettings = ProductionRenderSettingsSnapshot.Capture();
        }

        public Renderer PitchRenderer { get; private set; }
        public Transform CreaseMarkings { get; private set; }
        public Transform BoundaryRope { get; private set; }
        public Transform FieldingRing { get; private set; }
        public Transform Stadium { get; private set; }
        public Transform SightScreens { get; private set; }
        public Transform StadiumBackdrop { get; private set; }
        /// <summary>The painted neutral Practice board strip (no words, no logos); owned and destroyed with the field.</summary>
        public Texture2D PracticeBoardsTexture { get; private set; }
        public Transform SkyDome { get; private set; }
        public AudioReverbZone StadiumReverb { get; private set; }
        public ProductionCrowdView Crowd { get; private set; }
        public ProductionWicketVisual BowlerWicket => wickets[0];
        public ProductionWicketVisual StrikerWicket => wickets[1];
        public ProductionFieldState FieldState { get; private set; }
        public ProductionFieldConsequenceView FieldConsequences { get; private set; }
        public string PitchCondition { get; private set; }
        public bool UsesSkyPanorama => atmosphere.UseLateAfternoonPanorama;
        public bool UsesStadiumBackdrop => StadiumBackdrop != null;

        /// <summary>Unique generated vertex count; a diagnostic, not a performance certificate.</summary>
        public int MeshVertexCount
        {
            get
            {
                if (Root == null) return 0;
                var seen = new HashSet<Mesh>();
                var count = 0;
                var filters = Root.GetComponentsInChildren<MeshFilter>(true);
                for (var index = 0; index < filters.Length; index++)
                {
                    var mesh = filters[index].sharedMesh;
                    if (mesh != null && seen.Add(mesh)) count += mesh.vertexCount;
                }
                return count;
            }
        }

        public static ProductionCricketEnvironment Create(
            Transform parent,
            ProductionEnvironmentSpec spec,
            ProductionFieldState retainedFieldState = null)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (spec == null) throw new ArgumentNullException(nameof(spec));
            var root = new GameObject("VANDE-ProductionPracticeEnvironment");
            root.transform.SetParent(parent, false);
            var environment = new ProductionCricketEnvironment(root);
            try
            {
                environment.Build(spec, retainedFieldState);
                return environment;
            }
            catch
            {
                environment.Dispose();
                throw;
            }
        }

        /// <summary>
        /// The environment owns its visible sky; the camera therefore clears to
        /// the same haze colour instead of relying on a project skybox that may
        /// differ between Android and WebGL exports.
        /// </summary>
        public void ConfigureCamera(Camera camera)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionCricketEnvironment));
            if (camera == null) throw new ArgumentNullException(nameof(camera));
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = atmosphere.Fog;
            camera.allowHDR = false;
            camera.useOcclusionCulling = false;
        }

        public void ApplyPitchCondition(string condition)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionCricketEnvironment));
            var look = ProductionPitchLooks.For(condition);
            PitchCondition = look.Key;
            pitchMaterial.color = look.Soil;
            pitchWearMaterial.color = Color.Lerp(look.Detail, look.Soil, 0.22f);
            pitchGrassMaterial.color = look.Grass;
            pitchCrackMaterial.color = Color.Lerp(look.Detail, Color.black, 0.16f + look.Dust * 0.18f);
            if (pitchMaterial.HasProperty("_Smoothness"))
                pitchMaterial.SetFloat("_Smoothness", Mathf.Lerp(0.08f, 0.62f, look.Sheen));
            pitchGrassDetails.SetActive(look.GrassCover >= 0.15f);
            pitchCrackDetails.SetActive(look.Cracks >= 0.20f);
        }

        public void SetSightScreensForBall(string ballColour)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionCricketEnvironment));
            var normalized = string.Equals(ballColour, "white", StringComparison.Ordinal)
                ? "white"
                : "red";
            // Build establishes a safe default before the host scene arrives;
            // scene binding may legitimately repeat it. Avoid a redundant GPU
            // material write while retaining both lifecycle safety points.
            if (string.Equals(sightScreenBallColour, normalized, StringComparison.Ordinal)) return;
            sightScreenBallColour = normalized;
            // A white ball needs the matte near-black screen; a red ball needs
            // warm off-white. Neither uses bloom or a glowing edge.
            sightScreenMaterial.color = normalized == "white"
                ? new Color(0.035f, 0.043f, 0.072f)
                : new Color(0.84f, 0.82f, 0.76f);
            if (stadiumBackdropMaterial != null)
                stadiumBackdropMaterial.SetFloat("_ScreenCutout", normalized == "red" ? 1f : 0f);
        }

        public void SetDeliveryQuiet(bool quiet)
        {
            if (IsDisposed) return;
            Crowd.SetQuiet(quiet);
        }

        public void SetCrowdEmotion(float valence, float arousal, Vector3? focus = null)
        {
            if (IsDisposed) return;
            Crowd.SetEmotion(valence, arousal, focus);
        }

        /// <summary>
        /// Latches the complete scene field for a compact live PIP. Positions
        /// remain in the canonical host frame; the view mirrors only when drawn.
        /// </summary>
        public void ConfigureField(PracticeFielderPresentation[] fielders)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionCricketEnvironment));
            FieldState.Configure(fielders);
        }

        public void ApplyAuthoritativeFielderSample(string fielderId, FielderTraceSample sample)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionCricketEnvironment));
            FieldState.ApplyAuthoritativeSample(fielderId, sample);
        }

        /// <summary>
        /// Presents only events already emitted by canonical playback. A stumps
        /// event dislodges one physical bail; field/catch/throw may identify only
        /// the fielder explicitly named by that event.
        /// </summary>
        public bool HandleAuthoritativeTraceEvent(
            CanonicalTraceEvent traceEvent,
            float lateralMirror,
            Transform namedFielder = null)
        {
            if (IsDisposed) return false;
            if (traceEvent == null) throw new ArgumentNullException(nameof(traceEvent));
            if (float.IsNaN(lateralMirror) || float.IsInfinity(lateralMirror) ||
                Mathf.Abs(lateralMirror) < 0.5f)
                throw new ArgumentOutOfRangeException(nameof(lateralMirror));

            if (traceEvent.kind == "stumps")
            {
                if (traceEvent.p == null) return false;
                var impact = new Vector3(
                    lateralMirror < 0f ? -(float)traceEvent.p.x : (float)traceEvent.p.x,
                    (float)traceEvent.p.y,
                    (float)traceEvent.p.z);
                var wicket = NearestWicket(impact.z);
                var localImpact = wicket.Root.transform.InverseTransformPoint(impact);
                wicket.ReactToAuthoritativeImpact(localImpact.x, reducedMotion);
                return true;
            }

            if (traceEvent.p == null) return false;
            var eventPosition = new Vector3(
                lateralMirror < 0f ? -(float)traceEvent.p.x : (float)traceEvent.p.x,
                (float)traceEvent.p.y,
                (float)traceEvent.p.z);
            return FieldConsequences.ShowAuthoritativeEvent(
                traceEvent.kind, namedFielder, eventPosition);
        }

        public void TickConsequences(float deltaSeconds)
        {
            if (IsDisposed) return;
            wickets[0].TickReaction(deltaSeconds);
            wickets[1].TickReaction(deltaSeconds);
            FieldConsequences.Tick(deltaSeconds);
        }

        public void ResetDeliveryConsequences()
        {
            if (IsDisposed) return;
            wickets[0].ResetReaction();
            wickets[1].ResetReaction();
            FieldConsequences.Hide();
            Crowd.ResetEmotion();
        }

        public override void Dispose()
        {
            for (var index = 0; index < wickets.Length; index++) wickets[index]?.Dispose();
            if (renderSettingsApplied)
            {
                priorRenderSettings.Restore();
                renderSettingsApplied = false;
            }
            base.Dispose();
        }

        private void Build(ProductionEnvironmentSpec spec, ProductionFieldState retainedFieldState)
        {
            reducedMotion = spec.ReducedMotion;
            atmosphere = ProductionEnvironmentLook.For(spec);
            ProductionEnvironmentAtmosphere.ApplyRenderSettings(atmosphere);
            renderSettingsApplied = true;
            BuildSky(spec);
            var grassA = Own(ProductionVisualPrimitives.CreateMaterial(
                // The registered source averages roughly RGB 60/114/27, so a
                // cool counter-tint is required before the daylight saturation
                // bound. This produces an olive broadcast field rather than
                // exposing the source texture's neon green chroma.
                "VANDE outfield mow A", new Color(0.88f, 0.56f, 1.00f)));
            var grassB = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE outfield mow B", new Color(0.82f, 0.52f, 0.94f)));
            ConfigureSurface(grassA, 0.10f, 0f, 0.88f, 0.018f);
            ConfigureSurface(grassB, 0.12f, 0f, 0.88f, 0.018f);
            if (spec.Light == ProductionLight.Day)
            {
                ConfigureColourResponse(grassA, 0.35f, 0.78f);
                ConfigureColourResponse(grassB, 0.35f, 0.78f);
            }
            ProductionVisualPrimitives.ApplyResourceTexture(
                grassA, "Textures/outfield-grass-albedo", new Vector2(0.42f, 0.42f));
            ProductionVisualPrimitives.ApplyResourceTexture(
                grassB, "Textures/outfield-grass-albedo", new Vector2(0.42f, 0.42f), new Vector2(0.5f, 0f));
            var outfieldSegments = spec.Quality == PracticePresentationQuality.Lite ? 48 : 64;
            var outfieldMesh = Own(BuildMownOutfieldMesh(outfieldSegments));
            var outfield = ProductionVisualPrimitives.CreateMeshObject(
                "Outfield-Mown", Root.transform, outfieldMesh, new[] { grassA, grassB },
                false);
            // A flat ground plane never needs to cast a shadow, but receiving
            // player and ball shadows materially anchors scale on capable tiers.
            outfield.GetComponent<Renderer>().receiveShadows =
                spec.Quality != PracticePresentationQuality.Lite;

            pitchMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE physics-linked pitch", new Color(0.68f, 0.53f, 0.34f)));
            pitchWearMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE pitch wear", new Color(0.43f, 0.30f, 0.18f)));
            pitchGrassMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE pitch grass", new Color(0.40f, 0.49f, 0.24f)));
            pitchCrackMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE pitch cracks", new Color(0.26f, 0.17f, 0.11f)));
            ConfigureSurface(pitchMaterial, 0.28f, 0f, 0.86f, 0.03f);
            ConfigureSurface(pitchWearMaterial, 0.08f, 0f, 0.82f, 0.015f);
            ConfigureSurface(pitchGrassMaterial, 0.10f, 0f, 0.86f, 0.02f);
            ConfigureSurface(pitchCrackMaterial, 0.03f, 0f, 0.80f, 0f);
            if (spec.Light == ProductionLight.Day)
            {
                ConfigureColourResponse(pitchMaterial, 0.42f, 0.62f);
                ConfigureColourResponse(pitchWearMaterial, 0.38f, 0.64f);
                ConfigureColourResponse(pitchGrassMaterial, 0.30f, 0.64f);
                ConfigureColourResponse(pitchCrackMaterial, 0.28f, 0.68f);
            }
            ProductionVisualPrimitives.ApplyResourceTexture(
                pitchMaterial,
                "Textures/pitch-balanced-albedo",
                new Vector2(1f / CricketEnvironmentDimensions.PitchWidth,
                    1f / (CricketEnvironmentDimensions.PitchHalf * 2f)),
                new Vector2(0.5f, 0.5f));
            BuildPitch();

            var marking = Own(ProductionVisualPrimitives.CreateMaterial(
                // Warm matte paint remains clear without competing with a white
                // ball or producing specular dashes at grazing camera angles.
                "VANDE crease paint", new Color(0.78f, 0.77f, 0.70f)));
            ConfigureSurface(marking, 0.04f, 0f, 0.94f, 0f);
            if (spec.Light == ProductionLight.Day)
                ConfigureColourResponse(marking, 0.20f, 0.78f);
            var creaseMesh = Own(BuildCreaseMesh());
            var crease = ProductionVisualPrimitives.CreateMeshObject(
                "LegalCreaseMarkings", Root.transform, creaseMesh, new[] { marking }, false);
            CreaseMarkings = crease.transform;

            var ropeMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE boundary rope", new Color(0.92f, 0.88f, 0.77f)));
            ConfigureSurface(ropeMaterial, 0.24f, 0f, 0.92f, 0.05f);
            if (spec.Light == ProductionLight.Day)
                ConfigureColourResponse(ropeMaterial, 0.30f, 0.78f);
            var ropeMesh = Own(BuildTorusMesh(
                "VANDE boundary rope",
                CricketEnvironmentDimensions.BoundaryRadius,
                0.025f,
                spec.Quality == PracticePresentationQuality.Lite ? 96 : 160,
                5));
            var rope = ProductionVisualPrimitives.CreateMeshObject(
                "BoundaryRope", Root.transform, ropeMesh, new[] { ropeMaterial }, false);
            rope.transform.localPosition = Vector3.up * 0.026f;
            BoundaryRope = rope.transform;

            var ringMesh = Own(BuildGroundRingMesh(
                "VANDE flat 30-yard paint",
                CricketEnvironmentDimensions.FieldingRingRadius,
                CricketEnvironmentDimensions.CreaseLineWidth,
                spec.Quality == PracticePresentationQuality.Lite ? 96 : 160,
                0.006f));
            var ring = ProductionVisualPrimitives.CreateMeshObject(
                "ThirtyYardRing", Root.transform, ringMesh, new[] { marking }, false);
            FieldingRing = ring.transform;

            BuildStadium(spec, atmosphere);
            BuildStadiumBackdrop(spec);
            BuildWickets(spec.Quality);
            // Quality changes rebuild the render environment between balls. Keep
            // the canonical field snapshot stable so the HUD's retained binding
            // cannot point at a stale field after that presentation-only rebuild.
            FieldState = retainedFieldState ?? new ProductionFieldState();
            FieldConsequences = ProductionFieldConsequenceView.Create(
                Root.transform, this, spec.ReducedMotion);
            Crowd = ProductionCrowdView.Create(
                Stadium, spec.CrowdCount, spec.ReducedMotion, this);
            ApplyPitchCondition(spec.PitchCondition);
            SetSightScreensForBall(spec.BallColour);
            ConfigureLighting(spec, atmosphere);
            AttachBakedVenue();
        }

        /// <summary>
        /// The baked venue (ASSETS-VENUE; a sideload add-on, never in the first-ball install): its 60-wedge ring, when this build carries the add-on asset (an export that was asked
        /// for it, ProductionVenueRing.Load), replaces the stand-in's seating tiers, painted backdrop and instanced crowd. None in a default build: the stand-in stays as it always was.
        /// </summary>
        public Transform BakedVenue { get; private set; }

        private void AttachBakedVenue()
        {
            var addon = ProductionVenueRing.Load();
            if (addon == null || Stadium == null) return;
            BakedVenue = ProductionVenueRing.Build(Stadium, addon, this);
            foreach (var replaced in new[] { "LowerSeatingTier", "UpperSeatingTier", "CrowdSection-0", "CrowdSection-1", "CrowdSection-2", "CrowdSection-3", "CrowdSection-4", "CrowdSection-5", "CrowdSection-6", "CrowdSection-7" })
            {
                var part = Stadium.Find(replaced);
                if (part != null) part.gameObject.SetActive(false);
            }

            if (StadiumBackdrop != null) StadiumBackdrop.gameObject.SetActive(false);
        }

        private void BuildSky(ProductionEnvironmentSpec spec)
        {
            var skyMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE atmospheric sky", Color.white));
            ConfigureSurface(skyMaterial, 0f, 0f, 1f, 0f);
            SetFloat(skyMaterial, "_Unlit", 1f);
            SetFloat(skyMaterial, "_UseVertexColor", 1f);
            SetFloat(skyMaterial, "_FogStrength", 0f);
            if (atmosphere.UseLateAfternoonPanorama)
            {
                ProductionVisualPrimitives.ApplyResourceTexture(
                    skyMaterial,
                    "Textures/sky-late-afternoon-panorama",
                    Vector2.one);
            }

            var segments = spec.Quality == PracticePresentationQuality.Lite ? 32 : 64;
            var skyMesh = Own(ProductionEnvironmentAtmosphere.BuildSkyDome(
                segments, 168f, atmosphere));
            var sky = ProductionVisualPrimitives.CreateMeshObject(
                "SkyDome", Root.transform, skyMesh, new[] { skyMaterial }, false);
            SkyDome = sky.transform;
        }

        private ProductionWicketVisual NearestWicket(float eventZ)
        {
            var bowlerDistance = Mathf.Abs(eventZ - wickets[0].Root.transform.position.z);
            var strikerDistance = Mathf.Abs(eventZ - wickets[1].Root.transform.position.z);
            return strikerDistance <= bowlerDistance ? wickets[1] : wickets[0];
        }

        private void BuildPitch()
        {
            var baseBuilder = new ProductionMeshBuilder();
            baseBuilder.AddBox(
                new Vector3(0f, -0.018f, 0f),
                new Vector3(CricketEnvironmentDimensions.PitchWidth, 0.036f,
                    CricketEnvironmentDimensions.PitchHalf * 2f));
            var pitchMesh = Own(baseBuilder.Build("VANDE law-scale pitch strip"));
            var pitch = ProductionVisualPrimitives.CreateMeshObject(
                "PitchSurface", Root.transform, pitchMesh, new[] { pitchMaterial }, true);
            PitchRenderer = pitch.GetComponent<Renderer>();

            var wearMesh = Own(BuildPitchWearMesh());
            ProductionVisualPrimitives.CreateMeshObject(
                "PitchWearAndFootmarks", Root.transform, wearMesh, new[] { pitchWearMaterial }, false);
            var grassMesh = Own(BuildPitchGrassMesh());
            pitchGrassDetails = ProductionVisualPrimitives.CreateMeshObject(
                "PitchGrassCover", Root.transform, grassMesh, new[] { pitchGrassMaterial }, false);
            var crackMesh = Own(BuildPitchCrackMesh());
            pitchCrackDetails = ProductionVisualPrimitives.CreateMeshObject(
                "PitchCracksAndRough", Root.transform, crackMesh, new[] { pitchCrackMaterial }, false);
        }

        private void BuildWickets(PracticePresentationQuality quality)
        {
            var propQuality = quality == PracticePresentationQuality.Lite
                ? ProductionPropQuality.Lite
                : quality == PracticePresentationQuality.Standard
                    ? ProductionPropQuality.Standard
                    : ProductionPropQuality.High;
            wickets[0] = ProductionCricketProps.CreateWicket(
                Root.transform, "BowlerWicket", propQuality, quality != PracticePresentationQuality.Lite);
            // Stumps stand on the physics ground plane (y = 0, as src/physics/geometry.ts): the tops are at exactly
            // STUMP_H = 0.7112 m. The base sits 2 mm inside the pitch surface, as a driven stump does (ART1).
            wickets[0].Root.transform.localPosition = new Vector3(
                0f, 0f, -CricketEnvironmentDimensions.PitchHalf);
            wickets[1] = ProductionCricketProps.CreateWicket(
                Root.transform, "StrikerWicket", propQuality, quality != PracticePresentationQuality.Lite);
            wickets[1].Root.transform.localPosition = new Vector3(
                0f, 0f, CricketEnvironmentDimensions.PitchHalf);
        }

        private void BuildStadium(
            ProductionEnvironmentSpec spec,
            ProductionEnvironmentLook look)
        {
            var stadiumRoot = new GameObject("RestrainedStadium").transform;
            stadiumRoot.SetParent(Root.transform, false);
            Stadium = stadiumRoot;
            var daylight = spec.Light == ProductionLight.Day;
            var concrete = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE stadium concrete", daylight
                    ? new Color(0.42f, 0.44f, 0.46f)
                    : new Color(0.22f, 0.24f, 0.28f)));
            var seat = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE restrained seating", daylight
                    ? new Color(0.18f, 0.24f, 0.34f)
                    : new Color(0.12f, 0.16f, 0.31f)));
            var stone = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE pavilion stone", daylight
                    ? new Color(0.68f, 0.64f, 0.55f)
                    : new Color(0.67f, 0.60f, 0.48f)));
            var glass = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE pavilion glazing", daylight
                    ? new Color(0.18f, 0.27f, 0.33f)
                    : new Color(0.12f, 0.19f, 0.25f)));
            sightScreenMaterial = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE matte sight screen", new Color(0.035f, 0.043f, 0.072f)));
            var steel = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE structure steel", daylight
                    ? new Color(0.32f, 0.34f, 0.35f)
                    : new Color(0.22f, 0.24f, 0.27f)));
            var lamps = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE floodlight lamps", new Color(0.95f, 0.89f, 0.76f)));
            var fascia = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE restrained stadium fascia", daylight
                    ? new Color(0.07f, 0.22f, 0.34f)
                    : new Color(0.055f, 0.13f, 0.23f)));
            // Practice's neutral boards (the web's paintPracticeBoards): dark muted panels with cricket pictograms,
            // no words, brand or logo. They replace the former navy/amber cushions.
            PracticeBoardsTexture = Own(ProductionPracticeBoards.Create(
                spec.Quality == PracticePresentationQuality.Lite ? 0.5f : 1f));
            var boards = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE Practice neutral boundary boards", Color.white));
            if (boards.HasProperty("_MainTex")) boards.SetTexture("_MainTex", PracticeBoardsTexture);
            var board = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE scoreboard face", new Color(0.018f, 0.030f, 0.045f)));
            var boardLight = Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE scoreboard restrained light", new Color(0.62f, 0.78f, 0.72f)));

            ConfigureSurface(concrete, 0.08f, 0.02f, 0.74f, 0.02f);
            ConfigureSurface(seat, 0.10f, 0f, 0.78f, 0.025f);
            ConfigureSurface(stone, 0.18f, 0f, 0.82f, 0.02f);
            ConfigureSurface(glass, 0.72f, 0.08f, 0.66f, 0.10f);
            ConfigureSurface(sightScreenMaterial, 0.02f, 0f, 1f, 0f);
            ConfigureSurface(steel, 0.44f, 0.34f, 0.70f, 0.06f);
            ConfigureSurface(lamps, 0.64f, 0.08f, 0.86f, 0.10f);
            ConfigureSurface(fascia, 0.20f, 0.02f, 0.82f, 0.04f);
            ConfigureSurface(boards, 0.28f, 0f, 0.86f, 0.035f);
            ConfigureSurface(board, 0.36f, 0.04f, 0.76f, 0.02f);
            ConfigureSurface(boardLight, 0.18f, 0f, 1f, 0f);
            SetEmission(lamps, new Color(1f, 0.84f, 0.61f) * (1.05f * look.FloodlightStrength));
            SetEmission(boardLight, new Color(0.24f, 0.54f, 0.44f) *
                                    Mathf.Lerp(0.18f, 0.72f, look.FloodlightStrength));

            var rows = spec.Quality == PracticePresentationQuality.Lite ? 5 :
                spec.Quality == PracticePresentationQuality.Standard ? 8 : 11;
            var radialSegments = spec.Quality == PracticePresentationQuality.Lite ? 48 :
                spec.Quality == PracticePresentationQuality.Standard ? 72 : 96;
            var lowerMesh = Own(BuildTierMesh(
                "VANDE lower seating",
                CricketEnvironmentDimensions.BoundaryRadius + 8f,
                CricketEnvironmentDimensions.BoundaryRadius + 27f,
                1.2f,
                10.5f,
                rows,
                radialSegments));
            ProductionVisualPrimitives.CreateMeshObject(
                "LowerSeatingTier", stadiumRoot, lowerMesh, new[] { seat }, false);
            var upperMesh = Own(BuildTierMesh(
                "VANDE upper seating",
                CricketEnvironmentDimensions.BoundaryRadius + 30f,
                CricketEnvironmentDimensions.BoundaryRadius + 47f,
                13.5f,
                27f,
                Math.Max(4, rows - 1),
                radialSegments));
            ProductionVisualPrimitives.CreateMeshObject(
                "UpperSeatingTier", stadiumRoot, upperMesh, new[] { concrete }, false);

            BuildSightScreens(stadiumRoot, sightScreenMaterial, steel);
            BuildStadiumAccents(
                stadiumRoot, boards, fascia, steel, spec.Quality);
            BuildPavilion(stadiumRoot, stone, glass, board, boardLight);
            BuildFloodlights(stadiumRoot, steel, lamps, spec.Quality);
            ConfigureStadiumReverb(stadiumRoot, spec.Quality);
        }

        /// <summary>
        /// A camera-bounded, original daylight facade adds real stadium depth to
        /// the batter's primary view without replacing the authoritative 3D
        /// field, sight-screen state, crowd state or post-contact camera. It is a
        /// depth-tested layer beyond the boundary and in front of the old far
        /// shell: the outfield hides its generated foreground, its red-ball
        /// cutout reveals the physical screen, and its restrained crowd-band
        /// transparency preserves the causal three-dimensional crowd response.
        /// </summary>
        private void BuildStadiumBackdrop(ProductionEnvironmentSpec spec)
        {
            if (spec.Light != ProductionLight.Day) return;
            var shader = Resources.Load<Shader>("VandeStadiumBackdrop") ??
                         Shader.Find("Vande/Practice/StadiumBackdrop");
            var texture = Resources.Load<Texture2D>("Textures/stadium-day-background-v2");
            if (shader == null || texture == null) return;

            stadiumBackdropMaterial = Own(new Material(shader)
            {
                name = "VANDE original daylight stadium facade"
            });
            stadiumBackdropMaterial.SetTexture("_MainTex", texture);
            // The original facade is deliberately restrained into the same
            // daylight palette as the realtime field. This avoids presenting a
            // bright photographic layer behind a separately exposed 3D scene.
            stadiumBackdropMaterial.SetColor("_Tint", new Color(0.94f, 0.95f, 0.96f, 1f));
            stadiumBackdropMaterial.SetColor("_HazeColor", atmosphere.Fog);
            stadiumBackdropMaterial.SetFloat("_HorizonHaze", 0.09f);
            stadiumBackdropMaterial.SetColor("_FieldTint", new Color(0.91f, 0.84f, 0.65f, 1f));
            stadiumBackdropMaterial.SetFloat("_FieldBlend", 0.16f);
            stadiumBackdropMaterial.SetFloat("_EdgeFeather", 0.055f);
            stadiumBackdropMaterial.SetFloat("_ScreenCutout", 0f);
            stadiumBackdropMaterial.SetVector("_ScreenBounds", StadiumBackdropScreenUvBounds());
            stadiumBackdropMaterial.SetFloat("_CrowdReveal", 0.14f);

            var mesh = Own(BuildStadiumBackdropMesh());
            var value = ProductionVisualPrimitives.CreateMeshObject(
                "DaylightStadiumBackdrop", Root.transform, mesh,
                new[] { stadiumBackdropMaterial }, false);
            value.transform.localPosition = new Vector3(
                0f,
                CricketEnvironmentDimensions.StadiumBackdropCenterY,
                -CricketEnvironmentDimensions.StadiumBackdropDistance);
            var renderer = value.GetComponent<Renderer>();
            renderer.receiveShadows = false;
            StadiumBackdrop = value.transform;
        }

        internal static Vector4 StadiumBackdropScreenUvBounds()
        {
            var width = CricketEnvironmentDimensions.StadiumBackdropWidth;
            var height = width / CricketEnvironmentDimensions.StadiumBackdropAspect;
            var bottom = CricketEnvironmentDimensions.StadiumBackdropCenterY - height * 0.5f;
            // The facade is an inward-facing arc. Map the physical screen's
            // camera angle into the arc texture instead of using the obsolete
            // flat-plane width ratio.
            var halfScreenAngle = Mathf.Atan(
                CricketEnvironmentDimensions.SightScreenWidth * 0.5f /
                CricketEnvironmentDimensions.StadiumBackdropDistance);
            var halfScreenUv = 0.5f * halfScreenAngle /
                CricketEnvironmentDimensions.StadiumBackdropHalfAngleRadians;
            return new Vector4(
                0.5f - halfScreenUv,
                0.5f + halfScreenUv,
                -bottom / height,
                (CricketEnvironmentDimensions.SightScreenHeight - bottom) / height);
        }

        private static Mesh BuildStadiumBackdropMesh()
        {
            var width = CricketEnvironmentDimensions.StadiumBackdropWidth;
            var height = width / CricketEnvironmentDimensions.StadiumBackdropAspect;
            var halfHeight = height * 0.5f;
            var radius = CricketEnvironmentDimensions.StadiumBackdropDistance;
            var halfAngle = CricketEnvironmentDimensions.StadiumBackdropHalfAngleRadians;
            var segments = CricketEnvironmentDimensions.StadiumBackdropArcSegments;
            var vertices = new Vector3[(segments + 1) * 2];
            var normals = new Vector3[vertices.Length];
            var textureCoordinates = new Vector2[vertices.Length];
            var triangles = new int[segments * 6];
            for (var segment = 0; segment <= segments; segment++)
            {
                var u = segment / (float)segments;
                var angle = Mathf.Lerp(-halfAngle, halfAngle, u);
                var sine = Mathf.Sin(angle);
                var cosine = Mathf.Cos(angle);
                var x = radius * sine;
                // The object remains anchored at -radius on Z. Curving its
                // edges back toward the field keeps every facade point on the
                // 64.8 m circle, always in front of the 70 m seating ring.
                var z = radius * (1f - cosine);
                var inward = new Vector3(-sine, 0f, cosine);
                var bottom = segment * 2;
                vertices[bottom] = new Vector3(x, -halfHeight, z);
                vertices[bottom + 1] = new Vector3(x, halfHeight, z);
                normals[bottom] = inward;
                normals[bottom + 1] = inward;
                textureCoordinates[bottom] = new Vector2(u, 0f);
                textureCoordinates[bottom + 1] = new Vector2(u, 1f);
                if (segment == segments) continue;
                var triangle = segment * 6;
                var nextBottom = bottom + 2;
                triangles[triangle] = bottom;
                triangles[triangle + 1] = nextBottom;
                triangles[triangle + 2] = nextBottom + 1;
                triangles[triangle + 3] = bottom;
                triangles[triangle + 4] = nextBottom + 1;
                triangles[triangle + 5] = bottom + 1;
            }
            var mesh = new Mesh { name = "VANDE inward-curved daylight stadium facade" };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = textureCoordinates;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private void BuildSightScreens(Transform parent, Material screen, Material steel)
        {
            var panelBuilder = new ProductionMeshBuilder();
            var frameBuilder = new ProductionMeshBuilder();
            foreach (var direction in new[] { -1f, 1f })
            {
                var z = direction * CricketEnvironmentDimensions.SightScreenDistance;
                panelBuilder.AddBox(
                    new Vector3(0f, CricketEnvironmentDimensions.SightScreenHeight * 0.5f, z),
                    new Vector3(CricketEnvironmentDimensions.SightScreenWidth,
                        CricketEnvironmentDimensions.SightScreenHeight, 0.28f));
                frameBuilder.AddBox(
                    new Vector3(0f, CricketEnvironmentDimensions.SightScreenHeight + 0.09f, z),
                    new Vector3(CricketEnvironmentDimensions.SightScreenWidth + 0.36f, 0.18f, 0.38f));
                frameBuilder.AddBox(
                    new Vector3(-CricketEnvironmentDimensions.SightScreenWidth * 0.5f - 0.09f,
                        CricketEnvironmentDimensions.SightScreenHeight * 0.5f, z),
                    new Vector3(0.18f, CricketEnvironmentDimensions.SightScreenHeight, 0.38f));
                frameBuilder.AddBox(
                    new Vector3(CricketEnvironmentDimensions.SightScreenWidth * 0.5f + 0.09f,
                        CricketEnvironmentDimensions.SightScreenHeight * 0.5f, z),
                    new Vector3(0.18f, CricketEnvironmentDimensions.SightScreenHeight, 0.38f));
            }
            var screenMesh = Own(panelBuilder.Build("VANDE matte sight screens"));
            var screens = ProductionVisualPrimitives.CreateMeshObject(
                "SightScreens", parent, screenMesh, new[] { screen }, false);
            SightScreens = screens.transform;
            var frameMesh = Own(frameBuilder.Build("VANDE sight screen frames"));
            ProductionVisualPrimitives.CreateMeshObject(
                "SightScreenFrames", parent, frameMesh, new[] { steel }, false);
        }

        private void BuildPavilion(
            Transform parent,
            Material stone,
            Material glass,
            Material board,
            Material boardLight)
        {
            var masonryBuilder = new ProductionMeshBuilder();
            var pavilionZ = -(CricketEnvironmentDimensions.BoundaryRadius + 26f);
            masonryBuilder.AddBox(new Vector3(0f, 7.5f, pavilionZ), new Vector3(56f, 15f, 14f));
            masonryBuilder.AddBox(new Vector3(0f, 18.5f, pavilionZ - 0.5f), new Vector3(15f, 7f, 12f));
            masonryBuilder.AddBox(new Vector3(-21f, 2.5f, -(CricketEnvironmentDimensions.BoundaryRadius + 4.2f)),
                new Vector3(9f, 0.5f, 3.4f));
            var scoreboardZ = CricketEnvironmentDimensions.BoundaryRadius + 27f;
            masonryBuilder.AddBox(new Vector3(0f, 6f, scoreboardZ), new Vector3(26f, 12f, 12f));
            var masonryMesh = Own(masonryBuilder.Build("VANDE pavilion and scoreboard masonry"));
            ProductionVisualPrimitives.CreateMeshObject(
                "PavilionAndScoreboard", parent, masonryMesh, new[] { stone }, false);

            var facadeBuilder = new ProductionMeshBuilder();
            facadeBuilder.AddBox(new Vector3(0f, 7.5f, pavilionZ + 7.02f), new Vector3(51f, 11f, 0.08f));
            facadeBuilder.AddBox(new Vector3(0f, 6f, scoreboardZ - 6.02f), new Vector3(23f, 9f, 0.08f));
            var facadeMesh = Own(facadeBuilder.Build("VANDE pavilion glazing"));
            ProductionVisualPrimitives.CreateMeshObject(
                "PavilionGlazing", parent, facadeMesh, new[] { glass }, false);

            var boardBuilder = new ProductionMeshBuilder();
            boardBuilder.AddBox(
                new Vector3(0f, 6f, scoreboardZ - 6.08f),
                new Vector3(20f, 6.8f, 0.10f));
            var boardMesh = Own(boardBuilder.Build("VANDE scoreboard face"));
            ProductionVisualPrimitives.CreateMeshObject(
                "ScoreboardFace", parent, boardMesh, new[] { board }, false);

            var informationBuilder = new ProductionMeshBuilder(2);
            for (var index = 0; index < 5; index++)
            {
                informationBuilder.AddBox(
                    new Vector3(-4.2f, 8.1f - index * 1.05f, scoreboardZ - 6.15f),
                    new Vector3(7.2f - index * 0.35f, 0.16f, 0.04f), 0);
                informationBuilder.AddBox(
                    new Vector3(5.8f, 8.1f - index * 1.05f, scoreboardZ - 6.15f),
                    new Vector3(2.2f, 0.16f, 0.04f), 1);
            }
            var informationMesh = Own(informationBuilder.Build("VANDE abstract scoreboard information"));
            ProductionVisualPrimitives.CreateMeshObject(
                "ScoreboardInformation", parent, informationMesh,
                new[] { boardLight, boardLight }, false);
        }

        private void BuildStadiumAccents(
            Transform parent,
            Material boards,
            Material fascia,
            Material steel,
            PracticePresentationQuality quality)
        {
            var segments = quality == PracticePresentationQuality.Lite ? 40 : 64;
            var fasciaBuilder = new ProductionMeshBuilder();
            for (var index = 0; index < segments; index++)
            {
                var a0 = Mathf.PI * 2f * index / segments;
                var a1 = Mathf.PI * 2f * (index + 1f) / segments;
                AddInwardBand(fasciaBuilder, a0, a1,
                    CricketEnvironmentDimensions.BoundaryRadius + 7.4f,
                    0.36f, 1.22f, 0);
            }

            const float boardBottom = 0.06f;
            const float boardTop = 0.46f;
            var boardRadius = CricketEnvironmentDimensions.BoundaryRadius + 0.34f;
            var cushionMesh = Own(BuildBoardBandMesh(
                "VANDE Practice boundary boards",
                boardRadius,
                boardBottom,
                boardTop,
                segments,
                ProductionPracticeBoards.RingRepeatsFor(boardRadius, boardTop - boardBottom)));
            ProductionVisualPrimitives.CreateMeshObject(
                "BoundaryCushions", parent, cushionMesh,
                new[] { boards }, false);
            var fasciaMesh = Own(fasciaBuilder.Build("VANDE lower stand fascia"));
            ProductionVisualPrimitives.CreateMeshObject(
                "LowerStandFascia", parent, fasciaMesh, new[] { fascia }, false);

            var railSegments = quality == PracticePresentationQuality.Lite ? 56 : 96;
            var lowerRail = ProductionVisualPrimitives.CreateMeshObject(
                "LowerTierRail", parent,
                Own(BuildTorusMesh("VANDE lower tier rail", 70.1f, 0.045f, railSegments, 4)),
                new[] { steel }, false);
            lowerRail.transform.localPosition = Vector3.up * 1.44f;
            var upperRail = ProductionVisualPrimitives.CreateMeshObject(
                "UpperTierRail", parent,
                Own(BuildTorusMesh("VANDE upper tier rail", 92.4f, 0.05f, railSegments, 4)),
                new[] { steel }, false);
            upperRail.transform.localPosition = Vector3.up * 13.7f;
        }

        /// <summary>
        /// The boundary boards as one inward-facing ring band with UVs: u runs `repeats` times round the ring, left
        /// to right as seen from the field, v from the bottom to the top of the boards.
        /// </summary>
        internal static Mesh BuildBoardBandMesh(
            string name,
            float radius,
            float bottom,
            float top,
            int segments,
            int repeats)
        {
            var vertices = new List<Vector3>((segments + 1) * 2);
            var normals = new List<Vector3>((segments + 1) * 2);
            var uv = new List<Vector2>((segments + 1) * 2);
            var triangles = new List<int>(segments * 6);
            for (var index = 0; index <= segments; index++)
            {
                var a = Mathf.PI * 2f * index / segments;
                var p = new Vector3(Mathf.Sin(a) * radius, 0f, Mathf.Cos(a) * radius);
                var inward = new Vector3(-Mathf.Sin(a), 0f, -Mathf.Cos(a));
                var u = repeats * (float)index / segments;
                vertices.Add(new Vector3(p.x, bottom, p.z));
                vertices.Add(new Vector3(p.x, top, p.z));
                normals.Add(inward);
                normals.Add(inward);
                uv.Add(new Vector2(u, 0f));
                uv.Add(new Vector2(u, 1f));
            }
            for (var index = 0; index < segments; index++)
            {
                var b0 = index * 2;
                var t0 = b0 + 1;
                var b1 = b0 + 2;
                var t1 = b0 + 3;
                // Wound to face the centre (Unity's clockwise front faces, seen from inside).
                triangles.Add(b1); triangles.Add(b0); triangles.Add(t0);
                triangles.Add(b1); triangles.Add(t0); triangles.Add(t1);
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddInwardBand(
            ProductionMeshBuilder builder,
            float a0,
            float a1,
            float radius,
            float bottom,
            float top,
            int submesh)
        {
            var bottom0 = new Vector3(Mathf.Sin(a0) * radius, bottom, Mathf.Cos(a0) * radius);
            var bottom1 = new Vector3(Mathf.Sin(a1) * radius, bottom, Mathf.Cos(a1) * radius);
            var top0 = new Vector3(bottom0.x, top, bottom0.z);
            var top1 = new Vector3(bottom1.x, top, bottom1.z);
            var inward = new Vector3(
                -Mathf.Sin((a0 + a1) * 0.5f),
                0f,
                -Mathf.Cos((a0 + a1) * 0.5f));
            builder.AddQuad(bottom1, bottom0, top0, top1, inward, submesh);
        }

        private void ConfigureStadiumReverb(
            Transform parent,
            PracticePresentationQuality quality)
        {
            // The Lite cohort keeps causal dry cues and avoids an additional
            // realtime DSP effect on the devices most likely to be audio-bound.
            if (quality == PracticePresentationQuality.Lite) return;
            StadiumReverb = parent.gameObject.AddComponent<AudioReverbZone>();
            StadiumReverb.reverbPreset = AudioReverbPreset.User;
            StadiumReverb.minDistance = 24f;
            StadiumReverb.maxDistance = 138f;
            StadiumReverb.room = -1050;
            StadiumReverb.roomHF = -620;
            StadiumReverb.roomLF = -220;
            StadiumReverb.decayTime = 0.86f;
            StadiumReverb.decayHFRatio = 0.58f;
            StadiumReverb.reflections = -760;
            StadiumReverb.reflectionsDelay = 0.028f;
            StadiumReverb.reverb = -520;
            StadiumReverb.reverbDelay = 0.041f;
            StadiumReverb.diffusion = 82f;
            StadiumReverb.density = 72f;
        }

        private void BuildFloodlights(
            Transform parent,
            Material steel,
            Material lamps,
            PracticePresentationQuality quality)
        {
            var builder = new ProductionMeshBuilder(2);
            var towerDegrees = new[] { 35f, 90f, 145f, 215f, 270f, 325f };
            var poleSegments = quality == PracticePresentationQuality.Lite ? 6 : 8;
            for (var index = 0; index < towerDegrees.Length; index++)
            {
                var angle = towerDegrees[index] * Mathf.Deg2Rad;
                var position = new Vector3(
                    Mathf.Sin(angle) * CricketEnvironmentDimensions.FloodlightRadius,
                    CricketEnvironmentDimensions.FloodlightHeight * 0.5f,
                    Mathf.Cos(angle) * CricketEnvironmentDimensions.FloodlightRadius);
                builder.AddCylinder(position, 0.72f, CricketEnvironmentDimensions.FloodlightHeight,
                    poleSegments, Quaternion.identity, 0);
                var bank = new Vector3(position.x, CricketEnvironmentDimensions.FloodlightHeight, position.z);
                var yaw = Quaternion.Euler(0f, towerDegrees[index] + 180f, 0f);
                builder.AddBox(bank, new Vector3(9f, 5.5f, 0.45f), yaw, 1);
            }
            var mesh = Own(builder.Build("VANDE six floodlight towers"));
            ProductionVisualPrimitives.CreateMeshObject(
                "FloodlightTowers", parent, mesh, new[] { steel, lamps }, false);
        }

        private void ConfigureLighting(
            ProductionEnvironmentSpec spec,
            ProductionEnvironmentLook look)
        {
            var lightObject = new GameObject("ProductionEnvironmentKeyLight");
            lightObject.transform.SetParent(Root.transform, false);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.color = look.KeyColour;
            light.intensity = look.KeyIntensity;
            lightObject.transform.rotation = look.KeyRotation;
            light.shadows = spec.Quality == PracticePresentationQuality.Lite
                ? LightShadows.None
                : LightShadows.Soft;
            light.shadowStrength = 0.82f;
            light.shadowBias = 0.035f;
            light.shadowNormalBias = 0.24f;
            light.shadowNearPlane = 0.35f;
        }

        private static Mesh BuildMownOutfieldMesh(int strips)
        {
            var builder = new ProductionMeshBuilder(2);
            var radius = CricketEnvironmentDimensions.BoundaryRadius + 6f;
            for (var index = 0; index < strips; index++)
            {
                var x0 = Mathf.Lerp(-radius, radius, index / (float)strips);
                var x1 = Mathf.Lerp(-radius, radius, (index + 1f) / strips);
                var middle = (x0 + x1) * 0.5f;
                var extent = Mathf.Sqrt(Mathf.Max(0f, radius * radius - middle * middle));
                builder.AddQuad(
                    new Vector3(x0, -0.004f, -extent),
                    new Vector3(x0, -0.004f, extent),
                    new Vector3(x1, -0.004f, extent),
                    new Vector3(x1, -0.004f, -extent),
                    Vector3.up,
                    (index / 3) % 2);
            }
            return builder.Build("VANDE mown outfield");
        }

        private static Mesh BuildCreaseMesh()
        {
            var builder = new ProductionMeshBuilder();
            var w = CricketEnvironmentDimensions.CreaseLineWidth;
            const float paintHeight = 0.010f;
            foreach (var end in new[] { -1f, 1f })
            {
                var popping = end * (CricketEnvironmentDimensions.PitchHalf -
                                      CricketEnvironmentDimensions.PoppingCrease);
                var bowling = end * CricketEnvironmentDimensions.PitchHalf;
                AddGroundRectangle(
                    builder,
                    new Vector3(0f, paintHeight, popping - end * w * 0.5f),
                    CricketEnvironmentDimensions.PoppingCreaseHalfWidth * 2f,
                    w,
                    0f);
                AddGroundRectangle(
                    builder,
                    new Vector3(0f, paintHeight, bowling - end * w * 0.5f),
                    CricketEnvironmentDimensions.ReturnCreaseX * 2f,
                    w,
                    0f);
                var back = end * (CricketEnvironmentDimensions.PitchHalf -
                                  CricketEnvironmentDimensions.PoppingCrease +
                                  CricketEnvironmentDimensions.ReturnCreaseLength);
                foreach (var side in new[] { -1f, 1f })
                {
                    AddGroundRectangle(
                        builder,
                        new Vector3(side * (CricketEnvironmentDimensions.ReturnCreaseX + w * 0.5f),
                            paintHeight, (popping + back) * 0.5f),
                        w,
                        Mathf.Abs(back - popping),
                        0f);
                }
            }
            return builder.Build("VANDE legal crease markings");
        }

        private static Mesh BuildPitchWearMesh()
        {
            var builder = new ProductionMeshBuilder();
            for (var endIndex = 0; endIndex < 2; endIndex++)
            {
                var end = endIndex == 0 ? -1f : 1f;
                var popping = end * (CricketEnvironmentDimensions.PitchHalf -
                                      CricketEnvironmentDimensions.PoppingCrease);
                for (var index = 0; index < 12; index++)
                {
                    var side = index % 2 == 0 ? -1f : 1f;
                    var x = side * (0.18f + (index % 4) * 0.08f);
                    var z = popping - end * (0.06f + index * 0.035f);
                    AddGroundPatch(builder, new Vector3(x, 0.004f, z),
                        0.07f + (index % 3) * 0.018f,
                        0.15f + (index % 4) * 0.026f,
                        side * (8f + index * 3f),
                        index * 0.71f + endIndex * 2.3f);
                }
            }
            return builder.Build("VANDE deterministic pitch wear");
        }

        private static Mesh BuildPitchGrassMesh()
        {
            var builder = new ProductionMeshBuilder();
            for (var index = 0; index < 22; index++)
            {
                var z = Mathf.Lerp(-9.5f, 9.5f, index / 21f);
                var x = Mathf.Sin(index * 2.17f) * 1.18f;
                AddGroundPatch(builder, new Vector3(x, 0.0055f, z),
                    0.08f + (index % 3) * 0.025f,
                    0.22f + (index % 4) * 0.045f,
                    index * 19f,
                    index * 1.37f);
            }
            return builder.Build("VANDE deterministic pitch grass cover");
        }

        private static Mesh BuildPitchCrackMesh()
        {
            var builder = new ProductionMeshBuilder();
            for (var index = 0; index < 12; index++)
            {
                var side = index % 2 == 0 ? 1f : -1f;
                var origin = new Vector3(
                    Mathf.Sin(index * 1.71f) * 0.94f,
                    0.0068f,
                    side * (3.0f + (index % 6) * 1.03f));
                var across = Mathf.Sin(index * 2.11f) * 0.16f;
                var first = origin + new Vector3(across, 0f, side * (0.18f + (index % 3) * 0.04f));
                var second = first + new Vector3(-across * 0.72f + side * 0.05f, 0f,
                    side * (0.15f + (index % 2) * 0.05f));
                AddGroundStroke(builder, origin, first, 0.014f);
                AddGroundStroke(builder, first, second, 0.010f);
                var branch = first + new Vector3(side * (index % 3 == 0 ? -0.12f : 0.10f),
                    0f, side * 0.07f);
                AddGroundStroke(builder, first, branch, 0.008f);
            }
            return builder.Build("VANDE deterministic pitch cracks");
        }

        private static void AddGroundPatch(
            ProductionMeshBuilder builder,
            Vector3 centre,
            float width,
            float length,
            float degrees,
            float irregularitySeed)
        {
            var angle = degrees * Mathf.Deg2Rad;
            var right = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle));
            var forward = new Vector3(-Mathf.Sin(angle), 0f, Mathf.Cos(angle));
            const int points = 6;
            var perimeter = new Vector3[points];
            for (var index = 0; index < points; index++)
            {
                // Clockwise winding when seen from above. The small deterministic
                // variation removes the repeated playing-card silhouette without
                // introducing runtime randomness or another simulation input.
                var phase = Mathf.PI * 2f * index / points;
                var variation = 0.90f + 0.10f * Mathf.Sin(irregularitySeed + index * 2.41f);
                perimeter[index] = centre + right * (Mathf.Cos(phase) * width * 0.5f * variation) -
                                   forward * (Mathf.Sin(phase) * length * 0.5f * variation);
            }
            for (var index = 0; index < points; index++)
                builder.AddTriangle(centre, perimeter[index], perimeter[(index + 1) % points],
                    Vector3.up);
        }

        private static void AddGroundRectangle(
            ProductionMeshBuilder builder,
            Vector3 centre,
            float width,
            float length,
            float degrees)
        {
            var angle = degrees * Mathf.Deg2Rad;
            var right = new Vector3(Mathf.Cos(angle), 0f, Mathf.Sin(angle)) * width * 0.5f;
            var forward = new Vector3(-Mathf.Sin(angle), 0f, Mathf.Cos(angle)) * length * 0.5f;
            builder.AddQuad(
                centre - right - forward,
                centre - right + forward,
                centre + right + forward,
                centre + right - forward,
                Vector3.up);
        }

        private static void AddGroundStroke(
            ProductionMeshBuilder builder,
            Vector3 start,
            Vector3 end,
            float width)
        {
            var direction = end - start;
            if (direction.sqrMagnitude <= 0.000001f) return;
            var across = new Vector3(direction.z, 0f, -direction.x).normalized * width * 0.5f;
            builder.AddQuad(
                start - across,
                end - across,
                end + across,
                start + across,
                Vector3.up);
        }

        private static Mesh BuildGroundRingMesh(
            string name,
            float radius,
            float width,
            int segments,
            float height)
        {
            if (radius <= 0f || width <= 0f) throw new ArgumentOutOfRangeException(nameof(radius));
            if (segments < 16) throw new ArgumentOutOfRangeException(nameof(segments));
            var builder = new ProductionMeshBuilder();
            var inner = radius - width * 0.5f;
            var outer = radius + width * 0.5f;
            for (var index = 0; index < segments; index++)
            {
                var a0 = Mathf.PI * 2f * index / segments;
                var a1 = Mathf.PI * 2f * (index + 1f) / segments;
                var radial0 = new Vector3(Mathf.Sin(a0), 0f, Mathf.Cos(a0));
                var radial1 = new Vector3(Mathf.Sin(a1), 0f, Mathf.Cos(a1));
                builder.AddQuad(
                    radial0 * outer + Vector3.up * height,
                    radial1 * outer + Vector3.up * height,
                    radial1 * inner + Vector3.up * height,
                    radial0 * inner + Vector3.up * height,
                    Vector3.up);
            }
            return builder.Build(name);
        }

        private static Mesh BuildTorusMesh(
            string name,
            float majorRadius,
            float minorRadius,
            int majorSegments,
            int minorSegments)
        {
            var vertices = new List<Vector3>(majorSegments * minorSegments);
            var normals = new List<Vector3>(majorSegments * minorSegments);
            var uv = new List<Vector2>(majorSegments * minorSegments);
            var triangles = new List<int>(majorSegments * minorSegments * 6);
            for (var major = 0; major < majorSegments; major++)
            {
                var majorAngle = Mathf.PI * 2f * major / majorSegments;
                var radial = new Vector3(Mathf.Sin(majorAngle), 0f, Mathf.Cos(majorAngle));
                for (var minor = 0; minor < minorSegments; minor++)
                {
                    var minorAngle = Mathf.PI * 2f * minor / minorSegments;
                    var normal = radial * Mathf.Cos(minorAngle) + Vector3.up * Mathf.Sin(minorAngle);
                    vertices.Add(radial * majorRadius + normal * minorRadius);
                    normals.Add(normal);
                    uv.Add(new Vector2(major / (float)majorSegments, minor / (float)minorSegments));
                }
            }
            for (var major = 0; major < majorSegments; major++)
            {
                var nextMajor = (major + 1) % majorSegments;
                for (var minor = 0; minor < minorSegments; minor++)
                {
                    var nextMinor = (minor + 1) % minorSegments;
                    var a = major * minorSegments + minor;
                    var b = nextMajor * minorSegments + minor;
                    var c = nextMajor * minorSegments + nextMinor;
                    var d = major * minorSegments + nextMinor;
                    triangles.Add(a); triangles.Add(b); triangles.Add(c);
                    triangles.Add(a); triangles.Add(c); triangles.Add(d);
                }
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh BuildTierMesh(
            string name,
            float innerRadius,
            float outerRadius,
            float minHeight,
            float maxHeight,
            int rows,
            int radialSegments)
        {
            var builder = new ProductionMeshBuilder();
            var gapHalf = Mathf.Atan2(
                CricketEnvironmentDimensions.SightScreenWidth * 0.5f + 1.5f,
                CricketEnvironmentDimensions.SightScreenDistance);
            for (var row = 0; row < rows; row++)
            {
                var r0 = Mathf.Lerp(innerRadius, outerRadius, row / (float)rows);
                var r1 = Mathf.Lerp(innerRadius, outerRadius, (row + 1f) / rows);
                var y = Mathf.Lerp(minHeight, maxHeight, (row + 1f) / rows);
                var previousY = Mathf.Lerp(minHeight, maxHeight, row / (float)rows);
                for (var segment = 0; segment < radialSegments; segment++)
                {
                    var a0 = Mathf.PI * 2f * segment / radialSegments;
                    var a1 = Mathf.PI * 2f * (segment + 1f) / radialSegments;
                    var middle = Mathf.Repeat((a0 + a1) * 0.5f, Mathf.PI * 2f);
                    var endGap = Mathf.Min(Mathf.Abs(Mathf.DeltaAngle(middle * Mathf.Rad2Deg, 0f)),
                        Mathf.Abs(Mathf.DeltaAngle(middle * Mathf.Rad2Deg, 180f))) * Mathf.Deg2Rad;
                    if (endGap < gapHalf) continue;
                    var inner0 = new Vector3(Mathf.Sin(a0) * r0, y, Mathf.Cos(a0) * r0);
                    var inner1 = new Vector3(Mathf.Sin(a1) * r0, y, Mathf.Cos(a1) * r0);
                    var outer1 = new Vector3(Mathf.Sin(a1) * r1, y, Mathf.Cos(a1) * r1);
                    var outer0 = new Vector3(Mathf.Sin(a0) * r1, y, Mathf.Cos(a0) * r1);
                    builder.AddQuad(inner0, outer0, outer1, inner1, Vector3.up);
                    var lower0 = new Vector3(Mathf.Sin(a0) * r0, previousY, Mathf.Cos(a0) * r0);
                    var lower1 = new Vector3(Mathf.Sin(a1) * r0, previousY, Mathf.Cos(a1) * r0);
                    var inward = new Vector3(-Mathf.Sin((a0 + a1) * 0.5f), 0f,
                        -Mathf.Cos((a0 + a1) * 0.5f));
                    builder.AddQuad(lower1, lower0, inner0, inner1, inward);
                }
            }
            return builder.Build(name);
        }

        private static void ConfigureSurface(
            Material material,
            float smoothness,
            float metallic,
            float ambient,
            float rim)
        {
            SetFloat(material, "_Smoothness", smoothness);
            SetFloat(material, "_Metallic", metallic);
            SetFloat(material, "_AmbientStrength", ambient);
            SetFloat(material, "_RimStrength", rim);
        }

        private static void ConfigureColourResponse(
            Material material,
            float saturation,
            float albedoGain)
        {
            SetFloat(material, "_Saturation", Mathf.Clamp(saturation, 0f, 1.25f));
            SetFloat(material, "_AlbedoGain", Mathf.Clamp(albedoGain, 0.35f, 1.25f));
        }

        private static void SetEmission(Material material, Color colour)
        {
            if (material != null && material.HasProperty("_EmissionColor"))
                material.SetColor("_EmissionColor", colour);
        }

        private static void SetFloat(Material material, string property, float value)
        {
            if (material != null && material.HasProperty(property))
                material.SetFloat(property, value);
        }
    }
}
