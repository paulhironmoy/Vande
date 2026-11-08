using System;
using UnityEngine;

namespace Vande.Practice.Presentation
{
    /// <summary>
    /// The touch-down stroke of the striker's bat (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down,
    /// the shot commits on lift), a port of src/render3d/practice/bat.ts (TOUCHDOWN, withTouch, guardedTravel,
    /// allowedTravel) with FEEL-1's clearance and look-ahead (2026-11-07). Pure geometry: no rig, no world.
    ///
    /// From the press the drawn bat leaves the bat it would draw with no input (the waiting bat of this very frame) along
    /// a rigid blend (the hands straight, the blade turning about them) towards the tap's hitting pose, `Reach` of the
    /// way for the hands and, for the blade, the same fraction of its turn but never more than `MaxTurnDegrees`, by
    /// travel / `CapSeconds`, where travel = `CapSeconds` x tanh(t / `CapSeconds`) (real time at first, never past the
    /// cap): an uncommitted press never draws the bat at the ball. So it is continuous at the press and follows the
    /// waiting bat as it carries on underneath. A press that outlives the tap window checks back to the waiting bat over
    /// `CheckSeconds`.
    ///
    /// The blend turns the blade along the great circle from the waiting blade to the hitting blade (the swing) and
    /// rolls the face the rest of the way (the twist, used by the joins), instead of the web's one slerp of the two bat
    /// frames: a slerp takes the shorter of two paths round the frames, and when the frames are 180 degrees apart that
    /// choice flips and the blade jumps to the other side (1.1 m at the toe in 4 ms, once, early in the backlift). The
    /// swing does not depend on how the waiting bat's face happens to be rolled.
    ///
    /// Honesty: while uncommitted, the drawn bat never comes within `ClearMetres` of the ball's centre unless the bat with
    /// no input is at least as near at that moment (an uncommitted press never draws a contact the waiting bat would not).
    /// When the capped stroke would, it is drawn less far along (the most travel that keeps clear, by bisection), and
    /// when even its start would not, the bat is drawn exactly as with no input. The guard looks `AheadSeconds` along the
    /// ball's flight and retracts the stroke no faster than `Rate`, so the bat draws back before the ball arrives
    /// instead of snapping (the largest 4 ms step of the bat was 0.157 m without it, 0.071 m with it, on the web); it
    /// also looks `BehindSeconds` back and lets the stroke return no faster than `Rate`, so it eases back in after the
    /// ball has passed instead of popping as the ball's clearance grows.
    /// Presentation only: the physics, the stride and the result are untouched.
    /// </summary>
    internal sealed class ProductionTouchDownBat
    {
        /// <summary>The soft cap of the stroke's travel (s): TOUCHDOWN.capMs.</summary>
        public const double CapSeconds = 0.050;
        /// <summary>How far along the blend from the waiting bat to the hitting pose the capped stroke goes: TOUCHDOWN.reach.</summary>
        public const double Reach = 0.35;
        /// <summary>
        /// The blade turns at most this far (degrees) about the hands at the cap. The web's stroke turns the first-person
        /// bat 20.1 degrees at the cap (reach 0.35 of its 57.5-degree gap from the waiting bat to the hitting pose: measured
        /// on its 48 flights at the five realistic presses); here the gap is 70.7 degrees, so the same reach would turn the
        /// blade 24.7 degrees and, with the frames' roll, 29: the same visible turn as the web's is held instead.
        /// </summary>
        public const double MaxTurnDegrees = 20.0;
        /// <summary>The commitment joins the committed swing over this long (s): TOUCHDOWN.commitMs.</summary>
        public const double CommitSeconds = 0.040;
        /// <summary>A press that outlives the tap window checks back to the waiting bat over this long (s): TOUCHDOWN.checkMs.</summary>
        public const double CheckSeconds = 0.120;
        /// <summary>The tap window (s): src/input/constants.ts TAP_HOLD_MS.</summary>
        public const double TapHoldSeconds = 0.250;
        /// <summary>The drawn bat stays this far (m) from the ball's centre, or as far as the bat with no input: TOUCHDOWN.clearM.</summary>
        public const double ClearMetres = 0.15;
        /// <summary>The guard looks this far (s) along the ball's flight: GUARD.aheadMs.</summary>
        public const double AheadSeconds = 0.120;
        /// <summary>The guard also looks this far (s) back along the ball's flight: a stroke returns no faster than it was held.</summary>
        public const double BehindSeconds = AheadSeconds;
        /// <summary>... in steps of this (s): GUARD.stepMs.</summary>
        public const double LookStepSeconds = 0.004;
        /// <summary>The stroke retracts at most this fast (travel s per s): GUARD.rate.</summary>
        public const double Rate = CapSeconds / AheadSeconds;
        /// <summary>Clearance beyond the honest threshold over which a held stroke eases fully back in after the ball has passed.</summary>
        public const double RecoveryMetres = 1.2;
        /// <summary>The bat's length, cap to toe (m): the physics bat (HANDLE_L + BLADE_L).</summary>
        public const float BatLengthMetres = 0.86f;
        /// <summary>Halfway between the hands, from the cap (m): the backlift turns the bat about the hands.</summary>
        public const float HandsFromCapMetres = 0.075f;
        /// <summary>... as a fraction of the bat's length: the bat may be longer than BatLengthMetres by the body's scale.</summary>
        private const float HandsAlongBat = HandsFromCapMetres / BatLengthMetres;

        /// <summary>A bat in the world: the cap, the toe and the face's normal (zero when unknown).</summary>
        public struct BatPose
        {
            public Vector3 Grip;
            public Vector3 Toe;
            public Vector3 Face;
        }

        /// <summary>What the stroke needs of the world: the bat it would draw with no input, and the ball.</summary>
        public interface ISource
        {
            BatPose NoInputAt(double t);
            bool BallAt(double t, out Vector3 ball);
        }

        private ISource source;
        private BatPose hit;
        private double press = double.NaN;

        /// <summary>True from Begin: a press is being drawn.</summary>
        public bool Active => source != null && !double.IsNaN(press);

        /// <summary>The guarded travel (s) of the last Draw (NaN: it drew the waiting bat). Builder evidence.</summary>
        public double LastTravel { get; private set; } = double.NaN;

        /// <summary>The press's time (s), NaN before Begin.</summary>
        public double PressT => press;

        /// <summary>The angle (degrees) between the waiting bat's blade at `t` and the tap's hitting pose's: the turn the whole blend spans.</summary>
        public double GapDegrees(double t)
        {
            var wait = source.NoInputAt(t);
            return Vector3.Angle(wait.Toe - wait.Grip, hit.Toe - hit.Grip);
        }

        /// <summary>Starts a press at `pressT`: the tap's hitting pose `hitPose` is fixed for the whole press.</summary>
        public void Begin(ISource from, BatPose hitPose, double pressT)
        {
            source = from;
            hit = hitPose;
            press = pressT;
        }

        public void End()
        {
            source = null;
            press = double.NaN;
        }

        /// <summary>How far along the tap's provisional swing (s of its travel) the uncommitted stroke is `since` after the press.</summary>
        public static double Travel(double since) => since <= 0.0 ? 0.0 : CapSeconds * Math.Tanh(since / CapSeconds);

        private static double Smooth(double u)
        {
            var x = u < 0.0 ? 0.0 : u > 1.0 ? 1.0 : u;
            return x * x * (3.0 - 2.0 * x);
        }

        // -------------------------------------------------------------------------------------------------------
        // The rigid blend (bat.ts rigidBatBlend / RigidBlend): the hands travel straight, the blade turns about them
        // -------------------------------------------------------------------------------------------------------

        /// <summary>The face made square to the blade `x`: the given one without its part along the blade, a stand-in when it has none.</summary>
        private static Vector3 FaceSquareTo(Vector3 face, Vector3 x)
        {
            var y = face - x * Vector3.Dot(face, x);
            if (y.sqrMagnitude < 1e-8f)
            {
                y = Vector3.Cross(x, Vector3.up);
                if (y.sqrMagnitude < 1e-8f) y = Vector3.Cross(x, Vector3.forward);
            }
            return y.normalized;
        }

        /// <summary>
        /// A rigid bat moved from `from` to `to` with the swing, the twist and the hands' points worked out once. The hands
        /// (a point a fixed fraction along the bat) travel straight; the blade turns about them along the great circle
        /// from the first blade to the second (the swing) while the face rolls, after that swing, onto the second face (the
        /// twist). The hands and the turn have fractions of their own (the stroke goes `Reach` of the way for the hands and
        /// at most `MaxTurnDegrees` for the blade); both at 1 is exactly `to`, both at 0 exactly `from`.
        /// </summary>
        public struct Blend
        {
            private readonly BatPose a;
            private readonly BatPose b;
            private readonly Vector3 xa;
            private readonly Vector3 ya;
            private readonly Vector3 axis;
            private readonly float swing;
            private readonly float twist;
            private readonly float la;
            private readonly float lb;
            private readonly Vector3 ha;
            private readonly Vector3 hb;

            public Blend(BatPose from, BatPose to)
            {
                a = from;
                b = to;
                var da = from.Toe - from.Grip;
                var db = to.Toe - to.Grip;
                la = da.magnitude;
                lb = db.magnitude;
                xa = la > 1e-6f ? da / la : Vector3.right;
                var xb = lb > 1e-6f ? db / lb : Vector3.right;
                ya = FaceSquareTo(from.Face, xa);
                var yb = FaceSquareTo(to.Face, xb);
                var cross = Vector3.Cross(xa, xb);
                var sine = cross.magnitude;
                swing = Mathf.Atan2(sine, Vector3.Dot(xa, xb)) * Mathf.Rad2Deg;
                // Parallel blades turn about nothing; opposite ones about the face (square to both).
                axis = sine > 1e-6f ? cross / sine : ya;
                twist = Vector3.SignedAngle(Quaternion.AngleAxis(swing, axis) * ya, yb, xb);
                ha = from.Grip + xa * (HandsAlongBat * la);
                hb = to.Grip + xb * (HandsAlongBat * lb);
            }

            /// <summary>The angle (degrees) the blade turns from the first pose to the second.</summary>
            public float SwingDegrees => swing;

            /// <summary>The bat with the hands `hands` of the way (0..1) and the turn (swing and twist) `turn` of the way.</summary>
            public BatPose At(double hands, double turn) => At(hands, turn, turn, false);

            /// <summary>
            /// The bat with the hands `hands` of the way, the blade `turn` of the way along its swing and the face `roll` of
            /// the way along its twist; with `keepLength` the bat keeps the first pose's length instead of changing to the second's.
            /// </summary>
            public BatPose At(double hands, double turn, double roll, bool keepLength)
            {
                if (hands <= 0.0 && turn <= 0.0 && roll <= 0.0) return a;
                if (hands >= 1.0 && turn >= 1.0 && roll >= 1.0 && !keepLength) return b;
                var h = (float)Math.Min(Math.Max(hands, 0.0), 1.0);
                var u = (float)Math.Min(Math.Max(turn, 0.0), 1.0);
                var r = (float)Math.Min(Math.Max(roll, 0.0), 1.0);
                var swung = Quaternion.AngleAxis(swing * u, axis);
                var x = swung * xa;
                var y = Quaternion.AngleAxis(twist * r, x) * (swung * ya);
                var length = keepLength ? la : Mathf.Lerp(la, lb, u);
                var grip = Vector3.Lerp(ha, hb, h) - x * (HandsAlongBat * length);
                return new BatPose { Grip = grip, Toe = grip + x * length, Face = y };
            }

            public BatPose At(double u) => At(u, u);

            /// <summary>
            /// The touch-down stroke `f` (0..1) of the way to its cap: the hands `Reach` x f of the way to the hitting pose's,
            /// the blade the same fraction of the way along its swing but not turned more than `MaxTurnDegrees` x f. The face
            /// goes with the swing and is not rolled onto the hitting pose's: the roll left over is the shorter way round, and
            /// where the waiting face is half a turn from the hitting pose's it flips from one way to the other, a jump of
            /// `turn` x 360 degrees in the face in one frame. The commitment's join brings the face onto the committed one.
            /// The bat keeps the waiting bat's length (the body's scale).
            /// </summary>
            public BatPose Stroke(double f)
            {
                var turn = swing > 1e-3f ? Math.Min(Reach, MaxTurnDegrees / swing) : Reach;
                return At(Reach * f, turn * f, 0.0, true);
            }
        }

        /// <summary>The bat's frame: x along the blade (cap to toe), y its face (made square to the blade), z their cross.</summary>
        public static Quaternion Orientation(BatPose pose)
        {
            var x = pose.Toe - pose.Grip;
            x = x.sqrMagnitude > 1e-12f ? x.normalized : Vector3.right;
            var y = FaceSquareTo(pose.Face, x);
            return Quaternion.LookRotation(Vector3.Cross(x, y), y);
        }

        public static BatPose Rigid(BatPose a, BatPose b, double u) => new Blend(a, b).At(u);

        /// <summary>Distance (m) from a point to the bat's axis, cap to toe.</summary>
        public static float Clearance(Vector3 point, BatPose bat)
        {
            var ab = bat.Toe - bat.Grip;
            var u = Mathf.Clamp01(Vector3.Dot(point - bat.Grip, ab) / Mathf.Max(1e-12f, Vector3.Dot(ab, ab)));
            return Vector3.Distance(point, bat.Grip + ab * u);
        }

        // -------------------------------------------------------------------------------------------------------
        // The drawing
        // -------------------------------------------------------------------------------------------------------

        /// <summary>How far the press has checked back to the waiting bat at `t` (0 while the tap window lasts, 1 when done).</summary>
        private double CheckedBack(double t)
        {
            var since = t - press - TapHoldSeconds;
            return since > 0.0 ? Smooth(since / CheckSeconds) : 0.0;
        }

        /// <summary>
        /// The uncommitted drawing at `t` with the stroke `travel` s along: the waiting bat when the press has not begun
        /// or has fully checked back (false), else the stroke, checking back from the end of the tap window.
        /// </summary>
        public bool Drawn(double t, double travel, out BatPose pose)
        {
            var wait = source.NoInputAt(t);
            return Drawn(wait, new Blend(wait, hit), t, travel, out pose);
        }

        private bool Drawn(BatPose wait, Blend toHit, double t, double travel, out BatPose pose)
        {
            var back = CheckedBack(t);
            if (t <= press || back >= 1.0)
            {
                pose = wait;
                return false;
            }
            var stroke = toHit.Stroke(Math.Min(Math.Max(travel, 0.0), CapSeconds) / CapSeconds);
            pose = back > 0.0 ? Rigid(stroke, wait, back) : stroke;
            return true;
        }

        // -------------------------------------------------------------------------------------------------------
        // The guard (bat.ts allowedTravel / guardedTravel)
        // -------------------------------------------------------------------------------------------------------

        /// <summary>The ball's distance to the drawn bat at `t` with the stroke `travel` s along.</summary>
        private float DistanceAt(BatPose wait, Blend toHit, Vector3 ball, double t, double travel)
        {
            BatPose pose;
            Drawn(wait, toHit, t, travel, out pose);
            return Clearance(ball, pose);
        }

        /// <summary>
        /// The most travel (0..requested) whose drawing at `t` keeps the clearance from the ball at that moment, or NaN
        /// when even the stroke's start does not (the waiting bat is drawn).
        /// </summary>
        private double Allowed(double t, double requested)
        {
            Vector3 ball;
            if (!source.BallAt(t, out ball)) return requested;
            var wait = source.NoInputAt(t);
            var toHit = new Blend(wait, hit);
            var idle = Clearance(ball, wait);
            var need = Math.Min(idle, (float)ClearMetres);
            var want = requested;
            var full = DistanceAt(wait, toHit, ball, t, want);
            if (full >= need)
            {
                // When the ball has just passed, both ends of the bat's arc can be clear while the arc between them is
                // not: an immediate return to the full stroke would pop from the waiting bat to the far side of the
                // ball. Ease the travel back with measured clearance; with the ball still far away it is unchanged.
                var margin = Math.Min(idle - need, full - need);
                want *= Math.Min(Math.Max(margin / RecoveryMetres, 0.0), 1.0);
                if (DistanceAt(wait, toHit, ball, t, want) >= need) return want;
            }
            if (DistanceAt(wait, toHit, ball, t, 0.0) < need) return double.NaN;
            // Clearance along the rigid bat's arc is not monotonic: it can cross the ball and become clear again. Find
            // the first blocked part of the arc, rather than bisecting the whole range and landing on a later clear
            // island: twelve brackets, then fourteen bisections prove the end of the connected clear prefix.
            var lo = 0.0;
            var hi = want;
            for (var i = 1; i <= 12; i++)
            {
                var probe = want * i / 12.0;
                if (DistanceAt(wait, toHit, ball, t, probe) < need)
                {
                    hi = probe;
                    break;
                }
                lo = probe;
            }
            for (var i = 0; i < 14; i++)
            {
                var mid = (lo + hi) / 2.0;
                if (DistanceAt(wait, toHit, ball, t, mid) >= need) lo = mid;
                else hi = mid;
            }
            return lo;
        }

        /// <summary>
        /// The soft-capped travel at `t`, kept clear of the ball now and, looking AheadSeconds along its flight,
        /// retracting towards what will be allowed at no more than Rate: the bat draws back before the ball arrives
        /// instead of snapping. It also looks BehindSeconds back and returns towards the cap no faster than Rate from what
        /// the guard allowed then: as the ball passes, the clearance grows at the ball's pace (25 m/s and more), and the
        /// web's eased return over 1.2 m of it was a 0.155 m step in 4 ms for a stroke turning the blade 70 degrees.
        /// NaN: draw the bat as with no input.
        /// </summary>
        public double GuardedTravel(double t)
        {
            var want = Travel(t - press);
            if (t <= press || CheckedBack(t) >= 1.0) return want;
            // Every drawn grip lies between a waiting grip and the hitting pose's (the hands travel straight), and the
            // bat reaches BatLength beyond it: a ball farther than that plus the clearance, plus the range over which a
            // held stroke eases back in, from all such segments over the look-ahead and the look-back cannot be met, and
            // the stroke is then exactly the soft-capped one (so leaving this test never steps the bat).
            var far = BatLengthMetres + (float)ClearMetres + (float)RecoveryMetres + 0.05f;
            var gripNow = source.NoInputAt(t).Grip;
            var gripThen = source.NoInputAt(press).Grip;
            var near = false;
            for (var ahead = -BehindSeconds; ahead <= AheadSeconds + 1e-9 && !near; ahead += LookStepSeconds)
            {
                Vector3 ball;
                if (!source.BallAt(t + ahead, out ball)) continue;
                near = SegmentDistance(ball, gripThen, hit.Grip) <= far || SegmentDistance(ball, gripNow, hit.Grip) <= far;
            }
            if (!near) return want;
            var now = Allowed(t, want);
            if (double.IsNaN(now)) return double.NaN;
            var travel = now;
            for (var ahead = LookStepSeconds; ahead <= AheadSeconds + 1e-9; ahead += LookStepSeconds)
            {
                var later = Allowed(t + ahead, Travel(t + ahead - press));
                travel = Math.Min(travel, (double.IsNaN(later) ? 0.0 : later) + Rate * ahead);
            }
            // What the guard allowed the whole cap, back then (not what the stroke had reached: its own start is real
            // time, faster than Rate, and must stay so): the stroke is no more than Rate x the time since then above it.
            for (var behind = LookStepSeconds; behind <= BehindSeconds + 1e-9 && t - behind > press; behind += LookStepSeconds)
            {
                var earlier = Allowed(t - behind, CapSeconds);
                travel = Math.Min(travel, (double.IsNaN(earlier) ? 0.0 : earlier) + Rate * behind);
            }
            // A look-ahead cap is smaller than `now`, but clearance along the rigid bat's arc is not monotonic: a
            // smaller travel can put the blade between two clear parts of the arc. Validate the capped value at this
            // frame as well; Allowed always returns a value it actually tested clear (or the waiting bat).
            return Allowed(t, Math.Max(0.0, travel));
        }

        /// <summary>
        /// The bat the press draws at `t`, guarded: true with the stroke (or its check back), false when the bat is
        /// drawn as with no input (before the press, held off the ball, or fully checked back).
        /// </summary>
        public bool Draw(double t, out BatPose pose)
        {
            var travel = GuardedTravel(t);
            LastTravel = travel;
            if (double.IsNaN(travel))
            {
                pose = source.NoInputAt(t);
                return false;
            }
            return Drawn(t, travel, out pose);
        }

        /// <summary>The same drawing without the guard (the soft-capped travel): the measure of how often the guard holds.</summary>
        public bool DrawUnguarded(double t, out BatPose pose) => Drawn(t, Travel(t - press), out pose);

        private static float SegmentDistance(Vector3 point, Vector3 a, Vector3 b)
        {
            var ab = b - a;
            var u = Mathf.Clamp01(Vector3.Dot(point - a, ab) / Mathf.Max(1e-12f, Vector3.Dot(ab, ab)));
            return Vector3.Distance(point, a + ab * u);
        }
    }
}
