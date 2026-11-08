using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Presentation.Production.Motion
{
    /// <summary>
    /// The bowler's run-up composed from MOTION-BOWL's cleared clips: a C# port of the web's
    /// src/render3d/core/motion/bowlerRunup.ts (itself a port of plan() and compose() in
    /// scripts/blender/motion/bowler_runup.py), kept line for line so both renderers show the same bowler.
    /// bowl_start (top of the mark into a jog, leaving at a foot strike) + N approach strides on the phase-synced gait
    /// loops (bowl_jog, bowl_run, bowl_stride, blended by speed with the stride-consistent weight) + the delivery clip
    /// entered at its entry marker + the follow-through. The plan fits the release exactly to the run-up duration D;
    /// below the shortest standing run-up it is a rolling start (preRoll): the visible run-up opens mid-walk, PreRoll
    /// seconds into the plan, and plays at the clips' own rate 1.0 (the owner's 2026-11-04 rolling start, as the web's
    /// composedBowlerRun). The standing idle is handed over to the clip inertially and the root leaves rest by a smooth
    /// launch (GroundVisible, SampleVisible): no fast-forward, so the cadence is the clips' own. Nothing here changes a
    /// physics time or position: the caller places the composed ground rigidly so the ball in hand is on the physics
    /// release point at the physics release time.
    /// Every clip is sampled through the Unity rig mirror XOR the bowler's own left-arm mirror (MOTION-SPEC v1.3 §3);
    /// the composition is mirror-equivariant, so the ground and heading come out in the rig's frame.
    /// </summary>
    public sealed class ProductionBowlerRunUp
    {
        private const double RMin = 0.9;
        private const double RMax = 1.6;
        private const double HoldMax = 0.7;
        private const double KSpinMin = 0.96;
        private const double KSpinMax = 1.04;
        private const int Fine = 1000;
        private static readonly string[] LoopIds = { "bowl_jog", "bowl_run", "bowl_stride" };
        private static readonly Dictionary<string, ProductionBowlerRunUp> Cache =
            new Dictionary<string, ProductionBowlerRunUp>(StringComparer.Ordinal);

        private sealed class Loop
        {
            public double V;
            public double T;
            public double S;
            public VmpClip Clip;
        }

        public struct RunUpPlan
        {
            public string Action;
            public double K;
            public double D;
            public string Exit;
            public double Phase0;
            public int Steps;
            public double A;
            public double TA;
            public double R;
            public double Lam;
            public double Hold;
            public double PreRoll;
        }

        private readonly bool mirror;
        private readonly Loop[] table;
        private readonly VmpClip start;
        private readonly VmpClip deliveryClip;
        private readonly VmpClip follow;
        private readonly VmpPose scratch;
        private readonly VmpPose scratchB;
        private readonly ProductionCharacterPose poseB = new ProductionCharacterPose();
        private readonly double[] phase = new double[Fine + 1];
        private readonly double[] travel = new double[Fine + 1];
        private readonly double v0;
        private readonly double v1;
        private double hh;
        private double tX0;
        private double entry;
        private double zLoops;
        private Vector3 groundExit;
        private Vector3 deliveryGround0;
        private Vector3 deliveryEndGround;

        public RunUpPlan Plan { get; private set; }
        public double TExit { get; private set; }
        public double TEntry { get; private set; }
        public double TRelease { get; private set; }
        public double TDeliveryEnd { get; private set; }
        public double TEnd { get; private set; }

        private ProductionBowlerRunUp(string action, bool mirror)
        {
            var pack = ProductionMotionPacks.Get("bowler");
            if (pack == null) throw new InvalidOperationException("No bowler pack.");
            this.mirror = mirror;
            var loops = new List<Loop>();
            foreach (var id in LoopIds)
            {
                var clip = pack.GetClip(id);
                loops.Add(new Loop { V = clip.SpeedMps, T = clip.Duration, S = clip.SpeedMps * clip.Duration, Clip = clip });
            }
            loops.Sort((a, b) => a.V.CompareTo(b.V));
            table = loops.ToArray();
            start = pack.GetClip("bowl_start");
            deliveryClip = pack.GetClip(action == "pace" ? "bowl_pace" : action == "off" ? "bowl_off" : "bowl_leg");
            follow = pack.GetClip(action == "pace" ? "bowl_pace_follow"
                : action == "off" ? "bowl_spin_off_follow" : "bowl_spin_leg_follow");
            scratch = new VmpPose(pack.MaxTrackCount);
            scratchB = new VmpPose(pack.MaxTrackCount);
            v0 = pack.GetClip("bowl_jog").SpeedMps;
            v1 = action == "pace" ? pack.GetClip("bowl_stride").SpeedMps : v0;
        }

        /// <summary>
        /// The composed run-up for an action ("pace", "off", "leg") and a run-up start → release of d seconds, or null
        /// when the bowler pack (or one of its clips) is not shipped. Cached per action, side and millisecond.
        /// </summary>
        public static ProductionBowlerRunUp TryCreate(string action, double d, bool leftArm)
        {
            if (action != "pace" && action != "off" && action != "leg") return null;
            var key = action + (leftArm ? "L" : "R") + Math.Round(d * 1000.0).ToString(System.Globalization.CultureInfo.InvariantCulture);
            ProductionBowlerRunUp value;
            if (Cache.TryGetValue(key, out value)) return value;
            value = null;
            try
            {
                var candidate = new ProductionBowlerRunUp(action, ProductionMotionPacks.RigMirror ^ leftArm);
                var plan = candidate.PlanRunUp(d, action, true);
                if (plan.HasValue)
                {
                    candidate.Compose(plan.Value);
                    value = candidate;
                }
            }
            catch (Exception error) when (error is KeyNotFoundException || error is InvalidOperationException ||
                                          error is FormatException || error is ArgumentException)
            {
                Debug.LogWarning("VANDE bowler run-up unavailable: " + error.Message);
                value = null;
            }
            Cache[key] = value;
            return value;
        }

        private static double Smoothstep(double a, double b, double x)
        {
            var t = Math.Min(1.0, Math.Max(0.0, (x - a) / (b - a)));
            return t * t * (3.0 - 2.0 * t);
        }

        private void BlendOf(double v, out Loop a, out Loop b, out double w)
        {
            var last = table[table.Length - 1];
            if (v <= table[0].V)
            {
                a = b = table[0];
                w = 0.0;
                return;
            }
            if (v >= last.V)
            {
                a = b = last;
                w = 0.0;
                return;
            }
            for (var i = 0; i < table.Length - 1; i++)
            {
                var x = table[i];
                var y = table[i + 1];
                if (x.V <= v && v <= y.V)
                {
                    a = x;
                    b = y;
                    w = Math.Max(0.0, Math.Min(1.0, (v * x.T - x.S) / (y.S - x.S - v * (y.T - x.T))));
                    return;
                }
            }
            a = b = last;
            w = 0.0;
        }

        private double CycleT(double v)
        {
            Loop a, b;
            double w;
            BlendOf(v, out a, out b, out w);
            return a.T * (1.0 - w) + b.T * w;
        }

        private double RampV(double t, double tA, double r) => v0 + (v1 - v0) * Smoothstep(tA, tA + r, t);

        private double CyclesOver(double a, double tA, double r, int n)
        {
            if (a <= 0.0) return 0.0;
            var h = a / n;
            var s = 0.0;
            for (var i = 0; i < n; i++) s += h / CycleT(RampV((i + 0.5) * h, tA, r));
            return s;
        }

        private static void PaceRamp(double a, double lam, out double tA, out double r)
        {
            r = Math.Min(RMin + (RMax - RMin) * lam, a);
            tA = lam * Math.Max(0.0, a - r);
        }

        private double PaceA(int n, double lam)
        {
            var lo = 0.05;
            var hi = 6.0;
            for (var k = 0; k < 32; k++)
            {
                var a = 0.5 * (lo + hi);
                double tA, r;
                PaceRamp(a, lam, out tA, out r);
                if (CyclesOver(a, tA, r, 160) * 2.0 < n) lo = a;
                else hi = a;
            }
            return 0.5 * (lo + hi);
        }

        private static float Marker(VmpClip clip, string name, float fallback)
        {
            float value;
            return clip.TryGetMarker(name, out value) ? value : fallback;
        }

        private RunUpPlan? PlanRunUp(double d, string action, bool allowRoll)
        {
            var tau = Marker(deliveryClip, "release", 0.6f);
            var stepJog = table[0].T / 2.0;
            RunUpPlan? best = null;
            var bestScore = double.PositiveInfinity;
            var exits = new[] { ("exitL", 0, 0.0), ("exitR", 1, 0.5) };
            foreach (var (exit, parity, phase0) in exits)
            {
                float tX;
                if (!start.TryGetMarker(exit, out tX)) continue;
                var aStar = d - tX - tau;
                for (var n = parity; n < 40; n += 2)
                {
                    var lam = 0.0;
                    double a;
                    double hold;
                    var k = 1.0;
                    if (action == "pace")
                    {
                        if (n < 2) continue;
                        var a0 = PaceA(n, 0.0);
                        var a1 = PaceA(n, 1.0);
                        if (a1 < RMin) continue;
                        a0 = Math.Max(a0, RMin);
                        if (a0 > aStar + HoldMax + 1e-9) break;
                        if (a0 - 1e-9 <= aStar && aStar <= a1 + 1e-9)
                        {
                            var lo = 0.0;
                            var hi = 1.0;
                            for (var it = 0; it < 26; it++)
                            {
                                var m = 0.5 * (lo + hi);
                                if (PaceA(n, m) < aStar) lo = m;
                                else hi = m;
                            }
                            lam = 0.5 * (lo + hi);
                            a = PaceA(n, lam);
                            hold = Math.Max(0.0, d - tX - tau - a);
                        }
                        else if (aStar > a1 && aStar - a1 <= HoldMax)
                        {
                            lam = 1.0;
                            a = a1;
                            hold = aStar - a1;
                        }
                        else continue;
                    }
                    else
                    {
                        var amin = n * stepJog / KSpinMax;
                        var amax = n * stepJog / KSpinMin;
                        if (amin > aStar + HoldMax + 1e-9) break;
                        if (amin - 1e-9 <= aStar && aStar <= amax + 1e-9)
                        {
                            a = aStar;
                            hold = 0.0;
                        }
                        else if (aStar > amax && aStar - amax <= HoldMax)
                        {
                            a = amax;
                            hold = aStar - amax;
                        }
                        else continue;
                        k = a > 0.0 ? n * stepJog / a : 1.0;
                    }
                    double tA = 0.0, r = 0.0;
                    if (action == "pace") PaceRamp(a, lam, out tA, out r);
                    var score = Math.Round(hold * 1e4) * 1e3 + Math.Round(Math.Abs(k - 1.0) * 1e3);
                    if (best == null || score < bestScore)
                    {
                        bestScore = score;
                        best = new RunUpPlan
                        {
                            Action = action, K = k, D = d, Exit = exit, Phase0 = phase0, Steps = n, A = a, TA = tA, R = r,
                            Lam = lam, Hold = hold, PreRoll = 0.0
                        };
                    }
                }
            }
            if (best != null || !allowRoll) return best;
            // A rolling start: the shortest standing plan, begun before the visible run-up start.
            for (var i = 100; i < 700; i++)
            {
                var trial = i / 100.0;
                if (trial <= d) continue;
                var p = PlanRunUp(trial, action, false);
                if (!p.HasValue) continue;
                var value = p.Value;
                value.PreRoll = trial - d - value.Hold;
                value.Hold = 0.0;
                value.D = d;
                return value;
            }
            return null;
        }

        private double KOf(double t) =>
            Plan.A > 0.0 ? 1.0 + 2.0 * (Plan.K - 1.0) * Math.Pow(Math.Sin(Math.PI * t / Plan.A), 2) : 1.0;

        private void Compose(RunUpPlan plan)
        {
            Plan = plan;
            float exitAt;
            start.TryGetMarker(plan.Exit, out exitAt);
            tX0 = exitAt;
            TExit = plan.Hold + tX0;
            entry = Marker(deliveryClip, "entry", 0f);
            TEntry = TExit + plan.A;
            TRelease = TEntry + (Marker(deliveryClip, "release", 0.6f) - entry);
            TDeliveryEnd = TEntry + (deliveryClip.Duration - entry);
            TEnd = TDeliveryEnd + follow.Duration;
            hh = plan.A / Fine;
            phase[0] = 0.0;
            travel[0] = 0.0;
            for (var i = 0; i < Fine; i++)
            {
                var t = (i + 0.5) * hh;
                var v = action == null ? v0 : RampV(t, plan.TA, plan.R);
                var kt = KOf(t);
                phase[i + 1] = phase[i] + kt * hh / CycleT(v);
                travel[i + 1] = travel[i] + kt * v * hh;
            }
            groundExit = ClipGround(start, tX0);
            zLoops = LoopTravel(plan.A);
            deliveryGround0 = ClipGround(deliveryClip, entry);
            deliveryEndGround = DeliveryGround(TDeliveryEnd);
        }

        private string action => Plan.Action;

        private Vector3 ClipGround(VmpClip clip, double t)
        {
            clip.Sample(t, scratch, 1.0, mirror);
            return new Vector3((float)scratch.GroundX, (float)scratch.GroundYawDeg, (float)scratch.GroundZ);
        }

        private void LoopState(double tl, out double phaseAt, out double travelAt)
        {
            var f = hh > 0.0 ? Math.Max(0.0, Math.Min(Fine, tl / hh)) : 0.0;
            var i = Math.Min(Fine - 1, (int)Math.Floor(f));
            var u = f - i;
            phaseAt = Plan.Phase0 + phase[i] + (phase[i + 1] - phase[i]) * u;
            travelAt = travel[i] + (travel[i + 1] - travel[i]) * u;
        }

        private double LoopTravel(double tl)
        {
            double p, z;
            LoopState(tl, out p, out z);
            return z;
        }

        // Ground as (x, yawDeg, z) in the vector's (x, y, z) slots, to keep it allocation-free.
        private Vector3 DeliveryGround(double t)
        {
            var g = ClipGround(deliveryClip, entry + Math.Min(t, TDeliveryEnd) - TEntry);
            return new Vector3(groundExit.x + g.x - deliveryGround0.x, g.y - deliveryGround0.y,
                (float)(groundExit.z + zLoops + g.z - deliveryGround0.z));
        }

        /// <summary>
        /// The composed ground at composed time t: x and z (m, unscaled, in the rig's frame) and the heading (deg,
        /// + turns +Z towards +X). The loop section travels along +Z.
        /// </summary>
        public void Ground(double t, out float x, out float z, out float yawDeg)
        {
            Vector3 g;
            if (t <= TExit) g = ClipGround(start, Math.Max(0.0, t - Plan.Hold));
            else if (t <= TEntry) g = new Vector3(groundExit.x, 0f, (float)(groundExit.z + LoopTravel(t - TExit)));
            else if (t <= TDeliveryEnd) g = DeliveryGround(t);
            else
            {
                var f = ClipGround(follow, Math.Min(t, TEnd) - TDeliveryEnd);
                var yaw = deliveryEndGround.y * Mathf.Deg2Rad;
                g = new Vector3(
                    deliveryEndGround.x + f.x * Mathf.Cos(yaw) + f.z * Mathf.Sin(yaw),
                    deliveryEndGround.y + f.y,
                    deliveryEndGround.z - f.x * Mathf.Sin(yaw) + f.z * Mathf.Cos(yaw));
            }
            x = g.x;
            z = g.z;
            yawDeg = g.y;
        }

        /// <summary>The composed pose at composed time t (through the rig mirror XOR the bowler's arm).</summary>
        public void Sample(double t, ProductionCharacterPose target)
        {
            if (t <= TExit)
            {
                start.Sample(Math.Max(0.0, t - Plan.Hold), scratch, 1.0, mirror);
                scratch.ApplyTo(target);
                return;
            }
            if (t <= TEntry)
            {
                var tl = t - TExit;
                double phaseAt, travelAt;
                LoopState(tl, out phaseAt, out travelAt);
                Loop a, b;
                double w;
                BlendOf(RampV(tl, Plan.TA, Plan.R), out a, out b, out w);
                a.Clip.Sample(phaseAt * a.T, scratch, 1.0, mirror);
                scratch.ApplyTo(target);
                if (w > 0.0 && a != b)
                {
                    b.Clip.Sample(phaseAt * b.T, scratchB, 1.0, mirror);
                    scratchB.ApplyTo(poseB);
                    ProductionFieldingClips.Blend(target, poseB, (float)w);
                }
                return;
            }
            if (t <= TDeliveryEnd)
            {
                deliveryClip.Sample(entry + t - TEntry, scratch, 1.0, mirror);
                scratch.ApplyTo(target);
                return;
            }
            follow.Sample(Math.Min(t, TEnd) - TDeliveryEnd, scratch, 1.0, mirror);
            scratch.ApplyTo(target);
        }

        // ------------------------------------------------------------------------------------------------------
        // The visible run-up (the owner's 2026-11-04 rolling start; the web's composedBowlerRun, RUN_START)
        // ------------------------------------------------------------------------------------------------------

        /// <summary>
        /// The root leaves rest by a smoothstep share of the clip's own ground speed over this long (s), arriving on
        /// the clip's own ground track at the end of it (the web's RUN_START.launchMs, 0.8 s). The root's peak 0.2 s
        /// acceleration is about 1.5 v / LaunchSeconds, and the ground track is drawn at the body scale (0.95 to 1.12),
        /// so it grows with the bowler's size. Measured on the twelve cases of BowlerPresentationGateTests: at 0.8 s
        /// 5.3 to 6.4 m/s² (6.2 for a nominal 1.08 pace body, over the 6 m/s² gate), at 0.9 s 4.7 to 5.6, at 1.0 s 4.2 to
        /// 5.1; the old fast-forward made 11 to 14. The web's own plans measure 3.9 to 5.3 m/s² at 0.8 s (BOWLER-1,
        /// GATES-after.md), so Unity takes 0.9 s: the one deliberate difference from the web's RUN_START (lead ruling
        /// 2026-11-07: Unity keeps 0.9 s, the web keeps 0.8 s; the reason is the body-scale growth above, so it holds
        /// until the Unity ground track is drawn at the web's scale).
        /// </summary>
        public const double LaunchSeconds = 0.9;

        /// <summary>
        /// The standing idle pose hands over to the clip by an inertialization of this length (s) (the web's
        /// RUN_START.inertialMs): the difference between the two decays by a critically damped curve, with the clip's
        /// own velocity continuing the idle's, so no bone steps on the first frame.
        /// </summary>
        public const double InertialSeconds = 0.3;

        private const double HandOverFrameSeconds = 1.0 / 60.0;

        /// <summary>The visible time (s) of the release: the plan's D, to the microsecond.</summary>
        public double VisibleRelease => TRelease - Plan.PreRoll;

        /// <summary>
        /// Visible run-up time (0 = the visible start) to composed time. A rolling start's lead-in is skipped, not
        /// fast-forwarded: the clips play at their own rate 1.0 from PreRoll seconds in, so the cadence is the clips'
        /// own and the release still lands at visible D.
        /// </summary>
        public double ComposedTime(double visibleSeconds) => Math.Max(0.0, visibleSeconds) + Plan.PreRoll;

        private double LaunchEnd => Math.Min(LaunchSeconds, Math.Max(0.0, TEnd - Plan.PreRoll - 0.001));

        private double LaunchShare(double visible)
        {
            var end = LaunchEnd;
            var u = end > 0.0 ? Math.Min(1.0, Math.Max(0.0, visible / end)) : 1.0;
            return u * u * (3.0 - 2.0 * u);
        }

        /// <summary>The clip's ground speed (m/s, unscaled) at a visible time, by a central difference.</summary>
        private double TrackSpeed(double visible)
        {
            var from = Math.Max(0.0, visible - 0.006);
            var to = visible + 0.006;
            float ax, az, ay, bx, bz, by;
            Ground(ComposedTime(from), out ax, out az, out ay);
            Ground(ComposedTime(to), out bx, out bz, out by);
            var dx = bx - ax;
            var dz = bz - az;
            return Math.Sqrt(dx * dx + dz * dz) / (to - from);
        }

        /// <summary>
        /// The distance (m, unscaled) the root stands ahead of the clip's own ground track at the start of the run-up,
        /// and how it closes: the integral from a visible time to the end of the launch of the clip's ground speed
        /// times the share of it the root has not yet reached (the web's lag()), along the track's direction. It is
        /// tabulated once per run-up, every LagStepSeconds (trapezoid), so a frame costs one lookup, not fifty clip
        /// samples. The direction is the track's over a 0.4 s window around the time: the ground is stored to 1 mm, so
        /// a difference over 20 ms would swing a metre of lag by degrees and the root's speed by metres per second.
        /// Zero from the end of the launch.
        /// </summary>
        private void LaunchLagAt(double visible, out float x, out float z)
        {
            var end = LaunchEnd;
            if (visible >= end)
            {
                x = 0f;
                z = 0f;
                return;
            }
            EnsureLaunchLag(end);
            var index = Math.Min(launchLagX.Length - 2, (int)(visible / LagStepSeconds));
            var from = index * LagStepSeconds;
            var to = Math.Min(end, (index + 1) * LagStepSeconds);
            var u = (float)(to > from ? (visible - from) / (to - from) : 0.0);
            x = launchLagX[index] + (launchLagX[index + 1] - launchLagX[index]) * u;
            z = launchLagZ[index] + (launchLagZ[index + 1] - launchLagZ[index]) * u;
        }

        private const double LagStepSeconds = 0.005;
        private float[] launchLagX;
        private float[] launchLagZ;

        private void EnsureLaunchLag(double end)
        {
            if (launchLagX != null) return;
            var n = Math.Max(1, (int)Math.Ceiling(end / LagStepSeconds));
            var rate = new double[n + 1];
            for (var i = 0; i <= n; i++)
            {
                var at = Math.Min(end, i * LagStepSeconds);
                rate[i] = TrackSpeed(at) * (1.0 - LaunchShare(at));
            }
            var x = new float[n + 1];
            var z = new float[n + 1];
            var lag = 0.0;
            for (var i = n; i >= 0; i--)
            {
                if (i < n)
                    lag += 0.5 * (rate[i] + rate[i + 1]) * (Math.Min(end, (i + 1) * LagStepSeconds) - i * LagStepSeconds);
                double dx, dz;
                TrackDirection(Math.Min(end, i * LagStepSeconds), out dx, out dz);
                x[i] = (float)(dx * lag);
                z[i] = (float)(dz * lag);
            }
            launchLagZ = z;
            launchLagX = x;
        }

        /// <summary>The unit direction of the clip's ground track around a visible time, over a 0.4 s window.</summary>
        private void TrackDirection(double visible, out double dx, out double dz)
        {
            float ax, az, ay, bx, bz, by;
            Ground(ComposedTime(Math.Max(0.0, visible - 0.2)), out ax, out az, out ay);
            Ground(ComposedTime(visible + 0.2), out bx, out bz, out by);
            var length = Math.Sqrt((double)(bx - ax) * (bx - ax) + (double)(bz - az) * (bz - az));
            if (length < 1e-6)
            {
                dx = 0.0;
                dz = 1.0;
                return;
            }
            dx = (bx - ax) / length;
            dz = (bz - az) / length;
        }

        /// <summary>
        /// The root at a visible time (x and z in m, unscaled, in the rig's frame; the heading in degrees): the clip's
        /// ground track, less the launch's lag along the track's direction. The root leaves rest by a smoothstep share
        /// of the clip's speed, so it never steps in speed; from LaunchSeconds on it is Ground(ComposedTime(t)).
        /// </summary>
        public void GroundVisible(double visibleSeconds, out float x, out float z, out float yawDeg)
        {
            var visible = Math.Max(0.0, visibleSeconds);
            float px, pz, lagX, lagZ;
            Ground(ComposedTime(visible), out px, out pz, out yawDeg);
            LaunchLagAt(visible, out lagX, out lagZ);
            x = px + lagX;
            z = pz + lagZ;
        }

        /// <summary>
        /// The composed pose at a visible time, with the hand-over: the standing idle (the code-authored Idle, the pose
        /// he waits in between balls) is inertialized into the clip over InertialSeconds. From then on it is
        /// Sample(ComposedTime(t)).
        /// </summary>
        public void SampleVisible(double visibleSeconds, ProductionCharacterPose target)
        {
            var visible = Math.Max(0.0, visibleSeconds);
            Sample(ComposedTime(visible), target);
            if (visible >= InertialSeconds) return;
            EnsureHandOver();
            var omega = 6.6 / InertialSeconds;
            var decay = Math.Exp(-omega * visible);
            for (var joint = 0; joint < handOverNow.Length; joint++)
            {
                var offset = Decayed(handOverNow[joint], handOverBefore[joint], visible, omega, decay);
                target.Rotations[joint] = FromRotationVector(offset) * target.Rotations[joint];
            }
            target.RootOffset += Decayed(handOverRootNow, handOverRootBefore, visible, omega, decay);
        }

        private Vector3[] handOverNow;
        private Vector3[] handOverBefore;
        private Vector3 handOverRootNow;
        private Vector3 handOverRootBefore;

        /// <summary>
        /// The idle-to-clip offsets at the switch (the clip at the visible start) and one frame before it, as rotation
        /// vectors per bone (idle · clip⁻¹) and a root vector: the web's applyInertia inputs, with the idle at rest.
        /// </summary>
        private void EnsureHandOver()
        {
            if (handOverNow != null) return;
            var stand = new ProductionCharacterPose();
            ProductionFieldingClips.Sample(ProductionFieldingClip.Idle, 0.0, stand);
            var now = new ProductionCharacterPose();
            var before = new ProductionCharacterPose();
            Sample(ComposedTime(0.0), now);
            Sample(Math.Max(0.0, Plan.PreRoll - HandOverFrameSeconds), before);
            var nowVectors = new Vector3[(int)ProductionCharacterJoint.Count];
            var beforeVectors = new Vector3[nowVectors.Length];
            for (var joint = 0; joint < nowVectors.Length; joint++)
            {
                nowVectors[joint] = RotationVector(stand.Rotations[joint] * Quaternion.Inverse(now.Rotations[joint]));
                beforeVectors[joint] = RotationVector(stand.Rotations[joint] * Quaternion.Inverse(before.Rotations[joint]));
            }
            handOverRootNow = stand.RootOffset - now.RootOffset;
            handOverRootBefore = stand.RootOffset - before.RootOffset;
            handOverBefore = beforeVectors;
            handOverNow = nowVectors;
        }

        /// <summary>x(τ) = (x0 + (v0 + ω x0) τ) e^(−ωτ), v0 the offset's rate at the switch (one frame back).</summary>
        private static Vector3 Decayed(Vector3 now, Vector3 before, double tau, double omega, double decay)
        {
            var rate = (now - before) / (float)HandOverFrameSeconds;
            return (now + (rate + (float)omega * now) * (float)tau) * (float)decay;
        }

        /// <summary>A rotation as axis × angle (the shortest way round).</summary>
        private static Vector3 RotationVector(Quaternion q)
        {
            double x = q.x, y = q.y, z = q.z, w = q.w;
            if (w < 0.0)
            {
                x = -x;
                y = -y;
                z = -z;
                w = -w;
            }
            var s = Math.Sqrt(x * x + y * y + z * z);
            var k = s > 1e-9 ? 2.0 * Math.Atan2(s, w) / s : 2.0;
            return new Vector3((float)(x * k), (float)(y * k), (float)(z * k));
        }

        private static Quaternion FromRotationVector(Vector3 r)
        {
            var angle = Math.Sqrt((double)r.x * r.x + (double)r.y * r.y + (double)r.z * r.z);
            if (angle < 1e-7) return Quaternion.identity;
            var s = Math.Sin(angle * 0.5) / angle;
            return new Quaternion((float)(r.x * s), (float)(r.y * s), (float)(r.z * s), (float)Math.Cos(angle * 0.5));
        }
    }
}
