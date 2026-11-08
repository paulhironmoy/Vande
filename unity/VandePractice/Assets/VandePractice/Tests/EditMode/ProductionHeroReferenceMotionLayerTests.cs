using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    public sealed class ProductionHeroReferenceMotionLayerTests
    {
        [Test]
        public void RunUpBlend_IsBoundedRootLockedAndFadesCompletelyByGather()
        {
            var host = new GameObject("run-up reference test");
            var drivers = BuildDrivers(host.transform);
            ProductionHeroSkeletonInstance skeleton = null;
            try
            {
                skeleton = new ProductionHeroSkeletonInstance(
                    host.transform, ProductionHeroSkeletonDefinition.Decode(BuildSkeleton()));
                var clip = ProductionReferenceMotionClip.Decode(
                    ProductionReferenceMotionClipTests.BuildClip(
                        ProductionReferenceMotionBone.UpperLegLeft));
                var layer = new ProductionHeroReferenceMotionLayer(
                    ProductionCharacterRole.PaceBowler,
                    ProductionCharacterHandedness.Right,
                    clip);

                skeleton.Synchronize(drivers);
                var canonicalLeg = skeleton.Bones[65].localRotation;
                layer.Apply(skeleton, ProductionCharacterMotion.PaceBowling, 0.20f);
                var blendedLeg = skeleton.Bones[65].localRotation;
                Assert.That(Quaternion.Angle(canonicalLeg, blendedLeg), Is.GreaterThan(1f));
                Assert.That(ProductionHeroReferenceMotionLayer.RunUpWeight(0.20f),
                    Is.LessThanOrEqualTo(ProductionHeroReferenceMotionLayer.MaximumRunUpBlend));
                Assert.That(skeleton.Bones[0].localPosition, Is.EqualTo(Vector3.zero),
                    "root-locked motion must not translate the hero skeleton");

                skeleton.Synchronize(drivers);
                layer.Apply(skeleton, ProductionCharacterMotion.PaceBowling,
                    ProductionCharacterMotionSampler.PaceGather);
                Assert.That(Quaternion.Angle(canonicalLeg, skeleton.Bones[65].localRotation),
                    Is.LessThan(0.001f), "CMU run reference must be gone before the authored gather/release");
                Assert.That(ProductionHeroReferenceMotionLayer.RunUpWeight(
                    ProductionCharacterMotionSampler.PaceGather), Is.Zero);
            }
            finally
            {
                if (skeleton != null) skeleton.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void ReferenceBlend_IsDeterministicAtTheSameCanonicalTimeAndAnimatesSecondaryBones()
        {
            var host = new GameObject("deterministic reference test");
            var drivers = BuildDrivers(host.transform);
            ProductionHeroSkeletonInstance skeleton = null;
            try
            {
                skeleton = new ProductionHeroSkeletonInstance(
                    host.transform, ProductionHeroSkeletonDefinition.Decode(BuildSkeleton()));
                var layer = new ProductionHeroReferenceMotionLayer(
                    ProductionCharacterRole.PaceBowler,
                    ProductionCharacterHandedness.Right,
                    ProductionReferenceMotionClip.Decode(
                        ProductionReferenceMotionClipTests.BuildClip(
                            ProductionReferenceMotionBone.UpperLegLeft)));

                skeleton.Synchronize(drivers);
                var fingerRest = skeleton.Bones[31].localRotation;
                layer.Apply(skeleton, ProductionCharacterMotion.PaceBowling, 0.20f);
                var firstLeg = skeleton.Bones[65].localRotation;
                var firstFinger = skeleton.Bones[31].localRotation;

                skeleton.Synchronize(drivers);
                layer.Apply(skeleton, ProductionCharacterMotion.PaceBowling, 0.20f);
                Assert.That(Quaternion.Angle(firstLeg, skeleton.Bones[65].localRotation),
                    Is.LessThan(0.0001f));
                Assert.That(Quaternion.Angle(firstFinger, skeleton.Bones[31].localRotation),
                    Is.LessThan(0.0001f));
                Assert.That(Quaternion.Angle(fingerRest, firstFinger), Is.GreaterThan(0.1f),
                    "secondary grip bones should no longer remain frozen at bind pose");
            }
            finally
            {
                if (skeleton != null) skeleton.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void BattingBlend_ChangesOnlyBoundedCoreAndLegPresentation_NotAuthoredArms()
        {
            var host = new GameObject("batting weight reference test");
            var drivers = BuildDrivers(host.transform);
            drivers[(int)ProductionCharacterJoint.UpperArmLeft].localRotation =
                Quaternion.Euler(14f, 23f, -9f);
            ProductionHeroSkeletonInstance skeleton = null;
            try
            {
                skeleton = new ProductionHeroSkeletonInstance(
                    host.transform, ProductionHeroSkeletonDefinition.Decode(BuildSkeleton()));
                var layer = new ProductionHeroReferenceMotionLayer(
                    ProductionCharacterRole.Batter,
                    ProductionCharacterHandedness.Right,
                    ProductionReferenceMotionClip.Decode(
                        ProductionReferenceMotionClipTests.BuildClip(
                            ProductionReferenceMotionBone.UpperLegLeft)));

                skeleton.Synchronize(drivers);
                var arm = skeleton.Bones[15].localRotation;
                var leg = skeleton.Bones[65].localRotation;
                layer.Apply(skeleton, ProductionCharacterMotion.BatterStroke, 0.50f);

                Assert.That(Quaternion.Angle(arm, skeleton.Bones[15].localRotation),
                    Is.LessThan(0.0001f), "reference batting must not replace authored arms/bat timing");
                Assert.That(Quaternion.Angle(leg, skeleton.Bones[65].localRotation), Is.GreaterThan(0.1f));
                Assert.That(ProductionHeroReferenceMotionLayer.BattingWeight(0.50f),
                    Is.LessThanOrEqualTo(ProductionHeroReferenceMotionLayer.MaximumBattingBlend));
                Assert.That(ProductionHeroReferenceMotionLayer.BattingWeight(1f), Is.Zero);
            }
            finally
            {
                if (skeleton != null) skeleton.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void OptionalResourceAdmission_UsesExactKeysAndFailsClosed()
        {
            string requested = null;
            var missing = ProductionHeroReferenceMotionLayer.TryCreate(
                ProductionCharacterRole.Batter,
                ProductionCharacterHandedness.Right,
                key =>
                {
                    requested = key;
                    return null;
                });
            Assert.That(missing, Is.Null);
            Assert.That(requested, Is.EqualTo("ProductionCharacters/motion-batting-weight"));

            requested = null;
            var corrupt = ProductionHeroReferenceMotionLayer.TryCreate(
                ProductionCharacterRole.PaceBowler,
                ProductionCharacterHandedness.Right,
                key =>
                {
                    requested = key;
                    return new TextAsset("not VMA1");
                });
            Assert.That(corrupt, Is.Null);
            Assert.That(requested, Is.EqualTo("ProductionCharacters/motion-runup"));
            Assert.That(ProductionHeroReferenceMotionLayer.TryCreate(
                ProductionCharacterRole.SpinBowler,
                ProductionCharacterHandedness.Right,
                _ => throw new AssertionException("spinner must not request the pace reference")), Is.Null);
        }

        private static Transform[] BuildDrivers(Transform parent)
        {
            var drivers = new Transform[(int)ProductionCharacterJoint.Count];
            for (var index = 0; index < drivers.Length; index++)
            {
                var value = new GameObject("driver-" + index);
                value.transform.SetParent(parent, false);
                drivers[index] = value.transform;
            }
            return drivers;
        }

        private static byte[] BuildSkeleton()
        {
            var semanticByBone = new ushort[75];
            for (var index = 0; index < semanticByBone.Length; index++)
                semanticByBone[index] = ushort.MaxValue;
            semanticByBone[3] = 0;
            semanticByBone[5] = 1;
            semanticByBone[7] = 2;
            semanticByBone[8] = 3;
            semanticByBone[11] = 4;
            semanticByBone[15] = 5;
            semanticByBone[17] = 6;
            semanticByBone[19] = 7;
            semanticByBone[22] = 8;
            semanticByBone[24] = 9;
            semanticByBone[26] = 10;
            semanticByBone[65] = 11;
            semanticByBone[67] = 12;
            semanticByBone[69] = 13;
            semanticByBone[70] = 14;
            semanticByBone[72] = 15;
            semanticByBone[74] = 16;

            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'S', (byte)'K', (byte)'1' });
                writer.Write((ushort)1);
                writer.Write((ushort)75);
                writer.Write((ushort)32);
                writer.Write((ushort)0);
                writer.Write((uint)0);
                writer.Write(0x8877665544332211UL);
                writer.Write((ulong)0);
                for (var index = 0; index < 75; index++)
                {
                    writer.Write((short)(index == 0 ? -1 : 0));
                    writer.Write(semanticByBone[index]);
                    writer.Write(0f);
                    writer.Write(index == 0 ? 0f : 0.01f * index);
                    writer.Write(0f);
                    writer.Write(0f);
                    writer.Write(0f);
                    writer.Write(0f);
                    writer.Write(1f);
                }
                writer.Flush();
                return stream.ToArray();
            }
        }
    }
}
