using System;
using System.Diagnostics;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Director;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// Reading the trace (director.ts sample / sampleWrapped / detailForPx): O(1), no allocation, scene time only, linear between
    /// two frames, held at the ends; the detail levels; the cross-fade of a looping scene; and the cost gates (0 B a frame,
    /// microseconds a frame). Builder measurements, never a player's or an evaluator's result.
    /// </summary>
    public sealed class DirectorSamplerTests
    {
        private static DirectorPlan StrikerPlan(string outcome = "dot", string key = "sampler#0.1")
        {
            var d = new TestDelivery(new TestBallSpec { Outcome = outcome });
            DirectorAnchors a = TestAnchors.AsStage(TestAnchors.For(d, DirectorRole.Striker, key, "look-1", false, 40, false, true), TestDelivery.CategoryOf(outcome), true);
            return DirectorCore.Prepare(a);
        }

        [Test]
        public void Sample_ReturnsTheStoredValueExactlyOnAFrame_AndAStraightLineBetweenTwoFrames()
        {
            DirectorPlan plan = StrikerPlan();
            var o = new float[Ch.Count];
            const int k = 100;
            double t = plan.T0 + (k * 1000.0) / plan.Hz;
            DirectorCore.Sample(plan, t, o, 2);
            for (int c = 0; c < Ch.Count; c++) Assert.That(o[c], Is.EqualTo((float)(plan.Trace[k * Ch.Count + c] * Ch.Scale[c])), "channel " + c);
            var mid = new float[Ch.Count];
            DirectorCore.Sample(plan, t + 1000.0 / plan.Hz / 2, mid, 2);
            for (int c = 0; c < Ch.Count; c++)
            {
                double want = ((plan.Trace[k * Ch.Count + c] + plan.Trace[(k + 1) * Ch.Count + c]) / 2.0) * Ch.Scale[c];
                Assert.That(Math.Abs(mid[c] - want), Is.LessThan(1e-4 + Math.Abs(want) * 1e-6), "channel " + c);
            }
        }

        [Test]
        public void Sample_HoldsTheFirstAndLastFrameOutsideTheScript_NoExtrapolationNoNaN()
        {
            DirectorPlan plan = StrikerPlan();
            var first = new float[Ch.Count];
            var before = new float[Ch.Count];
            DirectorCore.Sample(plan, plan.T0, first, 2);
            DirectorCore.Sample(plan, plan.T0 - 5000, before, 2);
            Assert.That(DirectorTestKit.FloatsEqual(first, before), Is.True);
            var last = new float[Ch.Count];
            var after = new float[Ch.Count];
            DirectorCore.Sample(plan, plan.T0 + ((plan.N - 1) * 1000.0) / plan.Hz, last, 2);
            DirectorCore.Sample(plan, plan.T0 + 1e9, after, 2);
            Assert.That(DirectorTestKit.FloatsEqual(last, after), Is.True);
            foreach (float v in after) Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False);
            DirectorCore.Sample(plan, double.NaN, first, 2);
            foreach (float v in first) Assert.That(float.IsNaN(v) || float.IsInfinity(v), Is.False, "a NaN time reads the first frame instead of throwing");
        }

        [Test]
        public void Sample_HonoursTheDetailLevel_ZeroKeepsHeadAndLifeOnly_OneAddsEyesAndLids_TwoAddsExpressions()
        {
            DirectorPlan p = StrikerPlan("four", "detail#0.1");
            double t = 2420 + 700;
            var full = new float[Ch.Count];
            var o = new float[Ch.Count];
            DirectorCore.Sample(p, t, full, 2);
            DirectorCore.Sample(p, t, o, 0);
            for (int c = Ch.EyeYawL; c <= Ch.LidFollow; c++) Assert.That(o[c], Is.EqualTo(0f));
            for (int c = Ch.XConcentration; c <= Ch.XCelebration; c++) Assert.That(o[c], Is.EqualTo(0f));
            Assert.That(o[Ch.HeadYaw], Is.EqualTo(full[Ch.HeadYaw]));
            Assert.That(o[Ch.GazeYaw], Is.EqualTo(full[Ch.GazeYaw]));
            Assert.That(o[Ch.Breath], Is.EqualTo(full[Ch.Breath]));
            DirectorCore.Sample(p, t, o, 1);
            Assert.That(o[Ch.BlinkL], Is.EqualTo(full[Ch.BlinkL]));
            for (int c = Ch.XConcentration; c <= Ch.XCelebration; c++) Assert.That(o[c], Is.EqualTo(0f));
            Assert.That(DirectorTestKit.FloatsEqual(full, Sampled(p, t, 2)), Is.True);
            // the plan's own level is the default
            Assert.That(DirectorTestKit.FloatsEqual(Sampled(p, t, p.Detail), Sampled(p, t, p.Detail)), Is.True);
            var dflt = new float[Ch.Count];
            DirectorCore.Sample(p, t, dflt);
            Assert.That(DirectorTestKit.FloatsEqual(dflt, Sampled(p, t, p.Detail)), Is.True);
        }

        private static float[] Sampled(DirectorPlan p, double t, int detail)
        {
            var o = new float[Ch.Count];
            DirectorCore.Sample(p, t, o, detail);
            return o;
        }

        [Test]
        public void DetailForPx_DropsWhatIsTooSmallToSee_AndDoesNotFlickerAtTheThresholds()
        {
            Assert.That(DirectorCore.DetailForPx(8), Is.EqualTo(0));
            Assert.That(DirectorCore.DetailForPx(20), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(45), Is.EqualTo(2));
            Assert.That(DirectorCore.DetailForPx(12.5, 0), Is.EqualTo(0));
            Assert.That(DirectorCore.DetailForPx(11, 1), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(13.7, 0), Is.EqualTo(0));
            Assert.That(DirectorCore.DetailForPx(13.9, 0), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(43.6, 1), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(43.8, 1), Is.EqualTo(2));
            Assert.That(DirectorCore.DetailForPx(32.4, 2), Is.EqualTo(2));
            Assert.That(DirectorCore.DetailForPx(32.2, 2), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(37, 0), Is.EqualTo(1));
            Assert.That(DirectorCore.DetailForPx(38), Is.EqualTo(2));
        }

        // ------------------------------------------------------------------------------------------------ the looping scene

        private const double Seam = 600;

        private static DirectorPlan Loop(string key, DirectorRole role)
        {
            DirectorAnchors a = TestAnchors.Idle(role, key, 60000);
            a.Start = -Seam;
            a.SeamMs = Seam;
            a.HeadMode = DirectorHeadMode.Space;
            return DirectorCore.Prepare(a);
        }

        [Test]
        public void Wrap_EveryChannelArrivesAtTheValueTheNextLoopStartsFrom_NoStepAtTheWrapBeyondANormalFrame()
        {
            var o = new float[Ch.Count];
            var scratch = new float[Ch.Count];
            var start = new float[Ch.Count];
            double worstStep = 0, worstWrap = 0;
            for (int k = 0; k < 40; k++)
            {
                DirectorPlan p = Loop("wrap#" + k, k % 2 == 1 ? DirectorRole.Bowler : DirectorRole.Striker);
                DirectorCore.SampleWrapped(p, 0, 60000, Seam, start, scratch, p.Detail, null);
                foreach (int c in new[] { Ch.HeadYaw, Ch.HeadPitch, Ch.GazeYaw, Ch.GazePitch, Ch.Breath, Ch.SwayX, Ch.SwayZ, Ch.SwayRoll, Ch.BlinkL, Ch.BlinkR })
                {
                    DirectorCore.SampleWrapped(p, 60000 - 1000.0 / 60, 60000, Seam, o, scratch, p.Detail, null);
                    double before = o[c];
                    DirectorCore.SampleWrapped(p, 60000, 60000, Seam, o, scratch, p.Detail, null);
                    double at = o[c];
                    worstWrap = Math.Max(worstWrap, Math.Abs(at - start[c]));
                    double step = Math.Abs(at - before);
                    worstStep = Math.Max(worstStep, c == Ch.Breath ? step / 0.15 : c == Ch.SwayX || c == Ch.SwayZ ? step / 0.5 : c == Ch.SwayRoll ? step / 0.05 : step / 2);
                }
            }
            Assert.That(worstWrap, Is.LessThan(1e-3));
            Assert.That(worstStep, Is.LessThan(1));
        }

        [Test]
        public void Wrap_IsPlainSampleBeforeTheFade_AndSampleOfThePreRollAtTheEndOfIt()
        {
            DirectorPlan p = Loop("wrap#plain", DirectorRole.Striker);
            var a = new float[Ch.Count];
            var b = new float[Ch.Count];
            var s = new float[Ch.Count];
            DirectorCore.SampleWrapped(p, 30000, 60000, Seam, a, s, p.Detail, null);
            DirectorCore.Sample(p, 30000, b, p.Detail);
            Assert.That(DirectorTestKit.FloatsEqual(a, b), Is.True);
            DirectorCore.SampleWrapped(p, 60000, 60000, Seam, a, s, p.Detail, null);
            DirectorCore.Sample(p, 0, b, p.Detail);
            for (int c = 0; c < Ch.Count; c++) Assert.That(Math.Abs(a[c] - b[c]), Is.LessThan(Ch.Scale[c] * 2 + 1e-6), "channel " + c);
        }

        [Test]
        public void Wrap_NoBlinkIsClosedInTheLastSecondOfTheLoopOrTheFirst300Ms_In200Loops()
        {
            for (int k = 0; k < 200; k++)
            {
                DirectorPlan p = Loop("seam#" + k, k % 2 == 1 ? DirectorRole.Bowler : DirectorRole.Striker);
                for (int i = 0; i < p.N; i++)
                {
                    double tm = DirectorTestKit.TimeOf(p, i);
                    if (tm < 300 || tm > 60000 - 900)
                    {
                        Assert.That(p.Trace[i * Ch.Count + Ch.BlinkL], Is.EqualTo(0), "loop " + k + " t=" + tm);
                        Assert.That(p.Trace[i * Ch.Count + Ch.BlinkR], Is.EqualTo(0), "loop " + k + " t=" + tm);
                    }
                }
            }
        }

        [Test]
        public void Wrap_AFollowingLapFadesIntoItsOwnPreRoll_NotIntoThisOnes()
        {
            DirectorPlan lap0 = Loop("lap#0", DirectorRole.Striker);
            DirectorPlan lap1 = Loop("lap#0.1", DirectorRole.Striker);
            var o = new float[Ch.Count];
            var s = new float[Ch.Count];
            var want = new float[Ch.Count];
            DirectorCore.SampleWrapped(lap0, 60000, 60000, Seam, o, s, 2, lap1);
            DirectorCore.Sample(lap1, 0, want, 2);
            for (int c = 0; c < Ch.Count; c++) Assert.That(Math.Abs(o[c] - want[c]), Is.LessThan(Ch.Scale[c] * 2 + 1e-6), "channel " + c);
            DirectorCore.SampleWrapped(lap0, 59700, 60000, Seam, o, s, 2, lap1);
            var own = new float[Ch.Count];
            DirectorCore.SampleWrapped(lap0, 59700, 60000, Seam, own, s, 2, null);
            Assert.That(DirectorTestKit.FloatsEqual(o, own), Is.False, "the next lap's pre-roll differs from this plan's own");
        }

        // ------------------------------------------------------------------------------------------------ cost

        private static readonly Func<long> AllocatedBytesOfThread = MakeAllocationCounter();

        /// <summary>GC.GetAllocatedBytesForCurrentThread through reflection (the .NET Framework reference profile of the standalone harness does not list it, the runtimes have it).</summary>
        private static Func<long> MakeAllocationCounter()
        {
            System.Reflection.MethodInfo m = typeof(GC).GetMethod("GetAllocatedBytesForCurrentThread", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static, null, Type.EmptyTypes, null);
            return m == null ? null : (Func<long>)Delegate.CreateDelegate(typeof(Func<long>), m);
        }

        /// <summary>Bytes the current thread has allocated so far.</summary>
        internal static long AllocatedBytes()
        {
            return AllocatedBytesOfThread();
        }

        private static bool? exactCounter;

        /// <summary>True where GC.GetAllocatedBytesForCurrentThread exists and sees a known allocation.</summary>
        internal static bool ExactCounterAvailable
        {
            get { return (exactCounter ?? (exactCounter = ExactCounterWorks())).Value; }
        }

        /// <summary>The thread's allocated bytes, or 0 where the exact counter is blind.</summary>
        internal static long TryAllocatedBytes()
        {
            return ExactCounterAvailable ? AllocatedBytesOfThread() : 0;
        }

        internal static void CollectAllocations(System.Reflection.MethodBase m, System.Collections.Generic.HashSet<System.Reflection.MethodBase> seen, System.Collections.Generic.List<string> found)
        {
            AllocatingInstructions(m, seen, found);
        }

        /// <summary>
        /// How allocations are counted here: the exact per-thread counter where the runtime has one that works (a runtime whose counter
        /// reads 0 for a known allocation is a blind counter, as the Unity Editor's Mono is), otherwise the number of generation-0
        /// collections (a loop that allocates even the smallest object per call fills the nursery many times over).
        /// </summary>
        private static bool ExactCounterWorks()
        {
            if (AllocatedBytesOfThread == null) return false;
            var keep = new object[100];
            long c0 = AllocatedBytesOfThread();
            for (int i = 0; i < keep.Length; i++) keep[i] = new float[16];
            long c1 = AllocatedBytesOfThread();
            GC.KeepAlive(keep);
            return c1 - c0 >= 100 * 16 * 4;
        }

        private static bool CollectionCounterWorks()
        {
            int g0 = GC.CollectionCount(0);
            for (int i = 0; i < 40000; i++) GC.KeepAlive(new byte[1024]); // 40 MB
            return GC.CollectionCount(0) > g0;
        }

#if !STANDALONE_HARNESS
        /// <summary>The Unity profiler's managed-heap figure (the third counter: the Editor's Mono has no exact per-thread counter).</summary>
        private static long ProfilerUsedBytes()
        {
            return UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
        }

        private static bool ProfilerCounterWorks()
        {
            var keep = new object[2000];
            long a = ProfilerUsedBytes();
            for (int i = 0; i < keep.Length; i++) keep[i] = new byte[64]; // about 176 KB with the object headers
            long b = ProfilerUsedBytes();
            GC.KeepAlive(keep);
            return b - a >= 100000;
        }
#endif

        [Test]
        public void Cost_SampleAndSampleWrappedAllocateNothingAtRunTime_AndTheCounterUsedSeesARealAllocation()
        {
            DirectorPlan striker = StrikerPlan("six", "cost#0.1");
            DirectorPlan loop = Loop("cost#loop", DirectorRole.Bowler);
            var o = new float[Ch.Count];
            var s = new float[Ch.Count];
            for (int i = 0; i < 20000; i++)
            {
                DirectorCore.Sample(striker, 300 + (i % 7000), o, 2);
                DirectorCore.SampleWrapped(loop, 59000 + (i % 2000), 60000, Seam, o, s, 2, null);
            }
            bool exact = ExactCounterWorks();
            bool collections = CollectionCounterWorks();
            Assert.That(exact || collections, Is.True, "this runtime offers no allocation counter that sees a known allocation: the run-time allocation gate cannot be measured here (the IL test still holds)");
            const int n = 1500000;
#if !STANDALONE_HARNESS
            bool profiler = ProfilerCounterWorks();
            long profiler0 = ProfilerUsedBytes();
#endif
            long bytes0 = exact ? AllocatedBytesOfThread() : 0;
            int gen0 = GC.CollectionCount(0);
            for (int i = 0; i < n; i++)
            {
                DirectorCore.Sample(striker, 300 + (i % 7000) * 1.03, o, 2);
                DirectorCore.SampleWrapped(loop, 59000 + (i % 2000) * 1.01, 60000, Seam, o, s, 2, null);
            }
            long bytes1 = exact ? AllocatedBytesOfThread() : 0;
            int gen1 = GC.CollectionCount(0);
            Console.WriteLine("allocation gate: exact per-thread counter " + (exact ? "works" : "is blind here") + ", generation-0 collection counter " + (collections ? "works" : "is blind here") + "; " + 2 * n + " reads allocated " + (exact ? (bytes1 - bytes0) + " bytes" : "n/a (exact counter blind)") + ", gen-0 collections " + (gen1 - gen0));
#if !STANDALONE_HARNESS
            long profiler1 = ProfilerUsedBytes();
            Console.WriteLine("allocation gate: Unity profiler API (Profiler.GetMonoUsedSizeLong) " + (profiler ? "sees" : "does not see") + " a 176 KB control allocation; managed heap delta over the loop " + (profiler1 - profiler0) + " bytes");
            // a call that allocated even the smallest object (24 bytes) would add 72 MB here; background threads of the Editor add a little
            if (profiler) Assert.That(profiler1 - profiler0, Is.LessThan(1 << 20), "managed heap growth over " + 2 * n + " reads");
#endif
            if (exact) Assert.That(bytes1 - bytes0, Is.EqualTo(0), "bytes allocated by " + 2 * n + " reads");
            if (collections) Assert.That(gen1 - gen0, Is.EqualTo(0), "generation-0 collections during " + 2 * n + " reads (an allocation of even 24 bytes a call would cause dozens)");
        }

        /// <summary>The instructions of a method that can allocate: new object, new array, boxing.</summary>
        private static void AllocatingInstructions(System.Reflection.MethodBase m, System.Collections.Generic.HashSet<System.Reflection.MethodBase> seen, System.Collections.Generic.List<string> found)
        {
            if (!seen.Add(m)) return;
            System.Reflection.MethodBody body = m.GetMethodBody();
            if (body == null) return;
            byte[] il = body.GetILAsByteArray();
            var one = new System.Collections.Generic.Dictionary<short, System.Reflection.Emit.OpCode>();
            foreach (System.Reflection.FieldInfo f in typeof(System.Reflection.Emit.OpCodes).GetFields(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
            {
                var op = (System.Reflection.Emit.OpCode)f.GetValue(null);
                one[op.Value] = op;
            }
            int i = 0;
            while (i < il.Length)
            {
                System.Reflection.Emit.OpCode op;
                if (il[i] == 0xFE)
                {
                    op = one[(short)(0xFE00 | il[i + 1])];
                    i += 2;
                }
                else
                {
                    op = one[il[i]];
                    i += 1;
                }
                int operandAt = i;
                switch (op.OperandType)
                {
                    case System.Reflection.Emit.OperandType.InlineNone: break;
                    case System.Reflection.Emit.OperandType.ShortInlineBrTarget:
                    case System.Reflection.Emit.OperandType.ShortInlineI:
                    case System.Reflection.Emit.OperandType.ShortInlineVar: i += 1; break;
                    case System.Reflection.Emit.OperandType.InlineVar: i += 2; break;
                    case System.Reflection.Emit.OperandType.InlineI8:
                    case System.Reflection.Emit.OperandType.InlineR: i += 8; break;
                    case System.Reflection.Emit.OperandType.InlineSwitch: i += 4 + 4 * BitConverter.ToInt32(il, i); break;
                    default: i += 4; break;
                }
                if (op == System.Reflection.Emit.OpCodes.Newobj || op == System.Reflection.Emit.OpCodes.Newarr || op == System.Reflection.Emit.OpCodes.Box)
                    found.Add(m.DeclaringType.Name + "." + m.Name + ": " + op.Name);
                if (op == System.Reflection.Emit.OpCodes.Call || op == System.Reflection.Emit.OpCodes.Callvirt)
                {
                    System.Reflection.MethodBase callee = m.Module.ResolveMethod(BitConverter.ToInt32(il, operandAt), m.DeclaringType.GetGenericArguments(), null);
                    // arithmetic and the nullable accessors do not allocate
                    Type owner = callee.DeclaringType;
                    if (owner == typeof(Math) || owner == typeof(double) || owner == typeof(float) || (owner.IsGenericType && owner.GetGenericTypeDefinition() == typeof(Nullable<>))) continue;
                    if (callee.DeclaringType.Namespace == m.DeclaringType.Namespace) AllocatingInstructions(callee, seen, found);
                    else found.Add(m.DeclaringType.Name + "." + m.Name + ": calls " + callee.DeclaringType.Name + "." + callee.Name);
                }
            }
        }

        [Test]
        public void Cost_NoInstructionOfSampleOrSampleWrapped_OrAnythingTheyCall_Allocates()
        {
            var found = new System.Collections.Generic.List<string>();
            var seen = new System.Collections.Generic.HashSet<System.Reflection.MethodBase>();
            int scanned = 0;
            foreach (System.Reflection.MethodInfo m in typeof(DirectorCore).GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static))
            {
                if (m.Name != "Sample" && m.Name != "SampleWrapped" && m.Name != "DetailForPx") continue;
                AllocatingInstructions(m, seen, found);
                scanned++;
            }
            Assert.That(scanned, Is.EqualTo(4), "Sample (2 overloads), SampleWrapped, DetailForPx");
            Assert.That(seen.Count, Is.GreaterThanOrEqualTo(5), "the scan reached DirectorMath.Smooth as well");
            Assert.That(found, Is.Empty, "allocating instructions or calls out of the Director on the frame path");
            // the scan is not blind: the same scan finds the allocations of the bake's constructor
            var control = new System.Collections.Generic.List<string>();
            AllocatingInstructions(typeof(DirectorBake).GetConstructors()[0], new System.Collections.Generic.HashSet<System.Reflection.MethodBase>(), control);
            Assert.That(control.Count, Is.GreaterThan(5), "positive control");
        }

        [Test]
        public void Cost_ASampleTakesMicrosecondsNotMilliseconds()
        {
            DirectorPlan striker = StrikerPlan("six", "cost#0.2");
            var o = new float[Ch.Count];
            for (int i = 0; i < 100000; i++) DirectorCore.Sample(striker, 300 + (i % 7000), o, 2);
            double best = double.MaxValue;
            for (int rep = 0; rep < 5; rep++)
            {
                const int n = 1000000;
                var sw = Stopwatch.StartNew();
                for (int i = 0; i < n; i++) DirectorCore.Sample(striker, 300 + (i % 7000) * 1.03, o, 2);
                best = Math.Min(best, sw.Elapsed.TotalMilliseconds * 1e6 / n);
            }
            // the target is 5 microseconds an actor a frame (measured: far under); a loaded shared machine may be slower, so the gate is 10x that
            Assert.That(best, Is.LessThan(50000), "ns per call, best of 5 runs of 1,000,000");
            Console.WriteLine("sample: " + best.ToString("0.0") + " ns per call (best of 5)");
        }
    }
}
