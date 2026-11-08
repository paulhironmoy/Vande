using System;
using P = Vande.Practice.Presentation.Production.Director.DirectorParams;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>Small numeric helpers whose JavaScript semantics the port must reproduce exactly.</summary>
    public static class DirectorMath
    {
        /// <summary>
        /// JavaScript's Math.round: the integer closest to x, and for a tie the one closer to +infinity (so -2.5 rounds to -2, not
        /// to -2 by the banker's rule of Math.Round). Exact for every double (no x + 0.5, which is wrong just below 0.5).
        /// </summary>
        public static double JsRound(double x)
        {
            if (double.IsNaN(x) || double.IsInfinity(x)) return x;
            double f = Math.Floor(x);
            return x - f >= 0.5 ? f + 1 : f;
        }

        /// <summary>floor(a / b) for integers (C# integer division truncates towards zero).</summary>
        public static int FloorDiv(int a, int b)
        {
            int q = a / b;
            return (a % b != 0 && ((a < 0) != (b < 0))) ? q - 1 : q;
        }

        /// <summary>smoothstep, clamped: 3x^2 - 2x^3.</summary>
        public static double Smooth(double x)
        {
            return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
        }
    }

    /// <summary>
    /// A plan being baked a slice at a time (off the frame path, in the spare time of frames): see
    /// <see cref="DirectorCore.StartPrepare"/>. The plan is the same, bit for bit, however it is sliced and whether it is sliced
    /// at all. A slice is 64 integration steps (about 267 ms of script) or 32 clip-head reads; the caller decides how many to run
    /// per frame (the Director itself reads no clock).
    /// </summary>
    public sealed class PlanJob
    {
        private readonly DirectorBake bake;
        private readonly DirectorPlan partial;
        private readonly double start;
        private readonly int hz;
        private readonly int sub;
        private readonly int frames;
        private bool done;
        // Frames 0 .. final are final: the copied ones, and those written at a step already done.
        private int final;

        internal PlanJob(DirectorBake bake, DirectorPlan partial, double start, int hz)
        {
            this.bake = bake;
            this.partial = partial;
            this.start = start;
            this.hz = hz;
            sub = bake.StepsPerFrame;
            frames = bake.Frames;
            final = bake.KeptFrames - 1;
        }

        /// <summary>True once the plan is ready.</summary>
        public bool Done
        {
            get { return done; }
        }

        /// <summary>The finished plan; null until <see cref="Done"/>.</summary>
        public DirectorPlan Plan
        {
            get { return done ? partial : null; }
        }

        /// <summary>
        /// The plan being filled in: the same object as <see cref="Plan"/> once done. Its events and parameters are final from the
        /// start and its trace is final up to <see cref="HorizonMs"/>; Sample is exact for any time before the horizon and holds zeros after it.
        /// </summary>
        public DirectorPlan Partial
        {
            get { return partial; }
        }

        /// <summary>Scene time before which <see cref="Partial"/> is final (a sample there is bit-equal to the finished plan's); infinite once done.</summary>
        public double HorizonMs
        {
            get
            {
                // Sample at t reads frames floor(f) and floor(f) + 1, f = (t - t0) hz / 1000: both final when floor(f) + 1 <= final.
                return done ? double.PositiveInfinity : start + (Math.Max(0, final) * 1000.0) / hz;
            }
        }

        /// <summary>Runs up to <paramref name="slices"/> slices of the bake and returns true once it is done.</summary>
        public bool Advance(int slices)
        {
            for (int i = 0; !done && i < slices; i++)
            {
                if (bake.RunSlice())
                {
                    done = true;
                    final = frames - 1;
                }
                else
                {
                    // the steps below ProgressStep are done: the frames written at them are final
                    final = Math.Max(final, DirectorMath.FloorDiv(bake.ProgressStep - 1, sub));
                }
            }
            return done;
        }

        /// <summary>Runs slices until the plan is final before scene time <paramref name="tMs"/> (or done); the number of slices it ran.</summary>
        public int AdvanceTo(double tMs)
        {
            int ran = 0;
            while (!done && HorizonMs <= tMs)
            {
                Advance(1);
                ran++;
            }
            return ran;
        }
    }

    /// <summary>
    /// The Director's entry points (director.ts): <see cref="Prepare"/> / <see cref="StartPrepare"/> off the frame path (idle, or the
    /// run-up), <see cref="Sample(DirectorPlan, double, float[], int)"/> once per drawn frame (O(1), no allocation, scene time only). A pure function of (person,
    /// delivery key, anchors, scene time): no clock, no random source, no frame count. Replays rebuild the plan from the same key
    /// and anchors and give the same trace, bit for bit in the same engine.
    /// </summary>
    public static class DirectorCore
    {
        /// <summary>The contract this port reproduces (golden.json "contract").</summary>
        public const string Contract = "director/3";

        /// <summary>
        /// The detail level for a head of <paramref name="px"/> CSS pixels (hysteresis against <paramref name="prev"/> when it is 0..2;
        /// pass -1 for none): a level is entered only 15% above its threshold and left only 15% below it.
        /// </summary>
        public static int DetailForPx(double px, int prev = -1)
        {
            double lo = P.Detail.Px[0];
            double hi = P.Detail.Px[1];
            double h = P.Detail.Hyst;
            double up1 = prev < 0 ? lo : prev >= 1 ? lo * (1 - h) : lo * (1 + h);
            double up2 = prev < 0 ? hi : prev >= 2 ? hi * (1 - h) : hi * (1 + h);
            return px >= up2 ? 2 : px >= up1 ? 1 : 0;
        }

        /// <summary>
        /// Starts baking a plan: the events are built now (a few microseconds), the trace a slice at a time by
        /// <see cref="PlanJob.Advance"/>. <paramref name="reusePlan"/> (optional) is the hand-over from the live script to the result
        /// script: frames before <paramref name="reuseUntilMs"/> are copied from the earlier plan instead of being computed; it must not
        /// exceed the first moment the new anchors matter (the earliest of contact + 125, outcomeAt + 180, dead + 125, strokeEnd) and
        /// is ignored if the earlier plan has another rate or start. <paramref name="into"/> (optional) is the caller's own
        /// trace array, n * 24 long (it is cleared).
        /// </summary>
        public static PlanJob StartPrepare(DirectorAnchors a, int hz = 60, DirectorPlan reusePlan = null, double reuseUntilMs = 0, short[] into = null)
        {
            DirectorEvents ev = DirectorPlanBuilder.Build(a);
            short[] reuseTrace = reusePlan != null && reusePlan.Hz == hz && reusePlan.T0 == a.Start ? reusePlan.Trace : null;
            var bake = new DirectorBake(a, ev, hz, reuseTrace, reuseUntilMs, into);
            var plan = new DirectorPlan
            {
                Fix = ev.Fix,
                Blink = ev.Blink,
                Micro = ev.Micro,
                Fidget = ev.Fidget,
                React = ev.React,
                Draw = ev.Draw,
                Amp = ev.Amp,
                Role = a.Role,
                Key = DirectorSeeds.BallKey(a.Key, DirectorSeeds.PersonKey(a.Person, a.Role)),
                ReducedMotion = a.ReducedMotion,
                T0 = a.Start,
                Hz = hz,
                N = bake.Frames,
                Trace = bake.Trace,
                Detail = DetailForPx(a.HeadPx),
            };
            return new PlanJob(bake, plan, a.Start, hz);
        }

        /// <summary>Builds the plan and bakes its trace (<paramref name="hz"/>: trace frames per second, 60, 120 or 240) in one go.</summary>
        public static DirectorPlan Prepare(DirectorAnchors a, int hz = 60, DirectorPlan reusePlan = null, double reuseUntilMs = 0)
        {
            PlanJob job = StartPrepare(a, hz, reusePlan, reuseUntilMs);
            while (!job.Advance(1 << 20))
            {
                // Advance runs to the end.
            }
            return job.Plan;
        }

        /// <summary>
        /// Reads the trace at scene ms <paramref name="tMs"/> into <paramref name="output"/> (24 floats, see <see cref="DirectorChannels"/>):
        /// linear between two frames, held at the ends. <paramref name="detail"/> drops what is too small to see: 0 keeps the head
        /// and life only, 1 adds the eyes and lids, 2 the expressions. O(1), no allocation.
        /// </summary>
        public static void Sample(DirectorPlan plan, double tMs, float[] output, int detail)
        {
            int last = plan.N - 1;
            double f = ((tMs - plan.T0) * plan.Hz) / 1000;
            // (a time that is NaN reads the first frame; the web would return NaN)
            f = f < 0 ? 0 : f > last ? last : f;
            if (!(f >= 0)) f = 0;
            int i = (int)f;
            if (i >= last) i = last > 0 ? last - 1 : 0;
            double w = last > 0 ? f - i : 0;
            int a = i * DirectorChannels.Count;
            int b = last > 0 ? a + DirectorChannels.Count : a;
            short[] tr = plan.Trace;
            double[] scale = DirectorChannels.Scale;
            for (int c = 0; c < DirectorChannels.Count; c++) output[c] = (float)((tr[a + c] + (tr[b + c] - tr[a + c]) * w) * scale[c]);
            if (detail < 2) for (int c = DirectorChannels.XConcentration; c <= DirectorChannels.XCelebration; c++) output[c] = 0;
            if (detail < 1) for (int c = DirectorChannels.EyeYawL; c <= DirectorChannels.LidFollow; c++) output[c] = 0;
        }

        /// <summary><see cref="Sample(DirectorPlan, double, float[], int)"/> at the plan's own detail level.</summary>
        public static void Sample(DirectorPlan plan, double tMs, float[] output)
        {
            Sample(plan, tMs, output, plan.Detail);
        }

        /// <summary>
        /// Sample for a script that loops at <paramref name="loopMs"/> (a between-balls scene): in the last <paramref name="fadeMs"/> of the loop
        /// the trace is cross-faded into the pre-roll before its start (a plan with SeamMs and Start = -SeamMs), so every channel
        /// reaches the value the next loop starts from and nothing pops at the wrap. <paramref name="scratch"/> holds the second read
        /// (24 floats). <paramref name="next"/> is the plan of the following lap, whose pre-roll the end of this one is faded into
        /// (null: this plan's own, so a scene that stands for a minute repeats; with it, it never repeats).
        /// </summary>
        public static void SampleWrapped(DirectorPlan plan, double tMs, double loopMs, double fadeMs, float[] output, float[] scratch, int detail, DirectorPlan next)
        {
            Sample(plan, tMs, output, detail);
            if (tMs <= loopMs - fadeMs) return;
            Sample(next ?? plan, tMs - loopMs, scratch, detail);
            double w = DirectorMath.Smooth((tMs - (loopMs - fadeMs)) / fadeMs);
            for (int c = 0; c < DirectorChannels.Count; c++) output[c] = (float)(output[c] + ((double)scratch[c] - output[c]) * w);
        }
    }
}
