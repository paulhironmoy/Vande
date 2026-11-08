using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Props
{
    public enum ProductionPropQuality
    {
        Lite,
        Standard,
        High
    }

    /// <summary>
    /// Metres, copied from the repository's authoritative TypeScript geometry.
    /// These values describe presentation only; Unity never resolves gameplay.
    /// </summary>
    public static class CricketPropDimensions
    {
        public const float BallRadius = 0.036f;
        // Law 8: 28 in = 71.12 cm, the same value as src/physics/geometry.ts STUMP_H (0.7112 since PHYS item 17).
        public const float StumpHeight = 0.7112f;
        public const float StumpRadius = 0.0175f;
        public const float StumpSpacing = 0.0968f;
        public const float BailLength = 0.1095f;
        public const float BailBarrelLength = 0.054f;
        public const float BailLongSpigot = 0.035f;
        public const float BailShortSpigot = 0.0206f;
        public const float BailBarrelRadius = 0.0069f;
        public const float BailSpigotRadius = 0.0045f;
        public const float BailAxisHeight = StumpHeight - 0.003f + BailSpigotRadius;
        public const float BladeLength = 0.56f;
        public const float BladeWidth = 0.108f;
        public const float BladeCollisionThickness = 0.05f;
        public const float BladeEdgeThickness = 0.04f;
        public const float HandleLength = 0.3f;
        public const float GripRadius = 0.0182f;
        public const float SweetSpotFractionFromToe = 0.22f;
        public const float TotalBatLength = BladeLength + HandleLength;
    }

    public sealed class ProductionWicketVisual : ProductionOwnedVisual
    {
        private const float BailReactionSeconds = 0.72f;
        private Vector3[] stumpRestPositions;
        private Quaternion[] stumpRestRotations;
        private Vector3[] bailRestPositions;
        private Quaternion[] bailRestRotations;
        private float reactionElapsed;
        private int impactedStump = -1;
        private int dislodgedBail = -1;
        private float reactionDirection = 1f;
        private bool reducedMotion;

        internal ProductionWicketVisual(GameObject root) : base(root) { }

        public Transform[] Stumps { get; internal set; }
        public Transform[] Bails { get; internal set; }
        public float Width => CricketPropDimensions.StumpSpacing * 2f + CricketPropDimensions.StumpRadius * 2f;
        public bool IsBroken { get; private set; }
        public int DislodgedBailIndex => dislodgedBail;

        internal void CaptureRestState()
        {
            stumpRestPositions = CapturePositions(Stumps);
            stumpRestRotations = CaptureRotations(Stumps);
            bailRestPositions = CapturePositions(Bails);
            bailRestRotations = CaptureRotations(Bails);
        }

        /// <summary>
        /// Starts a deterministic visual reaction after an authoritative
        /// <c>stumps</c> trace event. The impact X only chooses which already
        /// modelled stump and bail react; it never decides a dismissal.
        /// </summary>
        public void ReactToAuthoritativeImpact(float localImpactX, bool useReducedMotion)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionWicketVisual));
            if (IsBroken) return;
            if (float.IsNaN(localImpactX) || float.IsInfinity(localImpactX))
                throw new ArgumentOutOfRangeException(nameof(localImpactX));

            IsBroken = true;
            reducedMotion = useReducedMotion;
            reactionElapsed = 0f;
            impactedStump = Mathf.Clamp(
                Mathf.RoundToInt(localImpactX / CricketPropDimensions.StumpSpacing) + 1,
                0,
                2);
            dislodgedBail = localImpactX <= 0f ? 0 : 1;
            reactionDirection = dislodgedBail == 0 ? -1f : 1f;
            ApplyReaction(useReducedMotion ? 1f : 0f);
        }

        public void TickReaction(float deltaSeconds)
        {
            if (IsDisposed || !IsBroken || reactionElapsed >= BailReactionSeconds) return;
            if (float.IsNaN(deltaSeconds) || float.IsInfinity(deltaSeconds) || deltaSeconds < 0f)
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
            if (reducedMotion)
            {
                reactionElapsed = BailReactionSeconds;
                ApplyReaction(1f);
                return;
            }

            reactionElapsed = Mathf.Min(BailReactionSeconds, reactionElapsed + deltaSeconds);
            ApplyReaction(reactionElapsed / BailReactionSeconds);
        }

        public void ResetReaction()
        {
            if (IsDisposed) return;
            RestoreTransforms(Stumps, stumpRestPositions, stumpRestRotations);
            RestoreTransforms(Bails, bailRestPositions, bailRestRotations);
            IsBroken = false;
            reactionElapsed = 0f;
            impactedStump = -1;
            dislodgedBail = -1;
            reactionDirection = 1f;
            reducedMotion = false;
        }

        private void ApplyReaction(float progress)
        {
            if (impactedStump < 0 || dislodgedBail < 0) return;
            progress = Mathf.Clamp01(progress);

            var stump = Stumps[impactedStump];
            stump.localPosition = stumpRestPositions[impactedStump];
            stump.localRotation = stumpRestRotations[impactedStump] *
                                  Quaternion.Euler(0f, 0f, -reactionDirection * 7f * progress);

            var bail = Bails[dislodgedBail];
            var start = bailRestPositions[dislodgedBail];
            var settled = new Vector3(
                start.x + reactionDirection * 0.16f,
                0.018f,
                start.z + 0.085f);
            var arc = Mathf.Sin(progress * Mathf.PI) * 0.19f;
            bail.localPosition = Vector3.Lerp(start, settled, progress) + Vector3.up * arc;
            bail.localRotation = bailRestRotations[dislodgedBail] * Quaternion.Euler(
                progress * 310f,
                progress * reactionDirection * 135f,
                progress * reactionDirection * 225f);
        }

        private static Vector3[] CapturePositions(Transform[] values)
        {
            var result = new Vector3[values.Length];
            for (var index = 0; index < values.Length; index++) result[index] = values[index].localPosition;
            return result;
        }

        private static Quaternion[] CaptureRotations(Transform[] values)
        {
            var result = new Quaternion[values.Length];
            for (var index = 0; index < values.Length; index++) result[index] = values[index].localRotation;
            return result;
        }

        private static void RestoreTransforms(
            Transform[] values,
            Vector3[] positions,
            Quaternion[] rotations)
        {
            if (values == null || positions == null || rotations == null) return;
            for (var index = 0; index < values.Length; index++)
            {
                values[index].localPosition = positions[index];
                values[index].localRotation = rotations[index];
            }
        }
    }

    public sealed class ProductionBatVisual : ProductionOwnedVisual
    {
        internal ProductionBatVisual(GameObject root) : base(root) { }

        public Transform Blade { get; internal set; }
        public Transform Handle { get; internal set; }
        public Vector3 SweetSpotLocal => new Vector3(
            0f,
            -CricketPropDimensions.TotalBatLength +
            CricketPropDimensions.SweetSpotFractionFromToe * CricketPropDimensions.BladeLength,
            CricketPropDimensions.BladeCollisionThickness * 0.5f);
    }

    public sealed class ProductionBallVisual : ProductionOwnedVisual
    {
        private Material roughMaterial;
        private Material polishedMaterial;
        private Transform appearanceFrame;
        private Transform seamFrame;
        private Quaternion configuredAppearance = Quaternion.identity;
        private Quaternion configuredSeam = Quaternion.identity;
        private Vector3 releaseVisualSpinRadPerSecond;
        private Vector3 afterBounceVisualSpinRadPerSecond;
        private double bounceTime;
        private bool hasAfterBounceSpin;
        private bool hasAuthoritativeRotation;

        internal ProductionBallVisual(GameObject root) : base(root) { }

        /// <summary>Compatibility handle for the trace player and camera director.</summary>
        public GameObject GameObject => Root;

        internal void Bind(
            Transform bodyFrame,
            Transform seam,
            Material rough,
            Material polished)
        {
            appearanceFrame = bodyFrame;
            seamFrame = seam;
            roughMaterial = rough;
            polishedMaterial = polished;
        }

        public float Radius => CricketPropDimensions.BallRadius;

        public void SetVisible(bool visible)
        {
            if (IsDisposed) throw new ObjectDisposedException(nameof(ProductionBallVisual));
            Root.SetActive(visible);
        }

        public void SetAppearance(string colour, string age)
        {
            var worn = string.Equals(age, "worn", StringComparison.Ordinal);
            var baseColour = string.Equals(colour, "white", StringComparison.Ordinal)
                ? new Color(0.92f, 0.90f, 0.82f)
                : new Color(0.55f, 0.03f, 0.025f);
            if (worn)
                baseColour = Color.Lerp(baseColour, new Color(0.32f, 0.23f, 0.17f), 0.22f);
            roughMaterial.color = Color.Lerp(baseColour, Color.black, 0.08f);
            polishedMaterial.color = Color.Lerp(baseColour, Color.white, 0.24f);
            SetSmoothness(roughMaterial, worn ? 0.10f : 0.14f);
            SetSmoothness(polishedMaterial, worn ? 0.58f : 0.82f);
        }

        private static void SetSmoothness(Material material, float value)
        {
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", value);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", value);
        }

        /// <summary>Axes are canonical presentation vectors supplied by the TypeScript trace.</summary>
        public void ConfigureOrientation(Vector3 seamAxis, Vector3 shineDirection)
        {
            configuredAppearance = shineDirection.sqrMagnitude > 0.000001f
                ? Quaternion.FromToRotation(Vector3.forward, shineDirection.normalized)
                : Quaternion.identity;
            configuredSeam = seamAxis.sqrMagnitude > 0.000001f
                ? Quaternion.FromToRotation(Vector3.forward, seamAxis.normalized)
                : Quaternion.identity;
            hasAuthoritativeRotation = false;
            appearanceFrame.localRotation = configuredAppearance;
            seamFrame.localRotation = configuredSeam;
        }

        /// <summary>
        /// Configures the rigid surface from the exact host flight. This mirrors
        /// TypeScript ballRotation(): an upright angled seam rotates about its
        /// presented normal, while scrambled/spin deliveries use physical spin.
        /// At the pitch the already-rotated surface is carried forward before
        /// the authoritative after-bounce angular velocity takes over.
        /// </summary>
        public void ConfigureFlightOrientation(
            Vector3 seamAxis,
            Vector3 shineDirection,
            double seamWobble,
            Vector3 releaseSpinRadPerSecond,
            Vector3? afterBounceSpinRadPerSecond,
            double? authoritativeBounceTime,
            bool spinBowler)
        {
            ConfigureOrientation(seamAxis, shineDirection);
            var correctUpright = UsesUprightSeamRotation(
                seamAxis, releaseSpinRadPerSecond, seamWobble);
            releaseVisualSpinRadPerSecond = ClampVisualSpin(
                correctUpright
                    ? RotationAboutSeam(seamAxis, releaseSpinRadPerSecond)
                    : releaseSpinRadPerSecond,
                spinBowler);
            hasAfterBounceSpin = authoritativeBounceTime.HasValue &&
                                 afterBounceSpinRadPerSecond.HasValue;
            bounceTime = hasAfterBounceSpin
                ? Math.Max(0.0, authoritativeBounceTime.Value)
                : 0.0;
            afterBounceVisualSpinRadPerSecond = hasAfterBounceSpin
                ? ClampVisualSpin(
                    correctUpright
                        ? RotationAboutSeam(seamAxis, afterBounceSpinRadPerSecond.Value)
                        : afterBounceSpinRadPerSecond.Value,
                    spinBowler)
                : Vector3.zero;
            hasAuthoritativeRotation = true;
        }

        public static bool UsesUprightSeamRotation(
            Vector3 seamAxis,
            Vector3 releaseSpinRadPerSecond,
            double seamWobble)
        {
            if (seamWobble != 0.0) return false;
            var wx = (double)releaseSpinRadPerSecond.x;
            var wy = (double)releaseSpinRadPerSecond.y;
            var wz = (double)releaseSpinRadPerSecond.z;
            var magnitude = Math.Sqrt(wx * wx + wy * wy + wz * wz);
            if (magnitude <= 1e-12) return false;
            var cx = seamAxis.y * wz - seamAxis.z * wy;
            var cy = seamAxis.z * wx - seamAxis.x * wz;
            var cz = seamAxis.x * wy - seamAxis.y * wx;
            return Math.Sqrt(cx * cx + cy * cy + cz * cz) > 1e-9 * magnitude;
        }

        public static Vector3 RotationAboutSeam(Vector3 seamAxis, Vector3 spinRadPerSecond)
        {
            var rate = spinRadPerSecond.magnitude;
            if (Vector3.Dot(spinRadPerSecond, seamAxis) < 0f) rate = -rate;
            return seamAxis * rate;
        }

        private static Vector3 ClampVisualSpin(Vector3 spinRadPerSecond, bool spinBowler)
        {
            var magnitude = spinRadPerSecond.magnitude;
            var maximum = (spinBowler ? 8f : 6f) * Mathf.PI * 2f;
            return magnitude > maximum && magnitude > 0.000001f
                ? spinRadPerSecond * (maximum / magnitude)
                : spinRadPerSecond;
        }

        private static Quaternion RotationAt(Vector3 spinRadPerSecond, double seconds)
        {
            if (seconds <= 0.0) return Quaternion.identity;
            var magnitude = spinRadPerSecond.magnitude;
            if (magnitude <= 0f) return Quaternion.identity;
            // seamSpin() uses +X as the stable axis below its normalization
            // threshold while retaining the authoritative (tiny) rate.
            var axis = magnitude > 0.000001f
                ? spinRadPerSecond / magnitude
                : Vector3.right;
            return Quaternion.AngleAxis(
                (float)(magnitude * seconds * Mathf.Rad2Deg),
                axis);
        }

        public void SetPose(Vector3 position, double simulationTime)
        {
            if (!hasAuthoritativeRotation)
                throw new InvalidOperationException(
                    "Authoritative ball orientation must be configured before trace playback.");
            Root.transform.position = position;
            Quaternion spin;
            if (hasAfterBounceSpin && simulationTime > bounceTime)
            {
                var carriedToBounce = RotationAt(releaseVisualSpinRadPerSecond, bounceTime);
                var afterBounce = RotationAt(
                    afterBounceVisualSpinRadPerSecond,
                    simulationTime - bounceTime);
                spin = afterBounce * carriedToBounce;
            }
            else
            {
                spin = RotationAt(releaseVisualSpinRadPerSecond, simulationTime);
            }
            appearanceFrame.localRotation = spin * configuredAppearance;
            seamFrame.localRotation = spin * configuredSeam;
        }

        /// <summary>Compatibility path for the synthetic device benchmark.</summary>
        public void SetPose(Vector3 position, Vector3 spinAxis, double spinRps, double simulationTime)
        {
            Root.transform.position = position;
            var spin = spinAxis.sqrMagnitude > 0.000001f
                ? Quaternion.AngleAxis((float)(spinRps * 360.0 * simulationTime), spinAxis.normalized)
                : Quaternion.identity;
            appearanceFrame.localRotation = spin * configuredAppearance;
            seamFrame.localRotation = spin * configuredSeam;
        }
    }

    public static class ProductionCricketProps
    {
        public static ProductionWicketVisual CreateWicket(
            Transform parent,
            string name,
            ProductionPropQuality quality,
            bool shadows)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var root = new GameObject(string.IsNullOrEmpty(name) ? "ProductionWicket" : name);
            root.transform.SetParent(parent, false);
            var visual = new ProductionWicketVisual(root);
            var wood = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE wicket wood", new Color(0.91f, 0.88f, 0.78f)));
            var band = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE wicket band", new Color(0.08f, 0.13f, 0.39f)));
            var segments = quality == ProductionPropQuality.Lite ? 8 :
                quality == ProductionPropQuality.Standard ? 12 : 18;
            var stumpMesh = visual.Own(CreateStumpMesh(segments));
            var bailMesh = visual.Own(CreateBailMesh(segments));
            visual.Stumps = new Transform[3];
            for (var index = 0; index < 3; index++)
            {
                var stump = ProductionVisualPrimitives.CreateMeshObject(
                    "Stump-" + index,
                    root.transform,
                    stumpMesh,
                    new[] { wood, band },
                    shadows);
                stump.transform.localPosition = new Vector3((index - 1) * CricketPropDimensions.StumpSpacing, 0f, 0f);
                visual.Stumps[index] = stump.transform;
            }

            visual.Bails = new Transform[2];
            const float innerMeet = 0.0009f;
            for (var index = 0; index < 2; index++)
            {
                var direction = index == 0 ? -1f : 1f;
                var bail = ProductionVisualPrimitives.CreateMeshObject(
                    "Bail-" + index,
                    root.transform,
                    bailMesh,
                    new[] { wood },
                    shadows);
                bail.transform.localPosition = new Vector3(
                    direction * (innerMeet + CricketPropDimensions.BailLength * 0.5f),
                    CricketPropDimensions.BailAxisHeight,
                    0f);
                if (direction < 0f) bail.transform.localRotation = Quaternion.Euler(0f, 180f, 0f);
                visual.Bails[index] = bail.transform;
            }
            visual.CaptureRestState();
            return visual;
        }

        public static ProductionBatVisual CreateBat(
            Transform parent,
            string name,
            ProductionPropQuality quality,
            bool shadows)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var root = new GameObject(string.IsNullOrEmpty(name) ? "ProductionBat" : name);
            root.transform.SetParent(parent, false);
            var visual = new ProductionBatVisual(root);
            var willow = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE willow face", new Color(0.88f, 0.76f, 0.53f)));
            var edge = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE willow edge", new Color(0.66f, 0.49f, 0.28f)));
            ProductionVisualPrimitives.ApplyResourceTexture(
                willow, "Textures/bat-willow-albedo", Vector2.one);
            ProductionVisualPrimitives.ApplyResourceTexture(
                edge, "Textures/bat-willow-albedo", Vector2.one);
            var grip = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE original navy grip", new Color(0.055f, 0.08f, 0.22f)));
            var bladeMesh = visual.Own(CreateBatBladeMesh(quality));
            var blade = ProductionVisualPrimitives.CreateMeshObject(
                "LawScaleBlade", root.transform, bladeMesh, new[] { willow, edge }, shadows);
            visual.Blade = blade.transform;

            var handleBuilder = new ProductionMeshBuilder();
            var handleSegments = quality == ProductionPropQuality.Lite ? 8 : 12;
            handleBuilder.AddCylinder(
                new Vector3(0f, -CricketPropDimensions.HandleLength * 0.5f, 0f),
                CricketPropDimensions.GripRadius,
                CricketPropDimensions.HandleLength,
                handleSegments,
                Quaternion.identity);
            var handleMesh = visual.Own(handleBuilder.Build("VANDE ribbed bat handle"));
            var handle = ProductionVisualPrimitives.CreateMeshObject(
                "RibbedHandle", root.transform, handleMesh, new[] { grip }, shadows);
            visual.Handle = handle.transform;
            return visual;
        }

        public static ProductionBallVisual CreateBall(
            Transform parent,
            string name,
            ProductionPropQuality quality,
            bool shadows)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var root = new GameObject(string.IsNullOrEmpty(name) ? "ProductionBall" : name);
            root.transform.SetParent(parent, false);
            var visual = new ProductionBallVisual(root);
            var rough = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE ball rough half", new Color(0.50f, 0.025f, 0.02f)));
            var polished = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE ball polished half", new Color(0.68f, 0.06f, 0.045f)));
            var seam = visual.Own(ProductionVisualPrimitives.CreateMaterial(
                "VANDE raised seam", new Color(0.92f, 0.86f, 0.73f)));
            // Surface response, rather than an exaggerated colour split, makes
            // the canonical shiny side readable as the ball rotates. These are
            // presentation properties only; size, pose and trajectory continue
            // to come from the authoritative trace.
            SetSurfaceResponse(rough, 0.14f, 0.035f);
            SetSurfaceResponse(polished, 0.82f, 0.055f);
            SetSurfaceResponse(seam, 0.22f, 0.04f);
            var latitudes = quality == ProductionPropQuality.Lite ? 8 :
                quality == ProductionPropQuality.Standard ? 12 : 16;
            var longitudes = latitudes * 2;
            var bodyMesh = visual.Own(CreateBallMesh(latitudes, longitudes));
            var seamMesh = visual.Own(CreateDoubleSeamMesh(longitudes, quality == ProductionPropQuality.Lite ? 3 : 5));
            var bodyFrame = new GameObject("ShineOrientation").transform;
            bodyFrame.SetParent(root.transform, false);
            ProductionVisualPrimitives.CreateMeshObject(
                "LawScaleBallBody", bodyFrame, bodyMesh, new[] { rough, polished }, shadows);
            var seamFrame = new GameObject("SeamOrientation").transform;
            seamFrame.SetParent(root.transform, false);
            ProductionVisualPrimitives.CreateMeshObject(
                "RaisedDoubleSeam", seamFrame, seamMesh, new[] { seam }, shadows);
            visual.Bind(bodyFrame, seamFrame, rough, polished);
            return visual;
        }

        private static void SetSurfaceResponse(Material material, float smoothness, float rimStrength)
        {
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            if (material.HasProperty("_Glossiness")) material.SetFloat("_Glossiness", smoothness);
            if (material.HasProperty("_RimStrength")) material.SetFloat("_RimStrength", rimStrength);
        }

        private static Mesh CreateStumpMesh(int segments)
        {
            // A faceted section is narrowest across its flats (apothem = vertex radius x cos(pi/segments)). Scale the
            // vertices so every tier is at least the law diameter across the flats (Law 8: 34.9-38.1 mm): 18 segments
            // measure 35.0 mm across flats and 35.5 mm across corners; 8 segments 35.0 and 37.9 mm (ART1).
            var facet = 1f / Mathf.Cos(Mathf.PI / segments);
            const float domeHeight = 0.006f;
            const float grooveHalfWidth = 0.005f;
            const float grooveDepth = 0.003f;
            var rings = new[]
            {
                new Vector2(0f, CricketPropDimensions.StumpRadius),
                new Vector2(0.02f, CricketPropDimensions.StumpRadius),
                new Vector2(CricketPropDimensions.StumpHeight - domeHeight, CricketPropDimensions.StumpRadius),
                new Vector2(CricketPropDimensions.StumpHeight - domeHeight * 0.45f, CricketPropDimensions.StumpRadius * 0.82f),
                new Vector2(CricketPropDimensions.StumpHeight, 0.0065f),
                new Vector2(CricketPropDimensions.StumpHeight, 0.001f)
            };
            var vertices = new List<Vector3>();
            var triangles = new[] { new List<int>(), new List<int>() };
            for (var ring = 0; ring < rings.Length; ring++)
            {
                for (var index = 0; index <= segments; index++)
                {
                    var angle = Mathf.PI * 2f * index / segments;
                    var radius = rings[ring].y * facet;
                    var z = Mathf.Cos(angle) * radius;
                    var y = rings[ring].x;
                    if (ring >= rings.Length - 2 && Mathf.Abs(z) < grooveHalfWidth)
                        y = Mathf.Min(y, CricketPropDimensions.StumpHeight - grooveDepth);
                    vertices.Add(new Vector3(Mathf.Sin(angle) * radius, y, z));
                }
            }
            for (var ring = 0; ring < rings.Length - 1; ring++)
            {
                var midpointY = (rings[ring].x + rings[ring + 1].x) * 0.5f;
                var target = midpointY >= CricketPropDimensions.StumpHeight - 0.153f &&
                             midpointY <= CricketPropDimensions.StumpHeight - 0.112f ? 1 : 0;
                for (var index = 0; index < segments; index++)
                {
                    var a = ring * (segments + 1) + index;
                    var b = a + 1;
                    var d = a + segments + 1;
                    var c = d + 1;
                    triangles[target].Add(a);
                    triangles[target].Add(d);
                    triangles[target].Add(c);
                    triangles[target].Add(a);
                    triangles[target].Add(c);
                    triangles[target].Add(b);
                }
            }
            var mesh = new Mesh { name = "VANDE law-scale grooved stump" };
            mesh.SetVertices(vertices);
            mesh.subMeshCount = 2;
            mesh.SetTriangles(triangles[0], 0);
            mesh.SetTriangles(triangles[1], 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateBailMesh(int segments)
        {
            var half = CricketPropDimensions.BailLength * 0.5f;
            var barrelStart = -half + CricketPropDimensions.BailShortSpigot;
            var barrelEnd = barrelStart + CricketPropDimensions.BailBarrelLength;
            var profile = new[]
            {
                new Vector2(-half, 0.0002f),
                new Vector2(-half + 0.003f, CricketPropDimensions.BailSpigotRadius),
                new Vector2(barrelStart - 0.002f, CricketPropDimensions.BailSpigotRadius),
                new Vector2(barrelStart, CricketPropDimensions.BailBarrelRadius),
                new Vector2((barrelStart + barrelEnd) * 0.5f, CricketPropDimensions.BailBarrelRadius),
                new Vector2(barrelEnd, CricketPropDimensions.BailBarrelRadius),
                new Vector2(barrelEnd + 0.002f, CricketPropDimensions.BailSpigotRadius),
                new Vector2(half - 0.003f, CricketPropDimensions.BailSpigotRadius),
                new Vector2(half, 0.0002f)
            };
            return CreateTubeAlongX("VANDE law-scale turned bail", profile, segments);
        }

        private static Mesh CreateTubeAlongX(string name, Vector2[] profile, int segments)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            for (var ring = 0; ring < profile.Length; ring++)
            {
                for (var index = 0; index <= segments; index++)
                {
                    var angle = Mathf.PI * 2f * index / segments;
                    vertices.Add(new Vector3(
                        profile[ring].x,
                        Mathf.Sin(angle) * profile[ring].y,
                        Mathf.Cos(angle) * profile[ring].y));
                }
            }
            for (var ring = 0; ring < profile.Length - 1; ring++)
            {
                for (var index = 0; index < segments; index++)
                {
                    var a = ring * (segments + 1) + index;
                    var b = a + 1;
                    var d = a + segments + 1;
                    var c = d + 1;
                    triangles.Add(a); triangles.Add(d); triangles.Add(c);
                    triangles.Add(a); triangles.Add(c); triangles.Add(b);
                }
            }
            var mesh = new Mesh { name = name };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateBatBladeMesh(ProductionPropQuality quality)
        {
            var stationCount = quality == ProductionPropQuality.Lite ? 7 :
                quality == ProductionPropQuality.Standard ? 11 : 17;
            const int outlineCount = 7;
            var vertices = new List<Vector3>();
            var uv = new List<Vector2>();
            var triangles = new[] { new List<int>(), new List<int>() };
            for (var station = 0; station < stationCount; station++)
            {
                var u = station / (float)(stationCount - 1);
                var y = -CricketPropDimensions.TotalBatLength + u * CricketPropDimensions.BladeLength;
                var shoulder = u <= 0.91f ? 1f : Mathf.Lerp(1f, 0.36f, (u - 0.91f) / 0.09f);
                var toe = Mathf.Clamp01(u / 0.035f);
                var halfWidth = CricketPropDimensions.BladeWidth * 0.5f * shoulder * Mathf.Lerp(0.86f, 1f, toe);
                var spineWave = Mathf.Sin(Mathf.Clamp01(u / 0.82f) * Mathf.PI);
                var depth = Mathf.Lerp(0.046f, 0.064f, spineWave * spineWave);
                var face = CricketPropDimensions.BladeCollisionThickness * 0.5f;
                var backEdge = face - CricketPropDimensions.BladeEdgeThickness;
                vertices.Add(new Vector3(-halfWidth, y, face - 0.008f));
                vertices.Add(new Vector3(-halfWidth + 0.004f, y, face));
                vertices.Add(new Vector3(halfWidth - 0.004f, y, face));
                vertices.Add(new Vector3(halfWidth, y, face - 0.008f));
                vertices.Add(new Vector3(halfWidth, y, backEdge));
                vertices.Add(new Vector3(0f, y, face - depth));
                vertices.Add(new Vector3(-halfWidth, y, backEdge));
                for (var outline = 0; outline < outlineCount; outline++)
                    uv.Add(new Vector2(outline / (float)(outlineCount - 1), u));
            }
            for (var station = 0; station < stationCount - 1; station++)
            {
                for (var edge = 0; edge < outlineCount; edge++)
                {
                    var nextEdge = (edge + 1) % outlineCount;
                    var a = station * outlineCount + edge;
                    var b = station * outlineCount + nextEdge;
                    var d = (station + 1) * outlineCount + edge;
                    var c = (station + 1) * outlineCount + nextEdge;
                    var target = edge == 1 ? 0 : 1;
                    triangles[target].Add(a); triangles[target].Add(d); triangles[target].Add(c);
                    triangles[target].Add(a); triangles[target].Add(c); triangles[target].Add(b);
                }
            }
            for (var end = 0; end < 2; end++)
            {
                var ring = end == 0 ? 0 : (stationCount - 1) * outlineCount;
                var centre = Vector3.zero;
                for (var index = 0; index < outlineCount; index++) centre += vertices[ring + index];
                centre /= outlineCount;
                var centreIndex = vertices.Count;
                vertices.Add(centre);
                uv.Add(new Vector2(0.5f, end));
                for (var index = 0; index < outlineCount; index++)
                {
                    var next = (index + 1) % outlineCount;
                    if (end == 0)
                    {
                        triangles[1].Add(centreIndex); triangles[1].Add(ring + next); triangles[1].Add(ring + index);
                    }
                    else
                    {
                        triangles[1].Add(centreIndex); triangles[1].Add(ring + index); triangles[1].Add(ring + next);
                    }
                }
            }
            var mesh = new Mesh { name = "VANDE law-scale lofted bat blade" };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.subMeshCount = 2;
            mesh.SetTriangles(triangles[0], 0);
            mesh.SetTriangles(triangles[1], 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateBallMesh(int latitudes, int longitudes)
        {
            var vertices = new List<Vector3>();
            var triangles = new[] { new List<int>(), new List<int>() };
            for (var latitude = 0; latitude <= latitudes; latitude++)
            {
                var polar = Mathf.PI * latitude / latitudes;
                var y = Mathf.Cos(polar);
                var ring = Mathf.Sin(polar);
                for (var longitude = 0; longitude <= longitudes; longitude++)
                {
                    var azimuth = Mathf.PI * 2f * longitude / longitudes;
                    vertices.Add(new Vector3(
                        ring * Mathf.Sin(azimuth),
                        y,
                        ring * Mathf.Cos(azimuth)) * CricketPropDimensions.BallRadius);
                }
            }
            for (var latitude = 0; latitude < latitudes; latitude++)
            {
                for (var longitude = 0; longitude < longitudes; longitude++)
                {
                    var a = latitude * (longitudes + 1) + longitude;
                    var b = a + 1;
                    var d = a + longitudes + 1;
                    var c = d + 1;
                    var polishedHalf = (vertices[a].z + vertices[b].z + vertices[c].z + vertices[d].z) >= 0f;
                    var target = polishedHalf ? triangles[1] : triangles[0];
                    target.Add(a); target.Add(d); target.Add(c);
                    target.Add(a); target.Add(c); target.Add(b);
                }
            }
            var mesh = new Mesh { name = "VANDE law-scale split-finish cricket ball" };
            mesh.SetVertices(vertices);
            mesh.subMeshCount = 2;
            mesh.SetTriangles(triangles[0], 0);
            mesh.SetTriangles(triangles[1], 1);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateDoubleSeamMesh(int majorSegments, int minorSegments)
        {
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            var tube = 0.00115f;
            foreach (var offset in new[] { -0.0017f, 0.0017f })
            {
                var start = vertices.Count;
                var majorRadius = Mathf.Sqrt(
                    CricketPropDimensions.BallRadius * CricketPropDimensions.BallRadius - offset * offset) * 1.007f;
                for (var major = 0; major < majorSegments; major++)
                {
                    var majorAngle = Mathf.PI * 2f * major / majorSegments;
                    var radial = new Vector3(Mathf.Cos(majorAngle), Mathf.Sin(majorAngle), 0f);
                    for (var minor = 0; minor < minorSegments; minor++)
                    {
                        var minorAngle = Mathf.PI * 2f * minor / minorSegments;
                        vertices.Add(radial * (majorRadius + tube * Mathf.Cos(minorAngle)) +
                                     Vector3.forward * (offset + tube * Mathf.Sin(minorAngle)));
                    }
                }
                for (var major = 0; major < majorSegments; major++)
                {
                    var nextMajor = (major + 1) % majorSegments;
                    for (var minor = 0; minor < minorSegments; minor++)
                    {
                        var nextMinor = (minor + 1) % minorSegments;
                        var a = start + major * minorSegments + minor;
                        var b = start + nextMajor * minorSegments + minor;
                        var c = start + nextMajor * minorSegments + nextMinor;
                        var d = start + major * minorSegments + nextMinor;
                        triangles.Add(a); triangles.Add(b); triangles.Add(c);
                        triangles.Add(a); triangles.Add(c); triangles.Add(d);
                    }
                }
            }
            var mesh = new Mesh { name = "VANDE raised double stitched seam" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
