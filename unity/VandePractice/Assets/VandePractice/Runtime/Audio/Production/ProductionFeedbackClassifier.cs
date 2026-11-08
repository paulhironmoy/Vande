using System;
using Vande.Practice.Audio;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// Deterministically projects authoritative trace events into presentation
    /// instructions. It owns no score, dismissal or physics decisions.
    /// </summary>
    public sealed class ProductionFeedbackClassifier
    {
        public const int RequiredInstructionCapacity = 4;

        private ProductionShotIntent shotIntent;
        private ProductionShotIntent authoritativeShotIntent;
        private string authoritativeDismissal;
        private bool authoritativeOutcomeKnown;
        private bool preserveAuthoritativeOutcomeOnRelease;
        private bool deliveryOpen;
        private bool physicalContact;
        private bool padContact;
        private bool missOrLeaveReported;
        private bool wicketConfirmed;
        private bool boundaryConfirmed;
        private bool runCompleted;
        private bool outcomeEmotionReported;
        private bool hasLast;
        private PracticeFeedbackKind lastKind;
        private double lastTime;
        private string lastContact;
        private int lastRuns;

        public ProductionShotIntent ShotIntent => EffectiveShotIntent;
        public bool PhysicalContactOccurred => physicalContact || padContact;
        public bool WicketConfirmed => wicketConfirmed;
        public bool BoundaryConfirmed => boundaryConfirmed;

        public void SetShotIntent(ProductionShotIntent value)
        {
            shotIntent = value;
        }

        public void SetShotIntent(string value)
        {
            shotIntent = ParseShotIntent(value, true);
        }

        /// <summary>
        /// Latches only host-authoritative presentation facts. It emits no cue
        /// and cannot alter physics or scoring. A closed delivery means the
        /// result belongs to a replay whose first release must retain it.
        /// </summary>
        public void SetAuthoritativeOutcome(string intent, string dismissal)
        {
            authoritativeShotIntent = ParseShotIntent(intent, false);
            if (dismissal != null &&
                !string.Equals(dismissal, "bowled", StringComparison.Ordinal) &&
                !string.Equals(dismissal, "caught", StringComparison.Ordinal) &&
                !string.Equals(dismissal, "caught_behind", StringComparison.Ordinal) &&
                !string.Equals(dismissal, "lbw", StringComparison.Ordinal))
                throw new ArgumentOutOfRangeException(nameof(dismissal));
            authoritativeDismissal = dismissal;
            authoritativeOutcomeKnown = true;
            preserveAuthoritativeOutcomeOnRelease = !deliveryOpen;
        }

        public void Reset()
        {
            shotIntent = ProductionShotIntent.Unknown;
            ClearAuthoritativeOutcome();
            deliveryOpen = false;
            physicalContact = false;
            padContact = false;
            missOrLeaveReported = false;
            wicketConfirmed = false;
            boundaryConfirmed = false;
            runCompleted = false;
            outcomeEmotionReported = false;
            hasLast = false;
            lastContact = null;
        }

        public int Classify(
            PracticeFeedbackEvent feedback,
            ProductionFeedbackInstruction[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (destination.Length < RequiredInstructionCapacity)
                throw new ArgumentException(
                    "Production feedback requires a four-instruction reusable buffer.",
                    nameof(destination));

            if (feedback.Kind == PracticeFeedbackKind.Release)
            {
                if (deliveryOpen && hasLast && lastKind == PracticeFeedbackKind.Release &&
                    Same(feedback.SimulationTime, lastTime))
                    return 0;
                BeginDelivery();
                Record(feedback);
                destination[0] = Release();
                return 1;
            }

            if (IsDuplicate(feedback)) return 0;
            Record(feedback);
            deliveryOpen = true;

            switch (feedback.Kind)
            {
                case PracticeFeedbackKind.PitchBounce:
                    destination[0] = Pitch();
                    return 1;

                case PracticeFeedbackKind.BallBounce:
                    destination[0] = BallGround();
                    return 1;

                case PracticeFeedbackKind.BatContact:
                    return Contact(feedback.Contact, destination);

                case PracticeFeedbackKind.Pad:
                    physicalContact = true;
                    padContact = true;
                    destination[0] = Pad();
                    return 1;

                case PracticeFeedbackKind.KeeperTake:
                    return KeeperTake(destination);

                case PracticeFeedbackKind.Field:
                    destination[0] = FieldPickup();
                    return 1;

                case PracticeFeedbackKind.Catch:
                    wicketConfirmed = true;
                    outcomeEmotionReported = true;
                    destination[0] = Catch();
                    destination[1] = CrowdWicket(0.16f);
                    return 2;

                case PracticeFeedbackKind.Throw:
                    destination[0] = Throw();
                    return 1;

                case PracticeFeedbackKind.Boundary:
                    boundaryConfirmed = true;
                    outcomeEmotionReported = true;
                    if (feedback.Runs == 6)
                    {
                        destination[0] = BoundarySix();
                        destination[1] = CrowdSix();
                    }
                    else
                    {
                        destination[0] = BoundaryFour();
                        destination[1] = CrowdBoundary();
                    }
                    return 2;

                case PracticeFeedbackKind.Run:
                    runCompleted = true;
                    outcomeEmotionReported = true;
                    destination[0] = Run();
                    destination[1] = CrowdRun();
                    return 2;

                case PracticeFeedbackKind.Stumps:
                    return Stumps(destination);

                case PracticeFeedbackKind.Dead:
                    return Dead(destination);

                default:
                    return 0;
            }
        }

        private void BeginDelivery()
        {
            var preserveAuthoritativeOutcome = preserveAuthoritativeOutcomeOnRelease;
            shotIntent = ProductionShotIntent.Unknown;
            deliveryOpen = true;
            physicalContact = false;
            padContact = false;
            missOrLeaveReported = false;
            wicketConfirmed = false;
            boundaryConfirmed = false;
            runCompleted = false;
            outcomeEmotionReported = false;
            hasLast = false;
            lastContact = null;
            if (!preserveAuthoritativeOutcome) ClearAuthoritativeOutcome();
            else preserveAuthoritativeOutcomeOnRelease = false;
        }

        private int Contact(string contact, ProductionFeedbackInstruction[] destination)
        {
            if (string.Equals(contact, "middle", StringComparison.Ordinal))
            {
                physicalContact = true;
                destination[0] = EffectiveShotIntent == ProductionShotIntent.Defend ? Block() : Middle();
                return 1;
            }

            if (string.Equals(contact, "block", StringComparison.Ordinal))
            {
                physicalContact = true;
                destination[0] = Block();
                return 1;
            }

            if (string.Equals(contact, "outside_edge", StringComparison.Ordinal) ||
                string.Equals(contact, "nick", StringComparison.Ordinal))
            {
                physicalContact = true;
                destination[0] = Nick();
                destination[1] = CrowdTension();
                return 2;
            }

            if (string.Equals(contact, "inside_edge", StringComparison.Ordinal) ||
                string.Equals(contact, "top_edge", StringComparison.Ordinal) ||
                string.Equals(contact, "leading_edge", StringComparison.Ordinal) ||
                string.Equals(contact, "edge", StringComparison.Ordinal))
            {
                physicalContact = true;
                destination[0] = Edge();
                destination[1] = CrowdTension();
                return 2;
            }

            if (string.Equals(contact, "pad", StringComparison.Ordinal) ||
                string.Equals(contact, "body", StringComparison.Ordinal))
            {
                physicalContact = true;
                padContact = true;
                destination[0] = Pad();
                return 1;
            }

            if (string.Equals(contact, "miss", StringComparison.Ordinal))
            {
                missOrLeaveReported = true;
                if (IsAuthoritativeLeave) outcomeEmotionReported = true;
                destination[0] = IsAuthoritativeLeave ? Leave() : Miss();
                return 1;
            }

            if (string.Equals(contact, "leave", StringComparison.Ordinal))
            {
                missOrLeaveReported = true;
                if (IsAuthoritativeLeave) outcomeEmotionReported = true;
                destination[0] = Leave();
                return 1;
            }

            // Unknown or incomplete contact data is deliberately silent. A
            // presentation layer must never invent a bat/pad impact.
            return 0;
        }

        private int KeeperTake(ProductionFeedbackInstruction[] destination)
        {
            var count = EnsureMissOrLeave(destination, 0);
            destination[count++] = KeeperTakeCue(
                EffectiveShotIntent != ProductionShotIntent.Leave);
            if (EffectiveShotIntent != ProductionShotIntent.Leave)
            {
                destination[count++] = CrowdNearMiss();
                outcomeEmotionReported = true;
            }
            return count;
        }

        private int Stumps(ProductionFeedbackInstruction[] destination)
        {
            var count = EnsureMissOrLeave(destination, 0);
            wicketConfirmed = true;
            outcomeEmotionReported = true;
            destination[count++] = StumpImpact();
            destination[count++] = BailFall();
            destination[count++] = CrowdWicket(0.18f);
            return count;
        }

        private int Dead(ProductionFeedbackInstruction[] destination)
        {
            var count = 0;
            if (IsAuthoritativeLbw && !wicketConfirmed)
            {
                wicketConfirmed = true;
                outcomeEmotionReported = true;
                destination[count++] = LbwDecision();
                destination[count++] = CrowdWicket(0.12f, false);
            }
            if (!physicalContact && !padContact && !wicketConfirmed && !boundaryConfirmed)
                count = EnsureMissOrLeave(destination, count);

            if (!wicketConfirmed && !boundaryConfirmed && !runCompleted && !outcomeEmotionReported)
            {
                destination[count++] = CrowdDot();
                outcomeEmotionReported = true;
            }

            deliveryOpen = false;
            return count;
        }

        private int EnsureMissOrLeave(ProductionFeedbackInstruction[] destination, int count)
        {
            if (physicalContact || padContact || missOrLeaveReported) return count;
            missOrLeaveReported = true;
            if (EffectiveShotIntent == ProductionShotIntent.Leave)
            {
                outcomeEmotionReported = true;
                destination[count++] = Leave();
            }
            else
                destination[count++] = Miss();
            return count;
        }

        private ProductionShotIntent EffectiveShotIntent =>
            authoritativeOutcomeKnown ? authoritativeShotIntent : shotIntent;

        private bool IsAuthoritativeLeave =>
            authoritativeOutcomeKnown && authoritativeShotIntent == ProductionShotIntent.Leave;

        private bool IsAuthoritativeLbw =>
            authoritativeOutcomeKnown &&
            string.Equals(authoritativeDismissal, "lbw", StringComparison.Ordinal);

        private void ClearAuthoritativeOutcome()
        {
            authoritativeShotIntent = ProductionShotIntent.Unknown;
            authoritativeDismissal = null;
            authoritativeOutcomeKnown = false;
            preserveAuthoritativeOutcomeOnRelease = false;
        }

        private static ProductionShotIntent ParseShotIntent(string value, bool allowUnknown)
        {
            if (string.Equals(value, "defend", StringComparison.Ordinal))
                return ProductionShotIntent.Defend;
            if (string.Equals(value, "attack", StringComparison.Ordinal))
                return ProductionShotIntent.Attack;
            if (string.Equals(value, "leave", StringComparison.Ordinal))
                return ProductionShotIntent.Leave;
            if (allowUnknown && string.IsNullOrEmpty(value))
                return ProductionShotIntent.Unknown;
            throw new ArgumentOutOfRangeException(nameof(value));
        }

        private bool IsDuplicate(PracticeFeedbackEvent value)
        {
            return hasLast && lastKind == value.Kind && Same(lastTime, value.SimulationTime) &&
                   lastRuns == value.Runs && string.Equals(lastContact, value.Contact, StringComparison.Ordinal);
        }

        private void Record(PracticeFeedbackEvent value)
        {
            hasLast = true;
            lastKind = value.Kind;
            lastTime = value.SimulationTime;
            lastContact = value.Contact;
            lastRuns = value.Runs;
        }

        private static bool Same(double left, double right)
        {
            return Math.Abs(left - right) <= 0.0000001;
        }

        private static ProductionFeedbackInstruction Release()
        {
            return Physical(ProductionFeedbackCue.Release, true, 52, 0.34f, 0f,
                ProductionCaptionId.Release, ProductionHapticKind.Release, 0.08f, false);
        }

        private static ProductionFeedbackInstruction Pitch()
        {
            return Physical(ProductionFeedbackCue.Pitch, true, 76, 0.72f, 0f,
                ProductionCaptionId.Pitch, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction BallGround()
        {
            return Physical(ProductionFeedbackCue.BallGround, true, 44, 0.34f, 0f,
                ProductionCaptionId.BallGround, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction Middle()
        {
            return Physical(ProductionFeedbackCue.BatMiddle, true, 104, 1f, 0f,
                ProductionCaptionId.Middle, ProductionHapticKind.Middle, 1f, true);
        }

        private static ProductionFeedbackInstruction Block()
        {
            return Physical(ProductionFeedbackCue.BatBlock, true, 90, 0.66f, 0f,
                ProductionCaptionId.Block, ProductionHapticKind.Block, 0.36f, true);
        }

        private static ProductionFeedbackInstruction Edge()
        {
            return Physical(ProductionFeedbackCue.Edge, true, 98, 0.76f, 0f,
                ProductionCaptionId.Edge, ProductionHapticKind.Edge, 0.46f, true);
        }

        private static ProductionFeedbackInstruction Nick()
        {
            return Physical(ProductionFeedbackCue.Nick, true, 100, 0.7f, 0f,
                ProductionCaptionId.Nick, ProductionHapticKind.Edge, 0.38f, true);
        }

        private static ProductionFeedbackInstruction Pad()
        {
            return Physical(ProductionFeedbackCue.Pad, true, 86, 0.72f, 0f,
                ProductionCaptionId.Pad, ProductionHapticKind.Pad, 0.54f, true);
        }

        private static ProductionFeedbackInstruction Miss()
        {
            return Physical(ProductionFeedbackCue.Miss, false, 0, 0f, 0f,
                ProductionCaptionId.Miss, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction Leave()
        {
            return Physical(ProductionFeedbackCue.Leave, false, 0, 0f, 0f,
                ProductionCaptionId.Leave, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction KeeperTakeCue(bool includeCaption = true)
        {
            return Physical(ProductionFeedbackCue.KeeperTake, true, 68, 0.62f, 0f,
                includeCaption ? ProductionCaptionId.KeeperTake : ProductionCaptionId.None,
                ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction FieldPickup()
        {
            return Physical(ProductionFeedbackCue.FieldPickup, true, 64, 0.58f, 0f,
                ProductionCaptionId.FieldPickup, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction Catch()
        {
            return Physical(ProductionFeedbackCue.Catch, true, 96, 0.86f, 0f,
                ProductionCaptionId.Catch, ProductionHapticKind.Catch, 0.72f, true);
        }

        private static ProductionFeedbackInstruction Throw()
        {
            return Physical(ProductionFeedbackCue.Throw, true, 56, 0.48f, 0f,
                ProductionCaptionId.Throw, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction BoundaryFour()
        {
            return Physical(ProductionFeedbackCue.BoundaryFour, true, 74, 0.58f, 0f,
                ProductionCaptionId.Four, ProductionHapticKind.Boundary, 0.58f, false);
        }

        private static ProductionFeedbackInstruction BoundarySix()
        {
            // A six does not strike the rope, so its confirmation is caption +
            // haptic here; the separately confirmed crowd cue carries sound.
            return Physical(ProductionFeedbackCue.BoundarySix, false, 0, 0f, 0f,
                ProductionCaptionId.Six, ProductionHapticKind.Six, 0.9f, false);
        }

        private static ProductionFeedbackInstruction Run()
        {
            return Physical(ProductionFeedbackCue.Run, false, 0, 0f, 0f,
                ProductionCaptionId.Run, ProductionHapticKind.None, 0f, false);
        }

        private static ProductionFeedbackInstruction StumpImpact()
        {
            return Physical(ProductionFeedbackCue.StumpImpact, true, 112, 1f, 0f,
                ProductionCaptionId.Stumps, ProductionHapticKind.Wicket, 1f, true);
        }

        private static ProductionFeedbackInstruction BailFall()
        {
            return Physical(ProductionFeedbackCue.BailFall, true, 106, 0.68f, 0.035f,
                ProductionCaptionId.Bails, ProductionHapticKind.None, 0f, true);
        }

        private static ProductionFeedbackInstruction LbwDecision()
        {
            // The pad impact has already supplied the physical sound. The
            // authoritative verdict adds only accessible outcome feedback.
            return Physical(ProductionFeedbackCue.Lbw, false, 0, 0f, 0f,
                ProductionCaptionId.Lbw, ProductionHapticKind.Wicket, 1f, false);
        }

        private static ProductionFeedbackInstruction CrowdTension()
        {
            return Crowd(ProductionFeedbackCue.CrowdTension, 34, 0.34f, 0.04f,
                ProductionCaptionId.CrowdTension, ProductionCrowdEmotion.Tension);
        }

        private static ProductionFeedbackInstruction CrowdNearMiss()
        {
            return Crowd(ProductionFeedbackCue.CrowdNearMiss, 30, 0.3f, 0.1f,
                ProductionCaptionId.CrowdRecovery, ProductionCrowdEmotion.BreathAndRecovery);
        }

        private static ProductionFeedbackInstruction CrowdRun()
        {
            return Crowd(ProductionFeedbackCue.CrowdRun, 28, 0.26f, 0.05f,
                ProductionCaptionId.CrowdAcknowledgement, ProductionCrowdEmotion.Acknowledgement);
        }

        private static ProductionFeedbackInstruction CrowdBoundary()
        {
            return Crowd(ProductionFeedbackCue.CrowdBoundary, 46, 0.74f, 0.06f,
                ProductionCaptionId.CrowdCelebration, ProductionCrowdEmotion.StrongRelease);
        }

        private static ProductionFeedbackInstruction CrowdSix()
        {
            return Crowd(ProductionFeedbackCue.CrowdSix, 52, 0.9f, 0.06f,
                ProductionCaptionId.CrowdCelebration, ProductionCrowdEmotion.PeakCelebration);
        }

        private static ProductionFeedbackInstruction CrowdWicket(
            float delay,
            bool includeCaption = true)
        {
            return Crowd(ProductionFeedbackCue.CrowdWicket, 50, 0.84f, delay,
                includeCaption ? ProductionCaptionId.CrowdWicket : ProductionCaptionId.None,
                ProductionCrowdEmotion.WicketShift);
        }

        private static ProductionFeedbackInstruction CrowdDot()
        {
            return Crowd(ProductionFeedbackCue.CrowdDot, 20, 0.18f, 0.08f,
                ProductionCaptionId.CrowdPressure, ProductionCrowdEmotion.Pressure);
        }

        private static ProductionFeedbackInstruction Physical(
            ProductionFeedbackCue cue,
            bool audible,
            int priority,
            float gain,
            float delay,
            ProductionCaptionId caption,
            ProductionHapticKind haptic,
            float hapticStrength,
            bool ducksCrowd)
        {
            return new ProductionFeedbackInstruction(
                cue, ProductionFeedbackChannel.Physical, audible, priority, gain, delay,
                caption, haptic, hapticStrength, ProductionCrowdEmotion.None, ducksCrowd);
        }

        private static ProductionFeedbackInstruction Crowd(
            ProductionFeedbackCue cue,
            int priority,
            float gain,
            float delay,
            ProductionCaptionId caption,
            ProductionCrowdEmotion emotion)
        {
            return new ProductionFeedbackInstruction(
                cue, ProductionFeedbackChannel.Crowd, true, priority, gain, delay,
                caption, ProductionHapticKind.None, 0f, emotion, false);
        }
    }
}
