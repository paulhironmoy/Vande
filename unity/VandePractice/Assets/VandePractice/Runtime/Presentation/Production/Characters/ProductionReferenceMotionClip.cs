using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Stable semantic identifiers serialized by the VMA1 reference-motion exporter. These identifiers are a
    /// presentation-only retargeting contract. They never identify an authoritative release, contact or result.
    /// </summary>
    internal enum ProductionReferenceMotionBone : ushort
    {
        Root = 0,
        SpineLower = 1,
        SpineUpper = 2,
        Chest = 3,
        NeckLower = 4,
        NeckUpper = 5,
        Head = 6,
        ClavicleLeft = 7,
        UpperArmLeft = 8,
        ForearmLeft = 9,
        WristLeft = 10,
        HandLeft = 11,
        FingersLeft = 12,
        ThumbLeft = 13,
        ClavicleRight = 14,
        UpperArmRight = 15,
        ForearmRight = 16,
        WristRight = 17,
        HandRight = 18,
        FingersRight = 19,
        ThumbRight = 20,
        UpperLegLeft = 21,
        LowerLegLeft = 22,
        FootLeft = 23,
        ToesLeft = 24,
        UpperLegRight = 25,
        LowerLegRight = 26,
        FootRight = 27,
        ToesRight = 28,
        Count = 29
    }

    internal enum ProductionReferenceMotionMarkerKind : ushort
    {
        ClipStart = 1,
        TechnicalActionPeak = 2,
        ClipEnd = 3
    }

    internal readonly struct ProductionReferenceMotionMarker
    {
        public ProductionReferenceMotionMarker(
            ProductionReferenceMotionMarkerKind kind,
            ushort frame,
            ushort confidence,
            ushort sampleRate)
        {
            Kind = kind;
            Frame = frame;
            ConfidenceRaw = confidence;
            TimeSeconds = (double)frame / sampleRate;
        }

        public ProductionReferenceMotionMarkerKind Kind { get; }
        public ushort Frame { get; }
        public ushort ConfidenceRaw { get; }
        public float Confidence => ConfidenceRaw / 65535f;
        public double TimeSeconds { get; }
    }

    /// <summary>
    /// Strict decoder and manually seekable sampler for VMA1 technical-reference motion. VMA1 clips are deliberately
    /// root locked and contain no cricket-authoritative markers. The energy-derived action peak is only an alignment
    /// hint for future authored correction; TypeScript continues to own release, contact, flight, score and replay.
    /// </summary>
    internal sealed class ProductionReferenceMotionClip
    {
        internal const ushort FormatVersion = 1;
        internal const ushort HeaderBytes = 64;
        internal const ushort BoneRecordBytes = 8;
        internal const ushort QuaternionBytes = 8;
        internal const ushort RootPositionBytes = 6;
        internal const ushort MarkerBytes = 8;
        internal const ushort ExpectedBoneCount = (ushort)ProductionReferenceMotionBone.Count;
        internal const uint RootLockedFlag = 1;
        internal const float ExpectedRootUnitMetres = 0.001f;
        internal const ushort ExpectedSampleRate = 60;
        private const int MaximumFrameCount = ushort.MaxValue;
        private const int ExpectedMarkerCount = 3;

        // This mirrors SEMANTIC_BONES in scripts/export-unity-production-motion.mjs. Requiring the exact hierarchy
        // prevents a valid-looking stream from silently retargeting rotations onto the wrong limbs.
        private static readonly short[] ExpectedParents =
        {
            -1, 0, 1, 2, 3, 4, 5,
            3, 7, 8, 9, 10, 11, 10,
            3, 14, 15, 16, 17, 18, 17,
            0, 21, 22, 23,
            0, 25, 26, 27
        };

        private readonly Quaternion[] rotations;
        private readonly ProductionReferenceMotionMarker[] markers;

        private ProductionReferenceMotionClip(
            ushort sampleRate,
            int frameCount,
            uint durationMilliseconds,
            ulong clipIdentityPrefix,
            Quaternion[] rotations,
            ProductionReferenceMotionMarker[] markers)
        {
            SampleRate = sampleRate;
            FrameCount = frameCount;
            DurationMilliseconds = durationMilliseconds;
            ClipIdentityPrefix = clipIdentityPrefix;
            this.rotations = rotations;
            this.markers = markers;
        }

        public ushort SampleRate { get; }
        public int FrameCount { get; }
        public int BoneCount => ExpectedBoneCount;
        public uint DurationMilliseconds { get; }
        public double DurationSeconds => (double)(FrameCount - 1) / SampleRate;
        public ulong ClipIdentityPrefix { get; }
        public bool RootLocked => true;
        public int MarkerCount => markers.Length;

        public ProductionReferenceMotionMarker MarkerAt(int index)
        {
            if (index < 0 || index >= markers.Length) throw new ArgumentOutOfRangeException(nameof(index));
            return markers[index];
        }

        public bool TryGetMarker(
            ProductionReferenceMotionMarkerKind kind,
            out ProductionReferenceMotionMarker marker)
        {
            for (var index = 0; index < markers.Length; index++)
            {
                if (markers[index].Kind != kind) continue;
                marker = markers[index];
                return true;
            }

            marker = default;
            return false;
        }

        /// <summary>
        /// Samples using canonical clip time, not render-frame accumulation. Calling this at the same time always
        /// reads the same two source frames and interpolation amount, independent of a 30/60/120 Hz render cadence.
        /// Root translation is intentionally absent: VMA1 reference clips cannot move a gameplay character root.
        /// </summary>
        public void SampleAtCanonicalTime(double timeSeconds, Quaternion[] destination)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            if (destination.Length != ExpectedBoneCount)
                throw new ArgumentException("VMA1 sampling needs one rotation per semantic bone.", nameof(destination));
            if (double.IsNaN(timeSeconds) || double.IsInfinity(timeSeconds))
                throw new ArgumentOutOfRangeException(nameof(timeSeconds));

            var bounded = Math.Max(0d, Math.Min(DurationSeconds, timeSeconds));
            var exactFrame = bounded * SampleRate;
            var lower = Math.Min(FrameCount - 1, (int)Math.Floor(exactFrame));
            var upper = Math.Min(FrameCount - 1, lower + 1);
            var amount = upper == lower ? 0f : (float)(exactFrame - lower);
            var lowerOffset = lower * ExpectedBoneCount;
            var upperOffset = upper * ExpectedBoneCount;
            for (var bone = 0; bone < ExpectedBoneCount; bone++)
                destination[bone] = Nlerp(rotations[lowerOffset + bone], rotations[upperOffset + bone], amount);
        }

        public static ProductionReferenceMotionClip Decode(byte[] bytes)
        {
            if (bytes == null || bytes.Length < HeaderBytes)
                throw new InvalidOperationException("VMA1 reference motion is missing or truncated.");

            var reader = new ReferenceMotionLittleEndianReader(bytes);
            if (reader.Byte() != (byte)'V' || reader.Byte() != (byte)'M' ||
                reader.Byte() != (byte)'A' || reader.Byte() != (byte)'1')
                throw new InvalidOperationException("VMA1 reference-motion magic is invalid.");
            if (reader.UInt16() != FormatVersion || reader.UInt16() != HeaderBytes)
                throw new InvalidOperationException("VMA1 reference-motion version or header is unsupported.");
            if (reader.UInt32() != RootLockedFlag)
                throw new InvalidOperationException("VMA1 reference motion must be root locked.");

            var sampleRate = reader.UInt16();
            if (sampleRate != ExpectedSampleRate)
                throw new InvalidOperationException("VMA1 reference motion must use the 60 fps hero contract.");
            var boneCount = reader.UInt16();
            if (boneCount != ExpectedBoneCount)
                throw new InvalidOperationException("VMA1 semantic bone count is unsupported.");
            var frameCountValue = reader.UInt32();
            if (frameCountValue < 2 || frameCountValue > MaximumFrameCount)
                throw new InvalidOperationException("VMA1 reference-motion frame count is outside the contract.");
            var frameCount = checked((int)frameCountValue);
            var markerCount = reader.UInt16();
            if (markerCount != ExpectedMarkerCount)
                throw new InvalidOperationException("VMA1 reference motion must contain its three technical markers.");
            if (reader.UInt16() != BoneRecordBytes || reader.UInt16() != QuaternionBytes ||
                reader.UInt16() != MarkerBytes)
                throw new InvalidOperationException("VMA1 record stride is unsupported.");

            var durationMilliseconds = reader.UInt32();
            var expectedDuration = checked((uint)Math.Floor(
                ((double)(frameCount - 1) / sampleRate) * 1000d + 0.5d));
            if (durationMilliseconds != expectedDuration)
                throw new InvalidOperationException("VMA1 duration does not agree with its frame timeline.");

            var sourceHashIsZero = true;
            for (var index = 0; index < 16; index++) sourceHashIsZero &= reader.Byte() == 0;
            if (sourceHashIsZero)
                throw new InvalidOperationException("VMA1 source identity is missing.");
            var clipIdentityPrefix = reader.UInt64();
            if (clipIdentityPrefix == 0)
                throw new InvalidOperationException("VMA1 clip identity is missing.");
            var rootUnit = reader.Single();
            if (!Finite(rootUnit) || Math.Abs(rootUnit - ExpectedRootUnitMetres) > 0.0000001f)
                throw new InvalidOperationException("VMA1 root-position unit is unsupported.");
            var frameBytes = reader.UInt32();
            var expectedFrameBytes = checked((uint)(RootPositionBytes + boneCount * QuaternionBytes));
            if (frameBytes != expectedFrameBytes)
                throw new InvalidOperationException("VMA1 frame stride is unsupported.");

            var expectedLength = checked((long)HeaderBytes + (long)boneCount * BoneRecordBytes +
                                         (long)frameCount * frameBytes + (long)markerCount * MarkerBytes);
            if (expectedLength != bytes.LongLength)
                throw new InvalidOperationException("VMA1 byte length does not match its header.");

            for (var index = 0; index < boneCount; index++)
            {
                if (reader.UInt16() != index)
                    throw new InvalidOperationException("VMA1 semantic bone order is invalid.");
                if (reader.Int16() != ExpectedParents[index])
                    throw new InvalidOperationException("VMA1 semantic hierarchy is invalid.");
                if (reader.UInt16() != index)
                    throw new InvalidOperationException("VMA1 semantic source identity is invalid.");
                var flags = reader.UInt16();
                if (flags != (index == 0 ? 1 : 0))
                    throw new InvalidOperationException("VMA1 semantic bone flags are invalid.");
            }

            var decodedRotations = new Quaternion[checked(frameCount * boneCount)];
            for (var frame = 0; frame < frameCount; frame++)
            {
                // Root motion is not merely ignored. A root-locked clip must actually serialize zero translation,
                // preventing a future caller from accidentally re-enabling unreviewed root authority.
                if (reader.Int16() != 0 || reader.Int16() != 0 || reader.Int16() != 0)
                    throw new InvalidOperationException("VMA1 root-locked frame contains root translation.");
                for (var bone = 0; bone < boneCount; bone++)
                {
                    var rotation = new Quaternion(
                        reader.Int16() / 32767f,
                        reader.Int16() / 32767f,
                        reader.Int16() / 32767f,
                        reader.Int16() / 32767f);
                    var magnitude = rotation.x * rotation.x + rotation.y * rotation.y +
                                    rotation.z * rotation.z + rotation.w * rotation.w;
                    if (!Finite(magnitude) || magnitude < 0.95f || magnitude > 1.05f)
                        throw new InvalidOperationException("VMA1 contains an invalid quantized rotation.");
                    decodedRotations[frame * boneCount + bone] = Normalize(rotation);
                }
            }

            var decodedMarkers = new ProductionReferenceMotionMarker[markerCount];
            var markerSeen = new bool[4];
            for (var index = 0; index < markerCount; index++)
            {
                var kindRaw = reader.UInt16();
                if (kindRaw < (ushort)ProductionReferenceMotionMarkerKind.ClipStart ||
                    kindRaw > (ushort)ProductionReferenceMotionMarkerKind.ClipEnd || markerSeen[kindRaw])
                    throw new InvalidOperationException("VMA1 contains an invalid or duplicate technical marker.");
                markerSeen[kindRaw] = true;
                var frame = reader.UInt16();
                var confidence = reader.UInt16();
                if (reader.UInt16() != 0 || frame >= frameCount)
                    throw new InvalidOperationException("VMA1 technical marker is outside the clip contract.");
                var kind = (ProductionReferenceMotionMarkerKind)kindRaw;
                if ((kind == ProductionReferenceMotionMarkerKind.ClipStart && frame != 0) ||
                    (kind == ProductionReferenceMotionMarkerKind.ClipEnd && frame != frameCount - 1))
                    throw new InvalidOperationException("VMA1 boundary marker does not match the clip timeline.");
                decodedMarkers[index] = new ProductionReferenceMotionMarker(kind, frame, confidence, sampleRate);
            }
            if (!reader.AtEnd)
                throw new InvalidOperationException("VMA1 contains undeclared trailing bytes.");

            return new ProductionReferenceMotionClip(
                sampleRate,
                frameCount,
                durationMilliseconds,
                clipIdentityPrefix,
                decodedRotations,
                decodedMarkers);
        }

        private static Quaternion Nlerp(Quaternion first, Quaternion second, float amount)
        {
            var dot = first.x * second.x + first.y * second.y + first.z * second.z + first.w * second.w;
            if (dot < 0f)
                second = new Quaternion(-second.x, -second.y, -second.z, -second.w);
            return Normalize(new Quaternion(
                Mathf.LerpUnclamped(first.x, second.x, amount),
                Mathf.LerpUnclamped(first.y, second.y, amount),
                Mathf.LerpUnclamped(first.z, second.z, amount),
                Mathf.LerpUnclamped(first.w, second.w, amount)));
        }

        private static Quaternion Normalize(Quaternion value)
        {
            var magnitude = Mathf.Sqrt(value.x * value.x + value.y * value.y +
                                       value.z * value.z + value.w * value.w);
            if (magnitude < 0.000001f)
                throw new InvalidOperationException("VMA1 quaternion cannot be normalized.");
            var scale = 1f / magnitude;
            return new Quaternion(value.x * scale, value.y * scale, value.z * scale, value.w * scale);
        }

        private static bool Finite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }

    internal sealed class ReferenceMotionLittleEndianReader
    {
        private readonly byte[] bytes;
        private int offset;

        public ReferenceMotionLittleEndianReader(byte[] bytes)
        {
            this.bytes = bytes ?? throw new ArgumentNullException(nameof(bytes));
        }

        public bool AtEnd => offset == bytes.Length;

        public byte Byte()
        {
            Require(1);
            return bytes[offset++];
        }

        public short Int16()
        {
            Require(2);
            var value = unchecked((short)(bytes[offset] | (bytes[offset + 1] << 8)));
            offset += 2;
            return value;
        }

        public ushort UInt16()
        {
            return unchecked((ushort)Int16());
        }

        public uint UInt32()
        {
            Require(4);
            var value = (uint)(bytes[offset] |
                               (bytes[offset + 1] << 8) |
                               (bytes[offset + 2] << 16) |
                               (bytes[offset + 3] << 24));
            offset += 4;
            return value;
        }

        public ulong UInt64()
        {
            var low = UInt32();
            var high = UInt32();
            return low | ((ulong)high << 32);
        }

        public float Single()
        {
            Require(4);
            var value = BitConverter.ToSingle(bytes, offset);
            offset += 4;
            return value;
        }

        private void Require(int count)
        {
            if (count < 0 || offset > bytes.Length - count)
                throw new InvalidOperationException("VMA1 reference-motion data is truncated.");
        }
    }
}
