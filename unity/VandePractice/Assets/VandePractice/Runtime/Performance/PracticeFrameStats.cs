using System;

namespace Vande.Practice.Performance
{
    public readonly struct PracticeFrameStatsSnapshot
    {
        public PracticeFrameStatsSnapshot(
            int sampleCount,
            int spikes,
            double fps,
            double averageFrameMs,
            double p95FrameMs,
            double p99FrameMs,
            double worstFrameMs)
        {
            SampleCount = sampleCount;
            Spikes = spikes;
            Fps = fps;
            AverageFrameMs = averageFrameMs;
            P95FrameMs = p95FrameMs;
            P99FrameMs = p99FrameMs;
            WorstFrameMs = worstFrameMs;
        }

        public int SampleCount { get; }
        public int Spikes { get; }
        public double Fps { get; }
        public double AverageFrameMs { get; }
        public double P95FrameMs { get; }
        public double P99FrameMs { get; }
        public double WorstFrameMs { get; }
    }

    /// <summary>Allocation-bounded rolling frame sampler for diagnostic telemetry.</summary>
    public sealed class PracticeFrameStats
    {
        private readonly double[] samples;
        private int next;
        private int count;

        public PracticeFrameStats(int capacity = 600)
        {
            if (capacity < 2) throw new ArgumentOutOfRangeException(nameof(capacity));
            samples = new double[capacity];
        }

        public int Count => count;

        public void Reset()
        {
            Array.Clear(samples, 0, samples.Length);
            next = 0;
            count = 0;
        }

        public void AddSeconds(double seconds)
        {
            if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds <= 0.0) return;
            samples[next] = seconds * 1000.0;
            next = (next + 1) % samples.Length;
            if (count < samples.Length) count++;
        }

        public PracticeFrameStatsSnapshot Snapshot()
        {
            if (count == 0) return new PracticeFrameStatsSnapshot(0, 0, 0, 0, 0, 0, 0);
            var ordered = new double[count];
            var sum = 0.0;
            var spikes = 0;
            for (var index = 0; index < count; index++)
            {
                ordered[index] = samples[index];
                sum += ordered[index];
                if (ordered[index] > 50.0) spikes++;
            }
            Array.Sort(ordered);
            var average = sum / count;
            return new PracticeFrameStatsSnapshot(
                count,
                spikes,
                average > 0.0 ? 1000.0 / average : 0.0,
                average,
                Percentile(ordered, 0.95),
                Percentile(ordered, 0.99),
                ordered[ordered.Length - 1]);
        }

        private static double Percentile(double[] ordered, double percentile)
        {
            if (ordered.Length == 1) return ordered[0];
            var rank = percentile * (ordered.Length - 1);
            var lower = (int)Math.Floor(rank);
            var upper = (int)Math.Ceiling(rank);
            if (lower == upper) return ordered[lower];
            var amount = rank - lower;
            return ordered[lower] + (ordered[upper] - ordered[lower]) * amount;
        }
    }
}
