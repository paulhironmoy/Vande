using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    public sealed class ProductionBatterAddressLifeTests
    {
        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void AddressBreath_IsReadableBoundedPlantedAndFocused(
            ProductionCharacterHandedness handedness)
        {
            var neutral = Sample(ProductionCharacterMotion.BatterStance, 0f, handedness);
            var inhale = Sample(ProductionCharacterMotion.BatterStance, 0.25f, handedness);
            var exhale = Sample(ProductionCharacterMotion.BatterStance, 0.75f, handedness);
            var loopEnd = Sample(ProductionCharacterMotion.BatterStance, 1f, handedness);

            Assert.That(inhale.RootOffset.y, Is.EqualTo(neutral.RootOffset.y).Within(0.000001f));
            Assert.That(exhale.RootOffset.y, Is.EqualTo(neutral.RootOffset.y).Within(0.000001f));
            Assert.That(inhale.RootOffset.z, Is.EqualTo(neutral.RootOffset.z).Within(0.000001f));
            Assert.That(exhale.RootOffset.z, Is.EqualTo(neutral.RootOffset.z).Within(0.000001f));
            Assert.That(Vector3.Distance(loopEnd.RootOffset, neutral.RootOffset), Is.LessThan(0.000001f));

            var spineTravel = Quaternion.Angle(
                inhale.Rotation(ProductionCharacterJoint.Spine),
                exhale.Rotation(ProductionCharacterJoint.Spine));
            var chestTravel = Quaternion.Angle(
                inhale.Rotation(ProductionCharacterJoint.Chest),
                exhale.Rotation(ProductionCharacterJoint.Chest));
            Assert.That(spineTravel, Is.InRange(0.85f, 0.95f),
                "the sternum needs a visible but restrained spinal breath");
            Assert.That(chestTravel, Is.InRange(1.75f, 1.95f),
                "the chest needs readable expansion without decorative heaving");

            AssertDownPitchFocus(neutral, handedness, 0f);
            AssertDownPitchFocus(inhale, handedness, 0.25f);
            AssertDownPitchFocus(exhale, handedness, 0.75f);
            AssertDownPitchFocus(loopEnd, handedness, 1f);

            var joints = new[]
            {
                ProductionCharacterJoint.Spine,
                ProductionCharacterJoint.Chest,
                ProductionCharacterJoint.Neck,
                ProductionCharacterJoint.Head
            };
            for (var index = 0; index < joints.Length; index++)
            {
                Assert.That(Quaternion.Angle(
                        neutral.Rotation(joints[index]),
                        loopEnd.Rotation(joints[index])),
                    Is.LessThan(0.001f), joints[index] + " must close the deterministic address loop");
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void AddressLoop_StartsAtTheExactStrokeReadyPose(
            ProductionCharacterHandedness handedness)
        {
            var stance = Sample(ProductionCharacterMotion.BatterStance, 0f, handedness);
            var stroke = Sample(ProductionCharacterMotion.BatterStroke, 0f, handedness);

            Assert.That(Vector3.Distance(stance.RootOffset, stroke.RootOffset), Is.LessThan(0.000001f));
            Assert.That(Quaternion.Angle(stance.BatRotation, stroke.BatRotation), Is.LessThan(0.001f));
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
            {
                var value = (ProductionCharacterJoint)joint;
                Assert.That(Quaternion.Angle(stance.Rotation(value), stroke.Rotation(value)),
                    Is.LessThan(0.001f), value + " must not pop when a delivery becomes a stroke");
            }
        }

        private static ProductionCharacterPose Sample(
            ProductionCharacterMotion motion,
            float phase,
            ProductionCharacterHandedness handedness)
        {
            var pose = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(motion, phase, handedness, pose);
            return pose;
        }

        private static void AssertDownPitchFocus(
            ProductionCharacterPose pose,
            ProductionCharacterHandedness handedness,
            float phase)
        {
            var gaze = pose.Rotation(ProductionCharacterJoint.Hips) *
                       pose.Rotation(ProductionCharacterJoint.Spine) *
                       pose.Rotation(ProductionCharacterJoint.Chest) *
                       pose.Rotation(ProductionCharacterJoint.Neck) *
                       pose.Rotation(ProductionCharacterJoint.Head) * Vector3.forward;
            gaze.y = 0f;
            Assert.That(gaze.sqrMagnitude, Is.GreaterThan(0.99f));
            Assert.That(Vector3.Angle(Vector3.forward, gaze.normalized), Is.LessThan(12f),
                handedness + " gaze must remain on the bowler throughout address phase " + phase);
        }
    }
}
