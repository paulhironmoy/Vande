using System;

namespace Vande.Practice.Presentation.Production.Effects
{
    /// <summary>
    /// Explicit, immutable permissions for optional live-delivery aids. Each
    /// aid is independent so a landing cue cannot accidentally opt into a
    /// predicted path or ball focus treatment. The default value permits none.
    /// </summary>
    public readonly struct ProductionDeliveryEffectsPolicy
    {
        public ProductionDeliveryEffectsPolicy(
            bool revealPredictionAfterRelease,
            bool revealLandingAfterRelease,
            bool focusAidEnabled)
        {
            RevealPredictionAfterRelease = revealPredictionAfterRelease;
            RevealLandingAfterRelease = revealLandingAfterRelease;
            FocusAidEnabled = focusAidEnabled;
        }

        public bool RevealPredictionAfterRelease { get; }
        public bool RevealLandingAfterRelease { get; }
        public bool FocusAidEnabled { get; }

        /// <summary>No optional live-delivery aids. Also used for replay.</summary>
        public static ProductionDeliveryEffectsPolicy None => default;

        /// <summary>
        /// Ordinary Learn mode: the authoritative pitch location after release,
        /// with no predicted arc and no focus aid.
        /// </summary>
        public static ProductionDeliveryEffectsPolicy LearnLandingOnly =>
            new ProductionDeliveryEffectsPolicy(false, true, false);
    }

    /// <summary>
    /// Visual-only response categories. They never decide cricket outcomes.
    /// </summary>
    public enum ProductionDeliveryResponseKind
    {
        None,
        Pitch,
        Bat,
        Pad,
        Wicket,
        Field,
        Boundary
    }

    /// <summary>
    /// Immutable, between-deliveries presentation budget. Essential ball
    /// readability is retained at every quality; only density changes.
    /// </summary>
    public readonly struct ProductionDeliveryEffectsProfile
    {
        private ProductionDeliveryEffectsProfile(
            PracticePresentationQuality quality,
            bool reducedMotion,
            int predictedPointCap,
            int actualPointCap,
            int responseCapacity,
            int focusSegments,
            float focusRadius,
            float focusWidth)
        {
            Quality = quality;
            ReducedMotion = reducedMotion;
            PredictedPointCap = predictedPointCap;
            ActualPointCap = actualPointCap;
            ResponseCapacity = responseCapacity;
            FocusSegments = focusSegments;
            FocusRadius = focusRadius;
            FocusWidth = focusWidth;
        }

        public PracticePresentationQuality Quality { get; }
        public bool ReducedMotion { get; }
        public int PredictedPointCap { get; }
        public int ActualPointCap { get; }
        public int ResponseCapacity { get; }
        public int FocusSegments { get; }
        public float FocusRadius { get; }
        public float FocusWidth { get; }

        public static ProductionDeliveryEffectsProfile For(
            PracticePresentationQuality quality,
            bool reducedMotion)
        {
            switch (quality)
            {
                case PracticePresentationQuality.Lite:
                    return new ProductionDeliveryEffectsProfile(
                        quality, reducedMotion, 12, 24, 2, 12, 0.052f, 0.0045f);
                case PracticePresentationQuality.Standard:
                    return new ProductionDeliveryEffectsProfile(
                        quality, reducedMotion, 20, 48, 4, 18, 0.055f, 0.005f);
                case PracticePresentationQuality.High:
                    return new ProductionDeliveryEffectsProfile(
                        quality, reducedMotion, 28, 72, 6, 24, 0.058f, 0.0055f);
                default:
                    throw new ArgumentOutOfRangeException(nameof(quality));
            }
        }
    }
}
