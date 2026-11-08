using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// The Director's life pass for one rig (a port of stage/pose.ts applyLife): breath, sway, hip roll, posture and twist, the
    /// channels that move the torso, hips and root. The values are set once per drawn frame from the plan's channels
    /// (<see cref="Set"/>) and the rig applies them every time it applies a pose, BEFORE the planted-foot and arm solves (so the feet stay
    /// where they landed and the gloves stay on the handle while the body breathes). Nothing here sees the ball, the plan or the result:
    /// only the baked channels. It allocates nothing.
    /// <para>
    /// The offsets are authored in the canonical (right-handed) frame. A rig whose poses go through the canonical mirror (a "Left" rig:
    /// ProceduralPracticeWorld.RigHandednessFor) takes them mirrored: the Y and Z components and the sideways sway change sign.
    /// When every channel is zero (the quiet windows, Reduced Motion) <see cref="Active"/> is false and the rig is untouched, bit for bit.
    /// </para>
    /// </summary>
    public sealed class DirectorLife
    {
        /// <summary>Some channel is not zero: the rig has something to apply.</summary>
        public bool Active { get; private set; }

        /// <summary>Chest swing (deg), + inhale.</summary>
        public float BreathDeg { get; private set; }

        /// <summary>Hips roll (deg), + to the right.</summary>
        public float SwayRollDeg { get; private set; }

        /// <summary>Trunk posture (deg), + lifts the chest.</summary>
        public float PostureDeg { get; private set; }

        /// <summary>Upper-body twist about the vertical (deg), + to the left.</summary>
        public float TwistDeg { get; private set; }

        /// <summary>Root shift across the pitch (m), + to the actor's left, in the rig's own units after division by the rig scale.</summary>
        public float SwayXMetres { get; private set; }

        /// <summary>Root shift along the pitch (m), + toward the opponent.</summary>
        public float SwayZMetres { get; private set; }

        // The rotation each bone is given on top of its pose (bone local * offset), composed once per frame in Set: for the canonical frame
        // and for a rig whose poses go through the canonical mirror.
        private Quaternion hips = Quaternion.identity, spine = Quaternion.identity, chest = Quaternion.identity;
        private Quaternion hipsMirrored = Quaternion.identity, spineMirrored = Quaternion.identity, chestMirrored = Quaternion.identity;

        /// <summary>What the life added to the hips' local rotation (hips * offset): the canonical frame, or the mirror image for a mirrored rig.</summary>
        public Quaternion HipsOffset(bool mirrored) { return mirrored ? hipsMirrored : hips; }

        /// <summary>What the life added to the spine's local rotation.</summary>
        public Quaternion SpineOffset(bool mirrored) { return mirrored ? spineMirrored : spine; }

        /// <summary>What the life added to the chest's local rotation.</summary>
        public Quaternion ChestOffset(bool mirrored) { return mirrored ? chestMirrored : chest; }

        /// <summary>No life: the rig draws as it always did.</summary>
        public void Clear()
        {
            Active = false;
            BreathDeg = SwayRollDeg = PostureDeg = TwistDeg = SwayXMetres = SwayZMetres = 0f;
            hips = spine = chest = hipsMirrored = spineMirrored = chestMirrored = Quaternion.identity;
        }

        /// <summary>Takes the plan's channels at fade weight <paramref name="w"/> (null channels or a weight of zero clear it).</summary>
        public void Set(float[] ch, double w)
        {
            Set(ch, w, null);
        }

        /// <summary>
        /// As <see cref="Set(float[], double)"/>, with the seam of the script's first frames: the life the scene before ended with, given back by the share
        /// the seam still has (so that the breath and the sway do not stop in one frame as a delivery begins). The plan may not be there yet (null channels).
        /// </summary>
        public void Set(float[] ch, double w, StageSeam seam)
        {
            bool plan = ch != null && w > 0;
            bool carried = seam != null && seam.LifeOn && seam.K > 0;
            if (!plan && !carried)
            {
                Clear();
                return;
            }
            double breath = 0, swayX = 0, swayZ = 0, roll = 0, posture = 0, twist = 0;
            if (plan)
            {
                breath = ch[DirectorChannels.Breath] * w;
                swayX = ch[DirectorChannels.SwayX] * w;
                swayZ = ch[DirectorChannels.SwayZ] * w;
                roll = ch[DirectorChannels.SwayRoll] * w;
                posture = ch[DirectorChannels.Posture] * w;
                twist = ch[DirectorChannels.Twist] * w;
            }
            if (carried)
            {
                double k = seam.K;
                breath += seam.Life0[0] * k;
                swayX += seam.Life0[1] * k;
                swayZ += seam.Life0[2] * k;
                roll += seam.Life0[3] * k;
                posture += seam.Life0[4] * k;
                twist += seam.Life0[5] * k;
            }
            BreathDeg = (float)breath;
            SwayXMetres = (float)(swayX / 1000.0);
            SwayZMetres = (float)(swayZ / 1000.0);
            SwayRollDeg = (float)roll;
            PostureDeg = (float)posture;
            TwistDeg = (float)twist;
            Active = BreathDeg != 0f || SwayXMetres != 0f || SwayZMetres != 0f || SwayRollDeg != 0f || PostureDeg != 0f || TwistDeg != 0f;
            if (Active) Compose();
            else hips = spine = chest = hipsMirrored = spineMirrored = chestMirrored = Quaternion.identity;
        }

        /// <summary>
        /// The rotations of the web's order (pose.ts applyLife), each in the bone's own frame after the bone's pose: hips Z += roll, spine Z += -0.6 roll,
        /// spine X += -0.4 posture, chest X += -0.6 posture, spine Y += 0.4 twist, chest Y += 0.6 twist, chest X += -0.65 breath, spine X += -0.35 breath;
        /// composed into one rotation a bone. The mirrored set flips the roll and the twist (the Y and Z turns of a mirrored frame).
        /// </summary>
        private void Compose()
        {
            Compose(1f, out hips, out spine, out chest);
            Compose(-1f, out hipsMirrored, out spineMirrored, out chestMirrored);
        }

        private void Compose(float m, out Quaternion h, out Quaternion s, out Quaternion c)
        {
            float sr = SwayRollDeg * m;
            float po = PostureDeg;
            float tw = TwistDeg * m;
            float b = BreathDeg;
            h = sr != 0f ? Quaternion.AngleAxis(sr, Vector3.forward) : Quaternion.identity;
            s = sr != 0f ? Quaternion.AngleAxis(-0.6f * sr, Vector3.forward) : Quaternion.identity;
            c = Quaternion.identity;
            if (po != 0f)
            {
                s = s * Quaternion.AngleAxis(-0.4f * po, Vector3.right);
                c = c * Quaternion.AngleAxis(-0.6f * po, Vector3.right);
            }
            if (tw != 0f)
            {
                s = s * Quaternion.AngleAxis(0.4f * tw, Vector3.up);
                c = c * Quaternion.AngleAxis(0.6f * tw, Vector3.up);
            }
            if (b != 0f)
            {
                c = c * Quaternion.AngleAxis(-0.65f * b, Vector3.right);
                s = s * Quaternion.AngleAxis(-0.35f * b, Vector3.right);
            }
        }

        /// <summary>
        /// The root shift in the rig's local units (the motion root's local position is in units of the rig's scale): sway is
        /// X + to the actor's left, Z + toward the opponent; <paramref name="mirrored"/> flips the sideways shift.
        /// </summary>
        public Vector3 RootShift(float rigScale, bool mirrored)
        {
            if (!Active) return Vector3.zero;
            float k = 1f / Mathf.Max(0.0001f, rigScale);
            return new Vector3((mirrored ? -SwayXMetres : SwayXMetres) * k, 0f, SwayZMetres * k);
        }

        /// <summary>
        /// Adds the rotations to the rig's driver joints (local, after the pose has been assigned): each bone's local rotation times its offset
        /// (<see cref="Compose()"/> has composed the web's order into one).
        /// </summary>
        public void ApplyRotations(Transform hipsBone, Transform spineBone, Transform chestBone, bool mirrored)
        {
            if (!Active) return;
            // (a bone the life does not turn is not written)
            if (SwayRollDeg != 0f) hipsBone.localRotation = hipsBone.localRotation * (mirrored ? hipsMirrored : hips);
            if (SwayRollDeg != 0f || PostureDeg != 0f || TwistDeg != 0f || BreathDeg != 0f) spineBone.localRotation = spineBone.localRotation * (mirrored ? spineMirrored : spine);
            if (PostureDeg != 0f || TwistDeg != 0f || BreathDeg != 0f) chestBone.localRotation = chestBone.localRotation * (mirrored ? chestMirrored : chest);
        }
    }
}
