using System;
using System.Collections.Generic;
using Unity.Profiling;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Input;
using Vande.Practice.Performance;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Motion;
using Vande.Practice.Presentation.Production.Effects;
using Vande.Practice.Presentation.Production.Environment;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation
{
    /// <summary>
    /// Trace-driven Practice presentation. TypeScript remains authoritative for
    /// delivery physics and outcomes; this component owns the production Unity
    /// world and applies only validated canonical presentation traces.
    /// </summary>
    public sealed partial class ProceduralPracticeWorld : MonoBehaviour, ICanonicalTraceTarget
    {
        private enum WorldState { Idle, RunUp, Flight, Resolved, Recovery, Outcome, Paused }

        private const double OutcomeHoldSeconds = 0.45;
        // The final sampler interval is a real part of the stroke, not a disposal frame. Keep the balanced
        // recovery unobstructed for a short, deterministic beat before the dead-ball surface is allowed to reveal.
        // This is presentation-only: the authoritative trace, score and completion time remain unchanged.
        public const double DeadBallRecoverySeconds = 0.28;
        private const double MinimumCanonicalStrokeExcursionMetres = 0.02;
        internal const double CanonicalBodyBlendSeconds = 0.08;
        /// <summary>
        /// Presentation-only carry into the certified planted body (UNITY phase 2, TRACKB P1 §6). sim-v3 certifies one
        /// static batterRootOffset and one final planted body frame for the whole trace, but a live result arrives
        /// mid-flight (the ideal drive: about 60 ms before contact), and latching both at once moved the feet, hips
        /// and bat about 1 m in one frame. The displayed athlete (root, body-frame anchors and bat) is now carried
        /// from exactly what was on screen to the planted body, no faster on average than this brisk stride, and in
        /// every case by the authored contact anchor, so the bat is exactly the physics bat at contact (C2, D1).
        /// When the result arrives too late for a human-speed carry, the carry still ends at contact: that residual
        /// speed is reported, never hidden; only an earlier stride (anticipation) or a bounded physics body can remove it.
        /// </summary>
        internal const float BatterCarryAverageMetresPerSecond = 1.6f;
        internal const float BatterCarryMaximumMetres = 0.32f;
        /// <summary>UNITY-9: how fast the bat is carried to the physics bat when the result arrives after the contact (average m/s, average deg/s) and the longest that takes (s).</summary>
        internal const float LateSettleBatMetresPerSecond = 4f;
        internal const float LateSettleBatDegreesPerSecond = 480f;
        internal const double LateSettleMaximumSeconds = 0.7;
        /// <summary>
        /// Builder seams (UNITY-9 A/B in one build) for a live result that arrives late: the bat stays where it was on screen at the accept (not at the code-authored
        /// backlift), it is carried to the physics bat at a swing's pace once the contact is past, and the recovery from the follow-through begins at the accept (not
        /// part-way through). LateResultSettleEnabled sets all three; false is the earlier behaviour.
        /// </summary>
        internal bool LateResultSettleEnabled
        {
            get { return LateSettleBatRestore && LateSettleCarry && LateSettleRecovery; }
            set { LateSettleBatRestore = LateSettleCarry = LateSettleRecovery = value; }
        }

        /// <summary>Builder seam (UNITY-9 A/B in one build): false lets the bat jump to the waiting stance's when the ball is over (the arms flipped 100 to 130 degrees in that frame).</summary>
        internal bool IdleHandOverMovesBat { get; set; } = true;
        internal const float IdleHandOverSeconds = 0.4f;

        internal bool LateSettleBatRestore { get; set; } = true;
        internal bool LateSettleCarry { get; set; } = true;
        internal bool LateSettleRecovery { get; set; } = true;
        private bool batterCarryContactPast;
        internal const double BatterCarryContactMarginSeconds = 1.0 / 60.0;
        /// <summary>
        /// The striker's drawn root never moves faster than this on its way to the physics root (m/s): a result that arrives
        /// a frame or two before the contact would otherwise shift it 10+ cm in one frame (thin-edge, UNITY-4 H3). The bat is
        /// carried to the physics bat on its own clock and is exact at the contact whatever the body is doing.
        /// </summary>
        internal const float BatterRootMaximumMetresPerSecond = 2.5f;
        /// <summary>
        /// After the canonical bat ends, the batter holds the authored finish this long and then recovers to the
        /// balanced finish while the ball is still live, instead of holding the follow-through until the dead ball
        /// (TRACKB P1: a 5 s hold). Presentation-only: the trace, events and dead-ball timing are unchanged.
        /// </summary>
        internal const double FollowThroughHoldSeconds = 0.6;
        private const double TimelineBoundaryToleranceSeconds = 0.000001;
        // The keeper is always rendered (owner, 2026-11-03: reverses the 2026-10-28 rear-camera exclusion). A pace
        // keeper stands back behind the camera; a spin keeper stands up between the camera and the striker, so only
        // the keeper fragments over the striker and his stumps are screen-door faded (ProductionOcclusionFade).
        public const ProductionLight DefaultPracticeLight = ProductionLight.Day;
        /// <summary>
        /// The light the world builds with. Always DefaultPracticeLight in the game; evidence tools (readability under
        /// another light) set it by reflection around a world they own and restore it.
        /// </summary>
        private static ProductionLight practiceLight = DefaultPracticeLight;
        public const float TargetHorizontalFovDegrees = 58f;
        // Stable rear-three-quarter composition measured from the striker reference. A bounded 844x390 sweep of
        // 37 real release-to-contact envelopes for both hands keeps the complete striker, bat and bowler in frame
        // while retaining at least 5.46 px of signed clearance inside the frozen delivery corridor. The 4.75/0.975 m
        // offsets preserve that measured buffer at the locked 58-degree horizontal FOV without a target-point bias.
        // These are presentation-only metres; they never alter the canonical trace or contact model.
        public const float BatterCameraRearDistanceMetres = 4.75f;
        public const float BatterCameraLateralOffsetMetres = 0.975f;
        public const float BatterCameraHeightMetres = 1.68f;
        // A higher aim than the former -0.95 m target removes excess turf, keeps the complete foreground player in
        // frame and raises the bowler/release corridor into the readable gameplay band.
        public const float BatterCameraTargetHeightMetres = -0.45f;
        internal const float MinimumFielderHeightMetres = 1.70f;
        internal const float MaximumFielderHeightMetres = 1.90f;
        private static readonly ProfilerMarker TickMarker = new ProfilerMarker("VANDE.Practice.Presentation.Tick");
        private static readonly ProfilerMarker TraceMarker = new ProfilerMarker("VANDE.Practice.Presentation.Trace");

        private readonly List<GameObject> fielders = new List<GameObject>();
        private readonly List<ProductionCharacterRig> fieldingRigs = new List<ProductionCharacterRig>();
        private readonly Dictionary<GameObject, ProductionCharacterRig> rigByRoot =
            new Dictionary<GameObject, ProductionCharacterRig>();
        private readonly Dictionary<string, GameObject> fielderById =
            new Dictionary<string, GameObject>(StringComparer.Ordinal);
        private readonly Dictionary<string, int> fielderStableIndexById =
            new Dictionary<string, int>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> fielderRoleById =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, Vector3> fielderScenePositionById =
            new Dictionary<string, Vector3>(StringComparer.Ordinal);
        // Body choreography on the physics paths (presentation only), rebuilt from every accepted trace.
        private readonly Dictionary<string, ProductionFieldingTrack> fieldingTracks =
            new Dictionary<string, ProductionFieldingTrack>(StringComparer.Ordinal);
        private readonly List<string> syntheticFieldingIds = new List<string>();
        private readonly ProductionCharacterPose fieldingPose = new ProductionCharacterPose();
        private readonly HashSet<string> emittedEvents = new HashSet<string>(StringComparer.Ordinal);
        private Transform worldRoot;
        private ProductionCricketEnvironment productionEnvironment;
        private ProductionCharacterResources characterResources;
        private ProductionCharacterRig bowlerRig;
        private ProductionCharacterRig batterRig;
        private ProductionCharacterRig keeperRig;
        private ProductionOcclusionFade keeperOcclusion;
        private readonly List<ProductionOcclusionFade> lensFades = new List<ProductionOcclusionFade>();
        private ProductionFieldPip fieldPip;
        // HUM U10: the non-striker, and both batters' running between the wickets (presentation of physics runs).
        private ProductionCharacterRig nonStrikerRig;
        private ProductionGaitPresenter nonStrikerGait;
        private ProductionGaitPresenter strikerGait;
        private ProductionRunningBetweenWickets runningPlan = ProductionRunningBetweenWickets.Empty;
        // Lead ruling 2026-11-04 (held ball): between the physics take and the physics throw release the ball is drawn
        // in the holder's hand. It is exact at the take, joins the hand over HeldBallBlendInSeconds, and returns onto
        // the physics ball over the last HeldBallBlendOutSeconds before the release, so the flight before the take and
        // after the release is exactly the physics. The blends and the no-throw rule match the web (holdBallInHands).
        private const double HeldBallBlendInSeconds = 0.08;
        private const double HeldBallBlendOutSeconds = 0.09;
        private const float PalmAlongWristMetres = 0.065f;
        private readonly List<HeldBallWindow> heldBallWindows = new List<HeldBallWindow>();
        private readonly List<float> heldBallReleaseHandGaps = new List<float>();
        private float nonStrikerSide = -1f;
        // TRACKB's batter anticipation (MOTION batter pack), through the rig mirror: the live stance while he waits, the
        // trigger 0.55 s before the presented release, the backlift from the release (top 0.25 s later), then the
        // ready hold. Identical every ball; it never reads the delivery's line or the player's input. Once the player's
        // stroke (or the physics bat) takes over, the skeleton leaves the anticipation pose inertially (critically
        // damped, StrikerTransitionSeconds).
        private const float StrikerTransitionSeconds = 0.2f;
        private const float StrikerStanceBlendSeconds = 0.16f;
        private ProductionPackPose strikerPackPose;
        private ProductionPackPose strikerPackBlendPose;
        private VmpClip batStanceLive;
        private VmpClip batTrigger;
        private VmpClip batBacklift;
        private VmpClip batReadyHold;
        private bool strikerPackLoaded;
        private bool strikerPackActive;
        private bool strikerPackWasActive;
        private bool strikerTransitionActive;
        private float strikerTransitionElapsed;
        private float strikerTransitionDuration = StrikerTransitionSeconds;
        private bool strikerTransitionBodyOnly;
        private bool liveStrokeStartPending;
        private bool strikerTransitionMovesBat;
        private bool strikerSourceCaptured;
        private bool strikerRunningWas;
        // The planted-foot layer for every fielder, the keeper and the bowler after his release (lead approval
        // 2026-11-04, UNITY-2): ProductionFootLock, applied once a frame after every other pose.
        private readonly Dictionary<ProductionCharacterRig, ProductionFootLock> footLocks =
            new Dictionary<ProductionCharacterRig, ProductionFootLock>();
        private Vector3 strikerTransitionBatPosition;
        private Quaternion strikerTransitionBatRotation;
        private double strikerIdleClock;
        // Advanced by every tick: the clock the striker's arms remember their elbow planes on (ProductionHeroArm).
        private double presentationClock;
        // The root's share of the carry as drawn (at most BatterRootMaximumMetresPerSecond behind the bat's carry) and the clock
        // of the frame it was last moved on.
        private float batterRootAmount = 1f;
        // The result's certified crouch (m): drawn at the root's share of the carry.
        private float canonicalBatterCrouchMetres;
        private float batterRootAmountBefore = 1f;
        private double batterRootStamp = double.NaN;
        private double batterRootDelta;
        // The nominal (leave/none) stance midpoint in the physics frame: batterBody(null).stance, PITCH_HALF - 1.1.
        private const float StanceRootPhysicsX = -0.15f;
        private const float StanceRootPhysicsZ = 10.06f - 1.1f;
        // MOTION-BOWL's non-striker (the web's packNonStrikerMoves): ns_stance at his crease, ns_backup with its release
        // marker on the presented release and its crease line (clip z = +1.0 m) on the popping crease, so he is never
        // out of his ground before the release, ns_ready after it, and (no run) ns_walk_back ending grounded at the
        // crease after the dead ball. The bat is carried in one hand on the clip's bat track.
        private VmpClip nsStance;
        private VmpClip nsBackup;
        private VmpClip nsReady;
        private VmpClip nsWalkBack;
        private bool nonStrikerPackLoaded;
        private ProductionPackPose nonStrikerPackPose;
        private bool nonStrikerPackActive;
        private double nonStrikerClock;
        private double nonStrikerWalkBackElapsed = -1.0;
        private Vector3 nonStrikerWalkBackGap;
        private Vector3 nonStrikerReadyAt;
        private bool nonStrikerPackWasDelivering;
        private bool nonStrikerHandedOverFromPack;
        private float nonStrikerHandOverSpeed;
        private bool nonStrikerWalkOnStarted;
        private double nonStrikerWalkOnStartT;
        private float nonStrikerWalkOnSpeed;
        private Vector3 nonStrikerWalkOnFrom;
        private bool nonStrikerWalkOnPlaced;
        private float nonStrikerRunStartSpeed;
        /// <summary>
        /// Backing up after the release (nonStriker.ts NS_WALK_ON, lead ruling 04:3xZ): walking on from the clip's
        /// release speed up to 1.9 m/s over 0.35 s, a few jogging strides to 2.5 m/s over 0.2 s, back to 1.9 over 0.3 s,
        /// then easing to a stop 2.0 m past his popping crease.
        /// </summary>
        internal const float NsWalkTopMps = 1.9f;
        internal const float NsPeakMps = 2.5f;
        internal const float NsAccelSeconds = 0.35f;
        internal const float NsJogSeconds = 0.2f;
        internal const float NsHoldSeconds = 0.3f;
        internal const float NsStopOutMetres = 2.0f;
        private const float NonStrikerWalkOnMetresPerSecond = 0.47f;
        private bool strikerRunning;
        private Vector3 nonStrikerRunStart;
        private Vector3 strikerRunStart;
        private int nonStrikerRelocations;
        // Physics-frame metres (src/physics/geometry.ts): popping crease 1.22 m in front of the stumps at 10.06 m.
        private const float NonStrikerCreaseZ = -(10.06f - 1.22f);
        private const float NonStrikerWaitBehindCrease = 0.35f;
        private const float NonStrikerWaitLateral = 1.45f;
        private const float BackingUpMetres = 1.3f;
        // running.ts RUN_M = 16.5 m between the creases less ~1.2 m of bat stretched over the lines: turn 0.59 m short.
        private const float RunTurnZ = 10.06f - 1.22f - 0.59f;
        private const float RunLaneX = 1.6f;
        private const float WalkBackMetresPerSecond = 1.5f;
        private ProductionDeliveryEffects deliveryEffects;
        private ProductionCoachGuidePresentation coachGuidePresentation;
        private Camera batterCamera;
        private PracticeRenderedFrameObserver renderObserver;
        private GameObject bowler;
        private GameObject batterBody;
        private GameObject bat;
        private ProductionBallVisual ball;
        private PracticeFeedbackRouter feedback;
        private PracticePresentationSettings settings;
        private PracticePresentationProfile profile;
        private PracticePresentationProfile? pendingProfile;
        private Vector3 strikerPresentationReference = new Vector3(0f, 0f, 9.25f);
        private PracticeDeliveryPresentation delivery;
        private PracticeSwingPresentation provisionalSwing;
        private CanonicalTracePlayback playback;
        private CanonicalDeliveryTrace acceptedTrace;
        private int feedbackLookaheadCursor;
        private WorldState state;
        private WorldState stateBeforePause;
        private double timeline;
        private double playbackSpeed = 1.0;
        private string replayDigest;
        private bool releaseReported;
        private bool completionReported;
        private bool localPreparation;
        private bool localBatPreviewActive;
        private PracticeLocalBatPreview localBatPreview;
        private bool canonicalBat;
        private bool canonicalStrokeAvailable;
        private bool canonicalBatPoseAvailable;
        private bool canonicalNoShotPoseCaptured;
        private Vector3 canonicalNoShotGrip;
        private Vector3 canonicalNoShotToe;
        private Vector3 canonicalNoShotFace;
        private Vector3 nominalBatterWorldPosition = new Vector3(0f, 0f, 9.25f);
        private Vector3 canonicalBatterRootOffset;
        private bool playbackDeadMarked;
        private bool contactOccurred;
        private bool built;
        private bool quiet;
        private double recoveryElapsed;
        private Vector3 recoveryCanonicalBatPosition;
        private Quaternion recoveryCanonicalBatRotation = Quaternion.identity;
        private bool recoveryCanonicalBatCaptured;
        private bool recoveryBeginDeferred;
        private double outcomeElapsed;
        private bool benchmarkActive;
        private string currentPitchCondition = "balanced";
        private string currentBallColour = "white";
        private string currentBallAge = "new";
        private double benchmarkTimeline;
        private Vector3 benchmarkBowlerPosition;
        private Quaternion benchmarkBowlerRotation;
        private Vector3 benchmarkBallPosition;
        private Quaternion benchmarkBallRotation;
        private bool benchmarkBallVisible;
        private Vector3[] benchmarkFielderPositions;
        private Quaternion[] benchmarkFielderRotations;
        private bool[] benchmarkFielderActive;
        private float lastCameraAspect;
        private Vector3 stableBatterCameraPosition;
        private Quaternion stableBatterCameraRotation = Quaternion.identity;
        private string bowlerAppearanceKey;
        private ProductionBowlingPresentation bowlingPresentation =
            ProductionBowlingPresentation.ForSceneFamily("pace");
        private ProductionBowlingCueProfile bowlingCue =
            ProductionBowlingCueProfile.ForHostDelivery(
                ProductionCharacterRole.PaceBowler,
                "stock",
                130.0,
                130.0,
                0.0,
                0.0,
                10.0);
        private Vector3 bowlerStartPosition = new Vector3(0f, 0f, -28f);
        private Vector3 bowlerReleasePosition = new Vector3(0f, 0f, -9.614f);
        private Vector3? bowlerPhysicsSpot;
        private bool bowlerArmLeft;
        // MOTION-BOWL's composed run-up (ProductionBowlerRunUp, the web's bowlerRunup.ts port): placed rigidly so the
        // ball in hand is on the physics release point at the physics release; the body scale fits the release height
        // within [0.95, 1.12] of the VC17 reference body (MOTION rule). Null: the code-authored run-up.
        private string bowlerRunUpAction;
        private ProductionBowlerRunUp bowlerRunUp;
        private readonly ProductionCharacterPose bowlerPackPose = new ProductionCharacterPose();
        private float bowlerRunUpScale = 1f;
        private Vector3 bowlerRunUpAnchor;
        private float bowlerRunUpReleaseGroundX;
        private float bowlerRunUpReleaseGroundZ;
        private float bowlerRunUpHeightResidual;
        private Vector3 bowlerReleaseDelta;
        private Vector3 bowlerReleaseTarget;
        private const double BowlerReachInSeconds = 0.2;
        private const double BowlerReachOutSeconds = 0.16;
        private double bowlerFollowLastT = double.NaN;
        private bool bowlerFollowGaitHanded;
        private double bowlerSetEndT;
        private double bowlerConvergeFromT;
        private bool bowlerHandedOver;
        private ProductionBatterFootwork provisionalFootwork = ProductionBatterFootwork.Balanced;
        private ProductionBatterFootwork canonicalFootwork = ProductionBatterFootwork.Balanced;
        private ProductionBatterFootwork canonicalBlendFromFootwork = ProductionBatterFootwork.Balanced;
        private float provisionalStrokePhase;
        private float canonicalBlendFromPhase;
        private double canonicalBodyBlendElapsed;
        private double canonicalBatStartT;
        private double canonicalBatContactT;
        private double canonicalBatEndT;
        private int protectedRegionProjectionVersion;
        private double batterCarryStartT;
        private double batterCarryEndT;
        private float batterCarryAmount = 1f;
        private Vector3 batterCarryRootFrom;
        private Vector3 batterCarryAnchorLag;
        private bool batterCarryBatPending;
        private bool batterCarryAccepting;
        private Vector3 batterCarryShownGrip;
        private Quaternion batterCarryShownRotation = Quaternion.identity;
        private Vector3 batterCarryGripDelta;
        private Quaternion batterCarryRotationDelta = Quaternion.identity;
        private bool canonicalBodyAnchorsLatched;
        private Vector3 canonicalBodyStanceWorld;
        private Vector3 canonicalBodyTorsoTopWorld;
        private Vector3 canonicalBodyHeadCentreWorld;
        private double earlyRecoveryStartT = double.PositiveInfinity;
        private bool earlyRecoveryBegun;

        public event Action ReleaseReached;
        public event Action<bool> QuietChanged;
        public event Action<CanonicalTraceEvent> TraceEvent;
        public event Action<double, string> DeliveryCompleted;
        public event Action<double> FrameRendered;

        public bool DeliveryActive => IsDeliveryState(state) ||
                                      (state == WorldState.Paused && IsDeliveryState(stateBeforePause));
        public bool IsInitialized => built;
        public double Timeline => timeline;
        public bool ContactHasOccurred => contactOccurred;
        public ProductionBatterFootwork CanonicalFootwork => canonicalFootwork;
        public ProductionFieldState LiveFieldState => productionEnvironment?.FieldState;
        public bool LocalBatPreviewActive => localBatPreviewActive;
        public int ProtectedRegionProjectionVersion => protectedRegionProjectionVersion;
        internal Camera BatterCameraForEvidence => batterCamera;
        /// <summary>The field-overview PIP image (HUM item 6) for the HUD radar rect.</summary>
        public Texture FieldPipTexture => fieldPip?.Texture;
        internal ProductionFieldPip FieldPipForEvidence => fieldPip;

        /// <summary>Places every human and the ball in the PIP from the presented (physics-following) world.</summary>
        private void UpdateFieldPip()
        {
            if (fieldPip == null) return;
            var index = 0;
            if (batterRig != null) fieldPip.SetHuman(index++, batterRig.Root.position, ProductionFieldPip.StrikerColour, true);
            if (bowler != null) fieldPip.SetHuman(index++, bowler.transform.position, ProductionFieldPip.BowlerColour, false);
            foreach (var pair in fielderById)
            {
                string role;
                if (!pair.Value.activeSelf || !fielderRoleById.TryGetValue(pair.Key, out role) || role == "bowler") continue;
                fieldPip.SetHuman(index++, pair.Value.transform.position,
                    role == "keeper" ? ProductionFieldPip.KeeperColour : ProductionFieldPip.FielderColour, false);
            }
            fieldPip.HideHumansFrom(index);
            // Before the authoritative release the 3D ball may already be enabled for bowler-hand presentation,
            // but drawing it at the release spot obscures the active bowler marker in this field-setting inset.
            fieldPip.SetBall(releaseReported && ball != null && ball.GameObject.activeSelf
                ? ball.GameObject.transform.position
                : (Vector3?)null);
        }
        internal ProductionOcclusionFade KeeperOcclusionFade => keeperOcclusion;
        internal ProductionCharacterRig NonStrikerRigForTesting => nonStrikerRig;
        internal int NonStrikerRelocationsForEvidence => nonStrikerRelocations;
        internal int BowlerRelocationsForEvidence => bowlerRelocations;
        internal bool StrikerRunningForTesting => strikerRunning;
        internal ProductionRunningBetweenWickets RunningPlanForTesting => runningPlan;

        private Bounds? StrikerWicketBounds()
        {
            var wicket = productionEnvironment?.StrikerWicket;
            if (wicket?.Stumps == null) return null;
            Bounds? union = null;
            foreach (var stump in wicket.Stumps)
            {
                var renderer = stump != null ? stump.GetComponent<Renderer>() : null;
                if (renderer == null) continue;
                if (union.HasValue)
                {
                    var merged = union.Value;
                    merged.Encapsulate(renderer.bounds);
                    union = merged;
                }
                else union = renderer.bounds;
            }
            return union;
        }
        internal double TimelineForEvidence => timeline;
        internal string StateForEvidence => state.ToString();

        /// <summary>Every presented human with a stable label (builder evidence only).</summary>
        internal List<KeyValuePair<string, ProductionCharacterRig>> PresentedHumansForEvidence()
        {
            var humans = new List<KeyValuePair<string, ProductionCharacterRig>>();
            if (batterRig != null) humans.Add(new KeyValuePair<string, ProductionCharacterRig>("striker", batterRig));
            if (bowlerRig != null) humans.Add(new KeyValuePair<string, ProductionCharacterRig>("bowler", bowlerRig));
            if (keeperRig != null) humans.Add(new KeyValuePair<string, ProductionCharacterRig>("keeper", keeperRig));
            if (nonStrikerRig != null)
                humans.Add(new KeyValuePair<string, ProductionCharacterRig>("non-striker", nonStrikerRig));
            foreach (var pair in fielderById)
            {
                ProductionCharacterRig rig;
                if (!rigByRoot.TryGetValue(pair.Value, out rig) || rig == keeperRig || !pair.Value.activeSelf) continue;
                humans.Add(new KeyValuePair<string, ProductionCharacterRig>("fielder:" + pair.Key, rig));
            }
            return humans;
        }

        internal Vector3 BatterBatWorldPosition =>
            batterRig != null && batterRig.Bat != null ? batterRig.Bat.position : Vector3.zero;
        internal Vector3 BatterRootWorldPosition => batterBody == null
            ? Vector3.zero
            : batterBody.transform.position;
        internal Vector3 BatterHipsWorldPosition => batterRig == null
            ? Vector3.zero
            : batterRig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
        internal Vector3 BatterHeadWorldPosition => batterRig == null
            ? Vector3.zero
            : batterRig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
        internal Vector3 BatterLeftFootWorldPosition => batterRig == null
            ? Vector3.zero
            : batterRig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
        internal Vector3 BatterRightFootWorldPosition => batterRig == null
            ? Vector3.zero
            : batterRig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);

        public void Configure(PracticePresentationSettings value, IPracticeFeedbackSink sink)
        {
            settings = value ?? throw new ArgumentNullException(nameof(value));
            feedback = new PracticeFeedbackRouter(
                sink ?? throw new ArgumentNullException(nameof(sink)),
                WorldReflectionFor(value.Handedness));
            profile = PracticePresentationProfile.For(value.Quality, value.ReducedMotion);
            if (!built) BuildWorld();
            ApplyProfile(profile);
        }

        public void ConfigureScene(PracticeScenePresentation scene)
        {
            if (!built) throw new InvalidOperationException("Presentation must be initialized first.");
            if (scene == null || scene.Fielders == null || scene.Fielders.Length != 11)
                throw new BridgeValidationException("A complete field is required.");

            var mirror = WorldReflectionFor(scene.Handedness);
            var lateral = mirror * (float)scene.BatterLateralM;
            strikerPresentationReference = new Vector3(
                lateral,
                0f,
                9.25f - (float)scene.BatterCreaseOffsetM);
            EnsureBowler(scene);
            DirectorOnScene(scene);
            ArrangeKeeperSlot(scene);
            fielderById.Clear();
            fielderStableIndexById.Clear();
            fielderRoleById.Clear();
            fielderScenePositionById.Clear();
            ClearFieldingChoreography();
            for (var index = 0; index < fielders.Count; index++)
            {
                var source = scene.Fielders[index];
                fielderRoleById[source.Id] = source.Role;
                fielderScenePositionById[source.Id] = new Vector3((float)source.X, 0f, (float)source.Z);
                fielders[index].name = "FielderProxy-" + source.Id;
                if (fielderById.ContainsKey(source.Id))
                    throw new BridgeValidationException("Field contains duplicate fielder ids.");
                var presentationObject = source.Role == "bowler" ? bowler : fielders[index];
                fielderById.Add(source.Id, presentationObject);
                fielderStableIndexById.Add(source.Id, index);
                fielders[index].SetActive(source.Role != "bowler");
                fielders[index].transform.position = new Vector3(
                    mirror * (float)source.X, 0f, (float)source.Z);
                var towardsPitch = new Vector3(
                    -fielders[index].transform.position.x,
                    0f,
                    -fielders[index].transform.position.z);
                if (towardsPitch.sqrMagnitude > 0.0001f)
                    fielders[index].transform.rotation = Quaternion.LookRotation(towardsPitch.normalized, Vector3.up);
                ProductionCharacterRig rig;
                if (rigByRoot.TryGetValue(fielders[index], out rig))
                {
                    var isKeeper = source.Role == "keeper";
                    rig.SampleAndApply(isKeeper
                            ? ProductionCharacterMotion.KeeperCrouch
                            : ProductionCharacterMotion.FielderReady,
                        isKeeper
                            ? 0f
                            : ProductionCharacterMotionSampler.StableFielderReadyPhase(source.Id, index));
                    UpdateCharacterPresentationDistance(fielders[index], rig);
                }
            }
            productionEnvironment.ConfigureField(scene.Fielders);

            // Contract frame: pitch centre is z=0, bowler's stumps z=-10.06,
            // striker's stumps z=+10.06. Positive crease offset moves forward
            // towards the bowler, and a left hand is mirrored exactly once.
            PositionBatterBody(lateral, (float)scene.BatterCreaseOffsetM);
            nonStrikerSide = scene.BowlerArm == "left" ? 1f : -1f;
            nonStrikerGait?.Snap(NonStrikerHome(), NonStrikerHeading());
            nonStrikerGait?.Present(NonStrikerHome(), NonStrikerHeading(), 1f / 60f);
            SetStableCameraComposition(
                lateral, (float)scene.BatterCreaseOffsetM, mirror);
            ApplyHorizontalFieldOfView();
            ball.SetAppearance(scene.BallColour, scene.BallAge);
            currentPitchCondition = scene.Conditions;
            currentBallColour = scene.BallColour;
            currentBallAge = scene.BallAge;
            productionEnvironment.SetSightScreensForBall(scene.BallColour);
            ApplyPitchAppearance(scene.Conditions);
            protectedRegionProjectionVersion++;
        }

        /// <summary>
        /// Measures the actual Unity world through the camera that renders the
        /// delivery. Returned rectangles are physical framebuffer pixels with
        /// a top-left origin; no CSS/dp conversion occurs in Unity.
        /// </summary>
        public UnityPracticeProtectedRegion[] MeasureProtectedRegions(
            int viewportWidth,
            int viewportHeight)
        {
            if (!built || delivery == null || batterCamera == null ||
                viewportWidth < 1 || viewportHeight < 1 ||
                viewportWidth > BridgeConstants.MaxProtectedRegionViewportPixels ||
                viewportHeight > BridgeConstants.MaxProtectedRegionViewportPixels)
                return new UnityPracticeProtectedRegion[0];

            var regions = new List<UnityPracticeProtectedRegion>(BridgeConstants.MaxProtectedRegions);
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectRenderers(
                "bowler", batterCamera, viewportWidth, viewportHeight, bowler));
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectEnvelope(
                "release", batterCamera, viewportWidth, viewportHeight,
                ToUnity(delivery.Flight[0].p), 0.22f));
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectRenderer(
                "pitch", batterCamera, viewportWidth, viewportHeight,
                productionEnvironment?.PitchRenderer));

            var path = new Vector3[delivery.Flight.Length];
            for (var index = 0; index < delivery.Flight.Length; index++)
                path[index] = ToUnity(delivery.Flight[index].p);
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectPointUnion(
                "ball_path", batterCamera, viewportWidth, viewportHeight,
                path, CricketPropDimensions.BallRadius, 4f));
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectRenderers(
                "bat", batterCamera, viewportWidth, viewportHeight, bat));

            var contact = PracticeTraceSampling.BallAt(delivery.Flight, delivery.IdealContactT);
            AddProjectedRegion(regions, PracticeProtectedRegionProjector.ProjectEnvelope(
                "contact", batterCamera, viewportWidth, viewportHeight,
                ToUnity(contact.p),
                CricketPropDimensions.BallRadius + CricketPropDimensions.BladeWidth * 0.5f));
            return regions.ToArray();
        }

        private static void AddProjectedRegion(
            List<UnityPracticeProtectedRegion> regions,
            UnityPracticeProtectedRegion value)
        {
            if (value != null) regions.Add(value);
        }

        public void BeginDelivery(PracticeDeliveryPresentation value)
        {
            if (value == null || value.Flight == null || value.Flight.Length == 0)
                throw new BridgeValidationException("A readable delivery flight is required.");
            if (DeliveryActive) throw new BridgeValidationException("A delivery is already active.");
            // The Director's life is off while the bowler's approach is measured (the release point and the palm are measured on the bare pose).
            DirectorUndoHeadPasses();
            DirectorClearLife();

            // Any optional dead-ball follow ends at the next run-up. Every
            // playable ball begins from the same learned rear-shoulder view.
            RestoreStableCameraComposition();
            RestoreNominalBatterRoot();
            canonicalBatterRootOffset = Vector3.zero;
            ResetBatterCarry();
            batterRig.ClearCanonicalBatterBodyFrame();
            batterRig.SetCanonicalBatterPosture(0f);

            delivery = value;
            // The non-striker stands opposite the bowler's release side; physics frame +x is the striker's off side.
            nonStrikerSide = value.Flight[0].p != null && value.Flight[0].p.x < 0.0 ? 1f : -1f;
            runningPlan = ProductionRunningBetweenWickets.Empty;
            nonStrikerHandedOverFromPack = false;
            nonStrikerWalkOnStarted = false;
            nonStrikerWalkOnPlaced = false;
            touchDownT = double.NaN;
            touchCommitT = double.NaN;
            touchBat.End();
            touchDrawnFrames = 0;
            touchGuardHeldFrames = 0;
            touchDrawCalls = 0;
            touchDrawTicks = 0;
            touchDrawMaxTicks = 0;
            strikerPadStepPending = false;
            strikerStrokeBody = null;
            strikerStrideAt = double.PositiveInfinity;
            strikerStrideDue = double.PositiveInfinity;
            heldBallWindows.Clear();
            heldBallReleaseHandGaps.Clear();
            ResetFootLocks();
            bowlerPhysicsSpot = null;
            bowlerHandedOver = false;
            if (strikerRunning && batterBody != null)
                batterBody.transform.rotation = Quaternion.Euler(0f, 180f, -3f * PresentationMirror);
            strikerRunning = false;
            if (nonStrikerGait != null && (nonStrikerGait.Position - NonStrikerHome()).magnitude > 0.05f)
            {
                // Residual between-ball relocation when the next ball begins before the walk back is complete.
                nonStrikerRelocations++;
                nonStrikerGait.Snap(NonStrikerHome(), NonStrikerHeading());
            }
            // Every take this delivery plays is keyed on its record, as on the web (src/audio/takes.ts).
            feedback?.BeginTakeDelivery(value.Seed, value.OverIndex, value.BallIndex, currentPitchCondition);
            // Bridge-delivered packets always carry these projected values.
            // The stock defaults preserve the source-only benchmark/test
            // harnesses which construct a presentation directly, without ever
            // changing a real host-authored delivery.
            var stockSpeed = bowlingPresentation.Role == ProductionCharacterRole.PaceBowler
                ? 130.0
                : 85.0;
            var plannedSpeed = value.PlannedSpeedKph > 0.0 ? value.PlannedSpeedKph : stockSpeed;
            var releaseSpeed = value.ReleaseSpeedKph > 0.0 ? value.ReleaseSpeedKph : plannedSpeed;
            bowlingCue = ProductionBowlingCueProfile.ForHostDelivery(
                bowlingPresentation.Role,
                string.IsNullOrEmpty(value.Variation) ? "stock" : value.Variation,
                plannedSpeed,
                releaseSpeed,
                value.ReleaseSeamDeg,
                value.SeamWobble,
                value.SpinRps);
            playback = null;
            acceptedTrace = null;
            feedbackLookaheadCursor = 0;
            ClearFieldingChoreography();
            if (fielderGaits.Count == 0) RestoreFieldersToScene();
            fielderWalkInStart.Clear();
            fielderWalkInStartT.Clear();
            fielderAmbientHanded.Clear();
            pathedFielderIds.Clear();
            bowlerAmbientHanded = false;
            provisionalSwing = null;
            leavePlan = default;
            liveStrokeStartPending = false;
            strikerReachLean = Vector3.zero;
            strikerReachLeanT = double.NaN;
            replayDigest = null;
            playbackSpeed = 1.0;
            timeline = -bowlingPresentation.ApproachSeconds;
            releaseReported = false;
            completionReported = false;
            localPreparation = false;
            localBatPreviewActive = false;
            localBatPreview = default;
            canonicalBat = false;
            canonicalStrokeAvailable = false;
            canonicalBatPoseAvailable = false;
            canonicalNoShotPoseCaptured = false;
            playbackDeadMarked = false;
            provisionalFootwork = ProductionBatterFootwork.Balanced;
            canonicalFootwork = ProductionBatterFootwork.Balanced;
            canonicalBlendFromFootwork = ProductionBatterFootwork.Balanced;
            provisionalStrokePhase = 0f;
            canonicalBlendFromPhase = 0f;
            canonicalBodyBlendElapsed = 0.0;
            contactOccurred = false;
            recoveryElapsed = 0.0;
            recoveryCanonicalBatCaptured = false;
            recoveryBeginDeferred = false;
            outcomeElapsed = 0.0;
            emittedEvents.Clear();
            productionEnvironment.ResetDeliveryConsequences();
            var effectsPolicy = ProductionDeliveryEffectsPolicy.None;
            if (value.CoachGuide != null && value.CoachGuide.Stage == 1)
                effectsPolicy = new ProductionDeliveryEffectsPolicy(true, true, false);
            else if (value.CoachGuide != null && value.CoachGuide.Stage == 2)
                effectsPolicy = ProductionDeliveryEffectsPolicy.LearnLandingOnly;
            else if (value.CoachGuide == null && value.LearnCue)
                effectsPolicy = ProductionDeliveryEffectsPolicy.LearnLandingOnly;
            deliveryEffects.BeginDelivery(value.Flight, effectsPolicy, PresentationMirror);
            coachGuidePresentation.Begin(value.CoachGuide, PresentationMirror);
            ball.ConfigureFlightOrientation(
                ToUnityAxial(value.SeamAxis),
                ToUnity(value.ShineDirection),
                value.SeamWobble,
                ToUnityAxial(value.SpinAxis),
                value.AfterBounceSpinAxis == null
                    ? (Vector3?)null
                    : ToUnityAxial(value.AfterBounceSpinAxis),
                value.BounceT,
                bowlingPresentation.Role == ProductionCharacterRole.SpinBowler);
            ball.SetVisible(true);
            var bowlerBefore = bowler != null ? bowler.transform.position : Vector3.zero;
            PrepareBowlerApproach(ToUnity(value.Flight[0].p));
            // Residual between-ball relocation when the next ball begins before the walk back reaches the mark.
            if (bowlerGait != null && (bowlerBefore - bowler.transform.position).magnitude > 0.5f) bowlerRelocations++;
            ResetBat();
            DirectorOnBeginDelivery(value);
            state = WorldState.RunUp;
            SetQuiet(true);
            AnimateBowler(0f);
        }

        public void BeginLocalPreparation()
        {
            if (!DeliveryActive || !releaseReported || canonicalBat) return;
            // CTL1 (owner decision 2026-11-04): the bat moves at the native touch-down; the shot commits on lift.
            if (!localPreparation || double.IsNaN(touchDownT)) touchDownT = timeline;
            localPreparation = true;
            provisionalStrokePhase = 0f;
            // Do not replace the currently drawn anticipation bat synchronously inside the input callback. The native
            // touch-down pose is sampled by UpdateProvisionalBat on the next presentation frame, where its distance to
            // the same-time no-input bat and authoritative ball can be guarded. An eager generic stance here created
            // one dishonest frame before that guard ran (especially for a late press close to contact).
        }

        /// <summary>
        /// Shows a bounded backlift/aim response while a post-release drag is
        /// still active. This is deliberately presentation-only: it does not
        /// select a shot, move the delivery, emit a cricket event or feed any
        /// value back to TypeScript. The host-normalized provisional swing and
        /// canonical trace always replace it.
        /// </summary>
        public void ApplyLocalBatPreview(PracticeLocalBatPreview value)
        {
            if (!DeliveryActive || !releaseReported || canonicalBat || provisionalSwing != null) return;
            localPreparation = true;
            localBatPreview = value;
            localBatPreviewActive = true;
            provisionalFootwork = ProductionBatterFootworkAdapter.FromHostIntent(
                string.IsNullOrEmpty(value.Footwork) ? "auto" : value.Footwork);
        }

        public void CancelLocalPreparation()
        {
            if (canonicalBat) return;
            localPreparation = false;
            localBatPreviewActive = false;
            localBatPreview = default;
            provisionalSwing = null;
            touchDownT = double.NaN;
            touchCommitT = double.NaN;
            touchBat.End();
            provisionalFootwork = ProductionBatterFootwork.Balanced;
            provisionalStrokePhase = 0f;
            ResetBat();
        }

        public void ApplyProvisionalSwing(PracticeSwingPresentation value)
        {
            if (!DeliveryActive || value == null || canonicalBat) return;
            localBatPreviewActive = false;
            localBatPreview = default;
            if (provisionalSwing == null)
            {
                strikerReachLean = Vector3.zero;
                strikerReachLeanT = double.NaN;
            }
            provisionalSwing = value;
            provisionalFootwork = ProductionBatterFootworkAdapter.FromHostIntent(value.Footwork);
            localPreparation = true;
            // The commitment continues the touch-down stroke (session.ts beginSwing): joined over TouchCommitSeconds from
            // where the stroke is now; a stroke already checked back starts afresh.
            if (!double.IsNaN(touchDownT) &&
                timeline - touchDownT < TapHoldSeconds + TouchCheckSeconds)
                touchCommitT = timeline;
            else touchCommitT = double.NaN;
        }

        // CTL1 (owner decision 2026-11-04), the web rule (src/render3d/practice/bat.ts TOUCHDOWN and withTouch,
        // session.ts prepareSwing/beginSwing, src/input/constants.ts TAP_HOLD_MS) with FEEL-1's clearance and 120 ms
        // look-ahead (2026-11-07): ProductionTouchDownBat. From the press the bat leaves the bat it would draw with no
        // input along a rigid blend towards the tap's hitting pose (here the code-authored stroke's contact bat), at most
        // 35% of the way and soft-capped in time, never nearer the ball than the no-input bat unless 0.15 m away, and
        // retracting before the ball arrives. The body stays in the anticipation, as the web's: only the bat and the
        // hands move, so nothing pops at the press (the code-authored stroke's own waiting bat pointed the other way:
        // the bat jumped 1.6 m at the press). A press that outlives the tap window checks back to the waiting bat; a
        // commitment joins the committed swing over TouchCommitSeconds.
        internal const double TapHoldSeconds = ProductionTouchDownBat.TapHoldSeconds;
        internal const double TouchCommitSeconds = ProductionTouchDownBat.CommitSeconds;
        internal const double TouchCheckSeconds = ProductionTouchDownBat.CheckSeconds;
        internal const double TouchDownClearMetres = ProductionTouchDownBat.ClearMetres;
        private double touchDownT = double.NaN;
        private double touchCommitT = double.NaN;
        private readonly ProductionTouchDownBat touchBat = new ProductionTouchDownBat();
        private TouchDownSource touchSource;

        // Builder measurement: the frames the touch-down stroke was drawn this delivery, and of them the frames the
        // clearance guard drew it less far along (or not at all) than the soft-capped stroke asks.
        private int touchDrawnFrames;
        private int touchGuardHeldFrames;
        internal int TouchDrawnFramesForEvidence => touchDrawnFrames;
        internal int TouchGuardHeldFramesForEvidence => touchGuardHeldFrames;

        private int touchDrawCalls;
        private long touchDrawTicks;
        private long touchDrawMaxTicks;

        /// <summary>What the guarded draw of the press cost this delivery (builder evidence only): calls, mean and largest (ms).</summary>
        internal void TouchDrawCostForEvidence(out int calls, out double meanMilliseconds, out double maxMilliseconds)
        {
            calls = touchDrawCalls;
            var perTick = 1000.0 / System.Diagnostics.Stopwatch.Frequency;
            meanMilliseconds = calls > 0 ? touchDrawTicks * perTick / calls : 0.0;
            maxMilliseconds = touchDrawMaxTicks * perTick;
        }

        private bool touchCommandedDrawn;
        private ProductionTouchDownBat.BatPose touchCommanded;
        private double touchCommandedT = double.NaN;

        /// <summary>
        /// The bat the last frame commanded for the press (builder evidence only): the time it was for, whether the stroke
        /// (not the waiting bat) was drawn, the pose and the guarded travel.
        /// </summary>
        internal bool TouchCommandedForEvidence(out double t, out ProductionTouchDownBat.BatPose pose, out double travel)
        {
            t = touchCommandedT;
            pose = touchCommanded;
            travel = touchBat.LastTravel;
            return touchCommandedDrawn;
        }

        /// <summary>The waiting bat of any moment of this delivery (builder evidence only).</summary>
        internal bool WaitingBatForEvidence(double t, out Vector3 grip, out Vector3 toe, out Vector3 face) =>
            StrikerPackBatWorld(t, out grip, out toe, out face);

        /// <summary>
        /// How far the press's stroke moves the bat from the waiting bat at `t` with the cap reached (builder evidence only):
        /// the angle (degrees) between the waiting bat's blade and the tap's hitting pose's, between the waiting bat's and the
        /// unguarded stroke's, and the distances (m) the unguarded stroke's grip and toe are from the waiting bat's.
        /// </summary>
        internal bool TouchDownCapForEvidence(double t, out double gapDegrees, out double turnDegrees, out double gripMetres,
            out double toeMetres)
        {
            gapDegrees = turnDegrees = gripMetres = toeMetres = double.NaN;
            ProductionTouchDownBat.BatPose asked;
            if (!touchBat.Active || !touchBat.DrawUnguarded(t, out asked)) return false;
            var wait = touchSource.NoInputAt(t);
            gapDegrees = touchBat.GapDegrees(t);
            turnDegrees = Vector3.Angle(asked.Toe - asked.Grip, wait.Toe - wait.Grip);
            gripMetres = Vector3.Distance(asked.Grip, wait.Grip);
            toeMetres = Vector3.Distance(asked.Toe, wait.Toe);
            return true;
        }

        /// <summary>What the touch-down stroke needs of the world: the waiting bat of any moment, and the ball's flight.</summary>
        private sealed class TouchDownSource : ProductionTouchDownBat.ISource
        {
            private readonly ProceduralPracticeWorld world;

            public TouchDownSource(ProceduralPracticeWorld world)
            {
                this.world = world;
            }

            public ProductionTouchDownBat.BatPose NoInputAt(double t)
            {
                Vector3 grip, toe, face;
                world.StrikerPackBatWorld(t, out grip, out toe, out face);
                return new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face };
            }

            public bool BallAt(double t, out Vector3 ball) => world.FlightBallAt(t, out ball);
        }

        /// <summary>The drawn ball's place at simulation time t (the flight, linear between its samples, no allocation).</summary>
        private bool FlightBallAt(double t, out Vector3 ball)
        {
            ball = Vector3.zero;
            var samples = delivery != null ? delivery.Flight : null;
            if (samples == null || samples.Length == 0) return false;
            var high = samples.Length - 1;
            if (t <= samples[0].t)
            {
                ball = ToUnity(samples[0].p);
                return true;
            }
            if (t >= samples[high].t)
            {
                ball = ToUnity(samples[high].p);
                return true;
            }
            var low = 0;
            while (low + 1 < high)
            {
                var middle = low + (high - low) / 2;
                if (samples[middle].t <= t) low = middle;
                else high = middle;
            }
            var span = samples[high].t - samples[low].t;
            var amount = span > 0.0 ? (float)((t - samples[low].t) / span) : 0f;
            ball = Vector3.Lerp(ToUnity(samples[low].p), ToUnity(samples[high].p), amount);
            return true;
        }

        /// <summary>
        /// Starts this press's stroke: its hitting pose is the code-authored stroke's contact bat (the legacy stroke
        /// the committed swing joins), measured once per press from the driver joints alone.
        /// </summary>
        private bool PrepareTouchDown()
        {
            if (touchBat.Active && Math.Abs(touchBat.PressT - touchDownT) < 1e-9) return true;
            if (batterRig == null || batterBody == null || double.IsNaN(touchDownT)) return false;
            Vector3 grip, toe, face;
            batterRig.LegacyStrokeBatPose(ProductionCharacterMotionSampler.BatterContact, provisionalFootwork,
                out grip, out toe, out face);
            if (touchSource == null) touchSource = new TouchDownSource(this);
            touchBat.Begin(touchSource, new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face }, touchDownT);
            return true;
        }

        /// <summary>
        /// The bat the uncommitted press draws at t, guarded, over the waiting bat: false when it is drawn as with no
        /// input (no press yet, held off the ball, or checked back), true with `pose` the stroke.
        /// </summary>
        private bool TouchDownBatAt(double t, out ProductionTouchDownBat.BatPose pose)
        {
            pose = default(ProductionTouchDownBat.BatPose);
            if (double.IsNaN(touchDownT) || t <= touchDownT || !PrepareTouchDown()) return false;
            var began = System.Diagnostics.Stopwatch.GetTimestamp();
            var drawn = touchBat.Draw(t, out pose);
            var took = System.Diagnostics.Stopwatch.GetTimestamp() - began;
            touchDrawCalls++;
            touchDrawTicks += took;
            if (took > touchDrawMaxTicks) touchDrawMaxTicks = took;
            touchCommandedDrawn = drawn;
            touchCommanded = pose;
            touchCommandedT = t;
            ProductionTouchDownBat.BatPose asked;
            if (touchBat.DrawUnguarded(t, out asked))
            {
                touchDrawnFrames++;
                if (!drawn || Vector3.Distance(asked.Toe, pose.Toe) > 1e-5f || Vector3.Distance(asked.Grip, pose.Grip) > 1e-5f)
                    touchGuardHeldFrames++;
            }
            return drawn;
        }

        /// <summary>
        /// The commitment's first 40 ms: the bat leaves the uncommitted drawing (what the press was drawing, or the
        /// waiting bat) for the committed swing's by a rigid blend (bat.ts withTouch), the hands following it.
        /// </summary>
        private void JoinTouchDownBat(float amount)
        {
            var held = batterRig.Bat;
            var committed = new ProductionTouchDownBat.BatPose
            {
                Grip = held.position,
                Toe = held.position + held.TransformDirection(Vector3.down) * (float)BridgeConstants.CanonicalBatLengthMetres,
                Face = held.forward
            };
            ProductionTouchDownBat.BatPose open;
            if (!TouchDownBatAt(timeline, out open))
            {
                Vector3 grip, toe, face;
                if (!StrikerPackBatWorld(timeline, out grip, out toe, out face)) return;
                open = new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face };
            }
            var joined = ProductionTouchDownBat.Rigid(open, committed, amount);
            batterRig.SetCanonicalBatPose(joined.Grip, joined.Toe, joined.Face, 1f, false, false);
        }

        public void AcceptResult(PracticeResultPresentation result)
        {
            if (result == null || result.Trace == null)
                throw new BridgeValidationException("A canonical result trace is required.");
            if (!DeliveryActive && !result.IsReplay)
                throw new BridgeValidationException("No delivery is awaiting a result.");
            // Validate before mutating any visible transform. Normal bridge traffic is already validated by the
            // adapter, but direct benchmark/test callers must not be able to latch a malformed or non-finite root.
            AcceptResultTimings.Begin();
            DirectorUndoHeadPasses();
            CanonicalTraceValidator.Validate(result.Trace);
            ValidateCanonicalBatterBodyFrame(result.BatterBodyFrame);
            AcceptResultTimings.Mark(0);

            // UNITY-7 B: the arms' elbow memory is the frame on screen's. The solves AcceptResult makes between frames (the stroke's
            // pose re-sampled for the carry) run on the last frame's clock and overwrite it, so the next frame's solve took its
            // elbow plane from a pose that was never drawn and could flip it by 120 to 155 degrees; it is put back below.
            var elbowMemory = KeepElbowMemoryAcrossAccept && !result.IsReplay && batterRig != null
                ? batterRig.CaptureElbowMemory()
                : null;
            if (!result.IsReplay) PrepareStancePadStep(result.Trace);
            else
            {
                strikerPadStepPending = false;
                // A replay starts planted, from the pose it begins in: a seek, so nothing is remembered from the frame before.
                batterRig.ResetElbowMemory();
            }
            AcceptResultTimings.Mark(1);
            // What is on screen now: the carry starts from exactly this body and bat.
            var shownRootOffset = batterBody != null
                ? batterBody.transform.position - nominalBatterWorldPosition
                : Vector3.zero;
            shownRootOffset.y = 0f;
            // The anchor the rig aligns last: the shoulder midpoint on the complete hero, else the torso top.
            var shownTorsoTop = batterRig.HeroSkinnedRenderer != null
                ? (batterRig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft) +
                   batterRig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight)) * 0.5f -
                  Vector3.forward * ProductionCharacterRig.CanonicalBatterShoulderZMetres
                : batterRig.HeroCanonicalTorsoTopWorld;
            var shownBat = batterRig.Bat;
            batterCarryShownGrip = shownBat != null ? shownBat.position : Vector3.zero;
            batterCarryShownRotation = shownBat != null ? shownBat.rotation : Quaternion.identity;
            AcceptResultTimings.Mark(2);

            replayDigest = result.ReplayDigest;
            playbackSpeed = result.PlaybackSpeed;
            canonicalBlendFromPhase = provisionalStrokePhase;
            canonicalFootwork = ProductionBatterFootworkAdapter.FromHostIntent(result.Footwork);
            canonicalBlendFromFootwork = result.IsReplay ? canonicalFootwork : provisionalFootwork;
            canonicalBodyBlendElapsed = 0.0;
            canonicalStrokeAvailable = HasTimedCanonicalStroke(result.Trace);
            liveStrokeStartPending = false;
            // The lean a committed swing built carries on into its stroke (it is the body's, not the clip's); any other result starts level.
            if (!(ProvisionalPackBodyEnabled && !result.IsReplay && provisionalSwing != null))
            {
                strikerReachLean = Vector3.zero;
                strikerReachLeanT = double.NaN;
            }
            if (ProvisionalPackBodyEnabled && !result.IsReplay && provisionalSwing != null)
            {
                // UNITY-5 F2: the body on screen is TRACKB's load, not the code-authored stroke's pose at provisionalStrokePhase.
                // The code-authored stroke that a result with no clip (a governed stride, a charge, a sweep) plays, and the
                // recovery of a no-shot result, therefore begin from where the stroke begins, its backlift (the pose the load
                // is nearest to), as a committed swing once did, and the pose-source change is handed over inertially.
                canonicalBlendFromPhase = Mathf.Min(provisionalStrokePhase, ProductionCharacterMotionSampler.BatterBacklift);
            }
            // A held/no-shot trace must leave acceptance from the exact complete hero already on screen. Capture it
            // before latching the canonical frame and re-sampling the deterministic driver pose; otherwise the first
            // no-shot frame can inherit the newly synchronized hero even though its blend amount is explicitly zero.
            if (!canonicalStrokeAvailable && canonicalBlendFromPhase > 0.0001f)
                batterRig.CaptureHeroTransitionSource();
            AcceptResultTimings.Mark(3);
            PrepareCanonicalBatterTiming(result.Trace);
            AcceptResultTimings.Mark(4);
            PrepareBatterCarry(result, shownRootOffset, shownTorsoTop);
            AcceptResultTimings.Mark(5);
            RestoreNominalBatterRoot();
            LatchCanonicalBatterRoot(result.Trace);
            LatchCanonicalBatterPosture(result.Trace);
            LatchCanonicalBatterBodyFrame(result.BatterBodyFrame);
            AcceptResultTimings.Mark(6);
            // The posture is static from result acceptance, including any pre-domain interval before the first bat
            // knot. Re-sample the already-selected source phase without body/neck retarget so the crouch becomes
            // visible immediately and canonical SetBat can continue the same bounded blend.
            batterRig.SampleBatterStrokeBlend(
                canonicalBlendFromPhase,
                canonicalBlendFromFootwork,
                canonicalBlendFromPhase,
                canonicalBlendFromFootwork,
                0f,
                applyBatterNeckClearance: false);
            if (!canonicalStrokeAvailable && canonicalBlendFromPhase > 0.0001f)
            {
                batterRig.ApplyHeroTransitionBlend(0f);
                // Keep the restored complete hero as the durable source for the subsequent bounded no-shot blend.
                batterRig.BeginBatterNoShotHeroBlend();
            }
            // UNITY-9: that re-sample posed the bat at the code-authored backlift. A result that comes after the swing was committed and drawn (the
            // predicted bat is at the contact, or held there) found the bat 0.67 m away in one frame and the arms followed it 100 to 177 degrees; the carry
            // below only restores it when the trace's stroke is not the pack's, so the bat is put back on screen here, where the carry then takes it.
            // (A result with no timed stroke, a leave, has its own hand-over: the leave overlay, or with it off the old drop to the stance UNITY-7 keeps as its control.)
            if (LateSettleBatRestore && !result.IsReplay && canonicalStrokeAvailable && shownBat != null)
                shownBat.SetPositionAndRotation(batterCarryShownGrip, batterCarryShownRotation);
            AcceptResultTimings.Mark(7);
            localBatPreviewActive = false;
            localBatPreview = default;
            canonicalBat = true;
            PrepareStrikerPhysicsBody(result);
            AcceptResultTimings.Mark(8);
            PreparePresentedBat(result);
            AcceptResultTimings.Mark(9);
            PreparePackStroke(result);
            PrepareLeaveOverlay(result);
            AcceptResultTimings.Mark(10);
            canonicalBatPoseAvailable = result.Trace.bat != null && result.Trace.bat.Length > 0;
            canonicalNoShotPoseCaptured = false;
            playbackDeadMarked = false;
            recoveryCanonicalBatCaptured = false;
            recoveryBeginDeferred = false;
            if (result.IsReplay)
            {
                // A replay is heard as its live ball was: the same record keys the same takes, uses restart.
                feedback?.BeginTakeDelivery(result.RecordSeed, result.RecordOverIndex, result.RecordBallIndex,
                    currentPitchCondition);
                completionReported = false;
                recoveryElapsed = 0.0;
                outcomeElapsed = 0.0;
                contactOccurred = false;
                emittedEvents.Clear();
                deliveryEffects.ResetDelivery();
                coachGuidePresentation.Reset();
                productionEnvironment.ResetDeliveryConsequences();
                deliveryEffects.BeginDelivery(
                    result.Trace.ball,
                    ProductionDeliveryEffectsPolicy.None,
                    PresentationMirror);
                deliveryEffects.MarkReleased();
            }
            AcceptResultTimings.Mark(11);
            feedback?.SetContactTiming(result.ContactTiming);
            deliveryEffects.SetResolvedPath(result.Trace.ball, result.IsReplay);
            acceptedTrace = result.Trace;
            feedbackLookaheadCursor = 0;
            AcceptResultTimings.Mark(12);
            BuildFieldingChoreography(result);
            AcceptResultTimings.Mark(13);
            batterCarryAccepting = true;
            try
            {
                runningPlan = ProductionRunningBetweenWickets.FromTrace(result.Trace);
                AcceptResultTimings.Mark(14);
                BuildHeldBallWindows(result.Trace);
                AcceptResultTimings.Mark(15);
                playback = new CanonicalTracePlayback(result.Trace, this);
                AcceptResultTimings.Mark(16);
                if (!result.IsReplay && timeline > 0.0)
                {
                    var seekTime = Math.Min(timeline, result.Trace.durationSeconds);
                    ReconcileHistoricalEventState(result.Trace, seekTime);
                    AcceptResultTimings.Mark(17);
                    playback.Seek(seekTime);
                    AcceptResultTimings.Mark(18);
                    ApplyHeldBall(seekTime);
                    AcceptResultTimings.Mark(19);
                }
                else
                    timeline = 0.0;
            }
            finally
            {
                batterCarryAccepting = false;
            }
            if (elbowMemory != null) batterRig.RestoreElbowMemory(elbowMemory);
            state = WorldState.Resolved;
            SetQuiet(true);
            // The Director's plans for the result are queued here and baked in the spare slices of the frames that follow.
            DirectorOnAcceptResult(result);
            // The accept re-posed the rig outside a frame: the heads are given the turn they had (they are never seen bare between two frames).
            DirectorRedoHeadPasses();
            AcceptResultTimings.Mark(20);
        }

        /// <summary>Builder seam (A/B in one build; UNITY-7 B): false lets the accept's own arm solves overwrite the elbow memory, as before.</summary>
        internal bool KeepElbowMemoryAcrossAccept { get; set; } = true;

        private void ReconcileHistoricalEventState(CanonicalDeliveryTrace trace, double seekTime)
        {
            // Late host results must restore visual state, but playing old audio
            // or haptics late would be misleading. Seek deliberately suppresses
            // prior callbacks; only durable presentation state is reconciled here.
            for (var index = 0; index < trace.events.Length; index++)
            {
                var traceEvent = trace.events[index];
                if (traceEvent.t >= seekTime) break;
                if (traceEvent.kind == "contact")
                {
                    contactOccurred = true;
                    // Restore durable visual consequence state without routing
                    // a late sound or haptic through the feedback sink.
                    deliveryEffects.HandleEvent(traceEvent);
                    coachGuidePresentation.MarkContact();
                }
                else if (traceEvent.kind == "stumps")
                {
                    productionEnvironment.HandleAuthoritativeTraceEvent(
                        traceEvent, PresentationMirror);
                }
                emittedEvents.Add(traceEvent.kind + ":" + traceEvent.t.ToString("R",
                    System.Globalization.CultureInfo.InvariantCulture));
            }
        }

        public void RequestProfile(PracticePresentationQuality quality)
        {
            var requested = PracticePresentationProfile.For(quality, settings != null && settings.ReducedMotion);
            if (DeliveryActive) pendingProfile = requested;
            else ApplyProfile(requested);
        }

        public void SetPaused(bool paused)
        {
            if (paused && state != WorldState.Paused)
            {
                stateBeforePause = state;
                state = WorldState.Paused;
            }
            else if (!paused && state == WorldState.Paused)
            {
                state = stateBeforePause;
            }
        }

        public void Stop()
        {
            EndBenchmarkWorkload();
            state = WorldState.Idle;
            playback = null;
            acceptedTrace = null;
            feedbackLookaheadCursor = 0;
            localPreparation = false;
            localBatPreviewActive = false;
            localBatPreview = default;
            provisionalSwing = null;
            leavePlan = default;
            canonicalStrokeAvailable = false;
            canonicalBatPoseAvailable = false;
            canonicalNoShotPoseCaptured = false;
            playbackDeadMarked = false;
            recoveryCanonicalBatCaptured = false;
            recoveryBeginDeferred = false;
            ball.SetVisible(false);
            deliveryEffects.ResetDelivery();
            coachGuidePresentation.Reset();
            productionEnvironment?.ResetDeliveryConsequences();
            RestoreStableCameraComposition();
            SetQuiet(false);
        }

        public void Tick(double deltaSeconds)
        {
            if (!built) return;
            if (double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds < 0.0)
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
            // The face-and-life Director: the life of the frame is set before any pose of it is applied, the head pass runs last on the finished bones.
            DirectorBeginFrame(deltaSeconds);
            try
            {
                TickCore(deltaSeconds);
            }
            finally
            {
                DirectorEndFrame();
            }
        }

        private void TickCore(double deltaSeconds)
        {
            presentationClock += deltaSeconds;
            if (batterRig != null) batterRig.PresentationClockSeconds = presentationClock;
            // The non-striker's grip arm goes through the same batter solve and remembers its elbow the same way.
            if (nonStrikerRig != null) nonStrikerRig.PresentationClockSeconds = presentationClock;
            deliveryEffects?.Tick((float)deltaSeconds);
            productionEnvironment?.TickConsequences((float)deltaSeconds);
            keeperOcclusion?.Update((float)deltaSeconds);
            for (var index = 0; index < lensFades.Count; index++) lensFades[index].Update((float)deltaSeconds);

            if (benchmarkActive)
            {
                AnimateBenchmarkWorkload(deltaSeconds);
                ApplyHorizontalFieldOfView();
                UpdateFieldPip();
                return;
            }
            if (state == WorldState.Paused)
            {
                UpdateFieldPip();
                return;
            }
            if (state == WorldState.Idle)
            {
                // HUM U1: no statues between balls. The batters walk back and everyone keeps breathing.
                PresentBatters(deltaSeconds);
                FinishNonStrikerFrame((float)deltaSeconds);
                strikerIdleClock += deltaSeconds;
                if (!strikerRunning && batterRig != null)
                {
                    // Between balls he stands in his own live stance, not the last stroke's physics body frame.
                    batterRig.ClearCanonicalBatterBodyFrame();
                    batterRig.SetCanonicalBatterPosture(0f);
                    PresentStrikerAnticipation(strikerIdleClock, false);
                }
                FinishStrikerFrame((float)deltaSeconds);
                PresentFieldersAmbient(deltaSeconds);
                PresentBowlerWalkBack(deltaSeconds);
                ApplyFootLocks((float)deltaSeconds);
                UpdateFieldPip();
                return;
            }

            using (TickMarker.Auto())
            {
                if (state == WorldState.RunUp || state == WorldState.Flight)
                {
                    timeline += deltaSeconds;
                    if (timeline < -TimelineBoundaryToleranceSeconds)
                    {
                        AnimateBowler((float)((timeline + bowlingPresentation.ApproachSeconds) /
                                              bowlingPresentation.ApproachSeconds));
                    }
                    else
                    {
                        // Presentation durations are authored as floats while the runtime
                        // clock is double precision. Treat their sub-microsecond conversion
                        // residue as the exact release boundary, not another render frame.
                        if (timeline < 0.0) timeline = 0.0;
                        if (!releaseReported)
                        {
                            releaseReported = true;
                            emittedEvents.Add("release:0");
                            deliveryEffects.MarkReleased();
                            coachGuidePresentation.MarkReleased();
                            ReleaseReached?.Invoke();
                        }
                        state = WorldState.Flight;
                        PresentFlightBall(timeline);
                        AnimateBowlerFollowThrough(timeline);
                    }
                    UpdateProvisionalBat();
                }
                else if (state == WorldState.Resolved)
                {
                    canonicalBodyBlendElapsed += deltaSeconds * playbackSpeed;
                    if (!canonicalStrokeAvailable)
                    {
                        var noShotBlend = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(
                            (float)(canonicalBodyBlendElapsed / CanonicalBodyBlendSeconds)));
                        if (canonicalBatPoseAvailable && canonicalNoShotPoseCaptured)
                        {
                            ApplyCanonicalNoShotPose(noShotBlend);
                        }
                        else if (canonicalBlendFromPhase > 0.0001f)
                        {
                            batterRig.SampleBatterStrokeBlend(
                                canonicalBlendFromPhase,
                                canonicalBlendFromFootwork,
                                0f,
                                canonicalFootwork,
                                noShotBlend,
                                applyBatterNeckClearance: false);
                            batterRig.ApplyBatterNoShotHeroBlend(noShotBlend);
                        }
                    }
                    UpdateBatterCarry(Math.Min(
                        acceptedTrace != null ? acceptedTrace.durationSeconds : double.PositiveInfinity,
                        playback.Time + deltaSeconds * playbackSpeed));
                    using (TraceMarker.Auto()) playback.Advance(deltaSeconds * playbackSpeed);
                    timeline = playback.Time;
                    if (!strikerRunning && runningPlan.Runs > 0 && playback.Time >= runningPlan.FirstStartT)
                    {
                        strikerRunning = true;
                        // He sets off from where his stride put him (his hips), not from his stance root 0.7 m back.
                        strikerGait.BlendFromCurrent(0.28f, rebaseOnHips: true);
                        strikerRunStart = strikerGait.Position;
                        // The stroke's physics body frame (torso and head on the crease) must not hold a running body
                        // back: it kept the drawn striker's hips at the crease while his root ran the physics runs
                        // (pre-existing; found by UNITY-2's r4 trace). Between balls the Idle stance clears it too.
                        batterRig.ClearCanonicalBatterBodyFrame();
                        batterRig.SetCanonicalBatterPosture(0f);
                        nonStrikerRunStart = nonStrikerGait.Position;
                        nonStrikerRunStartSpeed = nonStrikerHandedOverFromPack ? nonStrikerHandOverSpeed : 0f;
                    }
                    // Before the bat's authored domain SetBat is not called; the carried root still moves.
                    ApplyCanonicalBatterRoot();
                    UpdateEarlyFollowThroughRecovery(playback.Time);
                    ApplySyntheticFielding(playback.Time);
                    ApplyHeldBall(playback.Time);
                    // Until the physics bat's first sample the striker keeps his anticipation (it used to freeze from
                    // acceptance and then snap into the stroke at its first sample).
                    // A forgiven physics bat may start before the input: the striker waits until the input, too.
                    if (PackStrokeActiveAt(playback.Time))
                        PresentPackStroke(playback.Time);
                    else if (leavePlan.Valid && !strikerRunning)
                        // UNITY-7 C: a leave stays in TRACKB's ready hold, the head turning to watch the ball past (bat_leave).
                        PresentStrikerAnticipation(playback.Time, true);
                    else if (canonicalStrokeAvailable && !strikerRunning && acceptedTrace != null &&
                        acceptedTrace.bat != null && acceptedTrace.bat.Length > 0 &&
                        playback.Time < Math.Max(acceptedTrace.bat[0].t,
                            presentedBat.Valid ? presentedBat.StartT : double.NegativeInfinity) - 1e-9)
                        PresentStrikerAnticipation(playback.Time, true);
                    RouteFeedbackAhead();
                    if (playback.Completed && !completionReported)
                    {
                        if (!playbackDeadMarked)
                        {
                            deliveryEffects.MarkDead();
                            coachGuidePresentation.Reset();
                            playbackDeadMarked = true;
                        }
                        if (!canonicalStrokeAvailable &&
                            canonicalBodyBlendElapsed + TimelineBoundaryToleranceSeconds <
                            CanonicalBodyBlendSeconds)
                        {
                            // A late no-shot can seek straight to trace completion. Keep its quiet, presentation-
                            // only address blend alive for the same bounded reconciliation window before outcome UI.
                            // Trace time, events and dead-ball authority are already complete and remain unchanged.
                            UpdateCamera((float)deltaSeconds);
                            ApplyHorizontalFieldOfView();
                            UpdateBallReadabilityProjection();
                            UpdateFieldPip();
                            return;
                        }
                        if (canonicalStrokeAvailable)
                        {
                            // SetBat has just applied the trace's terminal body phase. Keep Delivery Quiet Mode
                            // active while that balanced recovery reads in the unobstructed world; only then may
                            // outcome UI cover any part of the athlete. A recovery already begun after the
                            // follow-through hold simply continues; the beat's duration is unchanged.
                            state = WorldState.Recovery;
                            recoveryElapsed = 0.0;
                            if (!earlyRecoveryBegun && !strikerRunning)
                            {
                                if (packStrokeShown && DeadBallRecoveryAfterPackStrokeFrame)
                                {
                                    // UNITY-8: the dead ball came in the very frame TRACKB's stroke was drawn (a bowled or LBW ball
                                    // ends the trace long before the stroke's clip does). The recovery re-poses the hero from the
                                    // code-authored stroke's reference pose, so beginning it now would show that pose in this frame
                                    // (the hips 36 cm in one frame, the gloves 31 cm off the handle); begin it on the next frame, when the inertial
                                    // hand-over (FinishStrikerFrame) blends it out of the stroke on screen, as the early recovery's.
                                    recoveryBeginDeferred = true;
                                }
                                else
                                {
                                    recoveryCanonicalBatPosition = batterRig.Bat.position;
                                    recoveryCanonicalBatRotation = batterRig.Bat.rotation;
                                    batterRig.BeginBatterDeadBallRecovery(
                                        recoveryCanonicalBatPosition,
                                        recoveryCanonicalBatRotation,
                                        canonicalFootwork);
                                    recoveryCanonicalBatCaptured = true;
                                }
                            }
                        }
                        else
                        {
                            // A leave, no-shot or single held bat sample has no authored stroke to recover from.
                            // Preserve that accepted terminal presentation instead of inventing a full drive after
                            // the ball is dead. Outcome timing begins after any bounded address reconciliation.
                            SetQuiet(false);
                            state = WorldState.Outcome;
                            outcomeElapsed = 0.0;
                        }
                    }
                }
                else if (state == WorldState.Recovery)
                {
                    recoveryElapsed = Math.Min(
                        DeadBallRecoverySeconds,
                        recoveryElapsed + deltaSeconds);
                    if (recoveryBeginDeferred)
                    {
                        // The bat and the body are as the last frame (TRACKB's stroke) drew them; the recovery begins from them.
                        recoveryBeginDeferred = false;
                        recoveryCanonicalBatPosition = batterRig.Bat.position;
                        recoveryCanonicalBatRotation = batterRig.Bat.rotation;
                        batterRig.BeginBatterDeadBallRecovery(
                            recoveryCanonicalBatPosition,
                            recoveryCanonicalBatRotation,
                            canonicalFootwork);
                        recoveryCanonicalBatCaptured = true;
                    }
                    if (recoveryCanonicalBatCaptured)
                    {
                        // An early (post-follow-through) recovery keeps its own clock from where it began.
                        var recoveryClock = earlyRecoveryBegun && playback != null
                            ? playback.Time - earlyRecoveryStartT + recoveryElapsed
                            : recoveryElapsed;
                        var recoveryProgress = DeadBallRecoverySeconds <= 0.0
                            ? 1f
                            : Mathf.SmoothStep(0f, 1f,
                                Mathf.Clamp01((float)(recoveryClock / DeadBallRecoverySeconds)));
                        batterRig.ApplyBatterDeadBallRecovery(
                            recoveryCanonicalBatPosition,
                            recoveryCanonicalBatRotation,
                            canonicalFootwork,
                            recoveryProgress);
                    }
                    if (recoveryElapsed >= DeadBallRecoverySeconds)
                    {
                        SetQuiet(false);
                        state = WorldState.Outcome;
                        outcomeElapsed = 0.0;
                    }
                }
                else if (state == WorldState.Outcome)
                {
                    outcomeElapsed += deltaSeconds;
                    if (outcomeElapsed >= OutcomeHoldSeconds && !completionReported)
                    {
                        completionReported = true;
                        state = WorldState.Idle;
                        DeliveryCompleted?.Invoke(playback.Time, replayDigest);
                        ApplyPendingProfile();
                    }
                }

                PresentBatters(deltaSeconds);
                FinishNonStrikerFrame((float)deltaSeconds);
                PlantStrikerOnPhysicsPads((float)deltaSeconds);
                FinishStrikerFrame((float)deltaSeconds);
                PresentFieldersAmbient(deltaSeconds);
                if (state == WorldState.Recovery || state == WorldState.Outcome) PresentBowlerWalkBack(deltaSeconds);
                ApplyFootLocks((float)deltaSeconds);
                UpdateCamera((float)deltaSeconds);
                ApplyHorizontalFieldOfView();
                UpdateBallReadabilityProjection();
                // The inset is a view of this completed presentation frame. Updating it before the run-up,
                // gait, fielding and foot-lock steps left the bowler and other moving actors one frame behind.
                UpdateFieldPip();
            }
        }

        /// <summary>
        /// Holds every planted foot of the fielders, the keeper and (after his release) the bowler, after the frame's
        /// poses are final; a held foot re-steps, lifted, once its clip has drifted about 8 cm (ProductionFootLock).
        /// </summary>
        private void ApplyFootLocks(float deltaSeconds)
        {
            foreach (var rig in rigByRoot.Values) ApplyFootLock(rig, deltaSeconds);
            // The batters on the gait (running between the wickets, walking back): planted feet held too (the
            // thin-edge striker's ankle slid 10.9 cm as he pulled up after his runs, UNITY-2 r3).
            ProductionFootLock idle;
            if (batterRig != null && (strikerRunning || state == WorldState.Idle)) ApplyFootLock(batterRig, deltaSeconds);
            else if (batterRig != null && footLocks.TryGetValue(batterRig, out idle)) idle.Reset();
            if (nonStrikerRig != null && !nonStrikerPackActive) ApplyFootLock(nonStrikerRig, deltaSeconds);
            else if (nonStrikerRig != null && footLocks.TryGetValue(nonStrikerRig, out idle)) idle.Reset();
            if (bowlerRig == null) return;
            if (state == WorldState.RunUp)
            {
                ProductionFootLock bowlerLock;
                if (footLocks.TryGetValue(bowlerRig, out bowlerLock)) bowlerLock.Reset();
                return;
            }
            ApplyFootLock(bowlerRig, deltaSeconds);
        }

        private void ApplyFootLock(ProductionCharacterRig rig, float deltaSeconds)
        {
            if (rig == null || rig.Root == null || !rig.Root.gameObject.activeInHierarchy) return;
            ProductionFootLock footLock;
            if (!footLocks.TryGetValue(rig, out footLock) || footLock.Rig != rig)
            {
                footLock = new ProductionFootLock(rig);
                footLocks[rig] = footLock;
            }
            footLock.Apply(deltaSeconds);
        }

        private void ResetFootLocks()
        {
            foreach (var footLock in footLocks.Values) footLock.Reset();
            strikerFootLock?.Reset();
        }

        private Vector3 PhysicsGround(float x, float z) => new Vector3(PresentationMirror * x, 0f, z);

        private Vector3 NonStrikerHome() =>
            PhysicsGround(nonStrikerSide * NonStrikerWaitLateral, NonStrikerCreaseZ - NonStrikerWaitBehindCrease);

        private static float NonStrikerHeading() => 0f;

        /// <summary>
        /// The non-striker waits behind his crease, backs up around release, and both batters run exactly the physics
        /// runs (ProductionRunningBetweenWickets) on opposite sides of the pitch, then walk back between balls.
        /// </summary>
        // HUM U1/U2/U11/U12: fielders, keeper and bowler between and around the physics paths.
        private readonly Dictionary<string, ProductionGaitPresenter> fielderGaits =
            new Dictionary<string, ProductionGaitPresenter>(StringComparer.Ordinal);
        private readonly Dictionary<string, Vector3> fielderWalkInStart = new Dictionary<string, Vector3>(StringComparer.Ordinal);
        private readonly Dictionary<string, double> fielderWalkInStartT = new Dictionary<string, double>(StringComparer.Ordinal);
        private readonly HashSet<string> fielderAmbientHanded = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> pathedFielderIds = new HashSet<string>(StringComparer.Ordinal);
        private ProductionGaitPresenter bowlerGait;
        private bool bowlerAmbientHanded;
        private int bowlerRelocations;
        private const float WalkInMetres = 1.8f;
        private const float WalkInMetresPerSecond = 1.3f;
        private const float FielderWalkBackMetresPerSecond = 1.4f;
        private const float BowlerWalkBackMetresPerSecond = 1.6f;

        private Vector3 FielderSpotWorld(string id)
        {
            var spot = fielderScenePositionById[id];
            return new Vector3(PresentationMirror * spot.x, 0f, spot.z);
        }

        private float FielderReadyHeadingDegrees(string id, string role)
        {
            if (role == "keeper") return ProductionFieldingPlanner.KeeperHeading * Mathf.Rad2Deg;
            var spot = FielderSpotWorld(id);
            return ProductionFieldingPlanner.HeadingOf(
                strikerPresentationReference.x - spot.x, strikerPresentationReference.z - spot.z) * Mathf.Rad2Deg;
        }

        /// <summary>Where a fielder waits between balls: a short walk-in behind his spot (the keeper on his spot).</summary>
        private Vector3 FielderWaitingSpot(string id, string role)
        {
            var spot = FielderSpotWorld(id);
            if (role == "keeper") return spot;
            var towardsStriker = strikerPresentationReference - spot;
            towardsStriker.y = 0f;
            return towardsStriker.sqrMagnitude < 1e-4f ? spot : spot - towardsStriker.normalized * WalkInMetres;
        }

        /// <summary>
        /// Presentation for every fielder and the keeper that no physics path is driving at this instant: the walk-in
        /// during the run-up arrives exactly on the scene spot at release (the physics start), the ready stance
        /// breathes until the ball is live for them, and after the dead ball they walk back to their waiting spot.
        /// </summary>
        private void PresentFieldersAmbient(double deltaSeconds)
        {
            var dt = (float)Math.Max(1e-4, deltaSeconds);
            var live = state == WorldState.Resolved;
            var after = state == WorldState.Recovery || state == WorldState.Outcome || state == WorldState.Idle;
            foreach (var pair in fielderRoleById)
            {
                var id = pair.Key;
                var role = pair.Value;
                if (role == "bowler") continue;
                GameObject fielder;
                ProductionCharacterRig rig;
                if (!fielderById.TryGetValue(id, out fielder) || !fielder.activeSelf ||
                    !rigByRoot.TryGetValue(fielder, out rig)) continue;
                if (live && (pathedFielderIds.Contains(id) || fieldingTracks.ContainsKey(id))) continue;
                ProductionGaitPresenter gait;
                if (!fielderGaits.TryGetValue(id, out gait))
                {
                    gait = new ProductionGaitPresenter(rig);
                    gait.Snap(fielder.transform.position, FielderReadyHeadingDegrees(id, role));
                    fielderGaits[id] = gait;
                }
                var spot = FielderSpotWorld(id);
                var heading = FielderReadyHeadingDegrees(id, role);
                var keeper = role == "keeper";
                if (after)
                {
                    // The hand-over frame (the dead ball's) holds the physics position; the walk back starts on the next.
                    var handOver = !fielderAmbientHanded.Contains(id);
                    if (handOver)
                    {
                        fielderAmbientHanded.Add(id);
                        gait.BlendFromCurrent(0.35f);
                    }
                    var target = handOver
                        ? gait.Position
                        : Vector3.MoveTowards(gait.Position, FielderWaitingSpot(id, role),
                            FielderWalkBackMetresPerSecond * dt);
                    gait.Present(target, heading, dt, ProductionFieldingClip.Idle, 0.5f);
                    continue;
                }
                if (state == WorldState.RunUp || state == WorldState.Flight || live)
                {
                    Vector3 start;
                    double startT;
                    if (!fielderWalkInStart.TryGetValue(id, out start))
                    {
                        start = gait.Position;
                        var duration = Math.Min(Math.Max(0.6, (start - spot).magnitude / WalkInMetresPerSecond),
                            Math.Max(0.6, -timeline));
                        startT = -duration;
                        fielderWalkInStart[id] = start;
                        fielderWalkInStartT[id] = startT;
                    }
                    else startT = fielderWalkInStartT[id];
                    var tau = startT >= 0.0 ? 1f : Mathf.Clamp01((float)((timeline - startT) / -startT));
                    var eased = tau * tau * (3f - 2f * tau);
                    var position = Vector3.Lerp(start, spot, eased);
                    var crouch = keeper && timeline >= -0.6;
                    gait.Present(position, heading, dt,
                        crouch ? ProductionFieldingClip.KeepCrouch : keeper ? ProductionFieldingClip.Idle : ProductionFieldingClip.Ready,
                        0.5f, tau < 1f);
                }
            }
        }

        /// <summary>After his part in the ball the bowler walks back towards his mark.</summary>
        private void PresentBowlerWalkBack(double deltaSeconds)
        {
            if (bowlerRig == null || bowler == null) return;
            if (bowlerGait == null || bowlerGait.Rig != bowlerRig) bowlerGait = new ProductionGaitPresenter(bowlerRig);
            // As for every fielder (HUM U1): the hand-over frame, the dead ball's, holds the physics position; the walk
            // back starts on the next frame (it used to walk the whole dead-ball frame's delta from the physics spot).
            var handOver = !bowlerAmbientHanded;
            if (handOver)
            {
                bowlerAmbientHanded = true;
                bowlerGait.BlendFromCurrent(0.35f);
            }
            var dt = (float)Math.Max(1e-4, deltaSeconds);
            var target = handOver
                ? bowlerGait.Position
                : Vector3.MoveTowards(bowlerGait.Position, bowlerStartPosition, BowlerWalkBackMetresPerSecond * dt);
            bowlerGait.Present(target, 0f, dt, ProductionFieldingClip.Idle, 0.5f);
        }

        private bool LoadNonStrikerPack()
        {
            if (nonStrikerPackLoaded) return nsStance != null;
            nonStrikerPackLoaded = true;
            var stance = ProductionMotionPacks.Clip("nonstriker", "ns_stance");
            var backup = ProductionMotionPacks.Clip("nonstriker", "ns_backup");
            var ready = ProductionMotionPacks.Clip("nonstriker", "ns_ready");
            var walk = ProductionMotionPacks.Clip("nonstriker", "ns_walk_back");
            if (stance == null || backup == null || ready == null || walk == null) return false;
            nsStance = stance;
            nsBackup = backup;
            nsReady = ready;
            nsWalkBack = walk;
            nonStrikerPackPose = new ProductionPackPose(ProductionMotionPacks.Get("nonstriker").MaxTrackCount);
            return true;
        }

        /// <summary>The clip origin: 1.0 m behind his popping crease, on his side, facing down the pitch (+z).</summary>
        private Vector3 NonStrikerClipOrigin() =>
            PhysicsGround(nonStrikerSide * NonStrikerWaitLateral, NonStrikerCreaseZ - 1.0f);

        /// <summary>Poses the non-striker from one pack clip at local time t, its ground placed from origin.</summary>
        private void PresentNonStrikerClip(VmpClip clip, double t, Vector3 origin, Vector3 offset)
        {
            var leftHander = settings != null && settings.Handedness == "left";
            nonStrikerPackPose.SampleInto(clip, t, leftHander);
            var root = nonStrikerRig.Root;
            var scale = root.localScale.x;
            var ground = nonStrikerPackPose.Ground * scale;
            root.SetPositionAndRotation(origin + offset + new Vector3(ground.x, 0f, ground.z),
                Quaternion.AngleAxis(nonStrikerPackPose.GroundYawDegrees, Vector3.up));
            nonStrikerRig.BatterOneHandCarry = true;
            nonStrikerRig.ResetBatToCharacterGrip();
            nonStrikerRig.ApplyPose(nonStrikerPackPose.Pose);
            Vector3 cap, toe, face;
            if (nonStrikerPackPose.TryGetBatCapToe((float)BridgeConstants.CanonicalBatLengthMetres, out cap, out toe, out face))
            {
                nonStrikerRig.SetCanonicalBatPose(root.TransformPoint(cap), root.TransformPoint(toe),
                    face.sqrMagnitude > 1e-6f ? root.TransformDirection(face) : Vector3.zero, 1f, false, false);
            }
            nonStrikerPackActive = true;
        }

        /// <summary>
        /// The non-striker from the pack while no run is on (returns false when the pack is not shipped, or when the
        /// gait presenter must take him: running between the wickets).
        /// </summary>
        private bool PresentNonStrikerPack(double deltaSeconds)
        {
            if (nonStrikerRig == null || !LoadNonStrikerPack()) return false;
            if (strikerRunning || runningPlan.Runs > 0 && state == WorldState.Resolved) return false;
            nonStrikerClock += deltaSeconds;
            var origin = NonStrikerClipOrigin();
            float release;
            if (!nsBackup.TryGetMarker("release", out release)) release = 1.6f;
            var delivering = state == WorldState.RunUp || state == WorldState.Flight || state == WorldState.Resolved;
            if (delivering)
            {
                nonStrikerWalkBackElapsed = -1.0;
                var local = timeline + release;
                if (local < 0.0) PresentNonStrikerClip(nsStance, nonStrikerClock, origin, Vector3.zero);
                else if (local < release) PresentNonStrikerClip(nsBackup, local, origin, Vector3.zero);
                else
                {
                    // From the release the web walks him on (nonStriker.ts NS_WALK_ON): the gait presenter takes him
                    // from the clip's state at its release marker (PresentBatters), at the clip's own speed there.
                    if (!nonStrikerWalkOnStarted)
                    {
                        nonStrikerWalkOnStarted = true;
                        nonStrikerWalkOnStartT = timeline;
                        nonStrikerWalkOnSpeed = NonStrikerBackupSpeedAt(release);
                    }
                    return false;
                }
                return true;
            }
            // After the dead ball: the walk back, placed so it ends grounded at the crease where he started; the gap from
            // where the backing-up left him closes over its first 0.9 s (no jump).
            if (nonStrikerWalkBackElapsed < 0.0)
            {
                if (!nonStrikerPackWasDelivering) return false;
                nonStrikerWalkBackElapsed = 0.0;
                nonStrikerPackPose.SampleInto(nsWalkBack, nsWalkBack.Duration, settings != null && settings.Handedness == "left");
                var travel = nonStrikerPackPose.Ground * nonStrikerRig.Root.localScale.x;
                var start = origin - new Vector3(travel.x, 0f, travel.z);
                nonStrikerWalkBackGap = new Vector3(nonStrikerRig.Root.position.x - start.x, 0f,
                    nonStrikerRig.Root.position.z - start.z);
            }
            else nonStrikerWalkBackElapsed += deltaSeconds;
            if (nonStrikerWalkBackElapsed < nsWalkBack.Duration)
            {
                var u = Mathf.Clamp01((float)(nonStrikerWalkBackElapsed / 0.9));
                var fade = 1f - u * u * (3f - 2f * u);
                nonStrikerPackPose.SampleInto(nsWalkBack, nsWalkBack.Duration, settings != null && settings.Handedness == "left");
                var travel = nonStrikerPackPose.Ground * nonStrikerRig.Root.localScale.x;
                var start = origin - new Vector3(travel.x, 0f, travel.z);
                PresentNonStrikerClip(nsWalkBack, nonStrikerWalkBackElapsed, start, nonStrikerWalkBackGap * fade);
            }
            else PresentNonStrikerClip(nsStance, nonStrikerClock, origin, Vector3.zero);
            return true;
        }

        private void PresentBatters(double deltaSeconds)
        {
            if (nonStrikerGait == null || strikerGait == null) return;
            var dt = (float)Math.Max(1e-4, deltaSeconds);
            // A batter on a locomotion cycle carries the bat in his bottom hand. Re-solving the free arm back onto
            // the handle on every gait frame made both arms cross a straight-arm IK singularity and produced repeated
            // 40-50 degree jumps. Restore the normal two-hand contract automatically when the striker is not running.
            if (batterRig != null) batterRig.BatterOneHandCarry = strikerRunning;
            if (nonStrikerRig != null) nonStrikerRig.BatterOneHandCarry = true;
            var packWasActive = nonStrikerPackActive;
            nonStrikerPackActive = false;
            var delivering = state == WorldState.RunUp || state == WorldState.Flight || state == WorldState.Resolved;
            if (PresentNonStrikerPack(deltaSeconds))
            {
                // (The striker is never running here: a run hands both batters to the gait presenter.)
                nonStrikerPackWasDelivering = delivering || nonStrikerPackWasDelivering && nonStrikerWalkBackElapsed >= 0.0;
                return;
            }
            if (packWasActive && nonStrikerRig != null)
            {
                // The gait takes him from wherever the pack left him (running, or no pack), without a pop, and keeps
                // his walking-on speed (ns_backup moves at about 0.5 m/s), easing it out instead of stopping dead.
                nonStrikerRig.BatterOneHandCarry = true;
                nonStrikerGait.BlendFromCurrent(0.25f);
                nonStrikerHandOverSpeed = NonStrikerWalkOnMetresPerSecond;
                nonStrikerHandedOverFromPack = true;
            }
            var home = NonStrikerHome();
            var traceTime = playback != null ? playback.Time : timeline;
            var forward = new Vector3(0f, 0f, 1f);
            if (runningPlan.Runs > 0 && strikerRunning && state == WorldState.Resolved)
            {
                // Live ball: both batters are where the physics running puts them (after the last run, at their ends).
                nonStrikerGait.Present(RunnerPosition(true, traceTime), NonStrikerHeading(), dt,
                    ProductionFieldingClip.Ready);
                strikerGait.Present(RunnerPosition(false, traceTime), 180f, dt, ProductionFieldingClip.Ready);
                return;
            }
            if (state == WorldState.RunUp || state == WorldState.Flight ||
                (state == WorldState.Resolved && !strikerRunning))
            {
                if (nonStrikerHandedOverFromPack)
                {
                    if (!nonStrikerWalkOnStarted && timeline >= 0.0)
                    {
                        // Handed over after the release (a result with runs takes him from the pack at acceptance):
                        // walk on from the speed he has.
                        nonStrikerWalkOnStarted = true;
                        nonStrikerWalkOnStartT = timeline;
                        nonStrikerWalkOnSpeed = nonStrikerHandOverSpeed;
                    }
                    if (nonStrikerWalkOnStarted)
                    {
                        // NS_WALK_ON from where the backing-up clip released him, along the pitch (+z).
                        if (!nonStrikerWalkOnPlaced)
                        {
                            nonStrikerWalkOnPlaced = true;
                            nonStrikerWalkOnFrom = nonStrikerGait.Position;
                        }
                        float speed;
                        var distance = NonStrikerWalkOnDistance((float)(timeline - nonStrikerWalkOnStartT),
                            nonStrikerWalkOnSpeed, nonStrikerWalkOnFrom.z, out speed);
                        nonStrikerHandOverSpeed = speed;
                        nonStrikerGait.Present(nonStrikerWalkOnFrom + forward * distance, NonStrikerHeading(), dt,
                            ProductionFieldingClip.Ready);
                        return;
                    }
                    // Taken over from the pack before a run: carry on from where he is at his walking-on speed, easing
                    // to a stop (0.8 m/s^2), never jumping back onto the code-authored backing-up line.
                    nonStrikerHandOverSpeed = Mathf.Max(0f, nonStrikerHandOverSpeed - 0.8f * dt);
                    nonStrikerGait.Present(nonStrikerGait.Position + forward * (nonStrikerHandOverSpeed * dt),
                        NonStrikerHeading(), dt, ProductionFieldingClip.Ready);
                    return;
                }
                // Backing up: within the crease until the bowler lets go, then about 1.3 m down the pitch.
                var u = Mathf.Clamp01((float)((timeline + 0.45) / 1.0));
                var eased = u * u * (3f - 2f * u);
                nonStrikerGait.Present(home + forward * (BackingUpMetres * eased), NonStrikerHeading(), dt,
                    ProductionFieldingClip.Idle, 0.55f);
                return;
            }
            // After the ball: walk back.
            var nonStrikerTarget = Vector3.MoveTowards(nonStrikerGait.Position, home, WalkBackMetresPerSecond * dt);
            nonStrikerGait.Present(nonStrikerTarget, NonStrikerHeading(), dt, ProductionFieldingClip.Idle, 0.55f);
            if (strikerRunning)
            {
                var strikerTarget = Vector3.MoveTowards(strikerGait.Position, nominalBatterWorldPosition,
                    WalkBackMetresPerSecond * dt);
                strikerGait.Present(strikerTarget, 180f, dt, ProductionFieldingClip.Idle, 0.55f);
            }
        }

        private bool nonStrikerTransitionActive;
        private float nonStrikerTransitionElapsed;
        private bool nonStrikerSourceCaptured;
        private bool nonStrikerPackShownWas;
        private const float NonStrikerTransitionSeconds = 0.25f;

        /// <summary>
        /// The non-striker's gait-to-pack hand-over (the walk back after the walk-on, a pack clip after a run): the
        /// visible hero leaves its last displayed pose inertially, as the striker's does (FinishStrikerFrame).
        /// </summary>
        private void FinishNonStrikerFrame(float deltaSeconds)
        {
            if (nonStrikerRig == null) return;
            var packNow = nonStrikerPackActive;
            if (packNow != nonStrikerPackShownWas && nonStrikerSourceCaptured)
            {
                nonStrikerTransitionActive = true;
                nonStrikerTransitionElapsed = 0f;
            }
            if (nonStrikerTransitionActive)
            {
                nonStrikerTransitionElapsed += Mathf.Max(0f, deltaSeconds);
                var omega = 5.8f / NonStrikerTransitionSeconds;
                var x = omega * nonStrikerTransitionElapsed;
                var weight = nonStrikerTransitionElapsed >= NonStrikerTransitionSeconds ? 1f : 1f - (1f + x) * Mathf.Exp(-x);
                nonStrikerRig.ApplyHeroTransitionBlend(weight);
                if (weight < 1f)
                    nonStrikerRig.ApplyHeroBatterGripIkNow(
                        1f, keepCurrentElbowPlanes: true, transitionWeight: weight);
                if (weight >= 1f) nonStrikerTransitionActive = false;
            }
            if (!nonStrikerTransitionActive)
            {
                nonStrikerRig.CaptureHeroTransitionSource();
                nonStrikerSourceCaptured = true;
            }
            nonStrikerPackShownWas = packNow;
        }

        /// <summary>The backing-up clip's ground speed (m/s, scaled) at clip time t.</summary>
        private float NonStrikerBackupSpeedAt(float t)
        {
            var leftHander = settings != null && settings.Handedness == "left";
            var scale = nonStrikerRig != null ? nonStrikerRig.Root.localScale.x : 1f;
            nonStrikerPackPose.SampleInto(nsBackup, Math.Max(0.0, t - 0.02), leftHander);
            var a = nonStrikerPackPose.Ground;
            nonStrikerPackPose.SampleInto(nsBackup, Math.Min(nsBackup.Duration, t + 0.02), leftHander);
            var b = nonStrikerPackPose.Ground;
            var dx = b.x - a.x;
            var dz = b.z - a.z;
            return Mathf.Sqrt(dx * dx + dz * dz) / 0.04f * scale;
        }

        /// <summary>
        /// NS_WALK_ON (nonStriker.ts walkOnMoves): the distance (m) walked on `tau` s after the release from speed v0,
        /// starting at z0 (Unity world, the pitch runs +z towards the striker), and the speed then. Piecewise-linear
        /// speed, so the distance is continuous with a continuous speed.
        /// </summary>
        internal static float NonStrikerWalkOnDistance(float tau, float v0, float z0, out float speed)
        {
            var segs = new[]
            {
                new Vector3(NsAccelSeconds, v0, NsWalkTopMps),
                new Vector3(NsJogSeconds, NsWalkTopMps, NsPeakMps),
                new Vector3(NsHoldSeconds, NsPeakMps, NsWalkTopMps),
                Vector3.zero
            };
            var run = 0f;
            for (var i = 0; i < 3; i++) run += (segs[i].y + segs[i].z) * 0.5f * segs[i].x;
            var left = Mathf.Max(0.3f, NonStrikerCreaseZ + NsStopOutMetres - z0 - run);
            segs[3] = new Vector3(2f * left / NsWalkTopMps, NsWalkTopMps, 0f);
            var distance = 0f;
            var t = Mathf.Max(0f, tau);
            for (var i = 0; i < segs.Length; i++)
            {
                var g = segs[i];
                if (t <= g.x)
                {
                    var u = g.x > 0f ? t / g.x : 1f;
                    speed = g.y + (g.z - g.y) * u;
                    return distance + (g.y + speed) * 0.5f * t;
                }
                distance += (g.y + g.z) * 0.5f * g.x;
                t -= g.x;
            }
            speed = 0f;
            return distance;
        }

        /// <summary>A runner's ground position: from where he set off, to the turn short of the far crease, and back.</summary>
        private Vector3 RunnerPosition(bool nonStriker, double t)
        {
            double speed;
            bool running;
            var progress = (float)runningPlan.Progress(t, out speed, out running);
            var lane = (nonStriker ? nonStrikerSide : -nonStrikerSide) * RunLaneX;
            var nearZ = nonStriker ? -RunTurnZ : RunTurnZ;
            var farZ = -nearZ;
            var start = nonStriker ? nonStrikerRunStart : strikerRunStart;
            var laneStart = PhysicsGround(lane, nearZ);
            var near = new Vector3(laneStart.x, 0f, nearZ);
            var far = new Vector3(laneStart.x, 0f, farZ);
            // The first leg starts from wherever the batter actually was and joins the lane over its first 4 metres.
            if (t <= runningPlan.RunEndT(0))
            {
                var tau = Math.Max(0.0, t - runningPlan.RunStartT(0));
                var covered = (float)(ProductionRunningBetweenWickets.DistanceAt(tau) / ProductionRunningBetweenWickets.RunMetres);
                if (nonStriker && nonStrikerRunStartSpeed > 0f)
                {
                    // Speed-matched (nonStriker.ts sprintProfile u0): the walking-on speed carries into the sprint
                    // instead of a dead start; the extra distance fades to nothing (in place and in speed) by the
                    // physics completion of the first run.
                    var legT = Math.Max(1e-3, runningPlan.RunEndT(0) - runningPlan.RunStartT(0));
                    var legU = Math.Min(1.0, tau / legT);
                    var legMetres = Mathf.Max(1f, Mathf.Abs(farZ - start.z));
                    covered = Mathf.Min(1f,
                        covered + (float)(nonStrikerRunStartSpeed * tau * (1.0 - legU) * (1.0 - legU)) / legMetres);
                }
                var z = Mathf.Lerp(start.z, farZ, covered);
                var x = Mathf.Lerp(start.x, laneStart.x, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(covered * 4f)));
                return new Vector3(x, 0f, z);
            }
            return Vector3.Lerp(near, far, progress);
        }

        private struct HeldBallWindow
        {
            public string FielderId;
            public double TakeT;
            public double ReleaseT; // +infinity: held to the end of the trace (a catch, a keeper take, a run-in)
            public bool Keeper;
            public bool Throw; // false: held until the ball moves off again (a celebration toss) or the trace ends
            public Vector3 ReleasePoint; // the throw event's physics position
            public ProductionCharacterRig.PalmReachResidual Residual; // UNITY-9: the offset the release left, taken on the first frame from the release
            public double ReleaseGapDt; // |t - ReleaseT| of the frame the gap below was measured on
            public float ReleaseGapMetres; // hand to the physics release point, on the frame nearest the release
        }

        /// <summary>The take-to-release windows from the trace events (field/catch/keeper_take, then throw).</summary>
        private void BuildHeldBallWindows(CanonicalDeliveryTrace trace)
        {
            heldBallWindows.Clear();
            heldBallReleaseHandGaps.Clear();
            if (trace == null || trace.events == null) return;
            string keeperId = null;
            foreach (var pair in fielderRoleById)
                if (pair.Value == "keeper") keeperId = pair.Key;
            for (var index = 0; index < trace.events.Length; index++)
            {
                var item = trace.events[index];
                if (item == null) continue;
                var keeperTake = item.kind == "keeper_take";
                if (item.kind != "field" && item.kind != "catch" && !keeperTake) continue;
                // A keeper_take with shortM: the ball passed beyond his reach and is never in his gloves.
                if (keeperTake && item.shortM > 0.0) continue;
                var id = keeperTake ? keeperId : item.fielderId;
                if (string.IsNullOrEmpty(id)) continue;
                var release = double.PositiveInfinity;
                var releasePoint = Vector3.zero;
                for (var next = index + 1; next < trace.events.Length; next++)
                {
                    var later = trace.events[next];
                    if (later != null && later.kind == "throw" && later.fielderId == id && later.t >= item.t)
                    {
                        release = later.t;
                        if (later.p != null) releasePoint = ToUnity(later.p);
                        break;
                    }
                }
                var isThrow = !double.IsInfinity(release);
                if (!isThrow && trace.ball != null)
                {
                    // No throw: held until the ball moves more than 0.3 m from where it was taken (web rule).
                    TraceVector3 at = null;
                    for (var sample = 0; sample < trace.ball.Length && at == null; sample++)
                        if (trace.ball[sample] != null && trace.ball[sample].t >= item.t) at = trace.ball[sample].p;
                    if (at != null)
                    {
                        for (var sample = 0; sample < trace.ball.Length; sample++)
                        {
                            var b = trace.ball[sample];
                            if (b == null || b.p == null || b.t <= item.t + 0.05) continue;
                            var dx = b.p.x - at.x;
                            var dy = b.p.y - at.y;
                            var dz = b.p.z - at.z;
                            if (Math.Sqrt(dx * dx + dy * dy + dz * dz) > 0.3)
                            {
                                release = b.t - 0.02;
                                break;
                            }
                        }
                    }
                }
                heldBallWindows.Add(new HeldBallWindow
                {
                    FielderId = id,
                    TakeT = item.t,
                    ReleaseT = release,
                    Keeper = id == keeperId,
                    Throw = isThrow,
                    ReleasePoint = releasePoint,
                    ReleaseGapDt = double.PositiveInfinity,
                    ReleaseGapMetres = float.NaN
                });
            }
        }

        private static float SmoothUnit(double value)
        {
            var x = (float)Math.Max(0.0, Math.Min(1.0, value));
            return x * x * (3f - 2f * x);
        }

        /// <summary>
        /// The palm the held ball sits in: a fielder's throwing hand (the rig's release hand), the keeper's two gloves.
        /// The palm centre is 6.5 cm along the wrist from the wrist joint (MOTION-SPEC hand points).
        /// </summary>
        internal static Vector3 HeldBallPalm(ProductionCharacterRig rig, bool keeper)
        {
            Func<ProductionCharacterJoint, ProductionCharacterJoint, Vector3> palm = (forearm, hand) =>
            {
                var wrist = rig.VisibleJointWorldPosition(hand);
                var along = wrist - rig.VisibleJointWorldPosition(forearm);
                return along.sqrMagnitude > 1e-6f ? wrist + along.normalized * PalmAlongWristMetres : wrist;
            };
            var left = palm(ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft);
            var right = palm(ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight);
            if (keeper) return (left + right) * 0.5f;
            return rig.Handedness == ProductionCharacterHandedness.Right ? right : left;
        }

        // Lead ruling (held ball): the thrower's hand reaches the physics release point at the release (<= 10 cm).
        private const double ThrowReachSeconds = 0.25;

        /// <summary>Builder seam (UNITY-9 A/B in one build): false skips the throwing hand's reach onto the physics release point, as if no throw had a release to meet.</summary>
        internal bool ThrowReachEnabled { get; set; } = true;

        /// <summary>Builder seam (UNITY-9 A/B in one build): false pulls the palm back to the fixed release point after the release too (the old reach; the elbow flickered).</summary>
        internal bool ThrowReachFollowsThrough { get; set; } = true;

        /// <summary>Builder seam (UNITY-9 A/B in one build): false is the straight-line reach with the elbow plane taken again from each pass's half-solved arm and the trunk's step at the threshold (the old reach).</summary>
        internal bool ThrowReachStablePole { get; set; } = true;

        /// <summary>
        /// Around each physics throw the thrower's throwing palm is reached onto the physics release point (arm IK,
        /// smoothstep in over ThrowReachSeconds before the release and out over the same after), so the held ball
        /// leaves the hand where the physics flight begins.
        /// </summary>
        private void ReachThrowsToRelease(double t)
        {
            if (!ThrowReachEnabled) return;
            for (var index = 0; index < heldBallWindows.Count; index++)
            {
                var window = heldBallWindows[index];
                if (!window.Throw || window.Keeper) continue;
                var fromRelease = t - window.ReleaseT;
                if (Math.Abs(fromRelease) >= ThrowReachSeconds) continue;
                GameObject holder;
                if (!fielderById.TryGetValue(window.FielderId, out holder) || holder == null) continue;
                ProductionCharacterRig rig = holder == bowler ? bowlerRig : null;
                if (rig == null && !rigByRoot.TryGetValue(holder, out rig)) continue;
                if (rig == null) continue;
                var weight = 1f - Mathf.Clamp01((float)(Math.Abs(fromRelease) / ThrowReachSeconds));
                weight = weight * weight * (3f - 2f * weight);
                var left = rig.Handedness == ProductionCharacterHandedness.Left;
                if (ThrowReachFollowsThrough && fromRelease >= 0.0)
                {
                    // UNITY-9: after the release the hand carries on with the follow-through the clip draws, and only the offset the release left
                    // fades out (taken on the first frame from the release, where the goal is the release point exactly). Pulling the palm back to
                    // the fixed release point instead dragged the goal through the shoulder's neighbourhood and the arm's elbow flickered 130 to
                    // 160 degrees a frame for five frames (the defensive-tap bowler's throw, release + 53 to 119 ms).
                    var residual = window.Residual;
                    rig.ReachPalmFollowing(left, window.ReleasePoint, weight, ref residual);
                    window.Residual = residual;
                    heldBallWindows[index] = window;
                }
                else rig.ReachPalmTo(left, window.ReleasePoint, weight, ThrowReachStablePole);
            }
        }

        private void ApplyHeldBall(double t)
        {
            ReachThrowsToRelease(t);
            if (ball == null || heldBallWindows.Count == 0 || !ball.GameObject.activeSelf) return;
            for (var index = 0; index < heldBallWindows.Count; index++)
            {
                var window = heldBallWindows[index];
                if (t <= window.TakeT) continue;
                GameObject holder;
                if (!fielderById.TryGetValue(window.FielderId, out holder) || holder == null) continue;
                ProductionCharacterRig rig = holder == bowler ? bowlerRig : null;
                if (rig == null && !rigByRoot.TryGetValue(holder, out rig)) continue;
                if (rig == null) continue;
                var physics = ball.GameObject.transform.position;
                var hand = HeldBallPalm(rig, window.Keeper);
                var fromRelease = Math.Abs(t - window.ReleaseT);
                if (window.Throw && fromRelease < 0.05 && fromRelease < window.ReleaseGapDt)
                {
                    // Evidence: the hand against the physics release point, on the frame nearest the release.
                    window.ReleaseGapDt = fromRelease;
                    window.ReleaseGapMetres = Vector3.Distance(hand, window.ReleasePoint);
                    heldBallWindows[index] = window;
                }
                if (t >= window.ReleaseT) continue;
                var weight = SmoothUnit((t - window.TakeT) / HeldBallBlendInSeconds);
                if (!double.IsInfinity(window.ReleaseT))
                    weight *= 1f - SmoothUnit((t - (window.ReleaseT - HeldBallBlendOutSeconds)) / HeldBallBlendOutSeconds);
                ball.GameObject.transform.position = Vector3.LerpUnclamped(physics, hand, weight);
                return;
            }
        }

        /// <summary>Per throw: the hand's distance from the physics release point on the frame nearest the release.</summary>
        internal List<float> HeldBallReleaseHandGapsForEvidence()
        {
            heldBallReleaseHandGaps.Clear();
            for (var index = 0; index < heldBallWindows.Count; index++)
                if (heldBallWindows[index].Throw)
                    heldBallReleaseHandGaps.Add(heldBallWindows[index].ReleaseGapMetres);
            return heldBallReleaseHandGaps;
        }

        internal Transform BallForEvidence => ball != null ? ball.GameObject.transform : null;
        internal ProductionDeliveryEffects DeliveryEffectsForEvidence => deliveryEffects;

        /// <summary>The delivery's own flight line at simulation time t (what the drawn ball followed before UNITY-7 held it back; evidence).</summary>
        internal Vector3 FlightBallForEvidence(double t)
        {
            Vector3 position;
            return FlightBallAt(t, out position) ? position : Vector3.zero;
        }

        internal bool HeldBallActiveForEvidence(double t)
        {
            for (var index = 0; index < heldBallWindows.Count; index++)
                if (t > heldBallWindows[index].TakeT && t < heldBallWindows[index].ReleaseT) return true;
            return false;
        }

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-7 task A): false keeps the pre-UNITY-7 drawing of a result that has not arrived
        /// (the ball keeps the delivery's pre-contact line through the bat and, once the flight data is used up, hangs frozen at
        /// its last sample); true (the default) draws no ball, trail, shadow or glow from the moment the pre-contact ball
        /// reaches the bat until the result is accepted.
        /// </summary>
        internal bool PendingBallHidden { get; set; } = true;

        /// <summary>True while the world holds the drawn ball back because the physics has not produced its position yet.</summary>
        internal bool BallHeldPendingForEvidence => state == WorldState.Flight && ball != null && !ball.GameObject.activeSelf;

        private PracticeSwingPresentation ballAtBatSwing;
        private PracticeDeliveryPresentation ballAtBatDelivery;
        private string ballAtBatFootwork;
        private double ballAtBatT = double.PositiveInfinity;

        /// <summary>
        /// When a committed swing's ball reaches the bat: the ball's ideal arrival at the contact plane of the footwork the swing
        /// plays (the physics' own reference, src/physics/bat.ts idealTimeFor, as the stride is timed), +Infinity when the
        /// delivery carries no usable ideal contact time. A hit's contact falls within a frame of it.
        /// </summary>
        private double CommittedBallAtBatT()
        {
            var footwork = string.IsNullOrEmpty(provisionalSwing.Footwork) ? "auto" : provisionalSwing.Footwork;
            if (ReferenceEquals(ballAtBatSwing, provisionalSwing) && ReferenceEquals(ballAtBatDelivery, delivery) &&
                string.Equals(ballAtBatFootwork, footwork, StringComparison.Ordinal))
                return ballAtBatT;
            ballAtBatSwing = provisionalSwing;
            ballAtBatDelivery = delivery;
            ballAtBatFootwork = footwork;
            ballAtBatT = double.PositiveInfinity;
            var samples = delivery.Flight;
            var ideal = delivery.IdealContactT;
            if (samples == null || samples.Length < 2 || !(ideal > samples[0].t) || !(ideal < samples[samples.Length - 1].t))
                return ballAtBatT;
            if (footwork != "forward" && footwork != "back" && footwork != "across" && footwork != "down_track")
                footwork = "auto";
            ballAtBatT = ProductionBatterBodyModel.IdealTimeFor(samples, ideal, footwork);
            return ballAtBatT;
        }

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-7 task B): false keeps the code-authored stroke's bat as the committed swing's;
        /// true (the default) draws the swing's predicted physics bat (ProductionPredictedSwingBat) until the result arrives.
        /// </summary>
        internal bool PredictedCommittedBatEnabled { get; set; } = true;

        private readonly ProductionPredictedSwingBat predictedBat = new ProductionPredictedSwingBat();
        private PracticeSwingPresentation predictedBatSwing;
        private PracticeDeliveryPresentation predictedBatDelivery;

        /// <summary>
        /// The committed swing's bat at simulation time t, predicted from the swing and the delivery (see
        /// ProductionPredictedSwingBat): false when the delivery or the pack gives nothing to predict from, and the caller draws
        /// the code-authored stroke's bat.
        /// </summary>
        private bool PredictedCommittedBat(double t, out ProductionTouchDownBat.BatPose pose)
        {
            pose = default(ProductionTouchDownBat.BatPose);
            if (!PredictedCommittedBatEnabled || provisionalSwing == null || delivery == null) return false;
            if (!ReferenceEquals(predictedBatSwing, provisionalSwing) || !ReferenceEquals(predictedBatDelivery, delivery))
            {
                predictedBatSwing = provisionalSwing;
                predictedBatDelivery = delivery;
                predictedBat.Clear();
                var ideal = CommittedBallAtBatT();
                Vector3 aim, grip, toe, face;
                if (!double.IsInfinity(ideal) && FlightBallAt(ideal, out aim) &&
                    StrikerPackBatWorld(provisionalSwing.StartT, out grip, out toe, out face))
                    predictedBat.Plan(
                        new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face }, aim, provisionalSwing.StartT,
                        ProductionPredictedSwingBat.TravelSeconds(provisionalSwing.Kind, provisionalSwing.Power));
            }
            if (!predictedBat.Valid) return false;
            pose = predictedBat.At(t);
            // The body stays in TRACKB's load until the result (a clip it cannot yet play would move it), so the bat is held where
            // the load's arms can hold it, with the pelvis's lean (ApplyPackPoseReaching): a low ball's contact bat is out of its
            // reach (thin-edge: 0.65 m from the shoulder, the arm and its girdle reach 0.58) and the hands would leave the handle.
            if (batterRig != null)
            {
                // The left hand is on top for a right-handed rig (ProductionCharacterRig.HeroBatterGripTargetWorld).
                var topIsLeft = batterRig.Handedness == ProductionCharacterHandedness.Right;
                var topShoulder = batterRig.VisibleJointWorldPosition(
                    topIsLeft ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
                var lowerShoulder = batterRig.VisibleJointWorldPosition(
                    topIsLeft ? ProductionCharacterJoint.UpperArmRight : ProductionCharacterJoint.UpperArmLeft);
                var along = pose.Toe - pose.Grip;
                var length = along.magnitude;
                if (length > 1e-6f)
                {
                    along /= length;
                    for (var pass = 0; pass < 4; pass++)
                    {
                        var moved = false;
                        var top = pose.Grip + along * ProductionCharacterRig.BatterTopHandGripOffsetMetres - topShoulder;
                        var lower = pose.Grip + along * ProductionCharacterRig.BatterLowerHandGripOffsetMetres - lowerShoulder;
                        var shift = Vector3.zero;
                        if (top.magnitude > PredictedBatReachMetres) shift += top * (1f - PredictedBatReachMetres / top.magnitude);
                        if (lower.magnitude > PredictedBatReachMetres) shift += lower * (1f - PredictedBatReachMetres / lower.magnitude);
                        if (shift.sqrMagnitude > 1e-10f)
                        {
                            pose.Grip -= shift;
                            pose.Toe -= shift;
                            moved = true;
                        }
                        if (!moved) break;
                    }
                }
            }
            return true;
        }

        /// <summary>
        /// How far from its own shoulder (m) each of the committed swing's hands is held while the body is in the load. It has a cliff
        /// just above it (UNITY-7: 0.68 m leaves the gloves 1.7 mm off the handle, 0.72 m leaves them 7.9 cm off), so it is pinned to the hero's
        /// measured arm reach with a stated margin (ProductionPredictedReachPinTests): a skeleton or scale change fails there.
        /// </summary>
        internal const float PredictedBatReachDefaultMetres = 0.64f;

        /// <summary>How far from its own shoulder (m) each of the committed swing's hands is held while the body is in the load.</summary>
        internal float PredictedBatReachMetres { get; set; } = PredictedBatReachDefaultMetres;

        /// <summary>
        /// Whether the physics could already have changed the ball's path by simulation time t although the result has not
        /// arrived: a committed swing's ball is at the bat, or the delivery's flight data is used up (it ends just past the
        /// striker's stumps, and from there the sample the world would draw is only the last one, held).
        /// </summary>
        private bool BallPastTheBatWhilePending(double t)
        {
            var samples = delivery.Flight;
            if (t > samples[samples.Length - 1].t + 1e-9) return true;
            return provisionalSwing != null && t > CommittedBallAtBatT() + 1e-9;
        }

        /// <summary>
        /// The ball of the delivery in flight (no result yet). Until the pre-contact ball reaches the bat it is the delivery's own
        /// flight, which the physics ball follows exactly; from there the pre-contact line is not what the physics produced (a
        /// contact deflects it, a miss carries it on to the keeper), so nothing is drawn (no ball, readability rings, focus aid or
        /// inset marker) until the result is accepted and the playback places the ball at its true position. The clocks the coach
        /// guide and the delivery effects keep are fed exactly as before.
        /// </summary>
        private void PresentFlightBall(double t)
        {
            var sample = PracticeTraceSampling.BallAt(delivery.Flight, t);
            if (PendingBallHidden && BallPastTheBatWhilePending(t))
            {
                ball.SetVisible(false);
                deliveryEffects.HideBallEmphasis();
                deliveryEffects.SetPlaybackTime(sample.t);
                coachGuidePresentation.SetSimulationTime(sample.t, batterCamera.transform.rotation);
                return;
            }
            ball.SetVisible(true);
            SetBall(sample);
        }

        public void SetBall(BallTraceSample sample)
        {
            ball.SetVisible(true);
            var position = ToUnity(sample.p);
            ball.SetPose(position, sample.t);
            deliveryEffects.SetPlaybackTime(sample.t);
            coachGuidePresentation.SetSimulationTime(sample.t, batterCamera.transform.rotation);
        }

        private void UpdateBallReadabilityProjection()
        {
            if (ball == null || batterCamera == null || deliveryEffects == null ||
                !deliveryEffects.IsDeliveryActive || !deliveryEffects.HasReleased ||
                !ball.GameObject.activeSelf)
                return;
            deliveryEffects.SetBallPose(
                ball.GameObject.transform.position,
                batterCamera.transform.position,
                batterCamera.transform.rotation,
                batterCamera.fieldOfView,
                batterCamera.pixelHeight);
        }

        public void SetBat(BatTraceSample sample)
        {
            if (sample == null) return;
            // Once the physics batters set off for a run the striker's body follows the run, not the ended stroke.
            if (strikerRunning) return;
            ApplyCanonicalBatterRoot();
            // After the follow-through hold the presentation-only recovery owns the body and the (ended) bat.
            if (earlyRecoveryBegun) return;
            var grip = ToUnity(sample.grip);
            var toe = ToUnity(sample.toe);
            var face = ToUnity(sample.face);
            var blade = toe - grip;
            if (blade.sqrMagnitude <= 0.000001f) return;
            CarryCanonicalBat(ref grip, ref toe, ref face, sample.t);
            PresentedBatAt(sample.t, ref grip, ref toe, ref face);
            lastPresentedBatValid = true;
            lastPresentedBatT = sample.t;
            lastPresentedGrip = grip;
            lastPresentedToe = toe;
            lastPresentedFace = face;
            // TRACKB's stroke body owns the striker in its window (PresentPackStroke after the playback step).
            if (PackStrokeActiveAt(sample.t)) return;
            if (!canonicalStrokeAvailable)
            {
                // A no-shot trace may still carry one held guard pose, or repeat that same pose over time. Keep
                // the body moving smoothly back to address instead of mapping timestamps onto the full drive phase.
                // The bat stays exact while hand/body coupling uses the same bounded provisional-to-canonical blend.
                canonicalNoShotGrip = grip;
                canonicalNoShotToe = toe;
                canonicalNoShotFace = face;
                canonicalNoShotPoseCaptured = true;
                var noShotBlend = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(
                    (float)(canonicalBodyBlendElapsed / CanonicalBodyBlendSeconds)));
                if (noShotBlend <= 0f)
                {
                    // AcceptResult can apply the trace sample synchronously between rendered ticks. Keep every
                    // already-visible provisional body/arm transform at blend zero; only the authoritative bat
                    // leads until the first bounded reconciliation sample.
                    batterRig.SetCanonicalBatPose(
                        grip,
                        toe,
                        face,
                        0f,
                        retargetBodyToTrace: false,
                        applyBatterNeckClearance: false);
                    return;
                }
                ApplyCanonicalNoShotPose(noShotBlend);
                return;
            }
            var targetPhase = CanonicalBatterPhase(sample.t);
            var blend = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(
                (float)(canonicalBodyBlendElapsed / CanonicalBodyBlendSeconds)));
            batterRig.SampleBatterStrokeBlend(
                canonicalBlendFromPhase,
                canonicalBlendFromFootwork,
                targetPhase,
                canonicalFootwork,
                blend,
                applyBatterNeckClearance: false);
            // sim-v3 owns body translation explicitly through batterRootOffset plus the latched final body frame.
            // Keep the two-arm IK coupling, but do not let a second grip-driven body or neck solver move the
            // athlete independently of those authoritative anchors.
            batterRig.SetCanonicalBatPose(
                grip,
                toe,
                face,
                blend,
                retargetBodyToTrace: false,
                applyBatterNeckClearance: false);
        }

        private void ApplyCanonicalNoShotPose(float blend)
        {
            ApplyCanonicalBatterRoot();
            if (canonicalBlendFromPhase > 0.0001f)
            {
                batterRig.SampleBatterStrokeBlend(
                    canonicalBlendFromPhase,
                    canonicalBlendFromFootwork,
                    0f,
                    canonicalFootwork,
                    blend,
                    applyBatterNeckClearance: false);
            }
            batterRig.SetCanonicalBatPose(
                canonicalNoShotGrip,
                canonicalNoShotToe,
                canonicalNoShotFace,
                blend,
                retargetBodyToTrace: false,
                applyBatterNeckClearance: false);
            if (canonicalBlendFromPhase > 0.0001f)
                batterRig.ApplyBatterNoShotHeroBlend(blend);
        }

        public void SetFielder(string fielderId, FielderTraceSample sample)
        {
            if (sample == null || string.IsNullOrEmpty(fielderId)) return;
            GameObject fielder;
            if (!fielderById.TryGetValue(fielderId, out fielder))
                throw new BridgeValidationException("Authoritative trace references an unknown fielder.");
            int stableIndex;
            if (!fielderStableIndexById.TryGetValue(fielderId, out stableIndex))
                throw new BridgeValidationException("Authoritative trace references an unconfigured fielder slot.");
            productionEnvironment.ApplyAuthoritativeFielderSample(fielderId, sample);
            if (fielder == bowler && bowlerPhysicsSpot.HasValue && sample.t < bowlerSetEndT)
            {
                AnimateBowlerFollowThrough(sample.t);
                return;
            }
            var mirror = PresentationMirror;
            var nextPosition = new Vector3(mirror * (float)sample.x, 0f, (float)sample.z);
            var movement = nextPosition - fielder.transform.position;
            // The root is exactly the physics path, always (the body never moves it).
            fielder.transform.position = nextPosition;
            var rig = fielder == bowler ? bowlerRig : null;
            if (rig == null) rigByRoot.TryGetValue(fielder, out rig);
            ProductionFieldingTrack track;
            if (rig != null && fieldingTracks.TryGetValue(fielderId, out track))
            {
                if (fielder == bowler) ApplyBowlerFieldingPose(track, sample.t);
                else ApplyFieldingPose(fielder, rig, track, sample.t);
                return;
            }
            if (rig != null)
            {
                ProductionCharacterMotion motion;
                var stableReadyPhase = -1f;
                switch (sample.action)
                {
                    case "dive": motion = ProductionCharacterMotion.FielderDive; break;
                    case "throw": motion = ProductionCharacterMotion.FielderThrow; break;
                    case "run": motion = ProductionCharacterMotion.FielderRun; break;
                    default:
                        if (rig.Role == ProductionCharacterRole.Wicketkeeper)
                        {
                            motion = ProductionCharacterMotion.KeeperCrouch;
                        }
                        else
                        {
                            motion = ProductionCharacterMotion.FielderReady;
                            stableReadyPhase = ProductionCharacterMotionSampler.StableFielderReadyPhase(
                                fielderId, stableIndex);
                        }
                        break;
                }
                var duration = ProductionCharacterMotionSampler.DurationSeconds(motion);
                var phase = stableReadyPhase >= 0f
                    ? stableReadyPhase
                    : duration <= 0f ? 0f : Mathf.Repeat((float)sample.t / duration, 1f);
                rig.SampleAndApply(motion, phase);
            }
            if (movement.sqrMagnitude > 0.0001f)
                fielder.transform.rotation = Quaternion.LookRotation(movement.normalized, Vector3.up);
            if (sample.action == "dive")
                fielder.transform.rotation *= Quaternion.Euler(0f, 0f, mirror * 8f);
        }

        /// <summary>
        /// Every playable ball starts from the set field: each fielder back on his scene position, facing the striker,
        /// in the ready stance (the keeper crouched, square to the bowler), whatever the last ball's paths left.
        /// </summary>
        private void RestoreFieldersToScene()
        {
            var mirror = PresentationMirror;
            foreach (var pair in fielderScenePositionById)
            {
                string role;
                GameObject fielder;
                ProductionCharacterRig rig;
                if (!fielderRoleById.TryGetValue(pair.Key, out role) || role == "bowler" ||
                    !fielderById.TryGetValue(pair.Key, out fielder) || !rigByRoot.TryGetValue(fielder, out rig))
                    continue;
                var position = new Vector3(mirror * pair.Value.x, 0f, pair.Value.z);
                fielder.transform.position = position;
                var heading = role == "keeper"
                    ? ProductionFieldingPlanner.KeeperHeading
                    : ProductionFieldingPlanner.HeadingOf(
                        strikerPresentationReference.x - position.x, strikerPresentationReference.z - position.z);
                fielder.transform.rotation = Quaternion.Euler(0f, heading * Mathf.Rad2Deg, 0f);
                ProductionFieldingClips.Sample(
                    role == "keeper" ? ProductionFieldingClip.KeepCrouch : ProductionFieldingClip.Ready,
                    ProductionFielding.PhaseFor(pair.Key), fieldingPose);
                if (rig.Handedness == ProductionCharacterHandedness.Left) ProductionFieldingClips.Mirror(fieldingPose);
                rig.ApplyPose(fieldingPose);
            }
        }

        private void ClearFieldingChoreography()
        {
            fieldingTracks.Clear();
            syntheticFieldingIds.Clear();
        }

        /// <summary>
        /// Plans every fielder's body for the accepted trace (src/render3d/practice/fielding.ts and script.ts
        /// fieldReactions, ported): only from the trace's own paths, events and ball, so a change to the physics paths
        /// is followed without any copied numbers. The bowler keeps its delivery animation. A keeper whose take has no
        /// path of its own gets a stationary one, as the web gives it.
        /// </summary>
        private void BuildFieldingChoreography(PracticeResultPresentation result)
        {
            ClearFieldingChoreography();
            var trace = result.Trace;
            if (trace == null || trace.fielders == null || fielderRoleById.Count == 0) return;
            // The planner negates x when `mirror` is true: that is the physics-to-Unity reflection.
            var mirror = PresentationMirror < 0f;
            var roster = new List<(string id, string role, double x, double z)>();
            foreach (var pair in fielderRoleById)
            {
                var spot = fielderScenePositionById[pair.Key];
                roster.Add((pair.Key, pair.Value, spot.x, spot.z));
            }
            var reactions = ProductionFieldingPlanner.Reactions(
                trace, roster, result.Dismissal, result.OutcomeFielderId,
                !string.IsNullOrEmpty(result.ShotIntent) && result.ShotIntent != "leave",
                result.ContactKind, mirror);
            CanonicalTraceEvent catchEvent = null;
            double? keeperTake = null;
            var keeperShortM = 0.0;
            foreach (var traceEvent in trace.events)
            {
                if (traceEvent.kind == "catch" && catchEvent == null) catchEvent = traceEvent;
                if (traceEvent.kind == "keeper_take" && !keeperTake.HasValue)
                {
                    keeperTake = traceEvent.t;
                    keeperShortM = traceEvent.shortM;
                }
            }
            Func<double, Vector3?> ball = t => BallWorldAt(trace, t, false);
            Func<double, Vector3?> velocity = t => BallWorldAt(trace, t, true);
            var pathed = pathedFielderIds;
            pathed.Clear();
            foreach (var path in trace.fielders)
            {
                if (path == null || path.samples == null || path.samples.Length == 0) continue;
                pathed.Add(path.fielderId);
                string role;
                if (!fielderRoleById.TryGetValue(path.fielderId, out role)) continue;
                if (role == "bowler")
                {
                    // HUM U5: the bowler's physics path starts on his fielding spot. Present the follow-through until
                    // his first non-"set" sample, then the same planner choreography as every other fielder.
                    var first = path.samples[0];
                    bowlerPhysicsSpot = new Vector3(PresentationMirror * (float)first.x, 0f, (float)first.z);
                    bowlerSetEndT = trace.durationSeconds;
                    foreach (var sample in path.samples)
                    {
                        if (sample == null || sample.action == "set") continue;
                        bowlerSetEndT = sample.t;
                        break;
                    }
                    bowlerConvergeFromT = Math.Max(0.0, Math.Min(timeline, bowlerSetEndT - 0.25));
                    bowlerHandedOver = false;
                }
                fieldingTracks[path.fielderId] = ProductionFieldingPlanner.Plan(
                    path.samples, mirror, FieldingContext(path.fielderId, role, ball, velocity, catchEvent, reactions,
                        trace.durationSeconds));
            }
            if (keeperTake.HasValue)
            {
                foreach (var pair in fielderRoleById)
                {
                    if (pair.Value != "keeper" || pathed.Contains(pair.Key)) continue;
                    var at = fielderScenePositionById[pair.Key];
                    // A clean take is a catch at the take; with shortM the ball goes past him: he dives (or reaches)
                    // short at the take and does not gather it.
                    var samples = keeperShortM > 0.0
                        ? new[]
                        {
                            new FielderTraceSample { t = 0.0, x = at.x, z = at.z, action = "set" },
                            new FielderTraceSample
                            {
                                t = Math.Max(0.0, keeperTake.Value - 0.3), x = at.x, z = at.z, action = "dive"
                            },
                            new FielderTraceSample { t = keeperTake.Value, x = at.x, z = at.z, action = "drop" }
                        }
                        : new[]
                        {
                            new FielderTraceSample { t = 0.0, x = at.x, z = at.z, action = "set" },
                            new FielderTraceSample { t = keeperTake.Value, x = at.x, z = at.z, action = "catch" }
                        };
                    fieldingTracks[pair.Key] = ProductionFieldingPlanner.Plan(samples, mirror,
                        FieldingContext(pair.Key, pair.Value, ball, velocity, catchEvent, reactions,
                            trace.durationSeconds));
                    syntheticFieldingIds.Add(pair.Key);
                }
            }
        }

        private ProductionFieldingContext FieldingContext(
            string id,
            string role,
            Func<double, Vector3?> ball,
            Func<double, Vector3?> velocity,
            CanonicalTraceEvent catchEvent,
            Dictionary<string, (double time, ProductionFieldingClip clip)> reactions,
            double endTime)
        {
            var mirror = PresentationMirror;
            var scene = fielderScenePositionById[id];
            var world = new Vector3(mirror * scene.x, 0f, scene.z);
            var striker = strikerPresentationReference;
            var context = new ProductionFieldingContext
            {
                Ball = ball,
                BallVelocity = velocity,
                Keeper = role == "keeper",
                CatchHigh = catchEvent != null && catchEvent.fielderId == id && catchEvent.p != null &&
                            catchEvent.p.y > 1.9,
                Heading = ProductionFieldingPlanner.HeadingOf(striker.x - world.x, striker.z - world.z),
                Striker = striker,
                EndTime = endTime,
                Phase = ProductionFielding.PhaseFor(id)
            };
            if (role == "keeper") context.Heading = ProductionFieldingPlanner.KeeperHeading;
            (double time, ProductionFieldingClip clip) reaction;
            if (reactions != null && reactions.TryGetValue(id, out reaction))
            {
                context.ReactionTime = reaction.time;
                context.ReactionClip = reaction.clip;
            }
            return context;
        }

        private Vector3? BallWorldAt(CanonicalDeliveryTrace trace, double t, bool velocity)
        {
            var samples = trace.ball;
            if (samples == null || samples.Length == 0) return null;
            BallTraceSample a;
            BallTraceSample b;
            var u = 0.0;
            if (double.IsPositiveInfinity(t) || t >= samples[samples.Length - 1].t)
            {
                a = b = samples[samples.Length - 1];
            }
            else if (t <= samples[0].t)
            {
                a = b = samples[0];
            }
            else
            {
                var lo = 0;
                var hi = samples.Length - 1;
                while (hi - lo > 1)
                {
                    var mid = (lo + hi) / 2;
                    if (samples[mid].t <= t) lo = mid;
                    else hi = mid;
                }
                a = samples[lo];
                b = samples[hi];
                var span = b.t - a.t;
                u = span > 0.0 ? (t - a.t) / span : 0.0;
            }
            var pa = velocity ? a.v : a.p;
            var pb = velocity ? b.v : b.p;
            if (pa == null || pb == null) return null;
            var value = new TraceVector3
            {
                x = pa.x + (pb.x - pa.x) * u,
                y = pa.y + (pb.y - pa.y) * u,
                z = pa.z + (pb.z - pa.z) * u
            };
            return ToUnity(value);
        }

        private void ApplyFieldingPose(GameObject fielder, ProductionCharacterRig rig, ProductionFieldingTrack track,
            double time)
        {
            // A dive's extension towards the ball moves the drawn hips only; the root stays on the physics path.
            track.Apply(rig, fielder.transform, time, fieldingPose);
        }

        private readonly ProductionCharacterPose bowlerHandoverFrom = new ProductionCharacterPose();
        private Quaternion bowlerHandoverYaw;
        private double bowlerHandoverStartT;
        private const double BowlerHandoverSeconds = 0.35;
        // UNITY-9: the heading the bowler is drawn with once the planner has him, and how fast it is turning.
        private float bowlerHeadingDegrees;
        private float bowlerHeadingRate;
        private double bowlerHeadingT;

        /// <summary>The fastest the bowler's body turns about the vertical after the planner has him (deg/s): 4.5 deg a frame, so that his hips, which add their own twist (up to 6 deg a frame in the planner's poses), stay at the section 9 cap of 600 deg/s.</summary>
        internal const float BowlerHeadingMaxDegreesPerSecond = 270f;
        /// <summary>How quickly that turn builds up and eases off (deg/s per s): 0.18 s from rest to the fastest turn.</summary>
        internal const float BowlerHeadingAccelerationDegreesPerSecond2 = 1500f;
        private const float BowlerHeadingGainPerSecond = 5f;

        /// <summary>
        /// Builder seam (UNITY-9 A/B in one build): false draws the bowler's heading after the hand-over as before, a slerp from the heading he had to
        /// the planner's moving heading over 0.35 s. That sum of two motions turned his hips 10 to 20 degrees a frame for 12 frames when the planner
        /// sent him round to chase or walk back (the peak of a smoothstep over a 180 degree turn alone is 770 deg/s, and the planner's own heading turns
        /// on top of it).
        /// </summary>
        internal bool BowlerHeadingFollowerEnabled { get; set; } = true;

        /// <summary>
        /// One step of a body turning towards a heading with a bounded rate and a bounded acceleration: the wanted rate grows with the angle left
        /// (so it eases into the heading) up to maxRate, and the actual rate moves towards it no faster than maxAcceleration. Pure; wrap-safe.
        /// </summary>
        internal static float FollowHeadingDegrees(float yaw, ref float rate, float target, float deltaSeconds)
        {
            if (deltaSeconds <= 1e-5f) return yaw;
            var delta = Mathf.DeltaAngle(yaw, target);
            var wanted = Mathf.Clamp(delta * BowlerHeadingGainPerSecond, -BowlerHeadingMaxDegreesPerSecond, BowlerHeadingMaxDegreesPerSecond);
            rate = Mathf.MoveTowards(rate, wanted, BowlerHeadingAccelerationDegreesPerSecond2 * deltaSeconds);
            var step = rate * deltaSeconds;
            if (Mathf.Abs(step) >= Mathf.Abs(delta) && step * delta >= 0f)
            {
                step = delta;
                rate = 0f;
            }
            return Mathf.Repeat(yaw + step + 180f, 360f) - 180f;
        }

        /// <summary>The bowler's planner pose, blended in from his follow-through pose and heading (no pop).</summary>
        private void ApplyBowlerFieldingPose(ProductionFieldingTrack track, double time)
        {
            if (!bowlerHandedOver)
            {
                bowlerHandedOver = true;
                bowlerHandoverStartT = time;
                for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                    bowlerHandoverFrom.Rotations[joint] = bowlerRig.Joint((ProductionCharacterJoint)joint).localRotation;
                bowlerHandoverFrom.RootOffset = bowlerRig.PoseRootOffset;
                bowlerHandoverYaw = bowler.transform.rotation;
                bowlerHeadingDegrees = bowler.transform.eulerAngles.y;
                bowlerHeadingRate = 0f;
                bowlerHeadingT = time;
            }
            var state = track.SamplePose(time, fieldingPose);
            if (bowlerRig.Handedness == ProductionCharacterHandedness.Left) ProductionFieldingClips.Mirror(fieldingPose);
            var heading = Quaternion.Euler(0f, state.Heading * Mathf.Rad2Deg, 0f);
            var w = Mathf.Clamp01((float)((time - bowlerHandoverStartT) / BowlerHandoverSeconds));
            w = w * w * (3f - 2f * w);
            if (w < 1f) ProductionFieldingClips.Blend(fieldingPose, bowlerHandoverFrom, 1f - w);
            if (BowlerHeadingFollowerEnabled)
            {
                bowlerHeadingDegrees = FollowHeadingDegrees(bowlerHeadingDegrees, ref bowlerHeadingRate, state.Heading * Mathf.Rad2Deg,
                    (float)Math.Max(0.0, time - bowlerHeadingT));
                bowlerHeadingT = time;
                bowler.transform.rotation = Quaternion.Euler(0f, bowlerHeadingDegrees, 0f);
            }
            else bowler.transform.rotation = Quaternion.Slerp(bowlerHandoverYaw, heading, w);
            if (state.Body.sqrMagnitude > 0f) fieldingPose.RootOffset += bowler.transform.InverseTransformVector(state.Body);
            bowlerRig.ApplyPose(fieldingPose);
        }

        private void ApplySyntheticFielding(double time)
        {
            for (var index = 0; index < syntheticFieldingIds.Count; index++)
            {
                var id = syntheticFieldingIds[index];
                GameObject fielder;
                ProductionCharacterRig rig;
                ProductionFieldingTrack track;
                if (!fielderById.TryGetValue(id, out fielder) || !rigByRoot.TryGetValue(fielder, out rig) ||
                    !fieldingTracks.TryGetValue(id, out track)) continue;
                ApplyFieldingPose(fielder, rig, track, time);
            }
        }

        internal ProductionFieldingTrack FieldingTrackForTesting(string fielderId)
        {
            ProductionFieldingTrack track;
            return fieldingTracks.TryGetValue(fielderId, out track) ? track : null;
        }

        /// <summary>The planned track of the fielder with this role ("keeper", "bowler"), if one is planned.</summary>
        internal ProductionFieldingTrack FieldingTrackForRoleForEvidence(string role)
        {
            foreach (var pair in fielderRoleById)
                if (pair.Value == role) return FieldingTrackForTesting(pair.Key);
            return null;
        }

        /// <summary>
        /// Builder evidence (bowler release ruling, 2026-11-04): poses the composed run-up at its release exactly and
        /// measures the ball-in-hand anchor against the physics release point. Call between deliveries or after one:
        /// it re-poses the bowler.
        /// </summary>
        internal string BowlerReleaseGapForEvidence
        {
            get
            {
                if (bowlerRunUp == null || bowlerRig == null) return null;
                PlaceBowlerOnRunUp(bowlerRunUp.VisibleRelease);
                var anchor = bowlerRig.ReleaseHandAnchor.position;
                var hand = bowlerRig.Joint(bowlerRig.Handedness == ProductionCharacterHandedness.Left
                    ? ProductionCharacterJoint.HandLeft
                    : ProductionCharacterJoint.HandRight).position;
                var leftFoot = bowlerRig.VisibleJointWorldPosition(ProductionCharacterJoint.FootLeft);
                var rightFoot = bowlerRig.VisibleJointWorldPosition(ProductionCharacterJoint.FootRight);
                Func<Vector3, string> v = p => string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "[{0:0.####},{1:0.####},{2:0.####}]", p.x, p.y, p.z);
                return string.Format(System.Globalization.CultureInfo.InvariantCulture,
                    "{{\"gapM\":{0:0.#####},\"gapYM\":{1:0.#####},\"scale\":{2:0.####},\"heightResidualM\":{3:0.####}," +
                    "\"anchor\":{4},\"target\":{5},\"wrist\":{6},\"footL\":{7},\"footR\":{8}}}",
                    Vector3.Distance(anchor, bowlerReleaseTarget), anchor.y - bowlerReleaseTarget.y, bowlerRunUpScale,
                    bowlerRunUpHeightResidual, v(anchor), v(bowlerReleaseTarget), v(hand), v(leftFoot), v(rightFoot));
            }
        }

        /// <summary>
        /// Hands the trace's upcoming events to a look-ahead feedback sink before their crossing frame, in trace order,
        /// so each sound is scheduled at its own physics time instead of on the next rendered frame (no back-dated or
        /// early visuals: captions, haptics and every visual consequence still wait for EmitEvent). An event the sink
        /// does not take is left for its crossing frame, and nothing after it is handed over first.
        /// </summary>
        private void RouteFeedbackAhead()
        {
            if (acceptedTrace == null || feedback == null || playback == null || playback.Completed) return;
            var horizon = feedback.LookaheadSeconds;
            if (horizon <= 0.0) return;
            var events = acceptedTrace.events;
            var now = playback.Time;
            var speed = playbackSpeed > 0.0 ? playbackSpeed : 1.0;
            while (feedbackLookaheadCursor < events.Length)
            {
                var traceEvent = events[feedbackLookaheadCursor];
                if (traceEvent.t <= now)
                {
                    feedbackLookaheadCursor++;
                    continue;
                }
                var lead = (traceEvent.t - now) / speed;
                if (lead > horizon) break;
                var key = traceEvent.kind + ":" + traceEvent.t.ToString("R",
                    System.Globalization.CultureInfo.InvariantCulture);
                if (emittedEvents.Contains(key))
                {
                    feedbackLookaheadCursor++;
                    continue;
                }
                if (!feedback.RouteAhead(traceEvent, lead)) break;
                feedbackLookaheadCursor++;
            }
        }

        public void EmitEvent(CanonicalTraceEvent traceEvent)
        {
            var key = traceEvent.kind + ":" + traceEvent.t.ToString("R",
                System.Globalization.CultureInfo.InvariantCulture);
            if (!emittedEvents.Add(key)) return;
            if (traceEvent.kind == "contact")
            {
                contactOccurred = true;
                coachGuidePresentation.MarkContact();
            }
            Transform namedFielder = null;
            if (!string.IsNullOrEmpty(traceEvent.fielderId) &&
                fielderById.TryGetValue(traceEvent.fielderId, out var fielder))
                namedFielder = fielder.transform;
            productionEnvironment.HandleAuthoritativeTraceEvent(
                traceEvent, PresentationMirror, namedFielder);
            deliveryEffects.HandleEvent(traceEvent);
            RouteCrowdEmotion(traceEvent);
            feedback.Route(traceEvent);
            TraceEvent?.Invoke(traceEvent);
        }

        private void RouteCrowdEmotion(CanonicalTraceEvent traceEvent)
        {
            if (productionEnvironment == null) return;
            var focus = traceEvent.p == null ? (Vector3?)null : ToUnity(traceEvent.p);
            switch (traceEvent.kind)
            {
                case "boundary":
                    productionEnvironment.SetCrowdEmotion(
                        traceEvent.runs == 6 ? 0.95f : 0.78f,
                        traceEvent.runs == 6 ? 1f : 0.82f,
                        focus);
                    break;
                case "stumps":
                case "catch":
                    productionEnvironment.SetCrowdEmotion(-0.52f, 0.96f, focus);
                    break;
                case "contact":
                    productionEnvironment.SetCrowdEmotion(0.18f, 0.24f, focus);
                    break;
                case "field":
                case "throw":
                    productionEnvironment.SetCrowdEmotion(0.08f, 0.34f, focus);
                    break;
            }
        }

        public void SetPlaybackCompleted(bool completed)
        {
            // Completion is consumed in Tick so bridge output happens once and
            // outside the trace target callback stack.
        }

        /// <summary>
        /// Exercises the same camera, materials, shadows, crowd and character
        /// transforms as live Practice without inventing a delivery or
        /// gameplay result. Evidence still comes only from OnPostRender.
        /// </summary>
        public void BeginBenchmarkWorkload()
        {
            if (!built || DeliveryActive || benchmarkActive)
                throw new BridgeValidationException("The representative Unity workload cannot start now.");
            benchmarkActive = true;
            benchmarkTimeline = 0.0;
            benchmarkBowlerPosition = bowler.transform.position;
            benchmarkBowlerRotation = bowler.transform.rotation;
            benchmarkBallPosition = ball.GameObject.transform.position;
            benchmarkBallRotation = ball.GameObject.transform.rotation;
            benchmarkBallVisible = ball.GameObject.activeSelf;
            benchmarkFielderPositions = new Vector3[fielders.Count];
            benchmarkFielderRotations = new Quaternion[fielders.Count];
            benchmarkFielderActive = new bool[fielders.Count];
            for (var index = 0; index < fielders.Count; index++)
            {
                benchmarkFielderPositions[index] = fielders[index].transform.position;
                benchmarkFielderRotations[index] = fielders[index].transform.rotation;
                benchmarkFielderActive[index] = fielders[index].activeSelf;
                var angle = Mathf.PI * 2f * index / fielders.Count;
                fielders[index].SetActive(index != 1);
                fielders[index].transform.position = new Vector3(
                    Mathf.Sin(angle) * (12f + index), 0f, Mathf.Cos(angle) * (12f + index));
                ProductionCharacterRig rig;
                if (rigByRoot.TryGetValue(fielders[index], out rig))
                    UpdateCharacterPresentationDistance(fielders[index], rig);
            }
            ball.SetVisible(true);
            ball.ConfigureOrientation(Vector3.up, Vector3.right);
            batterRig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
        }

        public void EndBenchmarkWorkload()
        {
            if (!benchmarkActive) return;
            benchmarkActive = false;
            bowler.transform.position = benchmarkBowlerPosition;
            bowler.transform.rotation = benchmarkBowlerRotation;
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            batterRig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
            ball.GameObject.transform.position = benchmarkBallPosition;
            ball.GameObject.transform.rotation = benchmarkBallRotation;
            ball.SetVisible(benchmarkBallVisible);
            if (benchmarkFielderPositions != null)
            {
                for (var index = 0; index < fielders.Count; index++)
                {
                    fielders[index].transform.position = benchmarkFielderPositions[index];
                    fielders[index].transform.rotation = benchmarkFielderRotations[index];
                    fielders[index].SetActive(benchmarkFielderActive[index]);
                    ProductionCharacterRig rig;
                    if (rigByRoot.TryGetValue(fielders[index], out rig))
                        UpdateCharacterPresentationDistance(fielders[index], rig);
                }
            }
            benchmarkFielderPositions = null;
            benchmarkFielderRotations = null;
            benchmarkFielderActive = null;
        }

        private void AnimateBenchmarkWorkload(double deltaSeconds)
        {
            benchmarkTimeline += deltaSeconds;
            var approachSeconds = bowlingPresentation.ApproachSeconds;
            var cycle = (float)(benchmarkTimeline % approachSeconds) / approachSeconds;
            AnimateBowler(cycle);
            var flight = (float)(benchmarkTimeline % 0.85) / 0.85f;
            var z = Mathf.Lerp(-8.7f, 10.0f, flight);
            var y = Mathf.Max(0.18f, 2.05f - 1.8f * flight + 0.22f * Mathf.Sin(flight * Mathf.PI));
            ball.SetPose(new Vector3(Mathf.Sin(flight * Mathf.PI) * 0.35f, y, z),
                new Vector3(0.2f, 0.9f, 0.3f), 18.0, benchmarkTimeline);
            batterRig.SampleBatterStroke(flight, ProductionBatterFootwork.Balanced);
            for (var index = 0; index < fielders.Count; index++)
            {
                if (!fielders[index].activeSelf) continue;
                var angle = Mathf.PI * 2f * index / fielders.Count;
                var radius = 12f + index;
                fielders[index].transform.position = new Vector3(
                    Mathf.Sin(angle) * radius + Mathf.Sin((float)benchmarkTimeline * 2f + index) * 0.35f,
                    0f,
                    Mathf.Cos(angle) * radius + Mathf.Cos((float)benchmarkTimeline * 2f + index) * 0.35f);
                ProductionCharacterRig rig;
                if (rigByRoot.TryGetValue(fielders[index], out rig))
                {
                    UpdateCharacterPresentationDistance(fielders[index], rig);
                    rig.SampleAndApply(
                        rig.Role == ProductionCharacterRole.Wicketkeeper
                            ? ProductionCharacterMotion.KeeperCrouch
                            : ProductionCharacterMotion.FielderRun,
                        Mathf.Repeat((float)benchmarkTimeline / 0.62f + index * 0.07f, 1f));
                }
            }
        }

        private void BuildWorld()
        {
            worldRoot = new GameObject("VANDE-ProductionPracticeWorld").transform;
            worldRoot.SetParent(transform, false);

            productionEnvironment = ProductionCricketEnvironment.Create(
                worldRoot,
                new ProductionEnvironmentSpec(
                    profile.Quality,
                    "balanced",
                    "white",
                    // Practice is a ball-reading task first. A clear day key keeps the
                    // bowler's release arm, batter equipment and red ball legible on
                    // small Android screens; cinematic evening variants belong behind
                    // an explicit venue/lighting choice rather than the default drill.
                    practiceLight,
                    ProductionSky.Clear,
                    settings != null && settings.ReducedMotion));

            characterResources = new ProductionCharacterResources(
                ProductionCharacterPalette.OriginalNightKit());
            bowlerRig = ProductionCharacterFactory.CreateShared(
                worldRoot,
                CharacterSpec(ProductionCharacterRole.PaceBowler),
                characterResources);
            bowler = bowlerRig.Root.gameObject;
            bowler.name = "BowlerProxy";
            bowler.transform.position = new Vector3(0f, 0f, -28f);
            UpdateCharacterPresentationDistance(bowler, bowlerRig);

            batterRig = ProductionCharacterFactory.CreateShared(
                worldRoot,
                CharacterSpec(ProductionCharacterRole.Batter),
                characterResources);
            batterBody = batterRig.Root.gameObject;
            batterBody.name = "BatterTorsoProxy";
            bat = batterRig.Bat.gameObject;
            bat.name = "BatProxy";

            keeperRig = ProductionCharacterFactory.CreateShared(
                worldRoot,
                CharacterSpec(ProductionCharacterRole.Wicketkeeper),
                characterResources);
            RegisterFieldingRig(keeperRig, 0);
            nonStrikerRig = ProductionCharacterFactory.CreateShared(
                worldRoot,
                CharacterSpec(ProductionCharacterRole.Batter),
                characterResources);
            nonStrikerRig.Root.gameObject.name = "NonStrikerProxy";
            nonStrikerGait = new ProductionGaitPresenter(nonStrikerRig);
            strikerGait = new ProductionGaitPresenter(batterRig);
            for (var index = 1; index < 11; index++)
            {
                var fielderSpec = CharacterSpec(ProductionCharacterRole.Fielder);
                // Scene ids do not exist until ConfigureScene; the retained construction slot is the stable
                // identity available here. Height scales only this presentation root and never field coordinates.
                fielderSpec.HeightMetres = StableFielderHeightMetres(index);
                var fielderRig = ProductionCharacterFactory.CreateShared(
                    worldRoot,
                    fielderSpec,
                    characterResources);
                RegisterFieldingRig(fielderRig, index);
            }

            ball = ProductionCricketProps.CreateBall(
                worldRoot,
                "ProductionCricketBall",
                PropQuality(profile.Quality),
                profile.RealtimeShadows);
            deliveryEffects = ProductionDeliveryEffects.Create(
                worldRoot,
                profile.Quality,
                settings != null && settings.ReducedMotion);
            coachGuidePresentation = ProductionCoachGuidePresentation.Create(
                worldRoot,
                profile.Quality,
                settings != null && settings.ReducedMotion);

            var cameraObject = new GameObject("BatterEyeCamera");
            cameraObject.transform.SetParent(worldRoot, false);
            // The device benchmark runs before host.scene. Give that workload
            // the same law-scale batter viewpoint instead of Unity's origin,
            // which sits inside pitch/stadium geometry and misrepresents both
            // presentation quality and renderer cost.
            batterCamera = cameraObject.AddComponent<Camera>();
            SetStableCameraComposition(0f, 0f, PresentationMirror);
            fieldPip = new ProductionFieldPip(worldRoot,
                profile.Quality == PracticePresentationQuality.Lite ? 128 :
                profile.Quality == PracticePresentationQuality.Standard ? 160 : 192);
            batterCamera.cullingMask &= ~(1 << ProductionFieldPip.Layer);
            keeperOcclusion = new ProductionOcclusionFade(
                batterCamera, () => keeperRig, () => batterRig, StrikerWicketBounds);
            // HUM-AUDIT P0 (spin slip on the lens): every other fielder and the non-striker get the same soft fade,
            // only over the striker/stumps and, as a whole body, only within 2 m of the lens. Never removed.
            foreach (var rig in fieldingRigs)
            {
                if (rig == null || rig == keeperRig) continue;
                var captured = rig;
                lensFades.Add(new ProductionOcclusionFade(
                    batterCamera, () => captured, () => batterRig, StrikerWicketBounds));
            }
            if (nonStrikerRig != null)
                lensFades.Add(new ProductionOcclusionFade(
                    batterCamera, () => nonStrikerRig, () => batterRig, StrikerWicketBounds));
            ApplyHorizontalFieldOfView();
            batterCamera.nearClipPlane = 0.08f;
            batterCamera.farClipPlane = 180f;
            batterCamera.allowMSAA = profile.Quality != PracticePresentationQuality.Lite;
            productionEnvironment.ConfigureCamera(batterCamera);
            renderObserver = cameraObject.AddComponent<PracticeRenderedFrameObserver>();
            renderObserver.Rendered += OnFrameRendered;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.tag = "MainCamera";

            built = true;
            state = WorldState.Idle;
            ResetBat();
        }

        /// <summary>The bowler's root at composed time ct: the composed ground, placed rigidly about the release.</summary>
        private Vector3 BowlerRunUpRoot(double composedT)
        {
            float gx, gz, yaw;
            bowlerRunUp.Ground(composedT, out gx, out gz, out yaw);
            return BowlerRunUpRootAt(gx, gz);
        }

        private Vector3 BowlerRunUpRootAt(float gx, float gz)
        {
            var k = bowlerRunUpScale * MotionPacks.Vmp.UnityDriverHorizontalScale;
            return bowlerRunUpAnchor + new Vector3((gx - bowlerRunUpReleaseGroundX) * k, 0f,
                (gz - bowlerRunUpReleaseGroundZ) * k);
        }

        private float BowlerRunUpYaw(double composedT)
        {
            float gx, gz, yaw;
            bowlerRunUp.Ground(composedT, out gx, out gz, out yaw);
            return yaw;
        }

        /// <summary>
        /// The bowler's root at a visible run-up time (0 = the visible start): the clip's ground track from its rolling
        /// start, less the launch's lag (the root leaves rest by a smooth ramp, ProductionBowlerRunUp.GroundVisible).
        /// </summary>
        private Vector3 BowlerRunUpRootVisible(double visibleSeconds)
        {
            float gx, gz, yaw;
            bowlerRunUp.GroundVisible(visibleSeconds, out gx, out gz, out yaw);
            return BowlerRunUpRootAt(gx, gz);
        }

        /// <summary>
        /// Poses the bowler at a visible run-up time (0 = the visible start, ApproachSeconds = the release): the
        /// composed clip from PreRoll seconds in at its own rate, the standing idle handed over to it inertially, the
        /// root launched from rest, and (unless `reach` is false) the release reach.
        /// </summary>
        private void PlaceBowlerOnRunUp(double visibleSeconds, bool reach = true)
        {
            float gx, gz, yaw;
            bowlerRunUp.GroundVisible(visibleSeconds, out gx, out gz, out yaw);
            bowler.transform.SetPositionAndRotation(BowlerRunUpRootAt(gx, gz), Quaternion.AngleAxis(yaw, Vector3.up));
            bowlerRunUp.SampleVisible(visibleSeconds, bowlerPackPose);
            bowlerRig.ApplyPose(bowlerPackPose);
            if (reach) ReachBowlerReleaseResidual(bowlerRunUp.ComposedTime(visibleSeconds));
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
        }

        /// <summary>Builder measurement only: false poses the bowler on the bare clip (the release reach off).</summary>
        internal bool BowlerReleaseReachEnabledForTesting = true;

        /// <summary>
        /// The release residual (the physics release point less the ball in the hand as the clip draws it) taken up by
        /// the trunk's side flexion and a rigid shoulder turn, never the elbow (ProductionCharacterRig
        /// .ReachReleaseWithTrunkAndShoulder): eased in over the 200 ms before the release and out over the 160 ms
        /// after it, like the web's RELEASE_REACH.
        /// </summary>
        private void ReachBowlerReleaseResidual(double composedT)
        {
            if (!BowlerReleaseReachEnabledForTesting) return;
            if (bowlerRunUp == null || bowlerReleaseDelta.sqrMagnitude < 1e-8f) return;
            var fromRelease = composedT - bowlerRunUp.TRelease;
            float weight;
            if (fromRelease <= 0.0)
                weight = 1f - Mathf.Clamp01((float)(-fromRelease / BowlerReachInSeconds));
            else
                weight = 1f - Mathf.Clamp01((float)(fromRelease / BowlerReachOutSeconds));
            if (weight <= 0f) return;
            weight = weight * weight * (3f - 2f * weight);
            bowlerRig.ReachReleaseWithTrunkAndShoulder(bowlerReleaseDelta, weight);
        }

        internal string BowlerRunUpForEvidence => bowlerRunUp == null
            ? "code-authored"
            : string.Format(System.Globalization.CultureInfo.InvariantCulture,
                "composed {0} D={1:0.###} exit={2} steps={3} hold={4:0.###} preRoll={5:0.###} scale={6:0.####} heightResidualM={7:0.####}",
                bowlerRunUp.Plan.Action, bowlerRunUp.Plan.D, bowlerRunUp.Plan.Exit, bowlerRunUp.Plan.Steps,
                bowlerRunUp.Plan.Hold, bowlerRunUp.Plan.PreRoll, bowlerRunUpScale, bowlerRunUpHeightResidual);

        private void AnimateBowler(float amount)
        {
            amount = Mathf.Clamp01(amount);
            if (bowlerRunUp != null)
            {
                PlaceBowlerOnRunUp(amount * bowlingPresentation.ApproachSeconds);
                if (ball != null && ball.GameObject.activeSelf)
                    bowlerRig.AlignObjectToReleaseHand(ball.GameObject.transform);
                return;
            }
            bowler.transform.rotation = Quaternion.identity;
            bowler.transform.position = Vector3.Lerp(
                bowlerStartPosition,
                bowlerReleasePosition,
                BowlerRootTravelNormalized(amount, bowlingPresentation.Motion));
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            bowlerRig.SampleBowling(
                amount * bowlingPresentation.ReleaseNormalized,
                bowlingCue);
            if (ball != null && ball.GameObject.activeSelf)
                bowlerRig.AlignObjectToReleaseHand(ball.GameObject.transform);
        }

        private void AnimateBowlerFollowThrough(double secondsAfterRelease)
        {
            if (bowlerRunUp != null)
            {
                AnimateComposedFollowThrough(secondsAfterRelease);
                return;
            }
            var t = (float)Math.Max(0.0, secondsAfterRelease);
            // HUM U4 clock: the follow-through advances the bowling clip at the run-up's own rate (it previously jumped
            // several times faster at release), and the root keeps the release speed, braking to a stop.
            var phaseRate = bowlingPresentation.ReleaseNormalized / Mathf.Max(0.1f, bowlingPresentation.ApproachSeconds);
            var phase = Mathf.Min(1f, bowlingPresentation.ReleaseNormalized + t * phaseRate);
            var releaseSpeed = BowlerReleaseTravelRate(bowlingPresentation.Motion) *
                               bowlingPresentation.ApproachDistanceMetres /
                               Mathf.Max(0.1f, bowlingPresentation.ApproachSeconds);
            // A right-arm bowler follows through towards the physics +x side (src/physics/field.ts puts the bowler's
            // fielding spot there), i.e. to his own left; reflected into Unity once like every physics lateral.
            var armSign = (bowlerArmLeft ? -1f : 1f) * PresentationMirror;
            var pace = bowlingPresentation.Role == ProductionCharacterRole.PaceBowler;
            var brakeMetres = pace ? 3.2f : 1.6f;
            var brakeSeconds = Mathf.Max(0.2f, 2f * brakeMetres / Mathf.Max(0.5f, releaseSpeed));
            var u = Mathf.Clamp01(t / brakeSeconds);
            var forward = brakeMetres * (2f * u - u * u);
            var lateral = (pace ? 0.35f : 0.30f) * armSign * u * u * (3f - 2f * u);
            var natural = bowlerReleasePosition + new Vector3(lateral, 0f, forward);
            // HUM U5: the physics places the bowler on his fielding spot from release; he only acts from his first
            // non-"set" sample. Converge from the natural follow-through onto that spot by then (eased from when the
            // result arrived), so the physics path is met exactly before it matters, with no snap.
            if (bowlerPhysicsSpot.HasValue && bowlerSetEndT > bowlerConvergeFromT)
            {
                var w = Mathf.Clamp01((float)((secondsAfterRelease - bowlerConvergeFromT) /
                                              (bowlerSetEndT - bowlerConvergeFromT)));
                w = w * w * (3f - 2f * w);
                natural = Vector3.Lerp(natural, bowlerPhysicsSpot.Value, w);
            }
            var step = natural - bowler.transform.position;
            bowler.transform.position = natural;
            step.y = 0f;
            if (step.sqrMagnitude > 1e-6f)
                bowler.transform.rotation = Quaternion.RotateTowards(bowler.transform.rotation,
                    Quaternion.LookRotation(step.normalized, Vector3.up), 240f / 60f);
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            bowlerRig.SampleBowling(phase, bowlingCue);
        }

        /// <summary>
        /// The composed follow-through (MOTION-BOWL's own, in the composed clip), converging onto the physics bowler's
        /// fielding spot by his first non-"set" sample (HUM U5); after the follow-through he stands and steps on the
        /// locomotion gait rather than freezing.
        /// </summary>
        private void AnimateComposedFollowThrough(double secondsAfterRelease)
        {
            var t = Math.Max(0.0, secondsAfterRelease);
            var dt = double.IsNaN(bowlerFollowLastT) ? 1.0 / 60.0 : Math.Max(0.0, t - bowlerFollowLastT);
            bowlerFollowLastT = t;
            var composedT = bowlerRunUp.TRelease + t;
            var natural = BowlerRunUpRoot(Math.Min(composedT, bowlerRunUp.TEnd));
            if (bowlerPhysicsSpot.HasValue && bowlerSetEndT > bowlerConvergeFromT)
            {
                var w = Mathf.Clamp01((float)((secondsAfterRelease - bowlerConvergeFromT) /
                                              (bowlerSetEndT - bowlerConvergeFromT)));
                w = w * w * (3f - 2f * w);
                natural = Vector3.Lerp(natural, bowlerPhysicsSpot.Value, w);
            }
            if (bowlerGait == null || bowlerGait.Rig != bowlerRig) bowlerGait = new ProductionGaitPresenter(bowlerRig);
            if (composedT <= bowlerRunUp.TEnd)
            {
                bowler.transform.SetPositionAndRotation(natural,
                    Quaternion.AngleAxis(BowlerRunUpYaw(Math.Min(composedT, bowlerRunUp.TEnd)), Vector3.up));
                bowlerRunUp.Sample(Math.Min(composedT, bowlerRunUp.TEnd), bowlerPackPose);
                bowlerRig.ApplyPose(bowlerPackPose);
                ReachBowlerReleaseResidual(Math.Min(composedT, bowlerRunUp.TEnd));
            }
            else
            {
                if (!bowlerFollowGaitHanded)
                {
                    bowlerGait.BlendFromCurrent(0.25f);
                    bowlerFollowGaitHanded = true;
                }
                bowlerGait.Present(natural, BowlerRunUpYaw(bowlerRunUp.TEnd), (float)dt, ProductionFieldingClip.Ready);
            }
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
        }

        private void UpdateProvisionalBat()
        {
            if (canonicalBat) return;
            if (!localPreparation)
            {
                // HUM U6: a living address through the whole run-up (it was a statue until the player pressed): TRACKB's
                // anticipation (stance, trigger, backlift, ready hold), else the code-authored stance loop. No stroke
                // moves the bat before the player's input.
                provisionalStrokePhase = 0f;
                if (PresentStrikerAnticipation(timeline, true)) return;
                batterRig.SampleAndApply(ProductionCharacterMotion.BatterStance,
                    Mathf.Repeat((float)Math.Max(0.0, timeline + bowlingPresentation.ApproachSeconds) / 2.4f, 1f));
                return;
            }
            if (provisionalSwing == null)
            {
                if (localBatPreviewActive)
                {
                    // The local response enters the early stride with the
                    // backlift, but stops well before foot plant/contact. Its
                    // only purpose is to make the player's live press and drag
                    // visibly legible while TypeScript normalizes the trace.
                    provisionalStrokePhase = Mathf.Lerp(
                        ProductionCharacterMotionSampler.BatterBacklift - 0.03f,
                        ProductionCharacterMotionSampler.BatterFootPlant * 0.72f,
                        localBatPreview.Reach);
                    batterRig.SampleBatterStroke(
                        provisionalStrokePhase,
                        ProductionBatterFootworkAdapter.FromHostIntent(
                            string.IsNullOrEmpty(localBatPreview.Footwork)
                                ? "auto"
                                : localBatPreview.Footwork));
                    bat.transform.localRotation *= Quaternion.Euler(
                        localBatPreview.Vertical * 10f,
                        localBatPreview.Horizontal * 18f * PresentationMirror,
                        -localBatPreview.Horizontal * 6f * PresentationMirror);
                    batterRig.CoupleBatterHandsToCurrentBat(1f);
                    return;
                }
                provisionalStrokePhase = 0f;
                // CTL1: the press draws the bat along the touch-down stroke (ProductionTouchDownBat) over the waiting
                // bat; the body stays in the anticipation.
                if (PresentStrikerAnticipation(timeline, true, !double.IsNaN(touchDownT))) return;
                batterRig.SampleAndApply(ProductionCharacterMotion.BatterStance,
                    Mathf.Repeat((float)Math.Max(0.0, timeline + bowlingPresentation.ApproachSeconds) / 2.4f, 1f));
                return;
            }

            var elapsed = Math.Max(0.0, timeline - provisionalSwing.StartT);
            var progress = Mathf.Clamp01((float)(elapsed / 0.36));
            var direction = (float)provisionalSwing.DirectionDeg * PresentationMirror;
            var elevation = (float)provisionalSwing.Elevation;
            var power = (float)provisionalSwing.Power;
            provisionalStrokePhase = Mathf.Lerp(
                0.05f, 0.82f, Mathf.SmoothStep(0f, 1f, progress));
            var joining = false;
            var joinAmount = 1f;
            if (!double.IsNaN(touchCommitT))
            {
                // Joined from the touch-down stroke over TouchCommitSeconds (bat.ts withTouch), with no jump: the body
                // from the code-authored stroke's waiting pose, the bat from what the press was drawing.
                var join = Mathf.Clamp01((float)((timeline - touchCommitT) / TouchCommitSeconds));
                joinAmount = join * join * (3f - 2f * join);
                joining = join < 1f;
                provisionalStrokePhase = Mathf.Lerp(ProductionCharacterMotionSampler.BatterBacklift,
                    provisionalStrokePhase, joinAmount);
            }
            var swingTurns = Quaternion.Euler(elevation * 14f, direction * 0.42f, power * 8f * PresentationMirror);
            if (ProvisionalPackBodyEnabled)
            {
                // UNITY-5 F2: until the result arrives the body stays in TRACKB's load (the anticipation, which every stroke clip
                // begins from: frame 0 of the compact ready hold), as it was through the press; the code-authored stroke's body
                // differed from the pack's by about 100 degrees at the hips and chest and drove the chest at 11 to 22 degrees a
                // frame (2.1x its cap) from the commitment. Only the bat is the code-authored stroke's (measured on the driver
                // joints alone, as the press's hitting pose is) and the hands reach it.
                // UNITY-7 B: the bat is the swing's predicted physics bat (ProductionPredictedSwingBat), not the code-authored
                // stroke's (hands 0.96 m high, 62 to 90 cm from the physics bat in the frame the result arrived).
                ProductionTouchDownBat.BatPose committedBat;
                if (!PredictedCommittedBat(timeline, out committedBat))
                {
                    Vector3 legacyGrip, legacyToe, legacyFace;
                    batterRig.LegacyStrokeBatPose(provisionalStrokePhase, provisionalFootwork, swingTurns,
                        out legacyGrip, out legacyToe, out legacyFace);
                    committedBat = new ProductionTouchDownBat.BatPose { Grip = legacyGrip, Toe = legacyToe, Face = legacyFace };
                }
                var shownBat = joining ? JoinedProvisionalBat(committedBat, joinAmount) : committedBat;
                if (PresentStrikerAnticipation(timeline, true, false, true, shownBat)) return;
            }
            batterRig.SampleBatterStroke(provisionalStrokePhase, provisionalFootwork);
            bat.transform.localRotation *= swingTurns;
            if (joining) JoinTouchDownBat(joinAmount);
            batterRig.CoupleBatterHandsToCurrentBat(1f);
        }

        /// <summary>
        /// Builder seam (A/B in one build): false keeps the code-authored stroke's body through a committed swing, and no live
        /// result plays TRACKB's stroke clip, as before UNITY-5 F2; true (the default) keeps the pack's load until the result and
        /// plays the family's clip from the input once it arrives (PreparePackStroke).
        /// </summary>
        internal bool ProvisionalPackBodyEnabled { get; set; } = true;

        /// <summary>
        /// The committed bat's first 40 ms (JoinTouchDownBat's blend, for a body that is not the code-authored stroke's): the
        /// bat leaves the uncommitted drawing (what the press was drawing, or the waiting bat) for the committed bat rigidly.
        /// </summary>
        private ProductionTouchDownBat.BatPose JoinedProvisionalBat(ProductionTouchDownBat.BatPose committed, float amount)
        {
            ProductionTouchDownBat.BatPose open;
            if (!TouchDownBatAt(timeline, out open))
            {
                Vector3 grip, toe, face;
                if (!StrikerPackBatWorld(timeline, out grip, out toe, out face)) return committed;
                open = new ProductionTouchDownBat.BatPose { Grip = grip, Toe = toe, Face = face };
            }
            return ProductionTouchDownBat.Rigid(open, committed, amount);
        }

        // The lead's 5f body ruling (2026-11-04), as the web (WEB-HUMANS option A): the striker's feet stand on the
        // physics pads (ProductionBatterBodyModel, the frozen batterBody port): the stance pads until the stroke's swing
        // start, then each foot steps to its stroke pad by min(arrival, contact); a leave stays on the stance pads. The
        // front pad is his anatomical left leg for a right-hander (label right on this "Left" rig).
        private ProductionBatterBodyModel.Body strikerStanceBody = ProductionBatterBodyModel.For(null, null, 0.0);
        private ProductionBatterBodyModel.Body? strikerStrokeBody;
        private double strikerStrideAt = double.PositiveInfinity;
        private double strikerStrideDue = double.PositiveInfinity;
        // Lead ruling 2026-11-04 05:54Z: the physics pads govern the stride's timing and placement only when the physics
        // has a pad or body event, or the ball's drawn path passes within 3 cm of the drawn legs (script.ts
        // strideMustPlant); otherwise the stroke's own stride is drawn at its natural pace and placement from the input.
        private bool strikerStrideGoverned;
        private double strikerStridePlantAt = double.PositiveInfinity;
        /// <summary>The footwork stride plants this long into its clip (script.ts STRIDE_PLANT_MS).</summary>
        internal const double StridePlantSeconds = 0.32;
        /// <summary>The quickest a governed stride is played to plant inside a short window (STRIDE_MAX_RATE).</summary>
        internal const double StrideMaxRate = 3.0;
        /// <summary>How near (m, beyond touching) the ball may pass a moving pad before the stride must plant.</summary>
        internal const double StrideBallClearMetres = 0.03;

        /// <summary>
        /// A result that arrives after the input finds the stroke's stride already under way (it runs from the input, never
        /// from the result). The feet reach where the stride has got to over this long from the result instead of in one frame
        /// (thin-edge: a foot jumped 30 cm).
        /// </summary>
        internal const double StrideCatchUpSeconds = 0.1;
        private double strikerStrideCatchUpStart = double.NaN;

        private void PrepareStrikerPhysicsBody(PracticeResultPresentation result)
        {
            strikerStrideCatchUpStart = double.NaN;
            strikerStrokeBody = null;
            strikerStrideAt = double.PositiveInfinity;
            strikerStrideDue = double.PositiveInfinity;
            strikerStrideGoverned = false;
            strikerStridePlantAt = double.PositiveInfinity;
            if (result == null || result.Trace == null || delivery == null || delivery.Flight == null) return;
            var footwork = result.Footwork;
            if (footwork != "forward" && footwork != "back" && footwork != "across" && footwork != "down_track") return;
            if (!canonicalStrokeAvailable || result.Trace.batterMotion == null) return;
            strikerStrokeBody = ProductionBatterBodyModel.For(footwork, delivery.Flight, delivery.IdealContactT);
            // Lead ruling 2026-11-04: the stride starts at the player's input (the normalized swing start), never at the
            // physics bat's first sample (which Learn/Play forgiveness can put up to 82 ms earlier).
            strikerStrideAt = result.SwingStartT ?? (provisionalSwing != null
                ? provisionalSwing.StartT
                : result.Trace.batterMotion.startT);
            var arrival = ProductionBatterBodyModel.IdealTimeFor(delivery.Flight, delivery.IdealContactT, footwork);
            var due = arrival;
            foreach (var item in result.Trace.events)
            {
                if (item == null || item.kind != "contact") continue;
                if (item.contact != "miss" && item.contact != "leave") due = Math.Min(due, item.t);
                break;
            }
            strikerStrideDue = Math.Max(strikerStrideAt + 1.0 / 60.0, due);
            strikerStrideGoverned = StrideMustPlant(result, strikerStrideAt);
            if (strikerStrideGoverned)
            {
                // Planted on the physics pads by the contact or the ball's arrival, played at most 3x its own pace
                // (a later plant is reported, never led): strideWindow.
                var window = strikerStrideDue - strikerStrideAt;
                var rate = Math.Min(StrideMaxRate, Math.Max(1.0, StridePlantSeconds / Math.Max(1e-3, window)));
                strikerStridePlantAt = strikerStrideAt + StridePlantSeconds / rate;
            }
            else strikerStridePlantAt = strikerStrideAt + StridePlantSeconds;
            var acceptedAt = Math.Max(0.0, timeline);
            if (strikerStrideAt < acceptedAt - 1e-6) strikerStrideCatchUpStart = acceptedAt;
        }

        /// <summary>
        /// script.ts strideMustPlant: (a) the physics has a pad or body event, or (b) the ball's path passes within
        /// StrideBallClearMetres of either pad as drawn on its way across at the stride's own pace (each pad's axis
        /// eased from its stance place to its stroke place over StridePlantSeconds; a pad capsule's radius plus the
        /// ball's), so the ball is never drawn through a leg the physics had moved away.
        /// </summary>
        private bool StrideMustPlant(PracticeResultPresentation result, double strideAt)
        {
            var trace = result.Trace;
            foreach (var item in trace.events)
                if (item != null && (item.kind == "pad" || item.kind == "contact" && item.contact == "body")) return true;
            if (!strikerStrokeBody.HasValue || trace.ball == null || trace.ball.Length == 0) return false;
            var stroke = strikerStrokeBody.Value;
            var root = trace.batterRootOffset;
            var near = ProductionBatterBodyModel.PadR + CricketPropDimensions.BallRadius + StrideBallClearMetres;
            var top = strikerStanceBody.FrontPad.B.Y + ProductionBatterBodyModel.PadR + CricketPropDimensions.BallRadius;
            var stancePads = new[] { strikerStanceBody.FrontPad, strikerStanceBody.BackPad };
            var strokePads = new[] { stroke.FrontPad, stroke.BackPad };
            for (var t = strideAt; t <= strideAt + StridePlantSeconds + 1e-9; t += 1.0 / 120.0)
            {
                var b = BallPhysicsAt(trace.ball, t);
                if (b == null || b.y > top) continue;
                var x01 = Math.Max(0.0, Math.Min(1.0, (t - strideAt) / StridePlantSeconds));
                var u = x01 * x01 * (3.0 - 2.0 * x01);
                for (var i = 0; i < 2; i++)
                {
                    var x = stancePads[i].A.X + (strokePads[i].A.X - stancePads[i].A.X) * u + (root != null ? root.x : 0.0);
                    var z = stancePads[i].A.Z + (strokePads[i].A.Z - stancePads[i].A.Z) * u + (root != null ? root.z : 0.0);
                    var dx = b.x - x;
                    var dz = b.z - z;
                    if (Math.Sqrt(dx * dx + dz * dz) < near) return true;
                }
            }
            return false;
        }

        /// <summary>The physics ball (physics frame) at t, linear between the trace's samples; null when none.</summary>
        private static TraceVector3 BallPhysicsAt(BallTraceSample[] samples, double t)
        {
            if (samples == null || samples.Length == 0) return null;
            if (t <= samples[0].t) return samples[0].p;
            if (t >= samples[samples.Length - 1].t) return samples[samples.Length - 1].p;
            var lo = 0;
            var hi = samples.Length - 1;
            while (hi - lo > 1)
            {
                var mid = (lo + hi) / 2;
                if (samples[mid].t <= t) lo = mid;
                else hi = mid;
            }
            var a = samples[lo].p;
            var c = samples[hi].p;
            if (a == null || c == null) return a ?? c;
            var span = samples[hi].t - samples[lo].t;
            var g = span > 0.0 ? (t - samples[lo].t) / span : 0.0;
            return new TraceVector3 { x = a.x + (c.x - a.x) * g, y = a.y + (c.y - a.y) * g, z = a.z + (c.z - a.z) * g };
        }

        private Vector3 StrikerPadGround(ProductionBatterBodyModel.Capsule pad)
        {
            var carried = batterBody != null ? batterBody.transform.position - nominalBatterWorldPosition : Vector3.zero;
            return PhysicsGround((float)pad.A.X, (float)pad.A.Z) + new Vector3(carried.x, 0f, carried.z);
        }

        /// <summary>The pads the striker's feet stand on now (front, back), Unity world ground points.</summary>
        internal void StrikerPadsForEvidence(out Vector3 front, out Vector3 back)
        {
            var body = strikerStrokeBody.HasValue && timeline >= strikerStrideDue ? strikerStrokeBody.Value : strikerStanceBody;
            front = StrikerPadGround(body.FrontPad);
            back = StrikerPadGround(body.BackPad);
        }

        private ProductionFootLock strikerFootLock;
        private bool strikerPadStepPending;
        private double strikerPadStepStartT;
        private Vector3 strikerPadStepFromFront, strikerPadStepFromBack, strikerPadStepToFront, strikerPadStepToBack;
        private const double StancePadStepSeconds = 0.12;
        private const float StancePadStepLiftMetres = 0.05f;

        /// <summary>
        /// At a result's acceptance: when the carry will move the stance pads more than 2 cm (to the physics root), the
        /// feet re-step onto them (PlantStrikerOnPhysicsPads) rather than slide with the carry.
        /// </summary>
        private void PrepareStancePadStep(CanonicalDeliveryTrace trace)
        {
            strikerPadStepPending = false;
            if (trace == null || trace.batterRootOffset == null || batterBody == null) return;
            var fromFront = StrikerPadGround(strikerStanceBody.FrontPad);
            var fromBack = StrikerPadGround(strikerStanceBody.BackPad);
            var root = new Vector3(PresentationMirror * (float)trace.batterRootOffset.x, 0f, (float)trace.batterRootOffset.z);
            var toFront = PhysicsGround((float)strikerStanceBody.FrontPad.A.X, (float)strikerStanceBody.FrontPad.A.Z) + root;
            var toBack = PhysicsGround((float)strikerStanceBody.BackPad.A.X, (float)strikerStanceBody.BackPad.A.Z) + root;
            if (Vector3.Distance(fromFront, toFront) <= 0.02f && Vector3.Distance(fromBack, toBack) <= 0.02f) return;
            strikerPadStepFromFront = fromFront;
            strikerPadStepFromBack = fromBack;
            strikerPadStepToFront = toFront;
            strikerPadStepToBack = toBack;
            strikerPadStepStartT = Math.Max(0.0, timeline);
            strikerPadStepPending = true;
        }

        private void PlantStrikerOnPhysicsPads(float deltaSeconds)
        {
            if (batterRig == null || strikerRunning || state == WorldState.Idle && strikerRunning) return;
            var t = playback != null && state != WorldState.RunUp && state != WorldState.Flight ? playback.Time : timeline;
            var frontStance = StrikerPadGround(strikerStanceBody.FrontPad);
            var backStance = StrikerPadGround(strikerStanceBody.BackPad);
            Vector3 front = frontStance, back = backStance;
            float frontLift = 0f, backLift = 0f;
            if (strikerPadStepPending)
            {
                // The result's root carry moves the stance pads to the physics root (here 4.5 cm on grounded-attack):
                // the planted feet re-step onto them, lifted, one then the other, instead of sliding with the carry
                // (lead r4 gate: no foot slide over 2 cm while down, the whole delivery).
                var u = (float)((t - strikerPadStepStartT) / (2.0 * StancePadStepSeconds));
                var uf = Mathf.Clamp01(u * 2f);
                var ub = Mathf.Clamp01(u * 2f - 1f);
                front = Vector3.Lerp(strikerPadStepFromFront, strikerPadStepToFront, uf * uf * (3f - 2f * uf));
                back = Vector3.Lerp(strikerPadStepFromBack, strikerPadStepToBack, ub * ub * (3f - 2f * ub));
                frontLift = StancePadStepLiftMetres * Mathf.Sin(Mathf.PI * uf);
                backLift = StancePadStepLiftMetres * Mathf.Sin(Mathf.PI * ub);
                if (u >= 1f) strikerPadStepPending = false;
                frontStance = front;
                backStance = back;
            }
            if (strikerStrokeBody.HasValue && t > strikerStrideAt && !strikerStrideGoverned)
            {
                // Natural (lead ruling 05:54Z): from the input each foot leaves its stance pad, lifted, for where the
                // stroke's own stride puts it, at the stride's own pace (planted StridePlantSeconds in), the foot that
                // leads the footwork first; then the stroke's own legs, a real back-and-across included.
                var natural = Mathf.Clamp01((float)((t - strikerStrideAt) / StridePlantSeconds));
                var footwork = strikerStrokeBody.Value.Footwork;
                var frontLeads = footwork == "forward" || footwork == "down_track";
                var nf = StepPhase(natural, frontLeads, false);
                var nb = StepPhase(natural, !frontLeads, false);
                var catchUp = StrideCatchUp(t);
                var keepFront = 1f - (nf * nf * (3f - 2f * nf)) * catchUp;
                var keepBack = 1f - (nb * nb * (3f - 2f * nb)) * catchUp;
                var liftFront = NaturalStepLiftMetres * Mathf.Sin(Mathf.PI * nf) * catchUp;
                var liftBack = NaturalStepLiftMetres * Mathf.Sin(Mathf.PI * nb) * catchUp;
                if (natural >= 1f)
                {
                    // Planted where the stroke's own stride put them: the feet are held there (re-stepping, lifted,
                    // if the stroke carries the body more than 8 cm over a foot), never slid by the stroke's legs.
                    if (strikerFootLock == null || strikerFootLock.Rig != batterRig)
                        strikerFootLock = new ProductionFootLock(batterRig);
                    strikerFootLock.Apply(deltaSeconds);
                    return;
                }
                strikerFootLock?.Reset();
                var labelRightFront = batterRig.Handedness == ProductionCharacterHandedness.Left;
                batterRig.PlantBatterAnklesOn(
                    labelRightFront ? back : front, labelRightFront ? keepBack : keepFront,
                    labelRightFront ? liftBack : liftFront,
                    labelRightFront ? front : back, labelRightFront ? keepFront : keepBack,
                    labelRightFront ? liftFront : liftBack);
                return;
            }
            if (strikerStrokeBody.HasValue && t > strikerStrideAt)
            {
                var frontStroke = StrikerPadGround(strikerStrokeBody.Value.FrontPad);
                var backStroke = StrikerPadGround(strikerStrokeBody.Value.BackPad);
                // Governed: on the physics pads by strideWindow's plant (at most 3x the stride's own pace).
                var u = Mathf.Clamp01((float)((t - strikerStrideAt) / (strikerStridePlantAt - strikerStrideAt)));
                var frontTravel = Vector3.Distance(frontStance, frontStroke);
                var backTravel = Vector3.Distance(backStance, backStroke);
                // The foot that travels further steps first over [0, 0.7], the other over [0.3, 1]; one that travels
                // 2 cm or less is eased, not lifted (the web's stride).
                var frontFirst = frontTravel >= backTravel;
                var uf = StepPhase(u, frontFirst, backTravel <= 0.02f);
                var ub = StepPhase(u, !frontFirst, frontTravel <= 0.02f);
                var catchUp = StrideCatchUp(t);
                front = Vector3.Lerp(frontStance, frontStroke, uf * uf * (3f - 2f * uf) * catchUp);
                back = Vector3.Lerp(backStance, backStroke, ub * ub * (3f - 2f * ub) * catchUp);
                frontLift = frontTravel > 0.02f ? Mathf.Min(0.07f, 0.02f + 0.3f * frontTravel) * Mathf.Sin(Mathf.PI * uf) * catchUp : 0f;
                backLift = backTravel > 0.02f ? Mathf.Min(0.07f, 0.02f + 0.3f * backTravel) * Mathf.Sin(Mathf.PI * ub) * catchUp : 0f;
            }
            var frontIsLabelRight = batterRig.Handedness == ProductionCharacterHandedness.Left;
            batterRig.PlantBatterAnklesOn(
                frontIsLabelRight ? back : front, 1f, frontIsLabelRight ? backLift : frontLift,
                frontIsLabelRight ? front : back, 1f, frontIsLabelRight ? frontLift : backLift);
        }

        /// <summary>How much of the stride's progress the feet show at t: 0 at a late result, 1 StrideCatchUpSeconds later (1 when the stride began at or after the result).</summary>
        private float StrideCatchUp(double t)
        {
            if (double.IsNaN(strikerStrideCatchUpStart)) return 1f;
            var x = Mathf.Clamp01((float)((t - strikerStrideCatchUpStart) / StrideCatchUpSeconds));
            return x * x * (3f - 2f * x);
        }

        /// <summary>A natural stride's step lift (m) at mid-step: the foot clears the turf as it leaves its stance pad.</summary>
        private const float NaturalStepLiftMetres = 0.05f;

        private static float StepPhase(float u, bool first, bool otherStill)
        {
            if (otherStill) return u;
            return first ? Mathf.Clamp01(u / 0.7f) : Mathf.Clamp01((u - 0.3f) / 0.7f);
        }

        private bool LoadStrikerAnticipation()
        {
            if (strikerPackLoaded) return batStanceLive != null;
            strikerPackLoaded = true;
            batStanceLive = ProductionMotionPacks.Clip("batter", "bat_stance_live");
            batTrigger = ProductionMotionPacks.Clip("batter", "bat_trigger");
            // The compact backlift when TRACKB's compact pair is in the pack, else the standard one: the same choice as
            // the web (strikerPreSwing), so both renderers show the same batter from the same bytes.
            var compactLift = ProductionMotionPacks.Clip("batter", "bat_backlift_compact");
            var compactHold = ProductionMotionPacks.Clip("batter", "bat_ready_hold_compact");
            var compact = compactLift != null && compactHold != null;
            batBacklift = compact ? compactLift : ProductionMotionPacks.Clip("batter", "bat_backlift");
            batReadyHold = compact ? compactHold : ProductionMotionPacks.Clip("batter", "bat_ready_hold");
            if (batStanceLive == null) return false;
            var pack = ProductionMotionPacks.Get("batter");
            strikerPackPose = new ProductionPackPose(pack.MaxTrackCount);
            strikerPackBlendPose = new ProductionPackPose(pack.MaxTrackCount);
            return true;
        }

        /// <summary>
        /// The striker's anticipation at simulation time t (release at 0) during a delivery, or at a free-running clock
        /// between balls. The pack's actor frame (+X towards the bowler, +Z to a right-hander's off side) is placed with
        /// the one reflection: actor (x, y, z) -> Unity (m z, y, -x) about the striker's root, m = PresentationMirror.
        /// Returns false when the batter pack is not shipped (the code-authored stance is the fallback).
        /// </summary>
        /// <summary>The waiting bat at t (TRACKB's anticipation bat), placed in the world exactly as the anticipation.</summary>
        private bool StrikerPackBatWorld(double t, out Vector3 grip, out Vector3 toe, out Vector3 face)
        {
            grip = toe = face = Vector3.zero;
            if (batterRig == null || batterBody == null || !LoadStrikerAnticipation()) return false;
            if (strikerPackProbePose == null)
            {
                var pack = ProductionMotionPacks.Get("batter");
                strikerPackProbePose = new ProductionPackPose(pack.MaxTrackCount);
                strikerPackProbeBlendPose = new ProductionPackPose(pack.MaxTrackCount);
            }
            Vector3 cap, t0, f0;
            if (!SampleStrikerPack(t, true, strikerPackProbePose, strikerPackProbeBlendPose, out cap, out t0, out f0))
                return false;
            var scale = batterRig.Root.localScale.x;
            var origin = PhysicsGround(StanceRootPhysicsX, StanceRootPhysicsZ) +
                         new Vector3(batterBody.transform.position.x - nominalBatterWorldPosition.x, 0f,
                             batterBody.transform.position.z - nominalBatterWorldPosition.z);
            var actor = Quaternion.AngleAxis(90f * PresentationMirror, Vector3.up);
            grip = origin + actor * (cap * scale);
            toe = origin + actor * (t0 * scale);
            face = f0.sqrMagnitude > 1e-6f ? actor * f0 : Vector3.zero;
            return true;
        }

        private ProductionPackPose strikerPackProbePose;
        private ProductionPackPose strikerPackProbeBlendPose;

        /// <summary>
        /// The presented bat (docs/PRACTICE_PRESENTATION.md "The presented bat"; src/render3d/practice/bat.ts
        /// presentedBatPose): until the player's input the waiting bat; from it a rigid blend (the hands travel
        /// straight, the blade turns about them) from where the bat waited onto the physics swing, holding the physics'
        /// first (zone-entry) sample until the physics swing starts, complete by the bat contact or, without one, the
        /// swing's velocity peak; from then on exactly the physics bat. It never moves the swing before the input.
        /// </summary>
        private struct PresentedBatPlan
        {
            public bool Valid;
            public double StartT;
            public double EndT;
            public double SpanT;
            public bool Far;
            public double FirstT;
            public Vector3 FromGrip, FromToe, FromFace;
            public Vector3 FirstGrip, FirstToe, FirstFace;
        }

        private PresentedBatPlan presentedBat;
        private const double PresentedBatCatchUpSeconds = 0.06;
        private const float PresentedBatGapMetres = 0.12f;
        private const float PresentedBatGapDegrees = 20f;

        private static bool IsBatContactKind(string contact) =>
            contact == "middle" || contact == "inside_edge" || contact == "outside_edge" || contact == "top_edge" ||
            contact == "leading_edge";

        private void PreparePresentedBat(PracticeResultPresentation result)
        {
            presentedBat = default;
            var trace = result?.Trace;
            if (trace == null || trace.bat == null || trace.bat.Length == 0 || !canonicalStrokeAvailable) return;
            // Live, the provisional swing has already left the waiting bat at the input and the carry takes the bat on
            // screen onto the physics bat; the presented blend is for a result known before the input (a replay, or a
            // result accepted early), where the waiting bat would otherwise jump onto the physics' first sample.
            if (provisionalSwing != null || localBatPreviewActive) return;
            var start = result.SwingStartT;
            if (!start.HasValue) return;
            double? end = null;
            foreach (var item in trace.events)
            {
                if (item == null || item.kind != "contact") continue;
                if (IsBatContactKind(item.contact)) end = item.t;
                break;
            }
            if (!end.HasValue && trace.batterMotion != null) end = trace.batterMotion.contactT;
            Vector3 fromGrip, fromToe, fromFace;
            if (!StrikerPackBatWorld(start.Value, out fromGrip, out fromToe, out fromFace)) return;
            var first = trace.bat[0];
            presentedBat.FirstT = first.t;
            presentedBat.FirstGrip = ToUnity(first.grip);
            presentedBat.FirstToe = ToUnity(first.toe);
            presentedBat.FirstFace = ToUnity(first.face);
            presentedBat.FromGrip = fromGrip;
            presentedBat.FromToe = fromToe;
            presentedBat.FromFace = fromFace;
            presentedBat.StartT = start.Value;
            presentedBat.EndT = end ?? double.PositiveInfinity;
            // The gap at the input: the waiting bat against the swing's target then (the zone-entry pose before the
            // physics swing starts). A far start is joined over input -> contact, a near one in CATCH_UP_MS.
            Vector3 g0, t0, f0;
            if (start.Value < first.t)
            {
                g0 = presentedBat.FirstGrip;
                t0 = presentedBat.FirstToe;
                f0 = presentedBat.FirstFace;
            }
            else
            {
                var at = CanonicalTracePlayback.CreateBatEvaluator(trace.bat, null, trace.batterMotion?.contactT)(start.Value);
                g0 = ToUnity(at.grip);
                t0 = ToUnity(at.toe);
                f0 = ToUnity(at.face);
            }
            var hands = (float)(PresentedBatHandsFromCap / BridgeConstants.CanonicalBatLengthMetres);
            var handGap = Vector3.Distance(Vector3.Lerp(fromGrip, fromToe, hands), Vector3.Lerp(g0, t0, hands));
            var angleGap = Vector3.Angle(fromToe - fromGrip, t0 - g0);
            presentedBat.Far = handGap > PresentedBatGapMetres || angleGap > PresentedBatGapDegrees;
            var window = presentedBat.EndT - presentedBat.StartT;
            presentedBat.SpanT = presentedBat.Far && !double.IsInfinity(presentedBat.EndT)
                ? window
                : Math.Min(PresentedBatCatchUpSeconds, double.IsInfinity(window) ? PresentedBatCatchUpSeconds : window);
            presentedBat.Valid = true;
        }

        /// <summary>Halfway between the hands from the cap (m): the rigid blend turns the bat about them.</summary>
        private static readonly double PresentedBatHandsFromCap =
            (ProductionCharacterRig.BatterTopHandGripOffsetMetres + ProductionCharacterRig.BatterLowerHandGripOffsetMetres) * 0.5;

        /// <summary>Replaces the physics bat at t (already carried) with the presented bat (see PresentedBatPlan).</summary>
        private void PresentedBatAt(double t, ref Vector3 grip, ref Vector3 toe, ref Vector3 face)
        {
            if (!presentedBat.Valid || t >= presentedBat.EndT) return;
            if (t < presentedBat.StartT)
            {
                // Never before the input: the bat the striker waits in (a forgiven physics bat may start up to 82 ms
                // earlier).
                Vector3 g, tt, f;
                if (StrikerPackBatWorld(t, out g, out tt, out f))
                {
                    grip = g;
                    toe = tt;
                    face = f;
                }
                return;
            }
            if (t < presentedBat.FirstT)
            {
                grip = presentedBat.FirstGrip;
                toe = presentedBat.FirstToe;
                face = presentedBat.FirstFace;
            }
            var x = presentedBat.SpanT > 0.0 ? (t - presentedBat.StartT) / presentedBat.SpanT : 1.0;
            if (x >= 1.0) return;
            var smooth = x * x * (3.0 - 2.0 * x);
            // A far closing starts moving at the input (half linear, half smoothstep: peak rate 1.25x the mean).
            var u = (float)(presentedBat.Far ? 0.5 * Math.Max(0.0, x) + 0.5 * smooth : smooth);
            var length = (float)BridgeConstants.CanonicalBatLengthMetres;
            var handsAt = (float)PresentedBatHandsFromCap;
            Func<Vector3, Vector3, Vector3, Quaternion> frame = (g, tt, f) =>
            {
                var along = (tt - g).normalized;
                var up = f - along * Vector3.Dot(f, along);
                return Quaternion.LookRotation(along, up.sqrMagnitude > 1e-8f ? up.normalized : Vector3.up);
            };
            var qa = frame(presentedBat.FromGrip, presentedBat.FromToe, presentedBat.FromFace);
            var qb = frame(grip, toe, face);
            var q = Quaternion.Slerp(qa, qb, u);
            var dir = q * Vector3.forward;
            var hands = Vector3.Lerp(
                presentedBat.FromGrip + (presentedBat.FromToe - presentedBat.FromGrip).normalized * handsAt,
                grip + (toe - grip).normalized * handsAt, u);
            grip = hands - dir * handsAt;
            toe = grip + dir * length;
            face = q * Vector3.up;
        }

        /// <summary>
        /// TRACKB's anticipation at time t (the same clip choice as the web's strikerPreSwing: the live stance, the
        /// trigger before the presented release, the backlift from it, then the ready hold), sampled into `into` with
        /// the stance blend; returns the pack's bat (actor frame). Pure: it poses nothing.
        /// </summary>
        private bool SampleStrikerPack(double t, bool delivering, ProductionPackPose into, ProductionPackPose blend,
            out Vector3 cap, out Vector3 toe, out Vector3 face)
        {
            cap = toe = face = Vector3.zero;
            if (!LoadStrikerAnticipation()) return false;
            var leftHander = settings != null && settings.Handedness == "left";
            VmpClip clip = batStanceLive;
            var local = 0.0;
            var blendFromStance = 0f;
            var stanceT = delivering ? t + bowlingPresentation.ApproachSeconds : t;
            float triggerRelease;
            if (!delivering || batTrigger == null || batBacklift == null || batReadyHold == null ||
                !batTrigger.TryGetMarker("release", out triggerRelease))
            {
                local = Math.Max(0.0, stanceT);
            }
            else if (t < -triggerRelease)
            {
                local = Math.Max(0.0, stanceT);
            }
            else if (t < 0.0)
            {
                clip = batTrigger;
                local = t + triggerRelease;
                // The live stance is a loop at an arbitrary phase; the trigger starts at its frame 0 (web: 160 ms).
                blendFromStance = 1f - Mathf.Clamp01((float)(local / StrikerStanceBlendSeconds));
            }
            else
            {
                // The backlift's `release` marker sits on the presented release (web: liftAt), then the ready hold.
                float liftRelease;
                if (!batBacklift.TryGetMarker("release", out liftRelease)) liftRelease = 0f;
                var lift = t + liftRelease;
                if (lift < batBacklift.Duration)
                {
                    clip = batBacklift;
                    local = lift;
                }
                else
                {
                    clip = batReadyHold;
                    local = lift - batBacklift.Duration;
                }
            }
            into.SampleInto(clip, local, leftHander);
            if (!into.TryGetBatCapToe((float)BridgeConstants.CanonicalBatLengthMetres, out cap, out toe, out face))
                return false;
            if (blendFromStance > 0f)
            {
                blend.SampleInto(batStanceLive, Math.Max(0.0, stanceT), leftHander);
                Vector3 cap0, toe0, face0;
                if (blend.TryGetBatCapToe((float)BridgeConstants.CanonicalBatLengthMetres,
                        out cap0, out toe0, out face0))
                {
                    var keep = blendFromStance * blendFromStance * (3f - 2f * blendFromStance);
                    ProductionFieldingClips.Blend(into.Pose, blend.Pose, keep);
                    cap = Vector3.Lerp(cap, cap0, keep);
                    toe = Vector3.Lerp(toe, toe0, keep);
                    face = Vector3.Slerp(face, face0, keep);
                }
            }
            return true;
        }

        private bool PresentStrikerAnticipation(double t, bool delivering, bool touchDown = false, bool hasBatOverride = false,
            ProductionTouchDownBat.BatPose batOverride = default(ProductionTouchDownBat.BatPose))
        {
            if (batterRig == null || batterBody == null || !LoadStrikerAnticipation()) return false;
            Vector3 cap, toe, face;
            if (!SampleStrikerPack(t, delivering, strikerPackPose, strikerPackBlendPose, out cap, out toe, out face))
                return false;
            // Placement exactly as the web (WEB-HUMANS 2026-11-04, script.ts strikerTrack): the actor origin is the
            // nominal stance midpoint STANCE_ROOT (-0.15, 0, 8.96) plus the result's batterRootOffset (here the carried
            // root offset on screen, 0 before a result), through the one reflection; the heading is +90 deg in the
            // physics frame for a right-hander (actor +X to the bowler, +Z to his off side), i.e. 90 * m in Unity; no
            // roll; the clip's ground track is ignored; the hips offset and bat tracks scale with the body.
            var root = batterRig.Root;
            var scale = root.localScale.x;
            var origin = StrikerActorOrigin();
            var actor = Quaternion.AngleAxis(90f * PresentationMirror, Vector3.up);
            var pose = strikerPackPose.Pose;
            if (delivering && leavePlan.Valid) ApplyLeaveOverlay(pose, t);
            PlaceStrikerActorPose(pose);
            Func<Vector3, Vector3> world = v => origin + actor * (v * scale);
            var capWorld = world(cap);
            var toeWorld = world(toe);
            var faceWorld = face.sqrMagnitude > 1e-6f ? actor * face : Vector3.zero;
            // From the input the presented bat leaves the waiting pose for the physics swing (the web's presentedBat);
            // the body stays in the anticipation until the physics bat's first sample, its hands on that bat.
            if (delivering && presentedBat.Valid && t >= presentedBat.StartT)
                PresentedBatAt(t, ref capWorld, ref toeWorld, ref faceWorld);
            // CTL1: an uncommitted press draws the touch-down stroke over the waiting bat (the hands follow it).
            ProductionTouchDownBat.BatPose touched;
            if (touchDown && TouchDownBatAt(t, out touched))
            {
                capWorld = touched.Grip;
                toeWorld = touched.Toe;
                faceWorld = touched.Face;
            }
            // UNITY-5 F2: a committed swing keeps the body in this load and draws its own (provisional) bat, the hands reaching it.
            if (hasBatOverride)
            {
                capWorld = batOverride.Grip;
                toeWorld = batOverride.Toe;
                faceWorld = batOverride.Face;
            }
            // Placed exactly as the web: the physics body-frame alignment must not move this body off its bat (with a
            // result accepted before the physics bat starts it shifted it up to ~0.37 m and the hand IK flipped an
            // elbow, the 169-degree forearm pop). The physics stroke's own poses still align.
            if (hasBatOverride)
            {
                // A committed swing's provisional bat runs away from the load as the code-authored stroke goes (a late result
                // leaves it there for ten frames): the body leans to keep the hands on it (ApplyPackPoseReaching).
                ApplyPackPoseReaching(pose, capWorld, toeWorld, faceWorld, t);
                strikerPackActive = true;
                return true;
            }
            batterRig.PlacedPose = true;
            try
            {
                batterRig.ApplyPose(pose);
                batterRig.SetCanonicalBatPose(capWorld, toeWorld, faceWorld, 1f, false, false);
            }
            finally
            {
                batterRig.PlacedPose = false;
            }
            strikerPackActive = true;
            return true;
        }

        private Vector3 StrikerActorOrigin() =>
            PhysicsGround(StanceRootPhysicsX, StanceRootPhysicsZ) +
            new Vector3(batterBody.transform.position.x - nominalBatterWorldPosition.x, 0f,
                batterBody.transform.position.z - nominalBatterWorldPosition.z);

        /// <summary>
        /// Puts a pack pose sampled in the pack's actor frame on the striker's rig exactly as the web places it (the
        /// actor origin, the +90-degree physics heading through the one reflection, the hips offset scaled), and
        /// resets the bat to the grip ready for the caller's SetCanonicalBatPose.
        /// </summary>
        private void PlaceStrikerActorPose(ProductionCharacterPose pose)
        {
            var root = batterRig.Root;
            var scale = root.localScale.x;
            var origin = StrikerActorOrigin();
            var actor = Quaternion.AngleAxis(90f * PresentationMirror, Vector3.up);
            var toRoot = Quaternion.Inverse(root.rotation);
            pose.Rotations[(int)ProductionCharacterJoint.Hips] =
                toRoot * actor * pose.Rotations[(int)ProductionCharacterJoint.Hips];
            // The rig's hips sit HipsHeight above the motion root in the root's (rolled) frame; place them as if
            // unrolled, so the actor frame is exactly upright like the web's.
            var hipsHeight = new Vector3(0f, ProductionCharacterRig.BatterHipsLocalHeightMetres, 0f);
            pose.RootOffset = toRoot * (actor * pose.RootOffset * scale + (origin - root.position) + hipsHeight * scale) /
                              scale - hipsHeight;
            batterRig.ResetBatToCharacterGrip();
        }

        // ---- TRACKB's batter_strokes: the stroke body from the input (natural case, lead ruling 05:54Z) ----------------

        private struct PackStrokePlan
        {
            public bool Valid;
            public VmpClip Clip;
            public double StartT;
            public double EndT;
            public double ClipStart;
            /// <summary>A governed stride: the clip's `plant` marker (s) and the window (s) from the input it is played to plant in (0: not governed).</summary>
            public double PlantMarker;
            public double PlantWindow;
        }

        /// <summary>
        /// UNITY-8: the shortest input-to-plant window (s) a governed stride may be played in on the pack stroke, by footwork: they keep
        /// the section 9 gates with the smooth warp (src/render3d/practice/script.ts STROKE_MIN_WINDOW_MS = 233.3 forward, 166.7 back).
        /// A shorter window falls back to the code-authored stride that plants in it, as the web.
        /// </summary>
        internal const double StrokeMinWindowForwardSeconds = 0.2333;
        internal const double StrokeMinWindowBackSeconds = 0.1667;

        /// <summary>The smooth warp is the web's, drawn in this many straight pieces (script.ts strikerMoves, N = 8).</summary>
        private const int StrokeWarpPieces = 8;

        /// <summary>
        /// The stroke clip's time (s) `since` seconds after the input when its plant marker `plant` is played in `window` seconds
        /// (script.ts strikerMoves): clip time P (a u + b u^2) with u = since / window, a = 2 - window / P, b = window / P - 1, so the
        /// clip starts at (2 P / window - 1) times its pace, reaches 1x at the plant and keeps it, and nothing runs before the input.
        /// The web draws it as 8 straight pieces between the exact values; so does this. A window of P or more is not warped.
        /// </summary>
        internal static double GovernedClipTime(double since, double plant, double window)
        {
            if (since <= 0.0) return 0.0;
            if (!(plant > 0.0) || !(window > 0.0) || window >= plant - 1e-9) return since;
            if (since >= window) return plant + (since - window);
            var a = 2.0 - window / plant;
            var b = window / plant - 1.0;
            var u = since / window * StrokeWarpPieces;
            var piece = Math.Min(StrokeWarpPieces - 1, (int)u);
            double u0 = piece / (double)StrokeWarpPieces, u1 = (piece + 1) / (double)StrokeWarpPieces;
            var g0 = plant * (a * u0 + b * u0 * u0);
            var g1 = plant * (a * u1 + b * u1 * u1);
            return g0 + (g1 - g0) * (u - piece);
        }

        /// <summary>The clip time the stroke shows at simulation time t.</summary>
        private double PackStrokeClipTime(double t) =>
            packStroke.ClipStart + GovernedClipTime(t - packStroke.StartT, packStroke.PlantMarker, packStroke.PlantWindow);

        private PackStrokePlan packStroke;
        private bool packStrokeShown;
        private bool packStrokeShownWas;
        private ProductionPackPose strikerStrokePose;
        private bool lastPresentedBatValid;
        private double lastPresentedBatT;
        private Vector3 lastPresentedGrip, lastPresentedToe, lastPresentedFace;

        private static readonly ProductionCharacterJoint[] StrokeOverlayJoints =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head, ProductionCharacterJoint.ThighLeft,
            ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.FootLeft, ProductionCharacterJoint.ThighRight,
            ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.FootRight
        };

        /// <summary>
        /// The shared stroke table (agreed with WEB-HUMANS, src/render3d/practice/script.ts STROKE_OVERLAYS / strokeOverlay;
        /// the lead files it in PRACTICE_PRESENTATION.md): from physics/shot.ts shotFamily(kind, directionDeg, footwork)
        /// at the input only (loft and outcome ignored). Null: no overlay clip (the procedural/legacy stroke draws it).
        /// </summary>
        internal static string PackStrokeClipId(string shotIntent, string footwork, double directionDeg)
        {
            if (string.IsNullOrEmpty(shotIntent) || shotIntent == "leave") return null;
            // A charge: the clips' 0.26 m stride cannot draw it.
            if (footwork == "down_track") return null;
            var front = footwork == "forward";
            var d = WrapDegrees(directionDeg);
            // The sweep (forward attack below -110 degrees): no kneeling clip.
            if (front && shotIntent == "attack" && d < -110.0) return null;
            switch (ShotFamily(shotIntent, d, front))
            {
                case "forward_defence": return "bat_fwd_defence";
                case "straight_drive":
                case "off_drive":
                case "cover_drive":
                case "square_drive":
                case "on_drive": return "bat_drive";
                case "steer":
                case "flick":
                case "glance": return "bat_fwd_defence";
                case "back_defence": return "bat_back_defence";
                case "back_drive":
                case "back_punch":
                case "back_on_punch":
                case "cut": return "bat_backfoot_punch";
                case "pull":
                case "hook": return "bat_pull";
                default: return null;
            }
        }

        /// <summary>physics/shot.ts shotFamily (front = forward or down_track; the caller handles down_track).</summary>
        internal static string ShotFamily(string kind, double wrappedDeg, bool front)
        {
            if (kind == "defend") return front ? "forward_defence" : "back_defence";
            var d = wrappedDeg;
            if (front)
            {
                if (d >= -15.0 && d <= 15.0) return "straight_drive";
                if (d > 15.0) return d <= 35.0 ? "off_drive" : d <= 75.0 ? "cover_drive" : d <= 125.0 ? "square_drive" : "steer";
                return d >= -35.0 ? "on_drive" : d >= -125.0 ? "flick" : "glance";
            }
            if (d >= -15.0 && d <= 15.0) return "back_drive";
            if (d > 15.0) return d <= 70.0 ? "back_punch" : "cut";
            return d >= -45.0 ? "back_on_punch" : d >= -115.0 ? "pull" : "hook";
        }

        private static double WrapDegrees(double value)
        {
            var d = value % 360.0;
            if (d > 180.0) d -= 360.0;
            if (d < -180.0) d += 360.0;
            return d;
        }

        /// <summary>
        /// The pack stroke's window: natural pace (lead rulings 04:59Z and 05:54Z; TRACKB SOURCE.md): frame 0 at the
        /// player's input, never before, played at 1x, so the plant lands at its own `plant` marker and `contact` only
        /// begins the family's follow-through; the physics meeting may come before the drawn plant, which is accepted.
        /// It holds its last frame until the follow-through hold ends. A governed stride (the physics pads govern: a pad or body
        /// contact, or the ball low near the feet) plays the same clip warped from the input to its plant (UNITY-8,
        /// docs/PRACTICE_PRESENTATION.md "Governed strides"): the plant lands where the physics pads need it, by the contact or the
        /// ball's arrival, never before the input, with the clip at most 2.4x its pace at the input; a window shorter than the
        /// clip's minimum (StrokeMinWindowForwardSeconds, StrokeMinWindowBackSeconds) keeps the code-authored stride that plants in
        /// it. With a live provisional swing on screen the carry keeps the live body.
        /// </summary>
        private void PreparePackStroke(PracticeResultPresentation result)
        {
            packStroke = default;
            lastPresentedBatValid = false;
            // UNITY-5 F2: a live result (a provisional swing was on screen, so there is no presented-bat plan) plays the clip too:
            // the provisional body was the pack's load, so the clip's frame 0 at the input is where the body already is.
            var live = ProvisionalPackBodyEnabled && !presentedBat.Valid && provisionalSwing != null;
            if (!(presentedBat.Valid || live) || result?.Trace == null) return;
            if (strikerStrideGoverned && !GovernedPackStrokeEnabled) return;
            var id = PackStrokeClipId(result.ShotIntent, result.Footwork, result.SwingDirectionDeg);
            if (id == null || !LoadStrikerAnticipation() || batReadyHold == null) return;
            var clip = ProductionMotionPacks.Clip("batter_strokes", id);
            if (clip == null) return;
            float marker;
            if (!clip.TryGetMarker("contact", out marker)) return;
            double plantMarker = 0.0, plantWindow = 0.0;
            if (strikerStrideGoverned)
            {
                // script.ts strokeOverlayIn / strideWindow: from the input the clip plays to its `plant` marker in the window to the
                // physics contact or the ball's arrival (at least the clip's minimum, at most its own plant time).
                var front = result.Footwork == "forward";
                float plant;
                plantMarker = clip.TryGetMarker("plant", out plant) ? plant : (front ? 0.32 : 0.28);
                var window = strikerStrideDue - strikerStrideAt;
                var minimum = front ? StrokeMinWindowForwardSeconds : StrokeMinWindowBackSeconds;
                if (window < minimum) return;
                plantWindow = Math.Min(plantMarker, Math.Max(minimum, window));
            }
            if (strikerStrokePose == null) strikerStrokePose = new ProductionPackPose(8);
            var start = presentedBat.Valid ? presentedBat.StartT : (result.SwingStartT ?? provisionalSwing.StartT);
            liveStrokeStartPending = live;
            packStroke.Clip = clip;
            packStroke.StartT = start;
            // Never part-way in (TRACKB 2026-11-04: that snaps the ready hold into a mid-stride pose at the input).
            packStroke.ClipStart = 0.0;
            packStroke.PlantMarker = plantMarker;
            packStroke.PlantWindow = plantWindow;
            // The clip ends when its plant (played in plantWindow) and the rest of it at its own pace are over.
            var clipEnd = start + (clip.Duration - packStroke.ClipStart) - (plantWindow > 0.0 ? plantMarker - plantWindow : 0.0);
            packStroke.EndT = Math.Max(clipEnd, earlyRecoveryStartT);
            // The physics pads' stride (PlantStrikerOnPhysicsPads) lands with the clip's plant.
            if (plantWindow > 0.0) strikerStridePlantAt = strikerStrideAt + plantWindow;
            packStroke.Valid = true;
        }

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-8): false begins the dead-ball recovery in the frame the dead ball comes even when TRACKB's
        /// stroke was drawn in it (the pop above); true (the default) begins it a frame later, blended out of the stroke on screen.
        /// </summary>
        internal bool DeadBallRecoveryAfterPackStrokeFrame { get; set; } = true;

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-8): false keeps a governed stride on the code-authored stroke, as before; true (the
        /// default) plays the family's clip on it warped to the physics pads' plant (PreparePackStroke).
        /// </summary>
        internal bool GovernedPackStrokeEnabled { get; set; } = true;

        /// <summary>Builder evidence only: whether the physics pads govern this stride, and the pack stroke's warp (0 window: not warped).</summary>
        internal bool StrikerStrideGovernedForEvidence => strikerStrideGoverned;
        internal bool PackStrokeForEvidence(out string clip, out double startT, out double plantMarker, out double plantWindow)
        {
            clip = packStroke.Valid && packStroke.Clip != null ? packStroke.Clip.Name : null;
            startT = packStroke.StartT;
            plantMarker = packStroke.PlantMarker;
            plantWindow = packStroke.PlantWindow;
            return packStroke.Valid;
        }
        internal void StrokeEndTimesForEvidence(out double packEndT, out double earlyRecoveryT, out bool earlyBegun)
        {
            packEndT = packStroke.EndT;
            earlyRecoveryT = earlyRecoveryStartT;
            earlyBegun = earlyRecoveryBegun;
        }
        internal void StrikerStrideTimesForEvidence(out double inputT, out double dueT, out double plantT)
        {
            inputT = strikerStrideAt;
            dueT = strikerStrideDue;
            plantT = strikerStridePlantAt;
        }

        // ---- UNITY-7 C: the leave overlay (TRACKB's bat_leave: the stroke table's leave row) -----------------------------

        private struct LeavePlan
        {
            public bool Valid;
            public VmpClip Clip;
            public double StartT;
        }

        private LeavePlan leavePlan;

        /// <summary>The leave's head turn eases in over this long (s) and out after the clip over the same (the web's inertial 220 ms).</summary>
        internal const double LeaveFadeSeconds = 0.22;

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-7 C): false keeps the leave as it was, the rig re-sampled to the code-authored
        /// stance at the result and left there; true (the default) keeps TRACKB's ready hold and plays bat_leave over it.
        /// </summary>
        internal bool LeaveOverlayEnabled { get; set; } = true;

        /// <summary>
        /// A leave (no swing, none committed): the body stays in TRACKB's ready hold and the bat at its compact top, the head turns
        /// to watch the ball past (the clip's `contact` marker is the nominal passing). The clip is the stroke table's leave row: on
        /// the ready hold from the ball's passing less the marker, never before the result is known (a live result that comes after
        /// the passing starts the clip when it arrives, from its frame 0, which is the ready hold).
        /// </summary>
        private void PrepareLeaveOverlay(PracticeResultPresentation result)
        {
            leavePlan = default;
            if (!LeaveOverlayEnabled || result == null || result.ShotIntent != "leave" || provisionalSwing != null ||
                canonicalStrokeAvailable || delivery == null || !LoadStrikerAnticipation()) return;
            var clip = ProductionMotionPacks.Clip("batter_strokes", "bat_leave");
            if (clip == null) return;
            float marker;
            if (!clip.TryGetMarker("contact", out marker)) marker = 0.13f;
            if (strikerStrokePose == null) strikerStrokePose = new ProductionPackPose(8);
            var acceptedAt = result.IsReplay ? 0.0 : Math.Max(0.0, timeline);
            leavePlan.Clip = clip;
            leavePlan.StartT = Math.Max(acceptedAt, delivery.IdealContactT - marker);
            leavePlan.Valid = true;
        }

        /// <summary>The leave clip's hips, trunk, head and legs over the ready hold pose at t (smooth in and out).</summary>
        private void ApplyLeaveOverlay(ProductionCharacterPose pose, double t)
        {
            var since = t - leavePlan.StartT;
            if (since < 0.0) return;
            var duration = leavePlan.Clip.Duration;
            var weight = Math.Min(1.0, since / LeaveFadeSeconds);
            weight = weight * weight * (3.0 - 2.0 * weight);
            if (since > duration) weight *= Math.Max(0.0, 1.0 - (since - duration) / LeaveFadeSeconds);
            if (weight <= 0.0) return;
            var leftHander = settings != null && settings.Handedness == "left";
            strikerStrokePose.SampleInto(leavePlan.Clip, Math.Min(duration, since), leftHander);
            var stroke = strikerStrokePose.Pose;
            for (var index = 0; index < StrokeOverlayJoints.Length; index++)
            {
                var joint = (int)StrokeOverlayJoints[index];
                pose.Rotations[joint] = Quaternion.Slerp(pose.Rotations[joint], stroke.Rotations[joint], (float)weight);
            }
            pose.RootOffset = Vector3.Lerp(pose.RootOffset, stroke.RootOffset, (float)weight);
        }

        /// <summary>
        /// Whether SetBat has handed over the bat this frame draws at t: the sample for exactly t or, past the trace's last bat knot
        /// (the playback keeps handing over that knot, with its own time), that knot, held. Before UNITY-8 only the first held: once
        /// the bat knots were used up (a pad or LBW contact, a miss that ends the trace early) the stroke drew the physics bat's FIRST
        /// sample, the zone-entry pose behind the batter, for the rest of the follow-through (a 1.3 m jump of the blade).
        /// </summary>
        private bool PresentedBatHeldAt(double t)
        {
            if (!lastPresentedBatValid) return false;
            if (Math.Abs(lastPresentedBatT - t) < 1e-9) return true;
            if (!(t > lastPresentedBatT) || !HeldBatKnotsEnabled) return false;
            var bat = acceptedTrace?.bat;
            return bat != null && bat.Length > 0 && lastPresentedBatT >= bat[bat.Length - 1].t - 1e-9;
        }

        /// <summary>Builder seam (A/B in one build; UNITY-8): false draws the physics bat's first sample once its knots are used up, as before.</summary>
        internal bool HeldBatKnotsEnabled { get; set; } = true;

        private bool PackStrokeActiveAt(double t) =>
            packStroke.Valid && !strikerRunning && !earlyRecoveryBegun && t >= packStroke.StartT && t < packStroke.EndT;

        /// <summary>
        /// The striker in TRACKB's stroke at t: the compact ready hold's frame 0 (every stroke's own frame 0) under the
        /// stroke's hips, trunk, head and legs, placed exactly as the anticipation, the hands reached onto the bat
        /// (the presented bat, which is the physics bat from the contact on).
        /// </summary>
        private void PresentPackStroke(double t)
        {
            Vector3 grip, toe, face;
            if (PresentedBatHeldAt(t))
            {
                grip = lastPresentedGrip;
                toe = lastPresentedToe;
                face = lastPresentedFace;
            }
            else if (presentedBat.Valid)
            {
                grip = presentedBat.FirstGrip;
                toe = presentedBat.FirstToe;
                face = presentedBat.FirstFace;
                PresentedBatAt(t, ref grip, ref toe, ref face);
            }
            else
            {
                // A live result before the physics bat's first sample: the bat on screen stays where it is.
                var shown = batterRig.Bat;
                grip = shown.position;
                toe = grip + shown.TransformDirection(Vector3.down) * (float)BridgeConstants.CanonicalBatLengthMetres;
                face = shown.forward;
            }
            var leftHander = settings != null && settings.Handedness == "left";
            strikerPackPose.SampleInto(batReadyHold, 0.0, leftHander);
            var clipTime = Math.Min(packStroke.Clip.Duration, PackStrokeClipTime(t));
            strikerStrokePose.SampleInto(packStroke.Clip, clipTime, leftHander);
            var pose = strikerPackPose.Pose;
            var stroke = strikerStrokePose.Pose;
            for (var index = 0; index < StrokeOverlayJoints.Length; index++)
                pose.Rotations[(int)StrokeOverlayJoints[index]] = stroke.Rotations[(int)StrokeOverlayJoints[index]];
            pose.RootOffset = stroke.RootOffset;
            PlaceStrikerActorPose(pose);
            ApplyPackPoseReaching(pose, grip, toe, face, t);
            strikerPackActive = true;
            packStrokeShown = true;
        }

        // UNITY-5 F2: the clips are authored for the stance and a drive or punch near it; a bat the physics swings further away
        // (thin-edge: 0.65 m from the left shoulder, the arm and its girdle reach 0.58) cannot be held from the clip's own body,
        // and the code-authored stroke it replaces moved the whole body (hips 0.4 m) to it. The body leans, as the web's
        // trunk does (solveGrips): its pelvis is shifted towards the bat by what the hands miss, at most StrikerReachLeanMaxMetres,
        // as fast as a stride (StrikerReachLeanGrowMetresPerSecond), never rising; the feet stay on their pads.
        private Vector3 strikerReachLean;
        private double strikerReachLeanT = double.NaN;
        internal const float StrikerReachLeanMaxMetres = 0.25f;
        internal const float StrikerReachLeanGrowMetresPerSecond = 8.0f;
        private const float StrikerReachToleranceMetres = 0.002f;

        /// <summary>How far the striker's body leans to reach the bat now (builder evidence only): metres.</summary>
        internal float StrikerReachLeanForEvidence => strikerReachLean.magnitude;

        private void ApplyPackPoseReaching(ProductionCharacterPose pose, Vector3 grip, Vector3 toe, Vector3 face, double t)
        {
            var root = batterRig.Root;
            var scale = root.localScale.x;
            var toRoot = Quaternion.Inverse(root.rotation);
            var placed = pose.RootOffset;
            var dt = double.IsNaN(strikerReachLeanT) ? 1f / 60f : (float)Math.Min(0.1, Math.Max(0.0, t - strikerReachLeanT));
            strikerReachLeanT = t;
            var lean = strikerReachLean;
            for (var pass = 0; pass < 2; pass++)
            {
                pose.RootOffset = placed + toRoot * lean / scale;
                batterRig.PlacedPose = true;
                try
                {
                    batterRig.ApplyPose(pose);
                    batterRig.SetCanonicalBatPose(grip, toe, face, 1f, false, false);
                }
                finally
                {
                    batterRig.PlacedPose = false;
                }
                // Without the complete hero (the fallback body) there is no hand to measure and the pose is as it was.
                if (pass == 1 || !batterRig.VisibleHeroSkeletonActive) break;
                var left = batterRig.HeroBatterGripTargetWorld(true) - batterRig.HeroHandWorldPosition(true);
                var right = batterRig.HeroBatterGripTargetWorld(false) - batterRig.HeroHandWorldPosition(false);
                var miss = left.sqrMagnitude >= right.sqrMagnitude ? left : right;
                if (miss.magnitude <= StrikerReachToleranceMetres) break;
                var need = new Vector3(miss.x, Mathf.Min(0f, miss.y), miss.z);
                var grow = StrikerReachLeanGrowMetresPerSecond * Mathf.Max(dt, 1f / 120f);
                lean = Vector3.ClampMagnitude(lean + Vector3.ClampMagnitude(need, grow), StrikerReachLeanMaxMetres);
            }
            strikerReachLean = lean;
        }

        /// <summary>
        /// End of a frame's striker posing. Whenever his pose source changes (TRACKB's anticipation to the stroke or the
        /// physics bat, or a walk-back or a recovery into the stance), the newly posed skeleton leaves the last displayed
        /// pose inertially (critically damped over StrikerTransitionSeconds) instead of popping. A provisional bat eases
        /// with him; the physics bat is never moved.
        /// </summary>
        private void FinishStrikerFrame(float deltaSeconds)
        {
            if (batterRig == null) return;
            // The run's start is a pose-source change too (the stroke's planted legs to the gait): the visible hero
            // leaves its last displayed pose inertially (the 0.69 m foot pop at the thin-edge run start, UNITY-2 r1).
            var runStarted = strikerRunning && !strikerRunningWas;
            strikerRunningWas = strikerRunning;
            // TRACKB's stroke can start part-way in (a short input-to-contact window): the anticipation hands over to
            // it inertially, as the web's strikerMoves (inertial 120 ms), not in one frame (thin-edge hips 14 cm).
            var strokeSwitched = packStrokeShown != packStrokeShownWas;
            packStrokeShownWas = packStrokeShown;
            packStrokeShown = false;
            // UNITY-5 F2: a live result's stroke begins from the load the provisional swing kept, which is TRACKB's own frame 0 and
            // within a few degrees of the clip's pose a few frames in. The 0.2 s inertial hand-over would hold the body in the load
            // while the physics bat, which starts at the input, leaves it: it is CanonicalBodyBlendSeconds, the blend a result
            // always took from the provisional stroke to the canonical one, so the chest's step stays under its cap and the body
            // is with the bat in five frames.
            var liveStrokeStart = strokeSwitched && liveStrokeStartPending;
            if (strokeSwitched) liveStrokeStartPending = false;
            if ((strikerPackActive != strikerPackWasActive || runStarted || strokeSwitched) && strikerSourceCaptured)
            {
                strikerTransitionActive = true;
                strikerTransitionElapsed = 0f;
                strikerTransitionBodyOnly = liveStrokeStart && !runStarted && strikerPackActive == strikerPackWasActive;
                strikerTransitionDuration = strikerTransitionBodyOnly ? (float)CanonicalBodyBlendSeconds : StrikerTransitionSeconds;
                // Touch-down already owns a continuous, same-time guarded bat path. Let the generic inertial handover
                // smooth only the human body here: blending the bat again between two individually safe segments can
                // bow the slerped blade through the authoritative ball and violate the no-input honesty invariant.
                // UNITY-9: between balls (Idle) there is no physics bat left to be exact to, so the hand-over from the ball's last pose to the waiting stance moves
                // the bat too (it used to jump it in one frame, because the last delivery's canonical bat was still latched, and the arms followed it 100 to 130 degrees).
                strikerTransitionMovesBat = !canonicalBat && double.IsNaN(touchDownT) || IdleHandOverMovesBat && state == WorldState.Idle;
                // ... and over longer than a pose-source change in play: the bat turns 140 degrees on its way to the waiting stance, and the arms that hold it keep up with it.
                if (IdleHandOverMovesBat && state == WorldState.Idle) strikerTransitionDuration = Mathf.Max(strikerTransitionDuration, IdleHandOverSeconds);
            }
            if (strikerTransitionActive)
            {
                strikerTransitionElapsed += Mathf.Max(0f, deltaSeconds);
                // Critically damped: w = 1 - (1 + x) e^-x with x = omega t, 98% at the transition's duration.
                var omega = 5.8f / strikerTransitionDuration;
                var x = omega * strikerTransitionElapsed;
                var weight = strikerTransitionElapsed >= strikerTransitionDuration ? 1f : 1f - (1f + x) * Mathf.Exp(-x);
                batterRig.ApplyHeroTransitionBlend(weight, strikerTransitionBodyOnly);
                if (strikerTransitionMovesBat && (!canonicalBat || state == WorldState.Idle) && batterRig.Bat != null && weight < 1f)
                {
                    batterRig.Bat.SetPositionAndRotation(
                        Vector3.Lerp(strikerTransitionBatPosition, batterRig.Bat.position, weight),
                        Quaternion.Slerp(strikerTransitionBatRotation, batterRig.Bat.rotation, weight));
                }
                // The blended body keeps its active grip on the bat as it is now (the physics bat never moves). During
                // locomotion the rig's one-hand contract solves only the holder, leaving the free arm in the gait.
                if (weight < 1f)
                    batterRig.ApplyHeroBatterGripIkNow(
                        1f, keepCurrentElbowPlanes: true, transitionWeight: strikerTransitionBodyOnly ? 1f : weight);
                if (weight >= 1f) strikerTransitionActive = false;
            }
            // The torso turns no faster than a spine does (section 9): a hand-over reaches its pose a few frames later
            // instead. The hands stay on the bat.
            if (batterRig.GovernHeroTorsoRates())
                batterRig.ApplyHeroBatterGripIkNow(1f, keepCurrentElbowPlanes: true);
            if (!strikerTransitionActive)
            {
                // Steady state: the displayed pose is the source of the next hand-over.
                batterRig.CaptureHeroTransitionSource();
                if (batterRig.Bat != null)
                {
                    strikerTransitionBatPosition = batterRig.Bat.position;
                    strikerTransitionBatRotation = batterRig.Bat.rotation;
                }
                strikerSourceCaptured = true;
            }
            strikerPackWasActive = strikerPackActive;
            strikerPackActive = false;
        }

        private void UpdateCamera(float deltaSeconds)
        {
            // Delivery Quiet Mode is also a camera lock: reading release,
            // bounce and contact must never compete with presentation motion.
            // A bounded follow may begin only after the ball is declared dead.
            if (quiet || !contactOccurred || !profile.PostContactCameraFollow ||
                !ball.GameObject.activeSelf) return;
            var direction = ball.GameObject.transform.position - batterCamera.transform.position;
            if (direction.sqrMagnitude <= 0.000001f) return;
            batterCamera.transform.rotation = Quaternion.Slerp(
                batterCamera.transform.rotation,
                Quaternion.LookRotation(direction.normalized, Vector3.up),
                Mathf.Clamp01(deltaSeconds * 2.5f));
        }

        private void SetStableCameraComposition(float lateral, float creaseOffset, float mirror)
        {
            stableBatterCameraPosition = BatterCameraPosition(lateral, creaseOffset, mirror);
            var target = BatterCameraTarget(lateral);
            var direction = target - stableBatterCameraPosition;
            stableBatterCameraRotation = direction.sqrMagnitude > 0.000001f
                ? Quaternion.LookRotation(direction.normalized, Vector3.up)
                : Quaternion.identity;
            RestoreStableCameraComposition();
        }

        private void RestoreStableCameraComposition()
        {
            if (batterCamera == null) return;
            batterCamera.transform.SetPositionAndRotation(
                stableBatterCameraPosition,
                stableBatterCameraRotation);
        }

        public static float VerticalFovForHorizontal(float horizontalDegrees, float aspect)
        {
            if (horizontalDegrees <= 0f || horizontalDegrees >= 180f)
                throw new ArgumentOutOfRangeException(nameof(horizontalDegrees));
            if (aspect <= 0f || float.IsNaN(aspect) || float.IsInfinity(aspect))
                throw new ArgumentOutOfRangeException(nameof(aspect));
            return Camera.HorizontalToVerticalFieldOfView(horizontalDegrees, aspect);
        }

        /// <summary>
        /// Stable rear-shoulder composition. The batter remains visibly embodied on one side while the central
        /// sight-screen, release hand and complete ball corridor stay clear. Handedness mirrors the composition once.
        /// </summary>
        public static Vector3 BatterCameraPosition(float lateral, float creaseOffset, float mirror)
        {
            if (float.IsNaN(lateral) || float.IsInfinity(lateral) ||
                float.IsNaN(creaseOffset) || float.IsInfinity(creaseOffset))
                throw new ArgumentOutOfRangeException(nameof(lateral));
            if (mirror != -1f && mirror != 1f)
                throw new ArgumentOutOfRangeException(nameof(mirror));
            var batterZ = 9.25f - creaseOffset;
            // The locked right-handed target keeps the complete embodied striker in the lower-right periphery;
            // left-handed presentation mirrors that once.  The closer rear distance makes body, grip and equipment
            // legible without narrowing the lens or moving the release target away from the optical centre.
            return new Vector3(
                lateral + mirror * BatterCameraLateralOffsetMetres,
                BatterCameraHeightMetres,
                batterZ + BatterCameraRearDistanceMetres);
        }

        public static Vector3 BatterCameraTarget(float lateral)
        {
            if (float.IsNaN(lateral) || float.IsInfinity(lateral))
                throw new ArgumentOutOfRangeException(nameof(lateral));
            return new Vector3(lateral * 0.12f, BatterCameraTargetHeightMetres, -8.69f);
        }

        /// <summary>
        /// Synchronizes world travel with each action's run, gather and planted front foot. Most of the approach
        /// is covered while the legs are visibly running; only a bounded final stride remains after plant. The
        /// last segment is linear so the bowler carries momentum through release. This is presentation-only and
        /// never changes the host-authored ball trace.
        /// </summary>
        public static float BowlerRootTravelNormalized(
            float approachNormalized,
            ProductionCharacterMotion motion)
        {
            if (float.IsNaN(approachNormalized) || float.IsInfinity(approachNormalized))
                throw new ArgumentOutOfRangeException(nameof(approachNormalized));
            float runEnd;
            float plantAt;
            float runShare;
            float plantShare;
            if (motion == ProductionCharacterMotion.PaceBowling)
            {
                runEnd = ProductionCharacterMotionSampler.PaceRunUpComplete /
                         ProductionCharacterMotionSampler.PaceRelease;
                plantAt = ProductionCharacterMotionSampler.PaceFrontFootPlant /
                          ProductionCharacterMotionSampler.PaceRelease;
                runShare = 0.78f;
                plantShare = 0.95f;
            }
            else if (motion == ProductionCharacterMotion.SpinBowling)
            {
                runEnd = ProductionCharacterMotionSampler.SpinApproachComplete /
                         ProductionCharacterMotionSampler.SpinRelease;
                plantAt = ProductionCharacterMotionSampler.SpinFrontFootPlant /
                          ProductionCharacterMotionSampler.SpinRelease;
                runShare = 0.70f;
                plantShare = 0.94f;
            }
            else
            {
                throw new ArgumentOutOfRangeException(nameof(motion));
            }

            // HUM U3: the former SmoothStep segments had zero speed at run-complete and at plant (two visible stops).
            // A monotone C1 cubic Hermite (Fritsch-Carlson tangents) keeps the same anchors, so the clip's feet and
            // the root still meet at run-complete and plant, but the speed is continuous and never stops: it starts
            // from rest at the mark and carries the final segment's speed through release.
            var amount = Mathf.Clamp01(approachNormalized);
            var s0 = runShare / runEnd;
            var s1 = (plantShare - runShare) / (plantAt - runEnd);
            var s2 = (1f - plantShare) / (1f - plantAt);
            var mRun = HarmonicTangent(s0, s1);
            var mPlant = HarmonicTangent(s1, s2);
            if (amount <= runEnd) return Hermite(0f, runShare, 0f, mRun, 0f, runEnd, amount);
            if (amount <= plantAt) return Hermite(runShare, plantShare, mRun, mPlant, runEnd, plantAt, amount);
            return Hermite(plantShare, 1f, mPlant, s2, plantAt, 1f, amount);
        }

        private static float HarmonicTangent(float left, float right) =>
            left <= 0f || right <= 0f ? 0f : 2f * left * right / (left + right);

        private static float Hermite(float p0, float p1, float m0, float m1, float x0, float x1, float x)
        {
            var h = x1 - x0;
            var t = Mathf.Clamp01((x - x0) / h);
            var t2 = t * t;
            var t3 = t2 * t;
            return (2f * t3 - 3f * t2 + 1f) * p0 + (t3 - 2f * t2 + t) * h * m0 +
                   (-2f * t3 + 3f * t2) * p1 + (t3 - t2) * h * m1;
        }

        /// <summary>Root ground speed (approach fraction per approach fraction) at the release instant.</summary>
        internal static float BowlerReleaseTravelRate(ProductionCharacterMotion motion)
        {
            const float e = 0.0005f;
            return (BowlerRootTravelNormalized(1f, motion) - BowlerRootTravelNormalized(1f - e, motion)) / e;
        }

        private void ApplyHorizontalFieldOfView()
        {
            if (batterCamera == null) return;
            var aspect = batterCamera.aspect;
            if (aspect <= 0f || float.IsNaN(aspect) || float.IsInfinity(aspect)) return;
            if (Mathf.Abs(aspect - lastCameraAspect) < 0.0001f && batterCamera.fieldOfView > 0f) return;
            batterCamera.fieldOfView = VerticalFovForHorizontal(TargetHorizontalFovDegrees, aspect);
            lastCameraAspect = aspect;
            protectedRegionProjectionVersion++;
        }

        private void OnFrameRendered(double renderedUnityMs)
        {
            FrameRendered?.Invoke(renderedUnityMs);
        }

        private void ResetBat()
        {
            if (batterRig == null) return;
            batterRig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
        }

        private void PositionBatterBody(float lateral, float creaseOffset)
        {
            if (batterBody == null) return;
            nominalBatterWorldPosition = new Vector3(lateral, 0f, 9.25f - creaseOffset);
            canonicalBatterRootOffset = Vector3.zero;
            batterBody.transform.position = nominalBatterWorldPosition;
            batterBody.transform.rotation = Quaternion.Euler(0f, 180f, -3f * PresentationMirror);
            batterRig?.ClearCanonicalBatterBodyFrame();
            batterRig?.SetCanonicalBatterPosture(0f);
            ResetBat();
        }

        private void LatchCanonicalBatterRoot(CanonicalDeliveryTrace trace)
        {
            if (trace == null || trace.batterRootOffset == null)
                throw new BridgeValidationException("Canonical batterRootOffset is required.");
            canonicalBatterRootOffset = new Vector3(
                PresentationMirror * (float)trace.batterRootOffset.x,
                0f,
                (float)trace.batterRootOffset.z);
            ApplyCanonicalBatterRoot();
        }

        private void LatchCanonicalBatterPosture(CanonicalDeliveryTrace trace)
        {
            if (trace == null || trace.batterPosture == null)
                throw new BridgeValidationException("Canonical batterPosture is required.");
            // The certified crouch is static for the trace, but the body gets there with its root (an 18 cm drop of the pelvis in
            // the one frame the result arrives is a pop): it is drawn at the root's share of the carry.
            canonicalBatterCrouchMetres = (float)trace.batterPosture.crouchM;
            batterRig.SetCanonicalBatterPosture(canonicalBatterCrouchMetres * BatterRootCarryAmount());
        }

        private void LatchCanonicalBatterBodyFrame(PracticeBatterBodyFramePresentation frame)
        {
            ValidateCanonicalBatterBodyFrame(frame);
            // Position vectors mirror x at the presentation boundary exactly once. The production rig receives
            // already-handed world anchors and only aligns its sampled torso on the ground plane before arm IK.
            var stance = new Vector3(
                PresentationMirror * (float)frame.Stance.x,
                0f,
                (float)frame.Stance.z);
            canonicalBodyStanceWorld = stance;
            canonicalBodyTorsoTopWorld = new Vector3(
                PresentationMirror * (float)frame.TorsoTop.x,
                (float)frame.TorsoTop.y,
                (float)frame.TorsoTop.z);
            canonicalBodyHeadCentreWorld = new Vector3(
                PresentationMirror * (float)frame.HeadCentre.x,
                (float)frame.HeadCentre.y,
                (float)frame.HeadCentre.z);
            canonicalBodyAnchorsLatched = true;
            ApplyCarriedBatterBodyFrame();
        }

        /// <summary>The planted body-frame anchors, displaced on the ground plane by what is left of the carry.</summary>
        private void ApplyCarriedBatterBodyFrame()
        {
            if (!canonicalBodyAnchorsLatched) return;
            var amount = BatterRootCarryAmount();
            batterRig.SetCanonicalBatterPosture(canonicalBatterCrouchMetres * amount);
            batterRig.SetCanonicalBatterBodyFrameAlignmentWeight(amount);
            var lag = batterCarryAnchorLag * (1f - amount);
            batterRig.SetCanonicalBatterBodyFrame(
                canonicalBodyStanceWorld + lag,
                canonicalBodyTorsoTopWorld + lag,
                canonicalBodyHeadCentreWorld + lag);
        }

        private void ResetBatterCarry()
        {
            batterCarryStartT = 0.0;
            batterCarryEndT = 0.0;
            batterCarryContactPast = false;
            batterCarryAmount = 1f;
            batterRootAmount = 1f;
            batterRootAmountBefore = 1f;
            batterRootStamp = double.NaN;
            batterRootDelta = 0.0;
            batterCarryRootFrom = Vector3.zero;
            batterCarryAnchorLag = Vector3.zero;
            batterCarryBatPending = false;
            batterCarryAccepting = false;
            batterCarryGripDelta = Vector3.zero;
            batterCarryRotationDelta = Quaternion.identity;
            canonicalBodyAnchorsLatched = false;
            earlyRecoveryStartT = double.PositiveInfinity;
            earlyRecoveryBegun = false;
        }

        /// <summary>
        /// Plans the carry from what is on screen to the certified planted body (see BatterCarryAverageMetresPerSecond).
        /// A replay starts planted, exactly as the physics certifies it for the whole trace.
        /// </summary>
        private void PrepareBatterCarry(PracticeResultPresentation result, Vector3 shownRootOffset, Vector3 shownTorsoTop)
        {
            ResetBatterCarry();
            var trace = result.Trace;
            var frame = result.BatterBodyFrame;
            var targetRoot = new Vector3(
                PresentationMirror * (float)trace.batterRootOffset.x, 0f, (float)trace.batterRootOffset.z);
            var targetTorso = new Vector3(
                PresentationMirror * (float)frame.TorsoTop.x, 0f, (float)frame.TorsoTop.z);
            if (trace.bat != null && trace.bat.Length > 0)
            {
                var lastBat = trace.bat[trace.bat.Length - 1].t;
                earlyRecoveryStartT = Math.Max(lastBat, trace.batterMotion != null ? trace.batterMotion.endT : lastBat) +
                                      FollowThroughHoldSeconds;
            }
            if (result.IsReplay) return;

            batterCarryRootFrom = shownRootOffset;
            batterCarryAnchorLag = new Vector3(shownTorsoTop.x, 0f, shownTorsoTop.z) - targetTorso;
            // The carry is bounded (UNITY phase 2, TRACKB P1 6: at most max(CanonicalBodyBlendSeconds, 0.32 m /
            // BatterCarryAverageMetresPerSecond) = 0.2 s). TRACKB's placed anticipation stands its shoulders further
            // from the physics torso frame than the code-authored stance did, and the unbounded anchor lag stretched
            // the carry past its bound (the root reached 0.0583 of 0.06 m by 0.25 s; a held-bat no-shot still
            // moved its pelvis 1.3 cm after it).
            var distance = Mathf.Min(BatterCarryMaximumMetres, Mathf.Max(
                (targetRoot - shownRootOffset).magnitude,
                batterCarryAnchorLag.magnitude));
            var start = Math.Max(0.0, timeline);
            // UNITY-9: the recovery from the follow-through is driven by trace time so that a replay and its live ball agree frame for frame. A live result that
            // arrives after the finish has been held would find that recovery already part-way through in its first frame (and the hero re-posed from the
            // reference pose in one step); it begins at the accept instead, whole, like the recovery of a result that came on time.
            if (LateSettleRecovery && !double.IsPositiveInfinity(earlyRecoveryStartT)) earlyRecoveryStartT = Math.Max(earlyRecoveryStartT, start);
            var human = Math.Max(CanonicalBodyBlendSeconds, distance / BatterCarryAverageMetresPerSecond);
            var contact = trace.batterMotion != null && trace.bat != null && trace.bat.Length > 0
                ? trace.batterMotion.contactT
                : double.NaN;
            // End one 60 Hz frame before the contact anchor when there is room, so the frame nearest contact (at
            // 60 or 30 fps) already shows the exact physics bat (TRACKB's C2 contact frame is up to 8.3 ms early).
            var available = contact - start;
            double duration;
            if (!double.IsNaN(available) && available >= 2.0 * BatterCarryContactMarginSeconds)
                duration = Math.Min(human, available - BatterCarryContactMarginSeconds);
            else if (!double.IsNaN(available) && available >= BatterCarryContactMarginSeconds)
                duration = Math.Min(human, available);
            else
                duration = Math.Min(human, CanonicalBodyBlendSeconds);
            batterCarryStartT = start;
            batterCarryEndT = start + duration;
            // UNITY-9: a result that arrives after the contact has no contact left to be exact at; the carry may then take as long as the bat's
            // journey needs (CarryCanonicalBat lengthens it once it knows the bat's distance).
            batterCarryContactPast = !double.IsNaN(available) && available < BatterCarryContactMarginSeconds;
            batterCarryAmount = 0f;
            batterRootAmount = 0f;
            batterRootAmountBefore = 0f;
            batterRootStamp = presentationClock;
            batterRootDelta = 0.0;
            batterCarryBatPending = true;
        }

        private void UpdateBatterCarry(double traceTime)
        {
            // The bat's carry ends first; the root and the body-frame anchors follow it at their own pace until they are there.
            if (batterCarryAmount >= 1f && batterRootAmount >= 1f) return;
            if (batterCarryAmount < 1f)
            {
                var span = batterCarryEndT - batterCarryStartT;
                batterCarryAmount = span <= 0.0
                    ? 1f
                    : Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((float)((traceTime - batterCarryStartT) / span)));
            }
            ApplyCarriedBatterBodyFrame();
        }

        /// <summary>
        /// The bat is carried rigidly from the pose on screen to the canonical bat by the same amount as the body:
        /// exact from the carry's end (at the latest the authored contact anchor), and continuous at its start.
        /// </summary>
        private void CarryCanonicalBat(ref Vector3 grip, ref Vector3 toe, ref Vector3 face, double t)
        {
            if (batterCarryAmount >= 1f)
            {
                batterCarryBatPending = false;
                return;
            }
            var blade = toe - grip;
            var length = blade.magnitude;
            var up = -blade / length;
            var forward = face - up * Vector3.Dot(face, up);
            if (forward.sqrMagnitude <= 0.000001f && batterBody != null)
                forward = Vector3.Cross(up, batterBody.transform.right);
            if (forward.sqrMagnitude <= 0.000001f) return;
            var rotation = Quaternion.LookRotation(forward.normalized, up);
            var keep = 1f - batterCarryAmount;
            if (batterCarryBatPending)
            {
                batterCarryBatPending = false;
                var shown = batterRig.Bat;
                var shownGrip = batterCarryAccepting || shown == null ? batterCarryShownGrip : shown.position;
                var shownRotation = batterCarryAccepting || shown == null ? batterCarryShownRotation : shown.rotation;
                // Scale the captured difference so what is left of the carry reproduces the bat on screen now.
                if (keep > 0.05f)
                {
                    batterCarryGripDelta = (shownGrip - grip) / keep;
                    batterCarryRotationDelta = Quaternion.SlerpUnclamped(
                        Quaternion.identity, shownRotation * Quaternion.Inverse(rotation), 1f / keep);
                    // (Not while TRACKB's stroke owns the bat: it draws the physics bat itself, and a carry still unfinished when its window ended would snap the rest
                    // in one frame, the arm flipping 177 degrees: thin-edge, a result 8 frames after the commitment.)
                    if (LateSettleCarry && batterCarryContactPast && !PackStrokeActiveAt(t))
                    {
                        // The bat travels no faster than a swing does (4 m/s and 480 deg/s on average, 6 m/s and 720 deg/s at the fastest of the
                        // eased carry), however far the physics bat is from the one on screen, so the arms that follow it neither swing 100 degrees
                        // a frame nor flip their elbows (a result 30 to 60 frames late, a second after the contact: hands 120 to 177 degrees in one frame).
                        var travel = batterCarryGripDelta.magnitude;
                        var turn = Quaternion.Angle(shownRotation, rotation);
                        var seconds = Math.Min(LateSettleMaximumSeconds, Math.Max(travel / LateSettleBatMetresPerSecond, turn / LateSettleBatDegreesPerSecond));
                        if (seconds > batterCarryEndT - batterCarryStartT) batterCarryEndT = batterCarryStartT + seconds;
                    }
                }
            }
            var carried = Quaternion.SlerpUnclamped(Quaternion.identity, batterCarryRotationDelta, keep) * rotation;
            grip += batterCarryGripDelta * keep;
            toe = grip + carried * Vector3.down * length;
            face = carried * Vector3.forward;
        }

        /// <summary>
        /// After the canonical bat has ended and the finish has been held (FollowThroughHoldSeconds), the same authored
        /// FollowThrough-to-1 recovery the dead ball used begins while the ball is still live. Driven by trace time,
        /// so live playback and replays agree frame for frame.
        /// </summary>
        private void UpdateEarlyFollowThroughRecovery(double traceTime)
        {
            if (!canonicalStrokeAvailable || traceTime < earlyRecoveryStartT || batterRig == null ||
                strikerRunning) return;
            if (!earlyRecoveryBegun)
            {
                // A dead ball reached on this same step keeps the dead-ball beat, exactly as before.
                if (playback == null || playback.Completed) return;
                recoveryCanonicalBatPosition = batterRig.Bat.position;
                recoveryCanonicalBatRotation = batterRig.Bat.rotation;
                batterRig.BeginBatterDeadBallRecovery(
                    recoveryCanonicalBatPosition,
                    recoveryCanonicalBatRotation,
                    canonicalFootwork);
                recoveryCanonicalBatCaptured = true;
                earlyRecoveryBegun = true;
            }
            var progress = DeadBallRecoverySeconds <= 0.0
                ? 1f
                : Mathf.SmoothStep(0f, 1f,
                    Mathf.Clamp01((float)((traceTime - earlyRecoveryStartT) / DeadBallRecoverySeconds)));
            batterRig.ApplyBatterDeadBallRecovery(
                recoveryCanonicalBatPosition,
                recoveryCanonicalBatRotation,
                canonicalFootwork,
                progress);
        }

        private static void ValidateCanonicalBatterBodyFrame(PracticeBatterBodyFramePresentation frame)
        {
            if (frame == null || frame.Stance == null || frame.TorsoTop == null || frame.HeadCentre == null)
                throw new BridgeValidationException("Canonical batterBodyFrame is required.");
            var stanceX = RequireFiniteBodyFrameNumber(
                frame.Stance.x, "batterBodyFrame.stance.x");
            var stanceZ = RequireFiniteBodyFrameNumber(
                frame.Stance.z, "batterBodyFrame.stance.z");
            var torsoX = RequireFiniteBodyFrameNumber(
                frame.TorsoTop.x, "batterBodyFrame.torsoTop.x");
            var torsoY = RequireFiniteBodyFrameNumber(
                frame.TorsoTop.y, "batterBodyFrame.torsoTop.y");
            var torsoZ = RequireFiniteBodyFrameNumber(
                frame.TorsoTop.z, "batterBodyFrame.torsoTop.z");
            var headX = RequireFiniteBodyFrameNumber(
                frame.HeadCentre.x, "batterBodyFrame.headCentre.x");
            var headY = RequireFiniteBodyFrameNumber(
                frame.HeadCentre.y, "batterBodyFrame.headCentre.y");
            var headZ = RequireFiniteBodyFrameNumber(
                frame.HeadCentre.z, "batterBodyFrame.headCentre.z");
            if (!(Math.Abs(stanceX) <= 3.0 && stanceZ >= 5.0 && stanceZ <= 11.0 &&
                  Math.Abs(torsoX) <= 3.0 && torsoY >= 0.0 && torsoY <= 3.0 &&
                  torsoZ >= 5.0 && torsoZ <= 11.0 && Math.Abs(headX) <= 3.0 &&
                  headY >= torsoY && headY <= 3.0 && headZ >= 5.0 && headZ <= 11.0))
                throw new BridgeValidationException(
                    "Canonical batterBodyFrame is outside the canonical batter/pitch domain.");
            if (!(Math.Sqrt((torsoX - stanceX) * (torsoX - stanceX) +
                            (torsoZ - stanceZ) * (torsoZ - stanceZ)) <= 3.0 &&
                  Math.Sqrt((headX - torsoX) * (headX - torsoX) +
                            (headY - torsoY) * (headY - torsoY) +
                            (headZ - torsoZ) * (headZ - torsoZ)) <= 1.0))
                throw new BridgeValidationException(
                    "Canonical batterBodyFrame anchors are not one coherent athlete.");
        }

        private static double RequireFiniteBodyFrameNumber(double value, string name)
        {
            if (double.IsNaN(value) || double.IsInfinity(value) ||
                value < -float.MaxValue || value > float.MaxValue)
                throw new BridgeValidationException("Canonical " + name + " must be a finite Unity float.");
            return value;
        }

        /// <summary>
        /// The carry's share the striker's root and body-frame anchors are drawn at: the bat's carry, but the root never moves
        /// faster than BatterRootMaximumMetresPerSecond. The frames of one clock value are one frame (the answer is the same
        /// however often it is asked); a gap of more than 50 ms is not a run of frames and takes the carry as it is.
        /// </summary>
        private float BatterRootCarryAmount()
        {
            var amount = batterCarryAmount;
            if (batterRootAmount >= 1f && amount >= 1f) return 1f;
            if (presentationClock != batterRootStamp)
            {
                var delta = presentationClock - batterRootStamp;
                batterRootDelta = delta > 0.0 && delta <= ProductionHeroArm.MemorySeconds ? delta : double.PositiveInfinity;
                batterRootStamp = presentationClock;
                batterRootAmountBefore = batterRootAmount;
            }
            var distance = (canonicalBatterRootOffset - batterCarryRootFrom).magnitude;
            var step = distance > 0.0001f && !double.IsPositiveInfinity(batterRootDelta)
                ? BatterRootMaximumMetresPerSecond * (float)batterRootDelta / distance
                : 1f;
            batterRootAmount = Mathf.Min(amount, batterRootAmountBefore + step);
            return batterRootAmount;
        }

        private void ApplyCanonicalBatterRoot()
        {
            if (batterBody == null || strikerRunning) return;
            // sim-v3 certifies one static root and one final planted body frame for the complete canonical trace.
            // Applying the root partially over time would invent an uncertified body trajectory. It stays latched
            // until BeginDelivery restores guard; the rig then aligns each sampled footwork pose to the body frame.
            var amount = BatterRootCarryAmount();
            batterBody.transform.position = nominalBatterWorldPosition + Vector3.LerpUnclamped(
                batterCarryRootFrom, canonicalBatterRootOffset, amount);
        }

        private void RestoreNominalBatterRoot()
        {
            if (batterBody != null) batterBody.transform.position = nominalBatterWorldPosition;
        }

        private void PrepareBowlerApproach(Vector3 authoritativeRelease)
        {
            bowlerFollowLastT = double.NaN;
            bowlerFollowGaitHanded = false;
            bowlerRunUp = bowlerRunUpAction != null
                ? ProductionBowlerRunUp.TryCreate(bowlerRunUpAction, bowlingPresentation.ApproachSeconds, bowlerArmLeft)
                : null;
            if (bowlerRunUp != null)
            {
                // Measure the ball-in-hand at the composed release on the reference body, fit the body scale to the
                // physics release height, then place the composed ground so the hand is on the release point (x, z).
                float gx, gz, yaw;
                bowlerRunUp.Ground(bowlerRunUp.TRelease, out gx, out gz, out yaw);
                bowler.transform.localScale = Vector3.one;
                bowler.transform.SetPositionAndRotation(Vector3.zero, Quaternion.AngleAxis(yaw, Vector3.up));
                bowlerRunUp.Sample(bowlerRunUp.TRelease, bowlerPackPose);
                bowlerRig.ApplyPose(bowlerPackPose);
                var hand = bowlerRig.ReleaseHandAnchor.position;
                // Lead ruling 2026-11-04 (both renderers): the ball (this anchor, not the wrist) on the physics release
                // point within 3 cm, feet always planted, never a root rise. MOTION-BOWL's re-authored bowl_pace
                // (bowler.bytes 9126f4b5…, ball at 2.150 m at scale 1) has landed, so the interim 1.18 pace clamp is
                // retired: body scale within [0.95, 1.12] for every action, plus the trunk and shoulder reach for the rest
                // (lead ruling 2026-11-07: never the elbow).
                bowlerRunUpScale = Mathf.Clamp(authoritativeRelease.y / Mathf.Max(0.5f, hand.y), 0.95f, 1.12f);
                bowler.transform.localScale = Vector3.one * bowlerRunUpScale;
                bowlerRunUpAnchor = new Vector3(authoritativeRelease.x - hand.x * bowlerRunUpScale, 0f,
                    authoritativeRelease.z - hand.z * bowlerRunUpScale);
                bowlerRunUpReleaseGroundX = gx;
                bowlerRunUpReleaseGroundZ = gz;
                bowlerReleasePosition = bowlerRunUpAnchor;
                bowlerReleaseTarget = authoritativeRelease;
                // What the body scale could not take up (the clamp): the physics release point less the ball in the hand
                // as the clip draws it at the release. The trunk's side flexion and a rigid shoulder turn take it up
                // around the release (ReachBowlerReleaseResidual), never the elbow.
                PlaceBowlerOnRunUp(bowlerRunUp.VisibleRelease, false);
                bowlerReleaseDelta = authoritativeRelease - bowlerRig.ReleaseHandAnchor.position;
                bowlerRunUpHeightResidual = bowlerReleaseDelta.y;
                bowlerStartPosition = BowlerRunUpRootVisible(0.0);
                PlaceBowlerOnRunUp(0.0);
                return;
            }
            bowler.transform.localScale = Vector3.one * (bowlerRig.HeightMetres / ProductionCharacterRig.ReferenceHeightMetres);
            bowler.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            bowlerRig.SampleBowling(
                bowlingPresentation.ReleaseNormalized,
                bowlingCue);
            // Measure the generated hand offset once between deliveries, then place that hand at Flight[0].p.
            // This keeps the presentation ball continuous while leaving the host trace untouched.
            bowlerReleasePosition = authoritativeRelease - bowlerRig.ReleaseHandAnchor.position;
            bowlerStartPosition = bowlerReleasePosition -
                                  Vector3.forward * bowlingPresentation.ApproachDistanceMetres;
            bowler.transform.position = bowlerStartPosition;
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            bowlerRig.SampleBowling(0f, bowlingCue);
        }

        private void PrepareCanonicalBatterTiming(CanonicalDeliveryTrace trace)
        {
            if (trace.bat == null || trace.bat.Length == 0)
            {
                canonicalBatStartT = 0.0;
                canonicalBatContactT = 0.0;
                canonicalBatEndT = 0.0;
                return;
            }
            if (trace.batterMotion == null)
                throw new BridgeValidationException("Canonical batterMotion is required for a non-empty bat trace.");
            // simulation-v3 authors these three anchors together with the safe bat track. Do not infer a contact
            // phase from animation fractions or presentation events; misses/pad/body also carry their actual safe
            // authoring anchor even though they have no blade-contact event.
            canonicalBatStartT = trace.batterMotion.startT;
            canonicalBatContactT = trace.batterMotion.contactT;
            canonicalBatEndT = trace.batterMotion.endT;
        }

        private static bool HasTimedCanonicalStroke(CanonicalDeliveryTrace trace)
        {
            if (trace == null || trace.bat == null || trace.bat.Length < 2) return false;
            if (trace.bat[trace.bat.Length - 1].t - trace.bat[0].t <=
                TimelineBoundaryToleranceSeconds) return false;

            var first = trace.bat[0];
            var minimumSquared = MinimumCanonicalStrokeExcursionMetres *
                                 MinimumCanonicalStrokeExcursionMetres;
            for (var index = 1; index < trace.bat.Length; index++)
            {
                var sample = trace.bat[index];
                if (TraceDistanceSquared(first.grip, sample.grip) >= minimumSquared ||
                    TraceDistanceSquared(first.toe, sample.toe) >= minimumSquared)
                    return true;
            }
            return false;
        }

        private static double TraceDistanceSquared(TraceVector3 from, TraceVector3 to)
        {
            if (from == null || to == null) return 0.0;
            var x = to.x - from.x;
            var y = to.y - from.y;
            var z = to.z - from.z;
            return x * x + y * y + z * z;
        }

        private float CanonicalBatterPhase(double sampleTime)
        {
            return CanonicalBatterMotionPhase(
                canonicalBatStartT, canonicalBatContactT, canonicalBatEndT, sampleTime);
        }

        internal static float CanonicalBatterMotionPhase(
            TraceBatterMotion motion,
            double sampleTime)
        {
            if (motion == null) throw new ArgumentNullException(nameof(motion));
            return CanonicalBatterMotionPhase(
                motion.startT, motion.contactT, motion.endT, sampleTime);
        }

        private static float CanonicalBatterMotionPhase(
            double startTime,
            double contactTime,
            double endTime,
            double sampleTime)
        {
            if (endTime <= startTime) return 0f;
            if (sampleTime <= contactTime)
            {
                var preContact = contactTime - startTime;
                if (preContact <= 0.000001) return ProductionCharacterMotionSampler.BatterContact;
                var preContactTracePhase = Mathf.Clamp01(
                                               (float)((sampleTime - startTime) / preContact)) *
                                           ProductionCharacterMotionSampler.BatterContact;
                return MapCanonicalBatterTracePhase(preContactTracePhase);
            }

            var followThrough = endTime - contactTime;
            if (followThrough <= 0.000001)
                return ProductionCharacterMotionSampler.BatterFollowThrough;
            var tracePhase = Mathf.Lerp(
                ProductionCharacterMotionSampler.BatterContact,
                1f,
                Mathf.Clamp01((float)((sampleTime - contactTime) / followThrough)));
            return MapCanonicalBatterTracePhase(tracePhase);
        }

        internal static float MapCanonicalBatterTracePhase(float tracePhase)
        {
            var phase = Mathf.Clamp01(tracePhase);
            // Host trace time describes the authoritative bat, not the authored body's recovery clock. Advance the
            // preparation through the source clip's backlift/plant beats, arrive at contact together, then reach and
            // hold the high authored finish while the trace is still live. The separate dead-ball beat owns the
            // recovery from FollowThrough to 1, so the body cannot fold under a bat which is still held overhead.
            if (phase <= 0.091f)
                return Mathf.Lerp(0f, 0.24f, phase / 0.091f);
            if (phase <= 0.203f)
                return Mathf.Lerp(0.24f, 0.43f, (phase - 0.091f) / (0.203f - 0.091f));
            if (phase <= ProductionCharacterMotionSampler.BatterContact)
                return Mathf.Lerp(
                    0.43f,
                    ProductionCharacterMotionSampler.BatterContact,
                    (phase - 0.203f) /
                    (ProductionCharacterMotionSampler.BatterContact - 0.203f));
            if (phase <= 0.808f)
                return Mathf.Lerp(
                    ProductionCharacterMotionSampler.BatterContact,
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    (phase - ProductionCharacterMotionSampler.BatterContact) /
                    (0.808f - ProductionCharacterMotionSampler.BatterContact));
            return ProductionCharacterMotionSampler.BatterFollowThrough;
        }

        /// <summary>
        /// The one reflection between the physics frame and Unity (owner ruling 2026-11-04, MOTION-SPEC section 3).
        /// The physics is right-handed with +x towards the striker's off side; Unity is left-handed, and its rear
        /// camera looks down -z, so screen right is world -x. A right-hander's off side belongs on screen right,
        /// so his world is reflected (x -> -x); a left-hander, whom the physics draws as the x-mirror of a
        /// right-hander, keeps x. Every physics-to-Unity position, polar vector and lateral presentation offset uses
        /// this sign; axial vectors use det = -1 (ToUnityAxial). Anatomy (rig handedness, the bowler's real arm)
        /// never reflects. Before this ruling the sign was +1 for a right-hander and the whole view was a mirror image.
        /// </summary>
        private float PresentationMirror => WorldReflectionFor(settings != null ? settings.Handedness : "right");

        internal static float WorldReflectionFor(string handedness) => handedness == "left" ? 1f : -1f;

        /// <summary>
        /// The production rig is built from the canonical VC17 layout (src/render3d/core/skeleton.ts), whose "left"
        /// joints sit at local +X with the face at +Z. In right-handed three.js that is anatomically correct; in
        /// left-handed Unity +X is the character's right, so every Unity rig is the mirror image of its labels. With the
        /// world now reflected (PresentationMirror), each canonical pose must also go through the canonical mirror
        /// (MOTION-SPEC section 3). For this rig that is simply the opposite handedness: a right-handed batter, a
        /// right-arm bowler or a right-handed fielder is a "Left" rig, whose mirrored poses, grip order, bat hand and
        /// release hand then display the true anatomy (left hand on top, left shoulder leading, right arm bowling).
        /// </summary>
        internal static ProductionCharacterHandedness RigHandednessFor(bool canonicalLeft) =>
            canonicalLeft ? ProductionCharacterHandedness.Right : ProductionCharacterHandedness.Left;

        private void ApplyPitchAppearance(string conditions)
        {
            productionEnvironment?.ApplyPitchCondition(conditions);
        }

        private void SetQuiet(bool value)
        {
            if (quiet == value) return;
            quiet = value;
            productionEnvironment?.SetDeliveryQuiet(value);
            QuietChanged?.Invoke(value);
        }

        private void ApplyPendingProfile()
        {
            if (!pendingProfile.HasValue) return;
            ApplyProfile(pendingProfile.Value);
            pendingProfile = null;
        }

        private void ApplyProfile(PracticePresentationProfile value)
        {
            var rebuildEnvironment = productionEnvironment != null && profile.Quality != value.Quality;
            profile = value;
            if (batterCamera != null)
                batterCamera.allowMSAA = value.Quality != PracticePresentationQuality.Lite;
            if (rebuildEnvironment)
            {
                var retainedFieldState = productionEnvironment.FieldState;
                productionEnvironment.Dispose();
                productionEnvironment = ProductionCricketEnvironment.Create(
                    worldRoot,
                    new ProductionEnvironmentSpec(
                        value.Quality,
                        currentPitchCondition,
                        currentBallColour,
                        practiceLight,
                        ProductionSky.Clear,
                        settings != null && settings.ReducedMotion),
                    retainedFieldState);
                productionEnvironment.ConfigureCamera(batterCamera);
                productionEnvironment.SetDeliveryQuiet(quiet);
                ball.Dispose();
                ball = ProductionCricketProps.CreateBall(
                    worldRoot,
                    "ProductionCricketBall",
                    PropQuality(value.Quality),
                    value.RealtimeShadows);
                ball.SetAppearance(currentBallColour, currentBallAge);
                ball.SetVisible(false);
            }
            var detail = CharacterDetail(value.Quality);
            bowlerRig?.SetDetail(detail);
            batterRig?.SetDetail(detail);
            // The foreground striker fills enough of the locked rear-shoulder frame for the shipped close-up
            // body, equipment and bat topology to be visible. Keep that cost exclusive to High: Standard and
            // Lite must immediately return to their bounded live-delivery meshes when a between-ball profile
            // change is applied. The close-up assets are already part of the admitted hero transaction; this
            // selection changes presentation only and never the canonical bat, trace, collision or scoring.
            batterRig?.SetHeroCloseUp(value.Quality == PracticePresentationQuality.High);
            for (var index = 0; index < fieldingRigs.Count; index++)
                fieldingRigs[index].SetDetail(detail);
            deliveryEffects?.ApplyProfile(
                value.Quality,
                settings != null && settings.ReducedMotion);
            coachGuidePresentation?.ApplyProfile(
                value.Quality,
                settings != null && settings.ReducedMotion);
        }

        private static ProductionPropQuality PropQuality(PracticePresentationQuality quality)
        {
            switch (quality)
            {
                case PracticePresentationQuality.Lite: return ProductionPropQuality.Lite;
                case PracticePresentationQuality.Standard: return ProductionPropQuality.Standard;
                case PracticePresentationQuality.High: return ProductionPropQuality.High;
                default: throw new ArgumentOutOfRangeException(nameof(quality));
            }
        }

        private ProductionCharacterSpec CharacterSpec(
            ProductionCharacterRole role,
            ProductionCharacterHandedness? hand = null)
        {
            var value = ProductionCharacterSpec.For(role, CharacterDetail(profile.Quality));
            value.CastShadows = profile.RealtimeShadows;
            value.Handedness = hand ?? RigHandednessFor(settings != null && settings.Handedness == "left");
            return value;
        }

        internal static float StableFielderHeightMetres(int stableSlotIndex)
        {
            if (stableSlotIndex < 0) throw new ArgumentOutOfRangeException(nameof(stableSlotIndex));
            // Nine evenly bounded cricket-plausible bands, traversed in a coprime order, provide visible but
            // restrained variety without random state or per-rig resources. Slots one through nine are distinct.
            const int bandCount = 9;
            var band = (stableSlotIndex * 5 + 3) % bandCount;
            return Mathf.Lerp(
                MinimumFielderHeightMetres,
                MaximumFielderHeightMetres,
                band / (float)(bandCount - 1));
        }

        private static ProductionCharacterDetail CharacterDetail(PracticePresentationQuality quality)
        {
            switch (quality)
            {
                case PracticePresentationQuality.Lite: return ProductionCharacterDetail.Low;
                case PracticePresentationQuality.Standard: return ProductionCharacterDetail.Medium;
                case PracticePresentationQuality.High: return ProductionCharacterDetail.High;
                default: throw new ArgumentOutOfRangeException(nameof(quality));
            }
        }

        private void RegisterFieldingRig(ProductionCharacterRig rig, int index)
        {
            fieldingRigs.Add(rig);
            var root = rig.Root.gameObject;
            root.name = "FielderProxy-" + index;
            fielders.Add(root);
            rigByRoot.Add(root, rig);
        }

        private void UpdateCharacterPresentationDistance(
            GameObject characterRoot,
            ProductionCharacterRig rig)
        {
            if (characterRoot == null || rig == null) return;
            var delta = characterRoot.transform.position - strikerPresentationReference;
            delta.y = 0f;
            rig.SetPresentationDistanceMetres(delta.magnitude);
        }

        private void ArrangeKeeperSlot(PracticeScenePresentation scene)
        {
            var target = -1;
            for (var index = 0; index < scene.Fielders.Length; index++)
            {
                if (scene.Fielders[index].Role != "keeper") continue;
                target = index;
                break;
            }
            if (target < 0) return;
            var keeperRoot = keeperRig.Root.gameObject;
            var current = fielders.IndexOf(keeperRoot);
            if (current < 0 || current == target) return;
            var displaced = fielders[target];
            fielders[target] = keeperRoot;
            fielders[current] = displaced;
        }

        private void EnsureBowler(PracticeScenePresentation scene)
        {
            var requestedPresentation = ProductionBowlingPresentation.ForSceneFamily(scene.BowlerFamily);
            bowlerArmLeft = scene.BowlerArm == "left";
            bowlerRunUpAction = scene.BowlerFamily == "pace" ? "pace"
                : scene.BowlerFamily == "spin" ? (scene.BowlerSpinType == "wrist" ? "leg" : "off")
                : null;
            var requested = RigHandednessFor(bowlerArmLeft);
            var requestedAppearanceKey = BowlerAppearanceKey(scene);
            bowlingPresentation = requestedPresentation;
            bowlingCue = DefaultBowlingCue(requestedPresentation.Role);
            if (bowlerRig != null && bowlerRig.Handedness == requested &&
                bowlerRig.Role == requestedPresentation.Role &&
                string.Equals(bowlerAppearanceKey, requestedAppearanceKey, StringComparison.Ordinal))
                return;
            bowlerRig?.Dispose();
            bowlerRig = ProductionCharacterFactory.Create(
                worldRoot,
                BowlerCharacterSpec(scene, requestedPresentation.Role, requested));
            bowler = bowlerRig.Root.gameObject;
            bowler.name = "BowlerProxy";
            bowler.transform.position = bowlerStartPosition;
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            bowlerAppearanceKey = requestedAppearanceKey;
        }

        private ProductionCharacterSpec BowlerCharacterSpec(
            PracticeScenePresentation scene,
            ProductionCharacterRole role,
            ProductionCharacterHandedness handedness)
        {
            var value = CharacterSpec(role, handedness);
            var hash = StableAppearanceHash(string.IsNullOrEmpty(scene.BowlerLookSeed)
                ? scene.BowlerFamily + ":default"
                : scene.BowlerLookSeed);
            var palette = ProductionCharacterPalette.OriginalNightKit();
            Color skin;
            switch (hash % 5u)
            {
                case 0u: skin = new Color(0.31f, 0.16f, 0.085f); break;
                case 1u: skin = new Color(0.42f, 0.23f, 0.13f); break;
                case 2u: skin = new Color(0.54f, 0.32f, 0.20f); break;
                case 3u: skin = new Color(0.65f, 0.42f, 0.28f); break;
                default: skin = new Color(0.74f, 0.52f, 0.37f); break;
            }
            palette.Skin = skin;
            palette.SkinShade = new Color(skin.r * 0.64f, skin.g * 0.60f, skin.b * 0.58f);
            palette.Hair = (hash & 1u) == 0u
                ? new Color(0.035f, 0.028f, 0.025f)
                : new Color(0.075f, 0.050f, 0.035f);
            palette.Iris = (hash & 2u) == 0u
                ? new Color(0.13f, 0.070f, 0.035f)
                : new Color(0.085f, 0.065f, 0.050f);
            value.Palette = palette;

            float baseHeight;
            if (role == ProductionCharacterRole.PaceBowler)
            {
                switch (scene.BowlerPaceBand)
                {
                    case "express": baseHeight = 1.88f; break;
                    case "fast": baseHeight = 1.83f; break;
                    default: baseHeight = 1.79f; break;
                }
            }
            else
            {
                baseHeight = scene.BowlerSpinType == "wrist" ? 1.80f : 1.76f;
            }
            var heightJitter = ((int)((hash >> 8) % 5u) - 2) * 0.012f;
            value.HeightMetres = Mathf.Clamp(baseHeight + heightJitter, 1.70f, 1.92f);
            return value;
        }

        private static string BowlerAppearanceKey(PracticeScenePresentation scene)
        {
            return string.Concat(
                scene.BowlerFamily ?? string.Empty, "|",
                scene.BowlerArm ?? string.Empty, "|",
                scene.BowlerLookSeed ?? string.Empty, "|",
                scene.BowlerPaceBand ?? string.Empty, "|",
                scene.BowlerSpinType ?? string.Empty);
        }

        private static uint StableAppearanceHash(string value)
        {
            unchecked
            {
                var hash = 2166136261u;
                for (var index = 0; index < value.Length; index++)
                {
                    hash ^= value[index];
                    hash *= 16777619u;
                }
                return hash;
            }
        }

        private static void SetLayerRecursively(Transform value, int layer)
        {
            if (value == null) return;
            value.gameObject.layer = layer;
            for (var index = 0; index < value.childCount; index++)
                SetLayerRecursively(value.GetChild(index), layer);
        }

        private static ProductionBowlingCueProfile DefaultBowlingCue(ProductionCharacterRole role)
        {
            return ProductionBowlingCueProfile.ForHostDelivery(
                role,
                "stock",
                role == ProductionCharacterRole.PaceBowler ? 130.0 : 85.0,
                role == ProductionCharacterRole.PaceBowler ? 130.0 : 85.0,
                0.0,
                0.0,
                role == ProductionCharacterRole.PaceBowler ? 10.0 : 12.0);
        }

        private static bool IsDeliveryState(WorldState value)
        {
            return value == WorldState.RunUp || value == WorldState.Flight ||
                   value == WorldState.Resolved || value == WorldState.Recovery ||
                   value == WorldState.Outcome;
        }

        private Vector3 ToUnity(TraceVector3 value)
        {
            if (value == null) return Vector3.zero;
            var mirror = PresentationMirror;
            return new Vector3(mirror * (float)value.x, (float)value.y, (float)value.z);
        }

        /// <summary>
        /// Spin and a seam-plane normal are axial vectors. Under the physics-to-Unity
        /// x reflection (a right-hander; see PresentationMirror) they transform as
        /// det(M) Mv = (x,-y,-z), unlike positions and the polished pole, which use ToUnity.
        /// </summary>
        private Vector3 ToUnityAxial(TraceVector3 value)
        {
            if (value == null) return Vector3.zero;
            var mirrored = PresentationMirror < 0f;
            return mirrored
                ? new Vector3((float)value.x, -(float)value.y, -(float)value.z)
                : new Vector3((float)value.x, (float)value.y, (float)value.z);
        }

        private void OnDestroy()
        {
            if (renderObserver != null) renderObserver.Rendered -= OnFrameRendered;
            keeperOcclusion?.Dispose();
            fieldPip?.Dispose();
            fieldPip = null;
            foreach (var lensFade in lensFades) lensFade.Dispose();
            lensFades.Clear();
            deliveryEffects?.Dispose();
            coachGuidePresentation?.Dispose();
            ball?.Dispose();
            productionEnvironment?.Dispose();
            bowlerRig?.Dispose();
            batterRig?.Dispose();
            nonStrikerRig?.Dispose();
            for (var index = 0; index < fieldingRigs.Count; index++)
                fieldingRigs[index]?.Dispose();
            characterResources?.Dispose();
        }
    }

    /// <summary>
    /// Conservative camera projection used only for host layout avoidance. It
    /// does not alter world state or infer a cricket outcome.
    /// </summary>
    internal static class PracticeProtectedRegionProjector
    {
        public static UnityPracticeProtectedRegion ProjectRenderers(
            string kind,
            Camera camera,
            int viewportWidth,
            int viewportHeight,
            GameObject root)
        {
            if (root == null || !root.activeInHierarchy) return null;
            var accumulator = new ProjectionAccumulator(
                kind, camera, viewportWidth, viewportHeight);
            var renderers = root.GetComponentsInChildren<Renderer>(false);
            for (var index = 0; index < renderers.Length; index++)
            {
                var renderer = renderers[index];
                if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                accumulator.IncludeBounds(renderer.bounds);
            }
            return accumulator.Region();
        }

        public static UnityPracticeProtectedRegion ProjectRenderer(
            string kind,
            Camera camera,
            int viewportWidth,
            int viewportHeight,
            Renderer renderer)
        {
            if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) return null;
            var accumulator = new ProjectionAccumulator(
                kind, camera, viewportWidth, viewportHeight);
            accumulator.IncludeBounds(renderer.bounds);
            return accumulator.Region();
        }

        public static UnityPracticeProtectedRegion ProjectEnvelope(
            string kind,
            Camera camera,
            int viewportWidth,
            int viewportHeight,
            Vector3 centre,
            float radius)
        {
            var accumulator = new ProjectionAccumulator(
                kind, camera, viewportWidth, viewportHeight);
            accumulator.IncludeEnvelope(centre, radius, 0f);
            return accumulator.Region();
        }

        public static UnityPracticeProtectedRegion ProjectPointUnion(
            string kind,
            Camera camera,
            int viewportWidth,
            int viewportHeight,
            Vector3[] points,
            float radius,
            float minimumPaddingPixels)
        {
            if (points == null || points.Length == 0) return null;
            var accumulator = new ProjectionAccumulator(
                kind, camera, viewportWidth, viewportHeight);
            for (var index = 0; index < points.Length; index++)
                accumulator.IncludeEnvelope(points[index], radius, minimumPaddingPixels);
            return accumulator.Region();
        }

        private sealed class ProjectionAccumulator
        {
            private readonly string kind;
            private readonly Camera camera;
            private readonly int viewportWidth;
            private readonly int viewportHeight;
            private double minX = double.PositiveInfinity;
            private double minY = double.PositiveInfinity;
            private double maxX = double.NegativeInfinity;
            private double maxY = double.NegativeInfinity;

            public ProjectionAccumulator(
                string kind,
                Camera camera,
                int viewportWidth,
                int viewportHeight)
            {
                this.kind = kind;
                this.camera = camera;
                this.viewportWidth = viewportWidth;
                this.viewportHeight = viewportHeight;
            }

            public void IncludeBounds(Bounds bounds)
            {
                var centre = bounds.center;
                var extents = bounds.extents;
                for (var corner = 0; corner < 8; corner++)
                {
                    IncludeWorldPoint(centre + new Vector3(
                        (corner & 1) == 0 ? -extents.x : extents.x,
                        (corner & 2) == 0 ? -extents.y : extents.y,
                        (corner & 4) == 0 ? -extents.z : extents.z));
                }
            }

            public void IncludeEnvelope(Vector3 centre, float radius, float minimumPaddingPixels)
            {
                if (camera == null || float.IsNaN(radius) || float.IsInfinity(radius) || radius < 0f) return;
                var projected = camera.WorldToViewportPoint(centre);
                if (!VisibleDepth(projected.z)) return;
                var centreX = projected.x * viewportWidth;
                var centreY = (1f - projected.y) * viewportHeight;
                var right = camera.WorldToViewportPoint(centre + camera.transform.right * radius);
                var up = camera.WorldToViewportPoint(centre + camera.transform.up * radius);
                var radiusPixels = Math.Max(
                    minimumPaddingPixels,
                    Math.Max(
                        Math.Abs(right.x - projected.x) * viewportWidth,
                        Math.Abs(up.y - projected.y) * viewportHeight));
                IncludePixel(centreX - radiusPixels, centreY - radiusPixels);
                IncludePixel(centreX + radiusPixels, centreY + radiusPixels);
            }

            public UnityPracticeProtectedRegion Region()
            {
                if (double.IsInfinity(minX) || double.IsInfinity(minY) ||
                    double.IsInfinity(maxX) || double.IsInfinity(maxY)) return null;
                var left = Math.Max(0.0, minX);
                var top = Math.Max(0.0, minY);
                var right = Math.Min(viewportWidth, maxX);
                var bottom = Math.Min(viewportHeight, maxY);
                if (!(right > left) || !(bottom > top)) return null;
                return new UnityPracticeProtectedRegion
                {
                    Kind = kind,
                    X = left,
                    Y = top,
                    Width = right - left,
                    Height = bottom - top
                };
            }

            private void IncludeWorldPoint(Vector3 point)
            {
                if (camera == null) return;
                var projected = camera.WorldToViewportPoint(point);
                if (!VisibleDepth(projected.z)) return;
                IncludePixel(
                    projected.x * viewportWidth,
                    (1f - projected.y) * viewportHeight);
            }

            private void IncludePixel(double x, double y)
            {
                if (double.IsNaN(x) || double.IsInfinity(x) ||
                    double.IsNaN(y) || double.IsInfinity(y)) return;
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }

            private bool VisibleDepth(float depth)
            {
                return camera != null && !float.IsNaN(depth) && !float.IsInfinity(depth) &&
                       depth >= camera.nearClipPlane && depth <= camera.farClipPlane;
            }
        }
    }
}
