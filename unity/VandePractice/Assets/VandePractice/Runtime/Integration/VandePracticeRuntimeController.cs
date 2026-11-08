using System;
using UnityEngine;
using UnityEngine.Profiling;
using Vande.Practice.Audio;
using Vande.Practice.Audio.Production;
using Vande.Practice.Audio.Production.Outputs;
using Vande.Practice.Bridge;
using Vande.Practice.Input;
using Vande.Practice.Performance;
using Vande.Practice.Presentation;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Runtime
{
    /// <summary>
    /// The required live consumer behind VandeBridge.ReceivePacket. It wires
    /// validated host messages to the production Unity Practice presentation/input surface;
    /// it contains no delivery physics, collision, scoring or innings logic.
    /// </summary>
    public sealed class VandePracticeRuntimeController : MonoBehaviour
    {
        private readonly PracticeFrameStats frameStats =
            new PracticeFrameStats(BridgeConstants.MaxBenchmarkIntervals);
        private readonly PracticeVisibleLatencyProbe visibleLatency = new PracticeVisibleLatencyProbe();
        private UnityPracticeBridgeSession session;
        private ProceduralPracticeWorld world;
        private ProductionHudView hud;
        private VandeTouchInputCapture inputCapture;
        private ProductionPracticeFeedbackSink feedback;
        private ProductionAndroidHapticOutput hapticOutput;
        private PracticePresentationSettings settings;
        private bool initialized;
        private bool sceneReady;
        private bool failed;
        private bool suppressOutbound;
        private bool quietKnown;
        private bool quiet;
        private double? inputToVisibleBatMs;
        private double? lastDeliveryRenderedUnityMs;
        private bool deliveryStatsActive;
        private bool deliveryCompletionPending;
        private double pendingDeadT;
        private string pendingReplayDigest;
        private PracticeResultPresentation pendingHudResult;
        private PracticeResultPresentation pendingDemonstrationResult;
        private bool demonstrationActive;
        private bool demonstrationResultReady;
        private string deadBallUiDeliveryId;
        private string deadBallUiReplayDigest;
        private PracticeBenchmarkRequest benchmarkRequest;
        private PracticeBenchmarkSampler benchmarkSampler;
        private double? lastBenchmarkRenderedUnityMs;
        private string protectedRegionsDeliveryId;
        private bool protectedRegionsPending;
        private int protectedRegionsViewportWidth;
        private int protectedRegionsViewportHeight;
        private int protectedRegionsProjectionVersion = -1;

        public bool ConsumerReady => initialized && !failed && world != null && world.IsInitialized &&
                                     hud != null && hud.IsBuilt && inputCapture != null;
        public VandeTouchInputCapture InputCapture => inputCapture;

        public void Bind(UnityPracticeBridgeSession value)
        {
            if (session != null) throw new InvalidOperationException("Unity Practice runtime is already bound.");
            session = value ?? throw new ArgumentNullException(nameof(value));
        }

        public void AcceptHostMessage(UnityPracticeEnvelope envelope)
        {
            if (failed) throw new BridgeValidationException("The Unity presentation consumer has failed.");
            if (session == null) throw new BridgeValidationException("The Unity presentation consumer is not bound.");

            switch (envelope.type)
            {
                case "host.initialize":
                    Initialize(PracticePresentationContractAdapter.Initialize(envelope));
                    return;
                case "host.scene":
                    RequireReady();
                    RequireNoBenchmark();
                    var scene = PracticePresentationContractAdapter.Scene(envelope);
                    world.ConfigureScene(scene);
                    hud.SetScene(scene);
                    hud.BindFieldState(world.LiveFieldState);
                    hud.SetFieldPipTexture(world.FieldPipTexture);
                    ClearProtectedRegionPublication();
                    sceneReady = true;
                    return;
                case "host.delivery":
                    RequireScene();
                    RequireNoBenchmark();
                    var delivery = PracticePresentationContractAdapter.Delivery(envelope);
                    ClearPendingHudResult();
                    ClearDeadBallPresentation();
                    hud.SetReplayPresentation(false);
                    hud.SetDelivery(
                        delivery.OverIndex,
                        delivery.BallIndex,
                        delivery.CoachGuide?.Stage);
                    visibleLatency.Cancel();
                    inputToVisibleBatMs = null;
                    frameStats.Reset();
                    lastDeliveryRenderedUnityMs = null;
                    deliveryStatsActive = true;
                    deliveryCompletionPending = false;
                    pendingReplayDigest = null;
                    inputCapture.BeginDelivery();
                    world.BeginDelivery(delivery);
                    protectedRegionsDeliveryId = envelope.deliveryId;
                    protectedRegionsPending = true;
                    protectedRegionsViewportWidth = 0;
                    protectedRegionsViewportHeight = 0;
                    protectedRegionsProjectionVersion = -1;
                    return;
                case "host.provisional_swing":
                    RequireReady();
                    var provisionalSwing = PracticePresentationContractAdapter.ProvisionalSwing(envelope);
                    feedback.SetShotIntent(provisionalSwing.Kind);
                    world.ApplyProvisionalSwing(provisionalSwing);
                    return;
                case "host.result":
                case "host.replay":
                    RequireReady();
                    RequireNoBenchmark();
                    var result = PracticePresentationContractAdapter.ResultFromValidated(envelope);
                    // A host result can arrive before its canonical physical trace has
                    // finished playing. Never let score, marker or outcome reveal that
                    // future state. Accept the trace before ending native capture so
                    // its reconciliation snapshots the last visible provisional pose;
                    // cancellation after canonicalBat is latched cannot reset that pose.
                    // Replays do not score again and also clear any stale live-result
                    // queue before their trace is accepted.
                    ClearPendingHudResult();
                    ClearDeadBallPresentation();
                    protectedRegionsPending = false;
                    hud.SetPauseAvailable(false);
                    hud.SetReplayPresentation(envelope.type == "host.replay");
                    feedback.SetAuthoritativeOutcome(result.ShotIntent, result.Dismissal);
                    world.AcceptResult(result);
                    inputCapture.EndDelivery();
                    if (!result.IsReplay) pendingHudResult = result;
                    return;
                case "host.demonstration":
                    RequireScene();
                    RequireNoBenchmark();
                    var demonstration = PracticePresentationContractAdapter.DemonstrationFromValidated(envelope);
                    ClearPendingHudResult();
                    ClearDeadBallPresentation();
                    hud.SetReplayPresentation(true);
                    hud.SetDelivery(
                        demonstration.Delivery.OverIndex,
                        demonstration.Delivery.BallIndex,
                        demonstration.Delivery.CoachGuide?.Stage);
                    hud.SetPauseAvailable(false);
                    hud.SetBetweenBallReady(false);
                    visibleLatency.Cancel();
                    inputToVisibleBatMs = null;
                    deliveryStatsActive = false;
                    deliveryCompletionPending = false;
                    pendingReplayDigest = null;
                    pendingDemonstrationResult = demonstration.Result;
                    demonstrationActive = true;
                    demonstrationResultReady = false;
                    inputCapture.EndDelivery();
                    world.BeginDelivery(demonstration.Delivery);
                    protectedRegionsDeliveryId = envelope.deliveryId;
                    protectedRegionsPending = true;
                    protectedRegionsViewportWidth = 0;
                    protectedRegionsViewportHeight = 0;
                    protectedRegionsProjectionVersion = -1;
                    return;
                case "host.demonstration_cancel":
                    RequireReady();
                    RequireNoBenchmark();
                    CancelDemonstration();
                    return;
                case "host.dead_ball_ui":
                    RequireReady();
                    RequireNoBenchmark();
                    var deadBallUi = StrictJsonObject.ParseCanonical(envelope.payloadJson);
                    deadBallUiDeliveryId = envelope.deliveryId;
                    deadBallUiReplayDigest = deadBallUi.String("replayDigest");
                    // A completed replay deliberately retains the last world
                    // pose but suppresses native outcome/actions. Only this
                    // exact host packet exits replay presentation and restores
                    // authoritative dead-ball controls.
                    hud.SetReplayPresentation(false);
                    hud.SetDeadBallGuidance(
                        deadBallUi.String("reason"),
                        deadBallUi.String("recommendation"),
                        deadBallUi.String("primaryAction"),
                        deadBallUi.String("primaryLabel"),
                        deadBallUi.String("secondaryAction", true),
                        deadBallUi.String("secondaryLabel", true));
                    return;
                case "host.profile":
                    RequireReady();
                    RequireNoBenchmark();
                    settings.Quality = PracticePresentationContractAdapter.Profile(envelope);
                    world.RequestProfile(settings.Quality);
                    return;
                case "host.locale":
                    RequireReady();
                    RequireNoBenchmark();
                    settings.Locale = PracticePresentationContractAdapter.Locale(envelope);
                    hud.SetLocale(settings.Locale);
                    return;
                case "host.benchmark":
                    RequireReady();
                    BeginBenchmark(PracticePresentationContractAdapter.Benchmark(envelope));
                    return;
                case "host.pause":
                    RequireReady();
                    RequireNoBenchmark();
                    hud.SetInteractionHeld(false);
                    hud.SetPaused(true);
                    inputCapture.SetPaused(true);
                    world.SetPaused(true);
                    feedback.SetPaused(true);
                    return;
                case "host.resume":
                    RequireReady();
                    RequireNoBenchmark();
                    var resumeReason = StrictJsonObject.ParseCanonical(envelope.payloadJson).String("reason");
                    feedback.SetPaused(false);
                    world.SetPaused(false);
                    inputCapture.SetPaused(false);
                    hud.SetPaused(false);
                    hud.SetInteractionHeld(resumeReason == "foreground");
                    return;
                case "host.dispose":
                    suppressOutbound = true;
                    StopSurface();
                    return;
                default:
                    // Clock packets and bridge ACKs are consumed entirely by
                    // UnityPracticeBridgeSession and never reach this method.
                    return;
            }
        }

        public void Tick(double deltaSeconds)
        {
            if (!initialized || failed || suppressOutbound) return;
            try
            {
                world.Tick(deltaSeconds);
                TryAcceptDemonstrationResult();
                TryPublishProtectedRegions();
                hud.AdvancePresentation((float)deltaSeconds);
            }
            catch (Exception exception)
            {
                ReportRuntimeDiagnostic("runtime_tick", exception);
                FailRuntime();
            }
        }

        public void PrepareForNativeUnload()
        {
            suppressOutbound = true;
            StopSurface();
        }

        private void Initialize(PracticePresentationSettings value)
        {
            if (initialized) throw new BridgeValidationException("Unity presentation was initialized twice.");
            settings = value ?? throw new BridgeValidationException("Unity presentation settings are missing.");

            feedback = gameObject.GetComponent<ProductionPracticeFeedbackSink>() ??
                       gameObject.AddComponent<ProductionPracticeFeedbackSink>();
            world = gameObject.GetComponent<ProceduralPracticeWorld>() ??
                    gameObject.AddComponent<ProceduralPracticeWorld>();
            hud = gameObject.GetComponent<ProductionHudView>() ?? gameObject.AddComponent<ProductionHudView>();
            inputCapture = gameObject.GetComponent<VandeTouchInputCapture>() ??
                           gameObject.AddComponent<VandeTouchInputCapture>();

            hud.Configure(settings);
            // Unity owns the visible Practice presentation on both Android and
            // WebGL. The web host keeps only a non-visual semantic mirror; it
            // must never suppress the same production HUD that Android shows.
            hud.SetExternalOverlayPresentation(false);
            hapticOutput = new ProductionAndroidHapticOutput();
            feedback.SetOutputs(hapticOutput, new ProductionHudCaptionOutput(hud));
            feedback.Configure(settings.Audio, settings.Haptics, settings.Captions);
            world.Configure(settings, feedback);
            inputCapture.Configure(
                OnPointer,
                session.ReportGesture,
                OnLocalPreparation,
                OnLocalPreparationCancelled,
                exception =>
                {
                    ReportRuntimeDiagnostic("runtime_input", exception);
                    FailRuntime();
                },
                OnLocalBatPreview);
            inputCapture.ConfigureAssistance(settings.Assistance);
            inputCapture.ConfigureHandedness(settings.Handedness);
            world.ReleaseReached += OnReleaseReached;
            world.QuietChanged += OnQuietChanged;
            world.DeliveryCompleted += OnDeliveryCompleted;
            world.FrameRendered += OnFrameRendered;
            hud.PauseRequested += OnPauseRequested;
            hud.DeadBallActionRequested += OnDeadBallActionRequested;
            initialized = true;
            if (!ConsumerReady)
                throw new BridgeValidationException("Unity presentation/input consumer did not initialize completely.");
        }

        private void OnReleaseReached()
        {
            if (demonstrationActive)
                demonstrationResultReady = true;
            else
            {
                session.ReportRelease();
                inputCapture.MarkReleaseReached();
            }
            feedback.Handle(new PracticeFeedbackEvent(
                PracticeFeedbackKind.Release, world.Timeline, null, 0, null));
        }

        private void TryAcceptDemonstrationResult()
        {
            if (!demonstrationActive || !demonstrationResultReady || pendingDemonstrationResult == null) return;
            var result = pendingDemonstrationResult;
            pendingDemonstrationResult = null;
            demonstrationResultReady = false;
            feedback.SetAuthoritativeOutcome(result.ShotIntent, result.Dismissal);
            world.AcceptResult(result);
            inputCapture.EndDelivery();
        }

        private void OnPointer(string phase, string pointer, double atUnityMs)
        {
            session.ReportPointer(phase, pointer, atUnityMs);
        }

        private void OnLocalPreparation(double inputUnityMs)
        {
            visibleLatency.Begin(inputUnityMs);
            world.BeginLocalPreparation();
        }

        private void OnLocalPreparationCancelled()
        {
            visibleLatency.Cancel();
            world.CancelLocalPreparation();
        }

        private void OnLocalBatPreview(PracticeLocalBatPreview preview)
        {
            world.ApplyLocalBatPreview(preview);
        }

        private void OnFrameRendered(double renderedUnityMs)
        {
            try
            {
                var measured = visibleLatency.Complete(renderedUnityMs);
                if (measured.HasValue) inputToVisibleBatMs = measured.Value;

                if (benchmarkSampler != null)
                {
                    if (lastBenchmarkRenderedUnityMs.HasValue)
                    {
                        benchmarkSampler.Advance(renderedUnityMs - lastBenchmarkRenderedUnityMs.Value);
                        if (benchmarkSampler.Complete) EmitBenchmark();
                    }
                    if (benchmarkSampler != null) lastBenchmarkRenderedUnityMs = renderedUnityMs;
                }

                if (deliveryStatsActive)
                {
                    if (lastDeliveryRenderedUnityMs.HasValue)
                        frameStats.AddSeconds((renderedUnityMs - lastDeliveryRenderedUnityMs.Value) / 1000.0);
                    lastDeliveryRenderedUnityMs = renderedUnityMs;
                }
                TryPublishProtectedRegions();
                if (deliveryCompletionPending) CompleteDeliveryAfterRenderedFrame();
            }
            catch (Exception exception)
            {
                ReportRuntimeDiagnostic("runtime_frame", exception);
                FailRuntime();
            }
        }

        private bool OnPauseRequested()
        {
            return !suppressOutbound && session.TryReportPauseRequest();
        }

        private bool OnDeadBallActionRequested(string action)
        {
            if (suppressOutbound || deadBallUiDeliveryId == null || deadBallUiReplayDigest == null) return false;
            if (!session.TryReportDeadBallAction(deadBallUiDeliveryId, deadBallUiReplayDigest, action)) return false;
            ClearDeadBallPresentation();
            return true;
        }

        private void OnQuietChanged(bool value)
        {
            hud.SetQuiet(value);
            feedback.SetQuiet(value);
            if (suppressOutbound || (quietKnown && quiet == value)) return;
            quiet = value;
            quietKnown = true;
            session.ReportQuiet(value);
        }

        private void OnDeliveryCompleted(double deadT, string replayDigest)
        {
            inputCapture.EndDelivery();
            // This update has not yet reached the display. Complete the
            // renderer-local window in OnPostRender, then emit stats directly
            // before the corresponding dead-ball packet.
            deliveryCompletionPending = true;
            pendingDeadT = deadT;
            pendingReplayDigest = replayDigest;
        }

        private void EmitStats()
        {
            var snapshot = frameStats.Snapshot();
            double? memoryMb = null;
            var bytes = Profiler.GetTotalAllocatedMemoryLong();
            if (bytes >= 0) memoryMb = bytes / (1024.0 * 1024.0);
            session.ReportStats(
                Quality(settings.Quality), snapshot.SampleCount, snapshot.Spikes,
                snapshot.Fps, snapshot.AverageFrameMs,
                snapshot.P95FrameMs, snapshot.P99FrameMs, snapshot.WorstFrameMs,
                inputToVisibleBatMs, memoryMb, "unknown");
        }

        private void CompleteDeliveryAfterRenderedFrame()
        {
            if (!deliveryCompletionPending) return;
            deliveryCompletionPending = false;
            if (deliveryStatsActive)
            {
                deliveryStatsActive = false;
                EmitStats();
            }
            CommitPendingHudResult();
            // There is no pause authority in the brief SceneReady interval
            // between physical dead ball and an accepted delivery-scoped UI.
            hud.SetPauseAvailable(false);
            hud.SetBetweenBallReady(false);
            session.ReportDeliveryDead(pendingDeadT, pendingReplayDigest);
            pendingReplayDigest = null;
            demonstrationActive = false;
            demonstrationResultReady = false;
            pendingDemonstrationResult = null;
        }

        private void CommitPendingHudResult()
        {
            var result = pendingHudResult;
            pendingHudResult = null;
            if (result == null) return;
            hud.SetScore(result.TotalRuns, result.Wickets, result.Balls);
            // Contract v7: the Target Chase situation after this ball arrives with the score, at the dead ball (never during a live ball).
            if (result.Chase != null) hud.SetChase(result.Chase);
            if (UnityOwnsDeadBallPresentation)
                hud.SetOutcome(result.DeliveryRuns, result.Dismissal);
        }

        private void ClearPendingHudResult()
        {
            pendingHudResult = null;
        }

        private void CancelDemonstration()
        {
            if (!demonstrationActive)
                throw new BridgeValidationException("No Unity demonstration is active.");
            demonstrationActive = false;
            demonstrationResultReady = false;
            pendingDemonstrationResult = null;
            deliveryCompletionPending = false;
            pendingReplayDigest = null;
            ClearPendingHudResult();
            ClearDeadBallPresentation();
            ClearProtectedRegionPublication();
            inputCapture.EndDelivery();
            world.Stop();
            feedback.StopAll();
            hud.SetReplayPresentation(false);
            hud.SetPauseAvailable(false);
            hud.SetBetweenBallReady(false);
        }

        private void ClearDeadBallPresentation()
        {
            deadBallUiDeliveryId = null;
            deadBallUiReplayDigest = null;
            hud?.ClearDeadBallGuidance();
        }

        private void TryPublishProtectedRegions()
        {
            if (!protectedRegionsPending || suppressOutbound || session == null || world == null ||
                (session.State != BridgeLifecycleState.Delivery &&
                 session.State != BridgeLifecycleState.Demonstrating) ||
                string.IsNullOrEmpty(protectedRegionsDeliveryId)) return;
            var width = Screen.width;
            var height = Screen.height;
            if (width < 1 || height < 1 ||
                width > BridgeConstants.MaxProtectedRegionViewportPixels ||
                height > BridgeConstants.MaxProtectedRegionViewportPixels) return;
            var projectionVersion = world.ProtectedRegionProjectionVersion;
            if (width == protectedRegionsViewportWidth &&
                height == protectedRegionsViewportHeight &&
                projectionVersion == protectedRegionsProjectionVersion)
            {
                protectedRegionsPending = false;
                return;
            }

            var regions = world.MeasureProtectedRegions(width, height);
            if (regions == null || regions.Length < 1) return;
            if (!session.TryReportProtectedRegions(
                    protectedRegionsDeliveryId, width, height, regions)) return;
            protectedRegionsViewportWidth = width;
            protectedRegionsViewportHeight = height;
            protectedRegionsProjectionVersion = projectionVersion;
            protectedRegionsPending = false;
        }

        private void RefreshProtectedRegionPublication()
        {
            if (session != null &&
                (session.State == BridgeLifecycleState.Delivery ||
                 session.State == BridgeLifecycleState.Demonstrating) &&
                !string.IsNullOrEmpty(protectedRegionsDeliveryId))
                protectedRegionsPending = true;
        }

        private void ClearProtectedRegionPublication()
        {
            protectedRegionsDeliveryId = null;
            protectedRegionsPending = false;
            protectedRegionsViewportWidth = 0;
            protectedRegionsViewportHeight = 0;
            protectedRegionsProjectionVersion = -1;
        }

        private void BeginBenchmark(PracticeBenchmarkRequest request)
        {
            if (benchmarkSampler != null)
                throw new BridgeValidationException("A Unity benchmark is already active.");
            benchmarkRequest = request ?? throw new BridgeValidationException("Benchmark request is missing.");
            settings.Quality = request.Quality;
            world.RequestProfile(request.Quality);
            benchmarkSampler = new PracticeBenchmarkSampler(
                request.DurationMs, request.WarmupFrames, request.SampleCap);
            lastBenchmarkRenderedUnityMs = null;
            world.BeginBenchmarkWorkload();
        }

        private void EmitBenchmark()
        {
            var request = benchmarkRequest;
            var sampler = benchmarkSampler;
            if (request == null || sampler == null || !sampler.Complete)
                throw new BridgeValidationException("Benchmark capture is incomplete.");

            var intervals = sampler.Snapshot();
            benchmarkRequest = null;
            benchmarkSampler = null;
            lastBenchmarkRenderedUnityMs = null;
            world.EndBenchmarkWorkload();
            double? memoryMb = null;
            var bytes = Profiler.GetTotalAllocatedMemoryLong();
            if (bytes >= 0) memoryMb = bytes / (1024.0 * 1024.0);
            session.ReportBenchmark(
                request.BenchmarkId, Quality(request.Quality), intervals,
                sampler.WarmupFrames, sampler.WarmupDurationMs,
                false, null,
                NonEmptyOrUnknown(SystemInfo.graphicsDeviceType.ToString()),
                NonEmptyOrUnknown(SystemInfo.graphicsDeviceName),
                null, null, memoryMb, "unknown");
        }

        private void StopSurface()
        {
            ClearPendingHudResult();
            ClearDeadBallPresentation();
            pendingDemonstrationResult = null;
            demonstrationActive = false;
            demonstrationResultReady = false;
            if (!initialized) return;
            inputCapture.EndDelivery();
            visibleLatency.Cancel();
            deliveryStatsActive = false;
            deliveryCompletionPending = false;
            pendingReplayDigest = null;
            ClearProtectedRegionPublication();
            benchmarkRequest = null;
            benchmarkSampler = null;
            lastBenchmarkRenderedUnityMs = null;
            world.EndBenchmarkWorkload();
            world.Stop();
            hud.SetPauseAvailable(false);
            hud.SetBetweenBallReady(false);
            feedback.SetPaused(false);
            feedback.StopAll();
            feedback.SetOutputs(null, null);
            hapticOutput?.Dispose();
            hapticOutput = null;
        }

        private void FailRuntime()
        {
            if (failed) return;
            failed = true;
            suppressOutbound = true;
            ClearPendingHudResult();
            try { StopSurface(); }
            catch (Exception) { /* Preserve the original bounded fatal path. */ }
            try { session?.ReportRuntimeFailure(); }
            catch (Exception) { Debug.LogError("VANDE Unity runtime could not emit its fatal bridge packet."); }
        }

        private static void ReportRuntimeDiagnostic(string category, Exception exception)
        {
            var message = exception == null || string.IsNullOrEmpty(exception.Message)
                ? "no-message"
                : exception.Message;
            message = message.Replace('\r', ' ').Replace('\n', ' ');
            if (message.Length > 160) message = message.Substring(0, 160);
            Debug.LogError("VANDE Unity diagnostic: " + category + "|" +
                           (exception == null ? "UnknownException" : exception.GetType().Name) + "|" + message);
        }

        private void RequireReady()
        {
            if (!ConsumerReady) throw new BridgeValidationException("Unity presentation consumer is not ready.");
        }

        private void RequireScene()
        {
            RequireReady();
            if (!sceneReady) throw new BridgeValidationException("Unity presentation scene is not ready.");
        }

        private void RequireNoBenchmark()
        {
            if (benchmarkSampler != null)
                throw new BridgeValidationException("A Unity benchmark is still active.");
        }

        private static string Quality(PracticePresentationQuality value)
        {
            switch (value)
            {
                case PracticePresentationQuality.Lite: return "lite";
                case PracticePresentationQuality.Standard: return "standard";
                case PracticePresentationQuality.High: return "high";
                default: throw new ArgumentOutOfRangeException(nameof(value));
            }
        }

        private static string NonEmptyOrUnknown(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? "unknown" : value;
        }

        private static bool UnityOwnsDeadBallPresentation
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                // React owns WebGL result/actions and blocks the canvas there;
                // Unity retains only the authoritative score/timeline update.
                return false;
#else
                return true;
#endif
            }
        }

        private void Update()
        {
            Tick(Time.unscaledDeltaTime);
        }

        private void OnDestroy()
        {
            ClearPendingHudResult();
            ClearDeadBallPresentation();
            if (world != null)
            {
                world.ReleaseReached -= OnReleaseReached;
                world.QuietChanged -= OnQuietChanged;
                world.DeliveryCompleted -= OnDeliveryCompleted;
                world.FrameRendered -= OnFrameRendered;
            }
            if (hud != null) hud.PauseRequested -= OnPauseRequested;
            if (hud != null) hud.DeadBallActionRequested -= OnDeadBallActionRequested;
            try { feedback?.ReleasePreparedResources(); }
            catch (Exception) { /* Unity teardown cannot recover feedback resources. */ }
            hapticOutput?.Dispose();
            hapticOutput = null;
        }
    }
}
