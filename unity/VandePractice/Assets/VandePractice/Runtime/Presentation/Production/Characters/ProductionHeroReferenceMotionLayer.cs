using System;
using UnityEngine;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Bounded, optional reference-motion layer for the 75-bone hero only. It never moves the gameplay root and
    /// never reads motion markers as release/contact events. The canonical cricket sampler remains authoritative;
    /// this layer adds low-weight locomotion/weight-transfer deltas and secondary deformation-bone motion after the
    /// canonical pose has been applied.
    /// </summary>
    internal sealed class ProductionHeroReferenceMotionLayer
    {
        internal const string RunUpResourceKey = "ProductionCharacters/motion-runup";
        internal const string BattingWeightResourceKey = "ProductionCharacters/motion-batting-weight";
        internal const float MaximumRunUpBlend = 0.32f;
        internal const float MaximumBattingBlend = 0.14f;
        internal const float BatterStanceGripCurl = 0.82f;
        internal const float BatterStrokeGripCurl = 0.90f;
        private const float MaximumBatterTorsoLeanDegrees = 16.5f;
        private const float MaximumBatterTorsoRollDegrees = 9.5f;

        private readonly struct BoneBlend
        {
            public BoneBlend(ProductionReferenceMotionBone source, int heroBone, float scale = 1f)
            {
                Source = source;
                HeroBone = heroBone;
                Scale = scale;
            }

            public ProductionReferenceMotionBone Source { get; }
            public int HeroBone { get; }
            public float Scale { get; }
        }

        // VSK1 indices are the stable V3_BONE_NAMES order in export-unity-production-character-v3.mjs.
        private static readonly BoneBlend[] RunUpBones =
        {
            new BoneBlend(ProductionReferenceMotionBone.Root, 3, 0.50f),
            new BoneBlend(ProductionReferenceMotionBone.SpineLower, 5, 0.75f),
            new BoneBlend(ProductionReferenceMotionBone.SpineUpper, 6, 0.65f),
            new BoneBlend(ProductionReferenceMotionBone.Chest, 7, 0.75f),
            new BoneBlend(ProductionReferenceMotionBone.NeckLower, 8, 0.45f),
            new BoneBlend(ProductionReferenceMotionBone.NeckUpper, 9, 0.35f),
            new BoneBlend(ProductionReferenceMotionBone.Head, 11, 0.30f),
            new BoneBlend(ProductionReferenceMotionBone.ClavicleLeft, 13, 0.70f),
            new BoneBlend(ProductionReferenceMotionBone.UpperArmLeft, 15),
            new BoneBlend(ProductionReferenceMotionBone.ForearmLeft, 17),
            new BoneBlend(ProductionReferenceMotionBone.WristLeft, 19, 0.55f),
            new BoneBlend(ProductionReferenceMotionBone.ClavicleRight, 20, 0.70f),
            new BoneBlend(ProductionReferenceMotionBone.UpperArmRight, 22),
            new BoneBlend(ProductionReferenceMotionBone.ForearmRight, 24),
            new BoneBlend(ProductionReferenceMotionBone.WristRight, 26, 0.55f),
            new BoneBlend(ProductionReferenceMotionBone.UpperLegLeft, 65),
            new BoneBlend(ProductionReferenceMotionBone.LowerLegLeft, 67),
            new BoneBlend(ProductionReferenceMotionBone.FootLeft, 69, 0.75f),
            new BoneBlend(ProductionReferenceMotionBone.UpperLegRight, 70),
            new BoneBlend(ProductionReferenceMotionBone.LowerLegRight, 72),
            new BoneBlend(ProductionReferenceMotionBone.FootRight, 74, 0.75f)
        };

        // Batting reference motion is intentionally excluded from the arms, wrists, hands and bat. Those remain
        // exactly on the authored cricket path and canonical host trace.
        private static readonly BoneBlend[] BattingWeightBones =
        {
            new BoneBlend(ProductionReferenceMotionBone.Root, 3, 0.45f),
            new BoneBlend(ProductionReferenceMotionBone.SpineLower, 5, 0.60f),
            new BoneBlend(ProductionReferenceMotionBone.SpineUpper, 6, 0.45f),
            new BoneBlend(ProductionReferenceMotionBone.Chest, 7, 0.35f),
            new BoneBlend(ProductionReferenceMotionBone.UpperLegLeft, 65, 0.80f),
            new BoneBlend(ProductionReferenceMotionBone.LowerLegLeft, 67, 0.65f),
            new BoneBlend(ProductionReferenceMotionBone.FootLeft, 69, 0.45f),
            new BoneBlend(ProductionReferenceMotionBone.UpperLegRight, 70, 0.80f),
            new BoneBlend(ProductionReferenceMotionBone.LowerLegRight, 72, 0.65f),
            new BoneBlend(ProductionReferenceMotionBone.FootRight, 74, 0.45f)
        };

        private static readonly int[] SecondaryBones =
        {
            6, 9, 13, 16, 18, 20, 23, 25,
            27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
            46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64
        };

        private static readonly float[] BatterChestCounterFactors =
            { -1f, -0.75f, -0.5f, -0.25f, 0f, 0.25f, 0.5f };

        private readonly ProductionCharacterRole role;
        private readonly ProductionCharacterHandedness handedness;
        private readonly ProductionReferenceMotionClip clip;
        private readonly Quaternion[] sample = new Quaternion[(int)ProductionReferenceMotionBone.Count];
        private readonly Quaternion[] reference = new Quaternion[(int)ProductionReferenceMotionBone.Count];
        private Quaternion[] secondaryRest;
        private Vector3 batterBatGrip;
        private Vector3 batterBatToe;
        private Vector3 batterLeftGripTarget;
        private Vector3 batterRightGripTarget;
        private Vector3 batterCameraPosition;
        private Quaternion batterCameraRotation;
        private bool hasBatterBatClearanceSegment;

        internal ProductionHeroReferenceMotionLayer(
            ProductionCharacterRole role,
            ProductionCharacterHandedness handedness,
            ProductionReferenceMotionClip clip)
        {
            this.role = role;
            this.handedness = handedness;
            this.clip = clip;
            clip.SampleAtCanonicalTime(0d, reference);
        }

        public string ResourceKey => role == ProductionCharacterRole.Batter
            ? BattingWeightResourceKey
            : RunUpResourceKey;
        public bool IsRootLocked => clip.RootLocked;
        internal bool BatterNeckClearanceEnabled { get; set; } = true;
        internal float BatterNeckClearanceWeight { get; set; } = 1f;

        internal void SetBatterBatClearanceSegment(
            Vector3 grip,
            Vector3 toe,
            Vector3 leftGripTarget,
            Vector3 rightGripTarget,
            Vector3 cameraPosition,
            Quaternion cameraRotation)
        {
            if (!Finite(grip) || !Finite(toe) || !Finite(cameraPosition) ||
                !Finite(leftGripTarget) || !Finite(rightGripTarget) ||
                !Finite(cameraRotation) || (toe - grip).sqrMagnitude <= 0.000001f)
            {
                hasBatterBatClearanceSegment = false;
                return;
            }
            batterBatGrip = grip;
            batterBatToe = toe;
            batterLeftGripTarget = leftGripTarget;
            batterRightGripTarget = rightGripTarget;
            batterCameraPosition = cameraPosition;
            batterCameraRotation = cameraRotation;
            hasBatterBatClearanceSegment = true;
        }

        public static ProductionHeroReferenceMotionLayer TryCreate(
            ProductionCharacterRole role,
            ProductionCharacterHandedness handedness,
            ProductionCharacterResourceLoader loader)
        {
            string resourceKey;
            if (role == ProductionCharacterRole.Batter)
                resourceKey = BattingWeightResourceKey;
            else if (role == ProductionCharacterRole.PaceBowler)
                resourceKey = RunUpResourceKey;
            else
                return null;
            if (loader == null) loader = key => Resources.Load<TextAsset>(key);

            try
            {
                var asset = loader(resourceKey);
                if (asset == null) return null;
                return new ProductionHeroReferenceMotionLayer(
                    role, handedness, ProductionReferenceMotionClip.Decode(asset.bytes));
            }
            catch (Exception error)
            {
                Debug.LogWarning("VANDE hero reference motion rejected; canonical pose retained. " + error.Message);
                return null;
            }
        }

        public void Apply(
            ProductionHeroSkeletonInstance skeleton,
            ProductionCharacterMotion motion,
            float normalizedTime)
        {
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));
            if (skeleton.BoneCount != ProductionHeroSkeletonDefinition.ExpectedBoneCount)
                throw new InvalidOperationException("Hero reference motion requires the complete VSK1 skeleton.");

            CaptureOrRestoreSecondaryRest(skeleton.Bones);
            var time = Mathf.Clamp01(normalizedTime);
            if (role == ProductionCharacterRole.PaceBowler &&
                motion == ProductionCharacterMotion.PaceBowling)
            {
                ApplyRunUp(skeleton.Bones, time);
                ApplySecondaryPose(skeleton.Bones, motion, time);
            }
            else if (role == ProductionCharacterRole.Batter &&
                     motion == ProductionCharacterMotion.BatterStroke)
            {
                ApplyBattingWeightTransfer(skeleton.Bones, time);
                ApplySecondaryPose(skeleton.Bones, motion, time);
                StabilizeBatterSupportBase(skeleton.Bones);
                StabilizeBatterTorso(skeleton.Bones);
                if (BatterNeckClearanceEnabled)
                {
                    StabilizeBatterNeckClearance(skeleton.Bones);
                    // Neck avoidance may choose a legal clearance pose near its wider transient roll envelope.
                    // Re-apply the production balance envelope last; the outer body-clearance reconciliation can
                    // translate the planted athlete on the ground if the exact bat still needs more separation.
                    StabilizeBatterTorso(skeleton.Bones);
                }
                StabilizeBatterSemanticBalance(skeleton.Bones, time);
                // Grip closure belongs to the bat, not to the weight-transfer envelope.  Fading it with the
                // reference clip reopened the fingers during the late follow-through and recovery even though both
                // ordered wrists remained on the handle. Keep a bounded deterministic wrap for the whole stroke.
                ApplyHandCurl(skeleton.Bones, 27, BatterStrokeGripCurl, 1f);
                ApplyHandCurl(skeleton.Bones, 46, BatterStrokeGripCurl, -1f);
            }
            else if (role == ProductionCharacterRole.Batter &&
                     motion == ProductionCharacterMotion.BatterStance)
            {
                // Address is a held cricket action, not the source skeleton's open-hand rest pose. Keep a bounded,
                // deterministic wrap on both gloves even though reference weight transfer starts only with a stroke.
                ApplyHandCurl(skeleton.Bones, 27, BatterStanceGripCurl, 1f);
                ApplyHandCurl(skeleton.Bones, 46, BatterStanceGripCurl, -1f);
            }
        }

        internal static float RunUpWeight(float normalizedTime)
        {
            var time = Mathf.Clamp01(normalizedTime);
            if (time >= ProductionCharacterMotionSampler.PaceGather) return 0f;
            if (time <= ProductionCharacterMotionSampler.PaceRunUpComplete) return MaximumRunUpBlend;
            var fade = 1f - Mathf.InverseLerp(
                ProductionCharacterMotionSampler.PaceRunUpComplete,
                ProductionCharacterMotionSampler.PaceGather,
                time);
            return MaximumRunUpBlend * Smooth01(fade);
        }

        internal static float BattingWeight(float normalizedTime)
        {
            var time = Mathf.Clamp01(normalizedTime);
            var enter = Smooth01(Mathf.InverseLerp(0.04f, ProductionCharacterMotionSampler.BatterFootPlant, time));
            var exit = 1f - Smooth01(Mathf.InverseLerp(
                ProductionCharacterMotionSampler.BatterFollowThrough, 0.96f, time));
            return MaximumBattingBlend * enter * exit;
        }

        private void ApplyRunUp(Transform[] bones, float normalizedTime)
        {
            var weight = RunUpWeight(normalizedTime);
            if (weight <= 0f) return;
            var clipPhase = Mathf.Clamp01(normalizedTime / ProductionCharacterMotionSampler.PaceGather);
            clip.SampleAtCanonicalTime(clipPhase * clip.DurationSeconds, sample);
            ApplyReferenceDeltas(bones, RunUpBones, weight);
        }

        private void ApplyBattingWeightTransfer(Transform[] bones, float normalizedTime)
        {
            var weight = BattingWeight(normalizedTime);
            if (weight <= 0f) return;
            clip.SampleAtCanonicalTime(normalizedTime * clip.DurationSeconds, sample);
            ApplyReferenceDeltas(bones, BattingWeightBones, weight);
        }

        private void ApplyReferenceDeltas(Transform[] bones, BoneBlend[] mapping, float weight)
        {
            for (var index = 0; index < mapping.Length; index++)
            {
                var value = mapping[index];
                var source = (int)value.Source;
                var delta = Quaternion.Inverse(reference[source]) * sample[source];
                var bounded = Mathf.Clamp01(weight * value.Scale);
                bones[value.HeroBone].localRotation *= Quaternion.SlerpUnclamped(
                    Quaternion.identity, delta, bounded);
            }
        }

        private void CaptureOrRestoreSecondaryRest(Transform[] bones)
        {
            if (secondaryRest == null)
            {
                secondaryRest = new Quaternion[SecondaryBones.Length];
                for (var index = 0; index < SecondaryBones.Length; index++)
                    secondaryRest[index] = bones[SecondaryBones[index]].localRotation;
                return;
            }

            for (var index = 0; index < SecondaryBones.Length; index++)
                bones[SecondaryBones[index]].localRotation = secondaryRest[index];
        }

        private void ApplySecondaryPose(Transform[] bones, ProductionCharacterMotion motion, float normalizedTime)
        {
            var handed = handedness == ProductionCharacterHandedness.Right ? 1f : -1f;
            var active = motion == ProductionCharacterMotion.PaceBowling
                ? RunUpWeight(normalizedTime) / MaximumRunUpBlend
                : BattingWeight(normalizedTime) / MaximumBattingBlend;
            if (active <= 0f) return;

            // Clavicle rise and deformation-bone twist are deliberately small. Their only purpose is to prevent a
            // rigid shoulder/forearm silhouette; they cannot move the canonical driver or gameplay bat.
            var cadence = Mathf.Sin(normalizedTime * Mathf.PI * 6f);
            bones[13].localRotation *= Quaternion.Euler(0f, 0f, (-2.2f + cadence) * active * handed);
            bones[20].localRotation *= Quaternion.Euler(0f, 0f, (2.2f - cadence) * active * handed);
            bones[16].localRotation *= Quaternion.Euler(0f, 3.5f * cadence * active, 0f);
            bones[18].localRotation *= Quaternion.Euler(0f, 5f * cadence * active, 0f);
            bones[23].localRotation *= Quaternion.Euler(0f, -3.5f * cadence * active, 0f);
            bones[25].localRotation *= Quaternion.Euler(0f, -5f * cadence * active, 0f);

            var grip = role == ProductionCharacterRole.Batter ? 0f : 0.22f;
            ApplyHandCurl(bones, 27, grip * active, 1f);
            ApplyHandCurl(bones, 46, grip * active, -1f);
        }

        private static void StabilizeBatterTorso(Transform[] bones)
        {
            // Correct the upper torso from the licensed pelvis/spine branch, above both planted leg branches. The
            // production Hips semantic is intentionally mapped to the skeleton root for canonical placement; using
            // that root as this local balance pivot couples the correction into both support legs and causes visible
            // foot-height drift. Bones 3/5 are the authored pelvis reference and first safe torso-only pivot.
            var hips = bones[3];
            var spine = bones[5];
            var head = bones[11];
            var horizontalRight = Vector3.ProjectOnPlane(bones[0].parent.right, Vector3.up);
            if (horizontalRight.sqrMagnitude <= 0.000001f) horizontalRight = Vector3.right;
            horizontalRight.Normalize();
            var horizontalForward = Vector3.Cross(horizontalRight, Vector3.up).normalized;

            // The licensed hierarchy has non-canonical torso axes. Applying the canonical guard yaw directly can
            // therefore turn ordinary batting pitch into a severe lateral collapse. Correct only the final visible
            // torso axis, after reference deltas, and leave the authored root, feet, bat and per-joint rotations as
            // the source of the action. Iteration is bounded and deterministic because the hip-to-spine segment is
            // above the correction pivot and cannot be solved exactly in one rotation.
            // Every pass re-measures the same explicit roll/lean envelope and cannot accumulate beyond it.
            for (var iteration = 0; iteration < 6; iteration++)
            {
                var torso = head.position - hips.position;
                if (torso.sqrMagnitude <= 0.000001f) return;
                var upright = Mathf.Max(0.0001f, Vector3.Dot(torso, Vector3.up));
                var right = Mathf.Clamp(
                    Vector3.Dot(torso, horizontalRight),
                    -upright * Mathf.Tan(MaximumBatterTorsoRollDegrees * Mathf.Deg2Rad),
                    upright * Mathf.Tan(MaximumBatterTorsoRollDegrees * Mathf.Deg2Rad));
                var forward = Vector3.Dot(torso, horizontalForward);
                var maximumHorizontal = upright *
                                        Mathf.Tan(MaximumBatterTorsoLeanDegrees * Mathf.Deg2Rad);
                var horizontal = new Vector2(right, forward);
                if (horizontal.magnitude > maximumHorizontal)
                    horizontal = horizontal.normalized * maximumHorizontal;
                var desired = Vector3.up * upright +
                              horizontalRight * horizontal.x +
                              horizontalForward * horizontal.y;
                if (desired.sqrMagnitude <= 0.000001f) return;
                var torsoDirection = torso.normalized;
                var desiredDirection = desired.normalized;
                // Measure the residual exactly. Quaternion.Angle reports zero below ~0.16 degrees (its 1e-6 dot
                // epsilon), which made this 0.001-degree stop a 0.16-degree dead zone: float noise from a 0.02 um
                // root translation could skip or apply the whole correction and move the aligned body by 0.5 mm.
                var correctionDegrees = Mathf.Atan2(
                    Vector3.Cross(torsoDirection, desiredDirection).magnitude,
                    Vector3.Dot(torsoDirection, desiredDirection)) * Mathf.Rad2Deg;
                if (correctionDegrees <= 0.001f) return;
                var correction = Quaternion.FromToRotation(torsoDirection, desiredDirection);
                spine.rotation = Quaternion.RotateTowards(
                                     Quaternion.identity, correction, 12f) * spine.rotation;
            }
        }

        /// <summary>
        /// Re-applies the production Hips-to-Head balance envelope after the rig's body-frame shoulder yaw, which
        /// turns spine04 about its own vertical axis and can otherwise swing a leaning head outside the support base.
        /// </summary>
        internal void ReapplyBatterBalanceEnvelope(ProductionHeroSkeletonInstance skeleton, float normalizedTime)
        {
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (role != ProductionCharacterRole.Batter) return;
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));
            StabilizeBatterSemanticBalance(skeleton.Bones, Mathf.Clamp01(normalizedTime));
        }

        private static void StabilizeBatterSemanticBalance(Transform[] bones, float normalizedTime)
        {
            // The licensed pelvis reference used by StabilizeBatterTorso is deliberately above the leg branches,
            // while the public production contract measures the complete semantic Hips-to-Head axis. Reconcile the
            // latter with a small torso-only projection after reference motion. The recovery envelope tightens only
            // after the trace-held follow-through, so live bat authority and both planted leg branches remain intact.
            var recovery = Mathf.InverseLerp(
                ProductionCharacterMotionSampler.BatterFollowThrough, 1f, normalizedTime);
            recovery = Smooth01(recovery);
            var maximumLean = Mathf.Lerp(23.8f, 17.7f, recovery);
            var maximumRoll = Mathf.Lerp(14.8f, 10.7f, recovery);
            var maximumHeadOverBase = Mathf.Lerp(0.278f, 0.218f, recovery);
            var hips = bones[0];
            var spine = bones[5];
            var head = bones[11];
            var leftFoot = bones[69];
            var rightFoot = bones[74];
            var horizontalRight = Vector3.ProjectOnPlane(bones[0].parent.right, Vector3.up);
            if (horizontalRight.sqrMagnitude <= 0.000001f) horizontalRight = Vector3.right;
            horizontalRight.Normalize();
            var horizontalForward = Vector3.Cross(horizontalRight, Vector3.up).normalized;

            // Alternating the axis and support-base projections converges without translating the root, feet or any
            // authored joint origin. Each correction is capped, deterministic and remeasured from the visible pose.
            for (var iteration = 0; iteration < 5; iteration++)
            {
                var torso = head.position - hips.position;
                if (torso.sqrMagnitude <= 0.000001f) return;
                var upright = Mathf.Max(0.0001f, Vector3.Dot(torso, Vector3.up));
                var right = Mathf.Clamp(
                    Vector3.Dot(torso, horizontalRight),
                    -upright * Mathf.Tan(maximumRoll * Mathf.Deg2Rad),
                    upright * Mathf.Tan(maximumRoll * Mathf.Deg2Rad));
                var forward = Vector3.Dot(torso, horizontalForward);
                var horizontal = new Vector2(right, forward);
                var maximumHorizontal = upright * Mathf.Tan(maximumLean * Mathf.Deg2Rad);
                if (horizontal.magnitude > maximumHorizontal)
                    horizontal = horizontal.normalized * maximumHorizontal;
                var desiredTorso = Vector3.up * upright +
                                   horizontalRight * horizontal.x +
                                   horizontalForward * horizontal.y;
                if (desiredTorso.sqrMagnitude > 0.000001f)
                {
                    var correction = Quaternion.FromToRotation(
                        torso.normalized, desiredTorso.normalized);
                    spine.rotation = Quaternion.RotateTowards(
                                         Quaternion.identity, correction, 4f) * spine.rotation;
                }

                var left = new Vector2(leftFoot.position.x, leftFoot.position.z);
                var rightFootGround = new Vector2(rightFoot.position.x, rightFoot.position.z);
                var headGround = new Vector2(head.position.x, head.position.z);
                var footSpan = rightFootGround - left;
                var along = footSpan.sqrMagnitude <= 0.000001f
                    ? 0f
                    : Mathf.Clamp01(Vector2.Dot(headGround - left, footSpan) / footSpan.sqrMagnitude);
                var closest = left + footSpan * along;
                var outside = headGround - closest;
                if (outside.magnitude <= maximumHeadOverBase || outside.sqrMagnitude <= 0.000001f)
                    continue;
                var desiredGround = closest + outside.normalized * maximumHeadOverBase;
                var desiredHead = new Vector3(desiredGround.x, head.position.y, desiredGround.y);
                var currentFromPivot = head.position - spine.position;
                var desiredFromPivot = desiredHead - spine.position;
                if (currentFromPivot.sqrMagnitude <= 0.000001f ||
                    desiredFromPivot.sqrMagnitude <= 0.000001f)
                    continue;
                var supportCorrection = Quaternion.FromToRotation(
                    currentFromPivot.normalized, desiredFromPivot.normalized);
                spine.rotation = Quaternion.RotateTowards(
                                     Quaternion.identity, supportCorrection, 4f) * spine.rotation;
            }
        }

        private static void StabilizeBatterSupportBase(Transform[] bones)
        {
            var leftFoot = bones[69];
            var rightFoot = bones[74];
            var groundSpan = new Vector2(
                leftFoot.position.x - rightFoot.position.x,
                leftFoot.position.z - rightFoot.position.z);
            if (groundSpan.magnitude <= 0.70f) return;
            const float targetWidth = 0.68f;
            var direction = groundSpan.normalized;
            var midpoint = (leftFoot.position + rightFoot.position) * 0.5f;
            var half = new Vector3(direction.x, 0f, direction.y) * (targetWidth * 0.5f);
            var leftTarget = midpoint + half;
            var rightTarget = midpoint - half;
            leftTarget.y = leftFoot.position.y;
            rightTarget.y = rightFoot.position.y;
            SolveLegToTarget(bones[65], bones[67], leftFoot, leftTarget);
            SolveLegToTarget(bones[70], bones[72], rightFoot, rightTarget);
        }

        private static void SolveLegToTarget(
            Transform upper,
            Transform lower,
            Transform foot,
            Vector3 target)
        {
            var hip = upper.position;
            var upperLength = Vector3.Distance(hip, lower.position);
            var lowerLength = Vector3.Distance(lower.position, foot.position);
            var reach = target - hip;
            if (upperLength <= 0.001f || lowerLength <= 0.001f ||
                reach.sqrMagnitude <= 0.000001f) return;
            var direction = reach.normalized;
            var distance = Mathf.Clamp(
                reach.magnitude,
                Mathf.Abs(upperLength - lowerLength) + 0.001f,
                upperLength + lowerLength - 0.001f);
            var cosine = Mathf.Clamp(
                (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
                (2f * upperLength * distance),
                -1f,
                1f);
            var along = upperLength * cosine;
            var across = upperLength * Mathf.Sqrt(Mathf.Max(0f, 1f - cosine * cosine));
            var authoredKnee = lower.position - hip;
            var pole = authoredKnee - direction * Vector3.Dot(authoredKnee, direction);
            if (pole.sqrMagnitude <= 0.000001f)
            {
                pole = Vector3.ProjectOnPlane(upper.forward, direction);
                if (pole.sqrMagnitude <= 0.000001f)
                    pole = Vector3.Cross(direction, Vector3.right);
            }
            pole.Normalize();
            var desiredKnee = hip + direction * along + pole * across;
            RotateBoneTowards(upper, lower.position - hip, desiredKnee - hip);
            RotateBoneTowards(lower, foot.position - lower.position, target - lower.position);
        }

        private static void RotateBoneTowards(Transform bone, Vector3 current, Vector3 desired)
        {
            if (current.sqrMagnitude <= 0.000001f || desired.sqrMagnitude <= 0.000001f) return;
            bone.rotation = Quaternion.FromToRotation(current.normalized, desired.normalized) * bone.rotation;
        }

        private void StabilizeBatterNeckClearance(Transform[] bones)
        {
            if (!hasBatterBatClearanceSegment) return;
            if ((batterBatToe - batterBatGrip).sqrMagnitude <= 0.000001f) return;
            var baselineScore = BatterHeadAndNeckClearanceScore(bones);
            if (baselineScore >= 0f) return;

            var spine = bones[5];
            var chest = bones[7];
            var hips = bones[3];
            var head = bones[11];
            var rootRight = Vector3.ProjectOnPlane(bones[0].parent.right, Vector3.up);
            if (rootRight.sqrMagnitude <= 0.000001f) rootRight = Vector3.right;
            rootRight.Normalize();
            var spineLocal = spine.localRotation;
            var chestLocal = chest.localRotation;
            var baselineLeftShoulderDistance = Vector3.Distance(
                bones[15].position, batterLeftGripTarget);
            var baselineRightShoulderDistance = Vector3.Distance(
                bones[22].position, batterRightGripTarget);
            const float maximumSharedCorrectionDegrees = 24f;
            const int directionCount = 24;
            Quaternion bestSpineLocal = spineLocal;
            Quaternion bestChestLocal = chestLocal;
            var bestScore = baselineScore;
            for (var correctionDegrees = 1f;
                 correctionDegrees <= maximumSharedCorrectionDegrees;
                 correctionDegrees += 1f)
            {
                for (var directionIndex = 0; directionIndex < directionCount; directionIndex++)
                {
                    var angle = directionIndex * (Mathf.PI * 2f / directionCount);
                    var axis = batterCameraRotation * new Vector3(
                        Mathf.Cos(angle), Mathf.Sin(angle), 0f);
                    for (var factorIndex = 0;
                         factorIndex < BatterChestCounterFactors.Length;
                         factorIndex++)
                    {
                        spine.localRotation = spineLocal;
                        chest.localRotation = chestLocal;
                        spine.rotation = Quaternion.AngleAxis(
                                             correctionDegrees, axis) * spine.rotation;
                        chest.rotation = Quaternion.AngleAxis(
                                             correctionDegrees * BatterChestCounterFactors[factorIndex],
                                             axis) * chest.rotation;
                        var torso = head.position - hips.position;
                        var upright = Mathf.Max(0.0001f, Vector3.Dot(torso, Vector3.up));
                        var torsoLean = Vector3.Angle(Vector3.up, torso);
                        var torsoRoll = Mathf.Atan2(
                            Mathf.Abs(Vector3.Dot(torso, rootRight)), upright) * Mathf.Rad2Deg;
                        if (torsoLean > 23.5f || torsoRoll > 14.5f ||
                            Vector3.Distance(bones[15].position, batterLeftGripTarget) >
                            baselineLeftShoulderDistance + 0.012f ||
                            Vector3.Distance(bones[22].position, batterRightGripTarget) >
                            baselineRightShoulderDistance + 0.012f)
                            continue;
                        var score = BatterHeadAndNeckClearanceScore(bones);
                        if (score > bestScore)
                        {
                            bestScore = score;
                            bestSpineLocal = spine.localRotation;
                            bestChestLocal = chest.localRotation;
                        }
                    }
                }
            }
            var clearanceWeight = Mathf.Clamp01(BatterNeckClearanceWeight);
            spine.localRotation = Quaternion.Slerp(spineLocal, bestSpineLocal, clearanceWeight);
            chest.localRotation = Quaternion.Slerp(chestLocal, bestChestLocal, clearanceWeight);
        }

        private float BatterHeadAndNeckClearanceScore(Transform[] bones)
        {
            var neck = bones[8];
            var head = bones[11];
            var helmetCentre = head.TransformPoint(new Vector3(0f, 0.088756f, 0.025890f));
            var headCentre = head.TransformPoint(new Vector3(0.00063f, 0.046923f, 0.047528f));
            const float requiredPhysicalClearance = 0.012f;
            const float requiredProjectedClearance = 0.005f;
            var score = float.PositiveInfinity;
            score = Mathf.Min(score, SurfaceClearance(
                                  helmetCentre, 0.11f, batterBatGrip, batterBatToe) -
                              requiredPhysicalClearance);
            score = Mathf.Min(score, ProjectedClearance(
                                  helmetCentre, 0.11f, batterBatGrip, batterBatToe,
                                  batterCameraPosition, batterCameraRotation) -
                              requiredProjectedClearance);
            score = Mathf.Min(score, SurfaceClearance(
                                  headCentre, 0.11f, batterBatGrip, batterBatToe) -
                              requiredPhysicalClearance);
            score = Mathf.Min(score, ProjectedClearance(
                                  headCentre, 0.11f, batterBatGrip, batterBatToe,
                                  batterCameraPosition, batterCameraRotation) -
                              requiredProjectedClearance);
            score = Mathf.Min(score, SurfaceClearance(
                                  neck.position, 0.075f, batterBatGrip, batterBatToe) -
                              requiredPhysicalClearance);
            score = Mathf.Min(score, ProjectedClearance(
                                  neck.position, 0.075f, batterBatGrip, batterBatToe,
                                  batterCameraPosition, batterCameraRotation) -
                              requiredProjectedClearance);
            return score;
        }

        private static float SurfaceClearance(
            Vector3 point,
            float pointRadius,
            Vector3 segmentStart,
            Vector3 segmentEnd)
        {
            var segment = segmentEnd - segmentStart;
            var lengthSquared = segment.sqrMagnitude;
            var along = lengthSquared <= 0.000001f
                ? 0f
                : Mathf.Clamp01(Vector3.Dot(point - segmentStart, segment) / lengthSquared);
            return Vector3.Distance(point, segmentStart + segment * along) -
                   pointRadius - CricketPropDimensions.BladeWidth * 0.5f;
        }

        private static float ProjectedClearance(
            Vector3 point,
            float pointRadius,
            Vector3 segmentStart,
            Vector3 segmentEnd,
            Vector3 cameraPosition,
            Quaternion cameraRotation)
        {
            var worldToView = Quaternion.Inverse(cameraRotation);
            var pointView = worldToView * (point - cameraPosition);
            var startView = worldToView * (segmentStart - cameraPosition);
            var endView = worldToView * (segmentEnd - cameraPosition);
            if (pointView.z <= 0.0001f || startView.z <= 0.0001f || endView.z <= 0.0001f)
                return float.PositiveInfinity;
            var projectedPoint = new Vector2(pointView.x / pointView.z, pointView.y / pointView.z);
            var projectedStart = new Vector2(startView.x / startView.z, startView.y / startView.z);
            var projectedEnd = new Vector2(endView.x / endView.z, endView.y / endView.z);
            var segment = projectedEnd - projectedStart;
            var along = segment.sqrMagnitude <= 0.000001f
                ? 0f
                : Mathf.Clamp01(Vector2.Dot(projectedPoint - projectedStart, segment) /
                                segment.sqrMagnitude);
            return Vector2.Distance(projectedPoint, projectedStart + segment * along) -
                   pointRadius / pointView.z -
                   CricketPropDimensions.BladeWidth * 0.5f /
                   Mathf.Min(startView.z, endView.z);
        }

        private static bool Finite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }

        private static bool Finite(Quaternion value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z) &&
                   !float.IsNaN(value.w) && !float.IsInfinity(value.w);
        }

        private static void ApplyHandCurl(Transform[] bones, int start, float amount, float side)
        {
            // Four metacarpals, then five fingers with three segments each. The thumb stays shallower while the
            // other digits wrap the handle; this is an original presentation pose, not captured CMU finger data.
            var bounded = Mathf.Clamp01(amount);
            for (var index = 0; index < 4; index++)
                bones[start + index].localRotation *= Quaternion.Euler(0f, 0f, side * (index - 1.5f) * bounded);
            for (var finger = 0; finger < 5; finger++)
            {
                var baseIndex = start + 4 + finger * 3;
                var thumbScale = finger == 0 ? 0.55f : 1f;
                bones[baseIndex].localRotation *= Quaternion.Euler(24f * bounded * thumbScale, 0f, 0f);
                bones[baseIndex + 1].localRotation *= Quaternion.Euler(38f * bounded * thumbScale, 0f, 0f);
                bones[baseIndex + 2].localRotation *= Quaternion.Euler(30f * bounded * thumbScale, 0f, 0f);
            }
        }

        private static float Smooth01(float value)
        {
            var bounded = Mathf.Clamp01(value);
            return bounded * bounded * (3f - 2f * bounded);
        }
    }
}
