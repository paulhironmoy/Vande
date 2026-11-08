using System;
using System.Collections.Generic;

namespace Vande.Practice.Bridge
{
    public enum BridgeLifecycleState
    {
        Cold,
        Loading,
        Ready,
        SceneReady,
        Delivery,
        Resolved,
        Replaying,
        Demonstrating,
        Disposing,
        Unloaded,
        Failed
    }

    public enum BridgeTransitionResult
    {
        Accepted,
        Superseded,
        Duplicate,
        OutOfOrder,
        Rejected
    }

    /// <summary>
    /// Unity-side mirror of the current protocol phases. It validates inbound host
    /// ordering and the state changes Unity is allowed to observe. No quit or
    /// gameplay authority is exposed.
    /// </summary>
    public sealed class BridgeLifecycleCoordinator
    {
        private readonly UnityPracticeSequenceGuard hostSequence;
        private readonly HashSet<string> acceptedClockSamples = new HashSet<string>(StringComparer.Ordinal);
        private string sessionId;
        private string buildId;
        private string handedness;
        private string activeDeliveryId;
        private string lastDeliveryId;
        private string lastDemonstrationId;
        private string replayDigest;
        private string activeCompletionDigest;
        private double expectedDeadT;
        private string selectedClockSampleId;
        private string assistance;
        private string sceneConditions;
        private string sceneHandedness;
        private string sceneBowlerJson;
        private string sceneFieldJson;
        private string sceneBallJson;
        // Contract v7: the Target Chase of the latest scene (none for ordinary Practice). A result must agree with it.
        private bool sceneHasChase;
        private long sceneChaseTarget;
        private long sceneChaseMaxBalls;
        private long activeOverIndex;
        private long activeBallIndex;
        private string activePlanJson;
        private string activeSeed;
        private string activeFlightJson;
        private string activeProvisionalSwingJson;
        private string lastResolutionJson;
        private StrictJsonObject lastResolution;
        private bool paused;
        private bool presentationHeld;
        private bool lastCompletionWasReplay;
        private bool deadBallUiAccepted;
        private bool deadBallActionConsumed;
        private bool pauseRequestPending;
        private string deadBallPrimaryAction;
        private string deadBallSecondaryAction;

        public BridgeLifecycleCoordinator(int sequenceWindow = BridgeConstants.MaxSeenMessages)
        {
            hostSequence = new UnityPracticeSequenceGuard(sequenceWindow);
            State = BridgeLifecycleState.Cold;
        }

        public BridgeLifecycleState State { get; private set; }
        public string FailureReason { get; private set; }
        public string SessionId => sessionId;
        public string BuildId => buildId;
        public string ActiveDeliveryId => activeDeliveryId;
        public string LastDeliveryId => lastDeliveryId;
        public string ReplayDigest => replayDigest;
        public bool ClockSynchronized => acceptedClockSamples.Count >= BridgeConstants.MinimumClockSamples;
        public string SelectedClockSampleId => selectedClockSampleId;
        public bool ClockSelected => selectedClockSampleId != null;

        public BridgeTransitionResult AcceptHost(UnityPracticeEnvelope envelope)
        {
            return AcceptHost(envelope, false);
        }

        /// <summary>
        /// Accepts an envelope that UnityPracticePacketCodec has already fully
        /// validated at the native trust boundary. This avoids reparsing large
        /// canonical result traces while keeping the public standalone entry
        /// point fail-closed for callers that do not hold that guarantee.
        /// </summary>
        internal BridgeTransitionResult AcceptValidatedHost(UnityPracticeEnvelope envelope)
        {
            return AcceptHost(envelope, true);
        }

        private BridgeTransitionResult AcceptHost(UnityPracticeEnvelope envelope, bool alreadyValidated)
        {
            try
            {
                if (!alreadyValidated) BridgeValidator.ValidateEnvelope(envelope);
                if (envelope.sender != "host")
                    throw new BridgeValidationException("Unity runtime accepts only host messages.");
            }
            catch (BridgeValidationException exception)
            {
                Fail(exception.Message);
                return BridgeTransitionResult.Rejected;
            }

            var order = hostSequence.Classify(envelope);
            if (order == SequenceAcceptResult.Duplicate) return BridgeTransitionResult.Duplicate;
            if (order == SequenceAcceptResult.OutOfOrder)
            {
                Fail("Host message is out of order.");
                return BridgeTransitionResult.OutOfOrder;
            }

            if (sessionId == null)
            {
                if (State != BridgeLifecycleState.Cold || envelope.type != "host.initialize" ||
                    envelope.deliveryId != null)
                {
                    Fail("The first host message must be a session-level host.initialize.");
                    return BridgeTransitionResult.Rejected;
                }

                sessionId = envelope.sessionId;
                buildId = envelope.buildId;
            }
            else if (!string.Equals(sessionId, envelope.sessionId, StringComparison.Ordinal) ||
                     !string.Equals(buildId, envelope.buildId, StringComparison.Ordinal))
            {
                Fail("Session or build identity changed during a lifecycle.");
                return BridgeTransitionResult.Rejected;
            }

            var superseded = false;
            try
            {
                superseded = IsSupersededPresentationMessage(envelope);
                if (!superseded && !TryTransition(envelope))
                {
                    Fail("Illegal bridge lifecycle transition for " + envelope.type + ".");
                    return BridgeTransitionResult.Rejected;
                }
            }
            catch (BridgeValidationException exception)
            {
                Fail(exception.Message);
                return BridgeTransitionResult.Rejected;
            }

            hostSequence.Accept(envelope);
            return superseded ? BridgeTransitionResult.Superseded : BridgeTransitionResult.Accepted;
        }

        private bool IsSupersededPresentationMessage(UnityPracticeEnvelope envelope)
        {
            if (envelope.type == "host.demonstration_cancel" &&
                State == BridgeLifecycleState.SceneReady &&
                Same(envelope.deliveryId, lastDemonstrationId)) return true;
            if (envelope.type != "host.dead_ball_ui" ||
                State != BridgeLifecycleState.SceneReady ||
                !deadBallActionConsumed ||
                !Same(envelope.deliveryId, lastDeliveryId)) return false;
            var payload = envelope.ParsedPayload();
            return Same(payload.String("replayDigest"), replayDigest);
        }

        public bool MarkUnityReady()
        {
            if (State != BridgeLifecycleState.Loading) return false;
            State = BridgeLifecycleState.Ready;
            return true;
        }

        public bool MarkClockSynchronized(string sampleId)
        {
            if ((State != BridgeLifecycleState.Ready && State != BridgeLifecycleState.SceneReady) ||
                string.IsNullOrEmpty(sampleId)) return false;
            acceptedClockSamples.Add(sampleId);
            return true;
        }

        public bool SelectClockSample(string sampleId)
        {
            if ((State != BridgeLifecycleState.Ready && State != BridgeLifecycleState.SceneReady) ||
                !ClockSynchronized || string.IsNullOrEmpty(sampleId) ||
                !acceptedClockSamples.Contains(sampleId)) return false;
            selectedClockSampleId = sampleId;
            return true;
        }

        public bool MarkDeliveryDead(double deadT, string digest)
        {
            if ((State != BridgeLifecycleState.Resolved && State != BridgeLifecycleState.Replaying &&
                 State != BridgeLifecycleState.Demonstrating) ||
                double.IsNaN(deadT) || double.IsInfinity(deadT) || deadT != expectedDeadT ||
                !string.Equals(digest, activeCompletionDigest, StringComparison.Ordinal)) return false;
            var completedDemonstration = State == BridgeLifecycleState.Demonstrating;
            if (completedDemonstration) lastDemonstrationId = activeDeliveryId;
            lastCompletionWasReplay = State == BridgeLifecycleState.Replaying || completedDemonstration;
            if (lastCompletionWasReplay)
            {
                // Replay completion opens a fresh, inert restoration window.
                // No action or Pause is available until the host rebinds the
                // exact delivery/digest with host.dead_ball_ui.
                deadBallUiAccepted = false;
                deadBallActionConsumed = false;
                pauseRequestPending = false;
                deadBallPrimaryAction = null;
                deadBallSecondaryAction = null;
            }
            activeDeliveryId = null;
            activePlanJson = null;
            activeSeed = null;
            activeFlightJson = null;
            activeProvisionalSwingJson = null;
            activeCompletionDigest = null;
            State = BridgeLifecycleState.SceneReady;
            return true;
        }

        /// <summary>
        /// Consumes exactly one visible action from the last accepted dead-ball UI. The action remains a request:
        /// TypeScript is the only runtime allowed to advance or enter Coach Mode.
        /// </summary>
        public bool TryMarkDeadBallAction(string deliveryId, string digest, string action)
        {
            if (State != BridgeLifecycleState.SceneReady || paused || presentationHeld ||
                pauseRequestPending || !deadBallUiAccepted || deadBallActionConsumed ||
                !string.Equals(deliveryId, lastDeliveryId, StringComparison.Ordinal) ||
                !string.Equals(digest, replayDigest, StringComparison.Ordinal) ||
                (action != deadBallPrimaryAction && action != deadBallSecondaryAction)) return false;
            deadBallActionConsumed = true;
            deadBallUiAccepted = false;
            deadBallPrimaryAction = null;
            deadBallSecondaryAction = null;
            return true;
        }

        /// <summary>
        /// Reserves one authoritative pause request. The ordinary HUD control is
        /// valid while a live delivery is being presented, but not while an
        /// accepted result is still playing its consequence, and while the
        /// exact last dead ball retains an accepted action surface. Android Back
        /// uses <paramref name="deadBallOnly"/> so an Activity callback can never
        /// pause an unrelated ready scene, replay, stale result or consumed UI.
        /// </summary>
        public bool TryMarkPauseRequest(bool deadBallOnly)
        {
            if (paused || presentationHeld || pauseRequestPending ||
                State == BridgeLifecycleState.Replaying || State == BridgeLifecycleState.Demonstrating)
                return false;

            var retainedDeadBall = State == BridgeLifecycleState.SceneReady &&
                                   deadBallUiAccepted &&
                                   !deadBallActionConsumed &&
                                   !string.IsNullOrEmpty(lastDeliveryId) &&
                                   !string.IsNullOrEmpty(replayDigest);
            if (deadBallOnly ? !retainedDeadBall :
                State != BridgeLifecycleState.Delivery &&
                !retainedDeadBall)
                return false;

            pauseRequestPending = true;
            return true;
        }

        public bool MarkUnityUnloaded()
        {
            // Android may have to physically unload after a fatal runtime callback,
            // before the host can send host.dispose. Failed is therefore a valid
            // terminal cleanup source, but no other active state is.
            if (State != BridgeLifecycleState.Disposing && State != BridgeLifecycleState.Failed) return false;
            State = BridgeLifecycleState.Unloaded;
            return true;
        }

        public void Fail(string reason)
        {
            State = BridgeLifecycleState.Failed;
            FailureReason = string.IsNullOrEmpty(reason) ? "Unknown bridge failure." : reason;
        }

        private bool TryTransition(UnityPracticeEnvelope envelope)
        {
            switch (envelope.type)
            {
                case "host.initialize":
                    if (State != BridgeLifecycleState.Cold) return false;
                    var initialize = envelope.ParsedPayload();
                    handedness = initialize.String("handedness");
                    assistance = initialize.String("assistance");
                    State = BridgeLifecycleState.Loading;
                    return true;
                case "host.clock_sync":
                    return (State == BridgeLifecycleState.Ready || State == BridgeLifecycleState.SceneReady) &&
                           envelope.deliveryId == null;
                case "host.clock_selected":
                    return (State == BridgeLifecycleState.Ready || State == BridgeLifecycleState.SceneReady) &&
                           envelope.deliveryId == null && ClockSynchronized &&
                           acceptedClockSamples.Contains(
                               envelope.ParsedPayload().String("sampleId"));
                case "host.scene":
                    if ((State != BridgeLifecycleState.Ready && State != BridgeLifecycleState.SceneReady) ||
                        envelope.deliveryId != null || !ClockSynchronized || !ClockSelected) return false;
                    var scene = envelope.ParsedPayload();
                    if (scene.String("handedness") != handedness) return false;
                    sceneConditions = scene.String("conditions");
                    sceneHandedness = scene.String("handedness");
                    sceneBowlerJson = scene.Raw("bowler");
                    sceneFieldJson = scene.Raw("field");
                    sceneBallJson = scene.Raw("ball");
                    sceneHasChase = scene.Contains("chase");
                    sceneChaseTarget = 0;
                    sceneChaseMaxBalls = 0;
                    if (sceneHasChase)
                    {
                        var sceneChase = scene.Object("chase");
                        sceneChaseTarget = sceneChase.Integer("target");
                        sceneChaseMaxBalls = sceneChase.Integer("maxBalls");
                    }
                    State = BridgeLifecycleState.SceneReady;
                    return true;
                case "host.delivery":
                    if (State != BridgeLifecycleState.SceneReady || envelope.deliveryId == null) return false;
                    lastDemonstrationId = null;
                    var delivery = envelope.ParsedPayload();
                    var deliveryFlight = delivery.Object("flight");
                    if (!Same(delivery.String("seed"), deliveryFlight.String("seed")) ||
                        !Same(delivery.Raw("plan"), deliveryFlight.Raw("plan"))) return false;
                    activeDeliveryId = envelope.deliveryId;
                    activeOverIndex = delivery.Integer("overIndex");
                    activeBallIndex = delivery.Integer("ballIndex");
                    activePlanJson = delivery.Raw("plan");
                    activeSeed = delivery.String("seed");
                    activeFlightJson = delivery.Raw("flight");
                    activeProvisionalSwingJson = null;
                    activeCompletionDigest = null;
                    expectedDeadT = 0.0;
                    lastCompletionWasReplay = false;
                    presentationHeld = false;
                    deadBallUiAccepted = false;
                    deadBallActionConsumed = false;
                    pauseRequestPending = false;
                    deadBallPrimaryAction = null;
                    deadBallSecondaryAction = null;
                    State = BridgeLifecycleState.Delivery;
                    return true;
                case "host.provisional_swing":
                    if (State != BridgeLifecycleState.Delivery || !MatchesActiveDelivery(envelope.deliveryId))
                        return false;
                    activeProvisionalSwingJson = envelope.ParsedPayload().Raw("swing");
                    return true;
                case "host.result":
                    if (State != BridgeLifecycleState.Delivery || !MatchesActiveDelivery(envelope.deliveryId))
                        return false;
                    var acceptedResult = envelope.ParsedPayload();
                    if (!ResultMatchesActive(acceptedResult)) return false;
                    lastDeliveryId = envelope.deliveryId;
                    replayDigest = acceptedResult.String("replayDigest");
                    activeCompletionDigest = replayDigest;
                    expectedDeadT = acceptedResult.Object("result").Number("deadT");
                    lastResolutionJson = envelope.payloadJson;
                    lastResolution = acceptedResult;
                    State = BridgeLifecycleState.Resolved;
                    return true;
                case "host.dead_ball_ui":
                    if (State != BridgeLifecycleState.SceneReady ||
                        deadBallActionConsumed ||
                        !Same(envelope.deliveryId, lastDeliveryId)) return false;
                    var deadBallUi = envelope.ParsedPayload();
                    if (!Same(deadBallUi.String("replayDigest"), replayDigest)) return false;
                    deadBallPrimaryAction = deadBallUi.String("primaryAction");
                    deadBallSecondaryAction = deadBallUi.String("secondaryAction", true);
                    deadBallUiAccepted = true;
                    return true;
                case "host.replay":
                    if ((State != BridgeLifecycleState.Resolved && State != BridgeLifecycleState.SceneReady) ||
                        envelope.deliveryId != lastDeliveryId) return false;
                    var replay = envelope.ParsedPayload();
                    var resolution = replay.Object("resolution");
                    if (resolution.String("replayDigest") != replayDigest) return false;
                    if (!Same(replay.Raw("resolution"), lastResolutionJson)) return false;
                    deadBallUiAccepted = false;
                    deadBallActionConsumed = true;
                    pauseRequestPending = false;
                    deadBallPrimaryAction = null;
                    deadBallSecondaryAction = null;
                    activeDeliveryId = envelope.deliveryId;
                    activeCompletionDigest = replayDigest;
                    expectedDeadT = lastResolution.Object("result").Number("deadT");
                    State = BridgeLifecycleState.Replaying;
                    return true;
                case "host.demonstration":
                    if (State != BridgeLifecycleState.SceneReady || envelope.deliveryId == null) return false;
                    lastDemonstrationId = null;
                    var demonstration = envelope.ParsedPayload();
                    var demonstrationDelivery = demonstration.Object("delivery");
                    var demonstrationResolution = demonstration.Object("resolution");
                    if (!ResolutionMatchesDelivery(demonstrationDelivery, demonstrationResolution)) return false;
                    activeDeliveryId = envelope.deliveryId;
                    activeOverIndex = demonstrationDelivery.Integer("overIndex");
                    activeBallIndex = demonstrationDelivery.Integer("ballIndex");
                    activePlanJson = demonstrationDelivery.Raw("plan");
                    activeSeed = demonstrationDelivery.String("seed");
                    activeFlightJson = demonstrationDelivery.Raw("flight");
                    activeProvisionalSwingJson = null;
                    activeCompletionDigest = demonstrationResolution.String("replayDigest");
                    expectedDeadT = demonstrationResolution.Object("result").Number("deadT");
                    lastCompletionWasReplay = false;
                    presentationHeld = false;
                    deadBallUiAccepted = false;
                    deadBallActionConsumed = false;
                    pauseRequestPending = false;
                    deadBallPrimaryAction = null;
                    deadBallSecondaryAction = null;
                    State = BridgeLifecycleState.Demonstrating;
                    return true;
                case "host.demonstration_cancel":
                    if (State != BridgeLifecycleState.Demonstrating ||
                        !MatchesActiveDelivery(envelope.deliveryId)) return false;
                    lastDemonstrationId = activeDeliveryId;
                    ClearActivePresentation();
                    deadBallUiAccepted = false;
                    deadBallActionConsumed = false;
                    pauseRequestPending = false;
                    deadBallPrimaryAction = null;
                    deadBallSecondaryAction = null;
                    State = BridgeLifecycleState.SceneReady;
                    return true;
                case "host.profile":
                case "host.locale":
                    return IsActiveState() && envelope.deliveryId == null;
                case "host.pause":
                    if (!IsActiveState() || envelope.deliveryId != null) return false;
                    paused = true;
                    pauseRequestPending = false;
                    return true;
                case "host.resume":
                    if (!IsActiveState() || envelope.deliveryId != null) return false;
                    paused = false;
                    presentationHeld = envelope.ParsedPayload().String("reason") ==
                                       "foreground";
                    pauseRequestPending = false;
                    return true;
                case "host.benchmark":
                    return (State == BridgeLifecycleState.Ready || State == BridgeLifecycleState.SceneReady) &&
                           envelope.deliveryId == null && ClockSynchronized && ClockSelected;
                case "bridge.ack":
                    return State != BridgeLifecycleState.Cold && State != BridgeLifecycleState.Unloaded &&
                           State != BridgeLifecycleState.Failed;
                case "host.dispose":
                    if (State == BridgeLifecycleState.Cold || State == BridgeLifecycleState.Disposing ||
                        State == BridgeLifecycleState.Unloaded || envelope.deliveryId != null) return false;
                    State = BridgeLifecycleState.Disposing;
                    return true;
                default:
                    return false;
            }
        }

        private bool IsActiveState()
        {
            return State == BridgeLifecycleState.Ready || State == BridgeLifecycleState.SceneReady ||
                   State == BridgeLifecycleState.Delivery || State == BridgeLifecycleState.Resolved ||
                   State == BridgeLifecycleState.Replaying || State == BridgeLifecycleState.Demonstrating;
        }

        private bool MatchesActiveDelivery(string deliveryId)
        {
            return deliveryId != null && string.Equals(deliveryId, activeDeliveryId, StringComparison.Ordinal);
        }

        private bool ResultMatchesActive(StrictJsonObject resolution)
        {
            if (sceneConditions == null || sceneHandedness == null || sceneBowlerJson == null ||
                sceneFieldJson == null || sceneBallJson == null || activePlanJson == null ||
                activeSeed == null || activeFlightJson == null) return false;

            // A chase session's results all carry the situation of that chase; an ordinary Practice session's carry none.
            if (resolution.Contains("chase") != sceneHasChase) return false;
            if (sceneHasChase)
            {
                var chase = resolution.Object("chase");
                if (chase.Integer("target") != sceneChaseTarget || chase.Integer("maxBalls") != sceneChaseMaxBalls)
                    return false;
            }

            var record = resolution.Object("record");
            var result = resolution.Object("result");
            if (record.Integer("overIndex") != activeOverIndex ||
                record.Integer("ballIndex") != activeBallIndex ||
                !Same(record.String("seed"), activeSeed) ||
                !Same(record.Raw("plan"), activePlanJson) ||
                !Same(result.Raw("flight"), activeFlightJson) ||
                !Same(record.Raw("bowler"), sceneBowlerJson) ||
                !Same(record.Raw("field"), sceneFieldJson) ||
                !Same(record.Raw("ball"), sceneBallJson) ||
                !Same(record.String("conditions"), sceneConditions) ||
                !Same(record.String("handedness"), sceneHandedness) ||
                !Same(record.String("assist"), assistance)) return false;

            if (activeProvisionalSwingJson != null &&
                !Same(record.Raw("swing"), activeProvisionalSwingJson)) return false;
            if (!Same(record.Raw("swing"), result.Raw("swing"))) return false;

            var outcome = result.Object("outcome");
            if (record.Integer("runs") != outcome.Integer("runs") ||
                !Same(record.Raw("dismissal"), outcome.Raw("dismissal"))) return false;
            return true;
        }

        private bool ResolutionMatchesDelivery(
            StrictJsonObject delivery,
            StrictJsonObject resolution)
        {
            if (sceneConditions == null || sceneHandedness == null || sceneBowlerJson == null ||
                sceneFieldJson == null || sceneBallJson == null) return false;

            var flight = delivery.Object("flight");
            var record = resolution.Object("record");
            var result = resolution.Object("result");
            if (!Same(delivery.String("seed"), flight.String("seed")) ||
                !Same(delivery.Raw("plan"), flight.Raw("plan")) ||
                record.Integer("overIndex") != delivery.Integer("overIndex") ||
                record.Integer("ballIndex") != delivery.Integer("ballIndex") ||
                !Same(record.String("seed"), delivery.String("seed")) ||
                !Same(record.Raw("plan"), delivery.Raw("plan")) ||
                !Same(result.Raw("flight"), delivery.Raw("flight")) ||
                !Same(record.Raw("bowler"), sceneBowlerJson) ||
                !Same(record.Raw("field"), sceneFieldJson) ||
                !Same(record.Raw("ball"), sceneBallJson) ||
                !Same(record.String("conditions"), sceneConditions) ||
                !Same(record.String("handedness"), sceneHandedness) ||
                !Same(record.String("assist"), assistance) ||
                !Same(record.Raw("swing"), result.Raw("swing"))) return false;

            var outcome = result.Object("outcome");
            return record.Integer("runs") == outcome.Integer("runs") &&
                   Same(record.Raw("dismissal"), outcome.Raw("dismissal"));
        }

        private void ClearActivePresentation()
        {
            activeDeliveryId = null;
            activePlanJson = null;
            activeSeed = null;
            activeFlightJson = null;
            activeProvisionalSwingJson = null;
            activeCompletionDigest = null;
            expectedDeadT = 0.0;
        }

        private static bool Same(string left, string right)
        {
            return string.Equals(left, right, StringComparison.Ordinal);
        }
    }
}
