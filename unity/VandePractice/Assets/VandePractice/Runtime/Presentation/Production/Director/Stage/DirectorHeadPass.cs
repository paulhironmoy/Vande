using System;
using UnityEngine;
using P = Vande.Practice.Presentation.Production.Director.DirectorParams;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// The Director's head pass on a finished rig (a port of stage/pose.ts turnHead and three/players.ts limitHead): it measures where
    /// the head of the drawn bones points, turns the neck and head the rest of the way to the head in space the plan wants (as far as
    /// the neck can turn), and holds both to the section 9 caps. It runs LAST, on the bones as the frame's solves have left them (the
    /// glove solve, the hips and the planted feet are done); it moves neither hands, bat nor feet. The eyes and the face are not
    /// driven (no Unity camera shows a face; owner decision T0 is open).
    /// <para>
    /// Frames. The plan's angles are degrees in the physics role frame (+z down the pitch to the opponent; yaw + turns left, pitch +
    /// looks down, roll + tilts to the right shoulder). The Unity world is that frame reflected once in x by the world's mirror
    /// <c>m</c> (-1 for a right-hander, +1 for a left-hander: PresentationMirror), so every world rotation is mapped to the physics frame
    /// by the conjugation (x, m y, m z, w) and the turn is mapped back the same way. The angles are geometric, not anatomical, so the
    /// pass is the same for a left-hander and a left-arm bowler as for the others. Nothing here allocates.
    /// </para>
    /// </summary>
    public sealed class DirectorHeadPass
    {
        /// <summary>MOTION-SPEC section 9 (three/players.ts HEAD_LIMIT): the neck and head turn at most 600 deg/s, change their speed by at most 5,000 deg/s^2, brake at 6,000 deg/s^2.</summary>
        public const double SpeedDegPerS = 600;

        public const double AccelDegPerS2 = 5000;
        public const double BrakeDegPerS2 = 6000;

        /// <summary>A bone remembered from a frame at most this long (ms) earlier is continued; a longer gap (a seek, a new shot) starts afresh.</summary>
        public const double MemoryMs = 50;

        /// <summary>The head held still in space is given back to the plan over this long (ms), from rest (smoothstep).</summary>
        public const double ReleaseMs = 200;

        // The neck's range relative to the chest (degrees): yaw either way, pitch down and up (pose.ts NECK).
        private const double NeckYaw0 = 85;
        private const double NeckYaw1 = 165;
        private const double NeckDown = 55;
        private const double NeckUp = 60;

        private const double Deg = 180.0 / Math.PI;
        private const double Rad = Math.PI / 180.0;

        private readonly Transform chest;
        private readonly Transform neck;
        private readonly Transform head;
        private readonly DirectorRole role;

        // The limiter's memory (limitHead): the last finished rotations of the neck and head and the speeds they moved at.
        private double memT = double.NaN;
        private Quaternion memNeck = Quaternion.identity;
        private Quaternion memHead = Quaternion.identity;
        private double speedNeck;
        private double speedHead;

        // The limiter's state as it was when the frame at memT began (see Limit: a frame posed again starts from it).
        private double startT = double.NaN;
        private Quaternion startNeck = Quaternion.identity;
        private Quaternion startHead = Quaternion.identity;
        private double startSpeedNeck, startSpeedHead;

        // What the pass turned: the neck's and head's local rotations as the world left them, so that the next frame's solves (which may
        // run on the bones in place, with no pose re-applied: the dead-ball hold) see the bones as the world drew them, never the Director's
        // turn. Restored by Undo while the rig has not been posed again since.
        private Quaternion savedNeck = Quaternion.identity;
        private Quaternion savedHead = Quaternion.identity;
        private bool applied;
        private int appliedSerial;

        // What the pass did to the neck and head, in their own local frames (final = base * delta): kept so that a pose the world makes
        // between two frames (the accept of a result re-poses the rig) can be given the same turn again (Redo) rather than shown bare.
        private Quaternion deltaNeck = Quaternion.identity;
        private Quaternion deltaHead = Quaternion.identity;
        private bool redoable;

        // The head held still in space (a committed swing awaiting its result): the orientation it was held at, and the give-back to the plan.
        private bool holding;
        private double holdYaw, holdPitch, holdRoll;
        private bool releasing;
        private double releaseT0;

        // The head's local rotation the limiter started the frame from (the world guard continues the limiter from the head it leaves).
        private Quaternion beforeMemHead = Quaternion.identity;

        // The world guard's memory: the world rotation of the head the world drew last frame (the base) and the pass finished (the final), and when.
        private Quaternion guardBaseHead = Quaternion.identity;
        private Quaternion guardFinalHead = Quaternion.identity;
        private double guardT = double.NaN;
        private double guardStartT = double.NaN;
        private Quaternion guardStartBase = Quaternion.identity, guardStartFinal = Quaternion.identity;

        // The last two orientations the head was finished at (role yaw, pitch, roll) and when: the speed it was turning at when a hold begins.
        private double h0Yaw, h0Pitch, h0Roll, h0T = double.NaN;
        private double h1Yaw, h1Pitch, h1Roll, h1T = double.NaN;

        // Scratch: the head's line of sight and up in the physics frame (set by Axes).
        private double dx, dy, dz, ux, uy, uz;

        // What the pass measured and decided (for the tests and the probes).
        public double Yaw { get; private set; }
        public double Pitch { get; private set; }
        public double Roll { get; private set; }
        public double DYaw { get; private set; }
        public double DPitch { get; private set; }
        public double DRoll { get; private set; }
        /// <summary>The neck's range kept the head short of the plan's head in space.</summary>
        public bool Clamped { get; private set; }
        /// <summary>The rate limit held a bone back.</summary>
        public bool Limited { get; private set; }
        /// <summary>The head is being held still in space (the last frame's pass was a hold).</summary>
        public bool Holding { get { return holding; } }

        /// <summary>
        /// Builder seam (the web's probes set HEAD_LIMIT to 1e9): false leaves the head pass alone, with neither the bone caps nor the world guard, to show
        /// what the pass itself asks of the bones. Always true in the game.
        /// </summary>
        public bool LimiterEnabled { get; set; } = true;

        /// <summary>
        /// UNITY-9 seam: false leaves the world guard as it was, a guard only where the head the world drew already turns faster than the cap. True (the game) also
        /// holds the head the viewer sees to <see cref="SpeedDegPerS"/> in the world when the body is quiet, so that the neck's 600 deg/s and the head's 600 deg/s
        /// (which add) cannot draw a head turning at 930 to 1,300 deg/s in the world, as a bowler's look back over his shoulder through the walk-back did.
        /// </summary>
        public bool WorldCapEnabled { get; set; } = true;

        /// <summary>The head in space the pass was asked for after the neck's range (role yaw, pitch), as of the last turn (builder evidence).</summary>
        public double ReachableYaw { get { return reachYaw; } }

        public double ReachablePitch { get { return reachPitch; } }

        /// <summary>Where the chest faces now, role yaw (degrees) in the physics frame (builder evidence).</summary>
        public double ChestYaw(float mirror)
        {
            Vector3 d = ToPhysics(chest.rotation, mirror) * Vector3.forward;
            return (role == DirectorRole.Bowler ? Math.Atan2(d.x, d.z) : Math.Atan2(-d.x, -d.z)) * Deg;
        }

        public DirectorHeadPass(Transform chest, Transform neck, Transform head, DirectorRole role)
        {
            if (chest == null) throw new ArgumentNullException(nameof(chest));
            if (neck == null) throw new ArgumentNullException(nameof(neck));
            if (head == null) throw new ArgumentNullException(nameof(head));
            this.chest = chest;
            this.neck = neck;
            this.head = head;
            this.role = role;
        }

        public DirectorRole Role
        {
            get { return role; }
        }

        /// <summary>Forgets the limiter's memory (a seek, a new rig pose that is not a continuation).</summary>
        public void Reset()
        {
            memT = double.NaN;
            speedNeck = speedHead = 0;
            redoable = false;
            holding = false;
            releasing = false;
            h0T = h1T = double.NaN;
            guardT = double.NaN;
            guardStartT = double.NaN;
            startT = double.NaN;
        }

        /// <summary>
        /// Takes the pass off the bones before anything else of the world's touches them: the neck and head go back to the local rotations
        /// the world left them with, unless the rig has been posed again since (<paramref name="poseSerial"/> differs from the one the pass saw),
        /// in which case the pose already replaced them. Without this the world's own solves of the next frame (the arms' IK to the bat on a held
        /// pose, the neck clearance) would read a head the Director turned and answer it: the Director would move the hands.
        /// </summary>
        public void Undo(int poseSerial)
        {
            if (!applied) return;
            applied = false;
            if (poseSerial != appliedSerial) return;
            neck.localRotation = savedNeck;
            head.localRotation = savedHead;
        }

        /// <summary>
        /// Gives the neck and head the turn the pass made in the frame before, on whatever base the world has posed them to since
        /// (<c>final = base * delta</c> in each bone's local frame): the world re-poses the rig between two frames (a result is accepted),
        /// and until the next frame's pass the bones must not be seen bare. Does nothing unless the pass was undone, ran in the frame
        /// that ended at <paramref name="tMs"/>, and has not been redone. Returns whether it turned the bones.
        /// </summary>
        public bool Redo(int poseSerial, double tMs)
        {
            if (applied || !redoable) return false;
            if (!(Math.Abs(tMs - memT) < 0.5)) return false;
            savedNeck = neck.localRotation;
            savedHead = head.localRotation;
            neck.localRotation = savedNeck * deltaNeck;
            head.localRotation = savedHead * deltaHead;
            applied = true;
            appliedSerial = poseSerial;
            return true;
        }

        // ---- frames -----------------------------------------------------------------------------------------------------

        /// <summary>A Unity world rotation as the physics frame sees it (the conjugation by the world's x reflection).</summary>
        public static Quaternion ToPhysics(Quaternion q, float mirror)
        {
            return new Quaternion(q.x, mirror * q.y, mirror * q.z, q.w);
        }

        private static double Wrap180(double x)
        {
            return x > 180 ? x - 360 : x < -180 ? x + 360 : x;
        }

        private static double Clamp(double x, double lo, double hi)
        {
            return x < lo ? lo : x > hi ? hi : x;
        }

        /// <summary>The head's line of sight D and up U (the head's +z and +y) in the physics frame, into the scratch.</summary>
        private void Axes(float mirror)
        {
            Quaternion q = ToPhysics(head.rotation, mirror);
            Vector3 d = q * Vector3.forward;
            Vector3 u = q * Vector3.up;
            dx = d.x;
            dy = d.y;
            dz = d.z;
            ux = u.x;
            uy = u.y;
            uz = u.z;
        }

        private double RoleYaw()
        {
            return (role == DirectorRole.Bowler ? Math.Atan2(dx, dz) : Math.Atan2(-dx, -dz)) * Deg;
        }

        private double RolePitch()
        {
            return Math.Atan2(-dy, Math.Sqrt(dx * dx + dz * dz)) * Deg;
        }

        /// <summary>The roll of the head about its line of sight against the level (+ to the right shoulder), degrees (pose.ts rollOf).</summary>
        private double RollOf()
        {
            double lx0 = -dy * dx;
            double ly0 = 1 - dy * dy;
            double lz0 = -dy * dz;
            double ll = Math.Sqrt(lx0 * lx0 + ly0 * ly0 + lz0 * lz0);
            if (ll <= 1e-4) return 0;
            double lx = lx0 / ll, ly = ly0 / ll, lz = lz0 / ll;
            double sinr = (ly * uz - lz * uy) * dx + (lz * ux - lx * uz) * dy + (lx * uy - ly * ux) * dz;
            return Math.Atan2(sinr, lx * ux + ly * uy + lz * uz) * Deg;
        }

        /// <summary>The head as it is drawn now, in the physics role frame (degrees): into <paramref name="yaw"/>, <paramref name="pitch"/>, <paramref name="roll"/>.</summary>
        public void Measure(float mirror, out double yaw, out double pitch, out double roll)
        {
            Axes(mirror);
            yaw = RoleYaw();
            pitch = RolePitch();
            roll = RollOf();
        }

        private void Remember(StageDrawnHead d)
        {
            if (d == null) return;
            d.Ok = true;
            d.Yaw = RoleYaw();
            d.Pitch = RolePitch();
            d.Roll = RollOf();
        }

        // ---- the neck's range -------------------------------------------------------------------------------------------

        /// <summary>A limit that passes everything up to 90% of it unchanged (the clips themselves reach that far) and eases into the rest.</summary>
        private static double Knee(double x, double limit)
        {
            double a = 0.9 * limit;
            double t = x < 0 ? -x : x;
            if (t <= a) return x;
            double y = a + (limit - a) * Math.Tanh((t - a) / (limit - a));
            return x < 0 ? -y : y;
        }

        /// <summary>
        /// Where the head goes for a target x degrees to one side of the chest's front: there, up to the neck's yaw range; and as the
        /// target goes round behind him (a bowler turning to walk back) it returns to the front instead of holding the extreme twist,
        /// smoothly. Continuous, with slope 1 up to the range.
        /// </summary>
        private static double YawReach(double x)
        {
            double t = x < 0 ? -x : x;
            if (t <= NeckYaw0) return x;
            double u = Math.Min(1, (t - NeckYaw0) / (NeckYaw1 - NeckYaw0));
            double y = t * (1 - u * u * (3 - 2 * u));
            return x < 0 ? -y : y;
        }

        private double reachYaw;
        private double reachPitch;

        /// <summary>The plan's head in space (role yaw, pitch) brought inside the neck's range: the direction in the chest's frame, its yaw and pitch limited softly, and back.</summary>
        private void Reachable(double yaw, double pitch, float mirror)
        {
            // role -> physics world direction
            double cy = Math.Cos(yaw * Rad), sy = Math.Sin(yaw * Rad), cp = Math.Cos(pitch * Rad), sp = Math.Sin(pitch * Rad);
            double sgn = role == DirectorRole.Bowler ? 1 : -1;
            double wx = sgn * sy * cp;
            double wz = sgn * cy * cp;
            Quaternion cq = ToPhysics(chest.rotation, mirror);
            Vector3 v = Quaternion.Inverse(cq) * new Vector3((float)wx, (float)(-sp), (float)wz);
            double yc = Math.Atan2(v.x, v.z) * Deg;
            double pc = Math.Atan2(-v.y, Math.Sqrt((double)v.x * v.x + (double)v.z * v.z)) * Deg;
            double mid = (NeckDown - NeckUp) / 2;
            double half = (NeckDown + NeckUp) / 2;
            double y2 = YawReach(yc);
            // A look that has to be pulled back towards the chest's front (a bowler who has turned away to walk back, the plan still on the batter
            // behind him) keeps the WORLD pitch the plan wants, not the pitch it had in the chest's frame: that one was measured for a direction
            // behind the chest, which a chest that leans or arches puts far below the horizon (64 degrees for a plan of 24), and once clamped to
            // the neck's range it hung the head straight down (85 degrees) and left its yaw to the sliver of horizontal that is left, which flips
            // by 180 degrees (the web's finding of 2026-11-07: 106 degrees of the head and 61 of the neck in one frame). The share of the pull
            // rises with it, 0 at the edge of the free range and 1 where the head is back at the front, so nothing jumps; inside the free range
            // (|yc| <= 85) the weight is exactly 0 and the pitch is the one it always was, bit for bit. (h is the height in the world of the chest
            // front along the pulled yaw: the pitch the chest frame needs for the plan's world pitch is the plan's plus that elevation.)
            Vector3 front = cq * new Vector3((float)Math.Sin(y2 * Rad), 0f, (float)Math.Cos(y2 * Rad));
            double pk = pc + (pitch + Math.Asin(Clamp(front.y, -1, 1)) * Deg - pc) * DirectorMath.Smooth((Math.Abs(yc) - NeckYaw0) / (NeckYaw1 - NeckYaw0));
            double p2 = Knee(pk - mid, half) + mid;
            if (Math.Abs(y2 - yc) < 1e-9 && Math.Abs(p2 - pc) < 1e-9)
            {
                Clamped = false;
                reachYaw = yaw;
                reachPitch = pitch;
                return;
            }
            Clamped = true;
            // back out: chest frame -> physics world -> role
            double cy2 = Math.Cos(y2 * Rad), sy2 = Math.Sin(y2 * Rad), cp2 = Math.Cos(p2 * Rad), sp2 = Math.Sin(p2 * Rad);
            Vector3 a = cq * new Vector3((float)(sy2 * cp2), (float)(-sp2), (float)(cy2 * cp2));
            reachYaw = (role == DirectorRole.Bowler ? Math.Atan2(a.x, a.z) : Math.Atan2(-a.x, -a.z)) * Deg;
            reachPitch = Math.Atan2(-a.y, Math.Sqrt((double)a.x * a.x + (double)a.z * a.z)) * Deg;
        }

        // ---- quaternions on doubles (x, y, z, w) -------------------------------------------------------------------------

        private static void Mul(double ax, double ay, double az, double aw, double bx, double by, double bz, double bw,
            out double ox, out double oy, out double oz, out double ow)
        {
            ox = aw * bx + ax * bw + ay * bz - az * by;
            oy = aw * by - ax * bz + ay * bw + az * bx;
            oz = aw * bz + ax * by - ay * bx + az * bw;
            ow = aw * bw - ax * bx - ay * by - az * bz;
        }

        // ---- the pass ---------------------------------------------------------------------------------------------------

        /// <summary>
        /// The whole head pass for one frame: measures the drawn head, turns the neck and head to the plan's head in space as far as the
        /// neck can turn (scaled by the fade and, in Reduced Motion, by the plan's own gain), holds both to the section 9 caps and
        /// remembers where the head ended up (<paramref name="drawn"/>, for the next script's seam). Does nothing if the frame is off.
        /// <paramref name="tMs"/>: the scene time of the frame (the limiter's clock); <paramref name="mirror"/>: the world's reflection
        /// (PresentationMirror, +1 or -1).
        /// </summary>
        public void Apply(DirectedFrame f, double tMs, float mirror, StageDrawnHead drawn, int poseSerial = 0, bool hold = false)
        {
            if (f == null || !f.On)
            {
                holding = false;
                releasing = false;
                return;
            }
            savedNeck = neck.localRotation;
            savedHead = head.localRotation;
            Quaternion baseNeckNow = neck.rotation;
            Quaternion baseHeadNow = head.rotation;
            applied = true;
            appliedSerial = poseSerial;
            double planMix = 1;
            if (hold)
            {
                releasing = false;
                if (!holding && drawn != null && drawn.Ok) BeginHold(drawn, tMs);
            }
            else if (holding)
            {
                // The hold ends (the result arrived): the head goes back to the plan from rest, smoothly.
                holding = false;
                releasing = f.HasChannels;
                releaseT0 = tMs;
            }
            if (releasing)
            {
                double u = (tMs - releaseT0) / ReleaseMs;
                if (u >= 1) releasing = false;
                else planMix = u <= 0 ? 0 : u * u * (3 - 2 * u);
            }
            if (holding) TurnTo(true, holdYaw, holdPitch, holdRoll, 1.0, 1.0, null, mirror, 1.0);
            else TurnTo(f.HasChannels, f.HasChannels ? f.Ch[DirectorChannels.HeadYaw] : 0, f.HasChannels ? f.Ch[DirectorChannels.HeadPitch] : 0,
                f.HasChannels ? f.Ch[DirectorChannels.HeadRoll] : 0, f.Reduced ? P.Head.RmGainX : 1, f.W, f.Seam, mirror, planMix);
            Limited = false;
            if (LimiterEnabled)
            {
                Limited = Limit(tMs, f.Brake);
                if (WorldGuard(tMs, baseNeckNow, baseHeadNow)) Limited = true;
            }
            Axes(mirror);
            Remember(drawn);
            Finished(tMs);
            deltaNeck = Quaternion.Inverse(savedNeck) * neck.localRotation;
            deltaHead = Quaternion.Inverse(savedHead) * head.localRotation;
            redoable = true;
        }

        /// <summary>Notes the orientation the head was finished at (the two latest, for the speed a hold begins at).</summary>
        private void Finished(double tMs)
        {
            // (a frame posed again replaces its own entry; it is not another frame)
            if (!(Math.Abs(tMs - h0T) < 0.5))
            {
                h1Yaw = h0Yaw;
                h1Pitch = h0Pitch;
                h1Roll = h0Roll;
                h1T = h0T;
            }
            h0Yaw = RoleYaw();
            h0Pitch = RolePitch();
            h0Roll = RollOf();
            h0T = tMs;
        }

        /// <summary>
        /// The hold begins: the head is to stand still in space, at the orientation it would stop at if it slowed from the speed it is turning
        /// at by the brake's deceleration (the limiter's brake then plans that stop), so that it does not freeze in a frame.
        /// </summary>
        private void BeginHold(StageDrawnHead drawn, double tMs)
        {
            holdYaw = drawn.Yaw;
            holdPitch = drawn.Pitch;
            holdRoll = drawn.Roll;
            holding = true;
            if (!(tMs - h0T > 0.5 && tMs - h0T <= MemoryMs) || !(h0T - h1T > 0.5 && h0T - h1T <= MemoryMs)) return;
            double dtS = (h0T - h1T) / 1000;
            double vy = Wrap180(h0Yaw - h1Yaw) / dtS, vp = (h0Pitch - h1Pitch) / dtS, vr = Wrap180(h0Roll - h1Roll) / dtS;
            double v = Math.Sqrt(vy * vy + vp * vp + vr * vr);
            if (v < 1e-6) return;
            double extra = v * v / (2 * BrakeDegPerS2);
            holdYaw = Wrap180(holdYaw + vy / v * extra);
            holdPitch += vp / v * extra;
            holdRoll = Wrap180(holdRoll + vr / v * extra);
        }

        /// <summary>
        /// Closes the loop on the head: where the head of the drawn bones points now, where the channels want it
        /// (<see cref="DirectorChannels.HeadYaw"/>.. the head in space) as far as the neck can turn, and the neck and head turned the rest of
        /// the way (halved in Reduced Motion, scaled by the fade <paramref name="w"/>).
        /// </summary>
        public void Turn(float[] ch, bool rm, double w, StageSeam seam, float mirror)
        {
            TurnTo(ch != null, ch != null ? ch[DirectorChannels.HeadYaw] : 0, ch != null ? ch[DirectorChannels.HeadPitch] : 0,
                ch != null ? ch[DirectorChannels.HeadRoll] : 0, rm ? P.Head.RmGainX : 1, w, seam, mirror, 1.0);
        }

        /// <summary>
        /// The turn towards a head in space (role yaw, pitch, roll) scaled by <paramref name="gain"/> and the fade <paramref name="w"/>; no target
        /// (<paramref name="have"/> false) only gives the seam back. <paramref name="planMix"/> below 1 is the give-back of a hold: that share of the
        /// way from the held orientation to the plan's.
        /// </summary>
        private void TurnTo(bool have, double targetYaw, double targetPitch, double targetRoll, double gain, double w, StageSeam seam, float mirror, double planMix)
        {
            Axes(mirror);
            double yawA = RoleYaw();
            double pitchA = RolePitch();
            double rollA = RollOf();
            // The seam: the first frame of a script that follows another finds how far its head is from the one the scene before ended
            // with, and the pass gives that back, a smaller share of it every frame.
            if (seam != null && seam.Pending)
            {
                seam.OYaw = Wrap180(seam.H0Yaw - yawA);
                seam.OPitch = seam.H0Pitch - pitchA;
                seam.ORoll = Wrap180(seam.H0Roll - rollA);
                seam.Pending = false;
            }
            double dY = 0, dP = 0, dR = 0;
            Clamped = false;
            if (have)
            {
                Reachable(targetYaw, targetPitch, mirror);
                dY = gain * Wrap180(reachYaw - yawA) * w;
                dP = gain * (reachPitch - pitchA) * w;
                dR = DirectorBake.Soft(gain * Wrap180(targetRoll - rollA), P.Head.LimitDeg[2]) * w;
                if (planMix < 1)
                {
                    // from the held head (finished with gain 1 and no fade) to the plan's, in orientation: lerp of the two turns
                    Reachable(holdYaw, holdPitch, mirror);
                    double hY = Wrap180(reachYaw - yawA);
                    double hP = reachPitch - pitchA;
                    double hR = DirectorBake.Soft(Wrap180(holdRoll - rollA), P.Head.LimitDeg[2]);
                    dY = hY + (dY - hY) * planMix;
                    dP = hP + (dP - hP) * planMix;
                    dR = hR + (dR - hR) * planMix;
                }
            }
            if (seam != null)
            {
                dY += seam.OYaw * seam.K;
                dP += seam.OPitch * seam.K;
                dR += seam.ORoll * seam.K;
            }
            Yaw = yawA;
            Pitch = pitchA;
            Roll = rollA;
            DYaw = dY;
            DPitch = dP;
            DRoll = dR;
            if (dY == 0 && dP == 0 && dR == 0) return;
            // One rotation (in the physics frame): yaw about the vertical, then pitch about the new left axis, then roll about the new
            // line of sight (the order that keeps the head level, which is how a head turns).
            double phi = dY * Rad;
            double cp = Math.Cos(phi);
            double sp = Math.Sin(phi);
            double qyx = 0, qyy = Math.Sin(phi * 0.5), qyz = 0, qyw = Math.Cos(phi * 0.5);
            double d1x = cp * dx + sp * dz;
            double d1y = dy;
            double d1z = -sp * dx + cp * dz;
            double hl = Math.Sqrt(d1x * d1x + d1z * d1z);
            double ax = hl > 1e-6 ? d1z / hl : 1;
            double az = hl > 1e-6 ? -d1x / hl : 0;
            double th = dP * Rad;
            double st = Math.Sin(th * 0.5);
            double qpx = ax * st, qpy = 0, qpz = az * st, qpw = Math.Cos(th * 0.5);
            // the line of sight after the pitch (Rodrigues about the left axis)
            double ct = Math.Cos(th);
            double sn = Math.Sin(th);
            double dot = ax * d1x + az * d1z;
            double cxr = -az * d1y;
            double cyr = az * d1x - ax * d1z;
            double czr = ax * d1y;
            double ex = d1x * ct + cxr * sn + ax * dot * (1 - ct);
            double ey = d1y * ct + cyr * sn;
            double ez = d1z * ct + czr * sn + az * dot * (1 - ct);
            double el = Math.Sqrt(ex * ex + ey * ey + ez * ez);
            if (el == 0) el = 1;
            ex /= el;
            ey /= el;
            ez /= el;
            double rh = dR * Rad * 0.5;
            double sr = Math.Sin(rh);
            double qrx = ex * sr, qry = ey * sr, qrz = ez * sr, qrw = Math.Cos(rh);
            // R = roll * pitch * yaw
            double tx, ty, tz, tw;
            Mul(qpx, qpy, qpz, qpw, qyx, qyy, qyz, qyw, out tx, out ty, out tz, out tw);
            double rx, ry, rz, rw;
            Mul(qrx, qry, qrz, qrw, tx, ty, tz, tw, out rx, out ry, out rz, out rw);
            if (rw < 0)
            {
                rw = -rw;
                rx = -rx;
                ry = -ry;
                rz = -rz;
            }
            double sh = Math.Sqrt(rx * rx + ry * ry + rz * rz);
            if (sh <= 1e-9) return;
            // The turn is shared between the neck and the head as one rotation about an axis, and at exactly 180 degrees that axis has two answers,
            // opposite to each other: a head turned 179.9 degrees about one is turned 179.9 about the other a frame later (the neck's 61 and the
            // head's 106 degrees in one frame, 126 with a chest leaned 45 degrees or more). No correction the neck can make is that big, so a turn
            // within 29 degrees of it is eased to nothing as it nears it; every smaller turn (all of those in play) is untouched (web stage/pose.ts).
            double angle = 2 * Math.Atan2(sh, rw);
            angle *= DirectorMath.Smooth((Math.PI - angle) * 2);
            double kx = rx / sh, ky = ry / sh, kz = rz / sh;
            // The neck takes its share of the turn about the axis, the head the rest: as world rotations (the physics-frame rotation is the
            // Unity world rotation conjugated by the reflection: the axis (kx, m ky, m kz) with the same half-angle sine and cosine).
            double share = P.Head.NeckShare;
            Quaternion neckTurn = WorldTurn(kx, ky, kz, angle * share, mirror);
            Quaternion headTurn = WorldTurn(kx, ky, kz, angle, mirror);
            Quaternion headBefore = head.rotation;
            neck.rotation = neckTurn * neck.rotation;
            head.rotation = headTurn * headBefore;
        }

        private static Quaternion WorldTurn(double kx, double ky, double kz, double angle, float mirror)
        {
            double s = Math.Sin(angle * 0.5);
            return new Quaternion((float)(kx * s), (float)(mirror * ky * s), (float)(mirror * kz * s), (float)Math.Cos(angle * 0.5));
        }

        // ---- the section 9 caps (limitHead) -------------------------------------------------------------------------------

        /// <summary>
        /// MOTION-SPEC section 9: holds the finished neck and head to the caps. From the last frame's rotation (a frame at most
        /// <see cref="MemoryMs"/> before) each bone turns by no more than the speed cap allows and than its last speed plus the acceleration
        /// cap allows; and with <paramref name="brake"/> it never arrives faster than it can stop (slowing by <see cref="BrakeDegPerS2"/>
        /// every frame still stops it within the angle that is left). The head then lags the plan's head in space for those few frames and
        /// catches up. Returns whether a bone was held back.
        /// </summary>
        public bool Limit(double tMs, bool brake)
        {
            // The same frame posed again (a Tick of no time, a probe, a second pass of one frame) starts from where the frame began, as the first
            // pass did. Otherwise its dt is 0, it is not continued and nothing is held: the second pass would draw the head the first had held back,
            // at any speed, and the frame would depend on how many times it was posed (web three/players.ts limitHead).
            if (Math.Abs(tMs - memT) < 0.5 && !double.IsNaN(startT))
            {
                memT = startT;
                memNeck = startNeck;
                memHead = startHead;
                speedNeck = startSpeedNeck;
                speedHead = startSpeedHead;
            }
            else
            {
                startT = memT;
                startNeck = memNeck;
                startHead = memHead;
                startSpeedNeck = speedNeck;
                startSpeedHead = speedHead;
            }
            double dt = tMs - memT;
            bool continued = dt > 0.5 && dt <= MemoryMs;
            bool held = false;
            beforeMemHead = memHead;
            for (int b = 0; b < 2; b++)
            {
                Transform bone = b == 0 ? neck : head;
                Quaternion q = bone.localRotation;
                Quaternion mem = b == 0 ? memNeck : memHead;
                double ang = 0;
                if (continued)
                {
                    double d = Math.Abs((double)mem.x * q.x + (double)mem.y * q.y + (double)mem.z * q.z + (double)mem.w * q.w);
                    ang = 2 * Math.Acos(d > 1 ? 1 : d) * Deg;
                    // the speed v from which braking by dv a frame (v, v - dv, v - 2 dv, ...) just stops within `ang`: dt (v^2 / 2 dv + v / 2) = ang
                    double dtS = dt / 1000;
                    double dv = BrakeDegPerS2 * dtS;
                    double sStop = brake ? 0.5 * (Math.Sqrt(dv * dv + (8 * dv * ang) / dtS) - dv) : double.PositiveInfinity;
                    double sMax = Math.Min(SpeedDegPerS, Math.Min((b == 0 ? speedNeck : speedHead) + AccelDegPerS2 * dtS, sStop));
                    double step = (sMax * dt) / 1000;
                    if (ang > step && ang > 1e-9)
                    {
                        // slerp from the last rotation towards the new one by step / ang
                        q = Quaternion.SlerpUnclamped(mem, q, (float)(step / ang));
                        double n = Math.Sqrt((double)q.x * q.x + (double)q.y * q.y + (double)q.z * q.z + (double)q.w * q.w);
                        if (n > 0) q = new Quaternion((float)(q.x / n), (float)(q.y / n), (float)(q.z / n), (float)(q.w / n));
                        bone.localRotation = q;
                        ang = step;
                        held = true;
                    }
                }
                double speed = continued ? (ang * 1000) / dt : 0;
                if (b == 0)
                {
                    speedNeck = speed;
                    memNeck = q;
                }
                else
                {
                    speedHead = speed;
                    memHead = q;
                }
            }
            memT = tMs;
            return held;
        }

        private static double AngleDeg(Quaternion a, Quaternion b)
        {
            double d = Math.Abs((double)a.x * b.x + (double)a.y * b.y + (double)a.z * b.z + (double)a.w * b.w);
            return 2 * Math.Acos(d > 1 ? 1 : d) * Deg;
        }

        private static Quaternion Toward(Quaternion from, Quaternion to, double amount)
        {
            Quaternion q = Quaternion.SlerpUnclamped(from, to, (float)amount);
            double n = Math.Sqrt((double)q.x * q.x + (double)q.y * q.y + (double)q.z * q.z + (double)q.w * q.w);
            return n > 0 ? new Quaternion((float)(q.x / n), (float)(q.y / n), (float)(q.z / n), (float)(q.w / n)) : q;
        }

        /// <summary>
        /// The speed a viewer sees. The bone caps above hold the neck and head against their parents; the head's world rotation also carries the trunk's
        /// (a bowler turning to walk back turns the chest at over 1,000 deg/s in the clips, and the head the world drew turns with it). Where the head the
        /// world drew already turns faster in the world than the cap allows, the Director never adds to it: the head turns in the world by no more in
        /// that frame than the base head did by itself. (Below the cap the bone caps alone apply: this is not a second limiter on the Director's own
        /// motion, whose local pops it would make.) The bone caps then go on from the head as it is left. Returns whether the head was held back.
        /// </summary>
        private bool WorldGuard(double tMs, Quaternion baseNeckNow, Quaternion baseHeadNow)
        {
            // (a frame posed again starts from where it began, like the bone caps)
            if (Math.Abs(tMs - guardT) < 0.5 && !double.IsNaN(guardStartT))
            {
                guardT = guardStartT;
                guardBaseHead = guardStartBase;
                guardFinalHead = guardStartFinal;
            }
            else
            {
                guardStartT = guardT;
                guardStartBase = guardBaseHead;
                guardStartFinal = guardFinalHead;
            }
            double dt = tMs - guardT;
            bool held = false;
            if (dt > 0.5 && dt <= MemoryMs)
            {
                double capStep = SpeedDegPerS * dt / 1000;
                double baseStep = AngleDeg(guardBaseHead, baseHeadNow);
                if (baseStep > capStep || WorldCapEnabled)
                {
                    // Past the cap the head the world drew sets the most the head may turn (the Director adds nothing to it); below it the head turns in
                    // the world by at most the cap, whatever the neck and the head ask of their own bones.
                    double allowed = Math.Max(baseStep, capStep);
                    Quaternion headWanted = head.rotation;
                    double step = AngleDeg(guardFinalHead, headWanted);
                    if (step > allowed && step > 1e-9)
                    {
                        head.rotation = Toward(guardFinalHead, headWanted, allowed / step);
                        held = true;
                        speedHead = AngleDeg(beforeMemHead, head.localRotation) * 1000 / dt;
                        memHead = head.localRotation;
                    }
                }
            }
            guardBaseHead = baseHeadNow;
            guardFinalHead = head.rotation;
            guardT = tMs;
            return held;
        }

        /// <summary>The head pass on a frame with no plan and no seam: only remembers the head as it ends up (a script's first frames).</summary>
        public void Note(float mirror, StageDrawnHead drawn)
        {
            Axes(mirror);
            Remember(drawn);
        }
    }
}
