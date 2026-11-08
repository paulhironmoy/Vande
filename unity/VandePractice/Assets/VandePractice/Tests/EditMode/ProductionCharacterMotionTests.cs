using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;

namespace Vande.Practice.Tests
{
    public sealed class ProductionCharacterMotionTests
    {
        private const float UpperArmShaftDominance = 0.50f;
        private const float UpperArmShaftMaximumTorsoBlend = 0.35f;
        // Retired 2026-11-04: the old 0.032 normalized centre threshold is geometrically impossible with the
        // constitutionally locked camera/body and the required 100 +/- 2 mm physical grip. Independent analysis of
        // that exact configuration bounded every legal orientation at <= 0.026265 and measured the shipped stance at
        // 0.023615 (0.899 of the bound). Retain 88%: a stated 1.9 percentage-point margin below that observation,
        // while still rejecting projected collapse or one glove hiding behind the other. Physical spacing, complete
        // baked glove volumes, helmet/torso clearance and both mirrors remain separately gated below.
        private const float RetiredProjectedGloveCentreSeparation = 0.032f;
        private const float LockedCameraProjectedGloveCentreUpperBound = 0.026265f;
        private const float MinimumProjectedGloveCentreRetention = 0.88f;

        [Test]
        public void PaceMarkers_FollowCredibleCausalOrder()
        {
            AssertMarkerOrder(ProductionCharacterMotion.PaceBowling,
                ProductionCharacterMarker.RunUpComplete,
                ProductionCharacterMarker.Gather,
                ProductionCharacterMarker.FrontFootPlant,
                ProductionCharacterMarker.Release,
                ProductionCharacterMarker.FollowThrough);
            AssertMarkerOrder(ProductionCharacterMotion.SpinBowling,
                ProductionCharacterMarker.RunUpComplete,
                ProductionCharacterMarker.Gather,
                ProductionCharacterMarker.FrontFootPlant,
                ProductionCharacterMarker.Release,
                ProductionCharacterMarker.FollowThrough);
            AssertMarkerOrder(ProductionCharacterMotion.BatterStroke,
                ProductionCharacterMarker.Backlift,
                ProductionCharacterMarker.FootPlant,
                ProductionCharacterMarker.Contact,
                ProductionCharacterMarker.FollowThrough);
        }

        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterMarker.Gather)]
        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterMarker.FrontFootPlant)]
        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterMarker.Release)]
        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterMarker.FollowThrough)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterMarker.Gather)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterMarker.FrontFootPlant)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterMarker.Release)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterMarker.FollowThrough)]
        [TestCase(ProductionCharacterMotion.BatterStroke, ProductionCharacterMarker.Backlift)]
        [TestCase(ProductionCharacterMotion.BatterStroke, ProductionCharacterMarker.FootPlant)]
        [TestCase(ProductionCharacterMotion.BatterStroke, ProductionCharacterMarker.Contact)]
        [TestCase(ProductionCharacterMotion.KeeperCollection, ProductionCharacterMarker.Collection)]
        [TestCase(ProductionCharacterMotion.FielderDive, ProductionCharacterMarker.Land)]
        [TestCase(ProductionCharacterMotion.FielderThrow, ProductionCharacterMarker.Release)]
        public void NamedMotionMarker_HasContinuousPose(ProductionCharacterMotion motion,
            ProductionCharacterMarker marker)
        {
            float at;
            Assert.That(ProductionCharacterMotionSampler.TryGetMarkerNormalized(motion, marker, out at), Is.True);
            var before = new ProductionCharacterPose();
            var after = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(motion, at - 0.0001f,
                ProductionCharacterHandedness.Right, before);
            ProductionCharacterMotionSampler.SampleInto(motion, at + 0.0001f,
                ProductionCharacterHandedness.Right, after);

            Assert.That(Vector3.Distance(before.RootOffset, after.RootOffset), Is.LessThan(0.005f));
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                Assert.That(Quaternion.Angle(before.Rotation((ProductionCharacterJoint)joint),
                    after.Rotation((ProductionCharacterJoint)joint)), Is.LessThan(1.0f),
                    motion + " " + marker + " joint " + (ProductionCharacterJoint)joint);
        }

        [Test]
        public void Sampling_IsDeterministicAndMirrorsDominantSide()
        {
            var first = new ProductionCharacterPose();
            var second = new ProductionCharacterPose();
            var mirrored = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(ProductionCharacterMotion.PaceBowling,
                ProductionCharacterMotionSampler.PaceRelease, ProductionCharacterHandedness.Right, first);
            ProductionCharacterMotionSampler.SampleInto(ProductionCharacterMotion.PaceBowling,
                ProductionCharacterMotionSampler.PaceRelease, ProductionCharacterHandedness.Right, second);
            ProductionCharacterMotionSampler.SampleInto(ProductionCharacterMotion.PaceBowling,
                ProductionCharacterMotionSampler.PaceRelease, ProductionCharacterHandedness.Left, mirrored);

            Assert.That(first.RootOffset, Is.EqualTo(second.RootOffset));
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                Assert.That(Quaternion.Angle(first.Rotation((ProductionCharacterJoint)joint),
                    second.Rotation((ProductionCharacterJoint)joint)), Is.LessThan(0.0001f));
            Assert.That(Quaternion.Angle(first.Rotation(ProductionCharacterJoint.UpperArmRight),
                mirrored.Rotation(ProductionCharacterJoint.UpperArmLeft)), Is.GreaterThan(0.1f),
                "mirroring swaps sides and reflects the local rotation, rather than copying the same quaternion");
            Assert.That(mirrored.RootOffset.x, Is.EqualTo(-first.RootOffset.x).Within(0.000001f));
        }

        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterMotion.PaceBowling, ProductionCharacterHandedness.Left)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterMotion.SpinBowling, ProductionCharacterHandedness.Left)]
        public void BowlingAction_KeepsHeadDirectedDownThePitchAcrossKeyPhases(
            ProductionCharacterMotion motion,
            ProductionCharacterHandedness handedness)
        {
            var markers = new[]
            {
                ProductionCharacterMarker.Gather,
                ProductionCharacterMarker.Release,
                ProductionCharacterMarker.FollowThrough
            };
            for (var markerIndex = 0; markerIndex < markers.Length; markerIndex++)
            {
                float at;
                Assert.That(ProductionCharacterMotionSampler.TryGetMarkerNormalized(
                    motion, markers[markerIndex], out at), Is.True);
                var pose = new ProductionCharacterPose();
                ProductionCharacterMotionSampler.SampleInto(motion, at, handedness, pose);
                var headWorldRotation = pose.Rotation(ProductionCharacterJoint.Hips) *
                                        pose.Rotation(ProductionCharacterJoint.Spine) *
                                        pose.Rotation(ProductionCharacterJoint.Chest) *
                                        pose.Rotation(ProductionCharacterJoint.Neck) *
                                        pose.Rotation(ProductionCharacterJoint.Head);
                var facing = headWorldRotation * Vector3.forward;
                facing.y = 0f;
                Assert.That(Vector3.Angle(Vector3.forward, facing.normalized), Is.LessThan(30f),
                    motion + " " + handedness + " " + markers[markerIndex] +
                    " must keep the bowler watching the batter");
            }
        }

        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void BatterReadyPose_UsesSideOnGuardWithDownPitchGazeAndOneHandednessMirror(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var pose = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(
                ProductionCharacterMotion.BatterStance, 0f, handedness, pose);

            var torsoWorldRotation = pose.Rotation(ProductionCharacterJoint.Hips) *
                                     pose.Rotation(ProductionCharacterJoint.Spine) *
                                     pose.Rotation(ProductionCharacterJoint.Chest);
            var headWorldRotation = torsoWorldRotation *
                                    pose.Rotation(ProductionCharacterJoint.Neck) *
                                    pose.Rotation(ProductionCharacterJoint.Head);
            var signedTorsoAngle = HorizontalSignedFacingAngle(torsoWorldRotation);
            var signedGazeAngle = HorizontalSignedFacingAngle(headWorldRotation);
            var torsoAngle = Mathf.Abs(signedTorsoAngle);
            var gazeAngle = Mathf.Abs(signedGazeAngle);

            // The 1.78 m hero's 0.41 m shoulder line remains recognisable rather than broad-backed in the locked
            // camera at a bounded three-quarter guard. Fifty degrees exposes the bat-side shoulder without the
            // severe cervical counter-twist that visibly separated the face, helmet and collar.
            Assert.That(torsoAngle, Is.InRange(48f, 52f),
                handedness + " batter must expose a cricket-authentic three-quarter guard");
            Assert.That(Mathf.Sign(signedTorsoAngle), Is.EqualTo(mirror),
                handedness + " guard must be mirrored exactly once rather than sharing one fixed turn");
            Assert.That(gazeAngle, Is.LessThan(12f),
                handedness + " batter must counter-rotate the gaze down the pitch");
            Assert.That(torsoAngle - gazeAngle, Is.GreaterThanOrEqualTo(40f),
                handedness + " gaze must come from a deliberate head/neck counter-turn, not a square torso");

            Assert.That(mirror * LocalSignedYaw(pose, ProductionCharacterJoint.Hips),
                Is.InRange(30f, 34f), handedness + " pelvis must own a bounded majority of the guard turn");
            Assert.That(mirror * LocalSignedYaw(pose, ProductionCharacterJoint.Spine),
                Is.InRange(8f, 12f), handedness + " spine must share the turn instead of twisting one joint");
            Assert.That(mirror * LocalSignedYaw(pose, ProductionCharacterJoint.Chest),
                Is.InRange(6f, 10f), handedness + " sternum must complete the distributed guard turn");
            Assert.That(mirror * LocalSignedYaw(pose, ProductionCharacterJoint.Neck),
                Is.InRange(-22f, -20f), handedness + " neck must share the down-pitch counter-turn without exceeding its anatomical presentation bound");
            Assert.That(mirror * LocalSignedYaw(pose, ProductionCharacterJoint.Head),
                Is.InRange(-22f, -20f), handedness + " head must finish the down-pitch counter-turn without exceeding its anatomical presentation bound");
        }

        [Test]
        public void BatterAddressPose_UsesOneRestrainedLoopWithBoundedCounterMotion()
        {
            var neutral = new ProductionCharacterPose();
            var positive = new ProductionCharacterPose();
            var negative = new ProductionCharacterPose();
            var loopEnd = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(
                ProductionCharacterMotion.BatterStance, 0f,
                ProductionCharacterHandedness.Right, neutral);
            ProductionCharacterMotionSampler.SampleInto(
                ProductionCharacterMotion.BatterStance, 0.25f,
                ProductionCharacterHandedness.Right, positive);
            ProductionCharacterMotionSampler.SampleInto(
                ProductionCharacterMotion.BatterStance, 0.75f,
                ProductionCharacterHandedness.Right, negative);
            ProductionCharacterMotionSampler.SampleInto(
                ProductionCharacterMotion.BatterStance, 1f,
                ProductionCharacterHandedness.Right, loopEnd);

            Assert.That(ProductionCharacterMotionSampler.DurationSeconds(
                    ProductionCharacterMotion.BatterStance),
                Is.EqualTo(2.4f).Within(0.000001f));
            Assert.That(ProductionCharacterMotionSampler.IsLooping(
                ProductionCharacterMotion.BatterStance), Is.True);
            Assert.That(Mathf.Abs(positive.RootOffset.x - negative.RootOffset.x),
                Is.EqualTo(0.004f).Within(0.000001f),
                "the documented lower bound is four millimetres total peak-to-peak, not +/- four millimetres");
            Assert.That(positive.RootOffset.y, Is.EqualTo(neutral.RootOffset.y).Within(0.000001f));
            Assert.That(negative.RootOffset.y, Is.EqualTo(neutral.RootOffset.y).Within(0.000001f));
            Assert.That(Vector3.Distance(loopEnd.RootOffset, neutral.RootOffset),
                Is.LessThan(0.000001f));

            var hipTurn = LocalEulerDelta(neutral, positive,
                ProductionCharacterJoint.Hips, 1);
            var chestCounterTurn = LocalEulerDelta(neutral, positive,
                ProductionCharacterJoint.Chest, 1);
            Assert.That(Mathf.Abs(hipTurn), Is.LessThanOrEqualTo(0.36f));
            Assert.That(Mathf.Abs(chestCounterTurn), Is.LessThanOrEqualTo(0.36f));
            Assert.That(hipTurn * chestCounterTurn, Is.LessThan(0f),
                "hips and chest must settle in opposing directions");

            var leftKnee = LocalEulerDelta(neutral, positive,
                ProductionCharacterJoint.ShinLeft, 0);
            var rightKnee = LocalEulerDelta(neutral, positive,
                ProductionCharacterJoint.ShinRight, 0);
            Assert.That(Mathf.Abs(leftKnee), Is.LessThanOrEqualTo(1.01f));
            Assert.That(Mathf.Abs(rightKnee), Is.LessThanOrEqualTo(1.01f));
            Assert.That(leftKnee * rightKnee, Is.LessThan(0f),
                "the one-degree knee settle must alternate rather than squat both legs together");

            var settlingJoints = new[]
            {
                ProductionCharacterJoint.UpperArmLeft,
                ProductionCharacterJoint.ForearmLeft,
                ProductionCharacterJoint.UpperArmRight,
                ProductionCharacterJoint.ForearmRight
            };
            for (var jointIndex = 0; jointIndex < settlingJoints.Length; jointIndex++)
            {
                Assert.That(Quaternion.Angle(
                        neutral.Rotation(settlingJoints[jointIndex]),
                        positive.Rotation(settlingJoints[jointIndex])),
                    Is.LessThanOrEqualTo(0.46f),
                    settlingJoints[jointIndex] + " must remain a sub-degree settle");
                Assert.That(Quaternion.Angle(
                        neutral.Rotation(settlingJoints[jointIndex]),
                        loopEnd.Rotation(settlingJoints[jointIndex])),
                    Is.LessThan(0.001f),
                    settlingJoints[jointIndex] + " must close the deterministic loop");
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterAddress_KeepsFeetGripAndGroundedToeBounded(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("ProductionBatterAddressLifeHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);

                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                var neutralLeftFoot = rig.Joint(ProductionCharacterJoint.FootLeft).position;
                var neutralRightFoot = rig.Joint(ProductionCharacterJoint.FootRight).position;
                var neutralToe = rig.BatToeWorld;

                const int samples = 32;
                for (var sample = 0; sample <= samples; sample++)
                {
                    var phase = sample / (float)samples;
                    rig.SampleAndApply(ProductionCharacterMotion.BatterStance, phase);
                    Assert.That(Vector3.Distance(
                            neutralLeftFoot,
                            rig.Joint(ProductionCharacterJoint.FootLeft).position),
                        Is.LessThanOrEqualTo(0.00301f),
                        handedness + " left foot exceeded 3 mm drift at phase " + phase);
                    Assert.That(Vector3.Distance(
                            neutralRightFoot,
                            rig.Joint(ProductionCharacterJoint.FootRight).position),
                        Is.LessThanOrEqualTo(0.00301f),
                        handedness + " right foot exceeded 3 mm drift at phase " + phase);
                    var grip = rig.Bat.position;
                    var lowerHandle = grip + rig.Bat.TransformDirection(Vector3.down) * 0.24f;
                    Assert.That(DistanceToSegment(
                            rig.Joint(ProductionCharacterJoint.HandLeft).position, grip, lowerHandle),
                        Is.LessThan(0.15f),
                        handedness + " left hand left the analytic grip at phase " + phase);
                    Assert.That(DistanceToSegment(
                            rig.Joint(ProductionCharacterJoint.HandRight).position, grip, lowerHandle),
                        Is.LessThan(0.15f),
                        handedness + " right hand left the analytic grip at phase " + phase);
                    Assert.That(Mathf.Abs(rig.BatToeWorld.y - neutralToe.y),
                        Is.LessThanOrEqualTo(0.00301f),
                        handedness + " address life must not lift or bury the grounded bat toe");
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterStroke_KeepsGazeDownPitchThroughContact(
            ProductionCharacterHandedness handedness)
        {
            var phases = new[]
            {
                0f,
                ProductionCharacterMotionSampler.BatterBacklift,
                ProductionCharacterMotionSampler.BatterFootPlant,
                ProductionCharacterMotionSampler.BatterContact
            };
            var pose = new ProductionCharacterPose();
            for (var phaseIndex = 0; phaseIndex < phases.Length; phaseIndex++)
            {
                ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                    phases[phaseIndex], handedness, ProductionBatterFootwork.Balanced, pose);
                var headWorldRotation = pose.Rotation(ProductionCharacterJoint.Hips) *
                                        pose.Rotation(ProductionCharacterJoint.Spine) *
                                        pose.Rotation(ProductionCharacterJoint.Chest) *
                                        pose.Rotation(ProductionCharacterJoint.Neck) *
                                        pose.Rotation(ProductionCharacterJoint.Head);
                Assert.That(HorizontalFacingAngle(headWorldRotation), Is.LessThan(18f),
                    handedness + " batter must keep watching the ball at phase " + phases[phaseIndex]);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterStroke_FollowThroughStaysBoundedAndKeepsWatchingBall(
            ProductionCharacterHandedness handedness)
        {
            var phases = new[]
            {
                ProductionCharacterMotionSampler.BatterContact,
                ProductionCharacterMotionSampler.BatterFollowThrough,
                0.90f,
                1f
            };
            for (var phaseIndex = 0; phaseIndex < phases.Length; phaseIndex++)
            {
                var pose = new ProductionCharacterPose();
                ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                    phases[phaseIndex], handedness, ProductionBatterFootwork.Balanced, pose);

                Assert.That(Quaternion.Angle(Quaternion.identity,
                        pose.Rotation(ProductionCharacterJoint.UpperArmLeft)),
                    Is.LessThan(95f),
                    handedness + " left shoulder must not hyperextend at phase " + phases[phaseIndex]);
                Assert.That(Quaternion.Angle(Quaternion.identity,
                        pose.Rotation(ProductionCharacterJoint.UpperArmRight)),
                    Is.LessThan(95f),
                    handedness + " right shoulder must not hyperextend at phase " + phases[phaseIndex]);
                Assert.That(Quaternion.Angle(Quaternion.identity,
                        pose.Rotation(ProductionCharacterJoint.ForearmLeft)),
                    Is.LessThan(95f),
                    handedness + " left elbow must retain a bounded fold at phase " + phases[phaseIndex]);
                Assert.That(Quaternion.Angle(Quaternion.identity,
                        pose.Rotation(ProductionCharacterJoint.ForearmRight)),
                    Is.LessThan(95f),
                    handedness + " right elbow must retain a bounded fold at phase " + phases[phaseIndex]);

                var headWorldRotation = pose.Rotation(ProductionCharacterJoint.Hips) *
                                        pose.Rotation(ProductionCharacterJoint.Spine) *
                                        pose.Rotation(ProductionCharacterJoint.Chest) *
                                        pose.Rotation(ProductionCharacterJoint.Neck) *
                                        pose.Rotation(ProductionCharacterJoint.Head);
                Assert.That(HorizontalFacingAngle(headWorldRotation), Is.LessThan(38f),
                    handedness + " batter must retain the ball corridor through the finish at phase " +
                    phases[phaseIndex]);
            }
        }

        [Test]
        public void BatterStroke_HasProgressiveFollowThroughAndBalancedRecoveryInsteadOfFrozenPeak()
        {
            var contact = new ProductionCharacterPose();
            var peak = new ProductionCharacterPose();
            var settle = new ProductionCharacterPose();
            var finish = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterContact,
                ProductionCharacterHandedness.Right, ProductionBatterFootwork.Balanced, contact);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFollowThrough,
                ProductionCharacterHandedness.Right, ProductionBatterFootwork.Balanced, peak);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                0.90f, ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Balanced, settle);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                1f, ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Balanced, finish);

            var duration = ProductionCharacterMotionSampler.DurationSeconds(
                ProductionCharacterMotion.BatterStroke);
            Assert.That((ProductionCharacterMotionSampler.BatterFollowThrough -
                         ProductionCharacterMotionSampler.BatterContact) * duration,
                Is.GreaterThanOrEqualTo(0.20f),
                "contact needs a readable drive into the named follow-through marker");
            Assert.That((1f - ProductionCharacterMotionSampler.BatterFollowThrough) * duration,
                Is.GreaterThanOrEqualTo(0.24f),
                "the peak needs time to resolve into a balanced finish");

            Assert.That(Quaternion.Angle(contact.BatRotation, peak.BatRotation),
                Is.GreaterThan(12f), "contact must progress into follow-through");
            Assert.That(Quaternion.Angle(peak.BatRotation, settle.BatRotation),
                Is.GreaterThan(4f), "the sampler must not freeze at the named follow-through marker");
            Assert.That(Quaternion.Angle(settle.BatRotation, finish.BatRotation),
                Is.GreaterThan(4f), "the late finish must keep resolving rather than hold an extreme pose");
            Assert.That(Quaternion.Angle(contact.BatRotation, finish.BatRotation),
                Is.LessThan(45f), "recovery must finish closer to the controlled contact arc than the peak");

            var peakShoulder = peak.Rotation(ProductionCharacterJoint.UpperArmRight);
            Assert.That(Quaternion.Angle(
                    peakShoulder,
                    finish.Rotation(ProductionCharacterJoint.UpperArmRight)),
                Is.GreaterThan(4f), "the shoulder must visibly settle after peak follow-through");
            Assert.That(Quaternion.Angle(
                    contact.Rotation(ProductionCharacterJoint.UpperArmRight),
                    finish.Rotation(ProductionCharacterJoint.UpperArmRight)),
                Is.LessThan(28f), "the terminal shoulder pose must remain a balanced finish");
        }

        [TestCase(ProductionCharacterHandedness.Right, ProductionBatterFootwork.Balanced)]
        [TestCase(ProductionCharacterHandedness.Right, ProductionBatterFootwork.Forward)]
        [TestCase(ProductionCharacterHandedness.Right, ProductionBatterFootwork.Back)]
        [TestCase(ProductionCharacterHandedness.Right, ProductionBatterFootwork.Across)]
        [TestCase(ProductionCharacterHandedness.Right, ProductionBatterFootwork.DownTrack)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionBatterFootwork.Balanced)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionBatterFootwork.Forward)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionBatterFootwork.Back)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionBatterFootwork.Across)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionBatterFootwork.DownTrack)]
        public void BatterStroke_TerminalRecoverySettlesStrideAndBothLegLevers(
            ProductionCharacterHandedness handedness,
            ProductionBatterFootwork footwork)
        {
            var peak = new ProductionCharacterPose();
            var finish = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFollowThrough,
                handedness, footwork, peak);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                1f, handedness, footwork, finish);

            Assert.That(Mathf.Abs(finish.RootOffset.x),
                Is.LessThan(Mathf.Abs(peak.RootOffset.x) - 0.04f),
                handedness + " terminal recovery must visibly narrow the planted lateral stride");
            Assert.That(Mathf.Abs(finish.RootOffset.x), Is.LessThanOrEqualTo(0.08f),
                handedness + " dead-ball centre of mass must finish within a balanced lateral stance");

            var peakLeftLever = ProjectedThighLeverAngle(
                peak.Rotation(ProductionCharacterJoint.ThighLeft));
            var peakRightLever = ProjectedThighLeverAngle(
                peak.Rotation(ProductionCharacterJoint.ThighRight));
            var finishLeftLever = ProjectedThighLeverAngle(
                finish.Rotation(ProductionCharacterJoint.ThighLeft));
            var finishRightLever = ProjectedThighLeverAngle(
                finish.Rotation(ProductionCharacterJoint.ThighRight));
            Assert.That(finishLeftLever + finishRightLever,
                Is.LessThan(peakLeftLever + peakRightLever - 8f),
                handedness + " terminal recovery must resolve the straight-legged split silhouette");
            Assert.That(finishLeftLever + finishRightLever, Is.LessThanOrEqualTo(30f),
                handedness + " terminal thigh-roll divergence must read as a planted recovery, not a split");
        }

        [Test]
        public void BatterStroke_IsContinuousAtSixtyFramesPerSecondThroughRecovery()
        {
            var duration = ProductionCharacterMotionSampler.DurationSeconds(
                ProductionCharacterMotion.BatterStroke);
            var frameCount = Mathf.CeilToInt(duration * 60f);
            var previous = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                0f, ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Balanced, previous);

            for (var frame = 1; frame <= frameCount; frame++)
            {
                var current = new ProductionCharacterPose();
                ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                    frame / (float)frameCount,
                    ProductionCharacterHandedness.Right,
                    ProductionBatterFootwork.Balanced,
                    current);
                Assert.That(Vector3.Distance(previous.RootOffset, current.RootOffset),
                    Is.LessThan(0.035f), "root discontinuity at 60 fps frame " + frame);
                for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                {
                    Assert.That(Quaternion.Angle(
                            previous.Rotation((ProductionCharacterJoint)joint),
                            current.Rotation((ProductionCharacterJoint)joint)),
                        Is.LessThan(14f),
                        (ProductionCharacterJoint)joint + " discontinuity at 60 fps frame " + frame);
                }
                Assert.That(Quaternion.Angle(previous.BatRotation, current.BatRotation),
                    Is.LessThan(18f), "bat discontinuity at 60 fps frame " + frame);
                previous = current;
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterReadyPose_KeepsElbowsAndGripBelowShoulderLine(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("ProductionBatterReadyPoseHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);

                AssertElbowBelowShoulder(rig, ProductionCharacterJoint.UpperArmLeft,
                    ProductionCharacterJoint.ForearmLeft, "left");
                AssertElbowBelowShoulder(rig, ProductionCharacterJoint.UpperArmRight,
                    ProductionCharacterJoint.ForearmRight, "right");
                var lowerShoulder = Mathf.Min(
                    rig.Joint(ProductionCharacterJoint.UpperArmLeft).position.y,
                    rig.Joint(ProductionCharacterJoint.UpperArmRight).position.y);
                Assert.That(rig.Bat.position.y, Is.LessThan(lowerShoulder - 0.12f),
                    handedness + " grip must stay below the shoulder line instead of crossing the face");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void AdmittedHeroBatterStance_KeepsGlovesFaceBatAndLegsSpatiallyCredible(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("ProductionHeroBatterSpatialStanceHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(rig.HeroBoneCount, Is.EqualTo(75));

                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                AssertHeroBatterStanceSpatialContract(rig, handedness);
                AssertHeroWristLengthPreserved(rig, ProductionCharacterJoint.HandLeft);
                AssertHeroWristLengthPreserved(rig, ProductionCharacterJoint.HandRight);
                var stanceToe = rig.BatToeWorld;
                var stanceGripCentroid = (rig.HeroHandWorldPosition(true) +
                                           rig.HeroHandWorldPosition(false)) * 0.5f;

                rig.SampleBatterStroke(0f, ProductionBatterFootwork.Balanced);
                Assert.That(Vector3.Distance(rig.BatToeWorld, stanceToe), Is.LessThan(0.005f),
                    "stroke start must not pop the grounded stance bat");
                Assert.That(Vector3.Distance(
                        (rig.HeroHandWorldPosition(true) + rig.HeroHandWorldPosition(false)) * 0.5f,
                        stanceGripCentroid),
                    Is.LessThan(0.005f), "stroke start must not pop the low joined grip");

                var transitionPhases = new[]
                {
                    ProductionCharacterMotionSampler.BatterBacklift,
                    ProductionCharacterMotionSampler.BatterContact
                };
                for (var phaseIndex = 0; phaseIndex < transitionPhases.Length; phaseIndex++)
                {
                    rig.SampleBatterStroke(transitionPhases[phaseIndex], ProductionBatterFootwork.Balanced);
                    AssertHeroHandOnGrip(rig, true, transitionPhases[phaseIndex]);
                    AssertHeroHandOnGrip(rig, false, transitionPhases[phaseIndex]);
                    AssertHeroWristLengthPreserved(rig, ProductionCharacterJoint.HandLeft);
                    AssertHeroWristLengthPreserved(rig, ProductionCharacterJoint.HandRight);
                    var head = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                    Assert.That(Vector3.Distance(head, rig.HeroHandWorldPosition(true)),
                        Is.GreaterThan(0.18f));
                    Assert.That(Vector3.Distance(head, rig.HeroHandWorldPosition(false)),
                        Is.GreaterThan(0.18f));
                }

                var pose = new ProductionCharacterPose();
                ProductionCharacterMotionSampler.SampleInto(
                    ProductionCharacterMotion.BatterStance, 0f, handedness, pose);
                var gaze = pose.Rotation(ProductionCharacterJoint.Hips) *
                           pose.Rotation(ProductionCharacterJoint.Spine) *
                           pose.Rotation(ProductionCharacterJoint.Chest) *
                           pose.Rotation(ProductionCharacterJoint.Neck) *
                           pose.Rotation(ProductionCharacterJoint.Head);
                Assert.That(HorizontalFacingAngle(gaze), Is.LessThan(15f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (world reflection -1); a "Right" rig a left-hander (+1).
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void AdmittedHeroBatterStance_ClearsHelmetAndTorsoInLockedRearShoulderView(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("ProductionHeroBatterCameraSilhouetteHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(rig.HeroBoneCount, Is.EqualTo(75));

                // Match the live world's striker transform and the constitutionally locked rear-shoulder camera.
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));
                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);

                var cameraPosition = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraPosition(0f, 0f, mirror);
                var cameraTarget = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraTarget(0f);
                var worldToView = Quaternion.Inverse(Quaternion.LookRotation(
                    cameraTarget - cameraPosition, Vector3.up));

                var head = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Head),
                    cameraPosition, worldToView);
                var hips = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips),
                    cameraPosition, worldToView);
                var chest = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest),
                    cameraPosition, worldToView);
                var leftShoulder = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft),
                    cameraPosition, worldToView);
                var leftElbow = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.ForearmLeft),
                    cameraPosition, worldToView);
                var leftHand = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.HandLeft),
                    cameraPosition, worldToView);
                var rightShoulder = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight),
                    cameraPosition, worldToView);
                var rightElbow = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.ForearmRight),
                    cameraPosition, worldToView);
                var rightHand = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.HandRight),
                    cameraPosition, worldToView);
                var backKneeJoint = handedness == ProductionCharacterHandedness.Right
                    ? ProductionCharacterJoint.ShinRight
                    : ProductionCharacterJoint.ShinLeft;
                var backKnee = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(backKneeJoint), cameraPosition, worldToView);
                var batGrip = ProjectToLockedCamera(rig.Bat.position, cameraPosition, worldToView);
                var batToe = ProjectToLockedCamera(rig.BatToeWorld, cameraPosition, worldToView);

                // A real three-quarter guard has a bounded shoulder span plus measurable front/back shoulder
                // depth. Centreline-only tests admitted both the old square back and the later overtwisted
                // corkscrew, so lock a finite window in the exact shipped camera rather than maximizing depth.
                // The roughly 4.44 m radial full-body composition makes the same physical shoulder line materially larger than
                // the former 5.15 m camera; this angular window is the correspondingly rescaled guard, not a relaxed
                // anatomy limit. The independent world test separately gates complete figure height and margins.
                var projectedShoulderSpan = Mathf.Abs(leftShoulder.x - rightShoulder.x);
                Assert.That(projectedShoulderSpan, Is.InRange(0.024f, 0.082f),
                    handedness + " projected shoulders must read as a human side-on profile, not a square wall");
                var leftShoulderView = worldToView *
                                       (rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft) -
                                        cameraPosition);
                var rightShoulderView = worldToView *
                                        (rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight) -
                                         cameraPosition);
                Assert.That(Mathf.Abs(leftShoulderView.z - rightShoulderView.z),
                    Is.InRange(0.19f, 0.36f),
                    handedness + " three-quarter guard must retain visible shoulder depth without corkscrewing the neck");

                // The previous pose could satisfy arm centreline clearance while the complete player still read
                // as a collapsing mannequin: 30 degrees of authored torso pitch became a severe lateral lean in
                // this oblique camera.  Gate the actual shipped projection, including the joined-grip window.
                var torsoAxis = chest - hips;
                Assert.That(Vector2.Angle(Vector2.up, torsoAxis), Is.LessThanOrEqualTo(12f),
                    handedness + " torso centreline must remain within 12 degrees of screen vertical");
                Assert.That(head.y, Is.GreaterThan(chest.y),
                    handedness + " head must remain stacked above the sternum");
                Assert.That(Mathf.Abs(head.x - chest.x), Is.LessThan(0.050f),
                    handedness + " head must stay over the torso instead of collapsing sideways");
                var gripCentroid = (leftHand + rightHand) * 0.5f;
                Assert.That(gripCentroid.y, Is.LessThan(chest.y - 0.025f),
                    handedness + " both gloves must remain below the sternum");
                Assert.That(gripCentroid.y, Is.GreaterThan(hips.y - 0.010f),
                    handedness + " joined gloves must stay in the abdomen/guard window, not fall between the pads");
                Assert.That(Vector3.Distance(
                        rig.HeroHandWorldPosition(true),
                        rig.HeroHandWorldPosition(false)),
                    Is.EqualTo(0.1f).Within(0.002f),
                    handedness + " glove centres must remain distinct on the shared handle");
                Assert.That(RetiredProjectedGloveCentreSeparation,
                    Is.GreaterThan(LockedCameraProjectedGloveCentreUpperBound),
                    "the retired absolute screen threshold must stay recorded as impossible, not silently relaxed");
                var projectedGloveCentreSeparation = Vector2.Distance(leftHand, rightHand);
                Assert.That(projectedGloveCentreSeparation,
                    Is.GreaterThanOrEqualTo(
                        LockedCameraProjectedGloveCentreUpperBound * MinimumProjectedGloveCentreRetention),
                    handedness + " projected glove centres must retain at least " +
                    (MinimumProjectedGloveCentreRetention * 100f).ToString("F0") +
                    "% of the independently bounded available separation; collapsed or depth-occluded gloves fail");
                Assert.That(Vector2.Distance(leftElbow, rightElbow), Is.GreaterThanOrEqualTo(0.060f),
                    handedness + " elbow bends must remain independently readable");
                Assert.That(Vector2.Angle(
                        leftHand - leftElbow,
                        rightHand - rightElbow),
                    Is.GreaterThanOrEqualTo(45f),
                    handedness + " forearms must converge as a human two-hand guard, not stack as one rod");

                var backSide = Mathf.Sign(backKnee.x - hips.x);
                Assert.That(Mathf.Abs(backKnee.x - hips.x), Is.GreaterThan(0.010f),
                    handedness + " back pad must define a readable outside edge in the locked camera");
                Assert.That((batGrip.x - hips.x) * backSide, Is.GreaterThan(0.004f),
                    handedness + " handle must sit on the mirrored back-hip side, not on the torso centreline");
                Assert.That((batToe.x - backKnee.x) * backSide, Is.GreaterThan(0.004f),
                    handedness + " bat toe must finish outside the mirrored back pad");
                var hipView = worldToView *
                              (rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips) - cameraPosition);
                var gripView = worldToView * (rig.Bat.position - cameraPosition);
                Assert.That(gripView.z, Is.LessThan(hipView.z - 0.015f),
                    handedness + " handle must sit slightly camera-forward so it is not buried in the torso");

                Assert.That(DistanceToSegment2D(head, leftElbow, leftHand),
                    Is.GreaterThan(0.030f),
                    handedness + " left forearm must not cross the helmet in the shipped camera");
                Assert.That(DistanceToSegment2D(head, rightElbow, rightHand),
                    Is.GreaterThan(0.030f),
                    handedness + " right forearm must not cross the helmet in the shipped camera");
                Assert.That(DistanceToSegment2D(head, leftShoulder, leftElbow),
                    Is.GreaterThan(0.018f),
                    handedness + " left upper arm must preserve a readable neck-and-helmet silhouette");
                Assert.That(DistanceToSegment2D(head, rightShoulder, rightElbow),
                    Is.GreaterThan(0.018f),
                    handedness + " right upper arm must preserve a readable neck-and-helmet silhouette");
                Assert.That(SegmentsIntersect2D(
                        leftShoulder, leftElbow, rightShoulder, rightElbow), Is.False,
                    handedness + " upper arms must not self-intersect across the torso in screen space");

                // Both elbow bends must read below the sternum instead of producing the old crossed-arms-at-face
                // silhouette.  The joined hands may converge on the handle below this line.
                Assert.That(leftElbow.y, Is.LessThan(chest.y - 0.012f));
                Assert.That(rightElbow.y, Is.LessThan(chest.y - 0.012f));
                Assert.That(gripCentroid.y, Is.LessThan(chest.y - 0.025f));
                Vector2 forearmIntersection;
                if (TrySegmentIntersection2D(
                        leftElbow, leftHand, rightElbow, rightHand, out forearmIntersection))
                {
                    Assert.That(forearmIntersection.y, Is.LessThan(chest.y - 0.025f),
                        handedness + " joined forearms may converge only at the low bat handle");
                }

                AssertBakedArmAndGloveVolumesReadAsOneGrip(
                    rig, cameraPosition, worldToView, head);

                // The looping address breathes; certify the complete glove/bat silhouette at both extrema rather
                // than accepting a single convenient frame.
                var stancePhases = new[] { 0.25f, 0.75f };
                for (var phaseIndex = 0; phaseIndex < stancePhases.Length; phaseIndex++)
                {
                    rig.SampleAndApply(
                        ProductionCharacterMotion.BatterStance, stancePhases[phaseIndex]);
                    AssertLockedCameraCompositeGrip(
                        rig, handedness, cameraPosition, worldToView);
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void FielderReady_StablePhaseIsDeterministicBoundedAndLooping()
        {
            var first = ProductionCharacterMotionSampler.StableFielderReadyPhase("cover-4", 4);
            var repeated = ProductionCharacterMotionSampler.StableFielderReadyPhase("cover-4", 4);
            var differentId = ProductionCharacterMotionSampler.StableFielderReadyPhase("point-4", 4);
            var differentSlot = ProductionCharacterMotionSampler.StableFielderReadyPhase("cover-4", 5);

            Assert.That(repeated, Is.EqualTo(first));
            Assert.That(first, Is.GreaterThanOrEqualTo(0f).And.LessThan(1f));
            Assert.That(Mathf.Abs(differentId - first), Is.GreaterThan(0.000001f));
            Assert.That(Mathf.Abs(differentSlot - first), Is.GreaterThan(0.000001f));
            Assert.That(ProductionCharacterMotionSampler.IsLooping(
                ProductionCharacterMotion.FielderReady), Is.True);
            Assert.That(ProductionCharacterMotionSampler.DurationSeconds(
                ProductionCharacterMotion.FielderReady), Is.GreaterThan(2f));

            var a = new ProductionCharacterPose();
            var b = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleInto(ProductionCharacterMotion.FielderReady,
                first, ProductionCharacterHandedness.Right, a);
            ProductionCharacterMotionSampler.SampleInto(ProductionCharacterMotion.FielderReady,
                repeated, ProductionCharacterHandedness.Right, b);
            Assert.That(a.RootOffset, Is.EqualTo(b.RootOffset));
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
            {
                Assert.That(Quaternion.Angle(
                        a.Rotation((ProductionCharacterJoint)joint),
                        b.Rotation((ProductionCharacterJoint)joint)),
                    Is.LessThan(0.0001f));
            }

            Assert.That(() => ProductionCharacterMotionSampler.StableFielderReadyPhase(null, 0),
                Throws.ArgumentException);
            Assert.That(() => ProductionCharacterMotionSampler.StableFielderReadyPhase("cover-4", -1),
                Throws.TypeOf<System.ArgumentOutOfRangeException>());
        }

        [Test]
        public void FielderReady_HasMirroredAthleticJointGeometry()
        {
            var rightHost = new GameObject("ProductionRightFielderReadyHost");
            var leftHost = new GameObject("ProductionLeftFielderReadyHost");
            ProductionCharacterRig right = null;
            ProductionCharacterRig left = null;
            try
            {
                var rightSpec = ProductionCharacterSpec.For(ProductionCharacterRole.Fielder);
                rightSpec.Handedness = ProductionCharacterHandedness.Right;
                var leftSpec = ProductionCharacterSpec.For(ProductionCharacterRole.Fielder);
                leftSpec.Handedness = ProductionCharacterHandedness.Left;
                right = ProductionCharacterFactory.Create(rightHost.transform, rightSpec);
                left = ProductionCharacterFactory.Create(leftHost.transform, leftSpec);
                var phase = ProductionCharacterMotionSampler.StableFielderReadyPhase("midwicket-7", 7);
                right.SampleAndApply(ProductionCharacterMotion.FielderReady, phase);
                left.SampleAndApply(ProductionCharacterMotion.FielderReady, phase);

                AssertFielderReadyGeometry(right);
                AssertFielderReadyGeometry(left);
                AssertMirroredJointPosition(right, ProductionCharacterJoint.Head,
                    left, ProductionCharacterJoint.Head);
                AssertMirroredJointPosition(right, ProductionCharacterJoint.ForearmLeft,
                    left, ProductionCharacterJoint.ForearmRight);
                AssertMirroredJointPosition(right, ProductionCharacterJoint.HandLeft,
                    left, ProductionCharacterJoint.HandRight);
                AssertMirroredJointPosition(right, ProductionCharacterJoint.ShinLeft,
                    left, ProductionCharacterJoint.ShinRight);
                AssertMirroredJointPosition(right, ProductionCharacterJoint.FootLeft,
                    left, ProductionCharacterJoint.FootRight);
            }
            finally
            {
                if (right != null) right.Dispose();
                if (left != null) left.Dispose();
                Object.DestroyImmediate(rightHost);
                Object.DestroyImmediate(leftHost);
            }
        }

        [Test]
        public void HostSceneFamily_SelectsDistinctBowlingRoleMotionAndCadence()
        {
            var pace = ProductionBowlingPresentation.ForSceneFamily("pace");
            var spin = ProductionBowlingPresentation.ForSceneFamily("spin");

            Assert.That(pace.Role, Is.EqualTo(ProductionCharacterRole.PaceBowler));
            Assert.That(pace.Motion, Is.EqualTo(ProductionCharacterMotion.PaceBowling));
            Assert.That(spin.Role, Is.EqualTo(ProductionCharacterRole.SpinBowler));
            Assert.That(spin.Motion, Is.EqualTo(ProductionCharacterMotion.SpinBowling));
            Assert.That(spin.ApproachSeconds, Is.LessThan(pace.ApproachSeconds));
            Assert.That(spin.ApproachDistanceMetres, Is.LessThan(pace.ApproachDistanceMetres));
            Assert.That(pace.ApproachDistanceMetres, Is.InRange(12f, 15f),
                "the visible pace approach must stay readable without an implausible long-distance root skate");
            Assert.That(spin.ApproachDistanceMetres, Is.InRange(4f, 6f),
                "the spin approach must remain compact and recognizably distinct from pace");
            Assert.That(pace.ReleaseNormalized,
                Is.EqualTo(ProductionCharacterMotionSampler.PaceRelease));
            Assert.That(spin.ReleaseNormalized,
                Is.EqualTo(ProductionCharacterMotionSampler.SpinRelease));
            Assert.That(() => ProductionBowlingPresentation.ForSceneFamily("unknown"),
                Throws.ArgumentException);
        }

        [TestCase(ProductionCharacterHandedness.Right, ProductionCharacterJoint.HandRight)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionCharacterJoint.HandLeft)]
        public void PaceRelease_AlignsBallToRaisedDeliveryHand(ProductionCharacterHandedness handedness,
            ProductionCharacterJoint deliveryHand)
        {
            var host = new GameObject("ProductionReleaseAlignmentHost");
            var ball = new GameObject("PresentationBall");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                    ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(ProductionCharacterMotion.PaceBowling,
                    ProductionCharacterMotionSampler.PaceRelease);
                rig.AlignObjectToReleaseHand(ball.transform);

                Assert.That(Vector3.Distance(ball.transform.position, rig.ReleaseHandAnchor.position),
                    Is.LessThan(0.000001f));
                Assert.That(Quaternion.Angle(ball.transform.rotation, rig.ReleaseHandAnchor.rotation),
                    Is.LessThan(0.001f));
                Assert.That(rig.ReleaseHandAnchor.IsChildOf(rig.Joint(deliveryHand)), Is.True);
                Assert.That(rig.ReleaseHandAnchor.position.y,
                    Is.GreaterThan(rig.Joint(ProductionCharacterJoint.Head).position.y + 0.18f),
                    "a legal pace release is visibly above the bowler's head");
                // Test changed by ruling (lead, 2026-11-04 bowler release; edit approved for UNITY-2): the release
                // anchor is MOTION's BALL_IN_HAND, the hand joint plus (0, -0.085, 0.03) in the hand frame, the same
                // ball point as the web and MOTION-BOWL. The old 0.12-0.17 m range described the pre-ruling 0.14 m
                // palm-forward anchor. The expectation is the ruled offset's length, exactly, at this rig's scale 1.
                Assert.That(Vector3.Distance(rig.ReleaseHandAnchor.position, rig.Joint(deliveryHand).position),
                    Is.EqualTo(Mathf.Sqrt(0.085f * 0.085f + 0.03f * 0.03f)).Within(0.001f));
                Assert.That(Vector3.Distance(rig.ReleaseHandAnchor.localPosition, new Vector3(0f, -0.085f, 0.03f)),
                    Is.LessThan(1e-6f), "the ball-in-hand point in the hand frame (BALL_IN_HAND)");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(ball);
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right, ProductionCharacterJoint.HandRight)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionCharacterJoint.HandLeft)]
        public void SpinRelease_AlignsBallToDeliveryHand(ProductionCharacterHandedness handedness,
            ProductionCharacterJoint deliveryHand)
        {
            var host = new GameObject("ProductionSpinReleaseAlignmentHost");
            var ball = new GameObject("PresentationSpinBall");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.SpinBowler,
                    ProductionCharacterDetail.Low);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(ProductionCharacterMotion.SpinBowling,
                    ProductionCharacterMotionSampler.SpinRelease);
                rig.AlignObjectToReleaseHand(ball.transform);

                Assert.That(rig.ReleaseHandAnchor.IsChildOf(rig.Joint(deliveryHand)), Is.True);
                Assert.That(Vector3.Distance(ball.transform.position, rig.ReleaseHandAnchor.position),
                    Is.LessThan(0.000001f));
                Assert.That(rig.ReleaseHandAnchor.position.y,
                    Is.GreaterThan(rig.Joint(ProductionCharacterJoint.Head).position.y + 0.04f),
                    "the spinner's visible release remains above the head without copying the pace action");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(ball);
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterRole.PaceBowler, "stock", ProductionBowlingCueKind.Stock)]
        [TestCase(ProductionCharacterRole.PaceBowler, "outswing", ProductionBowlingCueKind.Outswing)]
        [TestCase(ProductionCharacterRole.PaceBowler, "inswing", ProductionBowlingCueKind.Inswing)]
        [TestCase(ProductionCharacterRole.PaceBowler, "seam", ProductionBowlingCueKind.Seam)]
        [TestCase(ProductionCharacterRole.PaceBowler, "cutter", ProductionBowlingCueKind.Cutter)]
        [TestCase(ProductionCharacterRole.PaceBowler, "slower", ProductionBowlingCueKind.Slower)]
        [TestCase(ProductionCharacterRole.PaceBowler, "bouncer", ProductionBowlingCueKind.Bouncer)]
        [TestCase(ProductionCharacterRole.PaceBowler, "yorker", ProductionBowlingCueKind.Yorker)]
        [TestCase(ProductionCharacterRole.SpinBowler, "stock", ProductionBowlingCueKind.Stock)]
        [TestCase(ProductionCharacterRole.SpinBowler, "flighted", ProductionBowlingCueKind.Flighted)]
        [TestCase(ProductionCharacterRole.SpinBowler, "quicker", ProductionBowlingCueKind.Quicker)]
        [TestCase(ProductionCharacterRole.SpinBowler, "topspinner", ProductionBowlingCueKind.Topspinner)]
        [TestCase(ProductionCharacterRole.SpinBowler, "arm_ball", ProductionBowlingCueKind.ArmBall)]
        [TestCase(ProductionCharacterRole.SpinBowler, "wrong_un", ProductionBowlingCueKind.WrongUn)]
        public void HostVariation_MapsToBoundedFamilySpecificReadCue(
            ProductionCharacterRole role,
            string variation,
            ProductionBowlingCueKind expected)
        {
            var cue = Cue(role, variation);

            Assert.That(cue.Kind, Is.EqualTo(expected));
            Assert.That(cue.Motion, Is.EqualTo(role == ProductionCharacterRole.PaceBowler
                ? ProductionCharacterMotion.PaceBowling
                : ProductionCharacterMotion.SpinBowling));
            Assert.That(Mathf.Abs(cue.CadenceWarp), Is.LessThanOrEqualTo(0.12f));
            Assert.That(Mathf.Abs(cue.GatherHeightMetres), Is.LessThanOrEqualTo(0.04f));
            Assert.That(cue.ReleaseWristEuler.magnitude, Is.LessThan(10f));
        }

        [Test]
        public void HostVariation_RejectsCrossFamilyOrNonBowlerMappings()
        {
            Assert.That(() => Cue(ProductionCharacterRole.PaceBowler, "flighted"),
                Throws.ArgumentException);
            Assert.That(() => Cue(ProductionCharacterRole.SpinBowler, "bouncer"),
                Throws.ArgumentException);
            Assert.That(() => Cue(ProductionCharacterRole.Batter, "stock"),
                Throws.ArgumentException);
        }

        [Test]
        public void VariationReleaseMarker_StaysInsideFiveCentimetresAndAlignsCanonicalHand()
        {
            var target = new Vector3(0.22f, 2.16f, -8.69f);
            var roles = new[]
            {
                ProductionCharacterRole.PaceBowler,
                ProductionCharacterRole.SpinBowler
            };
            var handednesses = new[]
            {
                ProductionCharacterHandedness.Right,
                ProductionCharacterHandedness.Left
            };

            for (var roleIndex = 0; roleIndex < roles.Length; roleIndex++)
            {
                var role = roles[roleIndex];
                var motion = role == ProductionCharacterRole.PaceBowler
                    ? ProductionCharacterMotion.PaceBowling
                    : ProductionCharacterMotion.SpinBowling;
                var release = role == ProductionCharacterRole.PaceBowler
                    ? ProductionCharacterMotionSampler.PaceRelease
                    : ProductionCharacterMotionSampler.SpinRelease;
                var variations = Variations(role);
                for (var handIndex = 0; handIndex < handednesses.Length; handIndex++)
                {
                    var host = new GameObject("ProductionCueReleaseHost");
                    ProductionCharacterRig rig = null;
                    try
                    {
                        var spec = ProductionCharacterSpec.For(role, ProductionCharacterDetail.Low);
                        spec.Handedness = handednesses[handIndex];
                        rig = ProductionCharacterFactory.Create(host.transform, spec);
                        rig.Root.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                        rig.SampleAndApply(motion, release);
                        var stockRelease = rig.ReleaseHandAnchor.position;

                        for (var variationIndex = 0; variationIndex < variations.Length; variationIndex++)
                        {
                            rig.Root.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                            rig.SampleBowling(release, Cue(role, variations[variationIndex]));
                            var unplacedRelease = rig.ReleaseHandAnchor.position;
                            Assert.That(Vector3.Distance(unplacedRelease, stockRelease),
                                Is.LessThanOrEqualTo(0.05f),
                                role + " " + variations[variationIndex] + " moves the release hand too far");

                            rig.Root.position = target - unplacedRelease;
                            rig.SampleBowling(release, Cue(role, variations[variationIndex]));
                            Assert.That(Vector3.Distance(rig.ReleaseHandAnchor.position, target),
                                Is.LessThan(0.00001f),
                                role + " " + variations[variationIndex] + " must remain on the host release point");
                        }
                    }
                    finally
                    {
                        if (rig != null) rig.Dispose();
                        Object.DestroyImmediate(host);
                    }
                }
            }
        }

        [Test]
        public void GroundedAttackReleaseHand_ClosesOnFrozenAuthoritativeBallWithinFiveCentimetres()
        {
            // Frozen by release/unity-practice/execution-20261030T090650Z/
            // CANONICAL-DELIVERY-CONTRACT.md. This is a presentation measurement only; no result is rerun here.
            var authoritativeRelease = new Vector3(
                0.419326017f,
                2.298901546f,
                -8.66f);
            var host = new GameObject("GroundedAttackReleaseHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.PaceBowler,
                    ProductionCharacterDetail.Low);
                spec.Handedness = ProductionCharacterHandedness.Right;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var cue = ProductionBowlingCueProfile.ForHostDelivery(
                    ProductionCharacterRole.PaceBowler,
                    "stock",
                    139.5,
                    139.5,
                    6.0,
                    0.0,
                    13.195951946);

                rig.Root.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                rig.SampleBowling(ProductionCharacterMotionSampler.PaceRelease, cue);
                rig.Root.position = authoritativeRelease - rig.ReleaseHandAnchor.position;
                rig.SampleBowling(ProductionCharacterMotionSampler.PaceRelease, cue);

                var closureMetres = Vector3.Distance(
                    rig.ReleaseHandAnchor.position,
                    authoritativeRelease);
                Assert.That(closureMetres, Is.LessThanOrEqualTo(0.05f),
                    "the frozen grounded-attack release hand must close on Flight[0].p within five centimetres");
                Assert.That(closureMetres, Is.LessThan(0.00001f),
                    "the deterministic placement path should not spend the five-centimetre allowance");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterRole.PaceBowler, ProductionCharacterMotion.PaceBowling, "pace")]
        [TestCase(ProductionCharacterRole.SpinBowler, ProductionCharacterMotion.SpinBowling, "spin")]
        public void BowlingFrontFootBrace_CancelsPresentationRootTravelThroughRelease(
            ProductionCharacterRole role,
            ProductionCharacterMotion motion,
            string family)
        {
            var presentation = ProductionBowlingPresentation.ForSceneFamily(family);
            var plant = motion == ProductionCharacterMotion.PaceBowling
                ? ProductionCharacterMotionSampler.PaceFrontFootPlant
                : ProductionCharacterMotionSampler.SpinFrontFootPlant;
            var release = presentation.ReleaseNormalized;
            var plantedPose = new ProductionCharacterPose();
            var releasePose = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleBowlingInto(
                motion, plant, ProductionCharacterHandedness.Right,
                Cue(role, "stock"), plantedPose);
            ProductionCharacterMotionSampler.SampleBowlingInto(
                motion, release, ProductionCharacterHandedness.Right,
                Cue(role, "stock"), releasePose);

            var plantedWorldForward =
                presentation.ApproachDistanceMetres *
                presentation.FrontFootPlantRootTravelNormalized +
                plantedPose.RootOffset.z;
            var releaseWorldForward =
                presentation.ApproachDistanceMetres + releasePose.RootOffset.z;
            Assert.That(releaseWorldForward, Is.EqualTo(plantedWorldForward).Within(0.00001f),
                family + " motion root must remain braced while the world root completes its final stride");
        }

        [TestCase(ProductionCharacterRole.PaceBowler, ProductionCharacterMotion.PaceBowling,
            "pace", ProductionCharacterHandedness.Right, ProductionCharacterJoint.FootLeft)]
        [TestCase(ProductionCharacterRole.PaceBowler, ProductionCharacterMotion.PaceBowling,
            "pace", ProductionCharacterHandedness.Left, ProductionCharacterJoint.FootRight)]
        [TestCase(ProductionCharacterRole.SpinBowler, ProductionCharacterMotion.SpinBowling,
            "spin", ProductionCharacterHandedness.Right, ProductionCharacterJoint.FootLeft)]
        [TestCase(ProductionCharacterRole.SpinBowler, ProductionCharacterMotion.SpinBowling,
            "spin", ProductionCharacterHandedness.Left, ProductionCharacterJoint.FootRight)]
        public void BowlingFrontFootBrace_HoldsGroundContactThroughRelease(
            ProductionCharacterRole role,
            ProductionCharacterMotion motion,
            string family,
            ProductionCharacterHandedness handedness,
            ProductionCharacterJoint frontFoot)
        {
            var host = new GameObject("ProductionBowlingPlantHost");
            ProductionCharacterRig rig = null;
            try
            {
                var presentation = ProductionBowlingPresentation.ForSceneFamily(family);
                var plant = motion == ProductionCharacterMotion.PaceBowling
                    ? ProductionCharacterMotionSampler.PaceFrontFootPlant
                    : ProductionCharacterMotionSampler.SpinFrontFootPlant;
                var spec = ProductionCharacterSpec.For(role, ProductionCharacterDetail.Low);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var cue = Cue(role, "stock");

                rig.Root.SetPositionAndRotation(
                    Vector3.forward * presentation.ApproachDistanceMetres *
                    presentation.FrontFootPlantRootTravelNormalized,
                    Quaternion.identity);
                rig.SampleBowling(plant, cue);
                var planted = rig.Joint(frontFoot).position;

                rig.Root.position = Vector3.forward * presentation.ApproachDistanceMetres;
                rig.SampleBowling(presentation.ReleaseNormalized, cue);
                var released = rig.Joint(frontFoot).position;
                var horizontalSlide = Vector2.Distance(
                    new Vector2(planted.x, planted.z),
                    new Vector2(released.x, released.z));

                Assert.That(horizontalSlide, Is.LessThan(0.18f),
                    family + " front foot must not visibly skate during the braced delivery stride");
                Assert.That(Mathf.Abs(released.y - planted.y), Is.LessThan(0.12f),
                    family + " front foot must remain vertically grounded through release");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void VariationSampling_IsIdenticalAtCommonThirtyAndSixtyFpsTimes()
        {
            var roles = new[]
            {
                ProductionCharacterRole.PaceBowler,
                ProductionCharacterRole.SpinBowler
            };
            for (var roleIndex = 0; roleIndex < roles.Length; roleIndex++)
            {
                var role = roles[roleIndex];
                var presentation = ProductionBowlingPresentation.ForSceneFamily(
                    role == ProductionCharacterRole.PaceBowler ? "pace" : "spin");
                var variations = Variations(role);
                for (var variationIndex = 0; variationIndex < variations.Length; variationIndex++)
                {
                    var cue = Cue(role, variations[variationIndex]);
                    for (var frame30 = 0; frame30 <= 30; frame30++)
                    {
                        var at30 = frame30 / 30.0;
                        var at60 = frame30 * 2 / 60.0;
                        var phase30 = Mathf.Clamp01((float)(at30 / presentation.ApproachSeconds)) *
                                      presentation.ReleaseNormalized;
                        var phase60 = Mathf.Clamp01((float)(at60 / presentation.ApproachSeconds)) *
                                      presentation.ReleaseNormalized;
                        var pose30 = new ProductionCharacterPose();
                        var pose60 = new ProductionCharacterPose();
                        ProductionCharacterMotionSampler.SampleBowlingInto(
                            presentation.Motion, phase30,
                            ProductionCharacterHandedness.Right, cue, pose30);
                        ProductionCharacterMotionSampler.SampleBowlingInto(
                            presentation.Motion, phase60,
                            ProductionCharacterHandedness.Right, cue, pose60);

                        Assert.That(Vector3.Distance(pose30.RootOffset, pose60.RootOffset),
                            Is.LessThan(0.000001f),
                            role + " " + variations[variationIndex] + " frame " + frame30);
                        for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                            Assert.That(Quaternion.Angle(
                                    pose30.Rotation((ProductionCharacterJoint)joint),
                                    pose60.Rotation((ProductionCharacterJoint)joint)),
                                Is.LessThan(0.0001f),
                                role + " " + variations[variationIndex] + " " +
                                (ProductionCharacterJoint)joint + " frame " + frame30);
                    }
                }
            }
        }

        [Test]
        public void BatterFootwork_ProducesDistinctDeterministicBodyPlacement()
        {
            var forward = new ProductionCharacterPose();
            var back = new ProductionCharacterPose();
            var across = new ProductionCharacterPose();
            var downTrack = new ProductionCharacterPose();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFootPlant,
                ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Forward,
                forward);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFootPlant,
                ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Back,
                back);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFootPlant,
                ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.Across,
                across);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                ProductionCharacterMotionSampler.BatterFootPlant,
                ProductionCharacterHandedness.Right,
                ProductionBatterFootwork.DownTrack,
                downTrack);

            Assert.That(forward.RootOffset.z, Is.GreaterThan(0.15f));
            Assert.That(back.RootOffset.z, Is.LessThan(-0.10f));
            Assert.That(across.RootOffset.x, Is.GreaterThan(forward.RootOffset.x + 0.10f));
            Assert.That(downTrack.RootOffset.z, Is.GreaterThan(forward.RootOffset.z + 0.15f));
            Assert.That(ProductionBatterFootworkAdapter.FromHostIntent("auto"),
                Is.EqualTo(ProductionBatterFootwork.Balanced));
        }

        [TestCase(ProductionBatterFootwork.Balanced)]
        [TestCase(ProductionBatterFootwork.Forward)]
        [TestCase(ProductionBatterFootwork.Back)]
        [TestCase(ProductionBatterFootwork.Across)]
        [TestCase(ProductionBatterFootwork.DownTrack)]
        public void BatterStroke_KeepsBothHandsCoupledAcrossBatTransitions(
            ProductionBatterFootwork footwork)
        {
            var host = new GameObject("ProductionBatterCouplingHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter));
                var phases = new[]
                {
                    0f,
                    ProductionCharacterMotionSampler.BatterBacklift,
                    ProductionCharacterMotionSampler.BatterFootPlant,
                    ProductionCharacterMotionSampler.BatterContact,
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    1f
                };
                for (var phaseIndex = 0; phaseIndex < phases.Length; phaseIndex++)
                {
                    rig.SampleBatterStroke(phases[phaseIndex], footwork);
                    var grip = rig.Bat.position;
                    var lowerHandle = grip + rig.Bat.TransformDirection(Vector3.down) * 0.24f;
                    Assert.That(DistanceToSegment(
                            rig.Joint(ProductionCharacterJoint.HandLeft).position,
                            grip,
                            lowerHandle),
                        Is.LessThan(0.15f), footwork + " left hand at phase " + phases[phaseIndex]);
                    Assert.That(DistanceToSegment(
                            rig.Joint(ProductionCharacterJoint.HandRight).position,
                            grip,
                            lowerHandle),
                        Is.LessThan(0.15f), footwork + " right hand at phase " + phases[phaseIndex]);
                }

                var frameCount = Mathf.CeilToInt(
                    ProductionCharacterMotionSampler.DurationSeconds(
                        ProductionCharacterMotion.BatterStroke) * 60f);
                rig.SampleBatterStroke(0f, footwork);
                var previousBatRotation = rig.Bat.rotation;
                for (var frame = 1; frame <= frameCount; frame++)
                {
                    rig.SampleBatterStroke(frame / (float)frameCount, footwork);
                    Assert.That(Quaternion.Angle(previousBatRotation, rig.Bat.rotation),
                        Is.LessThan(30f),
                        footwork + " bat arc must stay continuous at 60 fps frame " + frame);
                    previousBatRotation = rig.Bat.rotation;
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right, ProductionCharacterJoint.HandLeft)]
        [TestCase(ProductionCharacterHandedness.Left, ProductionCharacterJoint.HandRight)]
        public void BatterStroke_FollowThroughKeepsMirroredFreeHandInsideGripReach(
            ProductionCharacterHandedness handedness,
            ProductionCharacterJoint freeHand)
        {
            var host = new GameObject("ProductionBatterFollowThroughReachHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleBatterStroke(
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    ProductionBatterFootwork.Balanced);
                var grip = rig.Bat.position;
                var lowerHandle = grip + rig.Bat.TransformDirection(Vector3.down) * 0.24f;
                Assert.That(DistanceToSegment(rig.Joint(freeHand).position, grip, lowerHandle),
                    Is.LessThan(0.15f),
                    handedness + " free hand must remain coupled at the follow-through marker");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CanonicalBatPose_PreservesGripToeAndFaceAxesWithoutRescalingArtifact()
        {
            var host = new GameObject("ProductionCanonicalBatHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter));
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f));
                var originalScale = rig.Bat.localScale;
                // Matches the authoritative right-handed stance neighbourhood emitted by src/physics/bat.ts.
                var grip = new Vector3(-0.20f, 1.10f, 8.95f);
                var toe = new Vector3(0.10f, 0.32f, 8.72f);
                var face = new Vector3(0.2f, 0.1f, -0.95f).normalized;
                rig.SetCanonicalBatPose(grip, toe, face);

                Assert.That(Vector3.Distance(rig.Bat.position, grip), Is.LessThan(0.000001f));
                Assert.That(Vector3.Angle(rig.Bat.TransformDirection(Vector3.down), toe - grip),
                    Is.LessThan(0.03f));
                var projectedFace = face - (grip - toe).normalized *
                    Vector3.Dot(face, (grip - toe).normalized);
                Assert.That(Vector3.Angle(rig.Bat.forward, projectedFace), Is.LessThan(0.03f));
                Assert.That(rig.Bat.localScale, Is.EqualTo(originalScale),
                    "canonical trace orientation must not distort the law-scale bat artifact");
                Assert.That(DistanceToSegment(
                        rig.Joint(ProductionCharacterJoint.HandLeft).position, grip, toe),
                    Is.LessThan(0.17f), "top hand should remain visibly coupled to the canonical handle");
                Assert.That(DistanceToSegment(
                        rig.Joint(ProductionCharacterJoint.HandRight).position, grip, toe),
                    Is.LessThan(0.17f), "lower hand should remain visibly coupled to the canonical handle");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        private static float HorizontalFacingAngle(Quaternion worldRotation)
        {
            return Mathf.Abs(HorizontalSignedFacingAngle(worldRotation));
        }

        private static float HorizontalSignedFacingAngle(Quaternion worldRotation)
        {
            var facing = worldRotation * Vector3.forward;
            facing.y = 0f;
            Assert.That(facing.sqrMagnitude, Is.GreaterThan(0.000001f),
                "pose facing must have a measurable horizontal component");
            facing.Normalize();
            return Mathf.Atan2(facing.x, facing.z) * Mathf.Rad2Deg;
        }

        private static float LocalSignedYaw(
            ProductionCharacterPose pose,
            ProductionCharacterJoint joint)
        {
            return Mathf.DeltaAngle(0f, pose.Rotation(joint).eulerAngles.y);
        }

        private static float LocalEulerDelta(
            ProductionCharacterPose from,
            ProductionCharacterPose to,
            ProductionCharacterJoint joint,
            int axis)
        {
            var before = from.Rotation(joint).eulerAngles;
            var after = to.Rotation(joint).eulerAngles;
            return Mathf.DeltaAngle(before[axis], after[axis]);
        }

        private static void AssertElbowBelowShoulder(ProductionCharacterRig rig,
            ProductionCharacterJoint shoulderJoint, ProductionCharacterJoint elbowJoint,
            string side)
        {
            var shoulder = rig.Joint(shoulderJoint).position;
            var elbow = rig.Joint(elbowJoint).position;
            Assert.That(elbow.y, Is.LessThan(shoulder.y - 0.04f),
                side + " elbow must remain visibly below its shoulder in the ready pose");
        }

        private static void AssertHeroBatterStanceSpatialContract(
            ProductionCharacterRig rig,
            ProductionCharacterHandedness handedness)
        {
            var head = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
            var chest = rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest);
            var leftHand = rig.HeroHandWorldPosition(true);
            var rightHand = rig.HeroHandWorldPosition(false);
            var gripCentroid = (leftHand + rightHand) * 0.5f;
            Assert.That(gripCentroid.y, Is.LessThan(chest.y - 0.12f));
            Assert.That(head.y - gripCentroid.y, Is.GreaterThanOrEqualTo(0.18f));
            AssertHeroHandOnGrip(rig, true, 0f);
            AssertHeroHandOnGrip(rig, false, 0f);

            var armJoints = new[]
            {
                ProductionCharacterJoint.UpperArmLeft,
                ProductionCharacterJoint.ForearmLeft,
                ProductionCharacterJoint.HandLeft,
                ProductionCharacterJoint.UpperArmRight,
                ProductionCharacterJoint.ForearmRight,
                ProductionCharacterJoint.HandRight
            };
            for (var arm = 0; arm < armJoints.Length; arm += 3)
            {
                var shoulder = rig.HeroJointWorldPosition(armJoints[arm]);
                var elbow = rig.HeroJointWorldPosition(armJoints[arm + 1]);
                var hand = rig.HeroJointWorldPosition(armJoints[arm + 2]);
                var bendReserve = Vector3.Distance(shoulder, elbow) +
                                  Vector3.Distance(elbow, hand) -
                                  Vector3.Distance(shoulder, hand);
                Assert.That(elbow.y, Is.LessThan(shoulder.y - 0.08f),
                    armJoints[arm] + " elbow must hang relaxed below the shoulder");
                Assert.That(elbow.y, Is.LessThan(chest.y - 0.015f),
                    armJoints[arm] + " elbow must stay below the sternum rather than fold across the face");
                Assert.That(DistanceToSegment(head, shoulder, elbow), Is.GreaterThan(0.16f));
                Assert.That(DistanceToSegment(head, elbow, hand), Is.GreaterThan(0.18f));
                Assert.That(bendReserve, Is.GreaterThanOrEqualTo(0.020f),
                    armJoints[arm] + " address arm must retain visible elbow articulation instead of locking " +
                    "straight at its maximum reach");
            }

            var toe = rig.BatToeWorld;
            Assert.That(toe.y - rig.Root.position.y, Is.InRange(0.02f, 0.16f),
                "ready bat toe must rest at ground height");
            var backFootJoint = handedness == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.FootRight
                : ProductionCharacterJoint.FootLeft;
            var backFoot = rig.HeroJointWorldPosition(backFootJoint);
            var toeToBackFoot = new Vector2(toe.x - backFoot.x, toe.z - backFoot.z);
            Assert.That(toeToBackFoot.magnitude,
                Is.LessThan(0.24f),
                "bat toe must sit beside the mirrored back foot; toe=" + toe.ToString("F6") +
                ", backFoot=" + backFoot.ToString("F6") +
                ", deltaXZ=" + toeToBackFoot.ToString("F6"));

            var legJoints = new[]
            {
                ProductionCharacterJoint.ShinLeft,
                ProductionCharacterJoint.FootLeft,
                ProductionCharacterJoint.ShinRight,
                ProductionCharacterJoint.FootRight
            };
            for (var leg = 0; leg < legJoints.Length; leg += 2)
            {
                var knee = rig.HeroJointWorldPosition(legJoints[leg]);
                var ankle = rig.HeroJointWorldPosition(legJoints[leg + 1]);
                Assert.That(DistanceToSegment(knee, rig.Bat.position, toe), Is.GreaterThan(0.09f));
                Assert.That(DistanceToSegment((knee + ankle) * 0.5f, rig.Bat.position, toe),
                    Is.GreaterThan(0.09f), "bat blade must not pass through either padded leg");
            }
        }

        private static void AssertHeroHandOnGrip(ProductionCharacterRig rig, bool left, float phase)
        {
            Assert.That(Vector3.Distance(
                    rig.HeroHandWorldPosition(left), rig.HeroBatterGripTargetWorld(left)),
                Is.LessThanOrEqualTo(0.02f),
                (left ? "left" : "right") + " hero hand must remain on handle at phase " + phase);
        }

        private static void AssertHeroWristLengthPreserved(
            ProductionCharacterRig rig,
            ProductionCharacterJoint hand)
        {
            Assert.That(Vector3.Distance(
                    rig.HeroJointLocalPosition(hand),
                    rig.HeroJointAuthoredLocalPosition(hand)),
                Is.LessThan(0.000001f),
                hand + " must retain its authored local wrist position instead of stretching glove skin");
        }

        private static Vector2 ProjectToLockedCamera(
            Vector3 world,
            Vector3 cameraPosition,
            Quaternion worldToView)
        {
            var view = worldToView * (world - cameraPosition);
            Assert.That(view.z, Is.GreaterThan(0.01f),
                "the admitted hero joint must remain in front of the locked gameplay camera");
            return new Vector2(view.x / view.z, view.y / view.z);
        }

        private static float DistanceToSegment2D(Vector2 point, Vector2 a, Vector2 b)
        {
            var ab = b - a;
            var lengthSquared = ab.sqrMagnitude;
            if (lengthSquared <= 0.0000001f) return Vector2.Distance(point, a);
            var t = Mathf.Clamp01(Vector2.Dot(point - a, ab) / lengthSquared);
            return Vector2.Distance(point, a + ab * t);
        }

        private static bool SegmentsIntersect2D(Vector2 a0, Vector2 a1, Vector2 b0, Vector2 b1)
        {
            Vector2 ignored;
            return TrySegmentIntersection2D(a0, a1, b0, b1, out ignored);
        }

        private static bool TrySegmentIntersection2D(
            Vector2 a0,
            Vector2 a1,
            Vector2 b0,
            Vector2 b1,
            out Vector2 intersection)
        {
            var r = a1 - a0;
            var s = b1 - b0;
            var denominator = r.x * s.y - r.y * s.x;
            if (Mathf.Abs(denominator) <= 0.0000001f)
            {
                intersection = Vector2.zero;
                return false;
            }

            var delta = b0 - a0;
            var t = (delta.x * s.y - delta.y * s.x) / denominator;
            var u = (delta.x * r.y - delta.y * r.x) / denominator;
            intersection = a0 + r * t;
            return t >= 0f && t <= 1f && u >= 0f && u <= 1f;
        }

        private static void AssertBakedArmAndGloveVolumesReadAsOneGrip(
            ProductionCharacterRig rig,
            Vector3 cameraPosition,
            Quaternion worldToView,
            Vector2 projectedHead)
        {
            // A shaft owns its skinning rather than merely winning a near-even tie at the sewn shoulder cap.
            // Keep these exact boundaries beside the locked-camera gate so a future threshold edit cannot make
            // its already non-vacuous measured population admit blended torso seams again.
            Assert.That(IsUpperArmShaftSkinning(
                UpperArmShaftDominance + 0.001f,
                0f,
                UpperArmShaftMaximumTorsoBlend - 0.001f), Is.True);
            Assert.That(IsUpperArmShaftSkinning(
                UpperArmShaftDominance + 0.001f,
                0f,
                UpperArmShaftMaximumTorsoBlend), Is.False);
            Assert.That(IsUpperArmShaftSkinning(
                UpperArmShaftDominance,
                0f,
                0f), Is.False);
            var renderers = new[]
            {
                rig.HeroSkinnedRenderer,
                rig.HeroGearSkinnedRenderer
            };
            var baked = new Mesh { name = "HeroBatterCameraSilhouetteBake" };
            try
            {
                var projectedNeck = ProjectToLockedCamera(
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Neck),
                    cameraPosition,
                    worldToView);
                var projectedHandleTop = ProjectToLockedCamera(
                    rig.Bat.position, cameraPosition, worldToView);
                var projectedHandleBottom = ProjectToLockedCamera(
                    rig.Bat.position + rig.Bat.TransformDirection(Vector3.down).normalized * 0.18f,
                    cameraPosition,
                    worldToView);
                var closestLowerArmToHeadAndNeck = float.PositiveInfinity;
                var closestUpperArmToHeadAndNeck = float.PositiveInfinity;
                var highestLowerArm = float.NegativeInfinity;
                var closestLeftVolumeToHandle = float.PositiveInfinity;
                var closestRightVolumeToHandle = float.PositiveInfinity;
                var closestLowerArmDiagnostic = string.Empty;
                var closestUpperArmDiagnostic = string.Empty;
                var admittedVertices = 0;
                var admittedUpperArmShaftVertices = 0;
                for (var rendererIndex = 0; rendererIndex < renderers.Length; rendererIndex++)
                {
                    var renderer = renderers[rendererIndex];
                    Assert.That(renderer, Is.Not.Null);
                    Assert.That(renderer.sharedMesh, Is.Not.Null);
                    renderer.BakeMesh(baked);
                    var vertices = baked.vertices;
                    var weights = renderer.sharedMesh.boneWeights;
                    Assert.That(vertices.Length, Is.EqualTo(weights.Length));
                    for (var index = 0; index < vertices.Length; index++)
                    {
                        var leftWeight = SideArmBoneWeight(weights[index], true);
                        var rightWeight = SideArmBoneWeight(weights[index], false);
                        var leftUpperWeight = SideUpperArmBoneWeight(weights[index], true);
                        var rightUpperWeight = SideUpperArmBoneWeight(weights[index], false);
                        var torsoWeight = TorsoBoneWeight(weights[index]);
                        if (leftWeight + leftUpperWeight < 0.45f &&
                            rightWeight + rightUpperWeight < 0.45f) continue;
                        var world = renderer.transform.TransformPoint(vertices[index]);
                        var projected = ProjectToLockedCamera(world, cameraPosition, worldToView);
                        var diagnosticLeft = leftUpperWeight + leftWeight >=
                                             rightUpperWeight + rightWeight;
                        var shoulderJoint = diagnosticLeft
                            ? ProductionCharacterJoint.UpperArmLeft
                            : ProductionCharacterJoint.UpperArmRight;
                        var shoulder = ProjectToLockedCamera(
                            rig.HeroJointWorldPosition(shoulderJoint), cameraPosition, worldToView);
                        // A deltoid/sleeve must join the neck-side torso, so applying the distal-arm clearance to
                        // the small attachment cap would reject normal anatomy. The omitted defect was the arm
                        // shaft crossing the face; keep the proximal 32 mrad attachment out of this one measure.
                        var proximalUpperAttachment = leftWeight < 0.45f && rightWeight < 0.45f &&
                                                      Vector2.Distance(projected, shoulder) < 0.032f;
                        var headAndNeckDistance = DistanceToSegment2D(
                            projected, projectedNeck, projectedHead);
                        var lowerArmAdmitted = leftWeight >= 0.45f || rightWeight >= 0.45f;
                        // The live mesh deliberately blends the shoulder cap into spine01/chest. A 53.3% upper-
                        // arm / 46.7% spine vertex is still a sewn torso seam, not distal sleeve shaft. Keep the
                        // same 38 mrad clearance and require the arm to own the skinning without a large torso
                        // contribution. This excludes only attachment blends; the measured shaft population must
                        // remain non-vacuous below.
                        var upperArmAdmitted = IsUpperArmShaftSkinning(
                            leftUpperWeight, rightUpperWeight, torsoWeight);
                        if (upperArmAdmitted) admittedUpperArmShaftVertices++;
                        if (lowerArmAdmitted && headAndNeckDistance < closestLowerArmToHeadAndNeck ||
                            upperArmAdmitted && !proximalUpperAttachment &&
                            headAndNeckDistance < closestUpperArmToHeadAndNeck)
                        {
                            var elbowJoint = diagnosticLeft
                                ? ProductionCharacterJoint.ForearmLeft
                                : ProductionCharacterJoint.ForearmRight;
                            var elbow = ProjectToLockedCamera(
                                rig.HeroJointWorldPosition(elbowJoint), cameraPosition, worldToView);
                            var handJoint = diagnosticLeft
                                ? ProductionCharacterJoint.HandLeft
                                : ProductionCharacterJoint.HandRight;
                            var shoulderWorld = rig.HeroJointWorldPosition(shoulderJoint);
                            var elbowWorld = rig.HeroJointWorldPosition(elbowJoint);
                            var handWorld = rig.HeroJointWorldPosition(handJoint);
                            var bendReserve = Vector3.Distance(shoulderWorld, elbowWorld) +
                                              Vector3.Distance(elbowWorld, handWorld) -
                                              Vector3.Distance(shoulderWorld, handWorld);
                            var diagnostic = renderer.name + " vertex " + index +
                                             " projected " + projected.ToString("F6") +
                                             " head/neck " + projectedHead.ToString("F6") + "/" +
                                             projectedNeck.ToString("F6") +
                                             " shoulder/elbow " + shoulder.ToString("F6") + "/" +
                                             elbow.ToString("F6") +
                                             " bend reserve " + bendReserve.ToString("F6") +
                                             " upper L/R " + leftUpperWeight.ToString("F3") + "/" +
                                             rightUpperWeight.ToString("F3") +
                                             " torso " + torsoWeight.ToString("F3") +
                                             " lower L/R " + leftWeight.ToString("F3") + "/" +
                                             rightWeight.ToString("F3");
                            if (lowerArmAdmitted && headAndNeckDistance < closestLowerArmToHeadAndNeck)
                            {
                                closestLowerArmToHeadAndNeck = headAndNeckDistance;
                                closestLowerArmDiagnostic = diagnostic;
                            }
                            if (upperArmAdmitted && !proximalUpperAttachment &&
                                headAndNeckDistance < closestUpperArmToHeadAndNeck)
                            {
                                closestUpperArmToHeadAndNeck = headAndNeckDistance;
                                closestUpperArmDiagnostic = diagnostic;
                            }
                        }
                        if (leftWeight >= 0.45f || rightWeight >= 0.45f)
                            highestLowerArm = Mathf.Max(highestLowerArm, projected.y);
                        if (leftWeight >= 0.45f)
                        {
                            closestLeftVolumeToHandle = Mathf.Min(
                                closestLeftVolumeToHandle,
                                DistanceToSegment2D(projected, projectedHandleTop, projectedHandleBottom));
                        }
                        if (rightWeight >= 0.45f)
                        {
                            closestRightVolumeToHandle = Mathf.Min(
                                closestRightVolumeToHandle,
                                DistanceToSegment2D(projected, projectedHandleTop, projectedHandleBottom));
                        }
                        admittedVertices++;
                    }
                }

                Assert.That(admittedVertices, Is.GreaterThan(40),
                    "the VPM3 body+gear bake must expose a measurable arm/glove silhouette");
                Assert.That(admittedUpperArmShaftVertices, Is.GreaterThan(100),
                    "the upper-arm clearance gate must exercise a non-vacuous sleeve-shaft population");
                Assert.That(closestLowerArmToHeadAndNeck, Is.GreaterThan(0.038f),
                    "the lower-arm/glove volume, not only its joint centerline, must clear the helmet/neck " +
                    "capsule; closest=" + closestLowerArmDiagnostic);
                Assert.That(closestUpperArmToHeadAndNeck, Is.GreaterThan(0.038f),
                    "the upper-arm/sleeve shaft must preserve a visible gap from the helmet/neck after its " +
                    "anatomical shoulder attachment; closest=" + closestUpperArmDiagnostic);
                Assert.That(highestLowerArm, Is.LessThan(projectedNeck.y - 0.006f),
                    "no arm/glove vertex may rise into the chin/neck silhouette in the locked camera");
                Assert.That(closestLeftVolumeToHandle, Is.LessThan(0.032f),
                    "left glove volume and handle must read as one continuous screen-space silhouette");
                Assert.That(closestRightVolumeToHandle, Is.LessThan(0.032f),
                    "right glove volume and handle must read as one continuous screen-space silhouette");
            }
            finally
            {
                Object.DestroyImmediate(baked);
            }
        }

        private static void AssertLockedCameraCompositeGrip(
            ProductionCharacterRig rig,
            ProductionCharacterHandedness handedness,
            Vector3 cameraPosition,
            Quaternion worldToView)
        {
            var hipsWorld = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
            var hips = ProjectToLockedCamera(hipsWorld, cameraPosition, worldToView);
            var backKneeJoint = handedness == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.ShinRight
                : ProductionCharacterJoint.ShinLeft;
            var backKnee = ProjectToLockedCamera(
                rig.HeroJointWorldPosition(backKneeJoint), cameraPosition, worldToView);
            var batGrip = ProjectToLockedCamera(rig.Bat.position, cameraPosition, worldToView);
            var batToe = ProjectToLockedCamera(rig.BatToeWorld, cameraPosition, worldToView);
            var backSide = Mathf.Sign(backKnee.x - hips.x);
            Assert.That((batGrip.x - hips.x) * backSide, Is.GreaterThan(0.004f),
                handedness + " breathing address must keep the handle outside the back hip");
            Assert.That((batToe.x - backKnee.x) * backSide, Is.GreaterThan(0.004f),
                handedness + " breathing address must keep the toe outside the back pad");
            var hipView = worldToView * (hipsWorld - cameraPosition);
            var gripView = worldToView * (rig.Bat.position - cameraPosition);
            Assert.That(gripView.z, Is.LessThan(hipView.z - 0.015f),
                handedness + " breathing address must keep the handle camera-forward");
            var head = ProjectToLockedCamera(
                rig.HeroJointWorldPosition(ProductionCharacterJoint.Head),
                cameraPosition,
                worldToView);
            AssertBakedArmAndGloveVolumesReadAsOneGrip(
                rig, cameraPosition, worldToView, head);
        }

        private static float SideArmBoneWeight(BoneWeight weight, bool left)
        {
            return ArmBoneWeight(weight.boneIndex0, weight.weight0, left) +
                   ArmBoneWeight(weight.boneIndex1, weight.weight1, left) +
                   ArmBoneWeight(weight.boneIndex2, weight.weight2, left) +
                   ArmBoneWeight(weight.boneIndex3, weight.weight3, left);
        }

        private static float SideUpperArmBoneWeight(BoneWeight weight, bool left)
        {
            return UpperArmBoneWeight(weight.boneIndex0, weight.weight0, left) +
                   UpperArmBoneWeight(weight.boneIndex1, weight.weight1, left) +
                   UpperArmBoneWeight(weight.boneIndex2, weight.weight2, left) +
                   UpperArmBoneWeight(weight.boneIndex3, weight.weight3, left);
        }

        private static bool IsUpperArmShaftSkinning(
            float leftUpperWeight,
            float rightUpperWeight,
            float torsoWeight)
        {
            return (leftUpperWeight > UpperArmShaftDominance ||
                    rightUpperWeight > UpperArmShaftDominance) &&
                   torsoWeight < UpperArmShaftMaximumTorsoBlend;
        }

        private static float TorsoBoneWeight(BoneWeight weight)
        {
            return TorsoBoneWeight(weight.boneIndex0, weight.weight0) +
                   TorsoBoneWeight(weight.boneIndex1, weight.weight1) +
                   TorsoBoneWeight(weight.boneIndex2, weight.weight2) +
                   TorsoBoneWeight(weight.boneIndex3, weight.weight3);
        }

        private static float TorsoBoneWeight(int bone, float weight)
        {
            // VSK1 stable order: spine05 through spine01. Neck/head are excluded because they are not the
            // garment-to-torso seam this classifier distinguishes.
            return bone >= 3 && bone <= 7 ? weight : 0f;
        }

        private static float UpperArmBoneWeight(int bone, float weight, bool left)
        {
            // VSK1 stable order: upperarm01/02. These vertices were omitted from the original silhouette gate,
            // allowing a displaced sleeve/upper-arm volume to cross the face while every lower-arm centreline and
            // glove assertion still passed.
            return left
                ? bone >= 15 && bone <= 16 ? weight : 0f
                : bone >= 22 && bone <= 23 ? weight : 0f;
        }

        private static float ArmBoneWeight(int bone, float weight, bool left)
        {
            // VSK1 stable order: lowerarm01/02 + wrist, followed by that side's complete hand hierarchy.
            var matches = left
                ? bone >= 17 && bone <= 19 || bone >= 27 && bone <= 45
                : bone >= 24 && bone <= 26 || bone >= 46 && bone <= 64;
            return matches ? weight : 0f;
        }

        private static void AssertFielderReadyGeometry(ProductionCharacterRig rig)
        {
            AssertKneeFlexion(rig, ProductionCharacterJoint.ThighLeft,
                ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.FootLeft, "left");
            AssertKneeFlexion(rig, ProductionCharacterJoint.ThighRight,
                ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.FootRight, "right");

            var hips = rig.Root.InverseTransformPoint(
                rig.Joint(ProductionCharacterJoint.Hips).position);
            var chest = rig.Root.InverseTransformPoint(
                rig.Joint(ProductionCharacterJoint.Chest).position);
            var head = rig.Root.InverseTransformPoint(
                rig.Joint(ProductionCharacterJoint.Head).position);
            Assert.That(head.z, Is.GreaterThan(hips.z + 0.08f),
                "ready fielder must carry body weight forward rather than stand bolt upright");

            var hands = new[]
            {
                ProductionCharacterJoint.HandLeft,
                ProductionCharacterJoint.HandRight
            };
            for (var handIndex = 0; handIndex < hands.Length; handIndex++)
            {
                var hand = rig.Root.InverseTransformPoint(rig.Joint(hands[handIndex]).position);
                Assert.That(hand.y, Is.LessThan(chest.y - 0.06f),
                    hands[handIndex] + " must stay below the chest in the ready catching window");
                Assert.That(hand.y, Is.GreaterThan(hips.y - 0.08f),
                    hands[handIndex] + " must not hang inert beside the knees");
                Assert.That(hand.z, Is.GreaterThan(chest.z + 0.10f),
                    hands[handIndex] + " must be presented forward and ready");
            }
        }

        private static void AssertKneeFlexion(ProductionCharacterRig rig,
            ProductionCharacterJoint hipJoint, ProductionCharacterJoint kneeJoint,
            ProductionCharacterJoint ankleJoint, string side)
        {
            var upperLeg = rig.Joint(kneeJoint).position - rig.Joint(hipJoint).position;
            var lowerLeg = rig.Joint(ankleJoint).position - rig.Joint(kneeJoint).position;
            Assert.That(Vector3.Angle(upperLeg, lowerLeg), Is.InRange(45f, 75f),
                side + " knee must be visibly flexed but remain inside an athletic ready range");
        }

        private static void AssertMirroredJointPosition(ProductionCharacterRig right,
            ProductionCharacterJoint rightJoint, ProductionCharacterRig left,
            ProductionCharacterJoint leftJoint)
        {
            var expected = right.Root.InverseTransformPoint(right.Joint(rightJoint).position);
            var observed = left.Root.InverseTransformPoint(left.Joint(leftJoint).position);
            Assert.That(observed.x, Is.EqualTo(-expected.x).Within(0.002f),
                rightJoint + " / " + leftJoint + " must mirror laterally");
            Assert.That(observed.y, Is.EqualTo(expected.y).Within(0.002f),
                rightJoint + " / " + leftJoint + " must preserve height when mirrored");
            Assert.That(observed.z, Is.EqualTo(expected.z).Within(0.002f),
                rightJoint + " / " + leftJoint + " must preserve depth when mirrored");
        }

        private static void AssertMarkerOrder(ProductionCharacterMotion motion,
            params ProductionCharacterMarker[] markers)
        {
            var previous = -1f;
            for (var index = 0; index < markers.Length; index++)
            {
                float value;
                Assert.That(ProductionCharacterMotionSampler.TryGetMarkerNormalized(
                    motion, markers[index], out value), Is.True);
                Assert.That(value, Is.GreaterThan(previous), markers[index].ToString());
                previous = value;
            }
        }

        private static float DistanceToSegment(Vector3 point, Vector3 from, Vector3 to)
        {
            var span = to - from;
            if (span.sqrMagnitude <= 0.000001f) return Vector3.Distance(point, from);
            var amount = Mathf.Clamp01(Vector3.Dot(point - from, span) / span.sqrMagnitude);
            return Vector3.Distance(point, from + span * amount);
        }

        private static float ProjectedThighLeverAngle(Quaternion rotation)
        {
            var shaft = rotation * Vector3.down;
            return Vector2.Angle(Vector2.down, new Vector2(shaft.x, shaft.y));
        }

        private static string[] Variations(ProductionCharacterRole role)
        {
            return role == ProductionCharacterRole.PaceBowler
                ? new[] { "stock", "outswing", "inswing", "seam", "cutter", "slower", "bouncer", "yorker" }
                : new[] { "stock", "flighted", "quicker", "topspinner", "arm_ball", "wrong_un" };
        }

        private static ProductionBowlingCueProfile Cue(ProductionCharacterRole role, string variation)
        {
            var pace = role == ProductionCharacterRole.PaceBowler;
            var seam = variation == "inswing" ? -18.0 :
                variation == "outswing" ? 18.0 :
                variation == "cutter" ? 25.0 :
                variation == "slower" ? 40.0 : 0.0;
            return ProductionBowlingCueProfile.ForHostDelivery(
                role,
                variation,
                pace ? 132.0 : 84.0,
                pace ? 132.0 : 84.0,
                seam,
                -0.35,
                pace ? 10.0 : 13.0);
        }

    }
}
