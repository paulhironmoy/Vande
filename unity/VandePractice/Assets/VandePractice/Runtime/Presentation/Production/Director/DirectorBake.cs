using System;
using P = Vande.Practice.Presentation.Production.Director.DirectorParams;
using Plan = Vande.Practice.Presentation.Production.Director.DirectorPlanBuilder;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>
    /// Bakes a plan into a trace: the 24 channels of <see cref="DirectorChannels"/> at <c>hz</c> frames per second (60), one script
    /// long. Off the frame path (idle or the run-up); <see cref="DirectorCore.Sample(DirectorPlan, double, float[], int)"/> then reads it in O(1). A line-for-line C#
    /// port of bake.ts (contract director/3): integrate at 240 steps per second, write a frame every 240 / hz steps.
    ///   gaze   saccades (main sequence), smooth pursuit of the delayed ball with catch-up saccades, fixations;
    ///   head   a critically damped follower of the neck-delayed gaze keeps the head in space (plus the pursuit feed-forward);
    ///   eyes   the residual between gaze and the head as it points, plus microsaccades and drift ('overlay' mode only);
    ///   lids   blinks from the plan, plus one on some large gaze shifts;
    ///   life   exertion, breath and fractal sway, fidgets and the reaction, off inside the quiet windows and in Reduced Motion;
    ///   face   the concentration, frustration, relief and celebration weights.
    /// Honesty: gaze at time t reads the visible ball only at t - lag (lag >= 125 ms) and nothing later; the targets 'opponent'
    /// and 'hand' are generic. Nothing here reads the plan of the delivery or its result.
    ///
    /// The bake is resumable: <see cref="RunSlice"/> runs one slice (64 integration steps, about 267 ms of script, or 32 clip-head
    /// reads in 'overlay' mode) and returns true once the trace is complete. It allocates nothing: every buffer is made by
    /// the constructor. The trace is the same, bit for bit, however it is sliced.
    ///
    /// Threads: a bake is single-threaded state (its slices must not overlap), but two bakes may run on two threads, because nothing
    /// here is mutable static state (the shared parameter arrays are read-only by convention). The world's callbacks run on whichever
    /// thread runs the slice, so a world that touches Unity objects must be baked on the main thread.
    ///
    /// Arithmetic: doubles throughout, except where the web uses a Float32Array (the events, the draws, and the delayed gaze and
    /// feed-forward histories), which are float here too. The events are widened to double once, so no expression can fall into
    /// float arithmetic by accident.
    /// </summary>
    public sealed class DirectorBake
    {
        /// <summary>Integration steps (at 240 per second) between two yields of the bake: a slice. A power of two.</summary>
        public const int SliceSteps = 64;

        private const double DT = 1000.0 / 240;
        private const double Tau = Math.PI * 2;
        private const int C = DirectorChannels.Count;

        private struct BlinkRec
        {
            public double T0;
            public double Close;
            public double Hold;
            public double Open;
            public double Depth;
            public double Skew;
            public double Total;
        }

        private static readonly double[] DriftAmp = { 1, 0.5 };

        private readonly DirectorAnchors a;
        private readonly IDirectorWorld world;
        private readonly bool rm;
        private readonly bool space;
        private readonly int sub;
        private readonly int n;
        private readonly int steps;
        private readonly double dtT;
        private readonly short[] trace;
        private readonly double[] tmp = new double[3];
        private readonly double[] wv = new double[2];
        private readonly uint bk;
        private readonly double[] d; // the draws, widened
        private readonly double[] am; // the person amplitudes, widened
        private readonly double[] fix; // the fixations, widened
        private readonly double[] micro;
        private readonly double[] fid;
        private readonly double[] rea;
        private readonly int nFix;
        private readonly int nMicro;
        private readonly int nFid;
        private readonly Plan.TaskWindow win;
        private readonly int kept;
        private readonly double[] clip;

        // Blinks: the plan's, plus those riding on large gaze shifts (inserted as they are decided, always in the future).
        private readonly BlinkRec[] blinks;
        private int nBlinks;
        private int bi0;
        private readonly uint shiftSeed;
        private readonly uint shiftSeed2;

        // Gaze, head, eyes.
        private readonly float[] gyH;
        private readonly float[] gpH;
        private readonly int latSteps;
        private readonly double omega;
        private readonly double maxHead;
        private readonly double comfY;
        private readonly double comfP;
        private readonly double ffK;
        private readonly double ffAlpha;
        private readonly float[] ffY;
        private readonly float[] ffP;
        private double vfY;
        private double vfP;
        private double pwY;
        private double pwP;
        private bool pwOk;
        private bool hadPw;
        private readonly double eyeY;
        private readonly double eyeP;
        private readonly double ovGain;
        private readonly double sacCap;
        private readonly double pursuitStep;
        private readonly double lead;
        private int kf = -1;
        private double gy;
        private double gp;
        private double py;
        private double pp;
        private bool haveG;
        private bool sacOn;
        private double sT0;
        private double sFy;
        private double sFp;
        private double sTy;
        private double sTp;
        private double sD = 1;
        private double sEnd = -1e9;
        /// <summary>A fixation whose saccade waits for the eyes to be free again (a saccade cannot be re-aimed within 120 ms).</summary>
        private int pending = -1;
        private double groundYaw;
        private double groundPitch;
        private double hsy;
        private double hvy;
        private double hsp;
        private double hvp;
        private bool hsInit;
        private int mi0;

        // Life.
        private readonly double[] pulses = new double[9];
        private int nPulses;
        private readonly double exertRise;
        private readonly double ca;
        private readonly double sa;
        private readonly uint hSeed;
        private readonly uint wSeed;
        private int fi0;
        private readonly double slowX;

        // Progress.
        private int phase; // 0: the clip-head reads ('overlay' mode), 1: the integration steps
        private int clipK;
        private int step;
        private bool done;

        /// <summary>
        /// Starts a bake. <paramref name="reuseTrace"/> (optional): frames before <paramref name="reuseUntilMs"/> are copied from an
        /// earlier trace of the same script at the same rate (a live plan built before the result, when the caller knows the two
        /// agree up to that time); the integrators still run from the start, which is cheap. <paramref name="into"/> (optional):
        /// the caller's own array for the trace (a job that serves the plan while it is still being filled); it is cleared, and
        /// is used only if it is exactly n * 24 long.
        /// </summary>
        public DirectorBake(DirectorAnchors anchors, DirectorEvents events, int hz, short[] reuseTrace, double reuseUntilMs, short[] into)
        {
            if (anchors == null) throw new ArgumentNullException(nameof(anchors));
            if (events == null) throw new ArgumentNullException(nameof(events));
            if (hz <= 0) throw new ArgumentOutOfRangeException(nameof(hz));
            a = anchors;
            world = anchors.World;
            rm = a.ReducedMotion;
            lead = P.Gaze.LeadX;
            sub = (int)DirectorMath.JsRound(240.0 / hz);
            dtT = 1000.0 / hz;
            n = TraceFrames(a, hz);
            steps = (n - 1) * sub + 1;
            if (into != null && into.Length == n * C)
            {
                trace = into;
                Array.Clear(trace, 0, trace.Length);
            }
            else trace = new short[n * C];
            bk = DirectorSeeds.BallKey(a.Key, DirectorSeeds.PersonKey(a.Person, a.Role));
            d = Widen(events.Draw);
            am = Widen(events.Amp);
            fix = Widen(events.Fix);
            micro = Widen(events.Micro);
            fid = Widen(events.Fidget);
            rea = Widen(events.React);
            nFix = fix.Length / Plan.FixN;
            nMicro = micro.Length / Plan.MicroN;
            nFid = fid.Length / Plan.FidgetN;
            win = Plan.TaskWindowOf(a);

            if (reuseTrace != null)
            {
                double kd = Math.Floor((reuseUntilMs - a.Start) / dtT);
                double lim = Math.Min(Math.Min((double)n, kd), (double)(reuseTrace.Length / C));
                kept = lim > 0 ? (int)lim : 0;
                Array.Copy(reuseTrace, trace, kept * C);
            }
            space = a.HeadMode == DirectorHeadMode.Space;
            // The clip's own head, on the trace grid (the only per-frame call that may be expensive for the caller).
            clip = new double[space ? 0 : n * 3];
            clipK = kept;

            int nPlanBlinks = events.Blink.Length / Plan.BlinkN;
            blinks = new BlinkRec[nPlanBlinks + nFix];
            for (int k = 0; k < events.Blink.Length; k += Plan.BlinkN)
            {
                double close = events.Blink[k + 1];
                double hold = events.Blink[k + 2];
                double open = events.Blink[k + 3];
                blinks[nBlinks++] = new BlinkRec { T0 = events.Blink[k], Close = close, Hold = hold, Open = open, Depth = events.Blink[k + 4], Skew = events.Blink[k + 5], Total = close + hold + open };
            }
            shiftSeed = DirectorSeeds.Mix(bk, 12);
            shiftSeed2 = DirectorSeeds.Mix(bk, 41);

            gyH = new float[steps];
            gpH = new float[steps];
            latSteps = (int)DirectorMath.JsRound(d[DirectorDraw.NeckLagMs] / DT);
            double tau = a.Role == DirectorRole.Bowler ? P.Head.TauMs.Bowler : P.Head.TauMs.Striker;
            omega = 1000 / (tau * (rm ? P.Head.RmTauX : 1));
            maxHead = P.Head.MaxDegS * (rm ? P.Head.RmSpeedX : 1);
            comfY = P.Head.ComfortDeg * P.Head.YawShare;
            comfP = P.Head.ComfortDeg * P.Head.PitchShare;
            // Smooth-pursuit feed-forward for the head: a critically damped follower of a ramp lags it by 2 / omega, so while the
            // gaze is on the ball the head's target is carried on by that much at the ball target's own (filtered) angular velocity.
            // The velocity comes from the ball target alone (the ball as it was one latency ago, carried on), never from the saccades.
            ffK = rm ? 0 : (P.Head.FfX * 2) / omega;
            ffAlpha = 1 - Math.Exp(-DT / P.Head.FfTauMs);
            ffY = new float[ffK > 0 ? steps : 0];
            ffP = new float[ffK > 0 ? steps : 0];
            eyeY = rm ? P.Gaze.EyeRmDeg : P.Gaze.EyeYawDeg;
            eyeP = rm ? P.Gaze.EyeRmDeg : P.Gaze.EyePitchDeg;
            ovGain = rm ? P.Head.RmGainX : 1;
            sacCap = (P.Gaze.SaccMaxDegS * DT) / 1000;
            pursuitStep = (P.Gaze.PursuitMaxDegS * DT) / 1000;

            // Life.
            double exertTau = d[DirectorDraw.ExertTauS];
            if (a.Release.HasValue)
            {
                if (a.Role == DirectorRole.Bowler) AddPulse(a.Release.Value, P.Life.Exert.Bowler, exertTau);
                else
                {
                    if (a.StrokeEnd.HasValue) AddPulse(a.StrokeEnd.Value, P.Life.Exert.Stroke, exertTau);
                    if (a.OutcomeAt.HasValue && a.Runs > 0) AddPulse(a.OutcomeAt.Value + d[DirectorDraw.ReactionMs], Math.Min(P.Life.Exert.Cap, P.Life.Exert.PerRun * a.Runs), exertTau);
                }
            }
            // A reaction breathes out (the exertion also raises the breath's depth and rate)
            if (rea.Length > 0) AddPulse(rea[0], rea[9], P.React.ExhaleTauS);
            exertRise = P.Life.Exert.RiseS;
            ca = Math.Cos(d[DirectorDraw.SwayAxis]);
            sa = Math.Sin(d[DirectorDraw.SwayAxis]);
            hSeed = DirectorSeeds.Mix(bk, 51);
            wSeed = DirectorSeeds.Mix(bk, 52);
            slowX = rm ? P.Expr.SlowRm : 1;

            // The progress: the first slice starts with the clip reads (overlay mode), then the integration steps.
            phase = space ? 1 : 0;
        }

        /// <summary>How many trace frames a script of these anchors has at <paramref name="hz"/> (what the bake fills).</summary>
        public static int TraceFrames(DirectorAnchors a, int hz)
        {
            double f = Math.Floor((a.End - a.Start) / (1000.0 / hz) + 1e-9) + 1;
            return f < 1 ? 1 : (int)f;
        }

        /// <summary>The trace being filled (final once <see cref="RunSlice"/> has returned true).</summary>
        public short[] Trace
        {
            get { return trace; }
        }

        /// <summary>Frames in the trace.</summary>
        public int Frames
        {
            get { return n; }
        }

        /// <summary>Frames copied from the reused trace: final from the start.</summary>
        public int KeptFrames
        {
            get { return kept; }
        }

        /// <summary>Integration steps per trace frame (240 / hz).</summary>
        public int StepsPerFrame
        {
            get { return sub; }
        }

        /// <summary>True once every slice has run.</summary>
        public bool Done
        {
            get { return done; }
        }

        /// <summary>The integration steps below this are done (set at each yield of the integration phase): the frames written at them are final.</summary>
        public int ProgressStep { get; private set; }

        private static double[] Widen(float[] f)
        {
            var r = new double[f.Length];
            for (int i = 0; i < f.Length; i++) r[i] = f[i];
            return r;
        }

        private void AddPulse(double t0, double amplitude, double tau)
        {
            pulses[nPulses++] = t0;
            pulses[nPulses++] = amplitude;
            pulses[nPulses++] = tau;
        }

        /// <summary>Runs one slice and returns true once the bake is complete. Allocation-free.</summary>
        public bool RunSlice()
        {
            if (done) return true;
            if (phase == 0)
            {
                double[] tmp3 = tmp;
                while (clipK < n)
                {
                    int k = clipK;
                    tmp3[0] = tmp3[1] = tmp3[2] = 0;
                    if (world != null) world.ClipHead(a.Start + k * dtT, tmp3);
                    for (int c = 0; c < 3; c++) clip[3 * k + c] = IsFinite(tmp3[c]) ? tmp3[c] : 0;
                    clipK++;
                    if ((k & 31) == 31) return false;
                }
                phase = 1;
            }
            bool first = true;
            while (step < steps)
            {
                if (!first && (step & (SliceSteps - 1)) == SliceSteps - 1)
                {
                    ProgressStep = step;
                    return false;
                }
                first = false;
                Step(step);
                step++;
            }
            done = true;
            return true;
        }

        private static bool IsFinite(double x)
        {
            return !double.IsNaN(x) && !double.IsInfinity(x);
        }

        private static double Clamp(double x, double lo, double hi)
        {
            return x < lo ? lo : x > hi ? hi : x;
        }

        private static double Wrap180(double x)
        {
            return x > 180 ? x - 360 : x < -180 ? x + 360 : x;
        }

        private static double Sm(double x)
        {
            return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
        }

        /// <summary>
        /// A range limit that eases in: x up to 75% of the limit, then an exponential approach that never passes it. Its slope is
        /// continuous (1 at the knee), so the speed of whatever it limits never stops in a single frame.
        /// </summary>
        public static double Soft(double x, double limit)
        {
            double a = 0.75 * limit;
            double t = x < 0 ? -x : x;
            if (t <= a) return x;
            double y = a + (limit - a) * (1 - Math.Exp(-(t - a) / (limit - a)));
            return x < 0 ? -y : y;
        }

        /// <summary>Minimum-jerk position profile: zero speed and acceleration at both ends.</summary>
        public static double Mj(double x)
        {
            double c = x <= 0 ? 0 : x >= 1 ? 1 : x;
            return c * c * c * (c * (c * 6 - 15) + 10);
        }

        /// <summary>A move out, held a moment and back: smooth at both ends, 1 across the middle third (u in 0..1).</summary>
        private static double Bell(double u)
        {
            return Mj(u / 0.38) * (1 - Mj((u - 0.62) / 0.38));
        }

        private static double Envelope(ref BlinkRec b, double u)
        {
            if (u <= 0) return 0;
            if (u < b.Close) return b.Depth * Mj(u / b.Close);
            if (u < b.Close + b.Hold) return b.Depth;
            double v = (u - b.Close - b.Hold) / b.Open;
            return v >= 1 ? 0 : b.Depth * (1 - Mj(Math.Pow(v, 0.75)));
        }

        /// <summary>How much of the body's ambient life is on at t: ramped in at the start, off in the quiet windows (H3).</summary>
        private double LifeGain(double t)
        {
            double ramp = Sm((t - a.Start) / P.Life.RampInMs);
            if (!a.Release.HasValue) return ramp;
            double release = a.Release.Value;
            if (a.Role == DirectorRole.Striker)
            {
                double off = Sm((t - (release - P.Life.Striker.OffFromMs)) / (P.Life.Striker.OffFromMs - P.Life.Striker.OffToMs));
                double back = Sm((t - ((a.StrokeEnd ?? double.PositiveInfinity) + P.Life.Striker.AfterStrokeMs)) / P.Life.Striker.BackMs);
                return ramp * (1 - off * (1 - back));
            }
            double g = a.Gather ?? release - 620;
            // Off from the run's start or, without it, from the gather; the ramp out ends there.
            double e = Math.Min(a.RunStart ?? g, g);
            double offB = Sm((t - (e - P.Life.Bowler.RampOutMs)) / P.Life.Bowler.RampOutMs);
            double backB = Sm((t - (release + P.Life.Bowler.AfterReleaseMs)) / P.Life.Bowler.BackMs);
            return ramp * (1 - offB * (1 - backB));
        }

        /// <summary>The first valid target: the gaze starts there, and so does the head (no sweep from nowhere).</summary>
        private void InitGaze(int i)
        {
            gy = wv[0];
            gp = wv[1];
            haveG = true;
            float fy = (float)gy;
            float fp = (float)gp;
            for (int j = 0; j <= i; j++)
            {
                gyH[j] = fy;
                gpH[j] = fp;
            }
        }

        private bool TgtOf(int kind, double lag, double t)
        {
            if (kind == Plan.TargetGround)
            {
                wv[0] = groundYaw;
                wv[1] = groundPitch;
                return true;
            }
            if (world == null) return false;
            if (kind == Plan.TargetSide)
            {
                // A look to the side of the opponent: the fixation's lag column is the yaw offset.
                tmp[0] = tmp[1] = 0;
                if (!world.Aim(DirectorAim.Opponent, t, tmp) || !IsFinite(tmp[0] + tmp[1])) return false;
                wv[0] = tmp[0] + lag;
                wv[1] = tmp[1] + P.Fidget.SidePitchDeg;
                return true;
            }
            if (kind == Plan.TargetBall)
            {
                tmp[0] = tmp[1] = 0;
                // The ball as it was one latency ago, carried on at its own velocity to now: still nothing later than t - lag.
                if (!world.VisibleBall(t - lag, tmp, lead * lag)) return false;
            }
            else if (!world.Aim(kind == Plan.TargetOpponent ? DirectorAim.Opponent : DirectorAim.Hand, t, tmp)) return false;
            if (!IsFinite(tmp[0] + tmp[1])) return false;
            wv[0] = tmp[0];
            wv[1] = tmp[1];
            return true;
        }

        /// <summary>Looking at the ground keeps the gaze's yaw and drops it to the event's downward angle.</summary>
        private void SetGround(int o)
        {
            if (fix[o + 1] != Plan.TargetGround) return;
            groundYaw = gy;
            groundPitch = fix[o + 3];
        }

        private void StartSaccade(double t, double ty, double tp)
        {
            double amp = Math.Sqrt((ty - gy) * (ty - gy) + (tp - gp) * (tp - gp));
            sacOn = true;
            sT0 = t;
            sFy = gy;
            sFp = gp;
            sTy = ty;
            sTp = tp;
            // Main sequence; never faster than the peak-speed cap (the profile peaks at about 1.9 x amplitude / duration).
            sD = Math.Max(P.Gaze.SaccBaseMs + P.Gaze.SaccMsPerDeg * amp, (1.9 * amp * 1000) / P.Gaze.SaccMaxDegS);
        }

        private void AddShiftBlink(double t, int k)
        {
            Plan.BlinkShape s = Plan.BlinkShapeOf(shiftSeed, 5000 + k);
            double total = s.Close + s.Hold + s.Open;
            double t0 = t + DirectorSeeds.U01(shiftSeed2, k) * 40;
            double gap = P.Blink.ShiftGapMs;
            if (t0 + total > a.End) return;
            if (win.Has && t0 - P.Blink.SkewMs < win.Hi && t0 + total + P.Blink.SkewMs > win.Lo) return;
            if (Plan.SeamClash(a, t0, total)) return;
            for (int b = 0; b < nBlinks; b++)
                if (t0 > blinks[b].T0 - gap - total && t0 < blinks[b].T0 + blinks[b].Total + gap) return;
            int i = nBlinks;
            while (i > 0 && blinks[i - 1].T0 > t0) i--;
            for (int m = nBlinks; m > i; m--) blinks[m] = blinks[m - 1];
            blinks[i] = new BlinkRec { T0 = t0, Close = s.Close, Hold = s.Hold, Open = s.Open, Depth = s.Depth, Skew = s.Skew, Total = total };
            nBlinks++;
        }

        private void Put(int o, int c, double v)
        {
            double q = DirectorMath.JsRound(v / DirectorChannels.Scale[c]);
            short s;
            if (q > 32767) s = 32767;
            else if (q < -32767) s = -32767;
            else if (double.IsNaN(q)) s = 0;
            else s = (short)q;
            trace[o + c] = s;
        }

        /// <summary>The head's own slow wobble (fractal), zero in Reduced Motion.</summary>
        private double Drift(int c, double amp, double tS)
        {
            return rm ? 0 : amp * DirectorNoise.Fractal(unchecked(hSeed + 131u * (uint)c), tS, d[DirectorDraw.HeadDrift + c], P.Head.DriftS, DriftAmp);
        }

        private void Step(int i)
        {
            double t = a.Start + i * DT;

            // 1. fixation changes
            while (kf + 1 < nFix && fix[(kf + 1) * Plan.FixN] <= t)
            {
                kf++;
                int o = kf * Plan.FixN;
                if (!haveG)
                {
                    SetGround(o);
                    if (TgtOf((int)fix[o + 1], fix[o + 3], t)) InitGaze(i);
                }
                else pending = kf;
            }

            // 2. gaze
            hadPw = pwOk;
            pwOk = false; // set again by the pursuit branch below when it runs this step with the ball as its target
            if (sacOn)
            {
                double u = (t - sT0) / sD;
                if (u >= 1)
                {
                    gy = sTy;
                    gp = sTp;
                    sacOn = false;
                    sEnd = t;
                }
                else
                {
                    double w = Mj(Math.Pow(u, P.Gaze.SaccShape));
                    gy = sFy + (sTy - sFy) * w;
                    gp = sFp + (sTp - sFp) * w;
                }
            }
            else if (pending >= 0)
            {
                // Hold until the eyes are free, then shift to where the target is now.
                if (t - sEnd >= P.Gaze.RefractoryMs)
                {
                    int o = pending * Plan.FixN;
                    SetGround(o);
                    if (TgtOf((int)fix[o + 1], fix[o + 3], t))
                    {
                        double amp = Math.Sqrt((wv[0] - gy) * (wv[0] - gy) + (wv[1] - gp) * (wv[1] - gp));
                        if (amp >= P.Gaze.SaccMinDeg)
                        {
                            StartSaccade(t, wv[0], wv[1]);
                            if (fix[o + 4] > 0 && amp >= P.Blink.ShiftMinDeg) AddShiftBlink(t, pending);
                        }
                    }
                    pending = -1;
                }
            }
            else if (kf >= 0 && TgtOf((int)fix[kf * Plan.FixN + 1], fix[kf * Plan.FixN + 3], t))
            {
                if (ffK > 0)
                {
                    if (fix[kf * Plan.FixN + 1] == Plan.TargetBall)
                    {
                        double dY = Wrap180(wv[0] - pwY);
                        double dP = wv[1] - pwP;
                        // A step of more than 8 degrees in 4 ms is a change of target, not a motion: start the estimate again.
                        if (hadPw && Math.Abs(dY) < 8 && Math.Abs(dP) < 8)
                        {
                            vfY += ((dY * 1000) / DT - vfY) * ffAlpha;
                            vfP += ((dP * 1000) / DT - vfP) * ffAlpha;
                        }
                        else if (hadPw)
                        {
                            vfY *= 1 - ffAlpha;
                            vfP *= 1 - ffAlpha;
                        }
                        pwY = wv[0];
                        pwP = wv[1];
                        pwOk = true;
                    }
                    else
                    {
                        vfY *= 1 - ffAlpha;
                        vfP *= 1 - ffAlpha;
                        pwOk = false;
                    }
                }
                if (!haveG) InitGaze(i);
                else
                {
                    double ey = wv[0] - gy;
                    double ep = wv[1] - gp;
                    double e = Math.Sqrt(ey * ey + ep * ep);
                    if (e > P.Gaze.CatchUpDeg && t - sEnd >= P.Gaze.RefractoryMs) StartSaccade(t, wv[0], wv[1]);
                    else if (e > 1e-9)
                    {
                        double stepDeg = Math.Min(e, pursuitStep);
                        gy += (ey / e) * stepDeg;
                        gp += (ep / e) * stepDeg;
                    }
                }
            }
            if (i > 0)
            {
                double dd = Math.Sqrt((gy - py) * (gy - py) + (gp - pp) * (gp - pp));
                if (dd > sacCap)
                {
                    gy = py + ((gy - py) * sacCap) / dd;
                    gp = pp + ((gp - pp) * sacCap) / dd;
                }
            }
            py = gy;
            pp = gp;
            gyH[i] = (float)gy;
            gpH[i] = (float)gp;
            if (ffK > 0)
            {
                ffY[i] = (float)Clamp(ffK * vfY, -P.Head.FfMaxDeg, P.Head.FfMaxDeg);
                ffP[i] = (float)Clamp(ffK * vfP, -P.Head.FfMaxDeg, P.Head.FfMaxDeg);
            }

            // 3. head in space: follows the gaze once the eyes would be off centre by more than the comfort zone
            if (!hsInit && haveG)
            {
                hsy = gy;
                hsp = gp;
                hsInit = true;
            }
            if (hsInit)
            {
                int di = Math.Max(0, i - latSteps);
                double gdY = ffK > 0 ? (double)gyH[di] + ffY[di] : gyH[di];
                double gdP = ffK > 0 ? (double)gpH[di] + ffP[di] : gpH[di];
                double wY = gdY - Clamp(gdY - hsy, -comfY, comfY);
                double wP = gdP - Clamp(gdP - hsp, -comfP, comfP);
                double dtS = DT / 1000;
                hvy = Clamp(hvy + (omega * omega * (wY - hsy) - 2 * omega * hvy) * dtS, -maxHead, maxHead);
                hvp = Clamp(hvp + (omega * omega * (wP - hsp) - 2 * omega * hvp) * dtS, -maxHead, maxHead);
                hsy += hvy * dtS;
                hsp += hvp * dtS;
            }
            if (i % sub != 0 || i / sub < kept) return;

            Frame(i, t);
        }

        /// <summary>4. A frame: everything that is written to the trace at step i (time t).</summary>
        private void Frame(int i, double t)
        {
            int k = i / sub;
            int o = k * C;
            double tS = (t - a.Start) / 1000;
            double cy = space ? 0 : clip[3 * k];
            double cp = space ? 0 : clip[3 * k + 1];
            double cr = space ? 0 : clip[3 * k + 2];
            // The reaction's head (from outcomeAt + 180 ms): up for a good result, down for a bad one, a shake for the worst.
            double hyR = 0;
            double hpR = 0;
            double postureR = 0;
            double rEnv = 0;
            if (rea.Length > 0 && t > rea[0])
            {
                double u = t - rea[0];
                double env = u < rea[3] ? Mj(u / rea[3]) : u < rea[3] + rea[4] ? 1 : 1 - Mj((u - rea[3] - rea[4]) / rea[5]);
                rEnv = env > 0 ? env : 0;
                if (env > 0)
                {
                    hpR = env * rea[8];
                    postureR = env * rea[1] * rea[2] * (rea[1] > 0 ? P.React.PostureLiftDeg : P.React.PostureSlumpDeg);
                    if (!rm && rea[6] != 0 && u < P.React.ShakeMs) hyR = rea[6] * Math.Sin((Tau * rea[7] * u) / 1000) * Math.Sin((Math.PI * u) / P.React.ShakeMs);
                }
            }
            double hy = hsy + Drift(0, P.Head.DriftDeg[0], tS) + hyR;
            double hp = hsp + Drift(1, P.Head.DriftDeg[1], tS) + hpR;
            // eyes: gaze plus microsaccades and drift, minus where the head actually points
            double ux = 0;
            double uy = 0;
            if (!rm)
            {
                while (mi0 < nMicro && t - micro[mi0 * Plan.MicroN] > 1500) mi0++;
                for (int m = mi0; m < nMicro && micro[m * Plan.MicroN] <= t; m++)
                {
                    double age = t - micro[m * Plan.MicroN];
                    double w = Mj(age / P.Gaze.MicroRiseMs) * Math.Exp(-age / P.Gaze.MicroRelaxMs);
                    ux += micro[m * Plan.MicroN + 1] * w;
                    uy += micro[m * Plan.MicroN + 2] * w;
                }
                for (int s = 0; s < 3; s++)
                {
                    int oy = DirectorDraw.EyeDrift + 3 * s;
                    int op = DirectorDraw.EyeDrift + 9 + 3 * s;
                    ux += d[oy + 2] * Math.Sin(Tau * d[oy] * tS + d[oy + 1]);
                    uy += d[op + 2] * Math.Sin(Tau * d[op] * tS + d[op + 1]);
                }
            }
            if (space)
            {
                // The head in space (limited softly so the quantised channel never clips) and the raw gaze: the stage decides
                // the head's share against the pose it drew, and the eyes take the rest.
                Put(o, DirectorChannels.HeadYaw, Soft(hy, P.Head.SpaceLimitDeg[0]));
                Put(o, DirectorChannels.HeadPitch, Soft(hp, P.Head.SpaceLimitDeg[1]));
                Put(o, DirectorChannels.HeadRoll, Soft(P.Head.RollPerYaw * hy + Drift(2, P.Head.DriftDeg[2], tS), P.Head.LimitDeg[2]));
                Put(o, DirectorChannels.GazeYaw, gy + ux);
                Put(o, DirectorChannels.GazePitch, gp + uy);
            }
            else
            {
                double ovY = Soft(ovGain * (hy - cy), P.Head.LimitDeg[0]);
                double ovP = Soft(ovGain * (hp - cp), P.Head.LimitDeg[1]);
                double ovR = Soft(ovGain * (P.Head.RollPerYaw * ovY + Drift(2, P.Head.DriftDeg[2], tS) - cr), P.Head.LimitDeg[2]);
                Put(o, DirectorChannels.HeadYaw, ovY);
                Put(o, DirectorChannels.HeadPitch, ovP);
                Put(o, DirectorChannels.HeadRoll, ovR);
                double headY = cy + ovY;
                double headP = cp + ovP;
                double eY = Soft(gy + ux - headY, eyeY);
                double eP = Soft(gp + uy - headP, eyeP);
                Put(o, DirectorChannels.EyeYawL, eY - P.Gaze.VergenceDeg / 2);
                Put(o, DirectorChannels.EyeYawR, eY + P.Gaze.VergenceDeg / 2);
                Put(o, DirectorChannels.EyePitchL, eP);
                Put(o, DirectorChannels.EyePitchR, eP);
                Put(o, DirectorChannels.LidFollow, Clamp(eP / 30, -1, 1) * 0.5);
                Put(o, DirectorChannels.GazeYaw, headY + eY);
                Put(o, DirectorChannels.GazePitch, headP + eP);
            }

            // lids
            while (bi0 < nBlinks && t > blinks[bi0].T0 + blinks[bi0].Total + 40) bi0++;
            double bl = 0;
            double br = 0;
            for (int b = bi0; b < nBlinks && blinks[b].T0 - 40 <= t; b++)
            {
                bl = Math.Max(bl, Envelope(ref blinks[b], t - blinks[b].T0 - blinks[b].Skew));
                br = Math.Max(br, Envelope(ref blinks[b], t - blinks[b].T0 + blinks[b].Skew));
            }
            Put(o, DirectorChannels.BlinkL, bl);
            Put(o, DirectorChannels.BlinkR, br);

            // expressions: the concentration of the task (closed form of the anchors: the ball is coming), then the reaction's face
            // (from outcomeAt + 180 ms). The batter's effort belongs to his own input: the stage adds it (it is not in the plan).
            double xCon = 0;
            if (a.Release.HasValue)
            {
                double release = a.Release.Value;
                double[] xc = a.Role == DirectorRole.Striker ? P.Expr.Conc.Striker : P.Expr.Conc.Bowler;
                double mx = xc[0];
                double leadMs = xc[1];
                double toMs = xc[2];
                double decMs = xc[3];
                double conRise = (leadMs - toMs) * slowX;
                double full = release - toMs;
                double end = (a.Role == DirectorRole.Striker ? (a.TaskEnd ?? a.Contact ?? release + P.Blink.IdleEndMs) : release) + P.Expr.Conc.AfterMs;
                xCon = mx * Mj((t - (full - conRise)) / conRise) * (1 - Mj((t - end) / (decMs * slowX)));
            }
            bool hasRea = rea.Length > 0;
            Put(o, DirectorChannels.XConcentration, Math.Min(1, xCon + rEnv * (hasRea ? rea[11] : 0)));
            Put(o, DirectorChannels.XFrustration, hasRea ? rEnv * Math.Max(0, -rea[1]) * rea[2] : 0);
            Put(o, DirectorChannels.XRelief, hasRea ? rEnv * rea[10] : 0);
            Put(o, DirectorChannels.XCelebration, hasRea ? rEnv * Math.Max(0, rea[1]) * rea[2] : 0);

            // life: exertion first (it raises the breath rate and depth)
            double e = 0;
            double E = 0;
            for (int p = 0; p < nPulses; p += 3)
            {
                double x = (t - pulses[p]) / 1000;
                if (x <= 0) continue;
                double tau2 = 1 / (1 / pulses[p + 2] + 1 / exertRise);
                e += pulses[p + 1] * (1 - Math.Exp(-x / exertRise)) * Math.Exp(-x / pulses[p + 2]);
                E += pulses[p + 1] * (pulses[p + 2] * (1 - Math.Exp(-x / pulses[p + 2])) - tau2 * (1 - Math.Exp(-x / tau2)));
            }
            e = Math.Min(P.Life.Exert.Cap, e);
            Put(o, DirectorChannels.Exertion, e);
            double q = rm ? 0 : LifeGain(t);
            if (q > 0)
            {
                double breathPhase = d[DirectorDraw.BreathPhase] + am[DirectorAmp.BreathHz] * (tS + P.Life.Breath.RateX * E) + d[DirectorDraw.ModCycles] * Math.Sin(Tau * (d[DirectorDraw.ModHz] * tS + d[DirectorDraw.ModPhase])) * (1 - P.Life.Breath.ModDamp * e);
                double depth = (1 + P.Life.Breath.AmpMod * Math.Sin(Tau * (d[DirectorDraw.AmpModHz] * tS + d[DirectorDraw.AmpPhase]))) * (1 + P.Life.Breath.DepthX * e);
                Put(o, DirectorChannels.Breath, q * am[DirectorAmp.BreathDepthDeg] * depth * DirectorNoise.SkewSin(breathPhase, am[DirectorAmp.BreathSkew]));
                double norm = P.Life.Sway.Norm;
                double n0 = norm * DirectorNoise.Fractal(wSeed, tS, d[DirectorDraw.SwayPhase], P.Life.Sway.SpacingS, P.Life.Sway.Amp);
                double n1 = norm * DirectorNoise.Fractal(unchecked(wSeed + 1013u), tS, d[DirectorDraw.SwayPhase + 1], P.Life.Sway.SpacingS, P.Life.Sway.Amp);
                double n2 = norm * DirectorNoise.Fractal(unchecked(wSeed + 2029u), tS, d[DirectorDraw.SwayPhase + 2], P.Life.Sway.SpacingS, P.Life.Sway.Amp);
                // fidgets: bell-shaped moves of the same body parts, a function of the plan's events and the time only
                double fX = 0;
                double fZ = 0;
                double fR = 0;
                double fP = 0;
                double fT = 0;
                for (int m = fi0; m < nFid; m++)
                {
                    int fo = m * Plan.FidgetN;
                    double f0 = fid[fo];
                    if (f0 > t) break;
                    double u = (t - f0) / fid[fo + 2];
                    if (u >= 1)
                    {
                        if (m == fi0) fi0++;
                        continue;
                    }
                    int kind = (int)fid[fo + 1];
                    if (kind == Plan.FidgetBreath)
                    {
                        // a sigh: the chest lifts quickly and settles slowly
                        fP += fid[fo + 3] * (u < 0.25 ? Mj(u / 0.25) : u < 0.35 ? 1 : 1 - Mj((u - 0.35) / 0.65));
                        continue;
                    }
                    double env = Bell(u);
                    if (kind == Plan.FidgetWeight)
                    {
                        fX += fid[fo + 3] * env;
                        fR += fid[fo + 4] * env;
                    }
                    else if (kind == Plan.FidgetStance)
                    {
                        fZ += fid[fo + 3] * env;
                        fT += fid[fo + 4] * env;
                        fP += fid[fo + 5] * env;
                    }
                    else
                    {
                        fT += fid[fo + 3] * Math.Sin(Tau * fid[fo + 5] * u) * env;
                        fP += fid[fo + 4] * Math.Sin(Tau * fid[fo + 5] * u + 1.3) * env;
                    }
                }
                Put(o, DirectorChannels.SwayX, q * (am[DirectorAmp.SwayRootMm] * (n0 * ca - n1 * sa * 0.5) + fX));
                Put(o, DirectorChannels.SwayZ, q * (am[DirectorAmp.SwayRootMm] * (n0 * sa * 0.5 + n1 * 0.7) + fZ));
                Put(o, DirectorChannels.SwayRoll, q * (am[DirectorAmp.SwayRollDeg] * n2 + fR));
                Put(o, DirectorChannels.Posture, q * (fP + postureR));
                Put(o, DirectorChannels.Twist, q * fT);
            }
        }
    }
}
