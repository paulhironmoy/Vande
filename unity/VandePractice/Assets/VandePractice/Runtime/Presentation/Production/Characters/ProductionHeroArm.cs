using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// What one hero arm remembers of its last frame (the web's ElbowMemory, players.ts round 8): its upper arm's rotation in
    /// the chest's frame and the glove's turn about the handle at the end of the last solve. The two ranges on a batter's arm
    /// (upper-arm twist, wrist bend) leave the elbow two windows to sit in, and a solve from the pole alone flips between them
    /// as the demanded twist crosses 180 degrees. In a run of frames (each within ProductionHeroArm.MemorySeconds of the one
    /// before) the next solve therefore starts from the swivel that keeps the upper arm nearest to where it was and eases back
    /// to the pole's at ProductionHeroArm.HomeDegreesPerSecond. A seek, a new script or a first frame has no memory: the arm is
    /// then solved from the pole alone.
    /// </summary>
    internal sealed class ProductionArmMemory
    {
        /// <summary>The clock (s) of the frame being solved and the time since the frame before it.</summary>
        public double Stamp = double.NaN;
        public double DeltaSeconds;
        /// <summary>The frame before's end state: the upper arm in the chest's frame and the glove's turn about the handle (radians).</summary>
        public bool HasPrevious;
        public Quaternion Previous = Quaternion.identity;
        public float PreviousRoll;
        /// <summary>The state after the latest solve of this frame (it becomes the previous one at the next frame).</summary>
        public bool HasNow;
        public Quaternion Now = Quaternion.identity;
        public float NowRoll;

        /// <summary>This memory as `other` has it (a snapshot taken, or put back).</summary>
        public void CopyFrom(ProductionArmMemory other)
        {
            Stamp = other.Stamp;
            DeltaSeconds = other.DeltaSeconds;
            HasPrevious = other.HasPrevious;
            Previous = other.Previous;
            PreviousRoll = other.PreviousRoll;
            HasNow = other.HasNow;
            Now = other.Now;
            NowRoll = other.NowRoll;
        }

        public void Clear()
        {
            Stamp = double.NaN;
            DeltaSeconds = 0.0;
            HasPrevious = false;
            HasNow = false;
            PreviousRoll = 0f;
            NowRoll = 0f;
        }

        /// <summary>Moves the memory on to the frame stamped `clock` (seconds; NaN: no memory). The solves of one clock value are one frame.</summary>
        public void BeginFrame(double clock)
        {
            if (double.IsNaN(clock) || double.IsInfinity(clock))
            {
                Clear();
                return;
            }
            if (clock == Stamp) return;
            // Last frame's end state is this frame's start, if the last frame is near enough in time.
            var delta = clock - Stamp;
            HasPrevious = HasNow && delta > 0.0 && delta <= ProductionHeroArm.MemorySeconds;
            Previous = Now;
            PreviousRoll = NowRoll;
            DeltaSeconds = delta > 0.0 ? delta : 0.0;
            Stamp = clock;
            HasNow = false;
        }
    }

    /// <summary>
    /// The visible hero's batter arm in canonical VC17 terms (MOTION-SPEC sections 3 and 9) and its hinge-respecting solve (the
    /// web's reachIK, src/render3d/three/players.ts, rounds 6 to 8).
    ///
    /// The hero's bones keep VSK1's A-pose: Synchronize writes rest * inverse(parent correction) * canonical * correction, where
    /// the correction turns a bone's child direction to local down (the hand's: its long axis). The canonical frame of a limb
    /// bone is therefore its world rotation less that correction (G = W * inverse(correction)): in G the limb hangs along -Y
    /// exactly as the canonical skeleton's does, so the elbow is a hinge about G's X and section 9's limits read on the visible
    /// arm. Until UNITY-5 Synchronize did not undo the parent's correction for a child (a canonical-zero forearm stood 39.4
    /// degrees off the upper arm in the hero's A-pose, the hand 61.4), so the plain inverse of it was not a joint angle; with the
    /// parent's correction put back (Canonical.ForearmSynchronized) it is, and equals Canonical.Forearm unless a grip solve
    /// has written the bones' world rotations.
    /// </summary>
    internal static class ProductionHeroArm
    {
        /// <summary>Section 9's elbow range (the forearm's X, degrees): [-150, 5].</summary>
        public const float ElbowMinDegrees = -150f;
        public const float ElbowMaxDegrees = 5f;
        /// <summary>
        /// The hand never leaves the bat for the elbow's range: a grip nearer the shoulder than a 150 degree elbow allows (the bat
        /// held on the shoulder at the finish of a stroke) folds the elbow on, at most to this.
        /// </summary>
        public const float ElbowFoldStopDegrees = 175f;
        /// <summary>The upper arm's twist is held to this (section 9 allows 110); the web holds it to 105.</summary>
        public const float UpperArmTwistMaxDegrees = 105f;
        /// <summary>The wrist's bend is held to this (section 9 allows 85); the web holds it to 80.</summary>
        public const float WristSwingMaxDegrees = 80f;
        /// <summary>A remembered elbow is used only when the last frame was at most this long ago (s): 20 fps and faster.</summary>
        public const double MemorySeconds = 0.05;
        /// <summary>How fast the swivel eases back to the pole's (degrees per second): about 3 degrees a frame at 60 fps.</summary>
        public const float HomeDegreesPerSecond = 180f;
        /// <summary>How fast the elbow's plane may travel from one twist window to the other (degrees per second): 20 degrees a frame at 60 fps.</summary>
        public const float SwivelDegreesPerSecond = 1200f;
        /// <summary>The plane moves at most this far (degrees) to fit the wrist.</summary>
        public const float WristSearchDegrees = 20f;
        /// <summary>
        /// The glove turns about the handle at most this far (degrees) from the orthodox grip to keep the wrist's bend in range (the
        /// web's relaxGrip allows 75): a hand round a handle holds it at any turn.
        /// </summary>
        public const float GripRollMaxDegrees = 60f;
        /// <summary>How fast the glove turns about the handle (degrees per second): 15 degrees a frame at 60 fps.</summary>
        public const float GripRollDegreesPerSecond = 900f;
        /// <summary>How fast the glove comes back to the orthodox grip once the wrist allows it (degrees per second).</summary>
        public const float GripRollHomeDegreesPerSecond = 120f;

        private const float Deg = Mathf.Rad2Deg;
        private const float Rad = Mathf.Deg2Rad;

        public static ProductionCharacterJoint UpperJoint(bool left) =>
            left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight;

        public static ProductionCharacterJoint ForearmJoint(bool left) =>
            left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight;

        public static ProductionCharacterJoint HandJoint(bool left) =>
            left ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight;

        // ---- Reading the visible arm in canonical frames ----------------------------------------------------------

        /// <summary>One visible hero arm read back to canonical VC17 rotations (builder evidence and the arm tests).</summary>
        internal struct Canonical
        {
            /// <summary>The upper arm in the chest's frame (the shoulder girdle's reach included): section 9's shoulder swing and twist.</summary>
            public Quaternion UpperVsChest;
            /// <summary>The upper arm in the shoulder helper's frame (the girdle's reach not included).</summary>
            public Quaternion UpperVsShoulder;
            /// <summary>The forearm in the upper arm's canonical frame: a pure X turn for a hinge. Section 9's elbow.</summary>
            public Quaternion Forearm;
            /// <summary>The plain inverse of Synchronize on the forearm (rest * inverse(parent correction) * canonical * correction), the parent's correction put back: the canonical rotation Synchronize was given (see the class summary).</summary>
            public Quaternion ForearmSynchronized;
            /// <summary>The hand in the forearm's canonical frame (both limbs along -Y): its swing is the wrist's bend. Section 9's wrist.</summary>
            public Quaternion Hand;
        }

        /// <summary>Reads one hero arm. The VSK1 rest rotations are the identity (asserted by the arm tests), so they are left out.</summary>
        internal static Canonical Read(ProductionHeroSkeletonInstance skeleton, bool left)
        {
            Quaternion restUpper, correctionUpper, restForearm, correctionForearm, restHand, correctionHand;
            skeleton.RestFramesOf(UpperJoint(left), out restUpper, out correctionUpper);
            skeleton.RestFramesOf(ForearmJoint(left), out restForearm, out correctionForearm);
            skeleton.RestFramesOf(HandJoint(left), out restHand, out correctionHand);
            var upper = skeleton.BoneOf(UpperJoint(left));
            var forearm = skeleton.BoneOf(ForearmJoint(left));
            var chest = skeleton.BoneOf(ProductionCharacterJoint.Chest);
            var worldUpper = upper.rotation;
            var worldForearm = forearm.rotation;
            var worldHand = skeleton.BoneOf(HandJoint(left)).rotation;
            return new Canonical
            {
                UpperVsChest = Quaternion.Inverse(chest.rotation) * worldUpper * Quaternion.Inverse(correctionUpper),
                UpperVsShoulder = Quaternion.Inverse(upper.parent.rotation) * worldUpper * Quaternion.Inverse(correctionUpper),
                Forearm = correctionUpper * Quaternion.Inverse(worldUpper) * worldForearm * Quaternion.Inverse(correctionForearm),
                ForearmSynchronized = correctionUpper * Quaternion.Inverse(restForearm) * Quaternion.Inverse(forearm.parent.rotation) *
                                      worldForearm * Quaternion.Inverse(correctionForearm),
                Hand = correctionForearm * Quaternion.Inverse(worldForearm) * worldHand * Quaternion.Inverse(correctionHand)
            };
        }

        // ---- The solve --------------------------------------------------------------------------------------------

        /// <summary>
        /// The arm's two-bone IK, hinge-respecting: the forearm turns about its own X only, within the elbow's range, and the
        /// upper arm swings and twists to put the wrist on `target` with the elbow's plane through `pole` (a direction the elbow
        /// points towards, from the reach line). The elbow's plane is turned about the reach line, as little as it takes, to
        /// keep the upper arm's twist within its range (and, within WristSearchDegrees, the wrist's bend); with the arm's
        /// `memory` it starts from where the elbow was, easing back to the pole's at HomeDegreesPerSecond. The hand takes
        /// `handWorld`, turned about the handle (the hand's -Y) as far as it takes to keep the wrist's bend in range. No bone
        /// moves: the shoulder reach has been made before. Returns the wrist's distance from `target` (m).
        /// </summary>
        internal static float Solve(ProductionHeroSkeletonInstance skeleton, bool left, Vector3 target, Quaternion handWorld,
            Vector3 pole, ProductionArmMemory memory)
        {
            var upper = skeleton.BoneOf(UpperJoint(left));
            var forearm = skeleton.BoneOf(ForearmJoint(left));
            var hand = skeleton.BoneOf(HandJoint(left));
            var chest = skeleton.BoneOf(ProductionCharacterJoint.Chest);

            var shoulder = upper.position;
            // The chain's offsets in the bones' own frames, as they are now (the twist bones between them may be turned a few
            // degrees by secondary motion): the elbow in the upper arm's frame and the wrist in the forearm's. Turning a bone
            // leaves its offsets as they are, so the wrist lands on the reach line whatever the twist bones are doing.
            var elbowOffset = Quaternion.Inverse(upper.rotation) * (forearm.position - shoulder);
            var wristOffset = Quaternion.Inverse(forearm.rotation) * (hand.position - forearm.position);
            var upperLength = elbowOffset.magnitude;
            var lowerLength = wristOffset.magnitude;
            var toTarget = target - shoulder;
            if (upperLength <= 0.001f || lowerLength <= 0.001f || toTarget.sqrMagnitude <= 1e-10f)
                return Vector3.Distance(hand.position, target);
            // Each limb's canonical frame is its bone's less the turn that takes its offset to local down.
            var correctionUpper = Quaternion.FromToRotation(elbowOffset / upperLength, Vector3.down);
            var correctionForearm = Quaternion.FromToRotation(wristOffset / lowerLength, Vector3.down);

            // The elbow: the law of cosines for the reach, as a hinge turn about X (negative bends the forearm forward).
            var reach = Mathf.Clamp(toTarget.magnitude, Mathf.Abs(upperLength - lowerLength) + 1e-3f, upperLength + lowerLength - 1e-3f);
            var n = toTarget.normalized;
            var cosine = (reach * reach - upperLength * upperLength - lowerLength * lowerLength) / (2f * upperLength * lowerLength);
            var theta = Mathf.Clamp(-Mathf.Acos(Mathf.Clamp(cosine, -1f, 1f)), -ElbowFoldStopDegrees * Rad, ElbowMaxDegrees * Rad);

            // The chain in the upper arm's canonical frame (both limbs along -Y at rest) and where the elbow points from it.
            var chord = new Vector3(0f, -upperLength - lowerLength * Mathf.Cos(theta), -lowerLength * Mathf.Sin(theta)).normalized;
            var elbowAt = new Vector3(0f, -upperLength, 0f);
            var bulge = elbowAt - chord * Vector3.Dot(elbowAt, chord);
            if (bulge.sqrMagnitude < 1e-10f) bulge = new Vector3(0f, chord.z, -chord.y);
            bulge.Normalize();

            // The pole, square to the reach line (a straight arm keeps a sensible elbow: down).
            var side = pole - n * Vector3.Dot(pole, n);
            if (side.sqrMagnitude < 1e-8f) side = Vector3.down - n * Vector3.Dot(Vector3.down, n);
            if (side.sqrMagnitude < 1e-8f) side = Vector3.Cross(n, Vector3.right);
            side.Normalize();

            // The upper arm's canonical world rotation at the pole's plane: (chord, bulge) onto (n, side). A swivel of phi about
            // the reach line is Rot(n, phi) * restPlane.
            var restPlane = FromColumns(n, side, Vector3.Cross(n, side)) *
                            Quaternion.Inverse(FromColumns(chord, bulge, Vector3.Cross(chord, bulge)));
            var chestInverse = Quaternion.Inverse(chest.rotation);
            var plane = new Swivel
            {
                Q0 = chestInverse * restPlane,
                Axis = chestInverse * n,
                Reach = n,
                Forearm = restPlane * new Vector3(0f, -Mathf.Cos(theta), -Mathf.Sin(theta)),
                Fingers = handWorld * skeleton.HandRestDirection(left)
            };

            var phi = plane.Wrist(plane.Twist(plane.Start(memory), memory), UpperArmTwistMaxDegrees);

            var canonicalUpper = Quaternion.AngleAxis(phi * Deg, n) * restPlane;
            var check = canonicalUpper.x + canonicalUpper.y + canonicalUpper.z + canonicalUpper.w;
            if (float.IsNaN(check) || float.IsInfinity(check)) return Vector3.Distance(hand.position, target);
            var hinge = new Quaternion(Mathf.Sin(theta * 0.5f), 0f, 0f, Mathf.Cos(theta * 0.5f));
            upper.rotation = canonicalUpper * correctionUpper;
            forearm.rotation = canonicalUpper * hinge * correctionForearm;
            // The wrist's bend is the last range: the glove turns about the handle, as little as it takes and from where it
            // was, to keep it inside. The wrist is on the handle's axis, so it stays where it is.
            var handle = handWorld * Vector3.down;
            var roll = GripRoll(Quaternion.AngleAxis(phi * Deg, n) * plane.Forearm, plane.Fingers, handle, memory);
            hand.rotation = Quaternion.AngleAxis(roll * Deg, handle) * handWorld;
            if (memory != null)
            {
                memory.Now = chestInverse * canonicalUpper;
                memory.NowRoll = roll;
                memory.HasNow = true;
            }
            return Vector3.Distance(hand.position, target);
        }

        /// <summary>
        /// The upper arm's swivel about the reach line. Q0 is its rotation in the chest's frame at the pole's plane, Axis the reach
        /// line in that frame, Reach the reach line in the world, Forearm the forearm's direction (world, at the pole's plane) and
        /// Fingers the hand's long axis (world). The arm's rotation at a swivel of phi is (cos(phi/2) + sin(phi/2) * Axis) * Q0.
        /// </summary>
        private struct Swivel
        {
            public Quaternion Q0;
            public Vector3 Axis, Reach, Forearm, Fingers;

            /// <summary>The upper arm's twist (degrees, about its own Y, in the chest's frame) at a swivel.</summary>
            public float TwistAt(float phi)
            {
                var q = Quaternion.AngleAxis(phi * Deg, Axis) * Q0;
                return Mathf.Abs(Mathf.DeltaAngle(0f, 2f * Mathf.Atan2(q.y, q.w) * Deg));
            }

            /// <summary>The angle (degrees) between the forearm's direction and the fingers' at a swivel: the wrist's bend.</summary>
            public float SwingAt(float phi) => Vector3.Angle(Quaternion.AngleAxis(phi * Deg, Reach) * Forearm, Fingers);

            /// <summary>
            /// Where the swivel starts: the pole's plane (0) or, in a run of frames, the turn that keeps the upper arm nearest to
            /// where it was. Its dot with the remembered rotation is a sinusoid of phi/2, so the nearest turn is 2 * atan2(B, A)
            /// (A, B: the sinusoid's two coefficients), eased back to the pole's at HomeDegreesPerSecond.
            /// </summary>
            public float Start(ProductionArmMemory memory)
            {
                if (memory == null || !memory.HasPrevious) return 0f;
                var a = Dot(Q0, memory.Previous);
                var b = Dot(new Quaternion(Axis.x, Axis.y, Axis.z, 0f) * Q0, memory.Previous);
                if (a * a + b * b <= 1e-8f) return 0f;
                var start = Mathf.Atan2(b, a) * 2f;
                start = Mathf.Atan2(Mathf.Sin(start), Mathf.Cos(start));
                var home = (float)(HomeDegreesPerSecond * Math.Min(memory.DeltaSeconds, MemorySeconds)) * Rad;
                return start - Mathf.Clamp(start, -home, home);
            }

            /// <summary>
            /// The upper arm's twist is the hard range: from `start` the nearest swivel, either way, that brings it inside (5 degree
            /// steps, then refined between the last step out and the first in, so the elbow moves on smoothly as the need grows).
            /// Its two windows swap when one closes, so a swivel that has to go to the other window travels there at
            /// SwivelDegreesPerSecond from the frame before instead of in one frame: a few frames over the range, not a pop.
            /// </summary>
            public float Twist(float start, ProductionArmMemory memory)
            {
                if (TwistAt(start) <= UpperArmTwistMaxDegrees) return start;
                const float step = Mathf.PI / 36f;
                for (var k = 1; k <= 36; k++)
                {
                    for (var s = 0; s < 2; s++)
                    {
                        var sign = s == 0 ? 1f : -1f;
                        if (TwistAt(start + sign * k * step) > UpperArmTwistMaxDegrees) continue;
                        var outside = (k - 1) * step;
                        var inside = k * step;
                        for (var it = 0; it < 6; it++)
                        {
                            var middle = (outside + inside) * 0.5f;
                            if (TwistAt(start + sign * middle) <= UpperArmTwistMaxDegrees) inside = middle;
                            else outside = middle;
                        }
                        var go = sign * inside;
                        if (memory != null && memory.HasPrevious)
                        {
                            var most = SwivelDegreesPerSecond * Rad * (float)Math.Min(memory.DeltaSeconds, MemorySeconds);
                            go = Mathf.Clamp(go, -most, most);
                        }
                        return start + go;
                    }
                }
                // No swivel brings the twist inside (a hand where the hinge cannot roll the arm that far): the least twisted
                // plane near where the arm is, so the arm stays put rather than hunt the circle for a lesser evil.
                var least = start;
                var leastTwist = TwistAt(start);
                for (var k = 1; k <= 16; k++)
                {
                    for (var s = 0; s < 2; s++)
                    {
                        var candidate = start + (s == 0 ? 1f : -1f) * k * 2.5f * Rad;
                        var twist = TwistAt(candidate);
                        if (twist >= leastTwist - 0.01f) continue;
                        leastTwist = twist;
                        least = candidate;
                    }
                }
                return least;
            }

            /// <summary>
            /// The wrist's bend is the soft range: the hand is the bat's, so no plane may fit it. From `phi` the swivel moves at most
            /// WristSearchDegrees (and never into more twist than it has) to the nearest one that fits, else the one that comes
            /// nearest to fitting; the glove's turn about the handle (GripRoll) does the rest.
            /// </summary>
            public float Wrist(float phi, float twistFloor)
            {
                if (SwingAt(phi) <= WristSwingMaxDegrees) return phi;
                var twistCeiling = Mathf.Max(twistFloor, TwistAt(phi));
                var best = phi;
                var bestSwing = SwingAt(phi);
                const float step = 2.5f * Rad;
                var steps = Mathf.RoundToInt(WristSearchDegrees / 2.5f);
                for (var k = 1; k <= steps && bestSwing > WristSwingMaxDegrees; k++)
                {
                    for (var s = 0; s < 2; s++)
                    {
                        var candidate = phi + (s == 0 ? 1f : -1f) * k * step;
                        if (TwistAt(candidate) > twistCeiling) continue;
                        var swing = SwingAt(candidate);
                        if (swing >= bestSwing - 0.01f) continue;
                        bestSwing = swing;
                        best = candidate;
                        if (swing <= WristSwingMaxDegrees) break;
                    }
                }
                return best;
            }
        }

        /// <summary>
        /// The glove's turn about the handle (radians). It stays where it was while that fits (easing back to the orthodox grip
        /// at GripRollHomeDegreesPerSecond while the orthodox side still fits); when the angle between the forearm's direction and
        /// the fingers' is past WristSwingMaxDegrees it goes to the nearest turn that fits, else to the one that comes nearest to
        /// fitting, never more than GripRollMaxDegrees from the orthodox grip nor faster than GripRollDegreesPerSecond.
        /// </summary>
        private static float GripRoll(Vector3 forearmDirection, Vector3 fingers, Vector3 handle, ProductionArmMemory memory)
        {
            var run = memory != null && memory.HasPrevious;
            var from = run ? memory.PreviousRoll : 0f;
            var seconds = run ? (float)Math.Min(memory.DeltaSeconds, MemorySeconds) : 0f;
            if (run)
            {
                var home = GripRollHomeDegreesPerSecond * Rad * seconds;
                var eased = from - Mathf.Clamp(from, -home, home);
                if (RollSwing(forearmDirection, fingers, handle, eased) <= WristSwingMaxDegrees) return eased;
            }
            if (RollSwing(forearmDirection, fingers, handle, from) <= WristSwingMaxDegrees) return from;
            var limit = GripRollMaxDegrees * Rad;
            var best = from;
            var bestSwing = float.PositiveInfinity;
            var bestFits = false;
            const int steps = 24;
            for (var k = 0; k <= steps; k++)
            {
                var candidate = -limit + 2f * limit * k / steps;
                var swing = RollSwing(forearmDirection, fingers, handle, candidate);
                var fits = swing <= WristSwingMaxDegrees;
                if (fits ? (!bestFits || Mathf.Abs(candidate - from) < Mathf.Abs(best - from)) : (!bestFits && swing < bestSwing - 0.01f))
                {
                    best = candidate;
                    bestSwing = swing;
                    bestFits = fits;
                }
            }
            if (run)
            {
                var most = GripRollDegreesPerSecond * Rad * seconds;
                best = from + Mathf.Clamp(best - from, -most, most);
            }
            return best;
        }

        private static float RollSwing(Vector3 forearmDirection, Vector3 fingers, Vector3 handle, float roll) =>
            Vector3.Angle(forearmDirection, Quaternion.AngleAxis(roll * Deg, handle) * fingers);

        private static float Dot(Quaternion a, Quaternion b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

        /// <summary>The rotation whose columns are the three orthonormal vectors (a proper rotation: the third is the cross product of the first two).</summary>
        private static Quaternion FromColumns(Vector3 c0, Vector3 c1, Vector3 c2)
        {
            float m00 = c0.x, m01 = c1.x, m02 = c2.x;
            float m10 = c0.y, m11 = c1.y, m12 = c2.y;
            float m20 = c0.z, m21 = c1.z, m22 = c2.z;
            var trace = m00 + m11 + m22;
            Quaternion q;
            if (trace > 0f)
            {
                var s = Mathf.Sqrt(trace + 1f) * 2f;
                q = new Quaternion((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25f * s);
            }
            else if (m00 > m11 && m00 > m22)
            {
                var s = Mathf.Sqrt(1f + m00 - m11 - m22) * 2f;
                q = new Quaternion(0.25f * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
            }
            else if (m11 > m22)
            {
                var s = Mathf.Sqrt(1f + m11 - m00 - m22) * 2f;
                q = new Quaternion((m01 + m10) / s, 0.25f * s, (m12 + m21) / s, (m02 - m20) / s);
            }
            else
            {
                var s = Mathf.Sqrt(1f + m22 - m00 - m11) * 2f;
                q = new Quaternion((m02 + m20) / s, (m12 + m21) / s, 0.25f * s, (m10 - m01) / s);
            }
            var length = Mathf.Sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            return new Quaternion(q.x / length, q.y / length, q.z / length, q.w / length);
        }
    }
}
