namespace Vande.Practice.Bridge
{
    public static class BridgeConstants
    {
        public const int ContractVersion = 6;
        public const int SimulationVersion = 3;
        public const int TraceVersion = 2;

        public const int MaxPacketBytes = 1 * 1024 * 1024;
        // The body is a JSON string in the outer packet, so escaped quotes can
        // approach 2x even though the canonical body itself is capped at 1 MiB.
        public const int MaxOuterPacketBytes = MaxPacketBytes * 2 + 4 * 1024;
        public const int MaxLargePayloadBytes = 8 * 1024 * 1024;
        public const int MaxIdentifierLength = 256;
        public const int MaxBuildIdLength = 256;
        public const int MaxLocaleLength = 32;
        public const long MaxJavaScriptSafeInteger = 9_007_199_254_740_991L;
        public const int MaxGestureSamples = 512;
        public const int MaxTraceSamplesPerChannel = 40_000;
        public const int MaxTraceEvents = 1_024;
        public const double MaxTraceDurationSeconds = 30.0;
        // Generous cricket-world ceiling before validated doubles enter Unity float transforms/animation.
        public const double MaxPresentationMagnitude = 1_000_000.0;
        public const double MaxBatterRootOffsetMetres = 0.18;
        public const double MaxBatterCrouchMetres = 0.18;
        public const double EmptyBatNominalToleranceMetres = 0.000001;
        public const double CanonicalBatLengthMetres = 0.86;
        public const double CanonicalBatLengthToleranceMetres = 0.000001;
        public const double CanonicalBatUnitTolerance = 0.000001;
        public const double CanonicalBatOrthogonalityTolerance = 0.000001;
        public const double ExactTraceTimeToleranceSeconds = 0.000000000001;
        public const double HeldBatPoseToleranceMetres = 0.000000001;
        public const int MaxSeenMessages = 2_048;
        public const int MinimumClockSamples = 5;
        public const int MaxBenchmarkDurationMs = 10_000;
        public const int MaxBenchmarkIntervals = 1_200;
        public const int MaxBenchmarkWarmupFrames = 300;
        public const int MaxProtectedRegions = 6;
        public const int MaxProtectedRegionViewportPixels = 32_768;

        // Kill-switch for the background decode of large packets (UnityPracticeBridgeSession.EnableBackgroundDecode; the threading
        // model is described in BackgroundPacketDecoder.cs). false = every packet is decoded on the main thread, as before.
        public const bool BackgroundDecodeEnabled = true;
        // Packets shorter than this are decoded inline: the golden result and replay packets are 280,000 to 456,000 characters,
        // the delivery packets about 100,000 and every control message under 2,000, and a delivery must start on the frame it arrives.
        public const int BackgroundDecodeMinimumCharacters = 160 * 1024;
    }
}
