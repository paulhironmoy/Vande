using System;
using System.Collections.Generic;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// TEST FIXTURE ONLY: a C# port of tests/unit/render3d/director/world.ts, the small deterministic cricket world the
    /// Director's tests (and golden.json) are made in. It is not the physics: a ballistic ball with one bounce, a bowler running
    /// in on a straight line and a striker at the crease, only so that the directions the Director asks for (to the ball, the
    /// bowler's head and hand) have the right geometry. Metres: x across the pitch, y up, z down the pitch from the bowler's end
    /// (-z) to the striker's (+z). Angles as in DirectorChannels: yaw + left, pitch + down. The arithmetic is the web's, in the web's
    /// order, in double.
    /// </summary>
    internal struct P3
    {
        public double X;
        public double Y;
        public double Z;

        public P3(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }
    }

    internal sealed class TestBallSpec
    {
        public double SpeedKph = 136;
        /// <summary>Metres in front of the striker's stumps where the ball pitches.</summary>
        public double LengthM = 6;
        /// <summary>Lateral line at the stumps (m).</summary>
        public double LineM = 0.05;
        public double Variation;
        /// <summary>four, six, two, caught, dot, missed, leave, bowled.</summary>
        public string Outcome = "four";

        public TestBallSpec Clone()
        {
            return (TestBallSpec)MemberwiseClone();
        }
    }

    /// <summary>The scene timeline of one delivery (scene ms), the way the stage's script has it.</summary>
    internal sealed class TestTimeline
    {
        public double Start;
        public double Gather;
        public double Release;
        public double End;
        public double? Swing;
        public double? Contact;
        /// <summary>The ball passes the batter's crease (flight without contact).</summary>
        public double PassAt;
        public double OutcomeAt;
        public double Dead;
        public double? StrokeEnd;
        public double Runs;
    }

    internal sealed class TestDelivery
    {
        private const double G = 9.81;
        private const double BallR = 0.036;
        public const double PitchHalf = 10.06;
        public static readonly P3 Rel = new P3(0.32, 2.1, -PitchHalf + 1.22 + 0.15);
        private static readonly double CreaseZ = PitchHalf - 1.22 + 0.1;

        public static readonly string[] Outcomes = { "four", "six", "two", "caught", "dot", "missed", "leave", "bowled" };

        /// <summary>How the crowd reads each test outcome (emotion.ts EmotionOutcome): the category the striker's reaction follows.</summary>
        public static string CategoryOf(string outcome)
        {
            switch (outcome)
            {
                case "four": return "four";
                case "six": return "six";
                case "two": return "runs";
                case "caught": return "wicket";
                case "dot": return "dot";
                case "missed": return "close_call";
                case "leave": return "leave";
                case "bowled": return "wicket";
                default: throw new ArgumentException("unknown test outcome " + outcome);
            }
        }

        public readonly TestBallSpec Spec;
        public readonly TestTimeline Timeline;
        private readonly double release;
        private readonly double vz0;
        private readonly double bz;
        private readonly double tb;
        private readonly double vy0;
        private readonly double vyb;
        private readonly double vz1;
        private readonly double vx;
        private readonly double tc;
        private readonly bool hasContact;
        private readonly P3 pc;
        private readonly double phi;
        private readonly double tKeeper;
        private readonly double tStumps;

        public TestDelivery(TestBallSpec spec, double release = 2420)
        {
            Spec = spec;
            this.release = release;
            vz0 = (spec.SpeedKph / 3.6) * 0.985;
            bz = PitchHalf - spec.LengthM;
            tb = (bz - Rel.Z) / vz0;
            vy0 = (BallR - Rel.Y + 0.5 * G * tb * tb) / tb;
            vyb = -(vy0 - G * tb);
            vz1 = vz0 * 0.88;
            vx = (spec.LineM - Rel.X) / ((PitchHalf - Rel.Z) / vz0);
            double tPass = tb + (CreaseZ - bz) / vz1;
            bool hits = spec.Outcome == "four" || spec.Outcome == "six" || spec.Outcome == "two" || spec.Outcome == "caught" || spec.Outcome == "dot";
            bool swung = hits || spec.Outcome == "missed" || spec.Outcome == "bowled";
            hasContact = hits;
            double contactS = hits ? tPass : 0;
            tc = hits ? contactS : tPass;
            pc = Flight(tc);
            // After the bat: a low drive, a lofted six, a catch, a defended dot.
            phi = (spec.LineM - 0.05) * 0.8 + 0.25;
            // Without contact the ball goes on to the keeper (gathered at z = 11.6) or into the stumps.
            tKeeper = tb + (11.6 - bz) / (vz1 * 0.9);
            tStumps = tb + (PitchHalf - bz) / vz1;

            double r0 = release;
            double outcomeAt;
            switch (spec.Outcome)
            {
                case "four": outcomeAt = r0 + (tc + 3.7) * 1000; break;
                case "six": outcomeAt = r0 + (tc + 2.7) * 1000; break;
                case "two": outcomeAt = r0 + (tc + 3.0) * 1000; break;
                case "caught": outcomeAt = r0 + (tc + 2.86) * 1000; break;
                case "dot": outcomeAt = r0 + (tc + 2.2) * 1000; break;
                case "bowled": outcomeAt = r0 + tStumps * 1000; break;
                default: outcomeAt = r0 + tKeeper * 1000; break;
            }
            double? swing = swung ? r0 + tc * 1000 - 260 : (double?)null;
            double dead = outcomeAt + (spec.Outcome == "dot" ? 0 : 500);
            Timeline = new TestTimeline
            {
                Start = 0,
                Gather = r0 - 620,
                Release = r0,
                End = Math.Max(dead + 1800, r0 + 6000),
                Swing = swing,
                Contact = hasContact ? r0 + contactS * 1000 : (double?)null,
                PassAt = r0 + tPass * 1000,
                OutcomeAt = outcomeAt,
                Dead = dead,
                StrokeEnd = swing == null ? r0 + tPass * 1000 + 300 : swing + 900,
                Runs = spec.Outcome == "two" ? 2 : 0,
            };
        }

        private P3 Flight(double s)
        {
            if (s <= tb) return new P3(Rel.X + vx * s, Rel.Y + vy0 * s - 0.5 * G * s * s, Rel.Z + vz0 * s);
            double r = s - tb;
            return new P3(Rel.X + vx * s, Math.Max(BallR, BallR + 0.53 * vyb * r - 0.5 * G * r * r), bz + vz1 * r);
        }

        private P3 After(double r)
        {
            double hx = Math.Sin(phi);
            double hz = -Math.Cos(phi);
            switch (Spec.Outcome)
            {
                case "four":
                {
                    double d = 25 * r - 2 * r * r;
                    return new P3(pc.X + hx * d, Math.Max(BallR, pc.Y + 3 * r - 0.5 * G * r * r), pc.Z + hz * d);
                }
                case "two":
                {
                    double d = 12 * r - r * r;
                    return new P3(pc.X + hx * d, Math.Max(BallR, pc.Y + 2 * r - 0.5 * G * r * r), pc.Z + hz * d);
                }
                case "six":
                {
                    double d = 26 * r;
                    return new P3(pc.X + hx * d, Math.Max(BallR, pc.Y + 18 * r - 0.5 * G * r * r), pc.Z + hz * d);
                }
                case "caught":
                {
                    double d = 14 * r;
                    return new P3(pc.X + hx * d, Math.Max(BallR, pc.Y + 14 * r - 0.5 * G * r * r), pc.Z + hz * d);
                }
                default:
                {
                    double d = Math.Min(1.5, 3 * r - r * r);
                    return new P3(pc.X + hx * d, Math.Max(BallR, pc.Y + 1.5 * r - 0.5 * G * r * r), pc.Z + hz * d);
                }
            }
        }

        private P3 RelAt(double s)
        {
            if (Spec.Outcome == "bowled" && s > tStumps)
            {
                double r = s - tStumps;
                return new P3(Flight(tStumps).X, Math.Max(BallR, 0.4 - 0.5 * G * r * r), PitchHalf + 1.2 * r);
            }
            if (s > tKeeper) return new P3(Flight(tKeeper).X * 0.5, 0.9, 11.6);
            return Flight(s);
        }

        /// <summary>The ball as drawn at scene ms t, or false when it is not drawn. <paramref name="pre"/> is the flight before the result is known.</summary>
        public bool Ball(double tMs, bool pre, out P3 p)
        {
            p = default(P3);
            if (tMs < 0) return false;
            if (tMs < release)
            {
                p = BowlerHand(tMs, release);
                return true;
            }
            double s = (tMs - release) / 1000;
            if (tMs > Timeline.Dead && !pre) return false;
            if (!hasContact || pre || s <= tc) p = RelAt(s);
            else p = After(s - tc);
            return true;
        }

        /// <summary>Hand and head of the bowler, scene ms.</summary>
        public static P3 BowlerHead(double t, double release)
        {
            double u = Math.Min(1, Math.Max(0, (t - 300) / (release - 300)));
            double ease = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
            double zRun = -21 + (-9.3 + 21) * ease;
            double after = Math.Min(1.6, Math.Max(0, (t - release) / 1000));
            return new P3(0.2, 1.78 - 0.04 * Math.Sin(t / 95) * (u > 0 && t < release ? 1 : 0.3), t < release ? zRun : -9.3 + 1.1 * after);
        }

        public static P3 BowlerHand(double t, double release)
        {
            P3 h = BowlerHead(t, release);
            double u = Math.Min(1, Math.Max(0, (t - (release - 600)) / 600));
            double s = u * u * (3 - 2 * u);
            return new P3(h.X + 0.12 + (Rel.X - h.X - 0.12) * s, h.Y - 0.7 + (Rel.Y - h.Y + 0.7) * s, h.Z + 0.1 + (Rel.Z - h.Z - 0.1) * s);
        }
    }

    /// <summary>The bowler's clip-head measurements (tests/unit/render3d/director/fixtures/bowler-clip-head.json), one series per action.</summary>
    internal sealed class ClipSeries
    {
        public double T0;
        public double DtMs;
        public double[] Yaw;
        public double[] Pitch;

        public static Dictionary<string, ClipSeries> Parse(string json)
        {
            var result = new Dictionary<string, ClipSeries>();
            Dictionary<string, object> series = TinyJson.Obj(TinyJson.Obj(TinyJson.Parse(json))["series"]);
            foreach (KeyValuePair<string, object> kv in series)
            {
                Dictionary<string, object> s = TinyJson.Obj(kv.Value);
                result[kv.Key] = new ClipSeries { T0 = TinyJson.Num(s["t0"]), DtMs = TinyJson.Num(s["dtMs"]), Yaw = TinyJson.Doubles(s["yaw"]), Pitch = TinyJson.Doubles(s["pitch"]) };
            }
            return result;
        }
    }

    /// <summary>The test world's answers to the Director (world.ts anchorsFor / idleAnchors callbacks).</summary>
    internal sealed class TestWorld : IDirectorWorld
    {
        private static readonly double Deg = 180 / Math.PI;
        /// <summary>The striker's eye (camera.ts BATTER_EYE: height 1.68, lateral 0.2, 1.2 m in front of the stumps).</summary>
        public static readonly P3 EyeS = new P3(-0.2, 1.68, TestDelivery.PitchHalf - 1.2);
        public static readonly P3 BatterHead = new P3(-0.15, 1.58, 8.9);
        public static readonly P3 Stand = new P3(0.2, 1.78, -9.9);

        public DirectorRole Role;
        /// <summary>Null for a scene between balls (no release, no ball).</summary>
        public TestDelivery Delivery;
        public bool Pre;
        /// <summary>The P3 callback honours aheadMs (the production callback does); off, it is the pure-latency mode.</summary>
        public bool Lead;
        /// <summary>The clip-head model of the web: "real" (default), "locked", "whip" or "none".</summary>
        public string Clip = "real";
        public ClipSeries Series;
        private double Release
        {
            get { return Delivery.Timeline.Release; }
        }

        /// <summary>Hypot as V8 computes it (Kahan-summed scaled squares), so the test world's directions match the web's to the bit.</summary>
        internal static double Hypot(double x, double y)
        {
            double ax = Math.Abs(x);
            double ay = Math.Abs(y);
            double max = Math.Max(ax, ay);
            if (double.IsInfinity(max)) return double.PositiveInfinity;
            if (double.IsNaN(x) || double.IsNaN(y)) return double.NaN;
            if (max == 0) return 0;
            double sum = 0;
            double comp = 0;
            for (int i = 0; i < 2; i++)
            {
                double n = (i == 0 ? ax : ay) / max;
                double summand = n * n - comp;
                double prelim = sum + summand;
                comp = (prelim - sum) - summand;
                sum = prelim;
            }
            return Math.Sqrt(sum) * max;
        }

        private static void DirOf(DirectorRole role, P3 eye, P3 p, double[] output)
        {
            double fwd = role == DirectorRole.Bowler ? p.Z - eye.Z : eye.Z - p.Z;
            double left = role == DirectorRole.Bowler ? p.X - eye.X : eye.X - p.X;
            output[0] = Math.Atan2(left, fwd) * Deg;
            output[1] = Math.Atan2(eye.Y - p.Y, Hypot(fwd, left)) * Deg;
        }

        private P3 EyeB(double ms)
        {
            return TestDelivery.BowlerHead(ms, Release);
        }

        private P3 EyeOf(double ms)
        {
            return Role == DirectorRole.Bowler ? EyeB(ms) : EyeS;
        }

        public bool Aim(DirectorAim target, double tMs, double[] output)
        {
            if (Delivery == null)
            {
                P3 eyeIdle = Role == DirectorRole.Bowler ? Stand : EyeS;
                P3 to = target == DirectorAim.Hand ? new P3(Stand.X + 0.12, 1.1, Stand.Z + 0.1) : Role == DirectorRole.Bowler ? BatterHead : Stand;
                DirOf(Role, eyeIdle, to, output);
                return true;
            }
            P3 opponent = Role == DirectorRole.Bowler ? BatterHead : EyeB(tMs);
            DirOf(Role, EyeOf(tMs), target == DirectorAim.Hand ? TestDelivery.BowlerHand(tMs, Release) : opponent, output);
            return true;
        }

        public bool VisibleBall(double tMs, double[] output, double aheadMs)
        {
            if (Delivery == null) return false;
            P3 p;
            if (!Delivery.Ball(tMs, Pre, out p)) return false;
            double ahead = Lead ? aheadMs : 0;
            P3 q = p;
            if (ahead > 0)
            {
                // Constant velocity from the ball at ms and 10 ms before it: nothing later than ms.
                P3 p2;
                if (Delivery.Ball(tMs - 10, Pre, out p2))
                {
                    double k = ahead / 10;
                    q = new P3(p.X + (p.X - p2.X) * k, p.Y + (p.Y - p2.Y) * k, p.Z + (p.Z - p2.Z) * k);
                }
            }
            DirOf(Role, EyeOf(tMs + ahead), q, output);
            return true;
        }

        public void ClipHead(double tMs, double[] output)
        {
            if (Delivery == null)
            {
                output[0] = Role == DirectorRole.Striker ? 11.3 : 0;
                output[1] = Role == DirectorRole.Striker ? 2.9 : 0;
                output[2] = 0;
                return;
            }
            output[2] = 0;
            if (Role == DirectorRole.Striker || Clip == "none")
            {
                output[0] = Role == DirectorRole.Striker ? 11.3 : 0;
                output[1] = Role == DirectorRole.Striker ? 2.9 : 0;
                return;
            }
            // Bowler: the batter's direction plus the measured error.
            DirOf(DirectorRole.Bowler, EyeB(tMs), BatterHead, output);
            if (Series == null) return;
            double f = Math.Min(Series.Yaw.Length - 1, Math.Max(0, (tMs - Series.T0) / Series.DtMs));
            int i = (int)Math.Min(Series.Yaw.Length - 2, Math.Floor(f));
            double w = f - i;
            output[0] += Series.Yaw[i] + (Series.Yaw[i + 1] - Series.Yaw[i]) * w;
            output[1] += Series.Pitch[i] + (Series.Pitch[i + 1] - Series.Pitch[i]) * w;
        }
    }

    /// <summary>Anchors for the test world (world.ts anchorsFor / idleAnchors) and the tests' own small generator.</summary>
    internal static class TestAnchors
    {
        /// <summary>Anchors for one actor of a delivery (world.ts anchorsFor). Overlay mode and the default person, as the web's tests have them.</summary>
        public static DirectorAnchors For(TestDelivery d, DirectorRole role, string key, string person = "look-1", bool reducedMotion = false, double headPx = 40, bool pre = false, bool lead = false, string clip = "real", ClipSeries series = null)
        {
            TestTimeline t = d.Timeline;
            var world = new TestWorld { Role = role, Delivery = d, Pre = pre, Lead = lead, Clip = clip, Series = series };
            bool bowler = role == DirectorRole.Bowler;
            return new DirectorAnchors
            {
                Role = role,
                Person = person,
                Key = key,
                Start = t.Start,
                End = t.End,
                Gather = bowler ? t.Gather : (double?)null,
                Release = t.Release,
                Swing = pre || bowler ? null : t.Swing,
                Contact = pre || bowler ? null : t.Contact,
                TaskEnd = pre ? t.PassAt : t.Contact ?? t.PassAt,
                OutcomeAt = pre ? (double?)null : t.OutcomeAt,
                Outcome = pre || bowler ? null : TestDelivery.CategoryOf(d.Spec.Outcome),
                Dead = pre ? (double?)null : t.Dead,
                StrokeEnd = pre || bowler ? null : t.StrokeEnd,
                Runs = pre ? 0 : t.Runs,
                ReducedMotion = reducedMotion,
                HeadPx = headPx,
                HeadMode = DirectorHeadMode.Overlay,
                World = world,
            };
        }

        /// <summary>Anchors for a script between deliveries (world.ts idleAnchors): no release, no ball.</summary>
        public static DirectorAnchors Idle(DirectorRole role, string key, double endMs, string person = "look-1", bool reducedMotion = false)
        {
            return new DirectorAnchors
            {
                Role = role,
                Person = person,
                Key = key,
                Start = 0,
                End = endMs,
                Runs = 0,
                ReducedMotion = reducedMotion,
                HeadPx = 40,
                HeadMode = DirectorHeadMode.Overlay,
                World = new TestWorld { Role = role },
            };
        }

        /// <summary>The stage's setting of an anchors object: space mode, with the bowler's run start and follow-through end (golden.test.ts anchorsOf).</summary>
        public static DirectorAnchors AsStage(DirectorAnchors a, string outcome, bool runAnchors)
        {
            DirectorAnchors s = a.Clone();
            s.HeadMode = DirectorHeadMode.Space;
            s.Outcome = outcome;
            if (runAnchors && a.Role == DirectorRole.Bowler)
            {
                s.RunStart = 300;
                s.FollowEnd = a.Release.Value + 1500;
            }
            return s;
        }
    }

    /// <summary>A small deterministic generator for the tests' own draws (mulberry32); never the Director's.</summary>
    internal sealed class TestRng
    {
        private uint a;

        public TestRng(uint seed)
        {
            a = seed;
        }

        public double Next()
        {
            unchecked
            {
                a += 0x6d2b79f5u;
                uint t = a;
                t = (uint)((int)(t ^ (t >> 15)) * (int)(t | 1));
                t ^= t + (uint)((int)(t ^ (t >> 7)) * (int)(t | 61));
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        /// <summary>A varied delivery: 90 .. 150 km/h, 1 .. 11 m length, a line within 0.6 m, one of eight variations, any outcome.</summary>
        public TestBallSpec RandomSpec()
        {
            var s = new TestBallSpec();
            s.SpeedKph = 90 + Next() * 60;
            s.LengthM = 1 + Next() * 10;
            s.LineM = (Next() - 0.5) * 1.2;
            s.Variation = Math.Floor(Next() * 8);
            s.Outcome = TestDelivery.Outcomes[(int)Math.Floor(Next() * TestDelivery.Outcomes.Length)];
            return s;
        }
    }
}
