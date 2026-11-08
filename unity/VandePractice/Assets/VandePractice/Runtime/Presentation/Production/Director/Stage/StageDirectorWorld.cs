using System;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// What the Director asks of the world while it bakes one actor's plan in one script (stage/runtime.ts `anchors`: aim and
    /// visibleBall): the directions to the opponent, the bowling hand and the ball, in the physics frame, from an
    /// <see cref="IStageGeometry"/>. Called from the bake only, off the frame path; it allocates nothing.
    /// Honest by construction: the ball is the one the script DRAWS at the time asked (never the plan, the bounce or the result), the
    /// opponent only a point to look at, and the bowling hand a generic action.
    /// </summary>
    public sealed class StageDirectorWorld : IDirectorWorld
    {
        /// <summary>The ball's velocity (for the pursuit's extrapolation) is measured over this long, ending at the time asked (ms).</summary>
        public const double BallVelocityMs = 10;

        private const double Deg = 180.0 / Math.PI;

        private readonly IStageGeometry geometry;
        private readonly DirectorRole role;
        private readonly double releaseMs;

        public StageDirectorWorld(IStageGeometry geometry, DirectorRole role, double? releaseMs)
        {
            if (geometry == null) throw new ArgumentNullException(nameof(geometry));
            this.geometry = geometry;
            this.role = role;
            this.releaseMs = releaseMs ?? 0;
        }

        private StageVec MyEye(double t)
        {
            return role == DirectorRole.Bowler ? geometry.BowlerEye(t) : geometry.StrikerEye();
        }

        /// <summary>The direction from <paramref name="from"/> to <paramref name="p"/> in the actor's role frame: yaw + left, pitch + down (degrees).</summary>
        private void Direction(StageVec from, StageVec p, double[] output)
        {
            double fwd = role == DirectorRole.Bowler ? p.Z - from.Z : from.Z - p.Z;
            double left = role == DirectorRole.Bowler ? p.X - from.X : from.X - p.X;
            output[0] = Math.Atan2(left, fwd) * Deg;
            output[1] = Math.Atan2(from.Y - p.Y, Math.Sqrt(fwd * fwd + left * left)) * Deg;
        }

        public bool Aim(DirectorAim target, double tMs, double[] output)
        {
            StageVec from = MyEye(tMs);
            if (role == DirectorRole.Bowler) Direction(from, geometry.StrikerEye(), output);
            else Direction(from, target == DirectorAim.Hand ? geometry.BowlerHand(tMs, releaseMs) : geometry.BowlerEye(tMs), output);
            return true;
        }

        public bool VisibleBall(double tMs, double[] output, double aheadMs)
        {
            StageBall b;
            if (!geometry.Ball(tMs, out b)) return false;
            double x = b.Pos.X;
            double y = b.Pos.Y;
            double z = b.Pos.Z;
            if (aheadMs > 0)
            {
                // Constant velocity from the ball as drawn at t and BallVelocityMs before it (nothing later than t). Across a change
                // of holder or of kind (the hand to the air) the two samples are not one motion: no extrapolation for that sample.
                StageBall b2;
                if (geometry.Ball(tMs - BallVelocityMs, out b2) && b2.Holder == b.Holder)
                {
                    double k = aheadMs / BallVelocityMs;
                    x += (x - b2.Pos.X) * k;
                    y += (y - b2.Pos.Y) * k;
                    z += (z - b2.Pos.Z) * k;
                }
            }
            Direction(MyEye(tMs + aheadMs), new StageVec(x, y, z), output);
            return true;
        }

        /// <summary>Never called: the stage uses <see cref="DirectorHeadMode.Space"/>.</summary>
        public void ClipHead(double tMs, double[] output)
        {
        }
    }
}
