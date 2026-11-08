using System;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// The geometry of one script as the Unity world DRAWS it, for the Director's bake (runtime.ts `anchors`: eye, hand, visibleBall), in the
    /// physics frame. A snapshot of one delivery: nothing here reads the world's mutable state, so it answers the same at any time, off the
    /// frame path. Honest by construction: the bowler's hand is a generic action, the bowler's and the striker's eyes are the stance and the
    /// run-up's own track (the same for every ball of the over), and the ball is the one the world draws (the delivery's own flight until
    /// it can have been deflected, then the result's), never the bounce, the plan or the result before they are drawn.
    /// </summary>
    public sealed class DirectorStageGeometry : IStageGeometry
    {
        /// <summary>The bowler's visible root at a visible run-up time (seconds from the run-up's first visible frame, may exceed the release): Unity world x, z (m) and yaw (degrees).</summary>
        public delegate void BowlerRoot(double visibleSeconds, out double x, out double z, out double yawDeg);

        /// <summary>The eye height of the upright bowler (rig heights): the head bone's origin 1.595 m up, the eye 8 cm higher at scale 1.</summary>
        public const double EyeY = 1.675;

        /// <summary>Hand heights (rig heights) running and at the top of the action, and where the hand is relative to the body.</summary>
        public const double HandLow = 1.05;

        public const double HandHigh = 2.2;
        public const double HandSide = 0.22;
        public const double HandForward = 0.12;

        /// <summary>The bowling hand rises over this long before the release (ms).</summary>
        public const double HandRiseMs = 650;

        /// <summary>The world's reflection (PresentationMirror, -1 for a right-hander, +1 for a left-hander): the physics frame's x is the Unity world's times it.</summary>
        public double Mirror = -1;

        /// <summary>The bowler's rig scale (the body he is drawn with) and whether he bowls left-arm.</summary>
        public double Scale = 1;

        public bool ArmLeft;

        /// <summary>The striker's eye in the stance (physics frame).</summary>
        public StageVec StrikerEyePosition;

        /// <summary>Where the bowler is (a track; null: standing at <see cref="StandX"/>, <see cref="StandZ"/>, yaw 0).</summary>
        public BowlerRoot Root;

        public double StandX;
        public double StandZ;

        /// <summary>Scene ms of the release; the ball is in the bowler's hand before it. Negative infinity for the scene between balls (no ball).</summary>
        public double ReleaseMs = double.PositiveInfinity;

        /// <summary>True: no ball at all (the scene between balls).</summary>
        public bool NoBall;

        /// <summary>The delivery's own flight (simulation s from the release, physics frame) and the scene ms up to which the live script draws it.</summary>
        public BallTraceSample[] Flight;

        public double LiveVisibleUntilMs = double.PositiveInfinity;

        /// <summary>A result: the flight is the ball up to <see cref="SplitT"/> (simulation s; the contact, before it nothing has deflected it), the trace's after it.</summary>
        public bool IsResult;

        public BallTraceSample[] TraceBall;
        public double SplitT = double.NegativeInfinity;

        public StageVec StrikerEye()
        {
            return StrikerEyePosition;
        }

        /// <summary>
        /// The same stage for the result of this delivery: the bowler, the striker's eye and the live ball are the delivery's own; the ball is
        /// the delivery's flight until <paramref name="splitT"/> (the first moment the bat, pad or body can have deflected it, or the end of
        /// the flight), and the result's trace after it (drawn from the accept on).
        /// </summary>
        public DirectorStageGeometry ForResult(BallTraceSample[] traceBall, double splitT)
        {
            var g = (DirectorStageGeometry)MemberwiseClone();
            g.IsResult = true;
            g.TraceBall = traceBall;
            g.SplitT = splitT;
            return g;
        }

        private void RootAt(double sceneMs, out double x, out double z, out double yaw)
        {
            if (Root == null)
            {
                x = StandX;
                z = StandZ;
                yaw = 0;
                return;
            }
            Root(Math.Max(0, sceneMs) / 1000.0, out x, out z, out yaw);
        }

        public StageVec BowlerEye(double sceneMs)
        {
            double x, z, yaw;
            RootAt(sceneMs, out x, out z, out yaw);
            return new StageVec(Mirror * x, EyeY * Scale, z);
        }

        private static double Smooth(double x)
        {
            return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
        }

        public StageVec BowlerHand(double sceneMs, double releaseMs)
        {
            double x, z, yaw;
            RootAt(sceneMs, out x, out z, out yaw);
            double k = Smooth((sceneMs - (releaseMs - HandRiseMs)) / HandRiseMs);
            double side = (ArmLeft ? -1 : 1) * HandSide * Scale;
            double fwd = HandForward * Scale;
            double a = yaw * Math.PI / 180.0;
            double c = Math.Cos(a);
            double s = Math.Sin(a);
            // Unity yaw about +y: (side, fwd) turns to (side c + fwd s, -side s + fwd c)
            double hx = x + side * c + fwd * s;
            double hz = z - side * s + fwd * c;
            return new StageVec(Mirror * hx, (HandLow + (HandHigh - HandLow) * k) * Scale, hz);
        }

        /// <summary>Linear position at simulation time t (clamped to the samples), allocation-free.</summary>
        public static StageVec PositionAt(BallTraceSample[] samples, double t)
        {
            int n = samples.Length;
            if (t <= samples[0].t) return new StageVec(samples[0].p.x, samples[0].p.y, samples[0].p.z);
            if (t >= samples[n - 1].t) return new StageVec(samples[n - 1].p.x, samples[n - 1].p.y, samples[n - 1].p.z);
            int lo = 0;
            int hi = n - 1;
            while (lo + 1 < hi)
            {
                int mid = lo + (hi - lo) / 2;
                if (samples[mid].t <= t) lo = mid;
                else hi = mid;
            }
            BallTraceSample a = samples[lo];
            BallTraceSample b = samples[hi];
            double span = b.t - a.t;
            double g = span <= 0 ? 0 : (t - a.t) / span;
            return new StageVec(a.p.x + (b.p.x - a.p.x) * g, a.p.y + (b.p.y - a.p.y) * g, a.p.z + (b.p.z - a.p.z) * g);
        }

        public bool Ball(double sceneMs, out StageBall ball)
        {
            ball = new StageBall();
            if (NoBall) return false;
            if (sceneMs < ReleaseMs)
            {
                // in the bowler's hand: the generic action
                ball.Pos = BowlerHand(sceneMs, ReleaseMs);
                ball.Holder = 1;
                return true;
            }
            double t = (sceneMs - ReleaseMs) / 1000.0;
            ball.Holder = 0;
            if (!IsResult)
            {
                if (Flight == null || Flight.Length == 0 || sceneMs > LiveVisibleUntilMs) return false;
                ball.Pos = PositionAt(Flight, t);
                return true;
            }
            if (Flight != null && Flight.Length > 0 && t <= SplitT)
            {
                ball.Pos = PositionAt(Flight, t);
                return true;
            }
            if (TraceBall == null || TraceBall.Length == 0 || t > TraceBall[TraceBall.Length - 1].t) return false;
            ball.Pos = PositionAt(TraceBall, t);
            return true;
        }
    }
}
