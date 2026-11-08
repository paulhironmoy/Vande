// VandeMotionPack.cs: the C# reference decoder and sampler for VMP1 motion packs (MOTION-SPEC v1.2.3 §2, §3, §5, §6).
//
// A port of scripts/motion/vmp.ts. It applies the same validation, in the same order and with the same messages,
// and the same sampling arithmetic (double precision, from float32-stored data, as vmp.ts does).
// The copy of record is scripts/motion/unity/VandeMotionPack.cs. UNITY copies it into Assets and owns that copy.
//
// Core (namespace Vande.Practice.MotionPacks):
// - It has no UnityEngine dependency and targets C# 9 / .NET Standard 2.1.
// - It is IL2CPP- and Android-friendly: no reflection, no unsafe code, no LINQ, no static mutable state.
// - Sampling allocates nothing: the caller passes a preallocated VmpPose. It is a pure function of (clip, t, scale),
//   so it gives the same result at 30, 60 or 120 Hz and is safe to call from several threads.
// - Malformed input throws VmpFormatException and never reads out of range.
//
// Adapter (#if UNITY_5_3_OR_NEWER): VmpUnity maps a sampled pose onto ProductionCharacterPose ("Into Unity", §6).
// It writes internal members of ProductionCharacterPose, so this file must compile into the same assembly
// (Vande.Practice.Runtime), anywhere under Assets/VandePractice/Runtime/.
//
// Usage:
//   var pack = VmpPack.Parse(textAsset.bytes);              // once; validates everything; keep the pack
//   var clip = pack.GetClip("bat_stance_live");              // or pack.TryGetClip(name, out clip)
//   var pose = new VmpPose(pack.MaxTrackCount);              // once per actor; reused every frame
//   clip.Sample(t, pose, bodyScale);                         // per frame: no allocation
//   pose.ApplyTo(productionPose);                            // Unity: rotations unchanged, root x/z × 0.9836
//   pose.ApplyTo(productionPose, mirrorForRig: true);        // a rig with mirrored L/R labels: the canonical mirror
//   pose.TryGetBat(true, out grip, out dir, out face, out hasFace);  // bat tracks for that rig, x -> −x

using System;
using System.Collections.Generic;
using System.Globalization;

namespace Vande.Practice.MotionPacks
{
    /// <summary>A malformed VMP1 pack. The message is the one vmp.ts throws for the same input.</summary>
    public sealed class VmpFormatException : FormatException
    {
        public VmpFormatException(string message) : base(message)
        {
        }
    }

    /// <summary>A plain 3-vector, so the core needs no UnityEngine or System.Numerics.</summary>
    public struct VmpVector3
    {
        public float X;
        public float Y;
        public float Z;

        public VmpVector3(float x, float y, float z)
        {
            X = x;
            Y = y;
            Z = z;
        }
    }

    /// <summary>VC17 skeleton constants and the format's shared helpers (MOTION-SPEC §1, §3, §5).</summary>
    public static class Vmp
    {
        public const int BoneCount = 17;
        public const uint AllBonesMask = (1u << BoneCount) - 1u;

        public const int PackHeaderBytes = 32;
        public const int DirEntryBytes = 16;
        public const int ClipHeaderBytes = 48;
        public const int MarkerBytes = 8;
        public const int TrackDescBytes = 4;
        public const int FrameFixedBytes = 14;

        public const int TrackKindPosition = 1;
        public const int TrackKindDirection = 2;

        public const int FlagLoop = 1;
        public const int FlagGround = 2;
        public const int FlagMirrorable = 4;
        public const int FlagOverlay = 8;
        public const int FlagPhase0LeftStrike = 16;

        public const int ContactFootL = 1;
        public const int ContactFootR = 2;
        public const int ContactHandL = 4;
        public const int ContactHandR = 8;
        public const int ContactKneeL = 16;
        public const int ContactKneeR = 32;
        public const int ContactBody = 64;

        /// <summary>Unity driver rig: ground travel and hips x/z × 0.9836 (leg 0.900 vs 0.915 m); hips y unscaled (§2).</summary>
        public const float UnityDriverHorizontalScale = 0.9836f;

        private static readonly string[] boneNames =
        {
            "hips", "spine", "chest", "neck", "head",
            "upperArmL", "forearmL", "handL", "upperArmR", "forearmR", "handR",
            "thighL", "shinL", "footL", "thighR", "shinR", "footR"
        };

        // The canonical mirror swaps upperArm, forearm, hand, thigh, shin and foot L <-> R (§3).
        private static readonly int[] mirrorBone = { 0, 1, 2, 3, 4, 8, 9, 10, 5, 6, 7, 14, 15, 16, 11, 12, 13 };

        private static readonly uint[] crcTable = BuildCrcTable();

        /// <summary>FNV-1a-32 of "VC17:hips,spine,…,footR" (§5.1).</summary>
        public static readonly uint SkeletonId = Fnv1a32("VC17:" + string.Join(",", boneNames));

        /// <summary>The VC17 bone name for id 0..16 (the order of ProductionCharacterJoint).</summary>
        public static string BoneName(int id)
        {
            if ((uint)id >= BoneCount) throw new ArgumentOutOfRangeException(nameof(id));
            return boneNames[id];
        }

        /// <summary>The bone a mirror maps id to (L <-> R; the spine chain maps to itself).</summary>
        public static int MirrorBone(int id)
        {
            if ((uint)id >= BoneCount) throw new ArgumentOutOfRangeException(nameof(id));
            return mirrorBone[id];
        }

        /// <summary>A bone mask with its L and R bones swapped.</summary>
        public static uint MirrorMask(uint mask)
        {
            uint m = 0;
            for (var b = 0; b < BoneCount; b++)
                if (((mask >> b) & 1u) != 0) m |= 1u << mirrorBone[b];
            return m;
        }

        /// <summary>Swaps footL/footR, handL/handR and kneeL/kneeR; body is kept (§3 step 4).</summary>
        public static int MirrorContacts(int c)
        {
            return (c & 0x40) | ((c & 1) << 1) | ((c & 2) >> 1) | ((c & 4) << 1) | ((c & 8) >> 1) |
                   ((c & 16) << 1) | ((c & 32) >> 1);
        }

        public static uint Fnv1a32(string text)
        {
            if (text == null) throw new ArgumentNullException(nameof(text));
            var h = 0x811c9dc5u;
            for (var i = 0; i < text.Length; i++)
            {
                h ^= (uint)(text[i] & 0xff);
                h = unchecked(h * 0x01000193u);
            }
            return h;
        }

        /// <summary>CRC-32 (IEEE) of bytes[start, end).</summary>
        public static uint Crc32(byte[] bytes, int start, int end)
        {
            if (bytes == null) throw new ArgumentNullException(nameof(bytes));
            if (start < 0 || end > bytes.Length || start > end) throw new ArgumentOutOfRangeException(nameof(start));
            var c = 0xffffffffu;
            for (var i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >> 8);
            return c ^ 0xffffffffu;
        }

        /// <summary>Bytes per stored quaternion: 4 for codec 1 (10/10/10), 6 for codec 2 (15/15/15).</summary>
        public static int QuatBytes(int codec)
        {
            if (codec == 1) return 4;
            if (codec == 2) return 6;
            throw new VmpFormatException("VMC1: unknown quaternion codec " + codec.ToString(CultureInfo.InvariantCulture));
        }

        private static uint[] BuildCrcTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1u) != 0 ? 0xedb88320u ^ (c >> 1) : c >> 1;
                table[n] = c;
            }
            return table;
        }
    }

    /// <summary>
    /// A reusable sample buffer. Allocate one per actor (or per layer) and pass it to <see cref="VmpClip.Sample"/>
    /// every frame. All values are in the canonical actor frame (§1: Y up, +Z forward, +X the character's left).
    /// </summary>
    public sealed class VmpPose
    {
        /// <summary>17 × (x, y, z, w), VC17 bone order, local to the parent and relative to the identity rest.</summary>
        public readonly float[] Rotations = new float[Vmp.BoneCount * 4];

        /// <summary>3 floats per track, in the clip's track order (see <see cref="VmpClip.TrackName"/>).</summary>
        public readonly float[] Tracks;

        public VmpPose() : this(8)
        {
        }

        public VmpPose(int trackCapacity)
        {
            if (trackCapacity < 0 || trackCapacity > 255) throw new ArgumentOutOfRangeException(nameof(trackCapacity));
            Tracks = new float[trackCapacity * 3];
            Clear();
        }

        /// <summary>The hips offset from the rest hips (0, 0.98, 0) × scale: SampledPose.root.</summary>
        public float RootX { get; internal set; }
        public float RootY { get; internal set; }
        public float RootZ { get; internal set; }

        /// <summary>The ground track × scale (yaw unscaled; + turns towards +X). Loops add one cycle's travel per wrap.</summary>
        public double GroundX { get; internal set; }
        public double GroundZ { get; internal set; }
        public double GroundYawDeg { get; internal set; }

        /// <summary>Contact bits (Vmp.Contact*) of the nearer frame, already mirrored for an alias.</summary>
        public int Contacts { get; internal set; }

        /// <summary>The frame position used: f = t · rate, wrapped (loop) or clamped (one-shot).</summary>
        public double Frame { get; internal set; }

        /// <summary>Bones written by the last sample: all 17, or an overlay clip's (mirrored) mask.</summary>
        public uint DrivenMask { get; internal set; }

        /// <summary>True when the last sample went through the canonical mirror (an alias XOR Sample's mirror).</summary>
        public bool Mirrored { get; internal set; }

        /// <summary>The clip last sampled into this buffer (names its tracks), or null.</summary>
        public VmpClip Clip { get; internal set; }

        /// <summary>The number of valid tracks in <see cref="Tracks"/>: the last clip's track count.</summary>
        public int TrackCount { get; internal set; }

        public int TrackCapacity => Tracks.Length / 3;

        /// <summary>Identity rotations, zero root and ground, no clip.</summary>
        public void Clear()
        {
            for (var b = 0; b < Vmp.BoneCount; b++)
            {
                Rotations[b * 4] = 0f;
                Rotations[b * 4 + 1] = 0f;
                Rotations[b * 4 + 2] = 0f;
                Rotations[b * 4 + 3] = 1f;
            }
            for (var i = 0; i < Tracks.Length; i++) Tracks[i] = 0f;
            RootX = RootY = RootZ = 0f;
            GroundX = GroundZ = GroundYawDeg = 0.0;
            Contacts = 0;
            Frame = 0.0;
            DrivenMask = 0;
            Mirrored = false;
            Clip = null;
            TrackCount = 0;
        }

        /// <summary>
        /// Track k of the last sample. A position (kind 1) is linearly interpolated, in metres × scale. A direction
        /// (kind 2) is linearly interpolated, then renormalised to unit length and unscaled (v1.2.3); a zero vector stays
        /// zero.
        /// </summary>
        public VmpVector3 Track(int k)
        {
            if ((uint)k >= (uint)TrackCount) throw new ArgumentOutOfRangeException(nameof(k));
            return new VmpVector3(Tracks[k * 3], Tracks[k * 3 + 1], Tracks[k * 3 + 2]);
        }

        /// <summary>Looks a track of the last sample up by name. Allocation-free; cache the index for speed.</summary>
        public bool TryGetTrack(string name, out VmpVector3 value)
        {
            var k = Clip == null ? -1 : Clip.IndexOfTrack(name);
            if (k < 0 || k >= TrackCount)
            {
                value = default;
                return false;
            }
            value = Track(k);
            return true;
        }

        /// <summary>
        /// The bat as vmp.ts PoseOut.bat: present when the clip has both bat.grip and bat.dir. grip is the bottom-hand
        /// centre (× scale); dir (from the lower hand towards the toe) and face, the optional v1.2 bat.face track (the
        /// blade's outward normal), are unit vectors. All are mirrored to (−x, y, z) for an alias. They are presentation
        /// only: from the swing on, the bat drawn is the physics batAt.
        /// </summary>
        public bool TryGetBat(out VmpVector3 grip, out VmpVector3 dir, out VmpVector3 face, out bool hasFace)
        {
            grip = default;
            dir = default;
            face = default;
            hasFace = false;
            if (Clip == null) return false;
            var gi = Clip.BatGripTrack;
            var di = Clip.BatDirTrack;
            if (gi < 0 || di < 0 || gi >= TrackCount || di >= TrackCount) return false;
            grip = Track(gi);
            dir = Track(di);
            var fi = Clip.BatFaceTrack;
            if (fi >= 0 && fi < TrackCount)
            {
                face = Track(fi);
                hasFace = true;
            }
            return true;
        }
    }

    /// <summary>Decoded frames of one VMC1 record, shared by a clip and its mirror aliases. Read-only after parse.</summary>
    internal sealed class VmpClipData
    {
        internal string Name;
        internal int Flags;
        internal int Rate;
        internal int FrameCount;
        internal uint BoneMask;
        internal int Codec;
        internal float Duration;
        internal float SpeedMps;
        internal float TravelX;
        internal float TravelZ;
        internal float TravelYawDeg;
        internal float CycleSteps;
        internal string Role;
        internal string[] MarkerNames;
        internal float[] MarkerTimes;
        internal string[] TrackNames;
        internal int[] TrackKinds;

        internal float[] Ground; // F × 3: x, z (m), yaw (deg)
        internal float[] Hips; // F × 3 (m)
        internal byte[] Contacts; // F
        internal int MaskedCount; // B
        internal int[] Slot; // bone id -> index among the masked bones, or -1
        internal float[] Quats; // F × B × 4, masked bones only (unmasked bones are identity)
        internal float[][] Tracks; // one F × 3 array per track

        internal int BatGripTrack = -1;
        internal int BatDirTrack = -1;
        internal int BatFaceTrack = -1;
    }

    /// <summary>
    /// One playable clip: a VMC1 record, or a mirror alias that samples its source through the canonical mirror
    /// (§3). Immutable; share it freely between actors.
    /// </summary>
    public sealed class VmpClip
    {
        private const double Sqrt1_2 = 0.7071067811865476; // Math.SQRT1_2 in vmp.ts

        private readonly VmpClipData d;
        private readonly bool mirrored;
        private readonly string name;
        private readonly uint drivenMask; // the bones a sample of this clip (alias state) writes
        private readonly uint flippedMask; // the same, through one more canonical mirror (Sample with mirror: true)

        internal VmpClip(VmpClipData data, string name, bool mirrored)
        {
            d = data;
            this.name = name;
            this.mirrored = mirrored;
            var overlay = (data.Flags & Vmp.FlagOverlay) != 0;
            drivenMask = !overlay ? Vmp.AllBonesMask : mirrored ? Vmp.MirrorMask(data.BoneMask) : data.BoneMask;
            flippedMask = !overlay ? Vmp.AllBonesMask : mirrored ? data.BoneMask : Vmp.MirrorMask(data.BoneMask);
        }

        public string Name => name;
        /// <summary>The stored record's name: the clip itself, or an alias's source.</summary>
        public string Source => d.Name;
        public bool Mirrored => mirrored;
        public int Flags => d.Flags;
        public bool Loop => (d.Flags & Vmp.FlagLoop) != 0;
        public bool HasGround => (d.Flags & Vmp.FlagGround) != 0;
        public bool Mirrorable => (d.Flags & Vmp.FlagMirrorable) != 0;
        public bool Overlay => (d.Flags & Vmp.FlagOverlay) != 0;
        public bool Phase0LeftStrike => (d.Flags & Vmp.FlagPhase0LeftStrike) != 0;
        public int Rate => d.Rate;
        public int FrameCount => d.FrameCount;
        /// <summary>The stored bone mask (the source's, as vmp.ts reports it for an alias too).</summary>
        public uint BoneMask => d.BoneMask;
        /// <summary>The bones a sample writes: all 17, or for an overlay its mask (mirrored for an alias).</summary>
        public uint DrivenMask => drivenMask;
        public int Codec => d.Codec;
        public float Duration => d.Duration;
        public float SpeedMps => d.SpeedMps;
        /// <summary>Travel per loop cycle (or over a one-shot); an alias reports it mirrored (−x, z, −yaw).</summary>
        public float TravelX => mirrored ? -d.TravelX : d.TravelX;
        public float TravelZ => d.TravelZ;
        public float TravelYawDeg => mirrored ? -d.TravelYawDeg : d.TravelYawDeg;
        public float CycleSteps => d.CycleSteps;
        public string Role => d.Role;

        public int MarkerCount => d.MarkerNames.Length;
        public string MarkerName(int i) => d.MarkerNames[i];
        public float MarkerTime(int i) => d.MarkerTimes[i];

        /// <summary>A marker's time in seconds. With a repeated name the last one wins, as in vmp.ts.</summary>
        public bool TryGetMarker(string markerName, out float time)
        {
            for (var i = d.MarkerNames.Length - 1; i >= 0; i--)
            {
                if (string.Equals(d.MarkerNames[i], markerName, StringComparison.Ordinal))
                {
                    time = d.MarkerTimes[i];
                    return true;
                }
            }
            time = 0f;
            return false;
        }

        public int TrackCount => d.TrackNames.Length;
        public string TrackName(int k) => d.TrackNames[k];
        /// <summary>Vmp.TrackKindPosition (1 mm per unit) or Vmp.TrackKindDirection (1/32767 per unit).</summary>
        public int TrackKind(int k) => d.TrackKinds[k];

        /// <summary>The index of a track by name, or −1. The first match wins, as indexOf in vmp.ts.</summary>
        public int IndexOfTrack(string trackName)
        {
            for (var k = 0; k < d.TrackNames.Length; k++)
                if (string.Equals(d.TrackNames[k], trackName, StringComparison.Ordinal)) return k;
            return -1;
        }

        internal int BatGripTrack => d.BatGripTrack;
        internal int BatDirTrack => d.BatDirTrack;
        internal int BatFaceTrack => d.BatFaceTrack;

        // Raw decoded source frames: unmirrored, unscaled, exactly what vmp.ts MotionClip holds.

        public void GetGroundFrame(int f, out float x, out float z, out float yawDeg)
        {
            CheckFrame(f);
            x = d.Ground[f * 3];
            z = d.Ground[f * 3 + 1];
            yawDeg = d.Ground[f * 3 + 2];
        }

        public void GetHipsFrame(int f, out float x, out float y, out float z)
        {
            CheckFrame(f);
            x = d.Hips[f * 3];
            y = d.Hips[f * 3 + 1];
            z = d.Hips[f * 3 + 2];
        }

        public int GetContactsFrame(int f)
        {
            CheckFrame(f);
            return d.Contacts[f];
        }

        public void GetRotationFrame(int f, int bone, out float x, out float y, out float z, out float w)
        {
            CheckFrame(f);
            if ((uint)bone >= Vmp.BoneCount) throw new ArgumentOutOfRangeException(nameof(bone));
            var s = d.Slot[bone];
            if (s < 0)
            {
                x = 0f;
                y = 0f;
                z = 0f;
                w = 1f;
                return;
            }
            var o = (f * d.MaskedCount + s) * 4;
            x = d.Quats[o];
            y = d.Quats[o + 1];
            z = d.Quats[o + 2];
            w = d.Quats[o + 3];
        }

        public void GetTrackFrame(int k, int f, out float x, out float y, out float z)
        {
            CheckFrame(f);
            var a = d.Tracks[k];
            x = a[f * 3];
            y = a[f * 3 + 1];
            z = a[f * 3 + 2];
        }

        /// <summary>Speed-matched playback rate for a gait loop at ground speed v (§6): v / (scale · speedMps).</summary>
        public double GaitRate(double v, double scale = 1.0)
        {
            if (!(d.SpeedMps > 0f)) return 1.0;
            return v / (scale * d.SpeedMps);
        }

        /// <summary>
        /// Samples the clip at t seconds into <paramref name="pose"/> (MOTION-SPEC §6, the arithmetic of vmp.ts
        /// sampleMotion). A one-shot clamps t to [0, duration]; a loop wraps it and adds one cycle's travel per wrap to
        /// the ground track. Quaternions nlerp on one hemisphere; ground, hips and tracks interpolate linearly; contacts
        /// take the nearer frame; direction tracks are renormalised. scale (body scale) multiplies the hips offset, the
        /// ground x/z and position tracks; rotations, yaw and direction tracks never scale. An overlay clip writes only
        /// its masked bones, and writes the root and ground only if the hips are in its mask; otherwise the buffer keeps
        /// the base pose's values. No allocation; a pure function of (clip, t, scale, mirror) and the base pose.
        /// <para>
        /// mirror: true applies the canonical mirror (§3) once more, through exactly the code path of a mirror alias.
        /// The effective mirror is (this clip is an alias) XOR mirror, so sampling a source with mirror: true gives the
        /// alias's sample bit for bit, and an alias with mirror: true gives its source. It covers rotations (L <-> R,
        /// (x, −y, −z, w)), the root and ground x, yaw, contacts and every track, bat included (x -> −x). It is a
        /// rig-frame conversion, for example for Unity rigs whose L/R labels are anatomically mirrored, so it applies to
        /// every clip, including a non-mirrorable bowling action. Mirror once: do not also pass mirrorForRig to ApplyTo.
        /// </para>
        /// </summary>
        public void Sample(double t, VmpPose pose, double scale = 1.0, bool mirror = false)
        {
            if (pose == null) throw new ArgumentNullException(nameof(pose));
            if (double.IsNaN(t) || double.IsInfinity(t)) throw new ArgumentException("sampleMotion: non-finite time", nameof(t));
            var data = d;
            var mir = mirrored ^ mirror; // the canonical mirror is an involution: an alias mirrored again is its source
            var trackCount = data.TrackNames.Length;
            if (trackCount > pose.TrackCapacity)
                throw new ArgumentException("VmpPose has too little track capacity for this clip", nameof(pose));

            var F = data.FrameCount;
            var loop = (data.Flags & Vmp.FlagLoop) != 0;
            var overlay = (data.Flags & Vmp.FlagOverlay) != 0;
            double duration = data.Duration;
            double cycles = 0.0;
            var time = t;
            if (loop)
            {
                cycles = Math.Floor(time / duration);
                time -= cycles * duration;
            }
            else
            {
                time = Math.Min(Math.Max(time, 0.0), duration);
            }
            var f = Math.Min(time * data.Rate, loop ? F - 1e-9 : F - 1);
            if (f < 0.0) f = 0.0; // defensive only: unreachable for finite t (wrap and clamp keep time >= 0)
            var i0 = (int)Math.Floor(f);
            if (i0 > F - 1) i0 = F - 1;
            var u = f - i0;
            var i1 = i0 + 1;
            var wrap = 0;
            if (i1 >= F)
            {
                if (loop)
                {
                    i1 = 0;
                    wrap = 1;
                }
                else
                {
                    i1 = F - 1;
                }
            }

            // Rotations. For an alias, output bone b is the mirrored nlerp of source bone MirrorBone(b).
            var q = data.Quats;
            var slots = data.Slot;
            var nb = data.MaskedCount;
            var outQ = pose.Rotations;
            for (var b = 0; b < Vmp.BoneCount; b++)
            {
                var s = mir ? Vmp.MirrorBone(b) : b;
                var slot = slots[s];
                var o = b * 4;
                if (slot < 0)
                {
                    if (overlay) continue;
                    outQ[o] = 0f;
                    outQ[o + 1] = mir ? -0f : 0f;
                    outQ[o + 2] = mir ? -0f : 0f;
                    outQ[o + 3] = 1f;
                    continue;
                }
                var a = (i0 * nb + slot) * 4;
                var c = (i1 * nb + slot) * 4;
                double ax = q[a], ay = q[a + 1], az = q[a + 2], aw = q[a + 3];
                double bx = q[c], by = q[c + 1], bz = q[c + 2], bw = q[c + 3];
                var dot = ax * bx + ay * by + az * bz + aw * bw;
                if (dot < 0.0)
                {
                    bx = -bx;
                    by = -by;
                    bz = -bz;
                    bw = -bw;
                }
                var x = ax + (bx - ax) * u;
                var y = ay + (by - ay) * u;
                var z = az + (bz - az) * u;
                var w = aw + (bw - aw) * u;
                var l = Math.Sqrt(x * x + y * y + z * z + w * w);
                if (l == 0.0) l = 1.0;
                x /= l;
                y /= l;
                z /= l;
                w /= l;
                if (mir)
                {
                    y = -y;
                    z = -z;
                }
                outQ[o] = (float)x;
                outQ[o + 1] = (float)y;
                outQ[o + 2] = (float)z;
                outQ[o + 3] = (float)w;
            }

            // Hips offset (SampledPose.root before scale).
            var h = data.Hips;
            double h0, h1;
            h0 = h[i0 * 3];
            h1 = h[i1 * 3];
            var hx = h0 + (h1 - h0) * u;
            h0 = h[i0 * 3 + 1];
            h1 = h[i1 * 3 + 1];
            var hy = h0 + (h1 - h0) * u;
            h0 = h[i0 * 3 + 2];
            h1 = h[i1 * 3 + 2];
            var hz = h0 + (h1 - h0) * u;

            // Ground track: source (unmirrored) travel; the seam adds one cycle, each whole cycle adds one more.
            var g = data.Ground;
            double stx = data.TravelX, stz = data.TravelZ, styaw = data.TravelYawDeg;
            double g0, g1;
            g0 = g[i0 * 3];
            g1 = g[i1 * 3];
            var gx = g0 + (g1 + wrap * stx - g0) * u + cycles * stx;
            g0 = g[i0 * 3 + 1];
            g1 = g[i1 * 3 + 1];
            var gz = g0 + (g1 + wrap * stz - g0) * u + cycles * stz;
            g0 = g[i0 * 3 + 2];
            g1 = g[i1 * 3 + 2];
            var gyaw = g0 + (g1 + wrap * styaw - g0) * u + cycles * styaw;

            int contacts = data.Contacts[u < 0.5 ? i0 : i1];

            // Vector tracks, generically by descriptor (v1.2.3): a position (kind 1) lerps and scales with the body; a
            // direction (kind 2) lerps, is renormalised (zero stays zero) and never scales. An alias mirrors x.
            var outT = pose.Tracks;
            for (var k = 0; k < trackCount; k++)
            {
                var arr = data.Tracks[k];
                double a0, a1;
                a0 = arr[i0 * 3];
                a1 = arr[i1 * 3];
                var vx = a0 + (a1 - a0) * u;
                a0 = arr[i0 * 3 + 1];
                a1 = arr[i1 * 3 + 1];
                var vy = a0 + (a1 - a0) * u;
                a0 = arr[i0 * 3 + 2];
                a1 = arr[i1 * 3 + 2];
                var vz = a0 + (a1 - a0) * u;
                if (data.TrackKinds[k] == Vmp.TrackKindPosition)
                {
                    vx *= scale;
                    vy *= scale;
                    vz *= scale;
                }
                else
                {
                    var vl = Math.Sqrt(vx * vx + vy * vy + vz * vz);
                    if (vl == 0.0) vl = 1.0;
                    vx /= vl;
                    vy /= vl;
                    vz /= vl;
                }
                if (mir) vx = -vx;
                outT[k * 3] = (float)vx;
                outT[k * 3 + 1] = (float)vy;
                outT[k * 3 + 2] = (float)vz;
            }

            if (mir)
            {
                hx = -hx;
                gx = -gx;
                gyaw = -gyaw;
                contacts = Vmp.MirrorContacts(contacts);
            }

            // An overlay whose mask leaves out the hips drives neither the root nor the ground (v1.2.3): they keep the
            // base pose's values already in this buffer.
            if (!overlay || (data.BoneMask & 1u) != 0)
            {
                pose.RootX = (float)(hx * scale);
                pose.RootY = (float)(hy * scale);
                pose.RootZ = (float)(hz * scale);
                pose.GroundX = gx * scale;
                pose.GroundZ = gz * scale;
                pose.GroundYawDeg = gyaw;
            }
            pose.Contacts = contacts;
            pose.Frame = f;
            pose.DrivenMask = mirror ? flippedMask : drivenMask;
            pose.Mirrored = mir;
            pose.Clip = this;
            pose.TrackCount = trackCount;
        }

        private void CheckFrame(int f)
        {
            if ((uint)f >= (uint)d.FrameCount) throw new ArgumentOutOfRangeException(nameof(f));
        }

        // ---- Decoding (parse time only) ------------------------------------------------------------------------

        internal static VmpClipData Decode(byte[] bytes, int length, int off, long recordBytes, string[] strings)
        {
            var r = new VmpReader(bytes, length, off);
            if (!r.Tag('V', 'M', 'C', '1')) throw new VmpFormatException("VMC1: bad magic");
            var data = new VmpClipData();
            data.Name = VmpReader.Str(strings, r.U16());
            var flags = r.U16();
            if ((flags & ~31) != 0) throw new VmpFormatException("VMC1: unknown flags");
            var rate = r.U16();
            if (rate != 15 && rate != 20 && rate != 30 && rate != 60) throw new VmpFormatException("VMC1: unsupported sample rate");
            var frameCount = r.U16();
            if (frameCount < 2) throw new VmpFormatException("VMC1: too few frames");
            var boneMask = r.U32();
            if (boneMask == 0 || (boneMask >> Vmp.BoneCount) != 0) throw new VmpFormatException("VMC1: bad bone mask");
            var codec = r.U8();
            var qb = Vmp.QuatBytes(codec);
            var trackCount = r.U8();
            var markerCount = r.U16();
            var duration = r.F32();
            var speedMps = r.F32();
            var tx = r.F32();
            var tz = r.F32();
            var tyaw = r.F32();
            var cycleSteps = r.F32();
            var role = VmpReader.Str(strings, r.U16());
            if (r.U16() != 0) throw new VmpFormatException("VMC1: reserved field set");
            var loop = (flags & Vmp.FlagLoop) != 0;
            var want = loop ? (double)frameCount / rate : (double)(frameCount - 1) / rate;
            if (Math.Abs(duration - want) > 1e-4) throw new VmpFormatException("VMC1: duration disagrees with frames");

            var markerNames = new string[markerCount];
            var markerTimes = new float[markerCount];
            for (var i = 0; i < markerCount; i++)
            {
                var mn = VmpReader.Str(strings, r.U16());
                if (r.U16() != 0) throw new VmpFormatException("VMC1: reserved marker field set");
                var mt = r.F32();
                if (mt < -1e-6 || mt > duration + 1e-6) throw new VmpFormatException("VMC1: marker " + mn + " outside the clip");
                markerNames[i] = mn;
                markerTimes[i] = mt;
            }
            var trackNames = new string[trackCount];
            var trackKinds = new int[trackCount];
            for (var k = 0; k < trackCount; k++)
            {
                trackNames[k] = VmpReader.Str(strings, r.U16());
                var kind = r.U16();
                if (kind != Vmp.TrackKindPosition && kind != Vmp.TrackKindDirection)
                    throw new VmpFormatException("VMC1: unknown track kind");
                trackKinds[k] = kind;
            }

            var slot = new int[Vmp.BoneCount];
            var nb = 0;
            for (var b = 0; b < Vmp.BoneCount; b++) slot[b] = ((boneMask >> b) & 1u) != 0 ? nb++ : -1;
            long stride = Vmp.FrameFixedBytes + nb * qb + trackCount * 6;
            if (r.Off - off + stride * frameCount != recordBytes) throw new VmpFormatException("VMC1: record length mismatch");
            r.Need(stride * frameCount);

            var ground = new float[frameCount * 3];
            var hips = new float[frameCount * 3];
            var contacts = new byte[frameCount];
            var quats = new float[frameCount * nb * 4];
            var tracks = new float[trackCount][];
            for (var k = 0; k < trackCount; k++) tracks[k] = new float[frameCount * 3];
            for (var f = 0; f < frameCount; f++)
            {
                ground[f * 3] = (float)(r.I16() / 1000.0);
                ground[f * 3 + 1] = (float)(r.I16() / 1000.0);
                ground[f * 3 + 2] = (float)(r.I16() / 100.0);
                hips[f * 3] = (float)(r.I16() / 1000.0);
                hips[f * 3 + 1] = (float)(r.I16() / 1000.0);
                hips[f * 3 + 2] = (float)(r.I16() / 1000.0);
                var cbits = r.U8();
                if ((cbits & 0x80) != 0) throw new VmpFormatException("VMC1: unknown contact bit");
                contacts[f] = (byte)cbits;
                if (r.U8() != 0) throw new VmpFormatException("VMC1: reserved frame byte set");
                for (var s = 0; s < nb; s++)
                {
                    DecodeQuat(bytes, r.Off, codec, quats, (f * nb + s) * 4);
                    r.Off += qb;
                }
                for (var k = 0; k < trackCount; k++)
                {
                    var scaleDiv = trackKinds[k] == Vmp.TrackKindPosition ? 1000.0 : 32767.0;
                    tracks[k][f * 3] = (float)(r.I16() / scaleDiv);
                    tracks[k][f * 3 + 1] = (float)(r.I16() / scaleDiv);
                    tracks[k][f * 3 + 2] = (float)(r.I16() / scaleDiv);
                }
            }

            data.Flags = flags;
            data.Rate = rate;
            data.FrameCount = frameCount;
            data.BoneMask = boneMask;
            data.Codec = codec;
            data.Duration = duration;
            data.SpeedMps = speedMps;
            data.TravelX = tx;
            data.TravelZ = tz;
            data.TravelYawDeg = tyaw;
            data.CycleSteps = cycleSteps;
            data.Role = role;
            data.MarkerNames = markerNames;
            data.MarkerTimes = markerTimes;
            data.TrackNames = trackNames;
            data.TrackKinds = trackKinds;
            data.Ground = ground;
            data.Hips = hips;
            data.Contacts = contacts;
            data.MaskedCount = nb;
            data.Slot = slot;
            data.Quats = quats;
            data.Tracks = tracks;
            data.BatGripTrack = FirstTrack(trackNames, "bat.grip");
            data.BatDirTrack = FirstTrack(trackNames, "bat.dir");
            data.BatFaceTrack = FirstTrack(trackNames, "bat.face");
            return data;
        }

        private static int FirstTrack(string[] names, string wanted)
        {
            for (var k = 0; k < names.Length; k++)
                if (string.Equals(names[k], wanted, StringComparison.Ordinal)) return k;
            return -1;
        }

        /// <summary>Smallest-three decode (§5.4) into out[o..o+3] as (x, y, z, w). The caller has bounds-checked off.</summary>
        internal static void DecodeQuat(byte[] bytes, int off, int codec, float[] output, int o)
        {
            int i, a, b, c;
            double max;
            if (codec == 1)
            {
                var v = (uint)(bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24));
                i = (int)(v >> 30);
                a = (int)((v >> 20) & 1023u);
                b = (int)((v >> 10) & 1023u);
                c = (int)(v & 1023u);
                max = 1023.0;
            }
            else
            {
                var w0 = bytes[off] | (bytes[off + 1] << 8);
                var w1 = bytes[off + 2] | (bytes[off + 3] << 8);
                var w2 = bytes[off + 4] | (bytes[off + 5] << 8);
                if ((w2 & 0x8000) != 0) throw new VmpFormatException("VMC1: codec-2 quaternion has a stray bit");
                i = ((w0 >> 15) & 1) | (((w1 >> 15) & 1) << 1);
                a = w0 & 0x7fff;
                b = w1 & 0x7fff;
                c = w2;
                max = 32767.0;
            }
            var ca = (a / max * 2.0 - 1.0) * Sqrt1_2;
            var cb = (b / max * 2.0 - 1.0) * Sqrt1_2;
            var cc = (c / max * 2.0 - 1.0) * Sqrt1_2;
            var big = Math.Sqrt(Math.Max(0.0, 1.0 - ca * ca - cb * cb - cc * cc));
            double q0, q1, q2, q3;
            switch (i)
            {
                case 0:
                    q0 = big; q1 = ca; q2 = cb; q3 = cc;
                    break;
                case 1:
                    q0 = ca; q1 = big; q2 = cb; q3 = cc;
                    break;
                case 2:
                    q0 = ca; q1 = cb; q2 = big; q3 = cc;
                    break;
                default:
                    q0 = ca; q1 = cb; q2 = cc; q3 = big;
                    break;
            }
            var l = Math.Sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
            if (l == 0.0) l = 1.0;
            output[o] = (float)(q0 / l);
            output[o + 1] = (float)(q1 / l);
            output[o + 2] = (float)(q2 / l);
            output[o + 3] = (float)(q3 / l);
        }
    }

    /// <summary>A parsed, fully validated VMP1 pack (§5.1). Immutable; parse once and keep it.</summary>
    public sealed class VmpPack
    {
        private readonly VmpClip[] ordered;
        private readonly Dictionary<string, VmpClip> byName;

        private VmpPack(int bytes, uint crc, VmpClip[] ordered, Dictionary<string, VmpClip> byName, int maxTracks)
        {
            Bytes = bytes;
            Crc = crc;
            this.ordered = ordered;
            this.byName = byName;
            MaxTrackCount = maxTracks;
        }

        public int Bytes { get; }
        public uint Crc { get; }
        /// <summary>Directory entries, mirror aliases included.</summary>
        public int ClipCount => ordered.Length;
        /// <summary>The largest track count of any clip: a VmpPose of this capacity can sample every clip.</summary>
        public int MaxTrackCount { get; }

        /// <summary>The clip at directory index i (the order of vmp.ts MotionPack.names: sorted by name).</summary>
        public VmpClip GetClip(int index) => ordered[index];

        public VmpClip GetClip(string name)
        {
            VmpClip clip;
            if (name != null && byName.TryGetValue(name, out clip)) return clip;
            throw new KeyNotFoundException("VMP1: no clip named " + name);
        }

        public bool TryGetClip(string name, out VmpClip clip)
        {
            if (name == null)
            {
                clip = null;
                return false;
            }
            return byName.TryGetValue(name, out clip);
        }

        /// <summary>Parses and validates a whole pack (vmp.ts parsePack). Throws VmpFormatException on any error.</summary>
        public static VmpPack Parse(byte[] bytes)
        {
            if (bytes == null) throw new ArgumentNullException(nameof(bytes));
            var length = bytes.Length;
            if (length < Vmp.PackHeaderBytes) throw new VmpFormatException("VMP1: truncated");
            var r = new VmpReader(bytes, length, 0);
            if (!r.Tag('V', 'M', 'P', '1')) throw new VmpFormatException("VMP1: bad magic");
            if (r.U16() != 1) throw new VmpFormatException("VMP1: unsupported version");
            if (r.U16() != Vmp.PackHeaderBytes) throw new VmpFormatException("VMP1: unsupported header");
            if (r.U16() != Vmp.BoneCount) throw new VmpFormatException("VMP1: not a VC17 pack");
            var clipCount = r.U16();
            if (r.U32() != Vmp.SkeletonId) throw new VmpFormatException("VMP1: skeleton id mismatch");
            long strOff = r.U32();
            long strBytes = r.U32();
            long total = r.U32();
            var crc = r.U32();
            if (total != length) throw new VmpFormatException("VMP1: length mismatch");
            if (Vmp.Crc32(bytes, Vmp.PackHeaderBytes, length) != crc) throw new VmpFormatException("VMP1: CRC mismatch");
            if (strOff + strBytes != total) throw new VmpFormatException("VMP1: string table must end the pack");
            var strings = ReadStrings(bytes, length, (int)strOff, strBytes);

            long dirEnd = Vmp.PackHeaderBytes + (long)clipCount * Vmp.DirEntryBytes;
            var names = new string[clipCount];
            var aliases = new bool[clipCount];
            var offs = new long[clipCount];
            var lens = new long[clipCount];
            var sources = new string[clipCount];
            for (var i = 0; i < clipCount; i++)
            {
                var entryName = VmpReader.Str(strings, r.U16());
                var ef = r.U16();
                if ((ef & ~1) != 0) throw new VmpFormatException("VMP1: unknown entry flags");
                long off = r.U32();
                long len = r.U32();
                var src = r.U16();
                if (r.U16() != 0) throw new VmpFormatException("VMP1: reserved entry field set");
                var alias = (ef & 1) == 1;
                if (alias != (src != 0xffff)) throw new VmpFormatException("VMP1: alias entry inconsistent");
                if (off < dirEnd || off + len > strOff) throw new VmpFormatException("VMP1: clip out of range");
                names[i] = entryName;
                aliases[i] = alias;
                offs[i] = off;
                lens[i] = len;
                sources[i] = alias ? VmpReader.Str(strings, src) : entryName;
            }

            var clips = new VmpClip[clipCount];
            var byName = new Dictionary<string, VmpClip>(clipCount, StringComparer.Ordinal);
            var decoded = new Dictionary<long, VmpClipData>();
            var maxTracks = 0;
            var expect = dirEnd;
            for (var i = 0; i < clipCount; i++)
            {
                if (aliases[i]) continue;
                if (offs[i] != expect) throw new VmpFormatException("VMP1: clip records must be contiguous");
                var data = VmpClip.Decode(bytes, length, (int)offs[i], lens[i], strings);
                if (!string.Equals(data.Name, names[i], StringComparison.Ordinal))
                    throw new VmpFormatException("VMP1: directory name mismatch");
                decoded[offs[i]] = data;
                if (byName.ContainsKey(names[i])) throw new VmpFormatException("VMP1: duplicate clip " + names[i]);
                var clip = new VmpClip(data, names[i], false);
                byName.Add(names[i], clip);
                clips[i] = clip;
                if (data.TrackNames.Length > maxTracks) maxTracks = data.TrackNames.Length;
                expect += lens[i];
            }
            if (expect != strOff) throw new VmpFormatException("VMP1: undeclared bytes before the string table");
            for (var i = 0; i < clipCount; i++)
            {
                if (!aliases[i]) continue;
                VmpClipData src;
                if (!decoded.TryGetValue(offs[i], out src) || !string.Equals(src.Name, sources[i], StringComparison.Ordinal))
                    throw new VmpFormatException("VMP1: alias " + names[i] + " has no source");
                var sourceEntry = -1;
                for (var j = 0; j < clipCount && sourceEntry < 0; j++)
                    if (!aliases[j] && string.Equals(names[j], sources[i], StringComparison.Ordinal)) sourceEntry = j;
                if (sourceEntry < 0 || lens[sourceEntry] != lens[i])
                    throw new VmpFormatException("VMP1: alias " + names[i] + " byte count differs from its source");
                if ((src.Flags & Vmp.FlagMirrorable) == 0)
                    throw new VmpFormatException("VMP1: alias " + names[i] + " mirrors a non-mirrorable clip");
                if (byName.ContainsKey(names[i])) throw new VmpFormatException("VMP1: duplicate clip " + names[i]);
                var clip = new VmpClip(src, names[i], true);
                byName.Add(names[i], clip);
                clips[i] = clip;
            }
            return new VmpPack(length, crc, clips, byName, maxTracks);
        }

        private static string[] ReadStrings(byte[] bytes, int length, int off, long tableBytes)
        {
            var r = new VmpReader(bytes, length, off);
            var count = r.U16();
            var output = new string[count];
            for (var i = 0; i < count; i++)
            {
                var len = r.U16();
                r.Need(len);
                var chars = new char[len];
                for (var k = 0; k < len; k++)
                {
                    var ch = bytes[r.Off + k];
                    if (ch < 0x20 || ch > 0x7e) throw new VmpFormatException("VMP1: non-ASCII string");
                    chars[k] = (char)ch;
                }
                r.Off += len;
                output[i] = new string(chars);
            }
            if (r.Off != off + tableBytes) throw new VmpFormatException("VMP1: string table length mismatch");
            if (count == 0 || output[0].Length != 0) throw new VmpFormatException("VMP1: string 0 must be empty");
            return output;
        }
    }

    /// <summary>Bounds-checked little-endian reader over the whole pack (vmp.ts Reader).</summary>
    internal sealed class VmpReader
    {
        private readonly byte[] bytes;
        private readonly int length;
        internal int Off;

        internal VmpReader(byte[] bytes, int length, int off)
        {
            this.bytes = bytes;
            this.length = length;
            Off = off;
        }

        internal void Need(long n)
        {
            if (n < 0 || Off + n > length) throw new VmpFormatException("VMP1: truncated");
        }

        internal int U8()
        {
            Need(1);
            return bytes[Off++];
        }

        internal int U16()
        {
            Need(2);
            var v = bytes[Off] | (bytes[Off + 1] << 8);
            Off += 2;
            return v;
        }

        internal int I16()
        {
            Need(2);
            var v = (short)(bytes[Off] | (bytes[Off + 1] << 8));
            Off += 2;
            return v;
        }

        internal uint U32()
        {
            Need(4);
            var v = (uint)(bytes[Off] | (bytes[Off + 1] << 8) | (bytes[Off + 2] << 16) | (bytes[Off + 3] << 24));
            Off += 4;
            return v;
        }

        internal float F32()
        {
            var v = BitConverter.Int32BitsToSingle(unchecked((int)U32()));
            if (float.IsNaN(v) || float.IsInfinity(v)) throw new VmpFormatException("VMP1: non-finite float");
            return v;
        }

        internal bool Tag(char a, char b, char c, char d)
        {
            Need(4);
            var ok = bytes[Off] == a && bytes[Off + 1] == b && bytes[Off + 2] == c && bytes[Off + 3] == d;
            Off += 4;
            return ok;
        }

        internal static string Str(string[] strings, int index)
        {
            if (index >= strings.Length) throw new VmpFormatException("VMP1: string index out of range");
            return strings[index];
        }
    }
}

#if UNITY_5_3_OR_NEWER
namespace Vande.Practice.MotionPacks
{
    using UnityEngine;
    using Vande.Practice.Presentation.Production.Characters;

    /// <summary>
    /// The thin Unity adapter (MOTION-SPEC §6 "Into Unity", §2). VC17 id i is ProductionCharacterJoint i.
    /// <para>
    /// mirrorForRig: true converts into a rig whose L/R labels are anatomically mirrored (rigLabelsAnatomical = false,
    /// in a reflected world). It is the canonical mirror of §3, the one a mirror alias uses, built on the same primitives:
    /// - output bone b takes bone Vmp.MirrorBone(b);
    /// - rotations become (x, −y, −z, w);
    /// - the root, ground and track x become −x;
    /// - yaw becomes −yaw.
    /// Every call below gives bit for bit what VmpClip.Sample(t, pose, scale, mirror: true) followed by the plain call
    /// gives (cross-checked). Mirror once: pass mirrorForRig to every call for that actor (ApplyTo, TryGetBat,
    /// TrackVector, GroundPosition, GroundRotation), or sample with mirror: true and pass none.
    /// </para>
    /// </summary>
    public static class VmpUnity
    {
        /// <summary>
        /// Copies a sampled pose into a ProductionCharacterPose.
        /// - Rotations[i] = (x, y, z, w), with the components unchanged.
        /// - RootOffset = the hips offset with x and z × horizontalScale and y unscaled. Use 0.9836 for the driver rig;
        ///   for the hero rig pass hero leg length ÷ 0.915.
        /// - Only the bones the clip drove are written, so an overlay leaves the base pose's other bones alone, and the
        ///   root too when its mask has no hips (v1.2.3).
        /// - mirrorForRig applies the canonical mirror (see the class summary).
        /// - BatRotation is not touched.
        /// No allocation.
        /// </summary>
        public static void ApplyTo(this VmpPose pose, ProductionCharacterPose target, bool mirrorForRig = false,
            float horizontalScale = Vmp.UnityDriverHorizontalScale)
        {
            if (pose == null) throw new System.ArgumentNullException(nameof(pose));
            if (target == null) throw new System.ArgumentNullException(nameof(target));
            var src = pose.Rotations;
            var dst = target.Rotations;
            var driven = pose.DrivenMask;
            for (var b = 0; b < Vmp.BoneCount; b++)
            {
                var s = mirrorForRig ? Vmp.MirrorBone(b) : b;
                if (((driven >> s) & 1u) == 0) continue;
                var o = s * 4;
                dst[b] = mirrorForRig
                    ? new Quaternion(src[o], -src[o + 1], -src[o + 2], src[o + 3])
                    : new Quaternion(src[o], src[o + 1], src[o + 2], src[o + 3]);
            }
            if ((driven & 1u) != 0)
            {
                var rx = mirrorForRig ? -pose.RootX : pose.RootX;
                target.RootOffset = new Vector3(rx * horizontalScale, pose.RootY, pose.RootZ * horizontalScale);
            }
        }

        /// <summary>
        /// The bat tracks as Unity vectors: grip (m, × body scale, never × 0.9836, which is for hips and ground only),
        /// dir and face (unit). mirrorForRig mirrors them to (−x, y, z).
        /// </summary>
        public static bool TryGetBat(this VmpPose pose, bool mirrorForRig, out Vector3 grip, out Vector3 dir,
            out Vector3 face, out bool hasFace)
        {
            VmpVector3 g, d, f;
            var ok = pose.TryGetBat(out g, out d, out f, out hasFace);
            grip = Rig(g, mirrorForRig);
            dir = Rig(d, mirrorForRig);
            face = Rig(f, mirrorForRig);
            return ok;
        }

        /// <summary>Track k of the last sample as a Unity vector; mirrorForRig mirrors it to (−x, y, z).</summary>
        public static Vector3 TrackVector(this VmpPose pose, int k, bool mirrorForRig = false)
        {
            return Rig(pose.Track(k), mirrorForRig);
        }

        /// <summary>
        /// The ground origin's position (x and z × horizontalScale), for clip-driven actors only (§6). mirrorForRig
        /// negates x.
        /// </summary>
        public static Vector3 GroundPosition(this VmpPose pose, bool mirrorForRig = false,
            float horizontalScale = Vmp.UnityDriverHorizontalScale)
        {
            var x = mirrorForRig ? -pose.GroundX : pose.GroundX;
            return new Vector3((float)(x * horizontalScale), 0f, (float)(pose.GroundZ * horizontalScale));
        }

        /// <summary>
        /// The ground origin's heading about +Y: + yaw turns +Z towards +X, with the same components as three.js and as
        /// Quaternion.AngleAxis(yaw, Vector3.up). mirrorForRig negates the yaw.
        /// </summary>
        public static Quaternion GroundRotation(this VmpPose pose, bool mirrorForRig = false)
        {
            var yaw = mirrorForRig ? -pose.GroundYawDeg : pose.GroundYawDeg;
            var h = yaw * (System.Math.PI / 360.0);
            return new Quaternion(0f, (float)System.Math.Sin(h), 0f, (float)System.Math.Cos(h));
        }

        public static Vector3 ToVector3(this VmpVector3 v)
        {
            return new Vector3(v.X, v.Y, v.Z);
        }

        private static Vector3 Rig(VmpVector3 v, bool mirrorForRig)
        {
            return new Vector3(mirrorForRig ? -v.X : v.X, v.Y, v.Z);
        }
    }
}
#endif
