using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>The fielding body clips (presentation only): the web's Practice fielding set.</summary>
    public enum ProductionFieldingClip
    {
        Idle,
        Ready,
        Run,
        RunDrive,
        FieldPickup,
        FieldThrow,
        FieldFumble,
        FieldSpill,
        FieldDiveRight,
        FieldDiveLeft,
        KeepCrouch,
        KeepShuffle,
        KeepTake,
        KeepDiveRight,
        KeepDiveLeft,
        CatchChest,
        CatchHigh,
        CelebrateJump,
        Clap,
        HandsOnHips,
        HandsOnHead
    }

    /// <summary>
    /// Code-authored fielding clips, ported key for key from src/render3d/core/clips.ts (original work; no motion
    /// capture). A key holds Euler poses in the rig's convention (the same numbers the existing Unity poses use: the
    /// keeper's SQUAT is ApplyKeeperBase), a root offset that is vertical only (|x|, |z| ≤ 8 cm, so the drawn hips stay
    /// on the physics position: a dive's travel comes from the path, never from a clip) and, for throws and
    /// celebrations, arm "aims" (phi: 0 down, 90 back, 180 up, 270 forward; lateral outwards) applied to the upper arm.
    /// Bones a key leaves out keep the previous key's value. Markers name the instant a clip is aligned to a physics
    /// time. Sampling is pure and deterministic.
    /// </summary>
    public static class ProductionFieldingClips
    {
        private const string Stand =
            "hips:0,0,0 spine:2,0,0 chest:1,0,0 neck:-2,0,0 head:0,0,0 upperArmL:2,0,7 forearmL:-12,0,0 handL:0,0,0 " +
            "upperArmR:2,0,-7 forearmR:-12,0,0 handR:0,0,0 thighL:0,0,2 shinL:2,0,0 footL:0,0,0 thighR:0,0,-2 " +
            "shinR:2,0,0 footR:0,0,0";
        private const string Ready =
            "thighL:-34,0,12 thighR:-34,0,-12 shinL:54,0,0 shinR:54,0,0 footL:-18,0,0 footR:-18,0,0 spine:34,0,0 " +
            "chest:8,0,0 neck:-30,0,0 head:-10,0,0 upperArmL:-40,0,6 forearmL:-30,0,0 upperArmR:-40,0,-6 " +
            "forearmR:-30,0,0 hips:0,0,0";
        private const string Squat =
            "thighL:-98,0,24 thighR:-98,0,-24 shinL:128,0,0 shinR:128,0,0 footL:-28,0,0 footR:-28,0,0 spine:30,0,0 " +
            "chest:6,0,0 neck:-26,0,0 head:-10,0,0 upperArmL:-52,0,10 forearmL:-32,0,0 upperArmR:-52,0,-10 " +
            "forearmR:-32,0,0";
        private const string RunA =
            "thighL:-44,0,2 shinL:14,0,0 footL:-10,0,0 thighR:30,0,-2 shinR:82,0,0 footR:24,0,0 upperArmL:40,0,8 " +
            "forearmL:-72,0,0 upperArmR:-50,0,-8 forearmR:-88,0,0 spine:14,-8,0 chest:4,-6,0 neck:-10,7,0 head:-4,6,0";
        private const string RunB =
            "thighL:6,0,2 shinL:38,0,0 footL:18,0,0 thighR:-32,0,-2 shinR:108,0,0 footR:8,0,0 upperArmL:6,0,8 " +
            "forearmL:-66,0,0 upperArmR:-12,0,-8 forearmR:-76,0,0 spine:12,0,0 chest:4,0,0 neck:-8,0,0 head:-4,0,0";
        private const string DriveA = RunA +
            " thighL:-52,0,2 shinL:22,0,0 thighR:22,0,-2 shinR:70,0,0 upperArmL:54,0,8 forearmL:-84,0,0 " +
            "upperArmR:-64,0,-8 forearmR:-92,0,0 spine:32,-8,0 chest:6,-6,0 neck:-24,7,0 head:-8,6,0";
        private const string DriveB = RunB +
            " thighR:-40,0,-2 shinR:96,0,0 spine:30,0,0 chest:6,0,0 neck:-22,0,0 head:-8,0,0";
        private const string ShuffleA = Squat +
            " thighL:-80,0,36 thighR:-80,0,-12 shinL:108,0,0 shinR:108,0,0 spine:30,0,0 upperArmL:-62,0,10 " +
            "upperArmR:-62,0,-10 forearmL:-40,0,0 forearmR:-40,0,0";
        private const string ShuffleB = "thighL:-76,0,22 thighR:-76,0,-22 shinL:100,0,0 shinR:100,0,0";

        // Built on first use: static initialisers run in text order, and the clips need MirrorPairs below.
        private static Dictionary<ProductionFieldingClip, Clip> library;
        private static Dictionary<ProductionFieldingClip, Clip> Library => library ?? (library = Build());

        // MOTION packs that replace a code-authored clip (sampled unmirrored here: the callers' existing canonical mirror
        // for "Left" rigs then gives exactly MOTION-SPEC §3's rig mirror XOR the actor's side). The throw: the lead's
        // held-ball ruling wants fld_throw_over with its `release` marker on the physics throw.
        private static readonly Dictionary<ProductionFieldingClip, (string Pack, string Clip)> PackClips =
            new Dictionary<ProductionFieldingClip, (string, string)>
            {
                { ProductionFieldingClip.FieldThrow, ("fielder_actions", "fld_throw_over") }
            };
        private static readonly Dictionary<ProductionFieldingClip, Vande.Practice.MotionPacks.VmpClip> PackCache =
            new Dictionary<ProductionFieldingClip, Vande.Practice.MotionPacks.VmpClip>();
        private static Vande.Practice.MotionPacks.VmpPose packScratch;

        private static Vande.Practice.MotionPacks.VmpClip PackClip(ProductionFieldingClip id)
        {
            (string Pack, string Clip) source;
            if (!PackClips.TryGetValue(id, out source)) return null;
            Vande.Practice.MotionPacks.VmpClip clip;
            if (PackCache.TryGetValue(id, out clip)) return clip;
            clip = Vande.Practice.Presentation.Production.Motion.ProductionMotionPacks.Clip(source.Pack, source.Clip);
            PackCache[id] = clip;
            return clip;
        }

        public static float Duration(ProductionFieldingClip id)
        {
            var pack = PackClip(id);
            return pack != null ? pack.Duration : Library[id].Duration;
        }
        public static bool Loops(ProductionFieldingClip id) => Library[id].Loop;

        /// <summary>True when a MOTION pack clip draws `id` (its lead-in is the pack's own, fieldClips.ts `lead`).</summary>
        public static bool FromPack(ProductionFieldingClip id) => PackClip(id) != null;

        /// <summary>A named moment (seconds into the clip), or `fallback`.</summary>
        public static float Marker(ProductionFieldingClip id, string name, float fallback = 0f)
        {
            float value;
            var pack = PackClip(id);
            if (pack != null) return pack.TryGetMarker(name, out value) ? value : fallback;
            return Library[id].Markers != null && Library[id].Markers.TryGetValue(name, out value) ? value : fallback;
        }

        public static bool IsRun(ProductionFieldingClip id) =>
            id == ProductionFieldingClip.Run || id == ProductionFieldingClip.RunDrive;

        public static bool IsDive(ProductionFieldingClip id) =>
            id == ProductionFieldingClip.FieldDiveLeft || id == ProductionFieldingClip.FieldDiveRight ||
            id == ProductionFieldingClip.KeepDiveLeft || id == ProductionFieldingClip.KeepDiveRight;

        /// <summary>Samples `id` at `seconds` into `output`. Looping clips wrap; others clamp.</summary>
        public static void Sample(ProductionFieldingClip id, double seconds, ProductionCharacterPose output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (double.IsNaN(seconds) || double.IsInfinity(seconds)) throw new ArgumentOutOfRangeException(nameof(seconds));
            var pack = PackClip(id);
            if (pack != null)
            {
                if (packScratch == null) packScratch = new Vande.Practice.MotionPacks.VmpPose(8);
                var at = pack.Loop ? seconds : Math.Min(Math.Max(seconds, 0.0), pack.Duration);
                output.Clear();
                pack.Sample(at, packScratch, 1.0, false);
                Vande.Practice.MotionPacks.VmpUnity.ApplyTo(packScratch, output);
                return;
            }
            var clip = Library[id];
            var time = (float)seconds;
            if (clip.Loop) time = Mathf.Repeat(time, clip.Duration);
            else time = Mathf.Clamp(time, 0f, clip.Duration);
            var keys = clip.Keys;
            var index = 0;
            while (index < keys.Length - 2 && time > keys[index + 1].Time) index++;
            var k0 = keys[index];
            var k1 = keys[Math.Min(index + 1, keys.Length - 1)];
            var span = k1.Time - k0.Time;
            var u = span > 0f ? Mathf.Clamp01((time - k0.Time) / span) : 0f;
            if (!clip.Linear) u = u * u * (3f - 2f * u);
            output.Clear();
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                output.Rotations[joint] = Quaternion.Slerp(k0.Rotations[joint], k1.Rotations[joint], u);
            output.RootOffset = Vector3.Lerp(k0.Root, k1.Root, u);
        }

        /// <summary>Blends `b` into `a` by `weight` (0 = a, 1 = b), in place on `a`.</summary>
        public static void Blend(ProductionCharacterPose a, ProductionCharacterPose b, float weight)
        {
            if (weight <= 0f) return;
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                a.Rotations[joint] = Quaternion.Slerp(a.Rotations[joint], b.Rotations[joint], weight);
            a.RootOffset = Vector3.Lerp(a.RootOffset, b.RootOffset, weight);
        }

        /// <summary>Copies the lower body (hips, legs and root offset) of `source` over `destination`.</summary>
        public static void OverlayLower(ProductionCharacterPose destination, ProductionCharacterPose source)
        {
            foreach (var joint in LowerJoints) destination.Rotations[(int)joint] = source.Rotations[(int)joint];
            destination.RootOffset = source.RootOffset;
        }

        /// <summary>Mirrors a pose left↔right in place (a left-handed rig): pairs swap, Y and Z rotations negate.</summary>
        public static void Mirror(ProductionCharacterPose pose)
        {
            for (var pair = 0; pair < MirrorPairs.GetLength(0); pair++)
            {
                var a = (int)MirrorPairs[pair, 0];
                var b = (int)MirrorPairs[pair, 1];
                var swap = pose.Rotations[a];
                pose.Rotations[a] = pose.Rotations[b];
                pose.Rotations[b] = swap;
            }
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
            {
                var q = pose.Rotations[joint];
                pose.Rotations[joint] = new Quaternion(q.x, -q.y, -q.z, q.w);
            }
            pose.RootOffset = new Vector3(-pose.RootOffset.x, pose.RootOffset.y, pose.RootOffset.z);
        }

        private static readonly ProductionCharacterJoint[] LowerJoints =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft,
            ProductionCharacterJoint.FootLeft, ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight,
            ProductionCharacterJoint.FootRight
        };

        private static readonly ProductionCharacterJoint[,] MirrorPairs =
        {
            { ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.UpperArmRight },
            { ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.ForearmRight },
            { ProductionCharacterJoint.HandLeft, ProductionCharacterJoint.HandRight },
            { ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ThighRight },
            { ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.ShinRight },
            { ProductionCharacterJoint.FootLeft, ProductionCharacterJoint.FootRight }
        };

        // ---- the library (clips.ts) -------------------------------------------------------------------------------

        private static Dictionary<ProductionFieldingClip, Clip> Build()
        {
            var value = new Dictionary<ProductionFieldingClip, Clip>();
            value[ProductionFieldingClip.Idle] = new Clip(3.2f, true, false, null,
                K(0f, 0f, 0f, 0f, Stand),
                K(1.6f, 0.012f, -0.006f, 0f, "chest:2.5,2,0 upperArmL:3,0,9 upperArmR:3,0,-6 head:1,4,0"),
                K(3.2f, 0f, 0f, 0f, Stand));
            value[ProductionFieldingClip.Ready] = new Clip(1.4f, true, false, null,
                K(0f, 0f, -0.14f, 0f, Ready),
                K(0.7f, 0f, -0.12f, 0f, "spine:32,0,0 neck:-28,0,0"),
                K(1.4f, 0f, -0.14f, 0f, Ready));
            value[ProductionFieldingClip.Run] = Cycle(0.62f, true, K(0f, 0f, -0.03f, 0f, RunA), K(0f, 0f, 0.05f, 0f, RunB));
            value[ProductionFieldingClip.RunDrive] =
                Cycle(0.62f, true, K(0f, 0f, -0.07f, 0f, DriveA), K(0f, 0f, 0f, 0f, DriveB));
            value[ProductionFieldingClip.FieldPickup] = new Clip(0.75f, false, false, M("collect", 0.3f),
                K(0f, 0f, -0.16f, 0f, Ready + " spine:36,0,0"),
                K(0.3f, 0f, -0.42f, 0f, "hips:0,0,0 spine:62,0,0 chest:10,0,0 neck:-34,0,0 head:-8,0,0 " +
                    "upperArmR:-64,0,-6 forearmR:-6,0,0 handR:10,0,0 upperArmL:-40,0,16 forearmL:-22,0,0 " +
                    "thighL:-78,0,10 shinL:100,0,0 footL:-20,0,0 thighR:-26,0,-8 shinR:76,0,0 footR:10,0,0"),
                K(0.52f, 0f, -0.2f, 0f, "hips:0,-40,0 spine:26,-20,0 chest:6,-14,0 neck:-12,40,0 head:-4,10,0 " +
                    "upperArmR:10,0,-20 forearmR:-70,0,0 handR:0,0,0 thighL:-40,0,12 shinL:50,0,0 thighR:-6,0,-12 " +
                    "shinR:30,0,0"),
                K(0.75f, 0f, -0.08f, 0f, "hips:0,-58,0 spine:10,-12,0 chest:2,-6,0 neck:0,56,0 head:0,10,0 " +
                    "upperArmR:30,0,-16 forearmR:-80,0,0 upperArmL:-50,0,10 forearmL:-30,0,0 thighL:-22,0,14 " +
                    "shinL:20,0,0 footL:0,0,0 thighR:8,0,-14 shinR:20,0,0 footR:0,0,0"));
            value[ProductionFieldingClip.FieldThrow] = new Clip(0.92f, false, false, M("release", 0.42f),
                K(0f, 0f, -0.06f, 0f, "hips:0,-62,0 spine:6,-10,0 chest:0,-6,0 neck:0,60,0 head:0,12,0 " +
                    "thighL:-22,0,14 shinL:16,0,0 thighR:10,0,-14 shinR:20,0,0 forearmR:-30,0,0 forearmL:-20,0,0 " +
                    "aimR:96,12 aimL:262,6"),
                K(0.26f, 0f, -0.1f, -0.05f, "hips:0,-70,0 spine:-8,-14,0 chest:-2,-8,0 forearmR:-74,0,0 " +
                    "thighL:-30,0,16 shinL:26,0,0 thighR:16,0,-14 shinR:34,0,0 aimR:152,16 aimL:272,4"),
                K(0.42f, 0f, -0.08f, 0.06f, "hips:0,-10,0 spine:22,26,0 chest:6,16,0 neck:-6,10,0 head:0,0,0 " +
                    "forearmR:-8,0,0 thighL:-38,0,8 shinL:18,0,0 thighR:24,0,-8 shinR:40,0,0 aimR:238,6 aimL:330,14"),
                K(0.62f, 0f, -0.12f, 0.08f, "spine:38,40,0 chest:10,20,0 forearmR:-14,0,0 thighR:40,0,-6 " +
                    "shinR:70,0,0 aimR:314,-14 aimL:20,20"),
                K(0.92f, 0f, -0.04f, 0.06f, "hips:0,0,0 spine:14,10,0 chest:3,4,0 neck:-4,0,0 thighL:-8,0,4 " +
                    "shinL:10,0,0 thighR:4,0,-4 shinR:12,0,0 aimR:340,-8 aimL:8,10"));
            value[ProductionFieldingClip.FieldFumble] = new Clip(1.3f, false, false, M("touch", 0.22f),
                K(0f, 0f, -0.16f, 0f, Ready + " spine:40,0,0"),
                K(0.22f, 0f, -0.4f, 0f, "spine:64,0,0 chest:10,0,0 neck:-36,0,0 head:-6,0,0 upperArmL:-60,0,12 " +
                    "upperArmR:-60,0,-12 forearmL:-6,0,0 forearmR:-6,0,0 thighL:-70,0,14 shinL:96,0,0 " +
                    "thighR:-40,0,-12 shinR:84,0,0 footL:-18,0,0 footR:-10,0,0"),
                K(0.36f, 0f, -0.32f, 0f, "spine:46,0,6 neck:-18,0,0 head:6,-10,0 upperArmL:-82,0,42 " +
                    "upperArmR:-88,0,-38 forearmL:-30,0,0 forearmR:-26,0,0"),
                K(0.62f, 0f, -0.46f, 0f, "hips:0,20,0 spine:70,18,0 chest:12,10,0 neck:-30,-14,0 head:4,-10,0 " +
                    "upperArmR:-64,0,-20 forearmR:-4,0,0 upperArmL:-30,0,26 forearmL:-30,0,0 thighL:-84,0,16 " +
                    "shinL:110,0,0 thighR:-20,0,-16 shinR:90,0,0"),
                K(0.95f, 0f, -0.44f, 0f, "hips:0,10,0 spine:66,8,0 chest:10,4,0 neck:-34,-6,0 head:0,-4,0 " +
                    "upperArmR:-70,0,-10 forearmR:-8,0,0 upperArmL:-40,0,20 forearmL:-24,0,0 thighL:-70,0,14 " +
                    "shinL:104,0,0 thighR:-36,0,-14 shinR:96,0,0"),
                K(1.3f, 0f, -0.42f, 0f, "hips:0,0,0 spine:64,0,0 chest:10,0,0 neck:-36,0,0 head:-6,0,0 " +
                    "upperArmR:-66,0,-6 forearmR:-6,0,0 upperArmL:-42,0,16 forearmL:-20,0,0"));
            value[ProductionFieldingClip.FieldSpill] = new Clip(0.9f, false, false, null,
                K(0f, 0f, -0.12f, 0f, Ready + " upperArmL:-74,0,4 upperArmR:-74,0,-4 forearmL:-62,0,0 " +
                    "forearmR:-62,0,0 spine:18,0,0 neck:-12,0,0"),
                K(0.18f, 0f, -0.16f, 0f, "upperArmL:-58,0,32 upperArmR:-58,0,-32 forearmL:-40,0,0 forearmR:-40,0,0 " +
                    "spine:26,0,0 neck:8,0,0 head:10,0,0"),
                K(0.5f, 0f, -0.36f, 0f, "spine:58,0,0 chest:10,0,0 neck:-24,0,0 head:-4,0,0 upperArmL:-46,0,14 " +
                    "upperArmR:-56,0,-10 forearmL:-14,0,0 forearmR:-10,0,0 thighL:-62,0,12 shinL:90,0,0 " +
                    "thighR:-36,0,-12 shinR:80,0,0"),
                K(0.9f, 0f, -0.4f, 0f, "spine:62,0,0 neck:-32,0,0 upperArmR:-62,0,-6 forearmR:-6,0,0"));
            var diveRight = new Clip(0.98f, false, false, M("reach", 0.2f),
                K(0f, 0f, -0.16f, 0f, Ready),
                K(0.08f, 0f, -0.3f, 0f, "hips:0,0,24 spine:26,0,12 upperArmR:-130,0,-30 forearmR:-10,0,0 " +
                    "upperArmL:-110,0,10 forearmL:-20,0,0 thighL:-20,0,24 shinL:30,0,0 thighR:-40,0,-10 shinR:60,0,0"),
                K(0.2f, 0f, -0.56f, 0f, "hips:0,0,78 spine:6,0,8 chest:0,0,4 neck:-14,0,-6 head:-6,0,-6 " +
                    "upperArmR:-172,0,-6 forearmR:-6,0,0 upperArmL:-160,0,14 forearmL:-16,0,0 thighL:6,0,12 " +
                    "shinL:16,0,0 thighR:10,0,-4 shinR:14,0,0"),
                K(0.34f, 0f, -0.76f, 0f, "hips:0,0,88 spine:4,0,4"),
                K(0.5f, 0f, -0.76f, 0f, "hips:0,0,86 upperArmR:-150,0,-10 forearmR:-50,0,0 upperArmL:-120,0,20 " +
                    "forearmL:-60,0,0 thighL:-34,0,10 shinL:70,0,0"),
                K(0.74f, 0f, -0.5f, 0f, "hips:0,0,30 spine:40,0,4 chest:6,0,0 neck:-20,0,0 head:0,0,0 " +
                    "upperArmR:-30,0,-20 forearmR:-70,0,0 upperArmL:-40,0,20 forearmL:-30,0,0 thighL:-84,0,10 " +
                    "shinL:118,0,0 thighR:12,0,-10 shinR:110,0,0 footR:30,0,0"),
                K(0.98f, 0f, -0.24f, 0f, "hips:0,-30,6 spine:28,-14,0 chest:6,-8,0 neck:-10,30,0 head:0,6,0 " +
                    "upperArmR:20,0,-16 forearmR:-70,0,0 upperArmL:-46,0,12 forearmL:-30,0,0 thighL:-56,0,12 " +
                    "shinL:70,0,0 thighR:-10,0,-12 shinR:56,0,0 footR:0,0,0"));
            value[ProductionFieldingClip.FieldDiveRight] = diveRight;
            value[ProductionFieldingClip.FieldDiveLeft] = diveRight.Mirrored();
            value[ProductionFieldingClip.KeepCrouch] = new Clip(1.2f, true, false, null,
                K(0f, 0f, -0.5f, 0f, Squat),
                K(0.6f, 0f, -0.49f, 0f, "neck:-24,0,0"),
                K(1.2f, 0f, -0.5f, 0f, Squat));
            value[ProductionFieldingClip.KeepShuffle] =
                Cycle(0.36f, false, K(0f, 0f, -0.4f, 0f, ShuffleA), K(0f, 0f, -0.36f, 0f, ShuffleB));
            value[ProductionFieldingClip.KeepTake] = new Clip(1.0f, false, false, M("catch", 0.3f),
                K(0f, 0f, -0.5f, 0f, Squat),
                K(0.18f, 0f, -0.3f, 0f, "thighL:-70,0,20 thighR:-70,0,-20 shinL:96,0,0 shinR:96,0,0 spine:24,0,0 " +
                    "upperArmL:-74,0,6 upperArmR:-74,0,-6 forearmL:-36,0,0 forearmR:-36,0,0"),
                K(0.3f, 0f, -0.26f, 0f, "upperArmL:-66,0,2 upperArmR:-66,0,-2 forearmL:-52,0,0 forearmR:-52,0,0"),
                K(1.0f, 0f, -0.08f, 0f, "thighL:-22,0,10 thighR:-22,0,-10 shinL:32,0,0 shinR:32,0,0 footL:-8,0,0 " +
                    "footR:-8,0,0 spine:10,0,0 neck:-6,0,0 head:0,0,0 upperArmL:-40,0,14 upperArmR:-40,0,-14 " +
                    "forearmL:-96,0,0 forearmR:-96,0,0"));
            var keepDiveRight = new Clip(1.1f, false, false, M("reach", 0.15f),
                K(0f, 0f, -0.48f, 0f, Squat),
                K(0.07f, 0f, -0.46f, 0f, "hips:0,0,26 spine:26,0,14 upperArmR:-120,0,-34 forearmR:-14,0,0 " +
                    "upperArmL:-110,0,0 forearmL:-20,0,0 thighL:-60,0,30 shinL:80,0,0 thighR:-80,0,-10 shinR:110,0,0"),
                K(0.15f, 0f, -0.6f, 0f, "hips:0,0,74 spine:8,0,8 neck:-16,0,-6 head:-6,0,-6 upperArmR:-168,0,-8 " +
                    "forearmR:-10,0,0 upperArmL:-156,0,18 forearmL:-20,0,0 thighL:-10,0,14 shinL:30,0,0 " +
                    "thighR:-6,0,-6 shinR:24,0,0"),
                K(0.3f, 0f, -0.76f, 0f, "hips:0,0,88 spine:4,0,4"),
                K(0.6f, 0f, -0.74f, 0f, "hips:0,0,84 upperArmR:-140,0,-16 forearmR:-70,0,0 upperArmL:-130,0,10 " +
                    "forearmL:-70,0,0 thighL:-40,0,10 shinL:80,0,0"),
                K(1.1f, 0f, -0.3f, 0f, "hips:0,0,10 spine:30,0,0 neck:-14,0,0 head:0,0,0 upperArmR:-60,0,-12 " +
                    "forearmR:-60,0,0 upperArmL:-60,0,12 forearmL:-60,0,0 thighL:-70,0,16 shinL:100,0,0 " +
                    "thighR:-60,0,-16 shinR:100,0,0"));
            value[ProductionFieldingClip.KeepDiveRight] = keepDiveRight;
            value[ProductionFieldingClip.KeepDiveLeft] = keepDiveRight.Mirrored();
            value[ProductionFieldingClip.CatchChest] = new Clip(1.0f, false, false, M("catch", 0.32f),
                K(0f, 0f, -0.12f, 0f, Ready),
                K(0.2f, 0f, -0.1f, 0f, "upperArmL:-84,0,8 upperArmR:-84,0,-8 forearmL:-44,0,0 forearmR:-44,0,0 " +
                    "spine:18,0,0 neck:-12,0,0"),
                K(0.32f, 0f, -0.12f, 0f, "upperArmL:-74,0,4 upperArmR:-74,0,-4 forearmL:-62,0,0 forearmR:-62,0,0"),
                K(1.0f, 0f, -0.03f, 0f, "upperArmL:-44,0,14 upperArmR:-44,0,-14 forearmL:-100,0,0 " +
                    "forearmR:-100,0,0 spine:8,0,0 neck:0,0,0 thighL:-6,0,2 thighR:-6,0,-2 shinL:10,0,0 " +
                    "shinR:10,0,0 footL:0,0,0 footR:0,0,0"));
            value[ProductionFieldingClip.CatchHigh] = new Clip(1.3f, false, false, M("catch", 0.45f),
                K(0f, 0f, -0.04f, 0f, Stand + " neck:-24,0,0 head:-16,0,0 spine:-4,0,0"),
                K(0.3f, 0f, 0f, 0f, "upperArmL:-160,0,10 upperArmR:-160,0,-10 forearmL:-24,0,0 forearmR:-24,0,0 " +
                    "neck:-28,0,0 head:-18,0,0"),
                K(0.45f, 0f, -0.04f, 0f, "upperArmL:-168,0,3 upperArmR:-168,0,-3 forearmL:-40,0,0 forearmR:-40,0,0"),
                K(0.75f, 0f, -0.06f, 0f, "upperArmL:-62,0,14 upperArmR:-62,0,-14 forearmL:-96,0,0 forearmR:-96,0,0 " +
                    "spine:14,0,0 neck:6,0,0 head:10,0,0"),
                K(1.3f, 0f, -0.02f, 0f, "upperArmL:-40,0,12 upperArmR:-40,0,-12 forearmL:-90,0,0 forearmR:-90,0,0 " +
                    "spine:6,0,0 neck:0,0,0 head:0,0,0"));
            value[ProductionFieldingClip.CelebrateJump] = new Clip(1.5f, false, false, null,
                K(0f, 0f, -0.02f, 0f, Stand),
                K(0.18f, 0f, -0.16f, 0f, "thighL:-46,0,6 thighR:-46,0,-6 shinL:74,0,0 shinR:74,0,0 footL:-20,0,0 " +
                    "footR:-20,0,0 spine:24,0,0 aimR:50,12 aimL:50,12"),
                K(0.36f, 0f, 0.18f, 0f, "thighL:-10,0,4 thighR:-10,0,-4 shinL:16,0,0 shinR:16,0,0 footL:30,0,0 " +
                    "footR:30,0,0 spine:-8,0,0 neck:-18,0,0 forearmL:-30,0,0 forearmR:-30,0,0 aimR:178,22 aimL:178,22"),
                K(0.55f, 0f, 0.42f, 0f, "thighL:-40,0,8 thighR:-40,0,-8 shinL:80,0,0 shinR:80,0,0 footL:20,0,0 " +
                    "footR:20,0,0 spine:-4,0,0 forearmL:-60,0,0 forearmR:-60,0,0 aimR:186,26 aimL:186,26"),
                K(0.76f, 0f, -0.12f, 0f, "thighL:-40,0,8 thighR:-40,0,-8 shinL:66,0,0 shinR:66,0,0 footL:-16,0,0 " +
                    "footR:-16,0,0 spine:20,0,0 forearmR:-20,0,0 aimR:150,14 aimL:80,30"),
                K(1.0f, 0f, -0.04f, 0f, "thighL:-12,0,6 thighR:-12,0,-6 shinL:20,0,0 shinR:20,0,0 footL:0,0,0 " +
                    "footR:0,0,0 spine:4,0,0 forearmR:-70,0,0 aimR:198,10 aimL:40,24"),
                K(1.25f, 0f, -0.06f, 0f, "forearmR:-110,0,0 aimR:120,12 aimL:30,20"),
                K(1.5f, 0f, -0.04f, 0f, "forearmR:-60,0,0 aimR:192,10 aimL:36,22"));
            value[ProductionFieldingClip.Clap] = new Clip(0.5f, true, false, null,
                K(0f, 0f, 0f, 0f, Stand + " upperArmL:-58,0,26 upperArmR:-58,0,-26 forearmL:-68,0,0 forearmR:-68,0,0"),
                K(0.25f, 0f, 0f, 0f, "upperArmL:-58,0,12 upperArmR:-58,0,-12 forearmL:-72,0,0 forearmR:-72,0,0"),
                K(0.5f, 0f, 0f, 0f, "upperArmL:-58,0,26 upperArmR:-58,0,-26 forearmL:-68,0,0 forearmR:-68,0,0"));
            value[ProductionFieldingClip.HandsOnHips] = new Clip(2.4f, true, false, null,
                K(0f, 0f, -0.01f, 0f, Stand + " spine:8,0,0 neck:18,0,0 head:8,0,0 upperArmL:-14,0,40 " +
                    "upperArmR:-14,0,-40 forearmL:-92,0,0 forearmR:-92,0,0"),
                K(1.2f, 0f, -0.015f, 0f, "chest:3,4,0 neck:22,6,0"),
                K(2.4f, 0f, -0.01f, 0f, "chest:1,0,0 neck:18,0,0"));
            value[ProductionFieldingClip.HandsOnHead] = new Clip(1.8f, false, false, null,
                K(0f, 0f, -0.02f, 0f, Stand),
                K(0.35f, 0f, -0.04f, 0f, "upperArmL:-160,0,42 upperArmR:-160,0,-42 forearmL:-122,0,0 " +
                    "forearmR:-122,0,0 spine:-4,0,0 neck:-14,0,0 head:-8,0,0"),
                K(1.2f, 0f, -0.05f, 0f, "spine:10,0,0 neck:10,0,0 head:8,0,0"),
                K(1.8f, 0f, -0.02f, 0f, "upperArmL:10,0,22 upperArmR:10,0,-22 forearmL:-80,0,0 forearmR:-80,0,0 " +
                    "spine:6,0,0 neck:0,0,0 head:0,0,0"));
            return value;
        }

        private static Dictionary<string, float> M(string name, float seconds)
        {
            return new Dictionary<string, float>(StringComparer.Ordinal) { { name, seconds } };
        }

        private static RawKey K(float time, float leftX, float y, float forwardZ, string pose)
        {
            return new RawKey(time, new Vector3(-leftX, y, forwardZ), pose);
        }

        /// <summary>A two-phase locomotion cycle: A, B, mirrored A, mirrored B, A (clips.ts cycle()).</summary>
        private static Clip Cycle(float period, bool linear, RawKey a, RawKey b)
        {
            return new Clip(period, true, linear, null,
                a.At(0f), b.At(period * 0.25f), a.MirroredAt(period * 0.5f), b.MirroredAt(period * 0.75f),
                a.At(period));
        }

        private readonly struct RawKey
        {
            public RawKey(float time, Vector3 root, string pose)
            {
                Time = time;
                Root = root;
                Pose = pose;
                IsMirrored = false;
            }

            private RawKey(float time, Vector3 root, string pose, bool mirrored)
            {
                Time = time;
                Root = root;
                Pose = pose;
                IsMirrored = mirrored;
            }

            public float Time { get; }
            public Vector3 Root { get; }
            public string Pose { get; }
            public bool IsMirrored { get; }
            public RawKey At(float time) => new RawKey(time, Root, Pose, IsMirrored);
            public RawKey MirroredAt(float time) => new RawKey(time, Root, Pose, !IsMirrored);
        }

        private sealed class ResolvedKey
        {
            public float Time;
            public Vector3 Root;
            public Quaternion[] Rotations;
        }

        private sealed class Clip
        {
            public Clip(float duration, bool loop, bool linear, Dictionary<string, float> markers, params RawKey[] raw)
            {
                Duration = duration;
                Loop = loop;
                Linear = linear;
                Markers = markers;
                Raw = raw;
                Keys = Resolve(raw);
            }

            public float Duration { get; }
            public bool Loop { get; }
            public bool Linear { get; }
            public Dictionary<string, float> Markers { get; }
            public RawKey[] Raw { get; }
            public ResolvedKey[] Keys { get; }

            /// <summary>The whole clip mirrored left↔right (poses and root; markers kept): clips.ts mirrorClip().</summary>
            public Clip Mirrored()
            {
                var raw = new RawKey[Raw.Length];
                for (var index = 0; index < Raw.Length; index++) raw[index] = Raw[index].MirroredAt(Raw[index].Time);
                return new Clip(Duration, Loop, Linear, Markers, raw);
            }

            private static ResolvedKey[] Resolve(RawKey[] raw)
            {
                // Euler degrees per joint; bones a key leaves out keep the previous key's value.
                var eulers = new Vector3[(int)ProductionCharacterJoint.Count];
                var keys = new ResolvedKey[raw.Length];
                for (var index = 0; index < raw.Length; index++)
                {
                    var current = (Vector3[])eulers.Clone();
                    Vector2? aimR = null;
                    Vector2? aimL = null;
                    foreach (var token in raw[index].Pose.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
                    {
                        var parts = token.Split(':');
                        var numbers = parts[1].Split(',');
                        var a = float.Parse(numbers[0], CultureInfo.InvariantCulture);
                        var b = float.Parse(numbers[1], CultureInfo.InvariantCulture);
                        if (parts[0] == "aimR") { aimR = new Vector2(a, b); continue; }
                        if (parts[0] == "aimL") { aimL = new Vector2(a, b); continue; }
                        var c = float.Parse(numbers[2], CultureInfo.InvariantCulture);
                        current[(int)JointOf(parts[0])] = new Vector3(a, b, c);
                    }
                    // An aimed arm points in the sagittal plane at phi, abducted `lateral` outwards (upper arm only).
                    if (aimR.HasValue)
                        current[(int)ProductionCharacterJoint.UpperArmRight] = new Vector3(aimR.Value.x, 0f, -aimR.Value.y);
                    if (aimL.HasValue)
                        current[(int)ProductionCharacterJoint.UpperArmLeft] = new Vector3(aimL.Value.x, 0f, aimL.Value.y);
                    eulers = current;

                    var rotations = new Quaternion[(int)ProductionCharacterJoint.Count];
                    for (var joint = 0; joint < rotations.Length; joint++)
                    {
                        var target = joint;
                        var euler = current[joint];
                        if (raw[index].IsMirrored)
                        {
                            target = (int)MirrorJoint((ProductionCharacterJoint)joint);
                            euler = new Vector3(euler.x, -euler.y, -euler.z);
                        }
                        rotations[target] = Quaternion.Euler(euler);
                    }
                    var root = raw[index].Root;
                    if (raw[index].IsMirrored) root.x = -root.x;
                    keys[index] = new ResolvedKey { Time = raw[index].Time, Root = root, Rotations = rotations };
                }
                return keys;
            }
        }

        private static ProductionCharacterJoint MirrorJoint(ProductionCharacterJoint joint)
        {
            for (var pair = 0; pair < MirrorPairs.GetLength(0); pair++)
            {
                if (MirrorPairs[pair, 0] == joint) return MirrorPairs[pair, 1];
                if (MirrorPairs[pair, 1] == joint) return MirrorPairs[pair, 0];
            }
            return joint;
        }

        private static ProductionCharacterJoint JointOf(string name)
        {
            switch (name)
            {
                case "hips": return ProductionCharacterJoint.Hips;
                case "spine": return ProductionCharacterJoint.Spine;
                case "chest": return ProductionCharacterJoint.Chest;
                case "neck": return ProductionCharacterJoint.Neck;
                case "head": return ProductionCharacterJoint.Head;
                case "upperArmL": return ProductionCharacterJoint.UpperArmLeft;
                case "forearmL": return ProductionCharacterJoint.ForearmLeft;
                case "handL": return ProductionCharacterJoint.HandLeft;
                case "upperArmR": return ProductionCharacterJoint.UpperArmRight;
                case "forearmR": return ProductionCharacterJoint.ForearmRight;
                case "handR": return ProductionCharacterJoint.HandRight;
                case "thighL": return ProductionCharacterJoint.ThighLeft;
                case "shinL": return ProductionCharacterJoint.ShinLeft;
                case "footL": return ProductionCharacterJoint.FootLeft;
                case "thighR": return ProductionCharacterJoint.ThighRight;
                case "shinR": return ProductionCharacterJoint.ShinRight;
                case "footR": return ProductionCharacterJoint.FootRight;
                default: throw new ArgumentException("Unknown joint " + name, nameof(name));
            }
        }
    }
}
