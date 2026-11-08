using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Presentation.Production.Motion
{
    /// <summary>
    /// The shipped MOTION VMP1 packs (Resources/Motion/*.bytes), parsed once and shared by every rig. A pack that is
    /// missing or fails to parse is reported once and treated as absent, so the code-authored clips stay the fallback.
    /// Unity rule (MOTION-SPEC v1.3 section 3): the production rigs' L/R labels are anatomically mirrored, so every pack
    /// pose is sampled through the canonical mirror (Sample(..., mirror: RigMirror)). A left-hander's or left-side
    /// clip's own mirror composes with it (two mirrors cancel).
    /// </summary>
    public static class ProductionMotionPacks
    {
        /// <summary>The rig-frame mirror every Unity production rig needs (rigLabelsAnatomical = false).</summary>
        public const bool RigMirror = true;

        private static readonly Dictionary<string, VmpPack> Cache = new Dictionary<string, VmpPack>(StringComparer.Ordinal);

        public static VmpPack Get(string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            VmpPack pack;
            if (Cache.TryGetValue(name, out pack)) return pack;
            pack = null;
            var asset = Resources.Load<TextAsset>("Motion/" + name);
            if (asset != null)
            {
                try
                {
                    pack = VmpPack.Parse(asset.bytes);
                }
                catch (FormatException error)
                {
                    Debug.LogWarning("VANDE motion pack " + name + " was rejected: " + error.Message);
                    pack = null;
                }
                Resources.UnloadAsset(asset);
            }
            Cache[name] = pack;
            return pack;
        }

        public static VmpClip Clip(string pack, string clip)
        {
            var value = Get(pack);
            VmpClip result;
            return value != null && value.TryGetClip(clip, out result) ? result : null;
        }
    }

    /// <summary>
    /// The speed-matched locomotion cycle from MOTION's locomotion pack: walk 1.5, jog 3.3, run 5.6 and sprint 7.8 m/s,
    /// blended between the two nearest by speed at one shared normalised phase. The phase advances with the distance
    /// actually travelled divided by the blended stride (travel per cycle), so the feet never skate or tread water.
    /// </summary>
    public sealed class ProductionLocomotionCycle
    {
        private static readonly string[] ClipNames = { "loco_walk", "loco_jog", "loco_run", "loco_sprint" };
        private readonly VmpClip[] clips = new VmpClip[ClipNames.Length];
        private readonly VmpPose sampleA;
        private readonly VmpPose sampleB;
        private readonly ProductionCharacterPose poseA = new ProductionCharacterPose();
        private readonly ProductionCharacterPose poseB = new ProductionCharacterPose();
        private double phase;

        private ProductionLocomotionCycle(VmpPack pack)
        {
            for (var index = 0; index < ClipNames.Length; index++)
            {
                clips[index] = pack.GetClip(ClipNames[index]);
                if (!(clips[index].SpeedMps > 0f)) throw new FormatException(ClipNames[index] + " has no speed.");
            }
            sampleA = new VmpPose(pack.MaxTrackCount);
            sampleB = new VmpPose(pack.MaxTrackCount);
        }

        /// <summary>The cycle, or null when the locomotion pack (or one of its four cycles) is not shipped.</summary>
        public static ProductionLocomotionCycle TryCreate()
        {
            var pack = ProductionMotionPacks.Get("locomotion");
            if (pack == null) return null;
            try
            {
                return new ProductionLocomotionCycle(pack);
            }
            catch (Exception error) when (error is FormatException || error is KeyNotFoundException ||
                                          error is ArgumentException)
            {
                Debug.LogWarning("VANDE locomotion pack unusable: " + error.Message);
                return null;
            }
        }

        public double Phase => phase;

        /// <summary>Travel per cycle (m) at a speed: the blend of the two nearest cycles' strides.</summary>
        public float StrideAt(float metresPerSecond)
        {
            int lower;
            float amount;
            Bracket(metresPerSecond, out lower, out amount);
            return Mathf.Lerp(Stride(clips[lower]), Stride(clips[Mathf.Min(lower + 1, clips.Length - 1)]), amount);
        }

        private static float Stride(VmpClip clip) => clip.SpeedMps * clip.Duration;

        private void Bracket(float speed, out int lower, out float amount)
        {
            lower = 0;
            amount = 0f;
            if (speed <= clips[0].SpeedMps) return;
            for (var index = 0; index < clips.Length - 1; index++)
            {
                if (speed <= clips[index + 1].SpeedMps)
                {
                    lower = index;
                    amount = Mathf.InverseLerp(clips[index].SpeedMps, clips[index + 1].SpeedMps, speed);
                    return;
                }
            }
            lower = clips.Length - 2;
            amount = 1f;
        }

        /// <summary>Advances the phase by a distance travelled at a speed.</summary>
        public void Advance(float metres, float metresPerSecond)
        {
            if (metres <= 0f) return;
            phase += metres / Mathf.Max(0.4f, StrideAt(Mathf.Max(metresPerSecond, 0.01f)));
            if (phase > 1e6) phase -= Math.Floor(phase);
        }

        /// <summary>
        /// Samples the speed-blended cycle at the current phase into <paramref name="target"/>, through the rig mirror.
        /// </summary>
        public void Sample(float metresPerSecond, ProductionCharacterPose target)
        {
            int lower;
            float amount;
            Bracket(metresPerSecond, out lower, out amount);
            var upper = Mathf.Min(lower + 1, clips.Length - 1);
            var unit = phase - Math.Floor(phase);
            clips[lower].Sample(unit * clips[lower].Duration, sampleA, 1.0, ProductionMotionPacks.RigMirror);
            sampleA.ApplyTo(poseA);
            if (amount <= 0f || upper == lower)
            {
                Copy(poseA, target);
                return;
            }
            clips[upper].Sample(unit * clips[upper].Duration, sampleB, 1.0, ProductionMotionPacks.RigMirror);
            sampleB.ApplyTo(poseB);
            Copy(poseA, target);
            ProductionFieldingClips.Blend(target, poseB, amount);
        }

        private static void Copy(ProductionCharacterPose from, ProductionCharacterPose to)
        {
            for (var joint = 0; joint < from.Rotations.Length; joint++) to.Rotations[joint] = from.Rotations[joint];
            to.RootOffset = from.RootOffset;
            to.BatRotation = from.BatRotation;
        }
    }
}

namespace Vande.Practice.Presentation.Production.Motion
{
    /// <summary>
    /// One sampled pack pose for a Unity production rig: the clip is sampled through the rig mirror (XOR the actor's
    /// own left mirror), so the ground, the tracks and the bat come out already in the rig's frame. The actor frame is
    /// the clip's current ground origin; the caller places it in the world (position and heading).
    /// </summary>
    public sealed class ProductionPackPose
    {
        private readonly VmpPose sample;
        private readonly ProductionCharacterPose pose = new ProductionCharacterPose();

        public ProductionPackPose(int trackCapacity = 8)
        {
            sample = new VmpPose(Mathf.Clamp(trackCapacity, 0, 255));
        }

        public ProductionCharacterPose Pose => pose;
        public VmpPose Raw => sample;

        /// <summary>Samples <paramref name="clip"/> at <paramref name="t"/> s for a right- or left-sided actor.</summary>
        public void SampleInto(VmpClip clip, double t, bool leftActor, double scale = 1.0)
        {
            if (clip == null) throw new ArgumentNullException(nameof(clip));
            clip.Sample(t, sample, scale, ProductionMotionPacks.RigMirror ^ leftActor);
            sample.ApplyTo(pose);
        }

        /// <summary>The ground origin (actor frame, metres, × 0.9836) and its heading (degrees, + turns +Z to +X).</summary>
        public Vector3 Ground => sample.GroundPosition();
        public float GroundYawDegrees => (float)sample.GroundYawDeg;

        /// <summary>The bat: cap of the handle, toe and blade-face normal in the actor frame (bat.grip is 0.125 m below the cap).</summary>
        public bool TryGetBatCapToe(float batLengthMetres, out Vector3 cap, out Vector3 toe, out Vector3 face)
        {
            Vector3 grip, dir;
            bool hasFace;
            if (!sample.TryGetBat(false, out grip, out dir, out face, out hasFace))
            {
                cap = toe = face = Vector3.zero;
                return false;
            }
            dir = dir.sqrMagnitude > 1e-8f ? dir.normalized : Vector3.down;
            cap = grip - dir * 0.125f;
            toe = cap + dir * batLengthMetres;
            if (!hasFace) face = Vector3.zero;
            return true;
        }
    }
}
