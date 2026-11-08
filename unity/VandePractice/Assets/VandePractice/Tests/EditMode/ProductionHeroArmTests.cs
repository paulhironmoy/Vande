using System;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UNITY-4 H2: the visible hero's batter arm is solved as a hinge (the forearm turns about its own X within MOTION-SPEC
    /// section 9's elbow range, the upper arm's twist within its range) with the elbow's plane continuous from the frame before
    /// (the web's ElbowMemory), and the torso turns no faster than section 9 allows (the governor). Each test pairs the rule with
    /// a control that shows the old behaviour would fail it.
    /// </summary>
    public sealed class ProductionHeroArmTests
    {
        private const double Step = 1.0 / 60.0;

        private GameObject host;
        private ProductionCharacterRig rig;
        private ProductionHeroSkeletonInstance skeleton;

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("hero-arm-test");
            var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
            spec.Handedness = ProductionCharacterHandedness.Right;
            rig = ProductionCharacterFactory.Create(host.transform, spec);
            rig.Root.SetPositionAndRotation(new Vector3(0f, 0f, 9.25f), Quaternion.Euler(0f, 180f, 0f));
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);
            skeleton = rig.VisibleHeroSkeleton;
            Assert.That(skeleton, Is.Not.Null, "these tests need the complete hero skeleton");
        }

        [TearDown]
        public void TearDown()
        {
            if (rig != null) rig.Dispose();
            Object.DestroyImmediate(host);
        }

        // ---- The retarget the canonical reading rests on ------------------------------------------------------------------

        [Test]
        public void HeroArmBones_RestAtTheIdentity_AndTheirALimbBonesCarryAnAPoseCorrection()
        {
            // ProductionHeroArm.Read leaves the VSK1 rest rotations out because they are the identity; the upper arm, the forearm
            // and the hand are the bones whose A-pose the canonical retarget corrects.
            //
            // UNITY-5: this test used to pin the HAND at no correction (the hand's frame is the forearm's). That pinned the
            // retarget defect: with the parent limb's correction left in and none of its own, a canonical-zero hand hung with its
            // bone frame, not its fingers, along the forearm (61.4 degrees off it). The hand now carries the turn of its long
            // axis (wrist to the middle finger, HandRestDirection) to local down, as the limbs above it turn their child's
            // direction; the expectation for the hand is that, in place of the identity. The twist bones between the limbs stay
            // at the identity (the undo of the parent's correction relies on it).
            foreach (var left in new[] { true, false })
            foreach (var joint in new[] { ProductionHeroArm.UpperJoint(left), ProductionHeroArm.ForearmJoint(left), ProductionHeroArm.HandJoint(left) })
            {
                Quaternion rest, correction;
                skeleton.RestFramesOf(joint, out rest, out correction);
                Assert.That(Quaternion.Angle(Quaternion.identity, rest), Is.LessThan(0.001f), joint + " rest rotation");
                Assert.That(Quaternion.Angle(Quaternion.identity, correction), Is.GreaterThan(20f), joint + " A-pose correction");
                if (joint == ProductionHeroArm.HandJoint(left))
                    Assert.That(Vector3.Angle(correction * skeleton.HandRestDirection(left), Vector3.down), Is.LessThan(0.01f),
                        "the hand's correction takes its long axis to local down");
            }
            Synchronize(IdentityDrivers());
            foreach (var left in new[] { true, false })
            foreach (var joint in new[] { ProductionHeroArm.ForearmJoint(left), ProductionHeroArm.HandJoint(left) })
            {
                var parent = skeleton.BoneOf(joint).parent;
                Assert.That(Quaternion.Angle(Quaternion.identity, parent.localRotation), Is.LessThan(0.001f),
                    joint + "'s twist bone (" + parent.name + ") rests at the identity");
            }
        }

        [Test]
        public void Retarget_ACanonicalZeroArmHangsStraight_AndTheOldFormulaLeftItBent()
        {
            // UNITY-5, F1: the canonical zero pose (every driver rotation the identity) is a straight arm: the forearm along the
            // upper arm and the hand's long axis along the forearm (within 1 degree). Before the fix Synchronize wrote
            // rest * canonical * correction without undoing the parent's correction: the forearm stood 39.4 degrees off the
            // upper arm. The control builds that old pose from the same rest frames.
            var drivers = IdentityDrivers();
            foreach (var left in new[] { true, false })
            {
                Synchronize(drivers);
                float elbow, wrist;
                ArmStraightness(left, out elbow, out wrist);
                Assert.That(elbow, Is.LessThan(1f), (left ? "left" : "right") + " forearm against the upper arm");
                Assert.That(wrist, Is.LessThan(1f), (left ? "left" : "right") + " hand's long axis against the forearm");
                var arm = ProductionHeroArm.Read(skeleton, left);
                Assert.That(Quaternion.Angle(Quaternion.identity, arm.Forearm), Is.LessThan(0.5f), "the forearm reads back as the canonical zero");
                Assert.That(Quaternion.Angle(Quaternion.identity, arm.Hand), Is.LessThan(0.5f), "the hand reads back as the canonical zero");

                PoseLikeBefore(left, Quaternion.identity, Quaternion.identity, Quaternion.identity);
                ArmStraightness(left, out elbow, out wrist);
                Assert.That(elbow, Is.GreaterThan(30f), "control: the old formula's forearm stood about 39 degrees off the upper arm");
                Assert.That(wrist, Is.GreaterThan(8f), "control: and its hand was bent against the forearm");
            }
        }

        [Test]
        public void Retarget_GivesBackTheCanonicalRotationOfEveryArmBone_WhateverItsParentDoes()
        {
            // The inverse of Synchronize on the arm bones is the canonical rotation it was given, for a upper arm swung and twisted,
            // an elbow bent and a wrist turned (the parent's correction does not leak into the child).
            var upper = Quaternion.Euler(-40f, 25f, 30f);
            var forearm = Quaternion.Euler(-70f, 0f, 0f);
            var hand = Quaternion.Euler(20f, 10f, -15f);
            foreach (var left in new[] { true, false })
            {
                var drivers = IdentityDrivers();
                drivers[(int)ProductionHeroArm.UpperJoint(left)].localRotation = upper;
                drivers[(int)ProductionHeroArm.ForearmJoint(left)].localRotation = forearm;
                drivers[(int)ProductionHeroArm.HandJoint(left)].localRotation = hand;
                Synchronize(drivers);
                var arm = ProductionHeroArm.Read(skeleton, left);
                Assert.That(Quaternion.Angle(upper, arm.UpperVsShoulder), Is.LessThan(0.1f), "upper arm");
                Assert.That(Quaternion.Angle(forearm, arm.Forearm), Is.LessThan(0.1f), "forearm in the upper arm's canonical frame");
                Assert.That(Quaternion.Angle(forearm, arm.ForearmSynchronized), Is.LessThan(0.1f), "forearm, the plain inverse of Synchronize");
                Assert.That(Quaternion.Angle(hand, arm.Hand), Is.LessThan(0.1f), "hand in the forearm's canonical frame");
                float bend, wrist;
                ArmStraightness(left, out bend, out wrist);
                Assert.That(bend, Is.EqualTo(70f).Within(1f), "an elbow bent 70 degrees in the canonical frame is bent 70 degrees on the hero");

                PoseLikeBefore(left, upper, forearm, hand);
                var old = ProductionHeroArm.Read(skeleton, left);
                Assert.That(Quaternion.Angle(forearm, old.Forearm), Is.GreaterThan(20f),
                    "control: the old formula's forearm read back as the canonical one turned by the upper arm's correction");
            }
        }

        private Transform[] IdentityDrivers()
        {
            var drivers = new Transform[(int)ProductionCharacterJoint.Count];
            for (var index = 0; index < drivers.Length; index++)
            {
                var driver = new GameObject("driver-" + index).transform;
                driver.SetParent(host.transform, false);
                drivers[index] = driver;
            }
            return drivers;
        }

        private void Synchronize(Transform[] drivers)
        {
            skeleton.Synchronize(drivers);
        }

        /// <summary>The bend (degrees) at the elbow (upper arm to forearm direction) and the hand's long axis against the forearm's direction.</summary>
        private void ArmStraightness(bool left, out float elbow, out float wrist)
        {
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).position;
            var elbowAt = skeleton.BoneOf(ProductionHeroArm.ForearmJoint(left)).position;
            var hand = skeleton.BoneOf(ProductionHeroArm.HandJoint(left));
            elbow = Vector3.Angle(elbowAt - shoulder, hand.position - elbowAt);
            wrist = Vector3.Angle(hand.position - elbowAt, hand.rotation * skeleton.HandRestDirection(left));
        }

        /// <summary>
        /// The arm as the retarget wrote it before UNITY-5: rest * canonical * correction for each limb bone, the parent's
        /// correction not undone (and the hand's own none), from the skeleton's own rest frames.
        /// </summary>
        private void PoseLikeBefore(bool left, Quaternion upper, Quaternion forearm, Quaternion hand)
        {
            Quaternion rest, correction;
            skeleton.RestFramesOf(ProductionHeroArm.UpperJoint(left), out rest, out correction);
            skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).localRotation = rest * upper * correction;
            skeleton.RestFramesOf(ProductionHeroArm.ForearmJoint(left), out rest, out correction);
            skeleton.BoneOf(ProductionHeroArm.ForearmJoint(left)).localRotation = rest * forearm * correction;
            skeleton.RestFramesOf(ProductionHeroArm.HandJoint(left), out rest, out correction);
            skeleton.BoneOf(ProductionHeroArm.HandJoint(left)).localRotation = rest * hand;
        }

        // ---- The hinge ------------------------------------------------------------------------------------------------------

        [TestCase(true)]
        [TestCase(false)]
        public void Solve_PutsTheWristOnTheTargetWithAPureHingeForearm(bool left)
        {
            var count = 0;
            var relaxed = 0;
            foreach (var reach in new[] { 0.20f, 0.30f, 0.42f, 0.52f })
            foreach (var direction in Directions())
            foreach (var pole in Poles(left))
            {
                var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).position;
                var target = shoulder + direction.normalized * reach;
                var hand = rig.Root.rotation * Quaternion.Euler(20f, 10f, 0f);
                skeleton.SolveBatterArm(left, target, hand, pole);
                var label = (left ? "left" : "right") + " reach " + reach + " direction " + direction + " pole " + pole;

                Assert.That(Vector3.Distance(skeleton.BoneOf(ProductionHeroArm.HandJoint(left)).position, target),
                    Is.LessThan(0.001f), label + ": the wrist is on its target");
                var arm = ProductionHeroArm.Read(skeleton, left);
                Assert.That(Mathf.Abs(arm.Forearm.y), Is.LessThan(0.002f), label + ": no forearm twist");
                Assert.That(Mathf.Abs(arm.Forearm.z), Is.LessThan(0.002f), label + ": no sideways bend of the elbow");
                double x, z;
                EulerXZ(arm.Forearm, out x, out z);
                Assert.That(x, Is.GreaterThanOrEqualTo(ProductionHeroArm.ElbowMinDegrees - 0.1).And
                    .LessThanOrEqualTo(ProductionHeroArm.ElbowMaxDegrees + 0.1), label + ": the elbow's range (section 9)");
                double swing, twist;
                SwingTwist(arm.UpperVsChest, out swing, out twist);
                // The upper arm's twist binds for the hands a batter grips (from the hips to the face, 30 cm or more from the
                // shoulder). A hand pulled in to 20 cm, or held above the shoulder with the elbow folded on, can leave no
                // swivel inside the range (the hinge cannot roll the arm that far): the solve then keeps the least twist it finds.
                if (reach >= 0.3f && direction.y <= 0.3f)
                    Assert.That(Math.Abs(twist), Is.LessThanOrEqualTo(ProductionHeroArm.UpperArmTwistMaxDegrees + 0.5),
                        label + ": the upper arm's twist at swing " + swing.ToString("0.0"));
                else relaxed++;
                count++;
            }
            Assert.That(count, Is.GreaterThan(30));
            Assert.That(relaxed, Is.LessThan(count / 2), "most of the sweep is where the range binds");
        }

        [Test]
        public void Solve_DoesNotDependOnThePoseTheArmWasInBefore()
        {
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(true)).position;
            var target = shoulder + rig.Root.TransformDirection(new Vector3(0.1f, -0.2f, 0.3f)).normalized * 0.4f;
            var hand = rig.Root.rotation * Quaternion.Euler(10f, 0f, 15f);
            var pole = rig.Root.TransformDirection(new Vector3(0.5f, -0.5f, 0.2f));
            var bones = new[]
            {
                skeleton.BoneOf(ProductionHeroArm.UpperJoint(true)),
                skeleton.BoneOf(ProductionHeroArm.ForearmJoint(true)),
                skeleton.BoneOf(ProductionHeroArm.HandJoint(true))
            };
            skeleton.SolveBatterArm(true, target, hand, pole);
            var first = new[] { bones[0].rotation, bones[1].rotation, bones[2].rotation };
            // Throw the arm anywhere (the swing-only solve inherited its twist from here) and ask again.
            bones[0].rotation = Quaternion.Euler(140f, 80f, 200f);
            bones[1].rotation = Quaternion.Euler(10f, 250f, 90f);
            bones[2].rotation = Quaternion.Euler(300f, 20f, 40f);
            skeleton.SolveBatterArm(true, target, hand, pole);
            for (var index = 0; index < bones.Length; index++)
                Assert.That(Quaternion.Angle(first[index], bones[index].rotation), Is.LessThan(0.01f), bones[index].name);
        }

        [Test]
        public void Solve_FoldsTheElbowOnRatherThanLeaveTheBat()
        {
            // The bat held on the shoulder at the finish of a stroke: a grip 11 cm from the shoulder needs more than the
            // section 9 elbow's 150 degrees; the hand stays on the bat, the elbow folds on to the stop.
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(true)).position;
            var target = shoulder + rig.Root.TransformDirection(new Vector3(0.2f, 0.4f, 0.8f)).normalized * 0.11f;
            skeleton.SolveBatterArm(true, target, rig.Root.rotation, rig.Root.TransformDirection(new Vector3(0.5f, -0.5f, 0f)));
            Assert.That(Vector3.Distance(skeleton.BoneOf(ProductionHeroArm.HandJoint(true)).position, target), Is.LessThan(0.002f));
            double x, z;
            EulerXZ(ProductionHeroArm.Read(skeleton, true).Forearm, out x, out z);
            Assert.That(x, Is.LessThan(ProductionHeroArm.ElbowMinDegrees), "folded on past the 150 degrees");
            Assert.That(x, Is.GreaterThanOrEqualTo(-ProductionHeroArm.ElbowFoldStopDegrees - 0.1));
        }

        [Test]
        public void Solve_TurnsTheGloveAboutTheHandleOnlyAndNeverMoreThanItsRange()
        {
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(true)).position;
            var hands = skeleton.BoneOf(ProductionHeroArm.HandJoint(true));
            var worst = 0f;
            foreach (var direction in Directions())
            foreach (var turn in new[] { 0f, 70f, 140f, 210f, 280f })
            {
                var target = shoulder + direction.normalized * 0.38f;
                var wanted = rig.Root.rotation * Quaternion.Euler(0f, turn, 25f);
                skeleton.SolveBatterArm(true, target, wanted, rig.Root.TransformDirection(new Vector3(0.5f, -0.5f, 0.2f)));
                var handle = wanted * Vector3.down;
                Assert.That(Vector3.Angle(hands.rotation * Vector3.down, handle), Is.LessThan(0.01f), "the handle's axis is the glove's -Y");
                Assert.That(Quaternion.Angle(wanted, hands.rotation), Is.LessThanOrEqualTo(ProductionHeroArm.GripRollMaxDegrees + 0.01f));
                var forearm = skeleton.BoneOf(ProductionHeroArm.ForearmJoint(true));
                var direction3 = (hands.position - forearm.position).normalized;
                var before = Vector3.Angle(direction3, wanted * skeleton.HandRestDirection(true));
                var after = Vector3.Angle(direction3, hands.rotation * skeleton.HandRestDirection(true));
                Assert.That(after, Is.LessThanOrEqualTo(Mathf.Max(before, ProductionHeroArm.WristSwingMaxDegrees) + 0.01f),
                    "turning the glove never bends the wrist further than it already was (or past its range)");
                worst = Mathf.Max(worst, Quaternion.Angle(wanted, hands.rotation));
            }
            Assert.That(worst, Is.GreaterThan(1f), "the sweep includes grips that need the glove turned");
        }

        // ---- The elbow's memory ---------------------------------------------------------------------------------------------

        [Test]
        public void Memory_KeepsTheElbowOnItsSideWhenThePoleSwingsOver_AndWithoutItTheElbowPops()
        {
            var withMemory = ElbowPlaneStepsAcrossAPoleSwing(true);
            var without = ElbowPlaneStepsAcrossAPoleSwing(false);
            Assert.That(without, Is.GreaterThan(90f),
                "control: solved from the pole alone, the elbow follows a pole that swings over in one frame");
            Assert.That(withMemory, Is.LessThan(25f),
                "with the elbow's memory the plane eases to the new pole at most " + ProductionHeroArm.HomeDegreesPerSecond +
                " degrees a second (3 a frame), and no faster than " + ProductionHeroArm.SwivelDegreesPerSecond + " where the twist range forces it");
        }

        /// <summary>The largest 60 Hz step (degrees) of the elbow's plane about the reach line when the pole swings over.</summary>
        private float ElbowPlaneStepsAcrossAPoleSwing(bool memory)
        {
            const bool left = true;
            skeleton.ArmMemoryEnabled = memory;
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).position;
            var target = shoulder + rig.Root.TransformDirection(new Vector3(0.05f, -0.25f, 0.8f)).normalized * 0.42f;
            var hand = rig.Root.rotation;
            var pole = rig.Root.TransformDirection(new Vector3(-0.6f, -0.6f, 0.1f));
            var largest = 0f;
            var previous = float.NaN;
            for (var frame = 0; frame < 24; frame++)
            {
                skeleton.ArmClockSeconds = 10.0 + frame * Step;
                skeleton.SolveBatterArm(left, target, hand, frame < 8 ? pole : -pole);
                var plane = ElbowPlaneDegrees(left);
                if (!float.IsNaN(previous)) largest = Mathf.Max(largest, Mathf.Abs(Mathf.DeltaAngle(previous, plane)));
                previous = plane;
            }
            return largest;
        }

        [Test]
        public void Memory_IsForgottenAcrossAGapOfMoreThanFiftyMilliseconds()
        {
            const bool left = true;
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).position;
            var target = shoulder + rig.Root.TransformDirection(new Vector3(0.05f, -0.25f, 0.8f)).normalized * 0.42f;
            var hand = rig.Root.rotation;
            var pole = rig.Root.TransformDirection(new Vector3(-0.6f, -0.6f, 0.1f));
            skeleton.ArmMemoryEnabled = true;
            for (var frame = 0; frame < 6; frame++)
            {
                skeleton.ArmClockSeconds = 20.0 + frame * Step;
                skeleton.SolveBatterArm(left, target, hand, pole);
            }
            var forearm = skeleton.BoneOf(ProductionHeroArm.ForearmJoint(left));
            // 0.1 s later (a seek, a stall) the other side's pole is taken as it comes.
            skeleton.ArmClockSeconds = 20.0 + 5 * Step + 0.1;
            skeleton.SolveBatterArm(left, target, hand, -pole);
            var afterGap = forearm.rotation;
            skeleton.ResetArmMemory();
            skeleton.ArmClockSeconds = double.NaN;
            skeleton.SolveBatterArm(left, target, hand, -pole);
            Assert.That(Quaternion.Angle(afterGap, forearm.rotation), Is.LessThan(0.01f),
                "after a gap the arm is the arm solved from the pole alone");
        }

        // ---- The torso's angular speed ----------------------------------------------------------------------------------

        [Test]
        public void TorsoGovernor_HoldsTheChestToItsCapAFrameAtATime()
        {
            var chest = skeleton.BoneOf(ProductionCharacterJoint.Chest);
            rig.PresentationClockSeconds = 40.0;
            Assert.That(rig.GovernHeroTorsoRates(), Is.False, "a first frame shows the pose as it is");
            var start = chest.rotation;
            var wanted = Quaternion.AngleAxis(60f, Vector3.up) * start;
            var cap = ProductionCharacterRig.GovernedTorsoCapsDegreesPerSecond[(int)ProductionCharacterJoint.Chest - (int)ProductionCharacterJoint.Hips];
            var largest = 0f;
            var reached = -1;
            var previous = start;
            for (var frame = 1; frame <= 12; frame++)
            {
                // The pose source asks for the whole 60 degrees every frame.
                chest.rotation = wanted;
                rig.PresentationClockSeconds = 40.0 + frame * Step;
                rig.GovernHeroTorsoRates();
                largest = Mathf.Max(largest, Quaternion.Angle(previous, chest.rotation));
                previous = chest.rotation;
                if (reached < 0 && Quaternion.Angle(wanted, chest.rotation) < 0.01f) reached = frame;
            }
            Assert.That(largest, Is.LessThanOrEqualTo(cap * (float)Step + 0.01f), "no frame turns the chest past its cap");
            Assert.That(reached, Is.EqualTo(6), "60 degrees at 10 a frame is six frames");
        }

        [Test]
        public void TorsoGovernor_ShowsAPoseAsItIsAfterAGapAndLeavesAHeadingChangeToTheGait()
        {
            var chest = skeleton.BoneOf(ProductionCharacterJoint.Chest);
            rig.PresentationClockSeconds = 60.0;
            rig.GovernHeroTorsoRates();
            var wanted = Quaternion.AngleAxis(90f, Vector3.up) * chest.rotation;
            chest.rotation = wanted;
            rig.PresentationClockSeconds = 60.0 + 0.2;
            Assert.That(rig.GovernHeroTorsoRates(), Is.False, "a gap of 200 ms is a seek: nothing is held");
            Assert.That(Quaternion.Angle(wanted, chest.rotation), Is.LessThan(0.001f));

            // The whole body turning with its root (a run's heading) is not the torso turning.
            rig.PresentationClockSeconds = 60.0 + 0.2 + Step;
            rig.GovernHeroTorsoRates();
            rig.Root.rotation = Quaternion.AngleAxis(90f, Vector3.up) * rig.Root.rotation;
            rig.PresentationClockSeconds = 60.0 + 0.2 + 2 * Step;
            Assert.That(rig.GovernHeroTorsoRates(), Is.False);
        }

        // ---- helpers ------------------------------------------------------------------------------------------------------

        private static Vector3[] Directions() =>
            new[]
            {
                new Vector3(0f, -0.3f, 1f), new Vector3(0f, 0.5f, 1f), new Vector3(0.6f, -0.2f, 1f), new Vector3(-0.6f, -0.2f, 1f),
                new Vector3(0.3f, 0.2f, 0.6f), new Vector3(0f, -1f, 0.2f)
            };

        private Vector3[] Poles(bool left)
        {
            var sign = left ? 1f : -1f;
            return new[]
            {
                rig.Root.TransformDirection(new Vector3(0.6f * sign, -0.5f, 0.1f)),
                rig.Root.TransformDirection(new Vector3(-0.3f * sign, -0.7f, -0.2f))
            };
        }

        /// <summary>The elbow's plane: the angle (degrees) of its offset from the reach line, about that line, from the world's up.</summary>
        private float ElbowPlaneDegrees(bool left)
        {
            var shoulder = skeleton.BoneOf(ProductionHeroArm.UpperJoint(left)).position;
            var elbow = skeleton.BoneOf(ProductionHeroArm.ForearmJoint(left)).position;
            var wrist = skeleton.BoneOf(ProductionHeroArm.HandJoint(left)).position;
            var axis = (wrist - shoulder).normalized;
            var up = Vector3.up - axis * Vector3.Dot(Vector3.up, axis);
            var side = elbow - shoulder;
            side -= axis * Vector3.Dot(side, axis);
            return Vector3.SignedAngle(up.normalized, side.normalized, axis);
        }

        private static void EulerXZ(Quaternion q, out double xDeg, out double zDeg)
        {
            double x = q.x, y = q.y, z = q.z, w = q.w;
            var m11 = 1 - 2 * (y * y + z * z);
            var m12 = 2 * (x * y - w * z);
            var m13 = 2 * (x * z + w * y);
            var m22 = 1 - 2 * (x * x + z * z);
            var m23 = 2 * (y * z - w * x);
            var m32 = 2 * (y * z + w * x);
            var m33 = 1 - 2 * (x * x + y * y);
            if (Math.Abs(m13) < 0.9999999)
            {
                xDeg = Math.Atan2(-m23, m33) * 180.0 / Math.PI;
                zDeg = Math.Atan2(-m12, m11) * 180.0 / Math.PI;
            }
            else
            {
                xDeg = Math.Atan2(m32, m22) * 180.0 / Math.PI;
                zDeg = 0.0;
            }
        }

        private static void SwingTwist(Quaternion q, out double swingDeg, out double twistDeg)
        {
            double y = q.y, w = q.w;
            var l = Math.Sqrt(y * y + w * w);
            if (l == 0.0) l = 1.0;
            var ty = y / l;
            var tw = w / l;
            var twist = 2.0 * Math.Atan2(ty, tw) * 180.0 / Math.PI;
            var sw = w * tw + y * ty;
            swingDeg = 2.0 * Math.Acos(Math.Min(1.0, Math.Abs(sw))) * 180.0 / Math.PI;
            twistDeg = ((twist + 540.0) % 360.0) - 180.0;
        }
    }
}
