using System;
using UnityEngine;
using UnityEngine.Rendering;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Effects
{
    /// <summary>
    /// Mobile-bounded, presentation-only delivery effects. Every path and
    /// response is driven by authoritative trace samples/events supplied by
    /// the host. This class never simulates, collides, scores or dismisses.
    ///
    /// Setup and trace preparation may allocate between deliveries. Tick,
    /// SetBallPose and SetPlaybackTime are allocation-free steady-state calls.
    /// </summary>
    public sealed class ProductionDeliveryEffects : IDisposable
    {
        private const int MaximumResponseCapacity = 6;
        private const int MaximumRingSegments = 24;
        private const float LandingRadius = 0.105f;
        private const float LandingHeight = 0.012f;
        private const float PredictionWidth = 0.0065f;
        private const float ActualWidth = 0.011f;
        private const float ReadabilityOuterWidthPixels = 0.90f;
        private const float ReadabilityInnerWidthPixels = 0.36f;
        public const float MinimumReadabilityDiameterPixels = 3.5f;

        // The web ball's dark surround (src/render3d/practice/ballLook.ts PRACTICE_BALL.shade): "a shadow round the
        // ball, never a glow", darkest at the ball's edge and gone ShadePixels out. A white ball on the tan pitch is
        // about 2:1 on its own; the shade brings its local background down (READ2, T1). Distances are CSS px of the
        // 915x412 reference phone, so the shade covers the same share of the screen at every resolution.
        public const float ShadePixels = 12f;
        public const float ShadeRimPixels = 1.25f;
        public const float ShadeRimOpacity = 0.86f;
        public const float ShadeOpacity = 0.62f;
        public const float ShadeReferenceViewportCssHeight = 412f;
        /// <summary>
        /// The shade is drawn on the ball's sight line this share of the way to the camera, at the same apparent size,
        /// so the pitch cannot hide its lower half while the ball is on or near the ground.
        /// </summary>
        public const float ShadeCameraPull = 0.5f;
        public static readonly Color ShadeColour = new Color(0x05 / 255f, 0x06 / 255f, 0x0f / 255f, 1f);
        // Ring offsets outside the ball's edge (CSS px). The rim is a step (two rings at the rim's edge); the fall to
        // nothing is sampled finely enough that linear interpolation stays within 0.02 of the smoothstep curve.
        private static readonly float[] ShadeRingPixels =
            { 0f, ShadeRimPixels, ShadeRimPixels, 2.5f, 3.75f, 5f, 6.25f, 7.5f, 8.75f, 10f, 11f, ShadePixels };
        private const int ShadeSegments = MaximumRingSegments;

        private readonly GameObject root;
        private readonly Transform readabilityRoot;
        private readonly LineRenderer readabilityOuterRing;
        private readonly LineRenderer readabilityInnerRing;
        private readonly Transform shadeRoot;
        private readonly Mesh shadeMesh;
        private readonly Vector3[] shadeVertices;
        private readonly Transform focusRoot;
        private readonly LineRenderer focusRing;
        private readonly LineRenderer predictedPath;
        private readonly Transform landingRoot;
        private readonly LineRenderer actualPath;
        private readonly ResponsePulse[] pulses;
        private readonly Material sharedLineMaterial;
        private readonly EventSignature[] handledEvents;

        private ProductionDeliveryEffectsProfile profile;
        private Vector3[] predictedPoints;
        private Vector3[] actualPoints;
        private double[] actualTimes;
        private int actualVisibleCount;
        private int handledEventCount;
        private int nextPulse;
        private int eventResponseCount;
        private float handednessMirror = 1f;
        private double consequenceStartTime = double.PositiveInfinity;
        private double playbackTime;
        private ProductionDeliveryEffectsPolicy deliveryPolicy;
        private bool released;
        private bool contactReached;
        private bool isReplay;
        private bool ballPoseSet;
        private bool readabilityProjectionValid;
        private bool landingPrepared;
        private bool deliveryActive;
        private bool disposed;

        private ProductionDeliveryEffects(
            GameObject root,
            Transform readabilityRoot,
            LineRenderer readabilityOuterRing,
            LineRenderer readabilityInnerRing,
            Transform shadeRoot,
            Mesh shadeMesh,
            Transform focusRoot,
            LineRenderer focusRing,
            LineRenderer predictedPath,
            Transform landingRoot,
            LineRenderer actualPath,
            ResponsePulse[] pulses,
            Material sharedLineMaterial,
            ProductionDeliveryEffectsProfile profile)
        {
            this.root = root;
            this.readabilityRoot = readabilityRoot;
            this.readabilityOuterRing = readabilityOuterRing;
            this.readabilityInnerRing = readabilityInnerRing;
            this.shadeRoot = shadeRoot;
            this.shadeMesh = shadeMesh;
            shadeVertices = new Vector3[ShadeRingPixels.Length * ShadeSegments];
            this.focusRoot = focusRoot;
            this.focusRing = focusRing;
            this.predictedPath = predictedPath;
            this.landingRoot = landingRoot;
            this.actualPath = actualPath;
            this.pulses = pulses;
            this.sharedLineMaterial = sharedLineMaterial;
            this.profile = profile;
            handledEvents = new EventSignature[BridgeConstants.MaxTraceEvents];
        }

        public GameObject Root => root;
        public bool IsDisposed => disposed;
        public bool IsDeliveryActive => deliveryActive;
        public bool HasReleased => released;
        public bool GuidanceVisible => predictedPath.gameObject.activeSelf;
        public bool LandingVisible => landingRoot.gameObject.activeSelf;
        public bool ReadabilityVisible => readabilityRoot.gameObject.activeSelf;
        public bool FocusVisible => focusRoot.gameObject.activeSelf;
        public bool ActualTrailVisible => actualPath.gameObject.activeSelf;
        public bool ResponseMotionEnabled => !profile.ReducedMotion;
        public int PredictedPointCap => profile.PredictedPointCap;
        public int ActualPointCap => profile.ActualPointCap;
        public int ResponseCapacity => profile.ResponseCapacity;
        public int PredictedPreparedPointCount => predictedPoints == null ? 0 : predictedPoints.Length;
        public int ActualPreparedPointCount => actualPoints == null ? 0 : actualPoints.Length;
        public int ActualVisiblePointCount => actualVisibleCount;
        public int EventResponseCount => eventResponseCount;
        /// <summary>
        /// Deterministic projection model for QA. This is not a framebuffer or
        /// composited-contrast measurement.
        /// </summary>
        public float ReadabilityProjectedDiameterPixels { get; private set; }
        public float ReadabilityWorldRadius { get; private set; }
        /// <summary>The shade's outer edge across, in viewport pixels (projection model, not a framebuffer read).</summary>
        public float ShadeProjectedDiameterPixels { get; private set; }
        public Transform ShadeTransform => shadeRoot;
        public Mesh ShadeMesh => shadeMesh;
        public ProductionDeliveryResponseKind LastResponseKind { get; private set; }
        public Vector3 LastResponsePosition { get; private set; }

        public int ActiveResponseCount
        {
            get
            {
                var count = 0;
                for (var index = 0; index < pulses.Length; index++)
                    if (pulses[index].Active) count++;
                return count;
            }
        }

        public static ProductionDeliveryEffects Create(
            Transform parent,
            PracticePresentationQuality quality,
            bool reducedMotion)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));

            var root = new GameObject("ProductionDeliveryEffects");
            root.transform.SetParent(parent, false);
            var material = CreateLineMaterial();
            var profile = ProductionDeliveryEffectsProfile.For(quality, reducedMotion);

            var readabilityObject = new GameObject("AuthoritativeBallReadabilitySilhouette");
            readabilityObject.transform.SetParent(root.transform, false);
            var readabilityOuterObject = new GameObject("DarkOuterEdge");
            readabilityOuterObject.transform.SetParent(readabilityObject.transform, false);
            var readabilityOuter = CreateLine(
                readabilityOuterObject, material, CricketPropDimensions.BallRadius, false);
            BuildRing(
                readabilityOuter, MaximumRingSegments, CricketPropDimensions.BallRadius,
                RingPlane.CameraFacing);
            readabilityOuter.startColor = readabilityOuter.endColor =
                new Color(0.018f, 0.024f, 0.035f, 0.82f);
            readabilityOuter.sortingOrder = 20;

            var readabilityInnerObject = new GameObject("IvoryInnerEdge");
            readabilityInnerObject.transform.SetParent(readabilityObject.transform, false);
            var readabilityInner = CreateLine(
                readabilityInnerObject, material, CricketPropDimensions.BallRadius, false);
            BuildRing(
                readabilityInner, MaximumRingSegments, CricketPropDimensions.BallRadius,
                RingPlane.CameraFacing);
            readabilityInner.startColor = readabilityInner.endColor =
                new Color(0.96f, 0.94f, 0.84f, 0.66f);
            readabilityInner.sortingOrder = 21;

            var shadeObject = new GameObject("DarkSurroundShade");
            shadeObject.transform.SetParent(readabilityObject.transform, false);
            var shade = BuildShadeMesh();
            shadeObject.AddComponent<MeshFilter>().sharedMesh = shade;
            var shadeRenderer = shadeObject.AddComponent<MeshRenderer>();
            shadeRenderer.sharedMaterial = material;
            shadeRenderer.shadowCastingMode = ShadowCastingMode.Off;
            shadeRenderer.receiveShadows = false;
            shadeRenderer.lightProbeUsage = LightProbeUsage.Off;
            shadeRenderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            shadeRenderer.sortingOrder = 19;

            var focusObject = new GameObject("BallReadabilityFocus");
            focusObject.transform.SetParent(root.transform, false);
            var focus = CreateLine(focusObject, material, profile.FocusWidth, false);
            BuildRing(focus, profile.FocusSegments, profile.FocusRadius, RingPlane.CameraFacing);
            focus.startColor = focus.endColor = new Color(0.98f, 0.96f, 0.86f, 0.24f);

            var predictionObject = new GameObject("AllowedPostReleaseGuidance");
            predictionObject.transform.SetParent(root.transform, false);
            var prediction = CreateLine(predictionObject, material, PredictionWidth, true);
            prediction.startColor = new Color(0.90f, 0.76f, 0.37f, 0.24f);
            prediction.endColor = new Color(0.90f, 0.76f, 0.37f, 0.08f);

            var landingObject = new GameObject("AuthoritativeLandingArea");
            landingObject.transform.SetParent(root.transform, false);
            var landing = CreateLine(landingObject, material, 0.008f, false);
            BuildRing(landing, MaximumRingSegments, LandingRadius, RingPlane.Ground);
            landing.startColor = landing.endColor = new Color(0.90f, 0.76f, 0.37f, 0.28f);

            var actualObject = new GameObject("ResolvedActualPath");
            actualObject.transform.SetParent(root.transform, false);
            var actual = CreateLine(actualObject, material, ActualWidth, true);
            actual.startColor = new Color(0.96f, 0.94f, 0.84f, 0.08f);
            actual.endColor = new Color(0.96f, 0.94f, 0.84f, 0.40f);

            var responsesRoot = new GameObject("CausalResponses");
            responsesRoot.transform.SetParent(root.transform, false);
            var pulses = new ResponsePulse[MaximumResponseCapacity];
            for (var index = 0; index < pulses.Length; index++)
                pulses[index] = ResponsePulse.Create(responsesRoot.transform, index, material);

            var effects = new ProductionDeliveryEffects(
                root, readabilityObject.transform, readabilityOuter, readabilityInner,
                shadeObject.transform, shade, focusObject.transform, focus, prediction, landingObject.transform, actual,
                pulses, material, profile);
            effects.HideAll();
            return effects;
        }

        /// <summary>
        /// Changes density only between deliveries. Physics and readability do
        /// not change between quality levels.
        /// </summary>
        public void ApplyProfile(PracticePresentationQuality quality, bool reducedMotion)
        {
            RequireAlive();
            if (deliveryActive)
                throw new InvalidOperationException("Delivery-effects quality changes only between deliveries.");

            profile = ProductionDeliveryEffectsProfile.For(quality, reducedMotion);
            focusRing.startWidth = focusRing.endWidth = profile.FocusWidth;
            BuildRing(focusRing, profile.FocusSegments, profile.FocusRadius, RingPlane.CameraFacing);
            for (var index = profile.ResponseCapacity; index < pulses.Length; index++)
                pulses[index].Stop();
            nextPulse = 0;
        }

        /// <summary>
        /// Compatibility overload for the original combined guidance switch.
        /// Focus remains off because the current host contract carries no
        /// truthful focus-aid setting. New callers should use the policy overload.
        /// </summary>
        public void BeginDelivery(
            BallTraceSample[] authoritativeFlight,
            bool revealGuidanceAfterRelease,
            float lateralMirror = 1f)
        {
            BeginDelivery(
                authoritativeFlight,
                new ProductionDeliveryEffectsPolicy(
                    revealGuidanceAfterRelease,
                    revealGuidanceAfterRelease,
                    false),
                lateralMirror);
        }

        /// <summary>
        /// Prepares a delivery from host-authoritative flight samples. Prediction,
        /// landing and focus permissions are independent; none can become visible
        /// until MarkReleased. Samples are downsampled only for drawing and never
        /// alter the authoritative trace.
        /// </summary>
        public void BeginDelivery(
            BallTraceSample[] authoritativeFlight,
            ProductionDeliveryEffectsPolicy policy,
            float lateralMirror = 1f)
        {
            RequireAlive();
            if (deliveryActive)
                throw new InvalidOperationException("Reset or complete the active delivery first.");
            ValidateSamples(authoritativeFlight, nameof(authoritativeFlight));
            if (!IsFinite(lateralMirror) || Mathf.Abs(lateralMirror) < 0.5f)
                throw new ArgumentOutOfRangeException(nameof(lateralMirror));

            ResetDeliveryState();
            handednessMirror = lateralMirror < 0f ? -1f : 1f;
            deliveryPolicy = policy;
            if (policy.RevealPredictionAfterRelease)
            {
                predictedPoints = SamplePoints(
                    authoritativeFlight, profile.PredictedPointCap, handednessMirror);
                predictedPath.positionCount = predictedPoints.Length;
                for (var index = 0; index < predictedPoints.Length; index++)
                    predictedPath.SetPosition(index, predictedPoints[index]);
            }

            Vector3 landing;
            if (policy.RevealLandingAfterRelease &&
                TryFindLanding(authoritativeFlight, handednessMirror, out landing))
            {
                landingRoot.position = landing;
                landingPrepared = true;
                landingRoot.gameObject.SetActive(false);
            }

            deliveryActive = true;
        }

        /// <summary>
        /// Supplies the resolved authoritative path. It remains hidden until
        /// contact is emitted, or until already-travelled samples are played in
        /// an explicit replay. Future resolved samples are never drawn.
        /// </summary>
        public void SetResolvedPath(BallTraceSample[] authoritativePath, bool replay)
        {
            RequireAlive();
            if (!deliveryActive)
                throw new InvalidOperationException("BeginDelivery must precede a resolved path.");
            ValidateSamples(authoritativePath, nameof(authoritativePath));

            actualPoints = SamplePoints(authoritativePath, profile.ActualPointCap, handednessMirror);
            actualTimes = SampleTimes(authoritativePath, profile.ActualPointCap);
            actualVisibleCount = 0;
            actualPath.positionCount = 0;
            actualPath.gameObject.SetActive(false);
            isReplay = replay;
            if (replay)
            {
                consequenceStartTime = 0.0;
                HideGuidance();
                focusRoot.gameObject.SetActive(false);
                readabilityRoot.gameObject.SetActive(false);
                ballPoseSet = false;
                readabilityProjectionValid = false;
            }
        }

        /// <summary>
        /// The explicit release latch. Guidance eligibility alone cannot make
        /// a guide visible before this call.
        /// </summary>
        public void MarkReleased()
        {
            RequireAlive();
            if (!deliveryActive || released) return;
            released = true;
            readabilityRoot.gameObject.SetActive(
                ballPoseSet && readabilityProjectionValid);
            if (!isReplay)
            {
                predictedPath.gameObject.SetActive(
                    deliveryPolicy.RevealPredictionAfterRelease &&
                    predictedPoints != null && predictedPoints.Length > 1);
                landingRoot.gameObject.SetActive(
                    deliveryPolicy.RevealLandingAfterRelease && HasLandingPosition());
                focusRoot.gameObject.SetActive(
                    deliveryPolicy.FocusAidEnabled && ballPoseSet);
            }
        }

        /// <summary>
        /// Follows only the currently presented authoritative ball. The intrinsic
        /// two-tone silhouette is independent of optional coaching aids and is
        /// release-gated. Explicit camera projection values keep this method
        /// deterministic, allocation-free and free from scene searches.
        /// </summary>
        public void SetBallPose(
            Vector3 worldPosition,
            Vector3 cameraPosition,
            Quaternion cameraRotation,
            float verticalFovDegrees,
            int viewportPixelHeight)
        {
            RequireAlive();
            if (!IsFinite(worldPosition))
                throw new ArgumentOutOfRangeException(nameof(worldPosition));
            if (!IsFinite(cameraPosition))
                throw new ArgumentOutOfRangeException(nameof(cameraPosition));
            if (!IsFinite(cameraRotation))
                throw new ArgumentOutOfRangeException(nameof(cameraRotation));

            ballPoseSet = true;
            focusRoot.position = worldPosition;
            focusRoot.rotation = cameraRotation;
            focusRoot.gameObject.SetActive(
                deliveryActive && released && !isReplay && deliveryPolicy.FocusAidEnabled);

            readabilityRoot.position = worldPosition;
            readabilityRoot.rotation = cameraRotation;
            var depth = Vector3.Dot(
                worldPosition - cameraPosition,
                cameraRotation * Vector3.forward);
            readabilityProjectionValid =
                depth > 0f && viewportPixelHeight > 0 &&
                IsFinite(verticalFovDegrees) &&
                verticalFovDegrees > 0f && verticalFovDegrees < 179f;
            if (!readabilityProjectionValid)
            {
                ReadabilityProjectedDiameterPixels = 0f;
                ReadabilityWorldRadius = 0f;
                readabilityRoot.gameObject.SetActive(false);
                return;
            }

            var worldUnitsPerPixel = 2f * depth * Mathf.Tan(
                verticalFovDegrees * Mathf.Deg2Rad * 0.5f) / viewportPixelHeight;
            var outerWidth = ReadabilityOuterWidthPixels * worldUnitsPerPixel;
            var innerWidth = ReadabilityInnerWidthPixels * worldUnitsPerPixel;
            var minimumCentreRadius = Mathf.Max(
                0f,
                MinimumReadabilityDiameterPixels * 0.5f * worldUnitsPerPixel);
            var radius = Mathf.Max(CricketPropDimensions.BallRadius, minimumCentreRadius);

            readabilityOuterRing.startWidth = readabilityOuterRing.endWidth = outerWidth;
            readabilityInnerRing.startWidth = readabilityInnerRing.endWidth = innerWidth;
            UpdateCameraFacingRing(readabilityOuterRing, radius);
            UpdateCameraFacingRing(readabilityInnerRing, radius);
            ReadabilityWorldRadius = radius;
            ReadabilityProjectedDiameterPixels =
                (2f * radius + outerWidth) / worldUnitsPerPixel;
            UpdateShade(
                radius,
                worldUnitsPerPixel * ShadeCssPixelScale(viewportPixelHeight),
                Quaternion.Inverse(cameraRotation) * (cameraPosition - worldPosition));
            ShadeProjectedDiameterPixels = 2f *
                (radius + ShadePixels * worldUnitsPerPixel * ShadeCssPixelScale(viewportPixelHeight)) /
                worldUnitsPerPixel;
            readabilityRoot.gameObject.SetActive(deliveryActive && released);
        }

        /// <summary>
        /// The world draws no ball while the physics has not yet produced one (a pending result, past the bat): the ball's
        /// readability rings, their shade and the focus aid go with it. Guidance, the landing mark and the resolved trail are
        /// not the ball and are left alone. The next SetBallPose, made when the ball is drawn again, shows them again.
        /// </summary>
        public void HideBallEmphasis()
        {
            RequireAlive();
            readabilityRoot.gameObject.SetActive(false);
            focusRoot.gameObject.SetActive(false);
        }

        /// <summary>
        /// Advances only the already-travelled portion of the resolved path.
        /// Safe for replay seeks in either direction.
        /// </summary>
        public void SetPlaybackTime(double simulationTime)
        {
            RequireAlive();
            if (!IsFinite(simulationTime) || simulationTime < 0.0)
                throw new ArgumentOutOfRangeException(nameof(simulationTime));
            playbackTime = simulationTime;
            UpdateActualTrail();
        }

        /// <summary>
        /// Consumes one authoritative event. Returns true only when a visible
        /// causal response was accepted. Duplicate events cannot double-fire.
        /// </summary>
        public bool HandleEvent(CanonicalTraceEvent traceEvent)
        {
            RequireAlive();
            if (traceEvent == null) throw new ArgumentNullException(nameof(traceEvent));
            if (!IsFinite(traceEvent.t) || traceEvent.t < 0.0 ||
                (traceEvent.p != null && !IsFinite(traceEvent.p)))
                throw new ArgumentException("The authoritative trace event is invalid.", nameof(traceEvent));
            if (!deliveryActive) return false;

            if (traceEvent.kind == "release")
            {
                MarkReleased();
                return false;
            }
            if (traceEvent.kind == "dead")
            {
                MarkDead();
                return false;
            }

            if (traceEvent.kind == "contact") HideGuidance();
            if (traceEvent.kind == "bounce" || traceEvent.kind == "ball_bounce")
                landingRoot.gameObject.SetActive(false);
            var response = MapResponse(traceEvent);
            if (response == ProductionDeliveryResponseKind.None || traceEvent.p == null) return false;
            if (WasHandled(traceEvent)) return false;
            Remember(traceEvent);

            var position = ToUnity(traceEvent.p, handednessMirror);
            if (response == ProductionDeliveryResponseKind.Bat ||
                response == ProductionDeliveryResponseKind.Pad)
            {
                contactReached = true;
                consequenceStartTime = Math.Min(consequenceStartTime, traceEvent.t);
                HideGuidance();
                UpdateActualTrail();
            }

            ActivateResponse(response, position);
            LastResponseKind = response;
            LastResponsePosition = position;
            eventResponseCount++;
            return true;
        }

        public void Tick(float deltaSeconds)
        {
            RequireAlive();
            if (!IsFinite(deltaSeconds) || deltaSeconds < 0f)
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
            for (var index = 0; index < pulses.Length; index++)
                pulses[index].Tick(deltaSeconds, profile.ReducedMotion);
        }

        /// <summary>
        /// Ends live ball emphasis but preserves the already-resolved path and
        /// short response marks for the dead-ball explanation.
        /// </summary>
        public void MarkDead()
        {
            RequireAlive();
            deliveryActive = false;
            readabilityRoot.gameObject.SetActive(false);
            focusRoot.gameObject.SetActive(false);
            HideGuidance();
        }

        /// <summary>
        /// Deterministic between-ball cleanup. No old guide, trail or event can
        /// leak into the next delivery.
        /// </summary>
        public void ResetDelivery()
        {
            RequireAlive();
            ResetDeliveryState();
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            for (var index = 0; index < pulses.Length; index++) pulses[index].Stop();
            DestroyObject(root);
            DestroyObject(shadeMesh);
            DestroyObject(sharedLineMaterial);
        }

        private void ResetDeliveryState()
        {
            if (handledEventCount > 0) Array.Clear(handledEvents, 0, handledEventCount);
            deliveryActive = false;
            released = false;
            contactReached = false;
            isReplay = false;
            ballPoseSet = false;
            readabilityProjectionValid = false;
            landingPrepared = false;
            deliveryPolicy = ProductionDeliveryEffectsPolicy.None;
            consequenceStartTime = double.PositiveInfinity;
            playbackTime = 0.0;
            actualVisibleCount = 0;
            actualPath.positionCount = 0;
            handledEventCount = 0;
            eventResponseCount = 0;
            nextPulse = 0;
            LastResponseKind = ProductionDeliveryResponseKind.None;
            LastResponsePosition = Vector3.zero;
            ReadabilityProjectedDiameterPixels = 0f;
            ReadabilityWorldRadius = 0f;
            ShadeProjectedDiameterPixels = 0f;
            predictedPoints = null;
            actualPoints = null;
            actualTimes = null;
            predictedPath.positionCount = 0;
            HideAll();
            for (var index = 0; index < pulses.Length; index++) pulses[index].Stop();
        }

        private void HideAll()
        {
            readabilityRoot.gameObject.SetActive(false);
            focusRoot.gameObject.SetActive(false);
            predictedPath.gameObject.SetActive(false);
            landingRoot.gameObject.SetActive(false);
            actualPath.gameObject.SetActive(false);
        }

        private void HideGuidance()
        {
            predictedPath.gameObject.SetActive(false);
            landingRoot.gameObject.SetActive(false);
        }

        private bool HasLandingPosition()
        {
            return landingPrepared;
        }

        private void UpdateActualTrail()
        {
            if (actualPoints == null || actualTimes == null || actualPoints.Length < 2)
            {
                actualVisibleCount = 0;
                actualPath.positionCount = 0;
                actualPath.gameObject.SetActive(false);
                return;
            }

            var revealAllowed = isReplay || contactReached;
            if (!revealAllowed)
            {
                actualVisibleCount = 0;
                actualPath.positionCount = 0;
                actualPath.gameObject.SetActive(false);
                return;
            }

            var first = LowerBound(actualTimes, consequenceStartTime);
            // Decimal host sample intervals (for example 0.1 s) are not
            // exactly representable as doubles. Include a trace sample whose
            // mathematical time equals the playback clock rather than hiding
            // it for one frame because 0.7 became 0.7000000000000001.
            var upper = UpperBound(actualTimes, playbackTime + 1e-9);
            var count = Math.Max(0, upper - first);
            if (count < 2)
            {
                actualVisibleCount = 0;
                actualPath.positionCount = 0;
                actualPath.gameObject.SetActive(false);
                return;
            }

            actualVisibleCount = count;
            actualPath.positionCount = count;
            for (var index = 0; index < count; index++)
                actualPath.SetPosition(index, actualPoints[first + index]);
            actualPath.gameObject.SetActive(true);
        }

        private void ActivateResponse(ProductionDeliveryResponseKind kind, Vector3 position)
        {
            var capacity = profile.ResponseCapacity;
            var selected = -1;
            for (var offset = 0; offset < capacity; offset++)
            {
                var candidate = (nextPulse + offset) % capacity;
                if (!pulses[candidate].Active)
                {
                    selected = candidate;
                    break;
                }
            }
            if (selected < 0) selected = nextPulse % capacity;
            nextPulse = (selected + 1) % capacity;

            Color colour;
            float duration;
            float radius;
            ResponseStyle(kind, out colour, out duration, out radius);
            pulses[selected].Activate(position, colour, duration, radius, profile.ReducedMotion);
        }

        private static void ResponseStyle(
            ProductionDeliveryResponseKind kind,
            out Color colour,
            out float duration,
            out float radius)
        {
            switch (kind)
            {
                case ProductionDeliveryResponseKind.Pitch:
                    colour = new Color(0.73f, 0.63f, 0.47f, 0.26f);
                    duration = 0.18f;
                    radius = 0.10f;
                    return;
                case ProductionDeliveryResponseKind.Bat:
                    colour = new Color(0.98f, 0.95f, 0.83f, 0.38f);
                    duration = 0.12f;
                    radius = 0.085f;
                    return;
                case ProductionDeliveryResponseKind.Pad:
                    colour = new Color(0.86f, 0.72f, 0.48f, 0.28f);
                    duration = 0.14f;
                    radius = 0.08f;
                    return;
                case ProductionDeliveryResponseKind.Wicket:
                    colour = new Color(0.78f, 0.22f, 0.16f, 0.42f);
                    duration = 0.28f;
                    radius = 0.14f;
                    return;
                case ProductionDeliveryResponseKind.Boundary:
                    colour = new Color(0.40f, 0.72f, 0.46f, 0.30f);
                    duration = 0.30f;
                    radius = 0.16f;
                    return;
                default:
                    colour = new Color(0.72f, 0.79f, 0.66f, 0.24f);
                    duration = 0.18f;
                    radius = 0.11f;
                    return;
            }
        }

        private static ProductionDeliveryResponseKind MapResponse(CanonicalTraceEvent traceEvent)
        {
            switch (traceEvent.kind)
            {
                case "bounce":
                case "ball_bounce":
                    return ProductionDeliveryResponseKind.Pitch;
                case "contact":
                    return traceEvent.contact == "miss" || traceEvent.contact == "leave"
                        ? ProductionDeliveryResponseKind.None
                        : traceEvent.contact == "pad" || traceEvent.contact == "body"
                            ? ProductionDeliveryResponseKind.Pad
                            : ProductionDeliveryResponseKind.Bat;
                case "pad":
                    return ProductionDeliveryResponseKind.Pad;
                case "stumps":
                    return ProductionDeliveryResponseKind.Wicket;
                case "keeper_take":
                case "catch":
                case "field":
                case "throw":
                    return ProductionDeliveryResponseKind.Field;
                case "boundary":
                    return ProductionDeliveryResponseKind.Boundary;
                default:
                    return ProductionDeliveryResponseKind.None;
            }
        }

        private bool WasHandled(CanonicalTraceEvent traceEvent)
        {
            for (var index = 0; index < handledEventCount; index++)
                if (handledEvents[index].Matches(traceEvent)) return true;
            return false;
        }

        private void Remember(CanonicalTraceEvent traceEvent)
        {
            if (handledEventCount >= handledEvents.Length) return;
            handledEvents[handledEventCount++] = new EventSignature(
                traceEvent.t, traceEvent.kind, traceEvent.fielderId, traceEvent.contact);
        }

        private static Vector3[] SamplePoints(BallTraceSample[] source, int cap, float mirror)
        {
            var count = Math.Min(source.Length, cap);
            var values = new Vector3[count];
            for (var index = 0; index < count; index++)
                values[index] = ToUnity(source[SourceIndex(index, count, source.Length)].p, mirror);
            return values;
        }

        private static double[] SampleTimes(BallTraceSample[] source, int cap)
        {
            var count = Math.Min(source.Length, cap);
            var values = new double[count];
            for (var index = 0; index < count; index++)
                values[index] = source[SourceIndex(index, count, source.Length)].t;
            return values;
        }

        private static int SourceIndex(int index, int sampledCount, int sourceCount)
        {
            if (sampledCount <= 1 || sourceCount <= 1) return 0;
            return (int)Math.Round(
                index * (sourceCount - 1.0) / (sampledCount - 1.0),
                MidpointRounding.AwayFromZero);
        }

        private static bool TryFindLanding(
            BallTraceSample[] samples,
            float mirror,
            out Vector3 landing)
        {
            for (var index = 1; index < samples.Length; index++)
            {
                if (samples[index - 1].v.y < 0.0 && samples[index].v.y >= 0.0)
                {
                    var point = ToUnity(samples[index].p, mirror);
                    landing = new Vector3(point.x, LandingHeight, point.z);
                    return true;
                }
            }

            landing = Vector3.zero;
            return false;
        }

        private static int LowerBound(double[] values, double time)
        {
            var low = 0;
            var high = values.Length;
            while (low < high)
            {
                var middle = low + (high - low) / 2;
                if (values[middle] < time) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        private static int UpperBound(double[] values, double time)
        {
            var low = 0;
            var high = values.Length;
            while (low < high)
            {
                var middle = low + (high - low) / 2;
                if (values[middle] <= time) low = middle + 1;
                else high = middle;
            }
            return low;
        }

        private static void ValidateSamples(BallTraceSample[] samples, string parameter)
        {
            if (samples == null || samples.Length == 0 ||
                samples.Length > BridgeConstants.MaxTraceSamplesPerChannel)
                throw new ArgumentException("An authoritative, bounded ball trace is required.", parameter);

            var previousTime = -1.0;
            for (var index = 0; index < samples.Length; index++)
            {
                var sample = samples[index];
                if (sample == null || sample.p == null || sample.v == null ||
                    !IsFinite(sample.t) || sample.t < previousTime ||
                    !IsFinite(sample.p) || !IsFinite(sample.v))
                    throw new ArgumentException("The authoritative ball trace is incomplete or unordered.", parameter);
                previousTime = sample.t;
            }
        }

        private static LineRenderer CreateLine(
            GameObject owner,
            Material material,
            float width,
            bool worldSpace)
        {
            var line = owner.AddComponent<LineRenderer>();
            line.sharedMaterial = material;
            line.useWorldSpace = worldSpace;
            line.alignment = LineAlignment.View;
            line.textureMode = LineTextureMode.Stretch;
            line.generateLightingData = false;
            line.numCapVertices = 0;
            line.numCornerVertices = 0;
            line.startWidth = width;
            line.endWidth = width;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.lightProbeUsage = LightProbeUsage.Off;
            line.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return line;
        }

        private enum RingPlane { CameraFacing, Ground }

        private static void BuildRing(LineRenderer line, int segments, float radius, RingPlane plane)
        {
            line.loop = true;
            line.positionCount = segments;
            for (var index = 0; index < segments; index++)
            {
                var radians = Mathf.PI * 2f * index / segments;
                var a = Mathf.Cos(radians) * radius;
                var b = Mathf.Sin(radians) * radius;
                line.SetPosition(index, plane == RingPlane.Ground
                    ? new Vector3(a, 0f, b)
                    : new Vector3(a, b, 0f));
            }
        }

        /// <summary>Viewport pixels per CSS px of the 412 px tall reference phone (never below one).</summary>
        public static float ShadeCssPixelScale(int viewportPixelHeight)
        {
            return Mathf.Max(1f, viewportPixelHeight / ShadeReferenceViewportCssHeight);
        }

        /// <summary>The web's shade opacity at <paramref name="pixels"/> CSS px outside the ball's edge.</summary>
        public static float ShadeOpacityAt(float pixels)
        {
            if (pixels < 0f) return 0f;
            if (pixels <= ShadeRimPixels) return ShadeRimOpacity;
            var t = Mathf.Clamp01((pixels - ShadeRimPixels) / (ShadePixels - ShadeRimPixels));
            return ShadeOpacity * (1f - t * t * (3f - 2f * t));
        }

        private static Mesh BuildShadeMesh()
        {
            var rings = ShadeRingPixels.Length;
            var colours = new Color[rings * ShadeSegments];
            var vertices = new Vector3[colours.Length];
            for (var ring = 0; ring < rings; ring++)
            {
                // The second ring at the rim's edge starts the fall; every other ring takes the curve's value.
                var alpha = ring == 2 ? ShadeOpacity : ring < 2 ? ShadeRimOpacity : ShadeOpacityAt(ShadeRingPixels[ring]);
                for (var segment = 0; segment < ShadeSegments; segment++)
                {
                    var radians = Mathf.PI * 2f * segment / ShadeSegments;
                    vertices[ring * ShadeSegments + segment] = new Vector3(
                        Mathf.Cos(radians) * (1f + ring), Mathf.Sin(radians) * (1f + ring), 0f);
                    colours[ring * ShadeSegments + segment] = new Color(
                        ShadeColour.r, ShadeColour.g, ShadeColour.b, alpha);
                }
            }
            var triangles = new int[(rings - 1) * ShadeSegments * 6];
            var cursor = 0;
            for (var ring = 0; ring < rings - 1; ring++)
            {
                for (var segment = 0; segment < ShadeSegments; segment++)
                {
                    var next = (segment + 1) % ShadeSegments;
                    var a = ring * ShadeSegments + segment;
                    var b = ring * ShadeSegments + next;
                    var c = (ring + 1) * ShadeSegments + segment;
                    var d = (ring + 1) * ShadeSegments + next;
                    triangles[cursor++] = a;
                    triangles[cursor++] = c;
                    triangles[cursor++] = b;
                    triangles[cursor++] = b;
                    triangles[cursor++] = c;
                    triangles[cursor++] = d;
                }
            }
            var mesh = new Mesh
            {
                name = "VANDE Ball Shade",
                hideFlags = HideFlags.DontSave
            };
            mesh.MarkDynamic();
            mesh.vertices = vertices;
            mesh.colors = colours;
            mesh.triangles = triangles;
            // Generous fixed bounds: the vertices move every frame and culling must never drop the shade.
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 8f);
            return mesh;
        }

        /// <summary>
        /// Rings at the ball's edge plus the web's CSS px offsets, on the ball's sight line ShadeCameraPull of the way
        /// to the camera and scaled by the remaining share, so the shade keeps its apparent size and position.
        /// Allocation-free: one preallocated vertex array.
        /// </summary>
        private void UpdateShade(float ballRadius, float worldUnitsPerCssPixel, Vector3 localToCamera)
        {
            var keep = 1f - ShadeCameraPull;
            shadeRoot.localPosition = localToCamera * ShadeCameraPull;
            for (var ring = 0; ring < ShadeRingPixels.Length; ring++)
            {
                var radius = (ballRadius + ShadeRingPixels[ring] * worldUnitsPerCssPixel) * keep;
                for (var segment = 0; segment < ShadeSegments; segment++)
                {
                    var radians = Mathf.PI * 2f * segment / ShadeSegments;
                    shadeVertices[ring * ShadeSegments + segment] = new Vector3(
                        Mathf.Cos(radians) * radius, Mathf.Sin(radians) * radius, 0f);
                }
            }
            shadeMesh.vertices = shadeVertices;
        }

        private static void UpdateCameraFacingRing(LineRenderer line, float radius)
        {
            for (var index = 0; index < line.positionCount; index++)
            {
                var radians = Mathf.PI * 2f * index / line.positionCount;
                line.SetPosition(index, new Vector3(
                    Mathf.Cos(radians) * radius,
                    Mathf.Sin(radians) * radius,
                    0f));
            }
        }

        private static Material CreateLineMaterial()
        {
            var shader = Resources.Load<Shader>("VandeProductionDeliveryEffects") ??
                         Shader.Find("Vande/Practice/DeliveryEffects") ??
                         Shader.Find("Sprites/Default") ??
                         Shader.Find("Unlit/Transparent") ??
                         Shader.Find("Unlit/Color") ??
                         Shader.Find("Standard");
            if (shader == null)
                throw new InvalidOperationException("A built-in presentation shader is required.");
            return new Material(shader)
            {
                name = "VANDE Delivery Effects Lines",
                hideFlags = HideFlags.DontSave
            };
        }

        private static Vector3 ToUnity(TraceVector3 value, float mirror)
        {
            return new Vector3(mirror * (float)value.x, (float)value.y, (float)value.z);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static bool IsFinite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool IsFinite(Quaternion value)
        {
            return IsFinite(value.x) && IsFinite(value.y) &&
                   IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(TraceVector3 value)
        {
            return value != null && IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private void RequireAlive()
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionDeliveryEffects));
        }

        private static void DestroyObject(UnityEngine.Object value)
        {
            if (value == null) return;
#if UNITY_EDITOR
            if (!Application.isPlaying) UnityEngine.Object.DestroyImmediate(value);
            else UnityEngine.Object.Destroy(value);
#else
            UnityEngine.Object.Destroy(value);
#endif
        }

        private readonly struct EventSignature
        {
            private readonly double time;
            private readonly string kind;
            private readonly string fielderId;
            private readonly string contact;

            public EventSignature(double time, string kind, string fielderId, string contact)
            {
                this.time = time;
                this.kind = kind;
                this.fielderId = fielderId;
                this.contact = contact;
            }

            public bool Matches(CanonicalTraceEvent value)
            {
                return time.Equals(value.t) &&
                       string.Equals(kind, value.kind, StringComparison.Ordinal) &&
                       string.Equals(fielderId, value.fielderId, StringComparison.Ordinal) &&
                       string.Equals(contact, value.contact, StringComparison.Ordinal);
            }
        }

        private sealed class ResponsePulse
        {
            private readonly GameObject root;
            private readonly LineRenderer line;
            private Color colour;
            private float duration;
            private float elapsed;
            private float radius;

            private ResponsePulse(GameObject root, LineRenderer line)
            {
                this.root = root;
                this.line = line;
            }

            public bool Active => root.activeSelf;

            public static ResponsePulse Create(Transform parent, int index, Material material)
            {
                var root = new GameObject("CausalResponse-" + index);
                root.transform.SetParent(parent, false);
                var line = CreateLine(root, material, 0.009f, false);
                BuildRing(line, MaximumRingSegments, 1f, RingPlane.Ground);
                root.SetActive(false);
                return new ResponsePulse(root, line);
            }

            public void Activate(
                Vector3 position,
                Color value,
                float lifetime,
                float initialRadius,
                bool reducedMotion)
            {
                colour = value;
                duration = lifetime;
                elapsed = 0f;
                radius = initialRadius;
                root.transform.position = position;
                root.transform.localScale = Vector3.one * radius;
                line.startColor = line.endColor = colour;
                root.SetActive(true);
                if (reducedMotion) root.transform.localScale = Vector3.one * radius;
            }

            public void Tick(float deltaSeconds, bool reducedMotion)
            {
                if (!Active) return;
                elapsed += deltaSeconds;
                if (elapsed >= duration)
                {
                    Stop();
                    return;
                }

                if (reducedMotion) return;
                var amount = duration <= 0f ? 1f : Mathf.Clamp01(elapsed / duration);
                var eased = 1f - (1f - amount) * (1f - amount);
                root.transform.localScale = Vector3.one * radius * Mathf.Lerp(0.82f, 1.45f, eased);
                var faded = colour;
                faded.a = colour.a * (1f - amount);
                line.startColor = line.endColor = faded;
            }

            public void Stop()
            {
                elapsed = 0f;
                root.SetActive(false);
            }
        }
    }
}
