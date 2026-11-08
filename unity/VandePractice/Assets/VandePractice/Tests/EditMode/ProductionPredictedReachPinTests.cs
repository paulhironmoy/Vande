using System;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UNITY-8 task B: the predicted committed bat is held within ProceduralPracticeWorld.PredictedBatReachDefaultMetres (0.64 m) of
    /// each hand's own shoulder (UNITY-7). The constant has a cliff just above it (0.68 m leaves the gloves 1.7 mm off the handle,
    /// 0.72 m leaves them 7.9 cm off), so it is tied here to the hero's MEASURED arm reach: the farthest a hand's grip target can
    /// be put from its shoulder, by the rig's own arm solve (shoulder girdle, upper arm, forearm, hand to the grip), with the
    /// glove still within 5 mm of it. A different skeleton or body scale moves that reach and fails these tests loudly, rather than
    /// letting the gloves leave the handle on a low ball.
    /// </summary>
    public sealed class ProductionPredictedReachPinTests
    {
        /// <summary>The clamp must sit at least this far inside the measured reach (m): room for the lean and a skeleton rounding.</summary>
        private const float MinimumMarginMetres = 0.02f;

        /// <summary>... and not so far inside it (m) that the constant has stopped following the arm (a stale, too short constant).</summary>
        private const float MaximumMarginMetres = 0.12f;

        /// <summary>A glove counts as on the handle within this (m): the hands-on-the-bat gate (5 mm).</summary>
        private const float GloveToleranceMetres = 0.005f;

        /// <summary>Directions (from the shoulder, in the world: the striker faces -z) the swing's hands are held in: the ball's contact is in front and low.</summary>
        private static readonly Vector3[] Directions =
        {
            new Vector3(0f, -0.60f, -0.80f).normalized,
            new Vector3(0f, -0.20f, -0.98f).normalized,
            new Vector3(0.35f, -0.65f, -0.67f).normalized,
            new Vector3(-0.35f, -0.65f, -0.67f).normalized
        };

        private sealed class Measured
        {
            public float MinimumMetres = float.MaxValue;
            public string MinimumAt = "";
            public float MaximumMetres;
        }

        private static ProductionCharacterRig NewBatter(GameObject host, ProductionCharacterHandedness handedness)
        {
            var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
            spec.Handedness = handedness;
            var rig = ProductionCharacterFactory.Create(host.transform, spec);
            rig.Root.SetPositionAndRotation(new Vector3(0f, 0f, 9.25f), Quaternion.Euler(0f, 180f, 0f));
            return rig;
        }

        /// <summary>The gap (m) of one glove from its grip target with that hand's target put `distance` from its shoulder along `direction`.</summary>
        private static float GloveGap(ProductionCharacterRig rig, bool left, Vector3 direction, float distance)
        {
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
            var shoulder = rig.HeroJointWorldPosition(left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
            var topIsLeft = rig.Handedness == ProductionCharacterHandedness.Right;
            var offset = left == topIsLeft
                ? ProductionCharacterRig.BatterTopHandGripOffsetMetres
                : ProductionCharacterRig.BatterLowerHandGripOffsetMetres;
            var target = shoulder + direction * distance;
            var down = Vector3.down;
            var grip = target - down * offset;
            var toe = grip + down * (float)BridgeConstants.CanonicalBatLengthMetres;
            rig.SetCanonicalBatPose(grip, toe, Vector3.forward, 1f, retargetBodyToTrace: false, applyBatterNeckClearance: false);
            return Vector3.Distance(rig.HeroHandWorldPosition(left), rig.HeroBatterGripTargetWorld(left));
        }

        /// <summary>The largest distance (m) at which the glove is within tolerance of its target, by bisection (the gap grows with the distance).</summary>
        private static float ReachOf(ProductionCharacterRig rig, bool left, Vector3 direction)
        {
            float low = 0.40f, high = 0.95f;
            if (GloveGap(rig, left, direction, low) > GloveToleranceMetres) return low;
            if (GloveGap(rig, left, direction, high) <= GloveToleranceMetres) return high;
            for (var step = 0; step < 24; step++)
            {
                var middle = 0.5f * (low + high);
                if (GloveGap(rig, left, direction, middle) <= GloveToleranceMetres) low = middle;
                else high = middle;
            }
            return low;
        }

        private static Measured Measure(ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("predicted-reach-pin-" + handedness);
            ProductionCharacterRig rig = null;
            try
            {
                rig = NewBatter(host, handedness);
                var measured = new Measured();
                foreach (var left in new[] { true, false })
                    for (var index = 0; index < Directions.Length; index++)
                    {
                        var reach = ReachOf(rig, left, Directions[index]);
                        if (reach < measured.MinimumMetres)
                        {
                            measured.MinimumMetres = reach;
                            measured.MinimumAt = (left ? "left" : "right") + " glove, direction " + index;
                        }
                        measured.MaximumMetres = Mathf.Max(measured.MaximumMetres, reach);
                    }
                TestContext.WriteLine("measured arm reach (" + handedness + " rig): min " + measured.MinimumMetres.ToString("0.0000") + " m at " +
                                      measured.MinimumAt + ", max " + measured.MaximumMetres.ToString("0.0000") + " m; the clamp is " +
                                      ProceduralPracticeWorld.PredictedBatReachDefaultMetres.ToString("0.000") + " m; usable chain (to the wrist) " +
                                      rig.HeroBatterArmUsableReach(true).ToString("0.0000") + " m");
                return measured;
            }
            finally
            {
                if (rig != null) rig.Dispose();
                UnityEngine.Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void TheClamp_SitsInsideTheMeasuredArmReachByAtLeastTheStatedMargin(ProductionCharacterHandedness handedness)
        {
            var measured = Measure(handedness);
            Assert.That(ProceduralPracticeWorld.PredictedBatReachDefaultMetres,
                Is.LessThanOrEqualTo(measured.MinimumMetres - MinimumMarginMetres),
                "the predicted bat's reach clamp " + ProceduralPracticeWorld.PredictedBatReachDefaultMetres + " m must be at least " +
                MinimumMarginMetres + " m inside the farthest the hero's gloves still reach their grip targets (" +
                measured.MinimumMetres.ToString("0.0000") + " m at the " + measured.MinimumAt + "): the skeleton or its scale changed, " +
                "retune ProceduralPracticeWorld.PredictedBatReachDefaultMetres or the gloves leave the handle on a low ball");
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void TheClamp_StillFollowsTheArm_NotMoreThanTheStatedMarginInside(ProductionCharacterHandedness handedness)
        {
            var measured = Measure(handedness);
            Assert.That(ProceduralPracticeWorld.PredictedBatReachDefaultMetres,
                Is.GreaterThanOrEqualTo(measured.MinimumMetres - MaximumMarginMetres),
                "the clamp is more than " + MaximumMarginMetres + " m inside the measured reach (" + measured.MinimumMetres.ToString("0.0000") +
                " m): the arm has grown, so the constant is stale and the committed bat is held further from the ball than it need be");
        }

        [Test]
        public void TheMeasurement_Control_AGlovePutBeyondTheMeasuredReachIsOffTheHandle()
        {
            // The measurement means what it says: a target 4 cm beyond the farthest reached is off the handle by more than the tolerance.
            var host = new GameObject("predicted-reach-pin-control");
            ProductionCharacterRig rig = null;
            try
            {
                rig = NewBatter(host, ProductionCharacterHandedness.Right);
                var direction = Directions[0];
                var reach = ReachOf(rig, true, direction);
                Assert.That(reach, Is.InRange(0.45f, 0.94f), "the bisection found a reach inside its bracket");
                Assert.That(GloveGap(rig, true, direction, reach), Is.LessThanOrEqualTo(GloveToleranceMetres));
                Assert.That(GloveGap(rig, true, direction, reach + 0.04f), Is.GreaterThan(GloveToleranceMetres));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                UnityEngine.Object.DestroyImmediate(host);
            }
        }
    }
}
