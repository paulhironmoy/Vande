using System;
using P = Vande.Practice.Presentation.Production.Director.DirectorParams;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>Indices in <see cref="DirectorEvents.Draw"/> (per-ball draws; plan.ts DRAW).</summary>
    public static class DirectorDraw
    {
        public const int BreathPhase = 0; // cycles
        public const int AmpPhase = 1; // cycles
        public const int ModPhase = 2; // cycles
        public const int ModHz = 3;
        public const int ModCycles = 4;
        public const int SwayPhase = 5; // 5, 6, 7: lattice offsets of the three sway octaves
        public const int SwayAxis = 8; // rad: direction of the dominant weight shift on the ground
        public const int HeadDrift = 9; // 9, 10, 11: lattice offsets of the head drift (yaw, pitch, roll)
        public const int NeckLagMs = 12;
        public const int LagMs = 13; // pursuit lag: how late the gaze follows the visible ball
        public const int ReactionMs = 14; // latency of the first reaction after the outcome
        public const int ExertTauS = 15;
        public const int AmpModHz = 16;
        public const int EyeDrift = 17; // 17 .. 34: per axis (yaw, pitch) three sinusoids of [Hz, phase rad, amplitude deg]
        public const int Count = 36;
    }

    /// <summary>Indices in <see cref="DirectorEvents.Amp"/> (person amplitudes, constant for the over; plan.ts AMP).</summary>
    public static class DirectorAmp
    {
        public const int BreathHz = 0;
        public const int BreathDepthDeg = 1;
        public const int BreathSkew = 2;
        public const int SwayRootMm = 3;
        public const int SwayRollDeg = 4;
        public const int BlinkMeanS = 5;
        public const int BlinkCv = 6;
        public const int FidgetX = 7;
        public const int Count = 8;
    }

    /// <summary>
    /// The plan: the Director's events for one actor in one script (a line-for-line C# port of plan.ts, contract director/3),
    /// about 22 events for a delivery, built once off the frame path. Every random number is a draw from the ball's key with a
    /// fixed index (<see cref="DirectorSeeds"/>), so the draws do not depend on the anchors or on the ball: the anchors only
    /// decide when an event falls. The plan never reads the ball, its speed, length, line, variation or result; a time that
    /// depends on the contact, the outcome or the dead ball only matters after that moment. The order of the draws and the
    /// floating-point expressions are the contract: do not simplify.
    /// </summary>
    public static class DirectorPlanBuilder
    {
        /// <summary>Gaze targets (the fixation's target column).</summary>
        public const int TargetOpponent = 0;
        public const int TargetHand = 1;
        public const int TargetGround = 2;
        public const int TargetBall = 3;
        /// <summary>A glance to the side of the opponent: the fixation's lag column is the yaw offset (deg, + left), plus a small downward pitch.</summary>
        public const int TargetSide = 4;

        public const int FixN = 5;
        public const int BlinkN = 6;
        public const int MicroN = 3;
        public const int FidgetN = 8;
        public const int ReactN = 12;

        /// <summary>Fidget kinds (column 1): a weight shift, a stance adjust, a shoulder roll, a sigh.</summary>
        public const int FidgetWeight = 0;
        public const int FidgetStance = 1;
        public const int FidgetShoulder = 2;
        public const int FidgetBreath = 3;

        /// <summary>The span in which the actor's eyes are busy: the Director blinks neither inside it nor across its edges.</summary>
        internal struct TaskWindow
        {
            public bool Has;
            public double Lo;
            public double Hi;
        }

        /// <summary>The shape of one blink (plan.ts blinkShape).</summary>
        internal struct BlinkShape
        {
            public double Close;
            public double Hold;
            public double Open;
            public double Depth;
            public double Skew;
        }

        /// <summary>A growable list of doubles for building the event arrays (plan time only).</summary>
        internal sealed class DoubleList
        {
            private double[] items = new double[32];
            public int Count;

            public void Add(double v)
            {
                if (Count == items.Length) Array.Resize(ref items, items.Length * 2);
                items[Count++] = v;
            }

            public float[] ToFloats()
            {
                var r = new float[Count];
                for (int i = 0; i < Count; i++) r[i] = (float)items[i];
                return r;
            }
        }

        private static double Clamp(double x, double lo, double hi)
        {
            return x < lo ? lo : x > hi ? hi : x;
        }

        internal static TaskWindow TaskWindowOf(DirectorAnchors a)
        {
            var w = new TaskWindow();
            if (!a.Release.HasValue) return w;
            double release = a.Release.Value;
            bool bowler = a.Role == DirectorRole.Bowler;
            double[] ba = bowler ? P.Blink.WindowMs.Bowler : P.Blink.WindowMs.Striker;
            double before = ba[0];
            double after = ba[1];
            w.Has = true;
            if (bowler)
            {
                w.Lo = (a.Gather ?? release - 620) - before;
                w.Hi = release + after;
            }
            else
            {
                w.Lo = release - before;
                w.Hi = (a.TaskEnd ?? a.Contact ?? release + P.Blink.IdleEndMs) + after;
            }
            return w;
        }

        /// <summary>
        /// Whether a blink of <c>total</c> ms at <c>t</c> falls across the seam of a looping script: the fade at the end of the loop
        /// (the last SeamMs) and the pre-roll it fades into (Start to 0) must both be lid-open, with a margin for the lids' own timing.
        /// </summary>
        internal static bool SeamClash(DirectorAnchors a, double t, double total)
        {
            double seam = a.SeamMs ?? 0;
            if (seam <= 0) return false;
            double m = P.Blink.SkewMs + P.Blink.SeamMarginMs;
            return t + total + m > a.End - seam || t - m < a.Start + seam;
        }

        private static float[] Persons(uint pk, DirectorRole role)
        {
            var amp = new float[DirectorAmp.Count];
            bool bowler = role == DirectorRole.Bowler;
            double[] root = bowler ? P.Life.Sway.RootMm.Bowler : P.Life.Sway.RootMm.Striker;
            amp[DirectorAmp.BreathHz] = (float)DirectorSeeds.Range(pk, 0, P.Life.Breath.Hz[0], P.Life.Breath.Hz[1]);
            amp[DirectorAmp.BreathDepthDeg] = (float)DirectorSeeds.Range(pk, 1, P.Life.Breath.DepthDeg[0], P.Life.Breath.DepthDeg[1]);
            amp[DirectorAmp.BreathSkew] = (float)DirectorSeeds.Range(pk, 2, P.Life.Breath.Skew[0], P.Life.Breath.Skew[1]);
            amp[DirectorAmp.SwayRootMm] = (float)DirectorSeeds.Range(pk, 3, root[0], root[1]);
            amp[DirectorAmp.SwayRollDeg] = (float)DirectorSeeds.Range(pk, 4, P.Life.Sway.RollDeg[0], P.Life.Sway.RollDeg[1]);
            amp[DirectorAmp.BlinkMeanS] = (float)DirectorSeeds.Range(pk, 5, P.Blink.MeanS[0], P.Blink.MeanS[1]);
            amp[DirectorAmp.BlinkCv] = (float)DirectorSeeds.Range(pk, 6, P.Blink.Cv[0], P.Blink.Cv[1]);
            amp[DirectorAmp.FidgetX] = (float)DirectorSeeds.Range(pk, 7, P.Fidget.PersonX[0], P.Fidget.PersonX[1]);
            return amp;
        }

        private static float[] Draws(uint bk, float[] amp)
        {
            var d = new float[DirectorDraw.Count];
            uint s = DirectorSeeds.Mix(bk, 1);
            d[DirectorDraw.BreathPhase] = (float)DirectorSeeds.U01(s, 0);
            d[DirectorDraw.AmpPhase] = (float)DirectorSeeds.U01(s, 1);
            d[DirectorDraw.ModPhase] = (float)DirectorSeeds.U01(s, 2);
            d[DirectorDraw.ModHz] = (float)DirectorSeeds.Range(s, 3, P.Life.Breath.ModHz[0], P.Life.Breath.ModHz[1]);
            // The breath rate swings by +-modDev of itself: the phase wave has amplitude dev * f0 / (2 pi fm) cycles.
            double modDev = DirectorSeeds.Range(s, 4, P.Life.Breath.ModDev[0], P.Life.Breath.ModDev[1]);
            double breathHz = amp[DirectorAmp.BreathHz];
            double modHz = d[DirectorDraw.ModHz];
            d[DirectorDraw.ModCycles] = (float)((modDev * breathHz) / (Math.PI * 2 * modHz));
            for (int k = 0; k < 3; k++) d[DirectorDraw.SwayPhase + k] = (float)DirectorSeeds.Range(s, 5 + k, 0, 97);
            d[DirectorDraw.SwayAxis] = (float)DirectorSeeds.Range(s, 8, 0, Math.PI * 2);
            for (int k = 0; k < 3; k++) d[DirectorDraw.HeadDrift + k] = (float)DirectorSeeds.Range(s, 9 + k, 0, 97);
            d[DirectorDraw.NeckLagMs] = (float)DirectorSeeds.Range(s, 12, P.Head.NeckLagMs[0], P.Head.NeckLagMs[1]);
            d[DirectorDraw.LagMs] = (float)DirectorSeeds.Range(s, 13, P.Gaze.LagMs[0], P.Gaze.LagMs[1]);
            d[DirectorDraw.ReactionMs] = (float)DirectorSeeds.Range(s, 14, P.Fix.ReactionMs[0], P.Fix.ReactionMs[1]);
            d[DirectorDraw.ExertTauS] = (float)DirectorSeeds.Range(s, 15, P.Life.Exert.TauS[0], P.Life.Exert.TauS[1]);
            d[DirectorDraw.AmpModHz] = (float)DirectorSeeds.Range(s, 16, P.Life.Breath.AmpModHz[0], P.Life.Breath.AmpModHz[1]);
            for (int k = 0; k < 6; k++)
            {
                int o = DirectorDraw.EyeDrift + 3 * k;
                d[o] = (float)DirectorSeeds.Range(s, 20 + 3 * k, P.Gaze.DriftHz[0], P.Gaze.DriftHz[1]);
                d[o + 1] = (float)DirectorSeeds.Range(s, 21 + 3 * k, 0, Math.PI * 2);
                d[o + 2] = (float)DirectorSeeds.Range(s, 22 + 3 * k, P.Gaze.DriftDeg[0], P.Gaze.DriftDeg[1]);
            }
            return d;
        }

        /// <summary>
        /// The shape of blink <c>j</c> (draws from <c>seed</c>): closing 78 .. 118 ms, a short hold, opening 2 .. 2.8 times the
        /// closing, 18% partial. The whole blink then measures 206 .. 414 ms at the 2% edges.
        /// </summary>
        internal static BlinkShape BlinkShapeOf(uint seed, int j)
        {
            uint s = DirectorSeeds.Mix(seed, j);
            double close = Clamp(98 + 10 * DirectorSeeds.Gauss(s, 0), P.Blink.CloseMs[0], P.Blink.CloseMs[1]);
            double open = close * DirectorSeeds.Range(s, 3, P.Blink.OpenRatio[0], P.Blink.OpenRatio[1]);
            BlinkShape b;
            b.Close = close;
            b.Hold = DirectorSeeds.Range(s, 4, P.Blink.HoldMs[0], P.Blink.HoldMs[1]);
            b.Open = open;
            b.Depth = DirectorSeeds.U01(s, 5) < P.Blink.PartialP ? DirectorSeeds.Range(s, 6, P.Blink.PartialDepth[0], P.Blink.PartialDepth[1]) : 1;
            b.Skew = (DirectorSeeds.U01(s, 7) - 0.5) * 2 * P.Blink.SkewMs;
            return b;
        }

        /// <summary>Blinks: log-normal intervals, none inside the task window (a blink that would fall in it is deferred to just after).</summary>
        private static DoubleList Blinks(DirectorAnchors a, uint bk, float[] amp, TaskWindow win)
        {
            uint sg = DirectorSeeds.Mix(bk, 11);
            uint ss = DirectorSeeds.Mix(bk, 12);
            uint sd = DirectorSeeds.Mix(bk, 13);
            uint sr = DirectorSeeds.Mix(bk, 14);
            double cv = amp[DirectorAmp.BlinkCv];
            double meanS = amp[DirectorAmp.BlinkMeanS];
            double attend = a.Role == DirectorRole.Bowler ? P.Blink.AttendX.Bowler : P.Blink.AttendX.Striker;
            double skewMs = P.Blink.SkewMs;
            var o = new DoubleList();
            double t = a.Start + DirectorSeeds.LogNorm(P.Blink.FirstMeanMs, cv, DirectorSeeds.Gauss(sg, 0));
            for (int k = 0; t < a.End; k++)
            {
                BlinkShape b = BlinkShapeOf(ss, k);
                double total = b.Close + b.Hold + b.Open;
                if (Clashes(a, win, t, total))
                {
                    if (win.Has && t - skewMs < win.Hi && t + total + skewMs > win.Lo) t = win.Hi + skewMs + DirectorSeeds.Range(sr, 0, P.Blink.ReliefMs[0], P.Blink.ReliefMs[1]);
                    else if (t < a.Start + (a.SeamMs ?? 0) + skewMs + P.Blink.SeamMarginMs) t = a.Start + (a.SeamMs ?? 0) + skewMs + P.Blink.SeamMarginMs + DirectorSeeds.Range(sr, 0, P.Blink.ReliefMs[0], P.Blink.ReliefMs[1]);
                    else break; // across the seam at the end of a loop: no more blinks
                    if (Clashes(a, win, t, total)) break;
                }
                if (t + total > a.End) break;
                o.Add(t); o.Add(b.Close); o.Add(b.Hold); o.Add(b.Open); o.Add(b.Depth); o.Add(b.Skew);
                if (DirectorSeeds.U01(sd, 2 * k) < P.Blink.DoubleP)
                {
                    BlinkShape c = BlinkShapeOf(ss, 1000 + k);
                    double t2 = t + total + DirectorSeeds.Range(sd, 2 * k + 1, P.Blink.DoubleGapMs[0], P.Blink.DoubleGapMs[1]);
                    if (t2 + c.Close + c.Hold + c.Open < a.End && !Clashes(a, win, t2, c.Close + c.Hold + c.Open))
                    {
                        o.Add(t2); o.Add(c.Close); o.Add(c.Hold); o.Add(c.Open); o.Add(c.Depth); o.Add(c.Skew);
                        t = t2;
                    }
                }
                double mean = meanS * (!win.Has ? 1 : t < win.Lo ? attend : P.Blink.AfterX);
                t += Math.Max(P.Blink.MinGapMs, 1000 * DirectorSeeds.LogNorm(mean, cv, DirectorSeeds.Gauss(sg, k + 1)));
            }
            return o;
        }

        private static bool Clashes(DirectorAnchors a, TaskWindow win, double t, double total)
        {
            return (win.Has && t - P.Blink.SkewMs < win.Hi && t + total + P.Blink.SkewMs > win.Lo) || SeamClash(a, t, total);
        }

        /// <summary>The fixation list under construction: the sequential counter of the fixation stream and its helpers.</summary>
        private sealed class FixList
        {
            public readonly DoubleList Out = new DoubleList();
            private readonly uint sf;
            private readonly uint sb;
            private int j;

            public FixList(uint sf, uint sb)
            {
                this.sf = sf;
                this.sb = sb;
            }

            /// <summary>The next draw of the sequential fixation stream.</summary>
            public double U()
            {
                return DirectorSeeds.U01(sf, j++);
            }

            public double Rr(double[] r)
            {
                return r[0] + (r[1] - r[0]) * U();
            }

            /// <summary>The lag column is the pursuit lag (ms) for the ball and the downward angle (deg) for the ground.</summary>
            public void Add(double t, int target, int mode, double lag)
            {
                double lagColumn = target == TargetGround ? Rr(P.Gaze.GroundPitchDeg) : lag;
                double flag = DirectorSeeds.U01(sb, Out.Count / FixN) < P.Blink.ShiftP ? 1 : 0;
                Out.Add(t); Out.Add(target); Out.Add(mode); Out.Add(lagColumn); Out.Add(flag);
            }
        }

        /// <summary>Gaze fixations, in time order. Before the ball is visible they depend on the role and the draws only.</summary>
        private static DoubleList Fixations(DirectorAnchors a, uint bk, float[] d)
        {
            uint sx = DirectorSeeds.Mix(bk, 23);
            uint ss = DirectorSeeds.Mix(bk, 24);
            var fx = new FixList(DirectorSeeds.Mix(bk, 21), DirectorSeeds.Mix(bk, 22));
            bool bowler = a.Role == DirectorRole.Bowler;
            fx.Add(a.Start, TargetOpponent, 0, 0);
            if (!a.Release.HasValue)
            {
                double[] dwell = bowler ? P.Fix.IdleDwellMs.Bowler : P.Fix.IdleDwellMs.Striker;
                double t = a.Start;
                for (; ; )
                {
                    t += fx.Rr(dwell);
                    if (t >= a.End - P.Fix.IdleSeamMs) break;
                    double v = fx.U();
                    int kind = v < P.Fix.IdleGroundP ? TargetGround : !bowler && v < P.Fix.IdleGroundP + 0.15 ? TargetHand : TargetOpponent;
                    // now and then a look to the side of him (the field, the crowd), on its own draws so the rest of the scene is as it was
                    int len = fx.Out.Count;
                    bool side = !a.ReducedMotion && P.Fidget.SideGlanceP > DirectorSeeds.U01(ss, 3 * len) && kind == TargetOpponent;
                    if (side) fx.Add(t, TargetSide, 0, (DirectorSeeds.U01(ss, 3 * len + 1) < 0.5 ? -1 : 1) * DirectorSeeds.Range(ss, 3 * len + 2, P.Fidget.SideYawDeg[0], P.Fidget.SideYawDeg[1]));
                    else fx.Add(t, kind, 0, 0);
                }
                // A between-balls script loops: it ends on the opponent, where it began, so the wrap is not a jump of the gaze.
                fx.Add(a.End - P.Fix.IdleSeamMs + 500, TargetOpponent, 0, 0);
                return fx.Out;
            }
            double release = a.Release.Value;
            double lag = d[DirectorDraw.LagMs];
            if (bowler)
            {
                double g = a.Gather ?? release - 620;
                for (double t = a.Start + fx.Rr(P.Fix.BowlerDwellMs); t < g - 900; t += fx.Rr(P.Fix.BowlerDwellMs)) fx.Add(t, fx.U() < P.Fix.BowlerGroundP ? TargetGround : TargetOpponent, 0, 0);
                fx.Add(g + DirectorSeeds.Range(sx, 0, P.Fix.GatherMs[0], P.Fix.GatherMs[1]), TargetOpponent, 0, 0);
                fx.Add(release + DirectorSeeds.Range(sx, 1, P.Fix.AfterBallMs[0], P.Fix.AfterBallMs[1]), TargetBall, 1, lag);
                fx.Add(release + DirectorSeeds.Range(sx, 2, P.Fix.AfterOpponentMs[0], P.Fix.AfterOpponentMs[1]), TargetOpponent, 0, 0);
                fx.Add(release + DirectorSeeds.Range(sx, 3, P.Fix.AfterGroundMs[0], P.Fix.AfterGroundMs[1]), TargetGround, 0, 0);
                // Once the follow-through is over he is between balls again: his eyes go back to the idle dwell.
                if (a.FollowEnd.HasValue)
                {
                    double t = Math.Max(a.FollowEnd.Value, release + P.Fix.AfterGroundMs[1]) + fx.Rr(P.Fix.IdleDwellMs.Bowler);
                    for (; t < a.End - 500; t += fx.Rr(P.Fix.IdleDwellMs.Bowler)) fx.Add(t, fx.U() < P.Fix.IdleGroundP ? TargetGround : TargetOpponent, 0, 0);
                }
                return fx.Out;
            }
            bool hand = false;
            for (double t = a.Start + fx.Rr(P.Fix.StrikerDwellMs); t < release - 500; t += fx.Rr(P.Fix.StrikerDwellMs))
            {
                hand = !hand && fx.U() < P.Fix.StrikerHandP;
                fx.Add(t, hand ? TargetHand : TargetOpponent, 0, 0);
            }
            fx.Add(release + DirectorSeeds.Range(sx, 0, P.Fix.LockOnMs[0], P.Fix.LockOnMs[1]), TargetBall, 1, lag);
            if (a.OutcomeAt.HasValue)
            {
                // After the outcome (and not before): the ground for a wicket, a miss or a dot; back down the pitch, to the bowler, after a boundary.
                double[] row = string.IsNullOrEmpty(a.Outcome) ? null : P.React.Table.Row(a.Outcome);
                fx.Add(a.OutcomeAt.Value + d[DirectorDraw.ReactionMs], row != null && DirectorSeeds.U01(sx, 5) >= row[2] ? TargetOpponent : TargetGround, 0, 0);
            }
            else if (a.Dead.HasValue) fx.Add(a.Dead.Value + DirectorSeeds.Range(sx, 1, P.Fix.DeadGroundMs[0], P.Fix.DeadGroundMs[1]), TargetGround, 0, 0);
            return fx.Out;
        }

        /// <summary>Microsaccades: Poisson in time, small, mostly horizontal.</summary>
        private static DoubleList Micro(DirectorAnchors a, uint bk)
        {
            uint s = DirectorSeeds.Mix(bk, 31);
            uint sa = DirectorSeeds.Mix(bk, 32);
            var o = new DoubleList();
            double t = a.Start;
            for (int k = 0; ; k++)
            {
                t += (-Math.Log(1 - DirectorSeeds.U01(s, 5 * k)) / P.Gaze.MicroHz) * 1000;
                if (t >= a.End) break;
                double amp = DirectorSeeds.LogNorm(P.Gaze.MicroMeanDeg, P.Gaze.MicroCv, DirectorSeeds.Gauss(sa, k));
                double ang = DirectorSeeds.U01(s, 5 * k + 2) < P.Gaze.MicroHorizP ? (DirectorSeeds.U01(s, 5 * k + 3) < 0.5 ? 0 : Math.PI) : DirectorSeeds.U01(s, 5 * k + 4) * Math.PI * 2;
                o.Add(t); o.Add(amp * Math.Cos(ang)); o.Add(amp * Math.Sin(ang) * 0.6);
            }
            return o;
        }

        /// <summary>
        /// Fidgets: a stance adjust, a weight shift, a shoulder roll, a deep breath, one after another with log-normal gaps, every
        /// parameter a draw of the ball's key at a fixed index (the anchors only say where they may fall: between balls, the whole
        /// scene but its seam; in a delivery, the striker's waiting, until 1 s before the release; the bowler's run-up has none). A
        /// fidget is zero inside the quiet windows (the bake gates it like the breath and the sway) and in Reduced Motion.
        /// </summary>
        private static DoubleList Fidgets(DirectorAnchors a, uint bk, float[] amp)
        {
            uint sg = DirectorSeeds.Mix(bk, 63);
            uint sk = DirectorSeeds.Mix(bk, 64);
            uint sa = DirectorSeeds.Mix(bk, 62);
            var o = new DoubleList();
            bool idle = !a.Release.HasValue;
            bool bowler = a.Role == DirectorRole.Bowler;
            if (!idle && bowler) return o;
            double lo = (a.SeamMs ?? 0) > 0 ? a.Start + (a.SeamMs ?? 0) : a.Start;
            double hi = idle ? a.End - P.Fidget.IdleEndMs : a.Release.Value - P.Fidget.EndBeforeReleaseMs;
            double gain = (bowler ? P.Fidget.RoleX.Bowler : P.Fidget.RoleX.Striker) * amp[DirectorAmp.FidgetX];
            double[] gap = bowler ? P.Fidget.GapS.Bowler : P.Fidget.GapS.Striker;
            double gapMean = gap[0];
            double gapCv = gap[1];
            double t = lo + DirectorSeeds.Range(sg, 1000, P.Fidget.FirstMs[0], P.Fidget.FirstMs[1]);
            for (int k = 0; k < 400; k++)
            {
                double pick = DirectorSeeds.U01(sk, k);
                int kind = pick < P.Fidget.KindCum[0] ? FidgetWeight : pick < P.Fidget.KindCum[1] ? FidgetStance : pick < P.Fidget.KindCum[2] ? FidgetShoulder : FidgetBreath;
                double dur;
                double b1;
                double b2;
                double b3;
                double dir = Sgn(sa, k, 0);
                if (kind == FidgetWeight)
                {
                    dur = R(sa, k, 1, P.Fidget.DurMs.Weight[0], P.Fidget.DurMs.Weight[1]);
                    b1 = dir * R(sa, k, 2, P.Fidget.Weight.SwayMm[0], P.Fidget.Weight.SwayMm[1]) * gain;
                    b2 = dir * R(sa, k, 3, P.Fidget.Weight.RollDeg[0], P.Fidget.Weight.RollDeg[1]) * gain;
                    b3 = 0;
                }
                else if (kind == FidgetStance)
                {
                    dur = R(sa, k, 1, P.Fidget.DurMs.Stance[0], P.Fidget.DurMs.Stance[1]);
                    b1 = dir * R(sa, k, 2, P.Fidget.Stance.SwayZMm[0], P.Fidget.Stance.SwayZMm[1]) * gain;
                    b2 = Sgn(sa, k, 4) * R(sa, k, 3, P.Fidget.Stance.TwistDeg[0], P.Fidget.Stance.TwistDeg[1]) * gain;
                    b3 = R(sa, k, 5, P.Fidget.Stance.PostureDeg[0], P.Fidget.Stance.PostureDeg[1]) * gain;
                }
                else if (kind == FidgetShoulder)
                {
                    dur = R(sa, k, 1, P.Fidget.DurMs.Shoulder[0], P.Fidget.DurMs.Shoulder[1]);
                    b1 = R(sa, k, 2, P.Fidget.Shoulder.TwistDeg[0], P.Fidget.Shoulder.TwistDeg[1]) * gain;
                    b2 = R(sa, k, 3, P.Fidget.Shoulder.PostureDeg[0], P.Fidget.Shoulder.PostureDeg[1]) * gain;
                    b3 = P.Fidget.Shoulder.Cycles;
                }
                else
                {
                    dur = R(sa, k, 1, P.Fidget.DurMs.Breath[0], P.Fidget.DurMs.Breath[1]);
                    b1 = R(sa, k, 2, P.Fidget.Breath.PostureDeg[0], P.Fidget.Breath.PostureDeg[1]) * gain;
                    b2 = 0;
                    b3 = 0;
                    dir = 1;
                }
                if (t + dur > hi) break;
                o.Add(t); o.Add(kind); o.Add(dur); o.Add(b1); o.Add(b2); o.Add(b3); o.Add(dir); o.Add(0);
                t += dur + 1000 * DirectorSeeds.LogNorm(gapMean, gapCv, DirectorSeeds.Gauss(sg, k));
            }
            return o;
        }

        private static double R(uint sa, int k, int i, double lo, double hi)
        {
            return DirectorSeeds.Range(sa, 8 * k + i, lo, hi);
        }

        private static double Sgn(uint sa, int k, int i)
        {
            return DirectorSeeds.U01(sa, 8 * k + i) < 0.5 ? -1 : 1;
        }

        /// <summary>
        /// The reaction to the outcome: none until the physics has confirmed it, then one event at <c>OutcomeAt</c> plus the seeded
        /// 180 to 380 ms (the same latency as the eyes' move). What the outcome decides is how much and which way (params
        /// react.table: valence, strength); every other number is a draw of the key at a fixed index, so two outcomes of one ball
        /// differ only from that moment. The bowler's valence is the opposite of the batter's and weaker.
        /// </summary>
        private static DoubleList Reaction(DirectorAnchors a, uint bk, float[] d)
        {
            var o = new DoubleList();
            double[] row = a.OutcomeAt.HasValue && !string.IsNullOrEmpty(a.Outcome) ? P.React.Table.Row(a.Outcome) : null;
            if (row == null || !a.OutcomeAt.HasValue) return o;
            uint sr = DirectorSeeds.Mix(bk, 71);
            bool bowler = a.Role == DirectorRole.Bowler;
            double v = row[0] * (bowler ? P.React.BowlerValenceX : 1);
            double s = row[1] * (bowler ? P.React.BowlerStrengthX : 1);
            double shake = v < -P.React.ShakeFrom ? (DirectorSeeds.U01(sr, 4) < 0.5 ? -1 : 1) * P.React.ShakeDeg * -v * s : 0;
            double slow = a.ReducedMotion ? P.Expr.SlowRm : 1;
            o.Add(a.OutcomeAt.Value + d[DirectorDraw.ReactionMs]);
            o.Add(v);
            o.Add(s);
            o.Add(slow * DirectorSeeds.Range(sr, 0, P.React.RiseMs[0], P.React.RiseMs[1]));
            o.Add(slow * DirectorSeeds.Range(sr, 1, P.React.HoldMs[0], P.React.HoldMs[1]));
            o.Add(slow * DirectorSeeds.Range(sr, 2, P.React.DecayMs[0], P.React.DecayMs[1]));
            o.Add(shake);
            o.Add(DirectorSeeds.Range(sr, 3, P.React.ShakeHz[0], P.React.ShakeHz[1]));
            o.Add((v > 0 ? P.React.HeadUpDeg * v : -P.React.HeadDownDeg * v) * s);
            o.Add(P.React.Exhale * s);
            o.Add(row[3] * s);
            o.Add(row[4] * s);
            return o;
        }

        /// <summary>The plan of one actor in one script.</summary>
        public static DirectorEvents Build(DirectorAnchors a)
        {
            if (a == null) throw new ArgumentNullException(nameof(a));
            uint pk = DirectorSeeds.PersonKey(a.Person, a.Role);
            uint bk = DirectorSeeds.BallKey(a.Key, pk);
            float[] amp = Persons(pk, a.Role);
            float[] draw = Draws(bk, amp);
            var ev = new DirectorEvents();
            ev.Fix = Fixations(a, bk, draw).ToFloats();
            ev.Blink = Blinks(a, bk, amp, TaskWindowOf(a)).ToFloats();
            ev.Micro = Micro(a, bk).ToFloats();
            ev.Fidget = Fidgets(a, bk, amp).ToFloats();
            ev.React = Reaction(a, bk, draw).ToFloats();
            ev.Draw = draw;
            ev.Amp = amp;
            return ev;
        }
    }
}
