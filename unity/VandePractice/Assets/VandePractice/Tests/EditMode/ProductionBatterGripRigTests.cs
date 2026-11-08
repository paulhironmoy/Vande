using System;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Audio;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    public sealed class ProductionBatterGripRigTests
    {
        private const string RepresentativeDriveCaseId = "grounded-attack";
        private const string RepresentativeDriveReferenceBallId = "ref-3";
        private static PracticeResultPresentation representativePaceDrive;
        private static PracticeResultPresentation[] sharedPracticeResults;

        [Test]
        public void ChestLocalGripPoles_MirrorRoleSpecificHumanGuardAndBoundDepth()
        {
            var phases = new[] { 0f, 0.5f, 1f };
            for (var index = 0; index < phases.Length; index++)
            {
                var rightHandedTop = ProductionCharacterRig.BatterGripPoleChestLocal(
                    true, false, phases[index]);
                var rightHandedBottom = ProductionCharacterRig.BatterGripPoleChestLocal(
                    false, false, phases[index]);
                var leftHandedBottom = ProductionCharacterRig.BatterGripPoleChestLocal(
                    true, true, phases[index]);
                var leftHandedTop = ProductionCharacterRig.BatterGripPoleChestLocal(
                    false, true, phases[index]);

                Assert.That(rightHandedTop.x, Is.GreaterThan(0f));
                Assert.That(rightHandedBottom.x, Is.LessThan(0f));
                Assert.That(leftHandedBottom.x, Is.GreaterThan(0f));
                Assert.That(leftHandedTop.x, Is.LessThan(0f));
                Assert.That(rightHandedTop.x,
                    Is.EqualTo(-leftHandedTop.x).Within(0.000001f));
                Assert.That(rightHandedBottom.x,
                    Is.EqualTo(-leftHandedBottom.x).Within(0.000001f));
                Assert.That(rightHandedTop.y,
                    Is.EqualTo(leftHandedTop.y).Within(0.000001f));
                Assert.That(rightHandedBottom.y,
                    Is.EqualTo(leftHandedBottom.y).Within(0.000001f));
                Assert.That(rightHandedTop.z,
                    Is.EqualTo(leftHandedTop.z).Within(0.000001f));
                Assert.That(rightHandedBottom.z,
                    Is.EqualTo(leftHandedBottom.z).Within(0.000001f));
                Assert.That(rightHandedTop.y, Is.LessThan(0f));
                Assert.That(rightHandedBottom.y, Is.LessThan(0f));
                Assert.That(Mathf.Abs(rightHandedTop.z),
                    Is.LessThanOrEqualTo(ProductionCharacterRig.MaximumBatterGripPoleDepth));
                Assert.That(Mathf.Abs(rightHandedBottom.z),
                    Is.LessThanOrEqualTo(ProductionCharacterRig.MaximumBatterGripPoleDepth));
                Assert.That(rightHandedBottom.z, Is.LessThan(0f),
                    "the bottom elbow may sit slightly behind the chest but must remain bounded");
                Assert.That(rightHandedTop.z, Is.GreaterThanOrEqualTo(0f),
                    "the top elbow must not inherit the rear-arm depth bias");
                Assert.That(Mathf.Abs(rightHandedTop.x),
                    Is.GreaterThan(Mathf.Abs(rightHandedBottom.x)),
                    "the top elbow plane must open away from the sternum rather than stack over the bottom arm");
                if (phases[index] > 0f)
                {
                    Assert.That(Mathf.Abs(rightHandedTop.y),
                        Is.LessThan(Mathf.Abs(rightHandedBottom.y)),
                        "the low guard must keep the front/top elbow above the folded bottom elbow");
                }
            }
        }

        [Test]
        public void ReadyGripCameraOffset_IsMinimalAndMirrorsOnlyLaterally()
        {
            var right = ProductionCharacterRig.BatterReadyGripCameraForwardLocalOffset(
                ProductionCharacterHandedness.Right);
            var left = ProductionCharacterRig.BatterReadyGripCameraForwardLocalOffset(
                ProductionCharacterHandedness.Left);

            Assert.That(right.magnitude,
                Is.EqualTo(ProductionCharacterRig.BatterReadyGripCameraForwardMetres).Within(0.00001f));
            Assert.That(left.magnitude, Is.EqualTo(right.magnitude).Within(0.000001f));
            Assert.That(left.x, Is.EqualTo(-right.x).Within(0.000001f));
            Assert.That(left.y, Is.EqualTo(right.y).Within(0.000001f));
            Assert.That(left.z, Is.EqualTo(right.z).Within(0.000001f));
        }

        [Test]
        public void SimV3ShoulderContract_MapsExactlyToShippedHeroRestSkeleton()
        {
            var host = new GameObject("sim-v3-shoulder-rest-mapping-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = ProductionCharacterHandedness.Right;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, 0f));
                rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);

                var left = rig.HeroJointAuthoredWorldPosition(ProductionCharacterJoint.UpperArmLeft);
                var right = rig.HeroJointAuthoredWorldPosition(ProductionCharacterJoint.UpperArmRight);
                Assert.That(Vector3.Distance(left, rig.HeroCanonicalShoulderContractWorld(true)),
                    Is.LessThanOrEqualTo(0.000001f),
                    "shipped VSK left upper-arm centre must retain the sim-v3 measured shoulder mapping");
                Assert.That(Vector3.Distance(right, rig.HeroCanonicalShoulderContractWorld(false)),
                    Is.LessThanOrEqualTo(0.000001f),
                    "shipped VSK right upper-arm centre must retain the sim-v3 measured shoulder mapping");
                Assert.That(left.x, Is.LessThan(right.x),
                    "after the live 180-degree root yaw, canonical x-minus is the RH left/top-hand shoulder");
                // The licensed hero's authored arm (0.475 m) is lengthened to the anthropometric chain the physics
                // plans with (0.332 x stature; 0.591 m at 1.78 m), less the 20.1 mm elbow reserve: at least the physics'
                // BAT_HAND_REACH_SOLVE_M (0.569 m, src/physics/admissibility.ts). It was 0.455078717 m before the change.
                var expectedReach = ProductionCharacterRig.AnthropometricArmChainShare * rig.HeightMetres - 0.0201f;
                Assert.That(rig.HeroBatterArmUsableReach(true), Is.EqualTo(expectedReach).Within(0.0001f));
                Assert.That(rig.HeroBatterArmUsableReach(false), Is.EqualTo(expectedReach).Within(0.0001f));
                Assert.That(rig.HeroBatterArmUsableReach(true), Is.GreaterThanOrEqualTo(0.569f));
                Assert.That(rig.HeroBatterArmUsableReach(false), Is.GreaterThanOrEqualTo(0.569f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void SimV3StaticPosture_ArticulatesFullCrouchWithRootFixedAndFeetPlanted(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("sim-v3-static-posture-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var rootPosition = new Vector3(mirror * 0.18f, 0f, 9.07f);
                rig.Root.SetPositionAndRotation(
                    rootPosition,
                    Quaternion.Euler(0f, 180f, -3f * mirror));
                var phases = new[] { 0f, 0.44f, 0.7f, 1f };
                var footworks = new[]
                {
                    ProductionBatterFootwork.Forward,
                    ProductionBatterFootwork.Back,
                    ProductionBatterFootwork.Across,
                    ProductionBatterFootwork.DownTrack
                };
                for (var footworkIndex = 0; footworkIndex < footworks.Length; footworkIndex++)
                {
                    for (var phaseIndex = 0; phaseIndex < phases.Length; phaseIndex++)
                    {
                        var phase = phases[phaseIndex];
                        var footwork = footworks[footworkIndex];
                        var label = handedness + " / " + footwork + " / phase " + phase;
                        rig.SetCanonicalBatterPosture(0f);
                        rig.SampleBatterStrokeBlend(
                            phase, footwork, phase, footwork, 0f,
                            applyBatterNeckClearance: false);
                        var hips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                        var head = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                        var leftShoulder = rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft);
                        var rightShoulder = rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight);
                        var leftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                        var rightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);

                        rig.SetCanonicalBatterPosture(0.18f);
                        rig.SampleBatterStrokeBlend(
                            phase, footwork, phase, footwork, 0f,
                            applyBatterNeckClearance: false);

                        Assert.That(rig.Root.position, Is.EqualTo(rootPosition), label + " root");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft), leftFoot),
                            Is.LessThanOrEqualTo(0.002f), label + " left foot");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight), rightFoot),
                            Is.LessThanOrEqualTo(0.002f), label + " right foot");
                        Assert.That(hips.y - rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips).y,
                            Is.EqualTo(0.18f).Within(0.002f), label + " pelvis lowering");
                        Assert.That(head.y - rig.HeroJointWorldPosition(ProductionCharacterJoint.Head).y,
                            Is.EqualTo(0.18f).Within(0.002f), label + " head lowering");
                        Assert.That(leftShoulder.y -
                                    rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft).y,
                            Is.EqualTo(0.18f).Within(0.002f), label + " left shoulder lowering");
                        Assert.That(rightShoulder.y -
                                    rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight).y,
                            Is.EqualTo(0.18f).Within(0.002f), label + " right shoulder lowering");
                    }
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase("missing")]
        [TestCase("nonfinite")]
        [TestCase("out_of_domain")]
        [TestCase("incoherent")]
        public void DirectResultBodyFrameValidation_RejectsBeforeAnyVisibleWorldMutation(
            string invalidKind)
        {
            var host = new GameObject("direct-body-frame-validation-" + invalidKind);
            try
            {
                var world = host.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "right",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard
                }, new NullFeedbackSink());
                world.ConfigureScene(BodyFrameValidationScene());
                world.BeginDelivery(BodyFrameValidationDelivery());

                var rootBefore = world.BatterRootWorldPosition;
                var hipsBefore = world.BatterHipsWorldPosition;
                var headBefore = world.BatterHeadWorldPosition;
                var batBefore = world.BatterBatWorldPosition;
                var timelineBefore = world.Timeline;
                var result = new PracticeResultPresentation
                {
                    Trace = CanonicalTraceTestFixture.Create(),
                    BatterBodyFrame = InvalidBatterBodyFrame(invalidKind),
                    ReplayDigest = new string('f', 64),
                    PlaybackSpeed = 1.0,
                    Footwork = "forward",
                    IsReplay = false
                };

                Assert.Throws<BridgeValidationException>(() => world.AcceptResult(result), invalidKind);
                Assert.That(world.BatterRootWorldPosition, Is.EqualTo(rootBefore), invalidKind + " root");
                Assert.That(world.BatterHipsWorldPosition, Is.EqualTo(hipsBefore), invalidKind + " hips");
                Assert.That(world.BatterHeadWorldPosition, Is.EqualTo(headBefore), invalidKind + " head");
                Assert.That(world.BatterBatWorldPosition, Is.EqualTo(batBefore), invalidKind + " bat");
                Assert.That(world.Timeline, Is.EqualTo(timelineBefore), invalidKind + " timeline");
                Assert.That(world.CanonicalFootwork, Is.EqualTo(ProductionBatterFootwork.Balanced),
                    invalidKind + " footwork");
                Assert.That(world.ContactHasOccurred, Is.False, invalidKind + " contact");
                Assert.That(world.DeliveryActive, Is.True, invalidKind + " delivery state");
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void ReadyGripCameraOffset_ClearsTorsoAndPreservesGroundedLawScaleBat(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("batter-ready-grip-clearance-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
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
                var hipView = worldToView *
                              (rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips) - cameraPosition);
                var gripView = worldToView * (rig.Bat.position - cameraPosition);
                Assert.That(gripView.z, Is.LessThan(hipView.z - 0.015f),
                    "ready handle must retain the locked-camera torso clearance in both mirrors");

                var toe = rig.BatToeWorld;
                Assert.That(Vector3.Distance(rig.Bat.position, toe),
                    Is.EqualTo(CricketPropDimensions.TotalBatLength).Within(0.000001f));
                Assert.That(toe.y - rig.Root.position.y, Is.InRange(0.02f, 0.16f));
                var backFootJoint = handedness == ProductionCharacterHandedness.Right
                    ? ProductionCharacterJoint.FootRight
                    : ProductionCharacterJoint.FootLeft;
                var backFoot = rig.HeroJointWorldPosition(backFootJoint);
                Assert.That(new Vector2(toe.x - backFoot.x, toe.z - backFoot.z).magnitude,
                    Is.LessThan(0.24f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void CurrentAndCanonicalCoupling_PreserveBatAuthorityAndUseOrderedHeroTargets(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("batter-grip-authority-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var mirror = handedness == ProductionCharacterHandedness.Right ? 1f : -1f;
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));
                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);

                rig.Bat.localRotation *= Quaternion.Euler(5f, 9f, -4f);
                var currentGrip = rig.Bat.position;
                var currentRotation = rig.Bat.rotation;
                rig.CoupleBatterHandsToCurrentBat(1f);
                Assert.That(Vector3.Distance(rig.Bat.position, currentGrip), Is.LessThan(0.000001f));
                Assert.That(Quaternion.Angle(rig.Bat.rotation, currentRotation), Is.LessThan(0.0001f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);

                var canonicalGrip = new Vector3(-0.20f, 1.10f, 8.95f);
                if (handedness == ProductionCharacterHandedness.Left) canonicalGrip.x = -canonicalGrip.x;
                var canonicalToe = new Vector3(
                    handedness == ProductionCharacterHandedness.Right ? 0.10f : -0.10f,
                    0.32f,
                    8.72f);
                var canonicalFace = new Vector3(
                    handedness == ProductionCharacterHandedness.Right ? 0.2f : -0.2f,
                    0.1f,
                    -0.95f).normalized;
                rig.SetCanonicalBatPose(canonicalGrip, canonicalToe, canonicalFace);

                Assert.That(Vector3.Distance(rig.Bat.position, canonicalGrip), Is.LessThan(0.000001f));
                Assert.That(Vector3.Angle(
                        rig.Bat.TransformDirection(Vector3.down), canonicalToe - canonicalGrip),
                    Is.LessThan(0.03f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void CanonicalCouplingWeight_BlendsBodyAndHeroHandsWithoutMovingCanonicalBat(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("batter-canonical-coupling-weight-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));

                var drive = RepresentativePaceDrive();
                var trace = drive.Trace;
                var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                var sample = FurthestDownPitchSample(trace);
                var tracePhase = CanonicalTracePhase(trace, sample.t);
                var phase = ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase);
                var grip = ToUnity(sample.grip, mirror);
                var toe = ToUnity(sample.toe, mirror);
                var face = ToUnity(sample.face, mirror);

                rig.SampleBatterStroke(phase, footwork);
                var sourceHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var sourceHeadRelative =
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Head) - sourceHips;
                var sourceLeftHand = rig.HeroHandWorldPosition(true);
                var sourceRightHand = rig.HeroHandWorldPosition(false);
                rig.SetCanonicalBatPose(grip, toe, face, 0f);

                AssertCanonicalBat(rig, grip, toe, face);
                Assert.That(Vector3.Distance(
                        rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips), sourceHips),
                    Is.LessThan(0.00001f), "zero blend must not translate the body");
                Assert.That(Vector3.Distance(
                        rig.HeroJointWorldPosition(ProductionCharacterJoint.Head) - sourceHips,
                        sourceHeadRelative),
                    Is.LessThan(0.00001f), "zero blend must not turn the torso");
                Assert.That(Vector3.Distance(rig.HeroHandWorldPosition(true), sourceLeftHand),
                    Is.LessThan(0.00001f), "zero blend must not apply visible hero IK");
                Assert.That(Vector3.Distance(rig.HeroHandWorldPosition(false), sourceRightHand),
                    Is.LessThan(0.00001f), "zero blend must not apply visible hero IK");
                var zeroLeftGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                var zeroRightGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));

                rig.SampleBatterStroke(phase, footwork);
                rig.SetCanonicalBatPose(grip, toe, face, 0.5f);
                AssertCanonicalBat(rig, grip, toe, face);
                var middleHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var middleHeadRelative =
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Head) - middleHips;
                var middleLeftGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                var middleRightGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));

                rig.SampleBatterStroke(phase, footwork);
                rig.SetCanonicalBatPose(grip, toe, face, 1f);
                AssertCanonicalBat(rig, grip, toe, face);
                var fullHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var fullHeadRelative =
                    rig.HeroJointWorldPosition(ProductionCharacterJoint.Head) - fullHips;
                var fullLeftGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                var fullRightGap = Vector3.Distance(
                    rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));

                var middleTranslation = Vector3.Distance(sourceHips, middleHips);
                var fullTranslation = Vector3.Distance(sourceHips, fullHips);
                Assert.That(fullTranslation, Is.GreaterThan(0.01f));
                Assert.That(middleTranslation,
                    Is.EqualTo(fullTranslation * 0.5f).Within(0.002f),
                    "spatial retarget must respect the canonical body blend weight");
                var middleTurn = Vector3.Distance(sourceHeadRelative, middleHeadRelative);
                var fullTurn = Vector3.Distance(sourceHeadRelative, fullHeadRelative);
                Assert.That(fullTurn, Is.GreaterThan(0.001f));
                Assert.That(middleTurn, Is.GreaterThan(0.0001f));
                Assert.That(middleTurn, Is.LessThan(fullTurn),
                    "torso yaw must interpolate before full trace reconciliation");
                Assert.That(middleLeftGap, Is.LessThan(zeroLeftGap));
                Assert.That(middleRightGap, Is.LessThan(zeroRightGap));
                Assert.That(fullLeftGap, Is.LessThan(middleLeftGap));
                Assert.That(fullRightGap, Is.LessThan(middleRightGap));
                Assert.That(fullLeftGap, Is.LessThanOrEqualTo(0.02f));
                Assert.That(fullRightGap, Is.LessThanOrEqualTo(0.02f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void CanonicalDriveSequence_PreservesExactBatAndBothAuthoredWristsStayOnHandle(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("canonical-drive-grip-sequence-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));

                // Exercise the exact shared TypeScript golden instead of a hand-copied subset. The decoded result
                // also owns the resolved footwork; ref-3 is a back-foot stroke even though its input intent is auto.
                var drive = RepresentativePaceDrive();
                var trace = drive.Trace;
                var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                var maximumLeftGap = 0f;
                var maximumRightGap = 0f;
                var maximumLeftPhase = 0f;
                var maximumRightPhase = 0f;
                for (var index = 0; index < trace.bat.Length; index++)
                {
                    var sample = trace.bat[index];
                    var tracePhase = CanonicalTracePhase(trace, sample.t);
                    var grip = ToUnity(sample.grip, mirror);
                    var toe = ToUnity(sample.toe, mirror);
                    var face = ToUnity(sample.face, mirror);
                    rig.SampleBatterStroke(
                        ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase),
                        footwork);
                    var feetBeforeRetarget = (rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft) +
                                              rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight)) * 0.5f;
                    rig.SetCanonicalBatPose(grip, toe, face);
                    var feetAfterRetarget = (rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft) +
                                             rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight)) * 0.5f;

                    Assert.That(Vector3.Distance(rig.Bat.position, grip), Is.LessThan(0.000001f),
                        "canonical grip authority at " + TraceLabel(sample, tracePhase));
                    Assert.That(Vector3.Angle(rig.Bat.TransformDirection(Vector3.down), toe - grip),
                        Is.LessThan(0.03f), "canonical blade authority at " + TraceLabel(sample, tracePhase));
                    AssertCanonicalBat(rig, grip, toe, face);
                    var leftGap = Vector3.Distance(
                        rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true));
                    var rightGap = Vector3.Distance(
                        rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false));
                    if (leftGap > maximumLeftGap)
                    {
                        maximumLeftGap = leftGap;
                        maximumLeftPhase = tracePhase;
                    }
                    if (rightGap > maximumRightGap)
                    {
                        maximumRightGap = rightGap;
                        maximumRightPhase = tracePhase;
                    }
                    Assert.That(Vector3.Distance(
                            rig.HeroJointLocalPosition(ProductionCharacterJoint.HandLeft),
                            rig.HeroJointAuthoredLocalPosition(ProductionCharacterJoint.HandLeft)),
                        Is.LessThan(0.000001f));
                    Assert.That(Vector3.Distance(
                            rig.HeroJointLocalPosition(ProductionCharacterJoint.HandRight),
                            rig.HeroJointAuthoredLocalPosition(ProductionCharacterJoint.HandRight)),
                        Is.LessThan(0.000001f));
                    var spatialRetarget = feetAfterRetarget - feetBeforeRetarget;
                    Assert.That(new Vector2(spatialRetarget.x, spatialRetarget.z).magnitude,
                        Is.LessThanOrEqualTo(
                            ProductionCharacterRig.MaximumBatterSpatialRetargetMetres + 0.00001f),
                        "spatial body reconciliation must remain within one bounded batting step");
                    Assert.That(Mathf.Abs(spatialRetarget.y), Is.LessThan(0.00001f),
                        "trace reconciliation must not float or sink the planted feet at " +
                        TraceLabel(sample, tracePhase) +
                        "; before=" + feetBeforeRetarget.ToString("R") +
                        "; after=" + feetAfterRetarget.ToString("R"));
                }
                Assert.That(maximumLeftGap, Is.LessThanOrEqualTo(0.02f),
                    "left max authored-wrist gap at phase " + maximumLeftPhase);
                Assert.That(maximumRightGap, Is.LessThanOrEqualTo(0.02f),
                    "right max authored-wrist gap at phase " + maximumRightPhase);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void SimV3AuthoritativeRoot_ReachesOrderedHandsAcrossSharedCorpusWithoutBodyRetarget(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("sim-v3-authoritative-root-reach-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);

                var drives = SharedPracticeResults();
                var maximumLeftGap = 0f;
                var maximumRightGap = 0f;
                var maximumLeftReach = 0f;
                var maximumRightReach = 0f;
                var maximumLeftShoulderContractDelta = 0f;
                var maximumRightShoulderContractDelta = 0f;
                var measuredSamples = 0;

                for (var driveIndex = 0; driveIndex < drives.Length; driveIndex++)
                {
                    var drive = drives[driveIndex];
                    var trace = drive.Trace;
                    Assert.That(trace.batterRootOffset, Is.Not.Null, trace.deliveryId);
                    Assert.That(trace.batterPosture, Is.Not.Null, trace.deliveryId);
                    Assert.That(drive.BatterBodyFrame, Is.Not.Null, trace.deliveryId);
                    Assert.That(drive.BatterBodyFrame.Stance, Is.Not.Null, trace.deliveryId);
                    Assert.That(drive.BatterBodyFrame.TorsoTop, Is.Not.Null, trace.deliveryId);
                    Assert.That(drive.BatterBodyFrame.HeadCentre, Is.Not.Null, trace.deliveryId);
                    if (trace.bat.Length < 2) continue;
                    var terminalRootOffset = new Vector3(
                        mirror * (float)trace.batterRootOffset.x,
                        0f,
                        (float)trace.batterRootOffset.z);
                    var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                    var crouch = (float)trace.batterPosture.crouchM;

                    for (var index = 0; index < trace.bat.Length; index++)
                    {
                        measuredSamples++;
                        var sample = trace.bat[index];
                        var tracePhase = CanonicalTracePhase(trace, sample.t);
                        var label = trace.deliveryId + " / " + TraceLabel(sample, tracePhase);
                        var authoritativeRoot = new Vector3(0f, 0f, 9.25f) +
                                                terminalRootOffset;
                        rig.Root.SetPositionAndRotation(
                            authoritativeRoot,
                            Quaternion.Euler(0f, 180f, -3f * mirror));
                        LatchCanonicalBatterBodyFrame(rig, drive.BatterBodyFrame, mirror);
                        rig.SetCanonicalBatterPosture(0f);
                        rig.SampleBatterStrokeBlend(
                            ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase),
                            footwork,
                            ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase),
                            footwork,
                            0f,
                            applyBatterNeckClearance: false);
                        var baselineHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                        var baselineHead = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                        var baselineLeftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                        var baselineRightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                        rig.SetCanonicalBatterPosture(crouch);
                        rig.SampleBatterStrokeBlend(
                            ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase),
                            footwork,
                            ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase),
                            footwork,
                            0f,
                            applyBatterNeckClearance: false);
                        var hipsBefore = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                        var headBefore = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                        var leftFootBefore = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                        var rightFootBefore = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                        AssertCanonicalBatterBodyFrameAlignment(rig, drive.BatterBodyFrame, mirror, label);
                        Assert.That(rig.Root.position, Is.EqualTo(authoritativeRoot),
                            "posture must not translate the authoritative root at " + label);
                        Assert.That(Vector3.Distance(leftFootBefore, baselineLeftFoot),
                            Is.LessThanOrEqualTo(0.002f),
                            "posture must keep the visible left foot planted within 2 mm at " + label);
                        Assert.That(Vector3.Distance(rightFootBefore, baselineRightFoot),
                            Is.LessThanOrEqualTo(0.002f),
                            "posture must keep the visible right foot planted within 2 mm at " + label);
                        Assert.That(baselineHips.y - hipsBefore.y,
                            Is.EqualTo(crouch).Within(0.002f),
                            "posture must lower the visible pelvis by its encoded amount at " + label);
                        Assert.That(baselineHead.y - headBefore.y,
                            Is.EqualTo(crouch).Within(0.002f),
                            "posture must lower the visible head/upper body by its encoded amount at " + label);
                        maximumLeftShoulderContractDelta = Mathf.Max(
                            maximumLeftShoulderContractDelta,
                            Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft),
                                rig.HeroCanonicalShoulderContractWorld(true)));
                        maximumRightShoulderContractDelta = Mathf.Max(
                            maximumRightShoulderContractDelta,
                            Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight),
                                rig.HeroCanonicalShoulderContractWorld(false)));
                        var grip = ToUnity(sample.grip, mirror);
                        var toe = ToUnity(sample.toe, mirror);
                        var face = ToUnity(sample.face, mirror);
                        rig.SetCanonicalBatPose(
                            grip,
                            toe,
                            face,
                            1f,
                            retargetBodyToTrace: false,
                            applyBatterNeckClearance: false);

                        AssertCanonicalBat(rig, grip, toe, face);
                        Assert.That(rig.Root.position,
                            Is.EqualTo(authoritativeRoot),
                            "canonical arm IK must not silently translate the authoritative sim-v3 root at " +
                            label);
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips), hipsBefore),
                            Is.LessThan(0.00001f),
                            "canonical arm IK must not independently retarget the pelvis at " + label);
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.Head), headBefore),
                            Is.LessThan(0.00001f),
                            "canonical arm IK must not independently retarget the neck/head chain at " + label);
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft), leftFootBefore),
                            Is.LessThan(0.00001f),
                            "canonical arm IK must not translate the left support foot at " + label);
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight), rightFootBefore),
                            Is.LessThan(0.00001f),
                            "canonical arm IK must not translate the right support foot at " + label);

                        var leftTarget = rig.HeroBatterGripTargetWorld(true);
                        var rightTarget = rig.HeroBatterGripTargetWorld(false);
                        var topIsLeft = handedness == ProductionCharacterHandedness.Right;
                        var topTarget = topIsLeft ? leftTarget : rightTarget;
                        var lowerTarget = topIsLeft ? rightTarget : leftTarget;
                        Assert.That(Vector3.Distance(topTarget, lowerTarget),
                            Is.EqualTo(0.1f).Within(0.000001f),
                            "ordered sim-v3 grip centres at " + label);
                        var leftGap = Vector3.Distance(rig.HeroHandWorldPosition(true), leftTarget);
                        var rightGap = Vector3.Distance(rig.HeroHandWorldPosition(false), rightTarget);
                        var leftReach = Vector3.Distance(
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft), leftTarget);
                        var rightReach = Vector3.Distance(
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight), rightTarget);
                        Assert.That(leftGap, Is.LessThanOrEqualTo(0.002f),
                            "left visible hand must reach its .025/.125 m ordered target within 2 mm at " + label);
                        Assert.That(rightGap, Is.LessThanOrEqualTo(0.002f),
                            "right visible hand must reach its .025/.125 m ordered target within 2 mm at " + label);
                        Assert.That(leftReach,
                            Is.LessThanOrEqualTo(rig.HeroBatterArmUsableReach(true) + 0.000001f),
                            "left posed shoulder-to-target reach exceeds the shipped hero chain at " + label);
                        Assert.That(rightReach,
                            Is.LessThanOrEqualTo(rig.HeroBatterArmUsableReach(false) + 0.000001f),
                            "right posed shoulder-to-target reach exceeds the shipped hero chain at " + label);
                        maximumLeftGap = Mathf.Max(maximumLeftGap, leftGap);
                        maximumRightGap = Mathf.Max(maximumRightGap, rightGap);
                        maximumLeftReach = Mathf.Max(maximumLeftReach, leftReach);
                        maximumRightReach = Mathf.Max(maximumRightReach, rightReach);
                    }
                }

                Assert.That(measuredSamples, Is.GreaterThan(0));
                Assert.That(float.IsNaN(maximumLeftGap) || float.IsInfinity(maximumLeftGap), Is.False);
                Assert.That(float.IsNaN(maximumRightGap) || float.IsInfinity(maximumRightGap), Is.False);
                Assert.That(float.IsNaN(maximumLeftReach) || float.IsInfinity(maximumLeftReach), Is.False);
                Assert.That(float.IsNaN(maximumRightReach) || float.IsInfinity(maximumRightReach), Is.False);
                Assert.That(float.IsNaN(maximumLeftShoulderContractDelta) ||
                            float.IsInfinity(maximumLeftShoulderContractDelta), Is.False);
                Assert.That(float.IsNaN(maximumRightShoulderContractDelta) ||
                            float.IsInfinity(maximumRightShoulderContractDelta), Is.False);
                TestContext.Progress.WriteLine(
                    "sim-v3 authoritative-root reach evidence " + handedness +
                    ": maxLeftHandErrorM=" + maximumLeftGap.ToString("R") +
                    ", maxRightHandErrorM=" + maximumRightGap.ToString("R") +
                    ", maxLeftUpperArmToTargetM=" + maximumLeftReach.ToString("R") +
                    ", maxRightUpperArmToTargetM=" + maximumRightReach.ToString("R") +
                    ", maxLeftPosedShoulderContractDeltaM=" +
                    maximumLeftShoulderContractDelta.ToString("R") +
                    ", maxRightPosedShoulderContractDeltaM=" +
                    maximumRightShoulderContractDelta.ToString("R") +
                    ", measuredSamples=" + measuredSamples);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void SimV3CorpusReachProxies_KeepStaticRootPostureFeetAndOrderedHands(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("sim-v3-corpus-reach-proxy-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var proxies = SharedReachProxies();
                Assert.That(proxies, Is.Not.Null.And.Not.Empty,
                    "practice-v3 must carry fixed corpus-selected reach proxies before this gate can pass");

                for (var proxyIndex = 0; proxyIndex < proxies.Length; proxyIndex++)
                {
                    var proxy = proxies[proxyIndex];
                    Assert.That(proxy, Is.Not.Null);
                    Assert.That(proxy.id, Is.Not.Null.And.Not.Empty);
                    Assert.That(proxy.family, Is.Not.Null.And.Not.Empty, proxy.id);
                    Assert.That(proxy.footwork, Is.Not.Null.And.Not.Empty, proxy.id);
                    Assert.That(proxy.contactU, Is.InRange(0.0, 1.0), proxy.id);
                    Assert.That(proxy.batterRootOffset, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterBodyFrame, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterBodyFrame.stance, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterBodyFrame.torsoTop, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterBodyFrame.headCentre, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterPosture, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batterMotion, Is.Not.Null, proxy.id);
                    Assert.That(proxy.batProbes, Is.Not.Null.And.Not.Empty, proxy.id);
                    Assert.That(proxy.batterMotion.startT, Is.LessThan(proxy.batterMotion.endT), proxy.id);
                    Assert.That(proxy.batterMotion.contactT,
                        Is.GreaterThan(proxy.batterMotion.startT), proxy.id);
                    Assert.That(proxy.batterMotion.contactT,
                        Is.LessThan(proxy.batterMotion.endT), proxy.id);
                    var rootMagnitude = Math.Sqrt(
                        proxy.batterRootOffset.x * proxy.batterRootOffset.x +
                        proxy.batterRootOffset.z * proxy.batterRootOffset.z);
                    Assert.That(rootMagnitude,
                        Is.LessThanOrEqualTo(BridgeConstants.MaxBatterRootOffsetMetres), proxy.id);
                    Assert.That(proxy.batterPosture.crouchM,
                        Is.InRange(0.0, BridgeConstants.MaxBatterCrouchMetres), proxy.id);

                    var rootPosition = new Vector3(
                        mirror * (float)proxy.batterRootOffset.x,
                        0f,
                        9.25f + (float)proxy.batterRootOffset.z);
                    var footwork = ProductionBatterFootworkAdapter.FromHostIntent(proxy.footwork);
                    for (var probeIndex = 0; probeIndex < proxy.batProbes.Length; probeIndex++)
                    {
                        var probe = proxy.batProbes[probeIndex];
                        Assert.That(probe, Is.Not.Null, proxy.id + " probe " + probeIndex);
                        Assert.That(probe.bat, Is.Not.Null, proxy.id + " probe " + probeIndex);
                        Assert.That(double.IsNaN(probe.t) || double.IsInfinity(probe.t), Is.False, proxy.id);
                        Assert.That(probe.t,
                            Is.InRange(proxy.batterMotion.startT,
                                BridgeConstants.MaxTraceDurationSeconds),
                            proxy.id + " (held-tail probes after endT are valid)");
                        var phase = ProceduralPracticeWorld.CanonicalBatterMotionPhase(
                            proxy.batterMotion, probe.t);
                        var label = proxy.id + " / " + proxy.family + " / " + proxy.footwork +
                                    " / contactU=" + proxy.contactU + " / t=" + probe.t +
                                    " / " + handedness;
                        rig.Root.SetPositionAndRotation(
                            rootPosition,
                            Quaternion.Euler(0f, 180f, -3f * mirror));
                        LatchCanonicalBatterBodyFrame(rig, proxy.batterBodyFrame, mirror);
                        rig.SetCanonicalBatterPosture(0f);
                        rig.SampleBatterStrokeBlend(
                            phase, footwork, phase, footwork, 0f,
                            applyBatterNeckClearance: false);
                        var baselineHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                        var baselineHead = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                        var baselineLeftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                        var baselineRightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);

                        var crouch = (float)proxy.batterPosture.crouchM;
                        rig.SetCanonicalBatterPosture(crouch);
                        rig.SampleBatterStrokeBlend(
                            phase, footwork, phase, footwork, 0f,
                            applyBatterNeckClearance: false);
                        var posturedHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                        var posturedHead = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                        var posturedLeftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                        var posturedRightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                        AssertCanonicalBatterBodyFrameAlignment(
                            rig, proxy.batterBodyFrame, mirror, label);
                        Assert.That(rig.Root.position, Is.EqualTo(rootPosition), label + " static root");
                        Assert.That(Vector3.Distance(posturedLeftFoot, baselineLeftFoot),
                            Is.LessThanOrEqualTo(0.002f), label + " planted left foot");
                        Assert.That(Vector3.Distance(posturedRightFoot, baselineRightFoot),
                            Is.LessThanOrEqualTo(0.002f), label + " planted right foot");
                        Assert.That(baselineHips.y - posturedHips.y,
                            Is.EqualTo(crouch).Within(0.002f), label + " pelvis crouch");
                        Assert.That(baselineHead.y - posturedHead.y,
                            Is.EqualTo(crouch).Within(0.002f), label + " upper-body crouch");

                        var grip = ToUnity(proxy.batProbes[probeIndex].bat.grip, mirror);
                        var toe = ToUnity(proxy.batProbes[probeIndex].bat.toe, mirror);
                        var face = ToUnity(proxy.batProbes[probeIndex].bat.face, mirror);
                        rig.SetCanonicalBatPose(
                            grip,
                            toe,
                            face,
                            1f,
                            retargetBodyToTrace: false,
                            applyBatterNeckClearance: false);
                        AssertCanonicalBat(rig, grip, toe, face);
                        Assert.That(rig.Root.position, Is.EqualTo(rootPosition), label + " no root retarget");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips), posturedHips),
                            Is.LessThan(0.00001f), label + " no pelvis retarget");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.Head), posturedHead),
                            Is.LessThan(0.00001f), label + " no neck/head retarget");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft), posturedLeftFoot),
                            Is.LessThan(0.00001f), label + " left foot after arm IK");
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight), posturedRightFoot),
                            Is.LessThan(0.00001f), label + " right foot after arm IK");

                        var leftTarget = rig.HeroBatterGripTargetWorld(true);
                        var rightTarget = rig.HeroBatterGripTargetWorld(false);
                        var leftGap = Vector3.Distance(rig.HeroHandWorldPosition(true), leftTarget);
                        var rightGap = Vector3.Distance(rig.HeroHandWorldPosition(false), rightTarget);
                        var leftReach = Vector3.Distance(
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft), leftTarget);
                        var rightReach = Vector3.Distance(
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight), rightTarget);
                        Assert.That(Vector3.Distance(leftTarget, rightTarget),
                            Is.EqualTo(0.1f).Within(0.000001f), label + " ordered grip spacing");
                        Assert.That(leftGap,
                            Is.LessThanOrEqualTo(0.002f), label + " left hand error");
                        Assert.That(rightGap,
                            Is.LessThanOrEqualTo(0.002f), label + " right hand error");
                        Assert.That(leftReach,
                            Is.LessThanOrEqualTo(rig.HeroBatterArmUsableReach(true) + 0.000001f),
                            label + " left shoulder reach");
                        Assert.That(rightReach,
                            Is.LessThanOrEqualTo(rig.HeroBatterArmUsableReach(false) + 0.000001f),
                            label + " right shoulder reach");
                    }
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CanonicalDrive_ProductionPresentsTheSimV3RootNeverTheOldFixedRoot()
        {
            // The drive clearance evidence below runs in the production configuration. This pins why: the real
            // world, fed the golden's own scene/delivery/result packets, presents the sim-v3 static root
            // (nominal + batterRootOffset) once the carry plants, never the old fixed root without the offset.
            var drive = RepresentativePaceDrive();
            var packets = representativePaceDrivePackets;
            Assert.That(packets, Is.Not.Null);
            Assert.That(packets.scene, Is.Not.Null);
            Assert.That(packets.delivery, Is.Not.Null);
            var scene = PracticePresentationContractAdapter.Scene(
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packets.scene)).Envelope);
            var delivery = PracticePresentationContractAdapter.Delivery(
                UnityPracticePacketCodec.Decode(JsonUtility.ToJson(packets.delivery)).Envelope);
            var offset = drive.Trace.batterRootOffset;
            Assert.That(offset, Is.Not.Null);
            Assert.That(Math.Sqrt(offset.x * offset.x + offset.z * offset.z), Is.GreaterThan(0.01),
                "the representative drive must carry a measurable sim-v3 root offset");

            var host = new GameObject("canonical-drive-production-root-test");
            try
            {
                var world = host.AddComponent<ProceduralPracticeWorld>();
                world.Configure(new PracticePresentationSettings
                {
                    Assistance = "play",
                    Handedness = "right",
                    Locale = "en-IN",
                    Quality = PracticePresentationQuality.Standard
                }, new NullFeedbackSink());
                world.ConfigureScene(scene);
                var oldFixedRoot = world.BatterRootWorldPosition;
                world.BeginDelivery(delivery);
                world.Tick(0.3);
                world.AcceptResult(drive);
                world.Tick(0.25);
                world.Tick(0.25);
                var presented = world.BatterRootWorldPosition;
                // Option A world reflection (owner/lead ruling 2026-11-04): a right-hander's world is reflected once, so
                // the physics lateral root offset is presented as -x. Before the ruling this expected +offset.x.
                Assert.That(presented.x, Is.EqualTo(oldFixedRoot.x +
                                                    ProceduralPracticeWorld.WorldReflectionFor("right") * (float)offset.x)
                    .Within(0.000001f));
                Assert.That(presented.y, Is.EqualTo(oldFixedRoot.y).Within(0.000001f));
                Assert.That(presented.z, Is.EqualTo(oldFixedRoot.z + (float)offset.z).Within(0.000001f));
                Assert.That(Vector3.Distance(presented, oldFixedRoot), Is.GreaterThan(0.01f),
                    "production must never present a sim-v3 trace at the old fixed root");
            }
            finally
            {
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void CanonicalDriveSequence_KeepsTorsoAndHeadOverABoundedSupportBaseWithBatClearance(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("canonical-drive-balance-sequence-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);

                // Production configuration for a sim-v3 trace (ProceduralPracticeWorld.AcceptResult/SetBat once the
                // carry has planted): the authoritative static root = nominal + mirrored batterRootOffset, the
                // latched physics body frame and posture, and an arm-only canonical solve with no body or neck
                // retarget. The old fixed root without the body frame is never presented for a sim-v3 trace
                // (CanonicalDrive_ProductionPresentsTheSimV3RootNeverTheOldFixedRoot).
                var drive = RepresentativePaceDrive();
                var trace = drive.Trace;
                Assert.That(trace.batterRootOffset, Is.Not.Null);
                Assert.That(trace.batterPosture, Is.Not.Null);
                Assert.That(drive.BatterBodyFrame, Is.Not.Null);
                var authoritativeRoot = new Vector3(0f, 0f, 9.25f) + new Vector3(
                    mirror * (float)trace.batterRootOffset.x, 0f, (float)trace.batterRootOffset.z);
                var crouch = (float)trace.batterPosture.crouchM;
                var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                var positionLockedJoints = new[]
                {
                    ProductionCharacterJoint.Hips,
                    ProductionCharacterJoint.Spine,
                    ProductionCharacterJoint.Chest,
                    ProductionCharacterJoint.Neck,
                    ProductionCharacterJoint.Head,
                    ProductionCharacterJoint.FootLeft,
                    ProductionCharacterJoint.FootRight
                };

                for (var index = 0; index < trace.bat.Length; index++)
                {
                    var sample = trace.bat[index];
                    var tracePhase = CanonicalTracePhase(trace, sample.t);
                    var label = TraceLabel(sample, tracePhase);
                    var grip = ToUnity(sample.grip, mirror);
                    var toe = ToUnity(sample.toe, mirror);
                    var face = ToUnity(sample.face, mirror);
                    var bodyPhase = ProceduralPracticeWorld.MapCanonicalBatterTracePhase(tracePhase);
                    rig.Root.SetPositionAndRotation(
                        authoritativeRoot,
                        Quaternion.Euler(0f, 180f, -3f * mirror));
                    LatchCanonicalBatterBodyFrame(rig, drive.BatterBodyFrame, mirror);
                    rig.SetCanonicalBatterPosture(crouch);
                    rig.SampleBatterStrokeBlend(
                        bodyPhase,
                        footwork,
                        bodyPhase,
                        footwork,
                        0f,
                        applyBatterNeckClearance: false);
                    var leftFootBeforeRetarget = rig.HeroJointWorldPosition(
                        ProductionCharacterJoint.FootLeft);
                    var rightFootBeforeRetarget = rig.HeroJointWorldPosition(
                        ProductionCharacterJoint.FootRight);
                    rig.SetCanonicalBatPose(
                        grip,
                        toe,
                        face,
                        1f,
                        retargetBodyToTrace: false,
                        applyBatterNeckClearance: false);
                    Assert.That(rig.Root.position, Is.EqualTo(authoritativeRoot),
                        "the canonical solve must keep the authoritative sim-v3 root at " + label);

                    var hips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                    var chest = rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest);
                    var head = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                    var neck = rig.HeroJointWorldPosition(ProductionCharacterJoint.Neck);
                    var leftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                    var rightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                    var torso = head - hips;
                    var horizontalRight = Vector3.ProjectOnPlane(rig.Root.right, Vector3.up).normalized;
                    var upright = Mathf.Max(0.0001f, Vector3.Dot(torso, Vector3.up));
                    var torsoLean = Vector3.Angle(Vector3.up, torso);
                    var torsoRoll = Mathf.Atan2(
                        Mathf.Abs(Vector3.Dot(torso, horizontalRight)), upright) * Mathf.Rad2Deg;
                    var stanceWidth = GroundDistance(leftFoot, rightFoot);
                    var headOverBase = GroundDistanceToSegment(head, leftFoot, rightFoot);
                    var helmetCentre = VisibleHelmetCentre(rig);
                    var headBatClearance = DistanceToSegment(helmetCentre, grip, toe);
                    var neckBatClearance = DistanceToSegment(neck, grip, toe);
                    var cameraPosition = Vande.Practice.Presentation.ProceduralPracticeWorld
                        .BatterCameraPosition(0f, 0f, mirror);
                    var cameraTarget = Vande.Practice.Presentation.ProceduralPracticeWorld
                        .BatterCameraTarget(0f);
                    var worldToView = Quaternion.Inverse(Quaternion.LookRotation(
                        cameraTarget - cameraPosition, Vector3.up));
                    var projectedHeadClearance = ProjectedSurfaceClearance(
                        helmetCentre, 0.11f, grip, toe,
                        CricketPropDimensions.BladeWidth * 0.5f,
                        cameraPosition, worldToView);
                    var projectedNeckClearance = ProjectedSurfaceClearance(
                        neck, 0.075f, grip, toe,
                        CricketPropDimensions.BladeWidth * 0.5f,
                        cameraPosition, worldToView);
                    Assert.That(chest.y, Is.GreaterThan(hips.y + 0.16f),
                        "chest must stay above pelvis at " + label);
                    Assert.That(head.y, Is.GreaterThan(chest.y + 0.10f),
                        "head must stay stacked above chest at " + label);
                    Assert.That(torsoLean, Is.LessThanOrEqualTo(24f),
                        "total torso lean at " + label);
                    Assert.That(torsoRoll, Is.LessThanOrEqualTo(15f),
                        "lateral torso roll at " + label);
                    Assert.That(stanceWidth, Is.InRange(0.20f, 0.82f),
                        "support width at " + label);
                    Assert.That(headOverBase, Is.LessThanOrEqualTo(0.28f),
                        "head must remain over the planted support base at " + label);
                    var leftFootDelta = leftFoot - leftFootBeforeRetarget;
                    var rightFootDelta = rightFoot - rightFootBeforeRetarget;
                    Assert.That(Mathf.Abs(leftFootDelta.y), Is.LessThan(0.00001f),
                        "left foot must not float or sink at " + label);
                    Assert.That(Mathf.Abs(rightFootDelta.y), Is.LessThan(0.00001f),
                        "right foot must not float or sink at " + label);
                    Assert.That(new Vector2(
                            leftFootDelta.x - rightFootDelta.x,
                            leftFootDelta.z - rightFootDelta.z).magnitude,
                        Is.LessThan(0.0001f),
                        "both planted feet must share the bounded ground translation at " + label);
                    for (var jointIndex = 0;
                         jointIndex < positionLockedJoints.Length;
                         jointIndex++)
                    {
                        var joint = positionLockedJoints[jointIndex];
                        Assert.That(Vector3.Distance(
                                rig.HeroJointLocalPosition(joint),
                                rig.HeroJointAuthoredLocalPosition(joint)),
                            Is.LessThan(0.000001f),
                            joint + " local position must remain authored at " + label);
                    }
                    Assert.That(
                        headBatClearance - 0.11f - CricketPropDimensions.BladeWidth * 0.5f,
                        Is.GreaterThanOrEqualTo(0.01f),
                        "law-scale bat surface must clear the helmet at " + label);
                    Assert.That(
                        neckBatClearance - 0.075f - CricketPropDimensions.BladeWidth * 0.5f,
                        Is.GreaterThanOrEqualTo(0.01f),
                        "law-scale bat surface must clear the neck at " + label);
                    Assert.That(projectedHeadClearance, Is.GreaterThanOrEqualTo(0.003f),
                        "bat must not cross the helmet in the locked camera at " + label);
                    Assert.That(projectedNeckClearance, Is.GreaterThanOrEqualTo(0.003f),
                        "bat must not cross the neck in the locked camera at " + label);
                    Assert.That(Vector3.Distance(rig.Bat.position, grip), Is.LessThan(0.000001f));
                    Assert.That(Vector3.Angle(
                            rig.Bat.TransformDirection(Vector3.down), toe - grip),
                        Is.LessThan(0.03f));
                    AssertCanonicalBat(rig, grip, toe, face);
                    AssertHeroHandsUseOrderedTargets(rig, handedness);
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void DeadBallRecovery_BlendsTheHeldCanonicalFinishIntoAJoinedBalancedBatPose(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("dead-ball-bat-recovery-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));

                var drive = RepresentativePaceDrive();
                var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                var terminal = drive.Trace.bat[drive.Trace.bat.Length - 1];
                var canonicalGrip = ToUnity(terminal.grip, mirror);
                var canonicalToe = ToUnity(terminal.toe, mirror);
                var canonicalFace = ToUnity(terminal.face, mirror);
                rig.SampleBatterStroke(
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    footwork);
                rig.SetCanonicalBatPose(canonicalGrip, canonicalToe, canonicalFace);
                var canonicalRotation = rig.Bat.rotation;

                rig.ApplyBatterDeadBallRecovery(
                    canonicalGrip, canonicalRotation, footwork, 1f);
                var settledGrip = rig.Bat.position;
                var settledRotation = rig.Bat.rotation;
                Assert.That(Vector3.Distance(settledGrip, canonicalGrip), Is.GreaterThan(0.12f),
                    "the dead-ball beat must visibly lower and settle the held high finish");
                Assert.That(Quaternion.Angle(settledRotation, canonicalRotation), Is.GreaterThan(8f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);

                rig.ApplyBatterDeadBallRecovery(
                    canonicalGrip, canonicalRotation, footwork, 0f);
                Assert.That(Vector3.Distance(rig.Bat.position, canonicalGrip), Is.LessThan(0.000001f),
                    "recovery amount zero must preserve the exact last canonical frame");
                Assert.That(Quaternion.Angle(rig.Bat.rotation, canonicalRotation), Is.LessThan(0.0001f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);

                rig.ApplyBatterDeadBallRecovery(
                    canonicalGrip, canonicalRotation, footwork, 0.5f);
                Assert.That(Vector3.Distance(
                        rig.Bat.position, Vector3.Lerp(canonicalGrip, settledGrip, 0.5f)),
                    Is.LessThan(0.00001f), "mid recovery must be seekable and deterministic");
                Assert.That(Quaternion.Angle(
                        rig.Bat.rotation, Quaternion.Slerp(canonicalRotation, settledRotation, 0.5f)),
                    Is.LessThan(0.001f));
                AssertHeroHandsUseOrderedTargets(rig, handedness);

                rig.ApplyBatterDeadBallRecovery(
                    canonicalGrip, canonicalRotation, footwork, 1f);
                Assert.That(Vector3.Distance(rig.Bat.position, settledGrip), Is.LessThan(0.00001f));
                Assert.That(Quaternion.Angle(rig.Bat.rotation, settledRotation), Is.LessThan(0.001f));
                Assert.That(rig.Bat.position.y,
                    Is.LessThanOrEqualTo(
                        Mathf.Max(
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft).y,
                            rig.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight).y) + 0.12f),
                    "settled grip must finish around the shoulder line, not frozen overhead");
                AssertHeroHandsUseOrderedTargets(rig, handedness);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        // A "Left" rig presents a canonical right-hander (RigHandednessFor), whose world reflection is -1; a "Right"
        // rig a left-hander (+1). Each case pairs a rig with its own world, as the production world does.
        [TestCase(ProductionCharacterHandedness.Right, 1f)]
        [TestCase(ProductionCharacterHandedness.Left, -1f)]
        public void DeadBallRecovery_PreservesItsSourceThenMovesEveryQuarterIntoAnUprightFinish(
            ProductionCharacterHandedness handedness,
            float mirror)
        {
            var host = new GameObject("dead-ball-body-recovery-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.Root.SetPositionAndRotation(
                    new Vector3(0f, 0f, 9.25f),
                    Quaternion.Euler(0f, 180f, -3f * mirror));

                var drive = RepresentativePaceDrive();
                var footwork = ProductionBatterFootworkAdapter.FromHostIntent(drive.Footwork);
                var terminal = drive.Trace.bat[drive.Trace.bat.Length - 1];
                var canonicalGrip = ToUnity(terminal.grip, mirror);
                var canonicalToe = ToUnity(terminal.toe, mirror);
                var canonicalFace = ToUnity(terminal.face, mirror);
                rig.SampleBatterStroke(
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    footwork);
                rig.SetCanonicalBatPose(canonicalGrip, canonicalToe, canonicalFace);
                var canonicalRotation = rig.Bat.rotation;
                var sourceHips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var sourceChest = rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest);
                var sourceHead = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);

                rig.BeginBatterDeadBallRecovery(
                    canonicalGrip, canonicalRotation, footwork);
                Assert.That(Vector3.Distance(
                        rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips), sourceHips),
                    Is.LessThan(0.001f), "precomputing recovery must not pop the pelvis");
                Assert.That(Vector3.Distance(
                        rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest), sourceChest),
                    Is.LessThan(0.001f), "precomputing recovery must not pop the torso");
                Assert.That(Vector3.Distance(
                        rig.HeroJointWorldPosition(ProductionCharacterJoint.Head), sourceHead),
                    Is.LessThan(0.001f), "precomputing recovery must not pop the head");
                Assert.That(Vector3.Distance(rig.Bat.position, canonicalGrip), Is.LessThan(0.000001f));
                Assert.That(Quaternion.Angle(rig.Bat.rotation, canonicalRotation), Is.LessThan(0.0001f));

                var amounts = new[] { 0f, 0.25f, 0.50f, 0.75f, 1f };
                var cameraPosition = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraPosition(0f, 0f, mirror);
                var cameraTarget = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraTarget(0f);
                var worldToView = Quaternion.Inverse(Quaternion.LookRotation(
                    cameraTarget - cameraPosition, Vector3.up));
                var priorGrip = canonicalGrip;
                var priorRotation = canonicalRotation;
                for (var index = 0; index < amounts.Length; index++)
                {
                    var easedAmount = Mathf.SmoothStep(0f, 1f, amounts[index]);
                    rig.ApplyBatterDeadBallRecovery(
                        canonicalGrip,
                        canonicalRotation,
                        footwork,
                        easedAmount);
                    if (index == 0)
                    {
                        Assert.That(Vector3.Distance(rig.Bat.position, canonicalGrip),
                            Is.LessThan(0.000001f));
                        Assert.That(Quaternion.Angle(rig.Bat.rotation, canonicalRotation),
                            Is.LessThan(0.0001f));
                        Assert.That(Vector3.Distance(
                                rig.HeroJointWorldPosition(ProductionCharacterJoint.Head), sourceHead),
                            Is.LessThan(0.001f));
                    }
                    else
                    {
                        Assert.That(Vector3.Distance(rig.Bat.position, priorGrip),
                            Is.GreaterThan(0.02f),
                            "recovery must remain visibly non-frozen at quarter " + amounts[index]);
                        Assert.That(Quaternion.Angle(rig.Bat.rotation, priorRotation),
                            Is.GreaterThan(1f),
                            "bat arc must continue at quarter " + amounts[index]);
                    }
                    priorGrip = rig.Bat.position;
                    priorRotation = rig.Bat.rotation;
                    AssertHeroHandsUseOrderedTargets(rig, handedness);

                    var recoveryHelmetCentre = VisibleHelmetCentre(rig);
                    var recoveryNeck = rig.HeroJointWorldPosition(ProductionCharacterJoint.Neck);
                    var recoveryToe = rig.BatToeWorld;
                    Assert.That(
                        DistanceToSegment(recoveryHelmetCentre, rig.Bat.position, recoveryToe) -
                        0.11f - CricketPropDimensions.BladeWidth * 0.5f,
                        Is.GreaterThanOrEqualTo(0.01f),
                        "recovery bat surface must clear the helmet at eased quarter " + amounts[index]);
                    Assert.That(
                        DistanceToSegment(recoveryNeck, rig.Bat.position, recoveryToe) -
                        0.075f - CricketPropDimensions.BladeWidth * 0.5f,
                        Is.GreaterThanOrEqualTo(0.01f),
                        "recovery bat surface must clear the neck at eased quarter " + amounts[index]);
                    Assert.That(ProjectedSurfaceClearance(
                            recoveryHelmetCentre, 0.11f, rig.Bat.position, recoveryToe,
                            CricketPropDimensions.BladeWidth * 0.5f,
                            cameraPosition, worldToView),
                        Is.GreaterThanOrEqualTo(0.003f),
                        "recovery bat must clear the helmet in the locked camera at eased quarter " +
                        amounts[index]);
                    Assert.That(ProjectedSurfaceClearance(
                            recoveryNeck, 0.075f, rig.Bat.position, recoveryToe,
                            CricketPropDimensions.BladeWidth * 0.5f,
                            cameraPosition, worldToView),
                        Is.GreaterThanOrEqualTo(0.003f),
                        "recovery bat must clear the neck in the locked camera at eased quarter " +
                        amounts[index]);
                }

                var hips = rig.HeroJointWorldPosition(ProductionCharacterJoint.Hips);
                var chest = rig.HeroJointWorldPosition(ProductionCharacterJoint.Chest);
                var head = rig.HeroJointWorldPosition(ProductionCharacterJoint.Head);
                var leftFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                var rightFoot = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                var torso = head - hips;
                var horizontalRight = Vector3.ProjectOnPlane(rig.Root.right, Vector3.up).normalized;
                var upright = Mathf.Max(0.0001f, Vector3.Dot(torso, Vector3.up));
                var torsoRoll = Mathf.Atan2(
                    Mathf.Abs(Vector3.Dot(torso, horizontalRight)), upright) * Mathf.Rad2Deg;

                Assert.That(Vector3.Distance(head, sourceHead), Is.GreaterThan(0.02f),
                    "the body must visibly recover as well as the bat");
                Assert.That(chest.y, Is.GreaterThan(hips.y + 0.16f));
                Assert.That(head.y, Is.GreaterThan(chest.y + 0.10f));
                Assert.That(Vector3.Angle(Vector3.up, torso), Is.LessThanOrEqualTo(18f));
                Assert.That(torsoRoll, Is.LessThanOrEqualTo(11f));
                Assert.That(GroundDistance(leftFoot, rightFoot), Is.InRange(0.20f, 0.70f));
                Assert.That(GroundDistanceToSegment(head, leftFoot, rightFoot),
                    Is.LessThanOrEqualTo(0.22f));
                Assert.That(DistanceToSegment(VisibleHelmetCentre(rig),
                                rig.Bat.position, rig.BatToeWorld) -
                            0.11f - CricketPropDimensions.BladeWidth * 0.5f,
                    Is.GreaterThanOrEqualTo(0.01f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterStance_AppliesBoundedDeterministicFingerCurl(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("batter-stance-curl-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var bones = rig.HeroSkinnedRenderer.bones;

                rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);
                var leftRest = bones[35].localRotation;
                var rightRest = bones[54].localRotation;

                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                var leftFirst = bones[35].localRotation;
                var rightFirst = bones[54].localRotation;
                var expectedMiddleCurl = 38f * ProductionHeroReferenceMotionLayer.BatterStanceGripCurl;
                Assert.That(Quaternion.Angle(leftRest, leftFirst),
                    Is.EqualTo(expectedMiddleCurl).Within(0.05f));
                Assert.That(Quaternion.Angle(rightRest, rightFirst),
                    Is.EqualTo(expectedMiddleCurl).Within(0.05f));
                Assert.That(Quaternion.Angle(leftRest, leftFirst), Is.LessThan(38f));
                Assert.That(Quaternion.Angle(rightRest, rightFirst), Is.LessThan(38f));

                rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0f);
                Assert.That(Quaternion.Angle(leftFirst, bones[35].localRotation), Is.LessThan(0.0001f));
                Assert.That(Quaternion.Angle(rightFirst, bones[54].localRotation), Is.LessThan(0.0001f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right)]
        [TestCase(ProductionCharacterHandedness.Left)]
        public void BatterStroke_KeepsFingerClosureThroughTerminalRecovery(
            ProductionCharacterHandedness handedness)
        {
            var host = new GameObject("batter-stroke-terminal-curl-test");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                var bones = rig.HeroSkinnedRenderer.bones;

                rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);
                var leftRest = bones[35].localRotation;
                var rightRest = bones[54].localRotation;
                var phases = new[]
                {
                    ProductionCharacterMotionSampler.BatterContact,
                    ProductionCharacterMotionSampler.BatterFollowThrough,
                    1f
                };
                var expectedMiddleCurl = 38f *
                                         ProductionHeroReferenceMotionLayer.BatterStrokeGripCurl;
                for (var index = 0; index < phases.Length; index++)
                {
                    rig.SampleBatterStroke(phases[index], ProductionBatterFootwork.Forward);
                    Assert.That(Quaternion.Angle(leftRest, bones[35].localRotation),
                        Is.EqualTo(expectedMiddleCurl).Within(0.05f),
                        "left glove must remain closed at phase " + phases[index]);
                    Assert.That(Quaternion.Angle(rightRest, bones[54].localRotation),
                        Is.EqualTo(expectedMiddleCurl).Within(0.05f),
                        "right glove must remain closed at phase " + phases[index]);
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        private static PracticeResultPresentation[] SharedPracticeResults()
        {
            if (sharedPracticeResults != null) return sharedPracticeResults;
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore(
                    "practice-v3 shared golden is pending TypeScript regeneration; " +
                    "authoritative-root reach evidence cannot run against an invented local fixture.");
            var fixture = JsonUtility.FromJson<RepresentativeFixture>(File.ReadAllText(path));
            Assert.That(fixture, Is.Not.Null);
            Assert.That(fixture.cases, Has.Length.EqualTo(7));
            var results = new PracticeResultPresentation[fixture.cases.Length];
            for (var index = 0; index < fixture.cases.Length; index++)
            {
                var item = fixture.cases[index];
                Assert.That(item, Is.Not.Null);
                Assert.That(item.wire, Is.Not.Null, item.id);
                Assert.That(item.wire.packets, Is.Not.Null, item.id);
                Assert.That(item.wire.packets.result, Is.Not.Null, item.id);
                var decoded = UnityPracticePacketCodec.Decode(
                    JsonUtility.ToJson(item.wire.packets.result));
                Assert.That(decoded.Envelope.type, Is.EqualTo("host.result"), item.id);
                results[index] = PracticePresentationContractAdapter.Result(decoded.Envelope);
                Assert.That(results[index].Trace, Is.Not.Null, item.id);
                Assert.That(results[index].Trace.batterRootOffset, Is.Not.Null, item.id);
                Assert.That(results[index].Trace.batterPosture, Is.Not.Null, item.id);
                Assert.That(results[index].Trace.bat, Is.Not.Null, item.id);
                Assert.That(results[index].Trace.batterMotion == null,
                    Is.EqualTo(results[index].Trace.bat.Length == 0), item.id);
            }
            sharedPracticeResults = results;
            return sharedPracticeResults;
        }

        private static ReachProxy[] SharedReachProxies()
        {
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore(
                    "practice-v3 shared golden is pending TypeScript regeneration; " +
                    "corpus-selected reach proxies must not be invented in Unity.");
            var fixture = JsonUtility.FromJson<RepresentativeFixture>(File.ReadAllText(path));
            Assert.That(fixture, Is.Not.Null);
            Assert.That(fixture.reachProxies, Is.Not.Null.And.Not.Empty,
                "practice-v3 must include the frozen corpus-selected reachProxies block");
            return fixture.reachProxies;
        }

        private static RepresentativePackets representativePaceDrivePackets;

        private static PracticeResultPresentation RepresentativePaceDrive()
        {
            if (representativePaceDrive != null) return representativePaceDrive;
            var path = Path.GetFullPath(Path.Combine(
                Application.dataPath, "..", "..", "..", "tests", "fixtures",
                "unity-practice", "practice-v3.json"));
            if (!File.Exists(path))
                Assert.Ignore(
                    "practice-v3 shared golden is pending TypeScript regeneration; " +
                    "representative pose evidence cannot run against an invented local fixture.");
            var fixture = JsonUtility.FromJson<RepresentativeFixture>(File.ReadAllText(path));
            Assert.That(fixture, Is.Not.Null);
            Assert.That(fixture.cases, Is.Not.Null);

            RepresentativeCase selected = null;
            for (var index = 0; index < fixture.cases.Length; index++)
            {
                var item = fixture.cases[index];
                if (item != null && item.id == RepresentativeDriveCaseId &&
                    item.referenceBall == RepresentativeDriveReferenceBallId)
                {
                    selected = item;
                    break;
                }
            }

            Assert.That(selected, Is.Not.Null,
                "shared golden must contain grounded-attack/ref-3");
            Assert.That(selected.wire, Is.Not.Null);
            Assert.That(selected.wire.packets, Is.Not.Null);
            Assert.That(selected.wire.packets.result, Is.Not.Null);
            var decoded = UnityPracticePacketCodec.Decode(
                JsonUtility.ToJson(selected.wire.packets.result));
            Assert.That(decoded.Envelope.type, Is.EqualTo("host.result"));
            Assert.That(decoded.Envelope.deliveryId, Is.EqualTo("golden-grounded-attack"));
            var result = PracticePresentationContractAdapter.Result(decoded.Envelope);
            Assert.That(result.Trace, Is.Not.Null);
            Assert.That(result.Trace.bat, Is.Not.Null);
            Assert.That(result.Trace.bat.Length, Is.GreaterThan(1));
            Assert.That(result.Footwork, Is.Not.Null.And.Not.Empty);
            representativePaceDrivePackets = selected.wire.packets;
            representativePaceDrive = result;
            return representativePaceDrive;
        }

        private static BatTraceSample FurthestDownPitchSample(CanonicalDeliveryTrace trace)
        {
            Assert.That(trace, Is.Not.Null);
            Assert.That(trace.bat, Is.Not.Null);
            Assert.That(trace.bat.Length, Is.GreaterThan(0));
            var selected = trace.bat[0];
            for (var index = 1; index < trace.bat.Length; index++)
            {
                if (trace.bat[index].grip.z < selected.grip.z) selected = trace.bat[index];
            }
            return selected;
        }

        private static float CanonicalTracePhase(CanonicalDeliveryTrace trace, double sampleTime)
        {
            Assert.That(trace, Is.Not.Null);
            Assert.That(trace.bat, Is.Not.Null);
            Assert.That(trace.bat.Length, Is.GreaterThan(1));
            Assert.That(trace.batterMotion, Is.Not.Null);
            var motion = trace.batterMotion;
            if (sampleTime <= motion.contactT)
            {
                var preContact = motion.contactT - motion.startT;
                if (preContact <= 0.000001)
                    return ProductionCharacterMotionSampler.BatterContact;
                return Mathf.Clamp01((float)((sampleTime - motion.startT) / preContact)) *
                       ProductionCharacterMotionSampler.BatterContact;
            }
            var followThrough = motion.endT - motion.contactT;
            if (followThrough <= 0.000001)
                return ProductionCharacterMotionSampler.BatterFollowThrough;
            return Mathf.Lerp(
                ProductionCharacterMotionSampler.BatterContact,
                1f,
                Mathf.Clamp01((float)((sampleTime - motion.contactT) / followThrough)));
        }

        private static Vector3 ToUnity(TraceVector3 value, float mirror)
        {
            Assert.That(value, Is.Not.Null);
            return new Vector3(
                mirror * (float)value.x,
                (float)value.y,
                (float)value.z);
        }

        private static void LatchCanonicalBatterBodyFrame(
            ProductionCharacterRig rig,
            PracticeBatterBodyFramePresentation frame,
            float mirror)
        {
            Assert.That(frame, Is.Not.Null);
            LatchCanonicalBatterBodyFrame(
                rig, frame.Stance, frame.TorsoTop, frame.HeadCentre, mirror);
        }

        private static void LatchCanonicalBatterBodyFrame(
            ProductionCharacterRig rig,
            ReachBatterBodyFrame frame,
            float mirror)
        {
            Assert.That(frame, Is.Not.Null);
            LatchCanonicalBatterBodyFrame(
                rig, frame.stance, frame.torsoTop, frame.headCentre, mirror);
        }

        private static void LatchCanonicalBatterBodyFrame(
            ProductionCharacterRig rig,
            TraceVector2 stance,
            TraceVector3 torsoTop,
            TraceVector3 headCentre,
            float mirror)
        {
            Assert.That(rig, Is.Not.Null);
            Assert.That(stance, Is.Not.Null);
            Assert.That(torsoTop, Is.Not.Null);
            Assert.That(headCentre, Is.Not.Null);
            rig.SetCanonicalBatterBodyFrame(
                new Vector3(mirror * (float)stance.x, 0f, (float)stance.z),
                ToUnity(torsoTop, mirror),
                ToUnity(headCentre, mirror));
        }

        private static void AssertCanonicalBatterBodyFrameAlignment(
            ProductionCharacterRig rig,
            PracticeBatterBodyFramePresentation frame,
            float mirror,
            string label)
        {
            AssertCanonicalBatterBodyFrameAlignment(
                rig, frame.Stance, frame.TorsoTop, frame.HeadCentre, mirror, label);
        }

        private static void AssertCanonicalBatterBodyFrameAlignment(
            ProductionCharacterRig rig,
            ReachBatterBodyFrame frame,
            float mirror,
            string label)
        {
            AssertCanonicalBatterBodyFrameAlignment(
                rig, frame.stance, frame.torsoTop, frame.headCentre, mirror, label);
        }

        private static void AssertCanonicalBatterBodyFrameAlignment(
            ProductionCharacterRig rig,
            TraceVector2 stance,
            TraceVector3 torsoTop,
            TraceVector3 headCentre,
            float mirror,
            string label)
        {
            var expectedStance = new Vector3(
                mirror * (float)stance.x, 0f, (float)stance.z);
            var expectedTorso = ToUnity(torsoTop, mirror);
            var expectedHead = ToUnity(headCentre, mirror);
            var sampledShoulderMidpoint = rig.CanonicalBatterAlignedShoulderMidpointWorld;
            Assert.That(rig.CanonicalBatterBodyFrameValid, Is.True, label);
            Assert.That(Vector3.Distance(rig.CanonicalBatterStanceWorld, expectedStance),
                Is.LessThan(0.000001f), label + " latched stance mirror");
            Assert.That(Vector3.Distance(rig.CanonicalBatterTorsoTopTargetWorld, expectedTorso),
                Is.LessThan(0.000001f), label + " latched torso mirror");
            Assert.That(Vector3.Distance(rig.CanonicalBatterHeadCentreWorld, expectedHead),
                Is.LessThan(0.000001f), label + " latched head mirror");
            Assert.That(rig.CanonicalBatterAlignedShoulderFrameValid, Is.True,
                label + " sampled production body frame");
            Assert.That(Mathf.Abs(sampledShoulderMidpoint.x - expectedTorso.x),
                Is.LessThan(0.00001f), label + " aligned shoulder-frame x");
            Assert.That(Mathf.Abs(sampledShoulderMidpoint.z -
                                  (expectedTorso.z + ProductionCharacterRig.CanonicalBatterShoulderZMetres)),
                Is.LessThan(0.00001f), label + " aligned shoulder-frame z");
            Assert.That(Mathf.Abs(sampledShoulderMidpoint.y -
                                  (expectedTorso.y + ProductionCharacterRig.CanonicalBatterShoulderYMetres)),
                Is.LessThanOrEqualTo(0.002f), label + " aligned shoulder-frame y");
        }

        private static string TraceLabel(BatTraceSample sample, float tracePhase)
        {
            return "trace phase " + tracePhase + " (t=" + sample.t + ")";
        }

        private static void AssertHeroHandsUseOrderedTargets(
            ProductionCharacterRig rig,
            ProductionCharacterHandedness handedness)
        {
            var topIsLeft = handedness == ProductionCharacterHandedness.Right;
            var topTarget = rig.HeroBatterGripTargetWorld(topIsLeft);
            var lowerTarget = rig.HeroBatterGripTargetWorld(!topIsLeft);
            var downHandle = rig.Bat.TransformDirection(Vector3.down).normalized;
            Assert.That(Vector3.Dot(lowerTarget - topTarget, downHandle),
                Is.EqualTo(ProductionCharacterRig.BatterLowerHandGripOffsetMetres -
                           ProductionCharacterRig.BatterTopHandGripOffsetMetres).Within(0.000001f));
            Assert.That(Vector3.Distance(topTarget, lowerTarget), Is.EqualTo(0.1f).Within(0.000001f),
                "sim-v3 fixes the ordered glove centres at 100 mm while sharing the 0.30 m handle");
            Assert.That(Vector3.Distance(rig.HeroHandWorldPosition(topIsLeft), topTarget),
                Is.LessThanOrEqualTo(0.02f));
            Assert.That(Vector3.Distance(rig.HeroHandWorldPosition(!topIsLeft), lowerTarget),
                Is.LessThanOrEqualTo(0.02f));
            Assert.That(Vector3.Distance(
                    rig.HeroHandWorldPosition(topIsLeft),
                    rig.HeroHandWorldPosition(!topIsLeft)),
                Is.GreaterThanOrEqualTo(0.08f),
                "the visible glove centres must not collapse back into one merged grip volume");
        }

        private static void AssertCanonicalBat(
            ProductionCharacterRig rig,
            Vector3 grip,
            Vector3 toe,
            Vector3 face)
        {
            Assert.That(Vector3.Distance(rig.Bat.position, grip), Is.LessThan(0.000001f));
            Assert.That(Vector3.Angle(rig.Bat.TransformDirection(Vector3.down), toe - grip),
                Is.LessThan(0.03f));
            var up = (grip - toe).normalized;
            var projectedFace = face - up * Vector3.Dot(face, up);
            Assert.That(projectedFace.sqrMagnitude, Is.GreaterThan(0.000001f));
            Assert.That(Vector3.Angle(
                    rig.Bat.TransformDirection(Vector3.forward), projectedFace.normalized),
                Is.LessThan(0.03f),
                "canonical bat-face normal must remain exact for replay and Coach authority");
        }

        private static float GroundDistance(Vector3 from, Vector3 to)
        {
            return Vector2.Distance(new Vector2(from.x, from.z), new Vector2(to.x, to.z));
        }

        private static float GroundDistanceToSegment(Vector3 point, Vector3 from, Vector3 to)
        {
            return DistanceToSegment(
                new Vector3(point.x, 0f, point.z),
                new Vector3(from.x, 0f, from.z),
                new Vector3(to.x, 0f, to.z));
        }

        private static float ProjectedSurfaceClearance(
            Vector3 point,
            float pointRadius,
            Vector3 from,
            Vector3 to,
            float batRadius,
            Vector3 cameraPosition,
            Quaternion worldToView)
        {
            var pointView = worldToView * (point - cameraPosition);
            var fromView = worldToView * (from - cameraPosition);
            var toView = worldToView * (to - cameraPosition);
            if (pointView.z <= 0.0001f || fromView.z <= 0.0001f || toView.z <= 0.0001f)
                return float.NegativeInfinity;
            var projectedPoint = new Vector2(pointView.x / pointView.z, pointView.y / pointView.z);
            var projectedFrom = new Vector2(fromView.x / fromView.z, fromView.y / fromView.z);
            var projectedTo = new Vector2(toView.x / toView.z, toView.y / toView.z);
            var projectedBatDepth = Mathf.Min(fromView.z, toView.z);
            return DistanceToSegment(projectedPoint, projectedFrom, projectedTo) -
                   pointRadius / pointView.z - batRadius / projectedBatDepth;
        }

        private static float DistanceToSegment(Vector2 point, Vector2 from, Vector2 to)
        {
            var span = to - from;
            if (span.sqrMagnitude <= 0.000001f) return Vector2.Distance(point, from);
            var amount = Mathf.Clamp01(Vector2.Dot(point - from, span) / span.sqrMagnitude);
            return Vector2.Distance(point, from + span * amount);
        }

        private static float DistanceToSegment(Vector3 point, Vector3 from, Vector3 to)
        {
            var span = to - from;
            if (span.sqrMagnitude <= 0.000001f) return Vector3.Distance(point, from);
            var amount = Mathf.Clamp01(Vector3.Dot(point - from, span) / span.sqrMagnitude);
            return Vector3.Distance(point, from + span * amount);
        }

        private static Vector3 VisibleHelmetCentre(ProductionCharacterRig rig)
        {
            return rig.HeroGearSkinnedRenderer.bones[11].TransformPoint(
                new Vector3(0f, 0.088756f, 0.025890f));
        }

        private static PracticeBatterBodyFramePresentation InvalidBatterBodyFrame(string invalidKind)
        {
            if (invalidKind == "missing") return null;
            var frame = new PracticeBatterBodyFramePresentation
            {
                Stance = new TraceVector2 { x = -0.15, z = 8.96 },
                TorsoTop = TraceVector(-0.3, 1.42, 8.94),
                HeadCentre = TraceVector(-0.2, 1.62, 8.86)
            };
            switch (invalidKind)
            {
                case "nonfinite":
                    frame.TorsoTop.x = double.NaN;
                    return frame;
                case "out_of_domain":
                    frame.Stance.x = 3.01;
                    return frame;
                case "incoherent":
                    frame.TorsoTop.x = 2.90;
                    frame.HeadCentre.x = 2.80;
                    return frame;
                default:
                    throw new ArgumentOutOfRangeException(nameof(invalidKind));
            }
        }

        private static PracticeScenePresentation BodyFrameValidationScene()
        {
            var fielders = new PracticeFielderPresentation[11];
            for (var index = 0; index < fielders.Length; index++)
            {
                fielders[index] = new PracticeFielderPresentation
                {
                    Id = "body-frame-fielder-" + index,
                    Role = index == 0 ? "keeper" : index == 1 ? "bowler" : "point",
                    X = index - 5,
                    Z = index * 2
                };
            }
            return new PracticeScenePresentation
            {
                BallAge = "new",
                BallColour = "red",
                BatterCreaseOffsetM = 0,
                BatterLateralM = 0,
                BowlerArm = "right",
                BowlerFamily = "pace",
                Conditions = "balanced",
                Fielders = fielders,
                Handedness = "right"
            };
        }

        private static PracticeDeliveryPresentation BodyFrameValidationDelivery()
        {
            return new PracticeDeliveryPresentation
            {
                Flight = new[]
                {
                    new BallTraceSample
                    {
                        t = 0.0,
                        p = TraceVector(0.0, 2.0, -8.0),
                        v = TraceVector(0.0, -1.0, 35.0)
                    },
                    new BallTraceSample
                    {
                        t = 1.0,
                        p = TraceVector(0.0, 0.4, 9.0),
                        v = TraceVector(0.0, 0.0, 20.0)
                    }
                },
                SeamAxis = TraceVector(0.0, 1.0, 0.0),
                ShineDirection = TraceVector(1.0, 0.0, 0.0),
                SpinAxis = TraceVector(0.0, 1.0, 0.0),
                SpinRps = 10.0
            };
        }

        private static TraceVector3 TraceVector(double x, double y, double z)
        {
            return new TraceVector3 { x = x, y = y, z = z };
        }

        [Serializable]
        private sealed class RepresentativeFixture
        {
            public RepresentativeCase[] cases;
            public ReachProxy[] reachProxies;
        }

        [Serializable]
        private sealed class ReachProxy
        {
            public string id;
            public string family;
            public string footwork;
            public double contactU;
            public TraceVector2 batterRootOffset;
            public ReachBatterBodyFrame batterBodyFrame;
            public TraceBatterPosture batterPosture;
            public TraceBatterMotion batterMotion;
            public ReachBatProbe[] batProbes;
        }

        [Serializable]
        private sealed class ReachBatterBodyFrame
        {
            public TraceVector2 stance;
            public TraceVector3 torsoTop;
            public TraceVector3 headCentre;
        }

        [Serializable]
        private sealed class ReachBatProbe
        {
            public double t;
            public ReachBatPose bat;
        }

        [Serializable]
        private sealed class ReachBatPose
        {
            public TraceVector3 grip;
            public TraceVector3 toe;
            public TraceVector3 face;
        }

        [Serializable]
        private sealed class RepresentativeCase
        {
            public string id;
            public string referenceBall;
            public RepresentativeWire wire;
        }

        [Serializable]
        private sealed class RepresentativeWire
        {
            public RepresentativePackets packets;
        }

        [Serializable]
        private sealed class RepresentativePackets
        {
            public UnityPracticePacket scene;
            public UnityPracticePacket delivery;
            public UnityPracticePacket result;
        }

        private sealed class NullFeedbackSink : IPracticeFeedbackSink
        {
            public void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled) { }
            public void Handle(PracticeFeedbackEvent feedback) { }
            public void SetPaused(bool paused) { }
            public void StopAll() { }
        }
    }
}
