using System;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// A line-for-line C# port of the frozen physics batter body, src/physics/bat.ts batterBody(footwork, flight), in
    /// the striker's right-handed physics frame (no reflection here; presentation reflects x once). Pure: footwork and
    /// flight only. The lead's 5f body ruling (2026-11-04): the legs plant on these pads by contact, and the trunk goes
    /// towards torsoTop and headCentre. Parity: tests/fixtures/unity-practice/batter-body-v1.json, generated from TS,
    /// asserted equal within 1 mm (BatterBodyParityTests).
    /// </summary>
    public static class ProductionBatterBodyModel
    {
        public const double PitchHalf = 10.06;
        public const double PadR = 0.075;
        public const double PadBottom = 0.06;
        public const double PadTop = 0.62;
        public const double TorsoR = 0.16;
        public const double TorsoBottom = 0.7;
        public const double TorsoTop = 1.42;
        public const double HeadR = 0.12;
        public const double HeadY = 1.62;
        private const double ContactForward = 1.8;
        private const double ContactNeutral = 1.5;
        private const double ContactBack = 1.05;
        private const double ContactDownTrack = 2.9;

        public struct Point
        {
            public double X;
            public double Y;
            public double Z;

            public Point(double x, double y, double z)
            {
                X = x;
                Y = y;
                Z = z;
            }
        }

        public struct Capsule
        {
            public Point A;
            public Point B;
            public double R;
        }

        public struct Body
        {
            /// <summary>Null: the stance (a leave or no stroke).</summary>
            public string Footwork;
            public Point Stance;
            public Capsule FrontPad;
            public Capsule BackPad;
            public Capsule Torso;
            public Point HeadCentre;
            public double HeadR;
        }

        private static double Clamp(double v, double lo, double hi) => v < lo ? lo : v > hi ? hi : v;

        private static double Smooth01(double t)
        {
            var c = Clamp(t, 0.0, 1.0);
            return c * c * (3.0 - 2.0 * c);
        }

        private static Capsule Pad(double x, double z) => new Capsule
        {
            A = new Point(x, PadBottom, z), B = new Point(x, PadTop, z), R = PadR
        };

        /// <summary>z of the contact plane for an explicit footwork ("across" plays from the neutral plane).</summary>
        public static double ContactPlaneZ(string footwork)
        {
            switch (footwork)
            {
                case "forward": return PitchHalf - ContactForward;
                case "back": return PitchHalf - ContactBack;
                case "down_track": return PitchHalf - ContactDownTrack;
                case "across": return PitchHalf - ContactNeutral;
                default: throw new ArgumentOutOfRangeException(nameof(footwork));
            }
        }

        /// <summary>Time the ball first reaches z (linear between samples), or null (delivery.ts timeAtZ).</summary>
        public static double? TimeAtZ(BallTraceSample[] samples, double z)
        {
            for (var i = 1; i < samples.Length; i++)
            {
                var a = samples[i - 1];
                var b = samples[i];
                if (a.p.z < z && b.p.z >= z) return a.t + (z - a.p.z) / (b.p.z - a.p.z) * (b.t - a.t);
            }
            return samples.Length > 0 && samples[0].p.z >= z ? samples[0].t : (double?)null;
        }

        /// <summary>Ball position at t (linear between samples, clamped; delivery.ts sampleAt's uniform-step index).</summary>
        public static Point SampleAt(BallTraceSample[] samples, double t)
        {
            var n = samples.Length;
            if (t <= samples[0].t) return P(samples[0].p);
            if (t >= samples[n - 1].t) return P(samples[n - 1].p);
            var dt = samples[1].t - samples[0].t;
            var i = (int)Math.Floor((t - samples[0].t) / dt);
            if (i < 0) i = 0;
            if (i > n - 2) i = n - 2;
            var a = samples[i];
            var b = samples[i + 1];
            var g = (t - a.t) / (b.t - a.t);
            return new Point(a.p.x + (b.p.x - a.p.x) * g, a.p.y + (b.p.y - a.p.y) * g, a.p.z + (b.p.z - a.p.z) * g);
        }

        private static Point P(TraceVector3 v) => new Point(v.x, v.y, v.z);

        /// <summary>bat.ts resolveFootwork(flight, 'auto'): forward when the ideal contact is on the forward plane.</summary>
        private static string ResolveAuto(BallTraceSample[] samples, double idealContactT)
        {
            var z = SampleAt(samples, idealContactT).Z;
            return Math.Abs(z - (PitchHalf - ContactForward)) < 0.05 ? "forward" : "back";
        }

        /// <summary>The ball's arrival at the footwork's contact plane (bat.ts idealTimeFor with resolveAutoMatch).</summary>
        public static double IdealTimeFor(BallTraceSample[] samples, double idealContactT, string footwork) =>
            IdealTime(samples, idealContactT, footwork);

        /// <summary>bat.ts idealTimeFor with resolveAutoMatch for forward/back.</summary>
        private static double IdealTime(BallTraceSample[] samples, double idealContactT, string footwork)
        {
            var effective = footwork;
            if (footwork == "forward" || footwork == "back")
                effective = ResolveAuto(samples, idealContactT) == footwork ? "auto" : footwork;
            if (effective == "auto") return idealContactT;
            return TimeAtZ(samples, ContactPlaneZ(effective)) ?? idealContactT;
        }

        /// <summary>The body for a played footwork ("forward", "back", "across", "down_track") or null (the stance).</summary>
        public static Body For(string footwork, BallTraceSample[] samples, double idealContactT)
        {
            if (string.IsNullOrEmpty(footwork) || samples == null || samples.Length == 0)
            {
                var f0 = Pad(-0.16, PitchHalf - 1.44);
                var b0 = Pad(-0.14, PitchHalf - 0.76);
                return new Body
                {
                    Footwork = null,
                    Stance = new Point(-0.15, 0.0, PitchHalf - 1.1),
                    FrontPad = f0,
                    BackPad = b0,
                    Torso = new Capsule
                    {
                        A = new Point(-0.3, TorsoBottom, PitchHalf - 1.08),
                        B = new Point(-0.3, TorsoTop, PitchHalf - 1.12),
                        R = TorsoR
                    },
                    HeadCentre = new Point(-0.2, HeadY, PitchHalf - 1.2),
                    HeadR = HeadR
                };
            }
            var t = IdealTime(samples, idealContactT, footwork);
            var c = SampleAt(samples, t);
            var zc = footwork == "forward" || footwork == "back" ? c.Z : ContactPlaneZ(footwork);
            var x = Clamp(c.X, -0.6, 0.75);
            Capsule front, back;
            double tx, tz;
            Point head;
            var crouch = 0.0;
            var leanX = 0.0;
            switch (footwork)
            {
                case "forward":
                case "down_track":
                    front = Pad(x - 0.27, zc + 0.12);
                    back = footwork == "forward" ? Pad(-0.14, PitchHalf - 0.72) : Pad(x - 0.35, zc + 0.7);
                    tx = x - 0.15;
                    tz = zc + 0.2;
                    head = new Point(x - 0.12, HeadY - 0.1, zc + 0.25);
                    break;
                case "back":
                {
                    back = Pad(x - 0.18, zc + 0.12);
                    front = Pad(x - 0.32, zc - 0.25);
                    tx = x - 0.32;
                    tz = zc + 0.25;
                    head = new Point(x - 0.18, HeadY, zc + 0.1);
                    var lowRead = 1.0 - Smooth01((c.Y - 0.12) / 0.2);
                    crouch = 0.03 * lowRead;
                    var towardsRead = c.X - (tx + 0.04);
                    leanX = Math.Sign(towardsRead) * Math.Min(Math.Abs(towardsRead), 0.04 * lowRead);
                    break;
                }
                case "across":
                    back = Pad(x - 0.15, zc + 0.15);
                    front = Pad(x - 0.28, zc - 0.3);
                    tx = x - 0.3;
                    tz = zc + 0.25;
                    head = new Point(x - 0.15, HeadY, zc + 0.1);
                    break;
                default:
                    throw new ArgumentOutOfRangeException(nameof(footwork));
            }
            Func<Point, Point> lower = value => crouch == 0.0 ? value : new Point(value.X, value.Y - crouch, value.Z);
            var stride = footwork == "forward" || footwork == "down_track";
            return new Body
            {
                Footwork = footwork,
                Stance = new Point((front.A.X + back.A.X) / 2.0, 0.0, (front.A.Z + back.A.Z) / 2.0),
                FrontPad = new Capsule { A = front.A, B = lower(front.B), R = front.R },
                BackPad = new Capsule { A = back.A, B = lower(back.B), R = back.R },
                Torso = new Capsule
                {
                    A = lower(stride
                        ? new Point(0.65 * front.A.X + 0.35 * back.A.X, TorsoBottom, 0.65 * front.A.Z + 0.35 * back.A.Z)
                        : new Point(tx + leanX * 0.35, TorsoBottom, tz)),
                    B = lower(new Point(tx + 0.04 + leanX, TorsoTop, tz - 0.06)),
                    R = TorsoR
                },
                HeadCentre = lower(new Point(head.X + leanX, head.Y, head.Z)),
                HeadR = HeadR
            };
        }
    }
}
