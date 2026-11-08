using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    public sealed class ProductionReferenceMotionClipTests
    {
        private const int HeaderBytes = 64;
        private const int BoneBytes = 29 * 8;
        private const int FrameBytes = 6 + 29 * 8;

        [Test]
        public void Decode_AcceptsStrictRootLockedSemanticClipAndExposesTechnicalMarkers()
        {
            var clip = ProductionReferenceMotionClip.Decode(BuildClip());

            Assert.That(clip.RootLocked, Is.True);
            Assert.That(clip.SampleRate, Is.EqualTo(60));
            Assert.That(clip.FrameCount, Is.EqualTo(3));
            Assert.That(clip.BoneCount, Is.EqualTo(29));
            Assert.That(clip.DurationMilliseconds, Is.EqualTo(33));
            Assert.That(clip.MarkerCount, Is.EqualTo(3));
            Assert.That(clip.TryGetMarker(
                ProductionReferenceMotionMarkerKind.TechnicalActionPeak, out var peak), Is.True);
            Assert.That(peak.Frame, Is.EqualTo(1));
            Assert.That(peak.TimeSeconds, Is.EqualTo(1d / 60d).Within(0.0000001d));
            Assert.That(peak.Confidence, Is.EqualTo(32768f / 65535f).Within(0.00001f));
        }

        [Test]
        public void SampleAtCanonicalTime_IsStatelessAndRenderCadenceIndependent()
        {
            var clip = ProductionReferenceMotionClip.Decode(BuildClip());
            var fromThirtyHertzCadence = new Quaternion[29];
            var fromSixtyHertzCadence = new Quaternion[29];
            var intermediate = new Quaternion[29];

            // A 30 Hz caller arrives at 1/30 s in one tick. A 60 Hz caller samples an intermediate pose first.
            clip.SampleAtCanonicalTime(1d / 30d, fromThirtyHertzCadence);
            clip.SampleAtCanonicalTime(1d / 60d, intermediate);
            clip.SampleAtCanonicalTime(2d / 60d, fromSixtyHertzCadence);

            for (var bone = 0; bone < 29; bone++)
                Assert.That(Quaternion.Angle(fromThirtyHertzCadence[bone], fromSixtyHertzCadence[bone]),
                    Is.LessThan(0.0001f));

            Assert.That(Quaternion.Angle(
                Quaternion.Euler(0f, 90f, 0f),
                fromThirtyHertzCadence[(int)ProductionReferenceMotionBone.Chest]),
                Is.LessThan(0.02f));
        }

        [Test]
        public void SampleAtCanonicalTime_ClampsAndRejectsInvalidDestinationOrTime()
        {
            var clip = ProductionReferenceMotionClip.Decode(BuildClip());
            var first = new Quaternion[29];
            var last = new Quaternion[29];
            clip.SampleAtCanonicalTime(-100d, first);
            clip.SampleAtCanonicalTime(100d, last);

            Assert.That(Quaternion.Angle(Quaternion.identity, first[(int)ProductionReferenceMotionBone.Chest]),
                Is.LessThan(0.001f));
            Assert.That(Quaternion.Angle(Quaternion.Euler(0f, 90f, 0f),
                last[(int)ProductionReferenceMotionBone.Chest]), Is.LessThan(0.02f));
            Assert.That(() => clip.SampleAtCanonicalTime(0d, new Quaternion[28]),
                Throws.ArgumentException);
            Assert.That(() => clip.SampleAtCanonicalTime(double.NaN, new Quaternion[29]),
                Throws.TypeOf<ArgumentOutOfRangeException>());
        }

        [Test]
        public void Decode_RejectsRootAuthorityOrNonZeroRootTranslation()
        {
            var unlocked = BuildClip();
            WriteUInt32(unlocked, 8, 0);
            Assert.That(() => ProductionReferenceMotionClip.Decode(unlocked),
                Throws.InvalidOperationException.With.Message.Contains("root locked"));

            var translated = BuildClip();
            translated[HeaderBytes + BoneBytes] = 1;
            Assert.That(() => ProductionReferenceMotionClip.Decode(translated),
                Throws.InvalidOperationException.With.Message.Contains("root translation"));
        }

        [Test]
        public void Decode_RejectsReferenceMotionOutsideTheSixtyFpsHeroContract()
        {
            var clip = BuildClip();
            WriteUInt16(clip, 12, 30);

            Assert.That(() => ProductionReferenceMotionClip.Decode(clip),
                Throws.InvalidOperationException.With.Message.Contains("60 fps"));
        }

        [Test]
        public void Decode_RejectsHierarchyQuaternionMarkerAndLengthCorruption()
        {
            var hierarchy = BuildClip();
            WriteInt16(hierarchy, HeaderBytes + 8 + 2, -1); // semantic bone 1 becomes a second root
            Assert.That(() => ProductionReferenceMotionClip.Decode(hierarchy),
                Throws.InvalidOperationException.With.Message.Contains("hierarchy"));

            var quaternion = BuildClip();
            var firstQuaternion = HeaderBytes + BoneBytes + 6;
            for (var index = 0; index < 8; index++) quaternion[firstQuaternion + index] = 0;
            Assert.That(() => ProductionReferenceMotionClip.Decode(quaternion),
                Throws.InvalidOperationException.With.Message.Contains("rotation"));

            var marker = BuildClip();
            var markerStart = HeaderBytes + BoneBytes + 3 * FrameBytes;
            WriteUInt16(marker, markerStart + 2, 1);
            Assert.That(() => ProductionReferenceMotionClip.Decode(marker),
                Throws.InvalidOperationException.With.Message.Contains("boundary marker"));

            var valid = BuildClip();
            var truncated = new byte[valid.Length - 1];
            Array.Copy(valid, truncated, truncated.Length);
            Assert.That(() => ProductionReferenceMotionClip.Decode(truncated),
                Throws.InvalidOperationException.With.Message.Contains("byte length"));
        }

        internal static byte[] BuildClip(
            ProductionReferenceMotionBone animatedBone = ProductionReferenceMotionBone.Chest)
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'M', (byte)'A', (byte)'1' });
                writer.Write((ushort)1);
                writer.Write((ushort)64);
                writer.Write((uint)1);
                writer.Write((ushort)60);
                writer.Write((ushort)29);
                writer.Write((uint)3);
                writer.Write((ushort)3);
                writer.Write((ushort)8);
                writer.Write((ushort)8);
                writer.Write((ushort)8);
                writer.Write((uint)33);
                for (var index = 1; index <= 16; index++) writer.Write((byte)index);
                writer.Write(0x8877665544332211UL);
                writer.Write(0.001f);
                writer.Write((uint)FrameBytes);

                var parents = new short[]
                {
                    -1, 0, 1, 2, 3, 4, 5,
                    3, 7, 8, 9, 10, 11, 10,
                    3, 14, 15, 16, 17, 18, 17,
                    0, 21, 22, 23,
                    0, 25, 26, 27
                };
                for (var bone = 0; bone < 29; bone++)
                {
                    writer.Write((ushort)bone);
                    writer.Write(parents[bone]);
                    writer.Write((ushort)bone);
                    writer.Write((ushort)(bone == 0 ? 1 : 0));
                }

                for (var frame = 0; frame < 3; frame++)
                {
                    writer.Write((short)0);
                    writer.Write((short)0);
                    writer.Write((short)0);
                    for (var bone = 0; bone < 29; bone++)
                    {
                        var angle = bone == (int)animatedBone
                            ? frame * 45f
                            : 0f;
                        WriteQuantized(writer, Quaternion.Euler(0f, angle, 0f));
                    }
                }

                WriteMarker(writer, ProductionReferenceMotionMarkerKind.ClipStart, 0, ushort.MaxValue);
                WriteMarker(writer, ProductionReferenceMotionMarkerKind.TechnicalActionPeak, 1, 32768);
                WriteMarker(writer, ProductionReferenceMotionMarkerKind.ClipEnd, 2, ushort.MaxValue);
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static void WriteQuantized(BinaryWriter writer, Quaternion value)
        {
            writer.Write((short)Mathf.RoundToInt(value.x * 32767f));
            writer.Write((short)Mathf.RoundToInt(value.y * 32767f));
            writer.Write((short)Mathf.RoundToInt(value.z * 32767f));
            writer.Write((short)Mathf.RoundToInt(value.w * 32767f));
        }

        private static void WriteMarker(
            BinaryWriter writer,
            ProductionReferenceMotionMarkerKind kind,
            ushort frame,
            ushort confidence)
        {
            writer.Write((ushort)kind);
            writer.Write(frame);
            writer.Write(confidence);
            writer.Write((ushort)0);
        }

        private static void WriteUInt16(byte[] bytes, int offset, ushort value)
        {
            bytes[offset] = (byte)value;
            bytes[offset + 1] = (byte)(value >> 8);
        }

        private static void WriteInt16(byte[] bytes, int offset, short value)
        {
            WriteUInt16(bytes, offset, unchecked((ushort)value));
        }

        private static void WriteUInt32(byte[] bytes, int offset, uint value)
        {
            bytes[offset] = (byte)value;
            bytes[offset + 1] = (byte)(value >> 8);
            bytes[offset + 2] = (byte)(value >> 16);
            bytes[offset + 3] = (byte)(value >> 24);
        }
    }
}
