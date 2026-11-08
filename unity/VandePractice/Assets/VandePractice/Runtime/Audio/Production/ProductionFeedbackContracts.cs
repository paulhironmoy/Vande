using System;

namespace Vande.Practice.Audio.Production
{
    /// <summary>
    /// Presentation cues derived from authoritative Practice trace events.
    /// None of these values is allowed to create or alter a cricket outcome.
    /// </summary>
    public enum ProductionFeedbackCue
    {
        None = 0,
        Release,
        Pitch,
        BallGround,
        BatMiddle,
        BatBlock,
        Edge,
        Nick,
        Pad,
        Miss,
        Leave,
        KeeperTake,
        FieldPickup,
        Catch,
        Throw,
        BoundaryFour,
        BoundarySix,
        Run,
        StumpImpact,
        BailFall,
        Lbw,
        CrowdTension,
        CrowdNearMiss,
        CrowdRun,
        CrowdBoundary,
        CrowdSix,
        CrowdWicket,
        CrowdDot,
        Count
    }

    public enum ProductionFeedbackChannel
    {
        Physical,
        Crowd
    }

    public enum ProductionCrowdEmotion
    {
        None,
        Tension,
        BreathAndRecovery,
        Acknowledgement,
        Pressure,
        StrongRelease,
        PeakCelebration,
        WicketShift
    }

    public enum ProductionHapticKind
    {
        None,
        Release,
        Middle,
        Block,
        Edge,
        Pad,
        Catch,
        Boundary,
        Six,
        Wicket
    }

    public enum ProductionCaptionId
    {
        None,
        Release,
        Pitch,
        BallGround,
        Middle,
        Block,
        Edge,
        Nick,
        Pad,
        Miss,
        Leave,
        KeeperTake,
        FieldPickup,
        Catch,
        Throw,
        Four,
        Six,
        Run,
        Stumps,
        Bails,
        Lbw,
        CrowdTension,
        CrowdRecovery,
        CrowdAcknowledgement,
        CrowdPressure,
        CrowdCelebration,
        CrowdWicket
    }

    public enum ProductionShotIntent
    {
        Unknown,
        Attack,
        Defend,
        Leave
    }

    public enum ProductionFeedbackAssetMode
    {
        None,
        AuthoredResources,
        SynthesizedFallback,
        Mixed
    }

    /// <summary>
    /// One immutable playback instruction. The classifier writes these into a
    /// caller-owned fixed buffer so live trace routing does not allocate.
    /// </summary>
    public readonly struct ProductionFeedbackInstruction
    {
        public ProductionFeedbackInstruction(
            ProductionFeedbackCue cue,
            ProductionFeedbackChannel channel,
            bool audible,
            int priority,
            float gain,
            float delaySeconds,
            ProductionCaptionId caption,
            ProductionHapticKind haptic,
            float hapticStrength,
            ProductionCrowdEmotion crowdEmotion,
            bool ducksCrowd)
        {
            Cue = cue;
            Channel = channel;
            Audible = audible;
            Priority = priority;
            Gain = gain;
            DelaySeconds = delaySeconds;
            Caption = caption;
            Haptic = haptic;
            HapticStrength = hapticStrength;
            CrowdEmotion = crowdEmotion;
            DucksCrowd = ducksCrowd;
        }

        public ProductionFeedbackCue Cue { get; }
        public ProductionFeedbackChannel Channel { get; }
        public bool Audible { get; }
        public int Priority { get; }
        public float Gain { get; }
        public float DelaySeconds { get; }
        public ProductionCaptionId Caption { get; }
        public ProductionHapticKind Haptic { get; }
        public float HapticStrength { get; }
        public ProductionCrowdEmotion CrowdEmotion { get; }
        public bool DucksCrowd { get; }
    }

    public readonly struct ProductionCaptionCue
    {
        public ProductionCaptionCue(
            ProductionCaptionId id,
            string text,
            double simulationTime,
            ProductionCrowdEmotion emotion)
        {
            Id = id;
            Text = text;
            SimulationTime = simulationTime;
            Emotion = emotion;
        }

        public ProductionCaptionId Id { get; }
        public string Text { get; }
        public double SimulationTime { get; }
        public ProductionCrowdEmotion Emotion { get; }
    }

    public readonly struct ProductionHapticCue
    {
        public ProductionHapticCue(
            ProductionHapticKind kind,
            float strength,
            double simulationTime)
        {
            Kind = kind;
            Strength = strength;
            SimulationTime = simulationTime;
        }

        public ProductionHapticKind Kind { get; }
        public float Strength { get; }
        public double SimulationTime { get; }
    }

    /// <summary>
    /// Platform adapters are prepared before a delivery. Implementations must
    /// not allocate or perform resource discovery from these callbacks.
    /// </summary>
    public interface IProductionHapticOutput
    {
        void Emit(ProductionHapticCue cue);
        void CancelAll();
    }

    /// <summary>
    /// The Unity HUD can bind this to its localized caption surface. Text here
    /// is a short English fallback; Id remains the stable localization key.
    /// </summary>
    public interface IProductionCaptionOutput
    {
        void Present(ProductionCaptionCue cue);
        void Clear();
    }

    internal sealed class NullProductionHapticOutput : IProductionHapticOutput
    {
        internal static readonly NullProductionHapticOutput Instance = new NullProductionHapticOutput();
        private NullProductionHapticOutput() { }
        public void Emit(ProductionHapticCue cue) { }
        public void CancelAll() { }
    }

    internal sealed class NullProductionCaptionOutput : IProductionCaptionOutput
    {
        internal static readonly NullProductionCaptionOutput Instance = new NullProductionCaptionOutput();
        private NullProductionCaptionOutput() { }
        public void Present(ProductionCaptionCue cue) { }
        public void Clear() { }
    }

    public static class ProductionCaptionText
    {
        public static string For(ProductionCaptionId value)
        {
            switch (value)
            {
                case ProductionCaptionId.Release: return "Ball released";
                case ProductionCaptionId.Pitch: return "Ball pitches";
                case ProductionCaptionId.BallGround: return "Ball on the outfield";
                case ProductionCaptionId.Middle: return "Clean bat contact";
                case ProductionCaptionId.Block: return "Defensive block";
                case ProductionCaptionId.Edge: return "Edge";
                case ProductionCaptionId.Nick: return "Fine nick";
                case ProductionCaptionId.Pad: return "Ball hits pad";
                case ProductionCaptionId.Miss: return "Missed";
                case ProductionCaptionId.Leave: return "Left alone";
                case ProductionCaptionId.KeeperTake: return "Keeper takes";
                case ProductionCaptionId.FieldPickup: return "Fielder gathers";
                case ProductionCaptionId.Catch: return "Catch taken";
                case ProductionCaptionId.Throw: return "Return throw";
                case ProductionCaptionId.Four: return "Four confirmed";
                case ProductionCaptionId.Six: return "Six confirmed";
                case ProductionCaptionId.Run: return "Run completed";
                case ProductionCaptionId.Stumps: return "Stumps hit";
                case ProductionCaptionId.Bails: return "Bails fall";
                case ProductionCaptionId.Lbw: return "Out - LBW";
                case ProductionCaptionId.CrowdTension: return "Crowd reacts";
                case ProductionCaptionId.CrowdRecovery: return "Crowd exhales";
                case ProductionCaptionId.CrowdAcknowledgement: return "Crowd acknowledges the run";
                case ProductionCaptionId.CrowdPressure: return "Crowd settles";
                case ProductionCaptionId.CrowdCelebration: return "Crowd celebrates";
                case ProductionCaptionId.CrowdWicket: return "Crowd rises for the wicket";
                case ProductionCaptionId.None: return string.Empty;
                default: throw new ArgumentOutOfRangeException(nameof(value), value, "Unknown caption cue.");
            }
        }
    }
}
