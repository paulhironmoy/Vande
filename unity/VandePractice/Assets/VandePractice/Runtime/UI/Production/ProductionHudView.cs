using System;
using UnityEngine;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Environment;

namespace Vande.Practice.UI.Production
{
    /// <summary>
    /// Retained-mode live Practice overlay built from camera-space meshes and
    /// UI Toolkit/TextCore Advanced Text. It never owns cricket outcomes.
    /// </summary>
    public sealed class ProductionHudView : MonoBehaviour
    {
        private const int HudLayer = 31;
        private const float OutcomeFadeSeconds = 0.16f;
        private const float DefaultCaptionSeconds = 1.35f;
        private const float BatterCreaseZMetres = 8.84f;
        public const string PracticeBallAction = "practice_ball";
        public const string NextBallAction = "next_ball";

        // Frozen Gate-A live-play palette. The restrained cyan/amber pair is
        // semantic (completed/current or batter/bowler), never decorative.
        private static readonly Color WarmWhite = new Color(0.965f, 0.953f, 0.91f, 1f);
        private static readonly Color Secondary = new Color(0.741f, 0.769f, 0.761f, 1f);
        private static readonly Color Stadium = new Color(0.020f, 0.047f, 0.078f, 1f);
        private static readonly Color Frame = new Color(0.92f, 0.95f, 0.94f, 1f);
        private static readonly Color Shadow = new Color(0.005f, 0.010f, 0.016f, 1f);
        private static readonly Color Accent = new Color(0.18f, 0.79f, 0.78f, 1f);
        private static readonly Color Brand = new Color(0.961f, 0.69f, 0.20f, 1f);
        private static readonly Color Field = new Color(0.027f, 0.141f, 0.11f, 1f);
        private static readonly Color FieldLine = new Color(0.89f, 0.93f, 0.88f, 1f);
        private static readonly Color Pitch = new Color(0.82f, 0.74f, 0.54f, 1f);
        private static readonly Color Success = new Color(0.33f, 0.72f, 0.47f, 1f);
        private static readonly Color Danger = new Color(0.84f, 0.25f, 0.22f, 1f);

        private readonly ProductionBallMarkerState[] markerStates =
            new ProductionBallMarkerState[6];
        private readonly int[] markerRuns = new int[6];
        private readonly ProductionHudShape[] markerDiscs = new ProductionHudShape[6];
        private readonly ProductionHudLabel[] markerLabels = new ProductionHudLabel[6];
        private readonly ProductionHudShape[] fielderMarkers = new ProductionHudShape[11];

        private PracticePresentationSettings settings;
        private PracticeScenePresentation scene;
        private ProductionFieldState liveFieldState;
        private int renderedFieldStateVersion = -1;
        private GameObject generatedRoot;
        private Camera overlayCamera;
        private ProductionHudVisualResources resources;
        private ProductionHudShape scoreShadow;
        private ProductionHudShape scoreFrame;
        private ProductionHudShape scorePanel;
        private ProductionHudShape timelinePanel;
        private ProductionHudShape conditionsShadow;
        private ProductionHudShape conditionsFrame;
        private ProductionHudShape conditionsPanel;
        private ProductionHudShape pauseShadow;
        private ProductionHudShape pauseFrame;
        private ProductionHudShape pausePanel;
        private ProductionHudShape pauseBarLeft;
        private ProductionHudShape pauseBarRight;
        private ProductionHudShape pipShadow;
        private ProductionHudShape pipFrame;
        private ProductionHudShape pipPanel;
        // HUM item 6: the field-overview PIP camera's render texture, shown in the radar's projection rect when the
        // world provides it (the 2D radar below stays as the fallback, e.g. isolated HUD tests).
        private ProductionHudShape pipImage;
        private Material pipImageMaterial;
        private Mesh pipImageQuad;
        private Texture fieldPipTexture;
        private ProductionHudShape fieldSurface;
        private ProductionHudShape fieldBoundary;
        private ProductionHudShape pitchSurface;
        private ProductionHudShape batterMarker;
        private ProductionHudShape outcomeShadow;
        private ProductionHudShape outcomeFrame;
        private ProductionHudShape outcomePanel;
        private ProductionHudShape primaryActionFrame;
        private ProductionHudShape primaryActionPanel;
        private ProductionHudShape secondaryActionFrame;
        private ProductionHudShape secondaryActionPanel;
        private ProductionHudShape captionShadow;
        private ProductionHudShape captionFrame;
        private ProductionHudShape captionPanel;
        private ProductionHudShape setupBriefShadow;
        private ProductionHudShape setupBriefFrame;
        private ProductionHudShape setupBriefPanel;
        private ProductionHudShape setupBriefCloseFrame;
        private ProductionHudShape setupBriefClosePanel;
        private ProductionHudLabel scoreLabel;
        private ProductionHudLabel overLabel;
        private ProductionHudLabel conditionsLabel;
        private ProductionHudLabel outcomeLabel;
        private ProductionHudLabel reasonLabel;
        private ProductionHudLabel recommendationLabel;
        private ProductionHudLabel primaryActionLabel;
        private ProductionHudLabel secondaryActionLabel;
        private ProductionHudLabel captionLabel;
        private ProductionHudLabel setupBriefLabel;
        private ProductionHudLabel setupBriefCloseLabel;
        private ProductionHudLayoutSnapshot layout;
        private Rect fieldProjectionBounds;
        private int totalRuns;
        private int wickets;
        private int legalBalls;
        private int overIndex;
        private int ballIndex;
        private bool scoreKnown;
        private bool quiet;
        private bool reducedMotion;
        private bool highContrast;
        private bool pauseAvailable;
        private bool paused;
        private bool interactionHeld;
        private bool pauseRequestPending;
        private bool betweenBallReady;
        private bool setupBriefOpen;
        private int? coachStage;
        private bool outcomePending;
        private bool outcomeVisible;
        private bool outcomeKnown;
        private int outcomeRuns;
        private string outcomeDismissal;
        private ProductionBallMarkerState outcomeState = ProductionBallMarkerState.Upcoming;
        private string outcomeText = string.Empty;
        private float outcomeOpacity;
        private bool deadBallGuidanceConfigured;
        private bool deadBallActionConsumed;
        private bool replayPresentation;
        private string deadBallReason = string.Empty;
        private string deadBallRecommendation = string.Empty;
        private string primaryAction = string.Empty;
        private string primaryActionText = string.Empty;
        private string secondaryAction = string.Empty;
        private string secondaryActionText = string.Empty;
        private bool captionVisible;
        private Rect captionRect;
        private bool outcomeBlockVisible;
        private bool outcomeBlockIsGuidance;
        private string captionText = string.Empty;
        private float captionRemainingSeconds;
        private float textScale = 1f;
        private int viewportWidth;
        private int viewportHeight;
        private Rect viewportSafeArea;
        private float viewportDpi;
        private bool viewportOverride;
        private bool externalOverlayPresentation;
        private int generatedObjectCount;

        public event Func<bool> PauseRequested;
        public event Func<string, bool> DeadBallActionRequested;

        public bool Quiet => quiet;
        public bool ReducedMotion => reducedMotion;
        public bool HighContrast => highContrast;
        public bool Paused => paused;
        public bool InteractionHeld => interactionHeld;
        public bool PauseAvailable => pauseAvailable;
        public bool PauseRequestPending => pauseRequestPending;
        public bool SetupBriefAvailable => SetupBriefCanOpen();
        public bool SetupBriefOpen => setupBriefOpen;
        public bool SetupBriefVisible => setupBriefOpen && SetupBriefCanOpen();
        public string SetupBriefText => ProductionHudCopy.SetupBrief(
            scene, settings?.Assistance, coachStage, settings?.Locale);
        public bool IsBuilt => generatedRoot != null && resources != null;
        public bool OutcomeVisible => outcomeVisible;
        public float OutcomeOpacity => outcomeOpacity;
        public float TextScale => textScale;
        public int GeneratedObjectCount => generatedObjectCount;
        public int ActiveFielderCount => liveFieldState != null
            ? Mathf.Min(11, liveFieldState.Count)
            : scene?.Fielders == null ? 0 : Mathf.Min(11, scene.Fielders.Length);
        public string ScoreText => totalRuns + "/" + wickets;
        public string OverText => scoreKnown
            ? legalBalls / 6 + "." + legalBalls % 6
            : overIndex + "." + ballIndex;
        public string ConditionsText => FormatConditions();
        public string OutcomeText => outcomeText;
        public string DeadBallReasonText => deadBallReason;
        public string DeadBallRecommendationText => deadBallRecommendation;
        public string DeadBallPrimaryAction => primaryAction;
        public string DeadBallPrimaryActionText => primaryActionText;
        public string DeadBallSecondaryAction => secondaryAction;
        public string DeadBallSecondaryActionText => secondaryActionText;
        public bool DeadBallGuidanceConfigured => deadBallGuidanceConfigured;
        public bool DeadBallActionConsumed => deadBallActionConsumed;
        public bool ReplayPresentation => replayPresentation;
        public bool DeadBallGuidanceVisible => GuidanceCanRender();
        public bool DeadBallActionsEnabled => GuidanceCanRender() && !paused && !interactionHeld &&
                                              !deadBallActionConsumed;
        public bool DeadBallSecondaryActionVisible =>
            DeadBallGuidanceVisible && HasSecondaryAction();
        public bool CaptionVisible => captionVisible;
        public string CaptionText => captionText;
        public float CaptionRemainingSeconds => captionRemainingSeconds;
        public Rect PauseTargetPixels => layout?.Pause ?? default(Rect);
        public Rect FieldPipPixels => layout?.FieldPip ?? default(Rect);
        public Rect FieldProjectionPixels => fieldProjectionBounds;
        public Rect CaptionTargetPixels => layout?.Caption ?? default(Rect);
        public Rect SetupBriefTargetPixels => layout?.SetupBriefTarget ?? default(Rect);
        public Rect SetupBriefSurfacePixels => layout?.SetupBriefSurface ?? default(Rect);
        public Rect SetupBriefCloseTargetPixels => layout?.SetupBriefClose ?? default(Rect);
        public Rect DeadBallPrimaryActionTargetPixels => layout == null
            ? default(Rect)
            : HasSecondaryAction()
                ? layout.DeadBallPrimaryActionWithSecondary
                : layout.DeadBallPrimaryAction;
        public Rect DeadBallSecondaryActionTargetPixels =>
            layout != null && HasSecondaryAction()
                ? layout.DeadBallSecondaryAction
                : default(Rect);
        public ProductionHudLayoutSnapshot CurrentLayout => layout;
        public bool ExternalOverlayPresentation => externalOverlayPresentation;
        public bool PresentationVisible => generatedRoot != null && generatedRoot.activeSelf;
        public bool ScoreVisible => scorePanel != null && scorePanel.Visible;
        public bool ConditionsVisible => conditionsPanel != null && conditionsPanel.Visible;
        public bool FieldPipVisible => pipPanel != null && pipPanel.Visible;

        /// <summary>The live rail's budget in Delivery Quiet Mode (M5, owner decision 2026-11-04: at 100% text).</summary>
        public const float QuietRailBudget = ProductionHudLayout.LiveQuietMaximumOccupancy;

        /// <summary>
        /// Owner decision 2026-11-04: the field inset follows the web; through Delivery Quiet Mode it is not drawn
        /// wherever the rail plus the inset would cover more than 8% of the screen (640x360 measured 8.93% with it). At
        /// 200% text the accessibility floors keep the rail itself; the inset still gives way.
        /// </summary>
        private bool FieldPipOverQuietBudget =>
            quiet && layout != null && viewportWidth > 0 && viewportHeight > 0 &&
            layout.LiveQuietRailCoverage(viewportWidth, viewportHeight) > QuietRailBudget;
        public bool PauseVisible => pausePanel != null && pausePanel.Visible;
        public bool PauseGlyphVisible => pauseBarLeft != null && pauseBarLeft.Visible &&
                                         pauseBarRight != null && pauseBarRight.Visible;

        public void Configure(PracticePresentationSettings value)
        {
            settings = value ?? throw new ArgumentNullException(nameof(value));
            reducedMotion = value.ReducedMotion;
            textScale = Mathf.Clamp(value.TextScale, 1f, 2f);
            highContrast = value.HighContrast;
            EnsureBuilt();
            RefreshViewport(true);
            ApplyAllVisuals();
        }

        public void SetLocale(string locale)
        {
            if (settings == null) throw new InvalidOperationException("HUD settings must be configured before locale.");
            settings.Locale = locale;
            if (outcomeKnown)
                outcomeText = ProductionHudCopy.Outcome(outcomeRuns, outcomeDismissal, settings.Locale);
            ApplyConditions();
            ApplySetupBrief();
            ApplyOutcome();
        }

        /// <summary>
        /// Stores validated, already-localized dead-ball guidance. An empty
        /// recommendation keeps the action row available while analysis is in
        /// its initial state. This method owns presentation only: it cannot
        /// reveal the surface until an authoritative outcome has been
        /// committed and Quiet Mode has ended.
        /// </summary>
        public void SetDeadBallGuidance(
            string reason,
            string recommendation,
            string primaryAction,
            string primaryLabel,
            string secondaryAction = null,
            string secondaryLabel = null)
        {
            if (string.IsNullOrWhiteSpace(reason))
                throw new ArgumentException("Dead-ball reason is required.", nameof(reason));
            if (!ValidDeadBallAction(primaryAction))
                throw new ArgumentOutOfRangeException(nameof(primaryAction));
            if (string.IsNullOrWhiteSpace(primaryLabel))
                throw new ArgumentException("Primary action label is required.", nameof(primaryLabel));

            var hasSecondaryAction = !string.IsNullOrWhiteSpace(secondaryAction);
            var hasSecondaryLabel = !string.IsNullOrWhiteSpace(secondaryLabel);
            if (hasSecondaryAction != hasSecondaryLabel)
                throw new ArgumentException(
                    "Secondary action and label must be supplied together.",
                    nameof(secondaryAction));
            if (hasSecondaryAction && !ValidDeadBallAction(secondaryAction))
                throw new ArgumentOutOfRangeException(nameof(secondaryAction));
            if (hasSecondaryAction && string.Equals(
                    primaryAction,
                    secondaryAction,
                    StringComparison.Ordinal))
                throw new ArgumentException(
                    "Primary and secondary dead-ball actions must be distinct.",
                    nameof(secondaryAction));

            var preserveConsumedState = deadBallGuidanceConfigured && deadBallActionConsumed;
            deadBallReason = reason.Trim();
            deadBallRecommendation = string.IsNullOrWhiteSpace(recommendation)
                ? string.Empty
                : recommendation.Trim();
            this.primaryAction = primaryAction;
            primaryActionText = primaryLabel.Trim();
            this.secondaryAction = hasSecondaryAction ? secondaryAction : string.Empty;
            secondaryActionText = hasSecondaryAction ? secondaryLabel.Trim() : string.Empty;
            deadBallGuidanceConfigured = true;
            deadBallActionConsumed = preserveConsumedState;
            SetBetweenBallReady(!preserveConsumedState);
            SetPauseAvailable(!preserveConsumedState);
            EnsureBuilt();
            PositionDeadBallVisuals();
            ApplyOutcome();
        }

        public void ClearDeadBallGuidance()
        {
            deadBallReason = string.Empty;
            deadBallRecommendation = string.Empty;
            primaryAction = string.Empty;
            primaryActionText = string.Empty;
            secondaryAction = string.Empty;
            secondaryActionText = string.Empty;
            deadBallGuidanceConfigured = false;
            deadBallActionConsumed = false;
            if (!IsBuilt) return;
            PositionDeadBallVisuals();
            ApplyOutcome();
        }

        /// <summary>
        /// Replay is presentation state supplied by the runtime. Guidance and
        /// its hit targets are suppressed without discarding their dead-ball
        /// copy, so leaving replay can restore the same authoritative state.
        /// </summary>
        public void SetReplayPresentation(bool value)
        {
            if (replayPresentation == value) return;
            replayPresentation = value;
            if (value) SetPauseAvailable(false);
            if (value) SetBetweenBallReady(false);
            ApplyOutcome();
        }

        public bool TryRequestDeadBallActionAt(Vector2 pixelPosition)
        {
            if (setupBriefOpen || !GuidanceCanRender() || paused || interactionHeld ||
                deadBallActionConsumed || layout == null)
                return false;

            string requestedAction = null;
            if (HasSecondaryAction() &&
                layout.DeadBallSecondaryAction.Contains(pixelPosition))
                requestedAction = secondaryAction;
            else if (DeadBallPrimaryActionTargetPixels.Contains(pixelPosition))
                requestedAction = primaryAction;

            if (string.IsNullOrEmpty(requestedAction)) return false;
            var handlers = DeadBallActionRequested;
            if (handlers == null) return false;
            var accepted = false;
            foreach (Func<string, bool> handler in handlers.GetInvocationList())
            {
                if (!handler(requestedAction)) continue;
                accepted = true;
                break;
            }
            // A stale/pause race may reject the synchronous request. Keep both
            // targets enabled unless an authority handler explicitly accepts.
            if (!accepted) return false;
            deadBallActionConsumed = true;
            SetBetweenBallReady(false);
            SetPauseAvailable(false);
            ApplyOutcome();
            return true;
        }

        /// <summary>
        /// Allows a deliberately selected external visual presentation to hide
        /// this HUD while retaining its state. VANDE's WebGL and Android live
        /// surfaces both leave this false: Unity owns the visible HUD and the web
        /// host exposes only a non-visual accessibility mirror.
        /// </summary>
        public void SetExternalOverlayPresentation(bool value)
        {
            externalOverlayPresentation = value;
            if (generatedRoot != null) generatedRoot.SetActive(!value);
            enabled = !value;
        }

        public void SetScene(PracticeScenePresentation value)
        {
            scene = value ?? throw new ArgumentNullException(nameof(value));
            if (scene.Fielders == null || scene.Fielders.Length != 11)
                throw new ArgumentException("A complete eleven-player field is required.", nameof(value));
            EnsureBuilt();
            SetBetweenBallReady(true);
            ApplyConditions();
            ApplyField();
        }

        /// <summary>
        /// Binds the authoritative live field snapshot owned by the world. The
        /// HUD still falls back to the immutable scene field in isolated tests
        /// or before a production world is available.
        /// </summary>
        /// <summary>The world's field-overview PIP render texture (null restores the 2D radar).</summary>
        public void SetFieldPipTexture(Texture value)
        {
            fieldPipTexture = value;
            if (pipImageMaterial != null) pipImageMaterial.mainTexture = value;
            ApplyField();
        }

        internal bool FieldPipImageVisible => pipImage != null && pipImage.Visible;

        public void BindFieldState(ProductionFieldState value)
        {
            liveFieldState = value;
            renderedFieldStateVersion = -1;
            ApplyField();
        }

        public void SetDelivery(int over, int ball, int? activeCoachStage = null)
        {
            if (over < 0) throw new ArgumentOutOfRangeException(nameof(over));
            if (ball < 0 || ball >= markerStates.Length) throw new ArgumentOutOfRangeException(nameof(ball));
            if (activeCoachStage.HasValue &&
                (activeCoachStage.Value < 1 || activeCoachStage.Value > 4))
                throw new ArgumentOutOfRangeException(nameof(activeCoachStage));

            if (over != overIndex)
            {
                for (var index = 0; index < markerStates.Length; index++)
                {
                    markerStates[index] = ProductionBallMarkerState.Upcoming;
                    markerRuns[index] = 0;
                }
            }

            overIndex = over;
            ballIndex = ball;
            coachStage = activeCoachStage;
            markerStates[ball] = ProductionBallMarkerState.Current;
            markerRuns[ball] = 0;
            outcomePending = false;
            outcomeVisible = false;
            outcomeKnown = false;
            outcomeRuns = 0;
            outcomeDismissal = null;
            outcomeState = ProductionBallMarkerState.Upcoming;
            outcomeText = string.Empty;
            outcomeOpacity = 0f;
            ClearCaption();
            ClearDeadBallGuidance();
            interactionHeld = false;
            SetBetweenBallReady(false);
            SetPauseAvailable(true);
            ApplyScore();
            ApplyTimeline();
            ApplyOutcome();
        }

        public void SetScore(int runs, int wicketCount, int balls)
        {
            if (runs < 0) throw new ArgumentOutOfRangeException(nameof(runs));
            if (wicketCount < 0) throw new ArgumentOutOfRangeException(nameof(wicketCount));
            if (balls < 0) throw new ArgumentOutOfRangeException(nameof(balls));
            totalRuns = runs;
            wickets = wicketCount;
            legalBalls = balls;
            scoreKnown = true;
            ApplyScore();
        }

        /// <summary>
        /// Stores a resolved result. It remains hidden while Delivery Quiet
        /// Mode is active and appears only after the world reports dead ball.
        /// </summary>
        public void SetOutcome(int runs, string dismissal)
        {
            if (runs < 0) throw new ArgumentOutOfRangeException(nameof(runs));
            outcomeKnown = true;
            outcomeRuns = runs;
            outcomeDismissal = dismissal;
            outcomePending = true;
            markerRuns[ballIndex] = runs;
            outcomeState = !string.IsNullOrEmpty(dismissal)
                ? ProductionBallMarkerState.Wicket
                : runs == 0
                    ? ProductionBallMarkerState.Dot
                    : runs == 4 || runs == 6
                        ? ProductionBallMarkerState.Boundary
                        : ProductionBallMarkerState.Runs;
            markerStates[ballIndex] = outcomeState;
            outcomeText = ProductionHudCopy.Outcome(runs, dismissal, settings?.Locale);
            outcomeVisible = false;
            outcomeOpacity = 0f;
            ApplyTimeline();
            // The controller normally resolves the queued result after the world
            // has already left Delivery Quiet Mode. In that valid ordering there
            // is no later quiet-state transition to reveal the outcome.
            if (quiet) ApplyOutcome();
            else RevealOutcome();
        }

        public void SetQuiet(bool value)
        {
            if (quiet == value)
            {
                ApplyQuietPalette();
                return;
            }

            var wasQuiet = quiet;
            quiet = value;
            if (quiet)
            {
                outcomeVisible = false;
                outcomeOpacity = 0f;
            }
            else if (wasQuiet && outcomePending)
            {
                RevealOutcome();
            }
            ApplyQuietPalette();
            ApplySetupBrief();
            ApplyOutcome();
        }

        public void SetTextScale(float value)
        {
            var clamped = Mathf.Clamp(value, 1f, 2f);
            if (Mathf.Approximately(textScale, clamped)) return;
            textScale = clamped;
            if (!IsBuilt) return;
            RefreshViewport(true);
            ApplyAllVisuals();
        }

        public void SetReducedMotion(bool value)
        {
            reducedMotion = value;
            if (reducedMotion && outcomeVisible)
            {
                outcomeOpacity = 1f;
                ApplyOutcome();
            }
        }

        public void SetHighContrast(bool value)
        {
            if (highContrast == value) return;
            highContrast = value;
            if (settings != null) settings.HighContrast = value;
            if (IsBuilt) ApplyAllVisuals();
        }

        /// <summary>Applies authoritative host pause/resume state to the visible controls.</summary>
        public void SetPaused(bool value)
        {
            paused = value;
            if (!value) pauseRequestPending = false;
            ApplyPauseState();
            ApplyOutcome();
            ApplySetupBrief();
        }

        public void SetInteractionHeld(bool value)
        {
            interactionHeld = value;
            ApplyPauseState();
            ApplyOutcome();
            ApplySetupBrief();
        }

        public void SetBetweenBallReady(bool value)
        {
            betweenBallReady = value;
            if (!value) setupBriefOpen = false;
            ApplyConditions();
            ApplySetupBrief();
            ApplyPauseState();
            ApplyOutcome();
        }

        public bool TryToggleSetupBriefAt(Vector2 pixelPosition)
        {
            if (layout == null) return false;
            if (setupBriefOpen)
            {
                if (!layout.SetupBriefClose.Contains(pixelPosition)) return false;
                setupBriefOpen = false;
                ApplyConditions();
                ApplySetupBrief();
                ApplyPauseState();
                ApplyOutcome();
                return true;
            }
            if (!SetupBriefCanOpen() || !layout.SetupBriefTarget.Contains(pixelPosition)) return false;
            setupBriefOpen = true;
            ApplyConditions();
            ApplySetupBrief();
            ApplyPauseState();
            ApplyOutcome();
            return true;
        }

        /// <summary>
        /// Enables pause only in bridge phases that can accept the request. A
        /// state change clears a locally pending tap so stale UI cannot survive
        /// delivery, replay or dead-ball transitions.
        /// </summary>
        public void SetPauseAvailable(bool value)
        {
            pauseAvailable = value;
            pauseRequestPending = false;
            ApplyPauseState();
        }

        /// <summary>
        /// Presents a short accessibility caption on a retained peripheral
        /// surface. Captions remain readable in Delivery Quiet Mode because
        /// they describe causal cricket audio rather than coaching or chrome.
        /// No visual objects are created by this live-delivery call.
        /// </summary>
        public void PresentCaption(string value, float visibleSeconds = DefaultCaptionSeconds)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                ClearCaption();
                return;
            }
            if (float.IsNaN(visibleSeconds) || float.IsInfinity(visibleSeconds) ||
                visibleSeconds <= 0f)
                throw new ArgumentOutOfRangeException(nameof(visibleSeconds));

            EnsureBuilt();
            RefreshViewport(false);
            captionText = value;
            captionRemainingSeconds = visibleSeconds;
            captionVisible = true;
            ApplyCaption();
            ApplyOutcome();
        }

        public void ClearCaption()
        {
            captionText = string.Empty;
            captionRemainingSeconds = 0f;
            captionVisible = false;
            ApplyCaption();
            ApplyOutcome();
        }

        public ProductionBallMarkerState BallMarkerState(int index)
        {
            if (index < 0 || index >= markerStates.Length)
                throw new ArgumentOutOfRangeException(nameof(index));
            return markerStates[index];
        }

        public string BallMarkerLabel(int index)
        {
            if (index < 0 || index >= markerStates.Length)
                throw new ArgumentOutOfRangeException(nameof(index));
            return ProductionHudCopy.TimelineLabel(markerStates[index], markerRuns[index]);
        }

        public Vector2 FielderPixelPosition(int index)
        {
            if (index < 0)
                throw new ArgumentOutOfRangeException(nameof(index));
            if (liveFieldState != null)
            {
                if (index >= liveFieldState.Count) throw new ArgumentOutOfRangeException(nameof(index));
                var normalized = liveFieldState.NormalizedRadarPoint(
                    index, scene != null && scene.Handedness == "left");
                return new Vector2(
                    fieldProjectionBounds.xMin + normalized.x * fieldProjectionBounds.width,
                    fieldProjectionBounds.yMin + normalized.y * fieldProjectionBounds.height);
            }
            if (scene?.Fielders == null || index >= scene.Fielders.Length)
                throw new ArgumentOutOfRangeException(nameof(index));
            return ProductionFieldPipProjection.Project(
                scene.Fielders[index].X,
                scene.Fielders[index].Z,
                scene.Handedness == "left",
                fieldProjectionBounds);
        }

        public bool TryRequestPauseAt(Vector2 pixelPosition)
        {
            if (setupBriefOpen || !PauseCanRender() || layout == null ||
                !layout.Pause.Contains(pixelPosition)) return false;
            var handlers = PauseRequested;
            if (handlers == null) return false;
            var accepted = false;
            foreach (Func<bool> handler in handlers.GetInvocationList())
            {
                if (!handler()) continue;
                accepted = true;
                break;
            }
            if (!accepted) return false;
            pauseRequestPending = true;
            ApplyPauseState();
            return true;
        }

        public void AdvancePresentation(float unscaledDeltaSeconds)
        {
            if (float.IsNaN(unscaledDeltaSeconds) || float.IsInfinity(unscaledDeltaSeconds) ||
                unscaledDeltaSeconds < 0f)
                throw new ArgumentOutOfRangeException(nameof(unscaledDeltaSeconds));
            if (captionVisible)
            {
                captionRemainingSeconds = Mathf.Max(0f, captionRemainingSeconds - unscaledDeltaSeconds);
                if (captionRemainingSeconds <= 0f) ClearCaption();
            }

            if (liveFieldState != null && renderedFieldStateVersion != liveFieldState.Version)
                ApplyField();

            if (outcomeVisible && !quiet && !reducedMotion && outcomeOpacity < 1f)
            {
                outcomeOpacity = Mathf.Clamp01(outcomeOpacity + unscaledDeltaSeconds / OutcomeFadeSeconds);
                ApplyOutcome();
            }
        }

        public void SetViewportForTesting(int width, int height, Rect safeArea, float dpi)
        {
            if (width <= 0) throw new ArgumentOutOfRangeException(nameof(width));
            if (height <= 0) throw new ArgumentOutOfRangeException(nameof(height));
            viewportOverride = true;
            viewportWidth = width;
            viewportHeight = height;
            viewportSafeArea = safeArea;
            viewportDpi = dpi;
            if (!IsBuilt) return;
            RefreshViewport(true);
            ApplyAllVisuals();
        }

        public void Release()
        {
            if (generatedRoot != null) DestroyOwned(generatedRoot);
            resources?.Release();
            if (pipImageMaterial != null) DestroyImmediate(pipImageMaterial);
            if (pipImageQuad != null) DestroyImmediate(pipImageQuad);
            pipImageMaterial = null;
            pipImageQuad = null;
            pipImage = null;
            generatedRoot = null;
            overlayCamera = null;
            resources = null;
            scoreShadow = null;
            scoreFrame = null;
            scorePanel = null;
            timelinePanel = null;
            conditionsShadow = null;
            conditionsFrame = null;
            conditionsPanel = null;
            pauseShadow = null;
            pauseFrame = null;
            pausePanel = null;
            pauseBarLeft = null;
            pauseBarRight = null;
            pipShadow = null;
            pipFrame = null;
            pipPanel = null;
            fieldSurface = null;
            fieldBoundary = null;
            pitchSurface = null;
            batterMarker = null;
            outcomeShadow = null;
            outcomeFrame = null;
            outcomePanel = null;
            primaryActionFrame = null;
            primaryActionPanel = null;
            secondaryActionFrame = null;
            secondaryActionPanel = null;
            captionShadow = null;
            captionFrame = null;
            captionPanel = null;
            setupBriefShadow = null;
            setupBriefFrame = null;
            setupBriefPanel = null;
            setupBriefCloseFrame = null;
            setupBriefClosePanel = null;
            scoreLabel = null;
            overLabel = null;
            conditionsLabel = null;
            outcomeLabel = null;
            reasonLabel = null;
            recommendationLabel = null;
            primaryActionLabel = null;
            secondaryActionLabel = null;
            captionLabel = null;
            setupBriefLabel = null;
            setupBriefCloseLabel = null;
            for (var index = 0; index < markerDiscs.Length; index++)
            {
                markerDiscs[index] = null;
                markerLabels[index] = null;
            }
            for (var index = 0; index < fielderMarkers.Length; index++) fielderMarkers[index] = null;
            layout = null;
            generatedObjectCount = 0;
            captionText = string.Empty;
            captionRemainingSeconds = 0f;
            captionVisible = false;
            deadBallReason = string.Empty;
            deadBallRecommendation = string.Empty;
            primaryAction = string.Empty;
            primaryActionText = string.Empty;
            secondaryAction = string.Empty;
            secondaryActionText = string.Empty;
            deadBallGuidanceConfigured = false;
            deadBallActionConsumed = false;
            replayPresentation = false;
            betweenBallReady = false;
            setupBriefOpen = false;
            coachStage = null;
            liveFieldState = null;
            renderedFieldStateVersion = -1;
        }

        private void EnsureBuilt()
        {
            if (IsBuilt) return;
            resources = new ProductionHudVisualResources();
            generatedRoot = new GameObject("VANDE Practice HUD");
            generatedRoot.hideFlags = HideFlags.DontSave;
            generatedRoot.layer = HudLayer;
            generatedRoot.transform.SetParent(transform, false);
            generatedRoot.transform.localPosition = Vector3.zero;
            generatedRoot.transform.localRotation = Quaternion.identity;
            generatedRoot.transform.localScale = Vector3.one;
            generatedRoot.SetActive(!externalOverlayPresentation);
            generatedObjectCount = 1;

            var cameraObject = new GameObject("HUD Camera");
            cameraObject.hideFlags = HideFlags.DontSave;
            cameraObject.layer = HudLayer;
            cameraObject.transform.SetParent(generatedRoot.transform, false);
            overlayCamera = cameraObject.AddComponent<Camera>();
            overlayCamera.clearFlags = CameraClearFlags.Depth;
            overlayCamera.cullingMask = 1 << HudLayer;
            overlayCamera.depth = 100f;
            overlayCamera.orthographic = true;
            overlayCamera.nearClipPlane = 0.1f;
            overlayCamera.farClipPlane = 200f;
            overlayCamera.allowHDR = false;
            overlayCamera.allowMSAA = false;
            overlayCamera.useOcclusionCulling = false;
            generatedObjectCount++;

            scoreShadow = Shape("Score Shadow", resources.RoundedRectangle, 2);
            scoreFrame = Shape("Score Frame", resources.RoundedRectangle, 5);
            scorePanel = Shape("Score", resources.RoundedRectangle, 10);
            // Retained as a transparent layout lane. The markers now live
            // inside the score capsule instead of a second block beneath it.
            timelinePanel = Shape("Six Ball Timeline", resources.RoundedRectangle, 11);
            conditionsShadow = Shape("Conditions Shadow", resources.RoundedRectangle, 2);
            conditionsFrame = Shape("Conditions Frame", resources.RoundedRectangle, 5);
            conditionsPanel = Shape("Conditions", resources.RoundedRectangle, 10);
            pauseShadow = Shape("Pause Shadow", resources.RoundedRectangle, 2);
            pauseFrame = Shape("Pause Frame", resources.RoundedRectangle, 5);
            pausePanel = Shape("Pause", resources.RoundedRectangle, 10);
            pauseBarLeft = Shape("Pause Bar Left", resources.Quad, 20);
            pauseBarRight = Shape("Pause Bar Right", resources.Quad, 20);
            pipShadow = Shape("Field PIP Shadow", resources.RoundedRectangle, 2);
            pipFrame = Shape("Field PIP Frame", resources.RoundedRectangle, 5);
            pipPanel = Shape("Field PIP", resources.RoundedRectangle, 10);
            var pipShader = Resources.Load<Shader>("VandeProductionHudTexture");
            if (pipShader != null)
            {
                pipImageMaterial = new Material(pipShader) { name = "VANDE HUD Field PIP", hideFlags = HideFlags.DontSave };
                pipImageQuad = new Mesh { name = "VANDE HUD PIP Quad", hideFlags = HideFlags.DontSave };
                pipImageQuad.vertices = new[]
                {
                    new Vector3(-0.5f, -0.5f), new Vector3(0.5f, -0.5f), new Vector3(0.5f, 0.5f), new Vector3(-0.5f, 0.5f)
                };
                pipImageQuad.uv = new[] { new Vector2(0f, 0f), new Vector2(1f, 0f), new Vector2(1f, 1f), new Vector2(0f, 1f) };
                pipImageQuad.triangles = new[] { 0, 2, 1, 0, 3, 2 };
                pipImageQuad.RecalculateBounds();
                generatedObjectCount++;
                pipImage = new ProductionHudShape(generatedRoot.transform, "Field PIP Image", HudLayer, pipImageQuad,
                    pipImageMaterial, 13);
                pipImage.SetVisible(false);
            }
            fieldSurface = Shape("Full Field", resources.Circle, 11);
            fieldBoundary = Shape("Field Boundary", resources.Ring, 12);
            pitchSurface = Shape("Field Pitch", resources.Quad, 12);
            batterMarker = Shape("Batter Marker", resources.Circle, 15);
            outcomeShadow = Shape("Dead Ball Outcome Shadow", resources.RoundedRectangle, 22);
            outcomeFrame = Shape("Dead Ball Outcome Frame", resources.RoundedRectangle, 25);
            outcomePanel = Shape("Dead Ball Outcome", resources.RoundedRectangle, 30);
            primaryActionFrame = Shape("Dead Ball Primary Action Frame", resources.RoundedRectangle, 33);
            primaryActionPanel = Shape("Dead Ball Primary Action", resources.RoundedRectangle, 35);
            secondaryActionFrame = Shape("Dead Ball Secondary Action Frame", resources.RoundedRectangle, 33);
            secondaryActionPanel = Shape("Dead Ball Secondary Action", resources.RoundedRectangle, 35);
            captionShadow = Shape("Accessibility Caption Shadow", resources.RoundedRectangle, 23);
            captionFrame = Shape("Accessibility Caption Frame", resources.RoundedRectangle, 26);
            captionPanel = Shape("Accessibility Caption", resources.RoundedRectangle, 31);
            setupBriefShadow = Shape("Setup Brief Shadow", resources.RoundedRectangle, 52);
            setupBriefFrame = Shape("Setup Brief Frame", resources.RoundedRectangle, 55);
            setupBriefPanel = Shape("Setup Brief", resources.RoundedRectangle, 60);
            setupBriefCloseFrame = Shape("Setup Brief Close Frame", resources.RoundedRectangle, 62);
            setupBriefClosePanel = Shape("Setup Brief Close", resources.RoundedRectangle, 63);

            scoreLabel = Label("Score Text", 20, TextAnchor.MiddleLeft, TextAlignment.Left).Compact();
            overLabel = Label("Over Text", 20, TextAnchor.MiddleRight, TextAlignment.Right).Compact();
            conditionsLabel = Label("Conditions Text", 20, TextAnchor.MiddleLeft, TextAlignment.Left).Compact();
            outcomeLabel = Label("Outcome Text", 40, TextAnchor.MiddleCenter, TextAlignment.Center).Compact();
            reasonLabel = Label("Dead Ball Reason Text", 40, TextAnchor.MiddleLeft, TextAlignment.Left);
            recommendationLabel = Label(
                "Dead Ball Recommendation Text", 40,
                TextAnchor.MiddleLeft, TextAlignment.Left);
            primaryActionLabel = Label(
                "Dead Ball Primary Action Text", 41,
                TextAnchor.MiddleCenter, TextAlignment.Center).Compact(wrap: true);
            secondaryActionLabel = Label(
                "Dead Ball Secondary Action Text", 41,
                TextAnchor.MiddleCenter, TextAlignment.Center).Compact(wrap: true);
            captionLabel = Label("Caption Text", 41, TextAnchor.MiddleCenter, TextAlignment.Center);
            captionLabel.SetPointerInteractive(false);
            setupBriefLabel = Label(
                "Setup Brief Text", 65, TextAnchor.MiddleLeft, TextAlignment.Left);
            setupBriefCloseLabel = Label(
                "Setup Brief Close Text", 66, TextAnchor.MiddleCenter, TextAlignment.Center);

            for (var index = 0; index < markerDiscs.Length; index++)
            {
                markerDiscs[index] = Shape("Ball " + (index + 1), resources.Circle, 14);
                markerLabels[index] = Label(
                    "Ball " + (index + 1) + " Text", 20,
                    TextAnchor.MiddleCenter, TextAlignment.Center);
            }

            for (var index = 0; index < fielderMarkers.Length; index++)
                fielderMarkers[index] = Shape("Fielder " + (index + 1), resources.Circle, 14);

        }

        private ProductionHudShape Shape(string name, Mesh mesh, int sortingOrder)
        {
            generatedObjectCount++;
            return new ProductionHudShape(
                generatedRoot.transform, name, HudLayer, mesh, resources.Material, sortingOrder);
        }

        private ProductionHudLabel Label(
            string name,
            int sortingOrder,
            TextAnchor anchor,
            TextAlignment alignment)
        {
            generatedObjectCount++;
            return new ProductionHudLabel(
                generatedRoot.transform, name, HudLayer, sortingOrder, anchor, alignment);
        }

        private void RefreshViewport(bool force)
        {
            if (!IsBuilt) return;
            var width = viewportOverride ? viewportWidth : Mathf.Max(1, Screen.width);
            var height = viewportOverride ? viewportHeight : Mathf.Max(1, Screen.height);
            var safeArea = viewportOverride ? viewportSafeArea : Screen.safeArea;
            var dpi = viewportOverride ? viewportDpi : Screen.dpi;
            if (!force && width == viewportWidth && height == viewportHeight &&
                safeArea == viewportSafeArea && Mathf.Approximately(dpi, viewportDpi)) return;

            viewportWidth = width;
            viewportHeight = height;
            viewportSafeArea = safeArea;
            viewportDpi = dpi;
            layout = ProductionHudLayout.Calculate(
                width,
                height,
                safeArea,
                dpi,
                textScale,
                settings != null && settings.PixelsPerDp >= 1f
                    ? settings.PixelsPerDp
                    : (float?)null);
            overlayCamera.transform.localPosition = new Vector3(width * 0.5f, height * 0.5f, -100f);
            overlayCamera.transform.localRotation = Quaternion.identity;
            overlayCamera.orthographicSize = height * 0.5f;
            PositionVisuals();
        }

        private void PositionVisuals()
        {
            if (layout == null) return;
            var dp = layout.DpScale;
            var frameWidth = Mathf.Max(1f, dp * 0.72f);
            var shadowOffset = Mathf.Max(2f, dp * 1.5f);
            scoreShadow.SetRect(OffsetRect(layout.Score, 0f, -shadowOffset));
            scoreFrame.SetRect(ExpandRect(layout.Score, frameWidth));
            scorePanel.SetRect(layout.Score);
            timelinePanel.SetRect(layout.Timeline);
            PositionConditionsRail();
            pauseShadow.SetRect(OffsetRect(layout.Pause, 0f, -shadowOffset));
            pauseFrame.SetRect(ExpandRect(layout.Pause, frameWidth));
            pausePanel.SetRect(layout.Pause);
            var pauseBarWidth = Mathf.Max(3f * dp, layout.Pause.width * 0.105f);
            var pauseBarHeight = layout.Pause.height * 0.38f;
            var pauseBarOffset = layout.Pause.width * 0.105f;
            pauseBarLeft.SetRect(new Rect(
                layout.Pause.center.x - pauseBarOffset - pauseBarWidth * 0.5f,
                layout.Pause.center.y - pauseBarHeight * 0.5f,
                pauseBarWidth,
                pauseBarHeight));
            pauseBarRight.SetRect(new Rect(
                layout.Pause.center.x + pauseBarOffset - pauseBarWidth * 0.5f,
                layout.Pause.center.y - pauseBarHeight * 0.5f,
                pauseBarWidth,
                pauseBarHeight));
            pipShadow.SetRect(OffsetRect(layout.FieldPip, 0f, -shadowOffset));
            pipFrame.SetRect(ExpandRect(layout.FieldPip, frameWidth));
            pipPanel.SetRect(layout.FieldPip);
            PositionDeadBallVisuals();
            var captionRect = layout.Caption;
            captionShadow.SetRect(OffsetRect(captionRect, 0f, -shadowOffset));
            captionFrame.SetRect(ExpandRect(captionRect, frameWidth));
            captionPanel.SetRect(captionRect);
            setupBriefShadow.SetRect(OffsetRect(layout.SetupBriefSurface, 0f, -shadowOffset));
            setupBriefFrame.SetRect(ExpandRect(layout.SetupBriefSurface, frameWidth));
            setupBriefPanel.SetRect(layout.SetupBriefSurface);
            setupBriefCloseFrame.SetRect(ExpandRect(layout.SetupBriefClose, frameWidth));
            setupBriefClosePanel.SetRect(layout.SetupBriefClose);

            // The frozen 84 px reference panel needs a 76 px live-field aperture: the former
            // 8 px inset reduced the authoritative markers to single pixels after composition.
            // Keep the four-pixel frame in density units: it preserves the panel contract and
            // 2x2 minimum marker footprint and one-pixel same-role separation at 844x390.
            var pipInset = 4f * layout.DpScale;
            fieldProjectionBounds = new Rect(
                layout.FieldPip.xMin + pipInset,
                layout.FieldPip.yMin + pipInset,
                Mathf.Max(1f, layout.FieldPip.width - pipInset * 2f),
                Mathf.Max(1f, layout.FieldPip.height - pipInset * 2f));
            fieldSurface.SetRect(fieldProjectionBounds);
            pipImage?.SetRect(fieldProjectionBounds);
            var boundaryInset = fieldProjectionBounds.width * 0.12f;
            fieldBoundary.SetRect(new Rect(
                fieldProjectionBounds.xMin + boundaryInset,
                fieldProjectionBounds.yMin + boundaryInset,
                Mathf.Max(1f, fieldProjectionBounds.width - boundaryInset * 2f),
                Mathf.Max(1f, fieldProjectionBounds.height - boundaryInset * 2f)));
            pitchSurface.SetRect(new Rect(
                fieldProjectionBounds.center.x - fieldProjectionBounds.width * 0.026f,
                fieldProjectionBounds.center.y - fieldProjectionBounds.height * 0.22f,
                fieldProjectionBounds.width * 0.052f,
                fieldProjectionBounds.height * 0.44f));
            ApplyScore();
            ApplyTimeline();
            ApplyConditions();
            ApplyCaption();
            ApplySetupBrief();
            ApplyOutcome();
            ApplyField();
        }

        private void PositionDeadBallVisuals()
        {
            if (!IsBuilt || layout == null || outcomePanel == null) return;
            var dp = layout.DpScale;
            var frameWidth = Mathf.Max(1f, dp * 0.72f);
            var shadowOffset = Mathf.Max(2f, dp * 1.5f);
            var surface = deadBallGuidanceConfigured
                ? layout.DeadBallSurface
                : layout.Outcome;
            outcomeShadow.SetRect(OffsetRect(surface, 0f, -shadowOffset));
            outcomeFrame.SetRect(ExpandRect(surface, frameWidth));
            outcomePanel.SetRect(surface);

            var primaryTarget = HasSecondaryAction()
                ? layout.DeadBallPrimaryActionWithSecondary
                : layout.DeadBallPrimaryAction;
            primaryActionFrame.SetRect(ExpandRect(primaryTarget, frameWidth));
            primaryActionPanel.SetRect(primaryTarget);
            secondaryActionFrame.SetRect(ExpandRect(layout.DeadBallSecondaryAction, frameWidth));
            secondaryActionPanel.SetRect(layout.DeadBallSecondaryAction);
        }

        private void ApplyAllVisuals()
        {
            ApplyScore();
            ApplyTimeline();
            ApplyConditions();
            ApplyField();
            ApplyQuietPalette();
            ApplyPauseState();
            ApplySetupBrief();
            ApplyOutcome();
        }

        private void ApplyScore()
        {
            if (!IsBuilt || layout == null) return;
            var dp = layout.DpScale;
            var horizontalInset = Mathf.Min(10f * dp, layout.Score.width * 0.10f);
            var topInset = Mathf.Min(3f * dp, layout.Score.height * 0.08f);
            var textBottom = Mathf.Min(
                layout.Score.yMax - 1f,
                layout.Timeline.yMax + Mathf.Max(1f, 1.5f * dp));
            var scoreTextLane = Rect.MinMaxRect(
                layout.Score.xMin + horizontalInset,
                textBottom,
                layout.Score.xMax - horizontalInset,
                layout.Score.yMax - topInset);
            var usableWidth = Mathf.Max(1f, scoreTextLane.width);
            var laneGap = Mathf.Min(8f * dp, usableWidth * 0.08f);
            var scoreLaneWidth = Mathf.Max(1f, (usableWidth - laneGap) * 0.64f);
            var scoreLane = new Rect(
                scoreTextLane.xMin,
                scoreTextLane.yMin,
                scoreLaneWidth,
                Mathf.Max(1f, scoreTextLane.height));
            var overLane = new Rect(
                scoreLane.xMax + laneGap,
                scoreLane.yMin,
                Mathf.Max(1f, usableWidth - scoreLaneWidth - laneGap),
                scoreLane.height);
            scoreLabel.SetFitted(
                ScoreText,
                new Vector2(scoreLane.xMin, scoreLane.center.y),
                25f * dp * textScale,
                quiet ? WithAlpha(HudTextColour, 0.88f) : HudTextColour,
                scoreLane,
                Vector2.zero,
                0f,
                TextFloor(25f * dp * textScale, 1f));
            overLabel.SetFitted(
                OverText,
                new Vector2(overLane.xMax, overLane.center.y),
                12f * dp * textScale,
                quiet ? WithAlpha(HudSecondaryColour, 0.78f) : HudSecondaryColour,
                overLane,
                Vector2.zero,
                0f,
                TextFloor(12f * dp * textScale, 1f));
        }

        private void ApplyTimeline()
        {
            if (!IsBuilt || layout == null) return;
            var dp = layout.DpScale;
            var markerDiameter = Mathf.Min(9f * dp, layout.Timeline.height * 0.72f);
            var markerStart = layout.Timeline.xMin + markerDiameter * 0.5f;
            var markerSpan = Mathf.Max(0f, layout.Timeline.width - markerDiameter);
            for (var index = 0; index < markerDiscs.Length; index++)
            {
                var displayedState = DisplayedMarkerState(index);
                var center = new Vector2(
                    markerStart + markerSpan * index / (markerDiscs.Length - 1),
                    layout.Timeline.center.y);
                markerDiscs[index].SetRect(new Rect(
                    center.x - markerDiameter * 0.5f,
                    center.y - markerDiameter * 0.5f,
                    markerDiameter,
                    markerDiameter));
                var colour = MarkerColour(displayedState);
                if (quiet) colour.a *= 0.82f;
                markerDiscs[index].SetColour(colour);
                // The marker's shaped line stays inside the timeline lane at every text scale.
                var markerFont = 7f * dp * textScale;
                var lineHeight = markerLabels[index].MeasureUnwrapped("8", 100f).y / 100f;
                if (lineHeight > 0f) markerFont = Mathf.Min(markerFont, layout.Timeline.height / lineHeight);
                markerLabels[index].Set(
                    ProductionHudCopy.TimelineLabel(displayedState, markerRuns[index]),
                    center,
                    markerFont,
                    WithAlpha(HudTextColour, quiet ? 0.90f : 1f));
                markerLabels[index].SetVisible(
                    displayedState != ProductionBallMarkerState.Upcoming);
            }
        }

        /// <summary>
        /// The conditions rail: two lines between balls, the compact one-line indicator in Delivery Quiet Mode (M5).
        /// </summary>
        internal Rect ConditionsRailPixels =>
            layout == null ? default(Rect) :
            quiet && layout.ConditionsQuiet.height > 0f ? layout.ConditionsQuiet : layout.Conditions;

        internal string ConditionsRailText
        {
            get
            {
                var text = ConditionsText;
                if (!quiet || string.IsNullOrEmpty(text)) return text;
                var newline = text.IndexOf('\n');
                return newline < 0 ? text : text.Substring(0, newline);
            }
        }

        private void PositionConditionsRail()
        {
            if (layout == null || conditionsPanel == null) return;
            var dp = layout.DpScale;
            var frameWidth = Mathf.Max(1f, dp * 0.72f);
            var shadowOffset = Mathf.Max(2f, dp * 1.5f);
            var rail = ConditionsRailPixels;
            conditionsShadow.SetRect(OffsetRect(rail, 0f, -shadowOffset));
            conditionsFrame.SetRect(ExpandRect(rail, frameWidth));
            conditionsPanel.SetRect(rail);
        }

        private void ApplyConditions()
        {
            if (!IsBuilt || layout == null) return;
            var visible = scene != null && settings != null;
            conditionsShadow.SetVisible(visible);
            conditionsFrame.SetVisible(visible);
            conditionsPanel.SetVisible(visible);
            conditionsLabel.SetVisible(visible);
            if (!visible) return;
            PositionConditionsRail();
            var rail = ConditionsRailPixels;
            // 7 dp (was 8): the English copy with its setup affordance needs 131 px of the 146 px reference rail.
            var horizontalInset = Mathf.Min(
                7f * layout.DpScale,
                rail.width * 0.08f);
            var verticalInset = Mathf.Min(
                3f * layout.DpScale,
                rail.height * 0.10f);
            var textBounds = new Rect(
                rail.xMin + horizontalInset,
                rail.yMin + verticalInset,
                Mathf.Max(1f, rail.width - horizontalInset * 2f),
                Mathf.Max(1f, rail.height - verticalInset * 2f));
            conditionsLabel.SetFitted(
                ConditionsRailText,
                new Vector2(textBounds.xMin, rail.center.y),
                ConditionsFontHeight(),
                quiet ? WithAlpha(HudTextColour, 0.90f) : HudTextColour,
                textBounds,
                Vector2.zero,
                0f,
                TextFloor(ConditionsFontHeight(), 1f));
        }

        private void ApplyField()
        {
            if (!IsBuilt) return;
            var hasScene = scene?.Fielders != null && scene.Fielders.Length == 11 && layout != null;
            var hasLiveField = liveFieldState == null || liveFieldState.Count == 11;
            hasScene = hasScene && hasLiveField && !FieldPipOverQuietBudget;
            pipShadow.SetVisible(hasScene);
            pipFrame.SetVisible(hasScene);
            pipPanel.SetVisible(hasScene);
            var cameraPip = hasScene && fieldPipTexture != null && pipImage != null;
            pipImage?.SetVisible(cameraPip);
            if (cameraPip) pipImage.SetColour(new Color(1f, 1f, 1f, quiet ? 0.92f : 1f));
            var radar = hasScene && !cameraPip;
            fieldSurface.SetVisible(radar);
            fieldBoundary.SetVisible(radar);
            pitchSurface.SetVisible(radar);
            batterMarker.SetVisible(radar);
            for (var index = 0; index < fielderMarkers.Length; index++)
                fielderMarkers[index].SetVisible(radar);
            if (!radar) return;

            var markerDiameter = Mathf.Max(4f, 4f * layout.DpScale);
            for (var index = 0; index < fielderMarkers.Length; index++)
            {
                var point = FielderPixelPosition(index);
                fielderMarkers[index].SetRect(new Rect(
                    point.x - markerDiameter * 0.5f,
                    point.y - markerDiameter * 0.5f,
                    markerDiameter,
                    markerDiameter));
                fielderMarkers[index].SetColour(FielderColour(index));
            }

            var striker = ProductionFieldPipProjection.Project(
                scene.BatterLateralM,
                BatterCreaseZMetres - scene.BatterCreaseOffsetM,
                scene.Handedness == "left",
                fieldProjectionBounds);
            var batterDiameter = markerDiameter * 1.25f;
            batterMarker.SetRect(new Rect(
                striker.x - batterDiameter * 0.5f,
                striker.y - batterDiameter * 0.5f,
                batterDiameter,
                batterDiameter));
            batterMarker.SetColour(WithAlpha(HudBrandColour, quiet ? 0.82f : 1f));
            renderedFieldStateVersion = liveFieldState?.Version ?? -1;
        }

        private void ApplyQuietPalette()
        {
            if (!IsBuilt) return;
            var shadowAlpha = quiet ? 0.16f : 0.28f;
            var frameAlpha = highContrast ? (quiet ? 0.78f : 1f) : quiet ? 0.065f : 0.10f;
            var panelAlpha = highContrast ? 0.96f : quiet ? 0.66f : 0.82f;
            scoreShadow.SetColour(WithAlpha(HudShadowColour, shadowAlpha));
            scoreFrame.SetColour(WithAlpha(HudFrameColour, frameAlpha));
            scorePanel.SetColour(WithAlpha(HudPanelColour, panelAlpha));
            timelinePanel.SetColour(Color.clear);
            conditionsShadow.SetColour(WithAlpha(HudShadowColour, shadowAlpha));
            conditionsFrame.SetColour(WithAlpha(HudFrameColour, frameAlpha));
            conditionsPanel.SetColour(WithAlpha(
                HudPanelColour,
                highContrast ? 0.96f : quiet ? 0.52f : 0.68f));
            pauseShadow.SetColour(WithAlpha(HudShadowColour, shadowAlpha));
            pauseFrame.SetColour(WithAlpha(HudFrameColour, frameAlpha));
            pausePanel.SetColour(WithAlpha(HudPanelColour, panelAlpha));
            pauseBarLeft.SetColour(WithAlpha(HudTextColour, quiet ? 0.92f : 1f));
            pauseBarRight.SetColour(WithAlpha(HudTextColour, quiet ? 0.92f : 1f));
            pipShadow.SetColour(WithAlpha(HudShadowColour, shadowAlpha));
            pipFrame.SetColour(WithAlpha(HudFrameColour, frameAlpha));
            pipPanel.SetColour(WithAlpha(
                HudPanelColour,
                highContrast ? 0.96f : quiet ? 0.56f : 0.68f));
            fieldSurface.SetColour(WithAlpha(HudFieldColour, quiet ? 0.88f : 0.94f));
            fieldBoundary.SetColour(WithAlpha(
                HudFieldLineColour,
                highContrast ? 0.92f : quiet ? 0.14f : 0.20f));
            pitchSurface.SetColour(WithAlpha(HudPitchColour, quiet ? 0.78f : 0.88f));
            ApplyScore();
            ApplyTimeline();
            ApplyConditions();
            ApplyField();
            ApplyCaption();
            ApplySetupBrief();
        }

        private void ApplyPauseState()
        {
            if (!IsBuilt || pausePanel == null) return;
            var visible = PauseCanRender();
            pauseShadow.SetVisible(visible);
            pauseFrame.SetVisible(visible);
            pausePanel.SetVisible(visible);
            pauseBarLeft.SetVisible(visible);
            pauseBarRight.SetVisible(visible);
        }

        private void ApplySetupBrief()
        {
            if (!IsBuilt || layout == null || setupBriefPanel == null || setupBriefLabel == null) return;
            var visible = setupBriefOpen && SetupBriefCanOpen();
            setupBriefShadow.SetVisible(visible);
            setupBriefFrame.SetVisible(visible);
            setupBriefPanel.SetVisible(visible);
            setupBriefLabel.SetVisible(visible);
            setupBriefCloseFrame.SetVisible(visible);
            setupBriefClosePanel.SetVisible(visible);
            setupBriefCloseLabel.SetVisible(visible);
            if (!visible) return;

            setupBriefShadow.SetColour(WithAlpha(HudShadowColour, 0.48f));
            setupBriefFrame.SetColour(WithAlpha(HudFrameColour, highContrast ? 1f : 0.22f));
            setupBriefPanel.SetColour(WithAlpha(HudPanelColour, highContrast ? 0.99f : 0.96f));
            setupBriefCloseFrame.SetColour(WithAlpha(HudFrameColour, highContrast ? 1f : 0.32f));
            setupBriefClosePanel.SetColour(WithAlpha(HudAccentColour, 0.96f));
            setupBriefLabel.SetFitted(
                SetupBriefText,
                new Vector2(layout.SetupBriefCopy.xMin, layout.SetupBriefCopy.center.y),
                16f * layout.DpScale * textScale,
                HudTextColour,
                layout.SetupBriefCopy,
                Vector2.zero);
            setupBriefCloseLabel.SetFitted(
                ProductionHudCopy.SetupClose(settings?.Locale),
                layout.SetupBriefClose.center,
                14f * layout.DpScale * textScale,
                HudActionTextColour,
                layout.SetupBriefClose,
                new Vector2(6f * layout.DpScale, 4f * layout.DpScale));
        }

        private void RevealOutcome()
        {
            outcomeVisible = true;
            outcomeOpacity = reducedMotion ? 1f : 0f;
            ApplyOutcome();
        }

        private void ApplyCaption()
        {
            if (!IsBuilt || layout == null || captionPanel == null || captionLabel == null) return;
            var visible = captionVisible && !string.IsNullOrWhiteSpace(captionText);
            captionShadow.SetVisible(visible);
            captionFrame.SetVisible(visible);
            captionPanel.SetVisible(visible);
            captionLabel.SetVisible(visible);
            if (!visible) return;
            var requested = Mathf.Max(1f, 15f * layout.DpScale * textScale);
            var horizontalInset = Mathf.Min(10f * layout.DpScale, layout.Caption.width * 0.08f);
            var verticalInset = Mathf.Min(5f * layout.DpScale, layout.Caption.height * 0.10f);
            var contentWidth = Mathf.Max(1f, layout.Caption.width - horizontalInset * 2f);
            var copy = FormatCaptionForLayout(contentWidth);
            var needed = captionLabel.MeasureWrapped(copy, contentWidth, requested).y + verticalInset * 2f;
            captionRect = PlaceCaption(needed);
            captionShadow.SetRect(OffsetRect(captionRect, 0f, -Mathf.Max(1f, 2f * layout.DpScale)));
            captionFrame.SetRect(ExpandRect(captionRect, Mathf.Max(1f, layout.DpScale)));
            captionPanel.SetRect(captionRect);
            // Scrolling takes pointers only at the dead ball; during the live ball the gesture surface owns them.
            captionLabel.SetPointerInteractive(outcomeBlockVisible);
            captionShadow.SetColour(WithAlpha(HudShadowColour, quiet ? 0.18f : 0.28f));
            captionFrame.SetColour(WithAlpha(
                HudFrameColour,
                highContrast ? 1f : quiet ? 0.075f : 0.11f));
            captionPanel.SetColour(WithAlpha(
                HudPanelColour,
                highContrast ? 0.98f : quiet ? 0.74f : 0.84f));
            var textBounds = new Rect(
                captionRect.xMin + horizontalInset,
                captionRect.yMin + verticalInset,
                Mathf.Max(1f, captionRect.width - horizontalInset * 2f),
                Mathf.Max(1f, captionRect.height - verticalInset * 2f));
            // The requested size always: the caption wraps and its rail grows; what still does not fit scrolls.
            captionLabel.SetFitted(
                copy,
                textBounds.center,
                requested,
                HudTextColour,
                textBounds,
                Vector2.zero);
        }

        private void ApplyOutcome()
        {
            if (!IsBuilt || layout == null) return;
            // A causal caption shares the screen with the dead-ball result and its actions: the caption moves clear
            // of them (PlaceCaption), it never hides them (lead ruling, wedge phase 3).
            // The plain acknowledgement (no actions) still yields its lane to a short causal caption; the dead-ball
            // guidance with its actions never does.
            var visible = outcomeKnown && outcomeVisible && !quiet && !setupBriefOpen &&
                          (!captionVisible || deadBallGuidanceConfigured) &&
                          !replayPresentation && !string.IsNullOrEmpty(outcomeText);
            outcomeBlockVisible = visible;
            outcomeBlockIsGuidance = visible && deadBallGuidanceConfigured;
            var showGuidance = visible && deadBallGuidanceConfigured;
            var showRecommendation = showGuidance && HasRecommendation();
            var showSecondary = showGuidance && HasSecondaryAction();
            outcomeShadow.SetVisible(visible);
            outcomeFrame.SetVisible(visible);
            outcomePanel.SetVisible(visible);
            outcomeLabel.SetVisible(visible);
            reasonLabel.SetVisible(showGuidance);
            recommendationLabel.SetVisible(showRecommendation);
            primaryActionFrame.SetVisible(showGuidance);
            primaryActionPanel.SetVisible(showGuidance);
            primaryActionLabel.SetVisible(showGuidance);
            secondaryActionFrame.SetVisible(showSecondary);
            secondaryActionPanel.SetVisible(showSecondary);
            secondaryActionLabel.SetVisible(showSecondary);
            ApplyCaption();
            if (!visible) return;

            PositionDeadBallVisuals();
            outcomeShadow.SetColour(WithAlpha(HudShadowColour, 0.28f * outcomeOpacity));
            outcomeFrame.SetColour(WithAlpha(
                showGuidance ? HudFrameColour : OutcomeColour(),
                (highContrast ? 1f : showGuidance ? 0.11f : 0.22f) * outcomeOpacity));
            outcomePanel.SetColour(WithAlpha(
                HudPanelColour,
                (highContrast ? 0.98f : 0.86f) * outcomeOpacity));

            if (showGuidance)
            {
                var outcomeBounds = layout.DeadBallOutcome;
                outcomeLabel.SetFitted(
                    outcomeText,
                    outcomeBounds.center,
                    22f * layout.DpScale * textScale,
                    WithAlpha(OutcomeColour(), outcomeOpacity),
                    outcomeBounds,
                    Vector2.zero,
                    0f,
                    TextFloor(22f * layout.DpScale * textScale, OutcomeFloorFactor));

                var reasonBounds = DeadBallReasonBounds();
                reasonLabel.SetFitted(
                    deadBallReason,
                    new Vector2(reasonBounds.xMin, reasonBounds.center.y),
                    14f * layout.DpScale * textScale,
                    WithAlpha(HudSecondaryColour, outcomeOpacity),
                    reasonBounds,
                    Vector2.zero);

                if (showRecommendation)
                {
                    var recommendationBounds = layout.DeadBallRecommendation;
                    recommendationLabel.SetFitted(
                        deadBallRecommendation,
                        new Vector2(
                            recommendationBounds.xMin,
                            recommendationBounds.center.y),
                        14f * layout.DpScale * textScale,
                        WithAlpha(HudTextColour, outcomeOpacity),
                        recommendationBounds,
                        Vector2.zero);
                }

                var actionAlpha = deadBallActionConsumed ? 0.38f : 1f;
                var primaryTarget = DeadBallPrimaryActionTargetPixels;
                primaryActionFrame.SetColour(WithAlpha(
                    HudAccentColour,
                    0.90f * actionAlpha * outcomeOpacity));
                primaryActionPanel.SetColour(WithAlpha(
                    HudAccentColour,
                    0.92f * actionAlpha * outcomeOpacity));
                primaryActionLabel.SetFitted(
                    primaryActionText,
                    primaryTarget.center,
                    15f * layout.DpScale * textScale,
                    WithAlpha(HudActionTextColour, actionAlpha * outcomeOpacity),
                    primaryTarget,
                    new Vector2(8f * layout.DpScale, 5f * layout.DpScale),
                    0f,
                    TextFloor(15f * layout.DpScale * textScale, 1f));

                if (showSecondary)
                {
                    var secondaryTarget = layout.DeadBallSecondaryAction;
                    secondaryActionFrame.SetColour(WithAlpha(
                        HudFrameColour,
                        (highContrast ? 1f : 0.16f) * actionAlpha * outcomeOpacity));
                    secondaryActionPanel.SetColour(WithAlpha(
                        HudPanelColour,
                        (highContrast ? 0.98f : 0.72f) * actionAlpha * outcomeOpacity));
                    secondaryActionLabel.SetFitted(
                        secondaryActionText,
                        secondaryTarget.center,
                        13f * layout.DpScale * textScale,
                        WithAlpha(HudTextColour, actionAlpha * outcomeOpacity),
                        secondaryTarget,
                        new Vector2(6f * layout.DpScale, 5f * layout.DpScale),
                        0f,
                        TextFloor(13f * layout.DpScale * textScale, 1f));
                }
                return;
            }

            // A thin inset: the acknowledgement must stay in the bottom band below the reading corridor, and its one
            // line keeps at least 1.5x its 100% size there (lead ruling, wedge phase 3).
            var inset = Mathf.Min(4f * layout.DpScale, layout.Outcome.height * 0.06f);
            var textBounds = new Rect(
                layout.Outcome.xMin + inset,
                layout.Outcome.yMin + inset,
                Mathf.Max(1f, layout.Outcome.width - inset * 2f),
                Mathf.Max(1f, layout.Outcome.height - inset * 2f));
            outcomeLabel.SetFitted(
                outcomeText,
                layout.Outcome.center,
                27f * layout.DpScale * textScale,
                WithAlpha(OutcomeColour(), outcomeOpacity),
                textBounds,
                Vector2.zero,
                0f,
                TextFloor(27f * layout.DpScale * textScale, OutcomeFloorFactor));
        }

        private ProductionBallMarkerState DisplayedMarkerState(int index)
        {
            // Resolution may arrive before the world declares dead ball. Keep
            // the current-ball glyph in that interval so the six-ball rail
            // cannot reveal a boundary, wicket or dot ahead of the cricket.
            if (quiet && outcomePending && index == ballIndex)
                return ProductionBallMarkerState.Current;
            return markerStates[index];
        }

        /// <summary>Caption and outcome text at 200% stays at least this multiple of its 100% size (lead ruling).</summary>
        internal const float OutcomeFloorFactor = 1.5f;

        public Rect CaptionPixels => captionRect;

        /// <summary>At 200% text no label may render below its 100% size (times factor); at 100% there is no floor.</summary>
        private float TextFloor(float requested, float factor)
        {
            if (textScale <= 1f) return 0f;
            return Mathf.Min(requested, requested / textScale * factor);
        }

        /// <summary>
        /// The caption's rail: the left peripheral rail below the setup target, grown downward to the copy's wrapped
        /// height. At the dead ball it must not cover the result or its actions, so it moves above them in the same
        /// rail, or to the right periphery under the pause target; during the live ball it stays in the left rail,
        /// out of the delivery corridor. Where no placement holds the whole copy, the caption scrolls.
        /// </summary>
        private Rect PlaceCaption(float neededHeight)
        {
            var dp = layout.DpScale;
            var safe = layout.SafeArea;
            var margin = Mathf.Max(10f, 10f * dp);
            var gap = Mathf.Max(6f, 6f * dp);
            var width = layout.Caption.width;
            var top = layout.Caption.yMax;
            var height = Mathf.Max(layout.Caption.height, neededHeight);
            var left = new Rect(
                layout.Caption.xMin,
                Mathf.Max(safe.yMin + margin, top - height),
                width,
                Mathf.Max(1f, top - Mathf.Max(safe.yMin + margin, top - height)));
            if (!outcomeBlockVisible) return left;
            var block = outcomeBlockIsGuidance ? layout.DeadBallSurface : layout.Outcome;
            if (!left.Overlaps(block)) return left;
            var aboveBottom = block.yMax + gap;
            if (top - aboveBottom >= Mathf.Min(height, layout.Caption.height))
                return new Rect(layout.Caption.xMin, Mathf.Max(aboveBottom, top - height), width,
                    top - Mathf.Max(aboveBottom, top - height));
            var rightTop = layout.Pause.yMin - gap;
            var rightBottom = Mathf.Max(safe.yMin + margin, rightTop - height);
            return new Rect(safe.xMax - margin - width, rightBottom, width, Mathf.Max(1f, rightTop - rightBottom));
        }

        private string FormatCaptionForLayout(float availableWidth)
        {
            if (string.IsNullOrWhiteSpace(captionText) || layout == null)
                return string.Empty;

            var normalized = string.Join(
                " ",
                captionText.Split(
                    new[] { ' ', '\t', '\r', '\n' },
                    StringSplitOptions.RemoveEmptyEntries));
            var requestedHeight = Mathf.Max(1f, 15f * layout.DpScale * textScale);
            // Measured with the caption's own shaped font (wedge phase 3), not a per-character estimate: one line
            // when it fits, otherwise the word break that makes the wider line narrowest.
            var available = Mathf.Max(1f, availableWidth);
            if (captionLabel.MeasureUnwrapped(normalized, requestedHeight).x <= available) return normalized;

            var words = normalized.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            if (words.Length < 2) return normalized;
            var bestBreak = 1;
            var bestCost = float.MaxValue;
            for (var index = 1; index < words.Length; index++)
            {
                var first = string.Join(" ", words, 0, index);
                var second = string.Join(" ", words, index, words.Length - index);
                var cost = Mathf.Max(
                    captionLabel.MeasureUnwrapped(first, requestedHeight).x,
                    captionLabel.MeasureUnwrapped(second, requestedHeight).x);
                if (cost >= bestCost) continue;
                bestCost = cost;
                bestBreak = index;
            }

            return string.Join(" ", words, 0, bestBreak) + "\n" +
                   string.Join(" ", words, bestBreak, words.Length - bestBreak);
        }

        private string FormatConditions()
        {
            if (scene == null || settings == null) return string.Empty;
            var condition = ProductionHudCopy.Localize(scene.Conditions, settings.Locale);
            var arm = ProductionHudCopy.Localize(scene.BowlerArm, settings.Locale);
            var family = ProductionHudCopy.Localize(scene.BowlerFamily, settings.Locale);
            var bowlerStyle = string.Equals(
                scene.BowlerFamily,
                "spin",
                StringComparison.OrdinalIgnoreCase)
                ? ProductionHudCopy.Localize(scene.BowlerSpinType, settings.Locale)
                : ProductionHudCopy.Localize(scene.BowlerPaceBand, settings.Locale);
            var age = ProductionHudCopy.Localize(scene.BallAge, settings.Locale);
            var colour = ProductionHudCopy.Localize(scene.BallColour, settings.Locale);
            var assistance = ProductionHudCopy.Localize(settings.Assistance, settings.Locale);
            var first = condition + " · " + age + " " + colour.ToLowerInvariant();
            var second = arm + " " + family.ToLowerInvariant();
            if (!string.IsNullOrEmpty(bowlerStyle)) second += " · " + bowlerStyle;
            second += " · " + assistance;
            if (SetupBriefCanOpen() && !setupBriefOpen && conditionsLabel == null)
                second += " · " + ProductionHudCopy.SetupTrigger(settings.Locale) + " ›";
            else if (SetupBriefCanOpen() && !setupBriefOpen)
            {
                // The setup affordance joins whichever line stays narrower, measured with the rail's own shaped font
                // (wedge phase 3: appended to the longer second line it pushed the copy below 10 px to fit).
                var affordance = " · " + ProductionHudCopy.SetupTrigger(settings.Locale) + " ›";
                var size = ConditionsFontHeight();
                var onFirst = Mathf.Max(conditionsLabel.MeasureUnwrapped(first + affordance, size).x,
                    conditionsLabel.MeasureUnwrapped(second, size).x);
                var onSecond = Mathf.Max(conditionsLabel.MeasureUnwrapped(first, size).x,
                    conditionsLabel.MeasureUnwrapped(second + affordance, size).x);
                if (onFirst < onSecond) first += affordance;
                else second += affordance;
            }
            // The complete setup remains visible, but grouping surface/ball
            // above bowler/assistance keeps both lines short enough for the
            // frozen 146 x 28 Gate-A capsule.
            return first + "\n" + second;
        }

        private float ConditionsFontHeight()
        {
            if (layout == null) return 1f;
            return Mathf.Max(1f, ProductionHudLayout.ConditionsFontDp * layout.DpScale * textScale);
        }

        private bool GuidanceCanRender()
        {
            // A caption never hides "Practice this ball" or "Next ball" (lead ruling, wedge phase 3); the caption is
            // placed clear of the dead-ball surface instead (PlaceCaption).
            return deadBallGuidanceConfigured && outcomeKnown && outcomeVisible &&
                   !quiet && !replayPresentation &&
                   !string.IsNullOrEmpty(outcomeText);
        }

        private bool PauseCanRender()
        {
            return !setupBriefOpen && pauseAvailable && !paused && !interactionHeld && !pauseRequestPending &&
                   !replayPresentation;
        }

        private bool SetupBriefCanOpen()
        {
            // A caption is an accessibility aid and never removes a control (lead ruling, wedge phase 3); the layout
            // keeps the caption clear of the setup target.
            return betweenBallReady && scene != null && settings != null && !quiet &&
                   !replayPresentation && !interactionHeld;
        }

        private bool HasRecommendation()
        {
            return !string.IsNullOrWhiteSpace(deadBallRecommendation);
        }

        private bool HasSecondaryAction()
        {
            return !string.IsNullOrEmpty(secondaryAction) &&
                   !string.IsNullOrEmpty(secondaryActionText);
        }

        private Rect DeadBallReasonBounds()
        {
            if (layout == null) return default(Rect);
            if (HasRecommendation()) return layout.DeadBallReason;
            return Rect.MinMaxRect(
                layout.DeadBallRecommendation.xMin,
                layout.DeadBallRecommendation.yMin,
                layout.DeadBallReason.xMax,
                layout.DeadBallReason.yMax);
        }

        private static bool ValidDeadBallAction(string value)
        {
            return string.Equals(value, PracticeBallAction, StringComparison.Ordinal) ||
                   string.Equals(value, NextBallAction, StringComparison.Ordinal);
        }

        private Color OutcomeColour()
        {
            switch (outcomeState)
            {
                case ProductionBallMarkerState.Wicket: return HudDangerColour;
                case ProductionBallMarkerState.Boundary: return HudBrandColour;
                case ProductionBallMarkerState.Dot: return HudSecondaryColour;
                default: return HudSuccessColour;
            }
        }

        private Color MarkerColour(ProductionBallMarkerState value)
        {
            switch (value)
            {
                case ProductionBallMarkerState.Current: return HudBrandColour;
                case ProductionBallMarkerState.Dot:
                    return highContrast ? Color.white : new Color(0.36f, 0.39f, 0.38f, 0.9f);
                case ProductionBallMarkerState.Runs: return HudAccentColour;
                case ProductionBallMarkerState.Boundary: return HudBrandColour;
                case ProductionBallMarkerState.Wicket: return HudDangerColour;
                default:
                    return highContrast
                        ? new Color(1f, 1f, 1f, 0.52f)
                        : new Color(0.82f, 0.84f, 0.82f, 0.26f);
            }
        }

        private Color FielderColour(int index)
        {
            if (scene?.Fielders == null || index < 0 || index >= scene.Fielders.Length)
                return WithAlpha(HudTextColour, quiet ? 0.88f : 1f);

            var player = scene.Fielders[index];
            var activeBowler = string.Equals(
                                    player.Role,
                                    "bowler",
                                    StringComparison.OrdinalIgnoreCase) ||
                               string.Equals(
                                    player.Id,
                                    "bowler",
                                    StringComparison.OrdinalIgnoreCase);
            return WithAlpha(
                activeBowler ? HudAccentColour : HudTextColour,
                quiet ? 0.88f : 1f);
        }

        private Color HudTextColour => highContrast ? Color.white : WarmWhite;
        private Color HudSecondaryColour => highContrast ? Color.white : Secondary;
        private Color HudPanelColour => highContrast ? Color.black : Stadium;
        private Color HudFrameColour => highContrast ? Color.white : Frame;
        private Color HudShadowColour => highContrast ? Color.black : Shadow;
        private Color HudAccentColour => highContrast ? Color.cyan : Accent;
        private Color HudBrandColour => highContrast ? Color.yellow : Brand;
        private Color HudFieldColour => highContrast ? new Color(0f, 0.24f, 0.04f, 1f) : Field;
        private Color HudFieldLineColour => highContrast ? Color.white : FieldLine;
        private Color HudPitchColour => highContrast ? new Color(1f, 0.84f, 0.2f, 1f) : Pitch;
        private Color HudSuccessColour => highContrast ? Color.green : Success;
        private Color HudDangerColour => highContrast ? Color.red : Danger;
        private Color HudActionTextColour => highContrast ? Color.black : Stadium;

        private static Rect ExpandRect(Rect value, float amount)
        {
            return Rect.MinMaxRect(
                value.xMin - amount,
                value.yMin - amount,
                value.xMax + amount,
                value.yMax + amount);
        }

        private static Rect OffsetRect(Rect value, float x, float y)
        {
            value.position += new Vector2(x, y);
            return value;
        }

        private static Color WithAlpha(Color value, float alpha)
        {
            value.a = Mathf.Clamp01(alpha);
            return value;
        }

        private void Update()
        {
            if (!IsBuilt) return;
            RefreshViewport(false);
            HandlePauseInput();
            AdvancePresentation(Time.unscaledDeltaTime);
        }

        private void HandlePauseInput()
        {
            if (UnityEngine.Input.touchCount > 0)
            {
                for (var index = 0; index < UnityEngine.Input.touchCount; index++)
                {
                    var touch = UnityEngine.Input.GetTouch(index);
                    if (touch.phase != TouchPhase.Began) continue;
                    if (setupBriefOpen)
                    {
                        TryToggleSetupBriefAt(touch.position);
                        return;
                    }
                    if (TryToggleSetupBriefAt(touch.position)) return;
                    if (TryRequestDeadBallActionAt(touch.position)) return;
                    if (TryRequestPauseAt(touch.position)) return;
                }
                return;
            }
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL
            if (UnityEngine.Input.GetMouseButtonDown(0))
            {
                var position = (Vector2)UnityEngine.Input.mousePosition;
                if (setupBriefOpen)
                {
                    TryToggleSetupBriefAt(position);
                    return;
                }
                if (!TryToggleSetupBriefAt(position) &&
                    !TryRequestDeadBallActionAt(position))
                    TryRequestPauseAt(position);
            }
#endif
        }

        private void OnEnable()
        {
            if (generatedRoot != null) generatedRoot.SetActive(true);
        }

        private void OnDisable()
        {
            if (generatedRoot != null) generatedRoot.SetActive(false);
        }

        private void OnDestroy()
        {
            Release();
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
