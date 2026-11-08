using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// What the Director costs on this machine: the sampler per actor per frame, the plan builder, a delivery plan, a 60 s scene
    /// between balls, and one 64-step slice of the sliced bake. Builder timings of whatever runtime runs the test (the Unity Editor's
    /// Mono on this Mac, or the standalone Mono): Android and IL2CPP are UNPROVEN until a phone measures them. The bounds asserted are
    /// deliberately loose (they catch a broken algorithm, not a busy machine); the numbers are written to
    /// $VANDE_DIRECTOR_OUT/perf.txt when that variable is set (the wrapper script records `uptime` beside them).
    /// </summary>
    public sealed class DirectorPerformanceTests
    {
        private static double Median(List<double> xs)
        {
            var a = xs.ToArray();
            Array.Sort(a);
            return a[a.Length / 2];
        }

        private static double Quantile(List<double> xs, double q)
        {
            var a = xs.ToArray();
            Array.Sort(a);
            return a[Math.Min(a.Length - 1, (int)(q * a.Length))];
        }

        private static string Ms(double v)
        {
            return v.ToString("0.000", CultureInfo.InvariantCulture);
        }

        private static DirectorAnchors DeliveryAnchors(DirectorRole role, string key, string outcome)
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = outcome });
            return TestAnchors.AsStage(TestAnchors.For(d, role, key, "look-1", false, 40, false, true, "real", DirectorFixtures.Series["pace"]), TestDelivery.CategoryOf(outcome), true);
        }

        private static DirectorAnchors IdleAnchors(DirectorRole role, string key, double ms)
        {
            DirectorAnchors a = TestAnchors.Idle(role, key, ms);
            a.Start = -600;
            a.SeamMs = 600;
            a.HeadMode = DirectorHeadMode.Space;
            return a;
        }

        /// <summary>Wall time of a full Prepare in ms, over <paramref name="runs"/> runs after <paramref name="warm"/> warm-ups.</summary>
        private static List<double> TimePrepare(DirectorAnchors a, int warm, int runs)
        {
            for (int i = 0; i < warm; i++) DirectorCore.Prepare(a);
            var t = new List<double>();
            for (int i = 0; i < runs; i++)
            {
                long t0 = Stopwatch.GetTimestamp();
                DirectorCore.Prepare(a);
                t.Add((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency);
            }
            return t;
        }

        /// <summary>The duration in ms of each slice of a sliced bake, pooled over several runs.</summary>
        private static List<double> TimeSlices(DirectorAnchors a, int runs, out int slicesPerRun, out double startMs)
        {
            var all = new List<double>();
            slicesPerRun = 0;
            var starts = new List<double>();
            for (int r = 0; r < runs + 3; r++)
            {
                long s0 = Stopwatch.GetTimestamp();
                PlanJob job = DirectorCore.StartPrepare(a);
                double start = (Stopwatch.GetTimestamp() - s0) * 1000.0 / Stopwatch.Frequency;
                int n = 0;
                var mine = new List<double>();
                while (!job.Done)
                {
                    long t0 = Stopwatch.GetTimestamp();
                    job.Advance(1);
                    mine.Add((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency);
                    n++;
                }
                if (r >= 3)
                {
                    all.AddRange(mine);
                    starts.Add(start);
                    slicesPerRun = n;
                }
            }
            startMs = Median(starts);
            return all;
        }

        [Test]
        public void Performance_IsMeasured_AndInsideLooseBounds()
        {
            var sb = new StringBuilder();
            sb.Append("Director performance (builder timings, this runtime only; Android / IL2CPP UNPROVEN)\n");
            sb.Append("runtime: ").Append(Environment.Version).Append(", ").Append(IntPtr.Size * 8).Append("-bit, ").Append(Environment.ProcessorCount).Append(" logical processors, ").Append(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)).Append("\n");

            // the sampler
            DirectorPlan striker = DirectorCore.Prepare(DeliveryAnchors(DirectorRole.Striker, "perf#0.1", "six"));
            DirectorPlan bowler = DirectorCore.Prepare(DeliveryAnchors(DirectorRole.Bowler, "perf#0.1", "six"));
            DirectorPlan loop = DirectorCore.Prepare(IdleAnchors(DirectorRole.Striker, "perf|idle.1", 60000));
            var o = new float[Ch.Count];
            var s = new float[Ch.Count];
            for (int i = 0; i < 200000; i++)
            {
                DirectorCore.Sample(striker, 300 + (i % 7000), o, 2);
                DirectorCore.Sample(bowler, 300 + (i % 7000), o, 2);
                DirectorCore.SampleWrapped(loop, 59000 + (i % 2000), 60000, 600, o, s, 2, null);
            }
            double sampleBest = double.MaxValue, bowlerBest = double.MaxValue, wrapBest = double.MaxValue;
            var sampleRuns = new List<double>();
            const int n = 1000000;
            for (int rep = 0; rep < 7; rep++)
            {
                long t0 = Stopwatch.GetTimestamp();
                for (int i = 0; i < n; i++) DirectorCore.Sample(striker, 300 + (i % 7000) * 1.03, o, 2);
                double a = (Stopwatch.GetTimestamp() - t0) * 1e9 / Stopwatch.Frequency / n;
                sampleRuns.Add(a);
                sampleBest = Math.Min(sampleBest, a);
                t0 = Stopwatch.GetTimestamp();
                for (int i = 0; i < n; i++) DirectorCore.Sample(bowler, 300 + (i % 7000) * 1.03, o, 2);
                bowlerBest = Math.Min(bowlerBest, (Stopwatch.GetTimestamp() - t0) * 1e9 / Stopwatch.Frequency / n);
                t0 = Stopwatch.GetTimestamp();
                for (int i = 0; i < n; i++) DirectorCore.SampleWrapped(loop, 59000 + (i % 2000) * 1.01, 60000, 600, o, s, 2, null);
                wrapBest = Math.Min(wrapBest, (Stopwatch.GetTimestamp() - t0) * 1e9 / Stopwatch.Frequency / n);
            }
            sb.Append("sample (24 channels, detail 2): striker ").Append(sampleBest.ToString("0.0", CultureInfo.InvariantCulture)).Append(" ns, bowler ").Append(bowlerBest.ToString("0.0", CultureInfo.InvariantCulture)).Append(" ns per call (best of 7 runs of 1,000,000; median of runs ").Append(Median(sampleRuns).ToString("0.0", CultureInfo.InvariantCulture)).Append(" ns); sampleWrapped in the fade ").Append(wrapBest.ToString("0.0", CultureInfo.InvariantCulture)).Append(" ns. Target: 5,000 ns per actor per frame.\n");

            // the plan builder (events only)
            DirectorAnchors dA = DeliveryAnchors(DirectorRole.Striker, "perf#0.2", "six");
            DirectorAnchors iA = IdleAnchors(DirectorRole.Bowler, "perf|idle.2", 60000);
            for (int i = 0; i < 50; i++)
            {
                DirectorPlanBuilder.Build(dA);
                DirectorPlanBuilder.Build(iA);
            }
            var tb = new List<double>();
            for (int i = 0; i < 200; i++)
            {
                long t0 = Stopwatch.GetTimestamp();
                DirectorPlanBuilder.Build(dA);
                tb.Add((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency);
            }
            var ti = new List<double>();
            for (int i = 0; i < 50; i++)
            {
                long t0 = Stopwatch.GetTimestamp();
                DirectorPlanBuilder.Build(iA);
                ti.Add((Stopwatch.GetTimestamp() - t0) * 1000.0 / Stopwatch.Frequency);
            }
            sb.Append("events (BuildEvents, no trace): delivery median ").Append(Ms(Median(tb))).Append(" ms, 60 s scene median ").Append(Ms(Median(ti))).Append(" ms\n");

            // the bake, in one go
            var bakeStriker = TimePrepare(DeliveryAnchors(DirectorRole.Striker, "perf#0.3", "six"), 10, 40);
            var bakeBowler = TimePrepare(DeliveryAnchors(DirectorRole.Bowler, "perf#0.3", "six"), 10, 40);
            var bakeIdle = TimePrepare(IdleAnchors(DirectorRole.Striker, "perf|idle.3", 60000), 3, 15);
            DirectorPlan sp = DirectorCore.Prepare(DeliveryAnchors(DirectorRole.Striker, "perf#0.3", "six"));
            sb.Append("Prepare (events + whole bake, 60 Hz, 'space' mode): striker delivery (").Append(sp.N).Append(" frames, ").Append(sp.N * 1000.0 / 60 / 1000).Append(" s of script) median ").Append(Ms(Median(bakeStriker))).Append(" ms (p95 ").Append(Ms(Quantile(bakeStriker, 0.95))).Append("), bowler delivery median ").Append(Ms(Median(bakeBowler))).Append(" ms (p95 ").Append(Ms(Quantile(bakeBowler, 0.95))).Append("), 60 s scene between balls (").Append(loop.N).Append(" frames) median ").Append(Ms(Median(bakeIdle))).Append(" ms (p95 ").Append(Ms(Quantile(bakeIdle, 0.95))).Append(")\n");

            // one slice
            int slices;
            double startMs;
            List<double> sliceTimes = TimeSlices(DeliveryAnchors(DirectorRole.Striker, "perf#0.4", "six"), 25, out slices, out startMs);
            sb.Append("sliced bake of a striker delivery: StartPrepare (events + buffers) median ").Append(Ms(startMs)).Append(" ms; ").Append(slices).Append(" slices a plan; one 64-step slice: median ").Append(Ms(Median(sliceTimes))).Append(" ms, p95 ").Append(Ms(Quantile(sliceTimes, 0.95))).Append(" ms, max ").Append(Ms(Quantile(sliceTimes, 1.0))).Append(" ms (over ").Append(sliceTimes.Count).Append(" slices). Target: at most 2 ms a slice on this Mac.\n");
            int idleSlices;
            double idleStart;
            List<double> idleSliceTimes = TimeSlices(IdleAnchors(DirectorRole.Bowler, "perf|idle.4", 60000), 5, out idleSlices, out idleStart);
            sb.Append("sliced bake of a 60 s scene: StartPrepare median ").Append(Ms(idleStart)).Append(" ms; ").Append(idleSlices).Append(" slices; one slice median ").Append(Ms(Median(idleSliceTimes))).Append(" ms, p95 ").Append(Ms(Quantile(idleSliceTimes, 0.95))).Append(" ms, max ").Append(Ms(Quantile(idleSliceTimes, 1.0))).Append(" ms\n");

            // memory
            DirectorPlan idlePlan = loop;
            sb.Append("memory: delivery trace ").Append(sp.Trace.Length * 2).Append(" B (").Append(sp.N).Append(" frames x 24 x 2), events ").Append((sp.Fix.Length + sp.Blink.Length + sp.Micro.Length + sp.Fidget.Length + sp.React.Length + sp.Draw.Length + sp.Amp.Length) * 4).Append(" B; 60 s scene trace ").Append(idlePlan.Trace.Length * 2).Append(" B, events ").Append((idlePlan.Fix.Length + idlePlan.Blink.Length + idlePlan.Micro.Length + idlePlan.Fidget.Length + idlePlan.React.Length + idlePlan.Draw.Length + idlePlan.Amp.Length) * 4).Append(" B\n");

            string text = sb.ToString();
            Console.Write(text);
            string dir = Environment.GetEnvironmentVariable("VANDE_DIRECTOR_OUT");
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
                File.WriteAllText(Path.Combine(dir, "perf.txt"), text);
            }

            Assert.That(sampleBest, Is.LessThan(50000), "sample: ns per call");
            Assert.That(bowlerBest, Is.LessThan(50000), "sample (bowler): ns per call");
            Assert.That(Quantile(sliceTimes, 0.95), Is.LessThan(50), "one slice, p95 ms");
            Assert.That(Median(bakeStriker), Is.LessThan(250), "a delivery plan, ms");
            Assert.That(Median(bakeIdle), Is.LessThan(1000), "a 60 s scene plan, ms");
        }
    }
}
