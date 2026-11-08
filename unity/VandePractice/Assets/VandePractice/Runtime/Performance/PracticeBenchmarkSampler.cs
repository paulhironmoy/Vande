using System;
using System.Collections.Generic;
using Vande.Practice.Bridge;

namespace Vande.Practice.Performance
{
    /// <summary>
    /// Bounded renderer-local frame interval capture. Call Advance exactly once
    /// per Unity frame with the raw unscaled interval; this class does not infer
    /// results from WebView timing or synthesize missing frames.
    /// </summary>
    public sealed class PracticeBenchmarkSampler
    {
        private readonly int requestedWarmupFrames;
        private readonly double requestedDurationMs;
        private readonly int sampleCap;
        private readonly List<double> intervals;
        private int warmupFrames;
        private double warmupDurationMs;
        private double measuredDurationMs;
        private bool complete;

        public PracticeBenchmarkSampler(double durationMs, int warmupFrameCount, int maximumSamples)
        {
            if (!Finite(durationMs) || durationMs < 1000.0 ||
                durationMs > BridgeConstants.MaxBenchmarkDurationMs)
                throw new BridgeValidationException("Benchmark duration is outside the contract.");
            if (warmupFrameCount < 0 || warmupFrameCount > BridgeConstants.MaxBenchmarkWarmupFrames)
                throw new BridgeValidationException("Benchmark warmupFrames is outside the contract.");
            if (maximumSamples < 2 || maximumSamples > BridgeConstants.MaxBenchmarkIntervals)
                throw new BridgeValidationException("Benchmark sampleCap is outside the contract.");

            requestedDurationMs = durationMs;
            requestedWarmupFrames = warmupFrameCount;
            sampleCap = maximumSamples;
            intervals = new List<double>(maximumSamples);
        }

        public bool Complete => complete;
        public int WarmupFrames => warmupFrames;
        public double WarmupDurationMs => warmupDurationMs;
        public int SampleCount => intervals.Count;

        public void Advance(double frameIntervalMs)
        {
            if (complete) return;
            if (!Finite(frameIntervalMs) || frameIntervalMs <= 0.0 || frameIntervalMs > 10_000.0)
                throw new BridgeValidationException("Benchmark frame interval is outside the contract.");

            if (warmupFrames < requestedWarmupFrames)
            {
                warmupFrames++;
                warmupDurationMs += frameIntervalMs;
                return;
            }

            intervals.Add(frameIntervalMs);
            measuredDurationMs += frameIntervalMs;
            complete = measuredDurationMs >= requestedDurationMs || intervals.Count >= sampleCap;
        }

        public double[] Snapshot()
        {
            if (!complete || intervals.Count == 0)
                throw new BridgeValidationException("Benchmark capture has not completed.");
            return intervals.ToArray();
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
