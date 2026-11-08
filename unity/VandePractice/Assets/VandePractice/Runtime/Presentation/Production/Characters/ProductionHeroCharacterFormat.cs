using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.Presentation.Production.Characters
{
    internal enum ProductionHeroLodSelection
    {
        CloseUp,
        LiveBatter,
        LiveBowler,
        LiveLow,
        DistantFielderPremium,
        DistantFielderBalancedLite
    }

    internal static class ProductionHeroPresentationPolicy
    {
        public static SkinQuality SelectSkinQuality(
            ProductionCharacterRole role,
            ProductionCharacterDetail detail)
        {
            // VPM3 always carries four fixed influence slots.  The foreground batter is the only live role close
            // enough for shoulder, wrist and neck deformation to dominate the player silhouette, so Standard and
            // High explicitly retain those four influences even when an Android quality tier defaults to two.
            // Lite and every distant role continue to inherit the platform's bounded quality policy.
            return role == ProductionCharacterRole.Batter &&
                   detail != ProductionCharacterDetail.Low
                ? SkinQuality.Bone4
                : SkinQuality.Auto;
        }

        public static ProductionHeroLodSelection SelectLod(
            ProductionCharacterRole role,
            ProductionCharacterDetail detail,
            bool closeUp,
            float distanceFromStrikerMetres = 0f)
        {
            if (closeUp && detail == ProductionCharacterDetail.High &&
                (role == ProductionCharacterRole.Batter ||
                 role == ProductionCharacterRole.PaceBowler ||
                 role == ProductionCharacterRole.SpinBowler))
                return ProductionHeroLodSelection.CloseUp;
            if (role == ProductionCharacterRole.Fielder)
            {
                if (distanceFromStrikerMetres >=
                    ProductionBakedCharacterMesh.DistantLodMinimumDistanceMetres)
                    return detail == ProductionCharacterDetail.High
                        ? ProductionHeroLodSelection.DistantFielderPremium
                        : ProductionHeroLodSelection.DistantFielderBalancedLite;
                return ProductionHeroLodSelection.LiveBowler;
            }
            if (role == ProductionCharacterRole.Wicketkeeper)
                return detail == ProductionCharacterDetail.High
                    ? ProductionHeroLodSelection.DistantFielderPremium
                    : ProductionHeroLodSelection.DistantFielderBalancedLite;
            if (detail == ProductionCharacterDetail.Low)
                return ProductionHeroLodSelection.LiveLow;
            if (role == ProductionCharacterRole.Batter)
                return ProductionHeroLodSelection.LiveBatter;
            if (role == ProductionCharacterRole.PaceBowler || role == ProductionCharacterRole.SpinBowler)
                return ProductionHeroLodSelection.LiveBowler;
            throw new ArgumentOutOfRangeException(nameof(role), "This role has no hero LOD.");
        }

        public static bool KeepProceduralCricketEquipment(ProductionCharacterRole role, string name)
        {
            if (string.IsNullOrEmpty(name)) return false;

            // The common hero bundle intentionally contains only body, uniform, hair and shoes. Keep the bounded
            // original role equipment that has no VPM3 equivalent, while every old anatomy/body primitive stays
            // disabled after complete admission.
            if (role == ProductionCharacterRole.SpinBowler)
                return name.StartsWith("SpinBowlerCap", StringComparison.Ordinal);
            if (role == ProductionCharacterRole.Fielder)
                return name.StartsWith("FielderCap", StringComparison.Ordinal);
            if (role != ProductionCharacterRole.Wicketkeeper) return false;

            return name.StartsWith("KeeperCap", StringComparison.Ordinal) ||
                   name.StartsWith("KeeperPad", StringComparison.Ordinal) ||
                   name.StartsWith("KeeperGlove", StringComparison.Ordinal) ||
                   name.StartsWith("KeeperWeb", StringComparison.Ordinal) ||
                   name.StartsWith("PadRoll", StringComparison.Ordinal) ||
                   name.StartsWith("PadStrap", StringComparison.Ordinal) ||
                   name.StartsWith("Helmet", StringComparison.Ordinal);
        }
    }

    /// <summary>
    /// A bounded, versioned skeleton used by every complete Stage-1 player-role hero candidate. The semantic
    /// identifiers deliberately mirror <see cref="ProductionCharacterJoint"/> for the seventeen canonical driver
    /// joints. All other deformation/finger/twist bones use <see cref="NoDriverSemantic"/> and retain their authored
    /// rest transform until a richer, manually-seekable clip supplies them.
    /// </summary>
    internal sealed class ProductionHeroSkeletonDefinition
    {
        internal const string ResourceKey = "ProductionCharacters/hero-skeleton";
        internal const ushort FormatVersion = 1;
        internal const ushort ExpectedBoneCount = 75;
        internal const ushort RecordStride = 32;
        internal const ushort NoDriverSemantic = ushort.MaxValue;
        private const int HeaderBytes = 32;
        private const int MaximumBoneCount = 96;

        internal readonly struct Bone
        {
            public Bone(short parentIndex, ushort semanticId, Vector3 localPosition,
                Quaternion localRotation)
            {
                ParentIndex = parentIndex;
                SemanticId = semanticId;
                LocalPosition = localPosition;
                LocalRotation = localRotation;
            }

            public short ParentIndex { get; }
            public ushort SemanticId { get; }
            public Vector3 LocalPosition { get; }
            public Quaternion LocalRotation { get; }
        }

        private ProductionHeroSkeletonDefinition(ulong skeletonId, Bone[] bones)
        {
            SkeletonId = skeletonId;
            Bones = bones;
        }

        public ulong SkeletonId { get; }
        public Bone[] Bones { get; }
        public int BoneCount => Bones.Length;

        public static ProductionHeroSkeletonDefinition Decode(byte[] bytes)
        {
            if (bytes == null || bytes.Length < HeaderBytes)
                throw new InvalidOperationException("Hero skeleton data is missing or truncated.");

            var reader = new HeroLittleEndianReader(bytes);
            if (reader.Byte() != (byte)'V' || reader.Byte() != (byte)'S' ||
                reader.Byte() != (byte)'K' || reader.Byte() != (byte)'1')
                throw new InvalidOperationException("Hero skeleton magic is invalid.");
            if (reader.UInt16() != FormatVersion)
                throw new InvalidOperationException("Hero skeleton version is unsupported.");
            var boneCount = reader.UInt16();
            if (boneCount != ExpectedBoneCount || boneCount > MaximumBoneCount)
                throw new InvalidOperationException("Hero skeleton bone count is outside the production contract.");
            if (reader.UInt16() != RecordStride)
                throw new InvalidOperationException("Hero skeleton record stride is unsupported.");
            if (reader.UInt16() != 0)
                throw new InvalidOperationException("Hero skeleton reserved layout field must be zero.");
            if (reader.UInt32() != 0)
                throw new InvalidOperationException("Hero skeleton flags are unsupported.");
            var skeletonId = reader.UInt64();
            if (skeletonId == 0)
                throw new InvalidOperationException("Hero skeleton identity is missing.");
            if (reader.UInt64() != 0)
                throw new InvalidOperationException("Hero skeleton reserved header bytes must be zero.");

            var expectedLength = checked(HeaderBytes + boneCount * RecordStride);
            if (bytes.Length != expectedLength)
                throw new InvalidOperationException("Hero skeleton byte length does not match its header.");

            var bones = new Bone[boneCount];
            var semanticSeen = new bool[(int)ProductionCharacterJoint.Count];
            var rootCount = 0;
            for (var index = 0; index < boneCount; index++)
            {
                var parent = reader.Int16();
                var semantic = reader.UInt16();
                var position = reader.Vector3();
                var rotation = reader.Quaternion();
                if (parent == -1)
                {
                    rootCount++;
                }
                else if (parent < 0 || parent >= index)
                {
                    // Requiring topological order both proves acyclicity and avoids a second runtime graph pass.
                    throw new InvalidOperationException("Hero skeleton parent order is invalid.");
                }

                if (!Finite(position) || position.sqrMagnitude > 100f || !Finite(rotation))
                    throw new InvalidOperationException("Hero skeleton contains a non-finite transform.");
                var magnitude = rotation.x * rotation.x + rotation.y * rotation.y +
                                rotation.z * rotation.z + rotation.w * rotation.w;
                if (magnitude < 0.98f || magnitude > 1.02f)
                    throw new InvalidOperationException("Hero skeleton contains a non-unit rotation.");

                if (semantic != NoDriverSemantic)
                {
                    if (semantic >= semanticSeen.Length || semanticSeen[semantic])
                        throw new InvalidOperationException("Hero skeleton contains an invalid driver semantic.");
                    semanticSeen[semantic] = true;
                }

                bones[index] = new Bone(parent, semantic, position, Normalize(rotation));
            }

            if (rootCount != 1)
                throw new InvalidOperationException("Hero skeleton must contain exactly one root.");
            for (var index = 0; index < semanticSeen.Length; index++)
            {
                if (!semanticSeen[index])
                    throw new InvalidOperationException("Hero skeleton is missing a canonical driver semantic.");
            }
            if (!reader.AtEnd)
                throw new InvalidOperationException("Hero skeleton contains undeclared trailing bytes.");

            return new ProductionHeroSkeletonDefinition(skeletonId, bones);
        }

        private static Quaternion Normalize(Quaternion value)
        {
            var scale = 1f / Mathf.Sqrt(value.x * value.x + value.y * value.y +
                                       value.z * value.z + value.w * value.w);
            return new Quaternion(value.x * scale, value.y * scale, value.z * scale, value.w * scale);
        }

        private static bool Finite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool Finite(Quaternion value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }

    /// <summary>
    /// One per visible hero. It maps the existing deterministic seventeen-joint presentation pose onto a richer
    /// skinning hierarchy. It never produces release, contact, ball or scoring data.
    /// </summary>
    internal sealed class ProductionHeroSkeletonInstance : IDisposable
    {
        // Stable VSK1 indices from V3_BONE_NAMES.  These are deformation helpers rather than canonical gameplay
        // drivers; a bounded rotation provides the scapular reach that a real low batting grip needs.
        private const int LeftClavicleBone = 13;
        private const int LeftShoulderHelperBone = 14;
        private const int RightClavicleBone = 20;
        private const int RightShoulderHelperBone = 21;
        private const float MaximumClavicleReachDegrees = 42f;
        private const float MaximumShoulderHelperReachDegrees = 24f;
        private const float MaximumBatterClavicleTranslationMetres = 0.035f;
        // Preserve a measured 20 mm reach reserve for visible elbow articulation. The earlier 55 mm address reserve
        // was sound for a static low grip but rejected valid spatially retargeted trace poses and left the gloves as
        // much as 0.62 m behind the exact bat. Twenty millimetres remains far above the former 3 mm numerical margin,
        // while the ordered pole and bounded torso/step solve keep the elbow from locking across the throat.
        private const float BatterArmReachReserveMetres = 0.0201f;

        private readonly GameObject rootObject;
        private readonly Transform[] bones;
        private readonly Vector3[] restPositions;
        private readonly Quaternion[] restRotations;
        private readonly short[] parentIndices;
        private readonly Quaternion[] canonicalRestCorrections;
        // What a driver bone undoes of the correction its nearest driver ancestor carries (identity unless that ancestor has one),
        // so that a child's world frame is its canonical frame times its own correction alone: see Synchronize.
        private readonly Quaternion[] parentCorrectionUndo;
        private readonly int[] driverToBone;
        // Each hand's long axis at rest (wrist to the middle fingertip), in the wrist bone's frame: [0] left, [1] right.
        private readonly Vector3[] handRestDirections = new Vector3[2];
        private bool disposed;

        public ProductionHeroSkeletonInstance(Transform parent, ProductionHeroSkeletonDefinition definition)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (definition == null) throw new ArgumentNullException(nameof(definition));

            rootObject = new GameObject("HeroSkeleton");
            rootObject.hideFlags = HideFlags.DontSave;
            rootObject.transform.SetParent(parent, false);
            bones = new Transform[definition.BoneCount];
            restPositions = new Vector3[definition.BoneCount];
            restRotations = new Quaternion[definition.BoneCount];
            parentIndices = new short[definition.BoneCount];
            canonicalRestCorrections = new Quaternion[definition.BoneCount];
            parentCorrectionUndo = new Quaternion[definition.BoneCount];
            driverToBone = new int[(int)ProductionCharacterJoint.Count];
            for (var index = 0; index < driverToBone.Length; index++) driverToBone[index] = -1;
            for (var index = 0; index < canonicalRestCorrections.Length; index++)
            {
                canonicalRestCorrections[index] = Quaternion.identity;
                parentCorrectionUndo[index] = Quaternion.identity;
            }

            try
            {
                for (var index = 0; index < definition.BoneCount; index++)
                {
                    var record = definition.Bones[index];
                    var value = new GameObject("HeroBone-" + index);
                    value.hideFlags = HideFlags.DontSave;
                    var parentTransform = record.ParentIndex < 0
                        ? rootObject.transform
                        : bones[record.ParentIndex];
                    value.transform.SetParent(parentTransform, false);
                    value.transform.localPosition = record.LocalPosition;
                    value.transform.localRotation = record.LocalRotation;
                    bones[index] = value.transform;
                    restPositions[index] = record.LocalPosition;
                    restRotations[index] = record.LocalRotation;
                    parentIndices[index] = record.ParentIndex;
                    if (record.SemanticId != ProductionHeroSkeletonDefinition.NoDriverSemantic)
                        driverToBone[record.SemanticId] = index;
                }
                BuildCanonicalArmRestCorrections();
                BuildHandRestDirections();
                BuildHandRestCorrections();
                BuildParentCorrectionUndo();
            }
            catch
            {
                ProductionCharacterResources.DestroyOwned(rootObject);
                throw;
            }
        }

        public Transform[] Bones => bones;
        public int BoneCount => disposed ? 0 : bones.Length;
        public Transform RootBone
        {
            get
            {
                if (disposed) return null;
                var hipsIndex = driverToBone[(int)ProductionCharacterJoint.Hips];
                return hipsIndex >= 0 ? bones[hipsIndex] : bones[0];
            }
        }

        public void Synchronize(Transform[] canonicalDrivers)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (canonicalDrivers == null || canonicalDrivers.Length != driverToBone.Length)
                throw new ArgumentException("The canonical driver hierarchy is incomplete.", nameof(canonicalDrivers));
            // Canonical-time seeking must not accumulate static body-frame placement or secondary
            // twist/finger/reference deltas from the previous rendered frame. Restore the complete authored
            // hierarchy, then map the seventeen cricket drivers.
            for (var boneIndex = 0; boneIndex < bones.Length; boneIndex++)
            {
                bones[boneIndex].localPosition = restPositions[boneIndex];
                bones[boneIndex].localRotation = restRotations[boneIndex];
            }
            for (var driverIndex = 0; driverIndex < driverToBone.Length; driverIndex++)
            {
                var boneIndex = driverToBone[driverIndex];
                if (boneIndex < 0 || canonicalDrivers[driverIndex] == null)
                    throw new InvalidOperationException("The hero driver mapping is incomplete.");
                // VSK1 retains the licensed source's outward A-pose while the canonical cricket sampler is
                // authored from relaxed, downward arms. Apply the bounded rest-pose retarget after the canonical
                // delta so the sampler still owns every rotation and the source A-pose does not widen or stiffen
                // the visible cricketer. This transform is presentation-only and never mutates the drivers.
                //
                // A limb bone's canonical frame is its world frame less its own correction (Q = W * inverse(C)), so the
                // child's local rotation is inverse(parent C) * canonical * C, not canonical * C alone: with the parent's
                // correction left in, a canonical-zero forearm stood 39.4 degrees off the upper arm and the hand 61.4
                // (UNITY-4's measure; the arms bent sideways at the elbow). parentCorrectionUndo is that inverse
                // (the identity for every bone whose driver ancestor has no correction, so no other bone changes).
#if UNITY_EDITOR
                if (LegacyArmRetarget)
                {
                    // The retarget as it was before UNITY-5 (builder A/B only): rest * canonical * correction, the parent's
                    // correction left in and no correction of the hand's own.
                    bones[boneIndex].localRotation = restRotations[boneIndex] *
                                                     canonicalDrivers[driverIndex].localRotation *
                                                     (IsHandBone(boneIndex) ? Quaternion.identity : canonicalRestCorrections[boneIndex]);
                    continue;
                }
#endif
                bones[boneIndex].localRotation = restRotations[boneIndex] *
                                                 parentCorrectionUndo[boneIndex] *
                                                 canonicalDrivers[driverIndex].localRotation *
                                                 canonicalRestCorrections[boneIndex];
            }
        }

#if UNITY_EDITOR
        /// <summary>Builder A/B seam (the Editor only: it is not compiled into a player): true writes the retarget as it was before UNITY-5.</summary>
        internal bool LegacyArmRetarget { get; set; }

        private bool IsHandBone(int boneIndex) =>
            boneIndex == driverToBone[(int)ProductionCharacterJoint.HandLeft] ||
            boneIndex == driverToBone[(int)ProductionCharacterJoint.HandRight];
#endif

        private void BuildCanonicalArmRestCorrections()
        {
            // The canonical upper-arm and forearm children both lie on local -Y. Deriving the source correction
            // from VSK1 joint positions avoids asset-specific angle constants while preserving authored lengths,
            // bindposes, twist/finger bones and the final presentation-only grip/release IK.
            SetCanonicalLimbRestCorrection(
                ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft);
            SetCanonicalLimbRestCorrection(
                ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.HandLeft);
            SetCanonicalLimbRestCorrection(
                ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight);
            SetCanonicalLimbRestCorrection(
                ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.HandRight);
        }

        private void SetCanonicalLimbRestCorrection(
            ProductionCharacterJoint limb,
            ProductionCharacterJoint child)
        {
            var limbIndex = driverToBone[(int)limb];
            var childIndex = driverToBone[(int)child];
            if (limbIndex < 0 || childIndex < 0) return;

            var sourceDirection = bones[limbIndex].InverseTransformPoint(bones[childIndex].position);
            if (!Finite(sourceDirection) || sourceDirection.sqrMagnitude <= 0.000001f) return;
            canonicalRestCorrections[limbIndex] =
                Quaternion.FromToRotation(sourceDirection.normalized, Vector3.down);
        }

        // VSK1 indices of the middle fingertip (finger3-3) of each hand: the stable V3_BONE_NAMES order in
        // export-unity-production-character-v3.mjs (4 metacarpals and 5 fingers of 3 bones a side after the arms).
        private const int LeftMiddleFingertipBone = 39;
        private const int RightMiddleFingertipBone = 58;

        private void BuildHandRestDirections()
        {
            for (var side = 0; side < 2; side++)
            {
                var hand = bones[driverToBone[(int)(side == 0 ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)]];
                var tipIndex = side == 0 ? LeftMiddleFingertipBone : RightMiddleFingertipBone;
                var direction = tipIndex < bones.Length
                    ? hand.InverseTransformPoint(bones[tipIndex].position)
                    : Vector3.zero;
                if (!Finite(direction) || direction.sqrMagnitude <= 0.000001f)
                {
                    // Without the finger bones the hand continues the forearm.
                    var forearm = bones[driverToBone[(int)(side == 0 ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)]];
                    direction = forearm.InverseTransformPoint(hand.position);
                }
                handRestDirections[side] = direction.normalized;
            }
        }

        /// <summary>A hand's long axis (wrist to the middle fingertip) at rest, as a unit vector in the wrist bone's frame.</summary>
        internal Vector3 HandRestDirection(bool left) => handRestDirections[left ? 0 : 1];

        /// <summary>
        /// The hand's own rest correction: it turns the hand's long axis (HandRestDirection, the axis the wrist's bend is measured
        /// against) to local down, as the upper arm's and the forearm's turn their child's direction. Without it a canonical-zero
        /// hand hung with its bone frame, not its fingers, along the forearm (61.4 degrees off it in the hero's A-pose).
        /// </summary>
        private void BuildHandRestCorrections()
        {
            for (var side = 0; side < 2; side++)
            {
                var hand = driverToBone[(int)(side == 0 ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
                if (hand < 0) continue;
                var direction = handRestDirections[side];
                if (!Finite(direction) || direction.sqrMagnitude <= 0.000001f) continue;
                canonicalRestCorrections[hand] = Quaternion.FromToRotation(direction, Vector3.down);
            }
        }

        /// <summary>
        /// For every driver bone whose nearest driver ancestor carries a rest correction (the forearm under the upper arm, the hand
        /// under the forearm): the inverse of that correction, after the rest rotations of the non-driver bones between them
        /// (the twist bones; identity in VSK1, which the arm tests assert), so Synchronize can write
        /// rest * undo * canonical * correction. Every other bone keeps the identity: its pose is unchanged.
        /// </summary>
        private void BuildParentCorrectionUndo()
        {
            var isDriver = new bool[bones.Length];
            for (var driver = 0; driver < driverToBone.Length; driver++)
                if (driverToBone[driver] >= 0) isDriver[driverToBone[driver]] = true;
            var chain = new int[bones.Length];
            for (var index = 0; index < bones.Length; index++)
            {
                parentCorrectionUndo[index] = Quaternion.identity;
                if (!isDriver[index]) continue;
                var between = Quaternion.identity;
                var ancestor = parentIndices[index];
                var depth = 0;
                // The twist bones between a driver and its driver ancestor, nearest the driver first.
                while (ancestor >= 0 && !isDriver[ancestor])
                {
                    chain[depth++] = ancestor;
                    ancestor = parentIndices[ancestor];
                }
                if (ancestor < 0) continue;
                var correction = canonicalRestCorrections[ancestor];
                if (Quaternion.Angle(Quaternion.identity, correction) <= 0.001f) continue;
                // The product of their rest rotations, from the one nearest the ancestor down.
                for (var step = depth - 1; step >= 0; step--) between = between * restRotations[chain[step]];
                parentCorrectionUndo[index] = Quaternion.Inverse(between) * Quaternion.Inverse(correction);
            }
        }

        public Vector3 JointWorldPosition(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            return Driver(joint).position;
        }

        public Quaternion JointWorldRotation(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            return Driver(joint).rotation;
        }

        public Vector3 JointLocalPosition(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            return Driver(joint).localPosition;
        }

        public Vector3 JointAuthoredLocalPosition(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            var index = driverToBone[(int)joint];
            if (index < 0 || index >= restPositions.Length)
                throw new InvalidOperationException("The hero driver mapping is incomplete.");
            return restPositions[index];
        }

        public Vector3 JointAuthoredWorldPosition(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            var index = driverToBone[(int)joint];
            if (index < 0 || index >= restPositions.Length)
                throw new InvalidOperationException("The hero driver mapping is incomplete.");

            // Reconstruct the VSK1 authored-rest origin without mutating the currently sampled pose. A joint's own
            // rotation cannot move its origin; every parent rest rotation/translation is applied in topological
            // order, then the skeleton container supplies the live character root transform.
            var position = restPositions[index];
            var parent = parentIndices[index];
            while (parent >= 0)
            {
                position = restPositions[parent] + restRotations[parent] * position;
                parent = parentIndices[parent];
            }
            return rootObject.transform.TransformPoint(position);
        }

        public void ApplyBatterPosture(
            float crouchMetres,
            Vector3 leftFootTarget,
            Vector3 rightFootTarget,
            Quaternion leftFootRotation,
            Quaternion rightFootRotation)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!IsFinite(crouchMetres) || crouchMetres < 0f ||
                crouchMetres > (float)Vande.Practice.Bridge.BridgeConstants.MaxBatterCrouchMetres)
                throw new ArgumentOutOfRangeException(nameof(crouchMetres));
            if (!Finite(leftFootTarget) || !Finite(rightFootTarget) ||
                !Finite(leftFootRotation) || !Finite(rightFootRotation))
                throw new ArgumentException("Batter posture contains a non-finite foot anchor.");
            if (crouchMetres <= 0f) return;

            var hips = Driver(ProductionCharacterJoint.Hips);
            var leftThigh = Driver(ProductionCharacterJoint.ThighLeft);
            var leftShin = Driver(ProductionCharacterJoint.ShinLeft);
            var leftFoot = Driver(ProductionCharacterJoint.FootLeft);
            var rightThigh = Driver(ProductionCharacterJoint.ThighRight);
            var rightShin = Driver(ProductionCharacterJoint.ShinRight);
            var rightFoot = Driver(ProductionCharacterJoint.FootRight);
            var leftKneeReference = leftShin.position;
            var rightKneeReference = rightShin.position;

            // This is an articulated posture channel, not a hidden root translation. The pelvis and all of its
            // upper-body descendants descend by the encoded world-space amount; both leg chains bend back to the
            // caller's already-planted ankle anchors.
            hips.position += Vector3.down * crouchMetres;
            ProductionCharacterRig.SolveTwoBonePlantedChain(
                leftThigh,
                leftShin,
                leftFoot,
                leftFootTarget,
                leftFootRotation,
                leftKneeReference,
                hips.forward);
            ProductionCharacterRig.SolveTwoBonePlantedChain(
                rightThigh,
                rightShin,
                rightFoot,
                rightFootTarget,
                rightFootRotation,
                rightKneeReference,
                hips.forward);
        }

        public void PlantBatterFeet(
            Vector3 leftFootTarget,
            Vector3 rightFootTarget,
            Quaternion leftFootRotation,
            Quaternion rightFootRotation)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!Finite(leftFootTarget) || !Finite(rightFootTarget) ||
                !Finite(leftFootRotation) || !Finite(rightFootRotation))
                throw new ArgumentException("Batter foot anchors contain a non-finite value.");

            var leftThigh = Driver(ProductionCharacterJoint.ThighLeft);
            var leftShin = Driver(ProductionCharacterJoint.ShinLeft);
            var leftFoot = Driver(ProductionCharacterJoint.FootLeft);
            var rightThigh = Driver(ProductionCharacterJoint.ThighRight);
            var rightShin = Driver(ProductionCharacterJoint.ShinRight);
            var rightFoot = Driver(ProductionCharacterJoint.FootRight);
            // A single analytic pass can retain a sub-millimetre residual on the licensed hierarchy because the
            // helper/deformation parents are not an ideal two-segment plane. Re-solving from the updated knee
            // position converges the same authored-length chain onto its exact world anchors without translating
            // any joint or changing the target/cap.
            for (var pass = 0; pass < 12; pass++)
            {
                ProductionCharacterRig.SolveTwoBonePlantedChain(
                    leftThigh,
                    leftShin,
                    leftFoot,
                    leftFootTarget,
                    leftFootRotation,
                    leftShin.position,
                    Driver(ProductionCharacterJoint.Hips).forward);
                ProductionCharacterRig.SolveTwoBonePlantedChain(
                    rightThigh,
                    rightShin,
                    rightFoot,
                    rightFootTarget,
                    rightFootRotation,
                    rightShin.position,
                    Driver(ProductionCharacterJoint.Hips).forward);
            }
        }

        public void CaptureBatterSupportLegPose(Quaternion[] rotations)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (rotations == null || rotations.Length != 10)
                throw new ArgumentException("Batter support-leg pose must contain ten rotations.", nameof(rotations));
            for (var index = 0; index < rotations.Length; index++)
                rotations[index] = bones[65 + index].localRotation;
        }

        /// <summary>
        /// Restores the captured support-leg rotations; a weight below one blends from the solved legs towards them,
        /// so a recovery can hand the legs over gradually instead of switching them in one frame.
        /// </summary>
        public void RestoreBatterSupportLegPose(Quaternion[] rotations, float weight = 1f)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (rotations == null || rotations.Length != 10)
                throw new ArgumentException("Batter support-leg pose must contain ten rotations.", nameof(rotations));
            if (float.IsNaN(weight) || float.IsInfinity(weight))
                throw new ArgumentOutOfRangeException(nameof(weight));
            var amount = Mathf.Clamp01(weight);
            for (var index = 0; index < rotations.Length; index++)
            {
                if (!Finite(rotations[index]))
                    throw new ArgumentException(
                        "Batter support-leg pose contains a non-finite rotation.", nameof(rotations));
                bones[65 + index].localRotation = amount >= 1f
                    ? rotations[index]
                    : Quaternion.Slerp(bones[65 + index].localRotation, rotations[index], amount);
            }
        }

        /// <summary>
        /// Batter-only reach preparation.  A low joined grip is reached by bounded clavicle/scapular rotation,
        /// rather than by translating the wrist away from its authored parent.  This preserves segment length,
        /// skin continuity and the licensed hand/forearm topology while leaving the canonical bat untouched.
        /// </summary>
        /// <summary>
        /// Lengthens each arm chain (upper-arm centre to wrist) to `targetLength`, measured in `space` (the rig root,
        /// at the reference body scale). It runs after the bind poses were taken, so the skinned arm stretches with
        /// its bones across the four chain segments (upperarm02, lowerarm01, lowerarm02, wrist); hand and finger
        /// offsets keep their authored size. A chain already at least that long is left unchanged.
        /// </summary>
        public void LengthenArmChains(Transform space, float targetLength)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (space == null) throw new ArgumentNullException(nameof(space));
            if (!(targetLength > 0f)) throw new ArgumentOutOfRangeException(nameof(targetLength));
            for (var index = 0; index < bones.Length; index++)
            {
                bones[index].localPosition = restPositions[index];
                bones[index].localRotation = restRotations[index];
            }
            for (var side = 0; side < 2; side++)
            {
                var left = side == 0;
                var upper = driverToBone[(int)(left ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)];
                var fore = driverToBone[(int)(left ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)];
                var hand = driverToBone[(int)(left ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
                if (upper < 0 || fore < 0 || hand < 0) continue;
                var shoulder = space.InverseTransformPoint(bones[upper].position);
                var elbow = space.InverseTransformPoint(bones[fore].position);
                var wrist = space.InverseTransformPoint(bones[hand].position);
                var current = Vector3.Distance(shoulder, elbow) + Vector3.Distance(elbow, wrist);
                if (current <= 0.0001f || current >= targetLength) continue;
                var scale = targetLength / current;
                for (var bone = hand; bone >= 0 && bone != upper; bone = parentIndices[bone])
                {
                    restPositions[bone] *= scale;
                    bones[bone].localPosition = restPositions[bone];
                }
            }
        }

        public void PrepareBatterShoulderReach(bool left, Vector3 target)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!Finite(target)) throw new ArgumentException("Hero IK target contains a non-finite value.");

            var upper = Driver(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var forearm = Driver(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight);
            var hand = Driver(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
            var upperLength = Vector3.Distance(upper.position, forearm.position);
            var lowerLength = Vector3.Distance(forearm.position, hand.position);
            // Aim two micrometres inside the public reach envelope so float roundoff across the two helper
            // rotations cannot leave the final shoulder on the wrong side of the unchanged hard gate.
            var maximumReach = upperLength + lowerLength - BatterArmReachReserveMetres - 0.000002f;
            if (maximumReach <= 0.01f) return;

            var clavicle = bones[left ? LeftClavicleBone : RightClavicleBone];
            var shoulderHelper = bones[left ? LeftShoulderHelperBone : RightShoulderHelperBone];
            var clavicleSource = clavicle.localRotation;
            var shoulderSource = shoulderHelper.localRotation;
            var initialDistance = Vector3.Distance(upper.position, target);
            // The helpers are nested, so either greedy order can strand the other joint just outside reach. Search
            // both deterministic orderings, always clamp from the immutable sampled rotations, and retain the best
            // complete pair. No pass can accumulate past the existing 42/24-degree source-relative caps.
            var bestClavicle = clavicleSource;
            var bestShoulder = shoulderSource;
            var bestDistance = initialDistance;
            for (var ordering = 0; ordering < 4; ordering++)
            {
                clavicle.localRotation = clavicleSource;
                shoulderHelper.localRotation = shoulderSource;
                for (var pass = 0; pass < 12; pass++)
                {
                    var parentFirst = ordering == 0 ||
                                      (ordering >= 2 && ((pass + ordering) & 1) == 0);
                    if (parentFirst)
                    {
                        RotateReachHelper(
                            clavicle,
                            upper,
                            target,
                            maximumReach,
                            MaximumClavicleReachDegrees,
                            clavicleSource);
                        RetainBestReachPair(
                            clavicle,
                            shoulderHelper,
                            upper,
                            target,
                            ref bestClavicle,
                            ref bestShoulder,
                            ref bestDistance);
                        RotateReachHelper(
                            shoulderHelper,
                            upper,
                            target,
                            maximumReach,
                            MaximumShoulderHelperReachDegrees,
                            shoulderSource);
                    }
                    else
                    {
                        RotateReachHelper(
                            shoulderHelper,
                            upper,
                            target,
                            maximumReach,
                            MaximumShoulderHelperReachDegrees,
                            shoulderSource);
                        RetainBestReachPair(
                            clavicle,
                            shoulderHelper,
                            upper,
                            target,
                            ref bestClavicle,
                            ref bestShoulder,
                            ref bestDistance);
                        RotateReachHelper(
                            clavicle,
                            upper,
                            target,
                            maximumReach,
                            MaximumClavicleReachDegrees,
                            clavicleSource);
                    }
                    RetainBestReachPair(
                        clavicle,
                        shoulderHelper,
                        upper,
                        target,
                        ref bestClavicle,
                        ref bestShoulder,
                        ref bestDistance);
                    if (bestDistance <= maximumReach - 0.000001f) break;
                }
            }
            clavicle.localRotation = bestClavicle;
            shoulderHelper.localRotation = bestShoulder;
            if (bestDistance > maximumReach + MaximumBatterClavicleTranslationMetres + 0.000002f)
            {
                ExploreReachConeSeeds(
                    clavicle,
                    shoulderHelper,
                    upper,
                    target,
                    maximumReach,
                    clavicleSource,
                    shoulderSource,
                    ref bestClavicle,
                    ref bestShoulder,
                    ref bestDistance);
                RefineReachHelperPair(
                    clavicle,
                    shoulderHelper,
                    upper,
                    target,
                    clavicleSource,
                    shoulderSource,
                    ref bestClavicle,
                    ref bestShoulder,
                    ref bestDistance);
                clavicle.localRotation = bestClavicle;
                shoulderHelper.localRotation = bestShoulder;
            }
            TranslateClavicleReach(
                clavicle,
                upper,
                target,
                maximumReach);
        }

        /// <param name="weight">Share of the correction applied (1 = all); the batter carry eases it in.</param>
        public void AlignBatterShoulderFrameYaw(Vector3 desiredSpan, float maximumDegrees, float weight = 1f)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!Finite(desiredSpan) || !IsFinite(maximumDegrees) || maximumDegrees < 0f)
                throw new ArgumentOutOfRangeException(nameof(maximumDegrees));
            if (!IsFinite(weight)) throw new ArgumentOutOfRangeException(nameof(weight));
            var left = Driver(ProductionCharacterJoint.UpperArmLeft).position;
            var right = Driver(ProductionCharacterJoint.UpperArmRight).position;
            var current = Vector3.ProjectOnPlane(right - left, Vector3.up);
            var desired = Vector3.ProjectOnPlane(desiredSpan, Vector3.up);
            if (current.sqrMagnitude <= 0.000001f || desired.sqrMagnitude <= 0.000001f) return;
            var yaw = Mathf.Clamp(
                Vector3.SignedAngle(current.normalized, desired.normalized, Vector3.up),
                -maximumDegrees,
                maximumDegrees) * Mathf.Clamp01(weight);
            if (Mathf.Abs(yaw) <= 0.0001f) return;
            // spine04 is below the canonical spine driver but outside the leg branches. It turns the visible torso
            // toward the static physics shoulder frame without rotating either planted leg or the gameplay root.
            bones[4].rotation = Quaternion.AngleAxis(yaw, Vector3.up) * bones[4].rotation;
        }

        /// <param name="weight">Share of the correction applied (1 = all); the batter carry eases it in.</param>
        public void AlignBatterShoulderFrameHeight(float targetY, float weight = 1f)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!IsFinite(targetY)) throw new ArgumentOutOfRangeException(nameof(targetY));
            if (!IsFinite(weight)) throw new ArgumentOutOfRangeException(nameof(weight));
            var leftShoulder = Driver(ProductionCharacterJoint.UpperArmLeft);
            var rightShoulder = Driver(ProductionCharacterJoint.UpperArmRight);
            var sampledY = (leftShoulder.position.y + rightShoulder.position.y) * 0.5f;
            // spine04 is the first torso-only helper above both leg branches and below every visible shoulder/head
            // driver. Place that upper-body frame vertically instead of lifting the skeleton container: the physics
            // torso contract is reconstructed exactly while both planted legs, the gameplay root and every semantic
            // joint's authored local position remain untouched.
            bones[4].position += Vector3.up * ((targetY - sampledY) * Mathf.Clamp01(weight));
        }

        // ---- The batter's arms: hinge-respecting solve with the elbow's memory (ProductionHeroArm) ---------------------

        private readonly ProductionArmMemory[] armMemory = { new ProductionArmMemory(), new ProductionArmMemory() };

        /// <summary>The clock (s) of the frame being posed, set by the rig before a grip solve; NaN: no memory (a seek or a first frame).</summary>
        internal double ArmClockSeconds { get; set; } = double.NaN;

        /// <summary>Builder seam: false solves every arm from its pole alone, as a seek would (A/B in one build).</summary>
        internal bool ArmMemoryEnabled { get; set; } = true;

        /// <summary>Forgets what both arms remember of their last frame (a new script or a seek).</summary>
        internal void ResetArmMemory()
        {
            armMemory[0].Clear();
            armMemory[1].Clear();
        }

        /// <summary>What both arms remember now (a copy): the frame on screen, before solves made between frames overwrite it.</summary>
        internal ProductionArmMemory[] CaptureArmMemory()
        {
            var copy = new[] { new ProductionArmMemory(), new ProductionArmMemory() };
            copy[0].CopyFrom(armMemory[0]);
            copy[1].CopyFrom(armMemory[1]);
            return copy;
        }

        /// <summary>Puts back what CaptureArmMemory took.</summary>
        internal void RestoreArmMemory(ProductionArmMemory[] captured)
        {
            if (captured == null || captured.Length != 2) return;
            armMemory[0].CopyFrom(captured[0]);
            armMemory[1].CopyFrom(captured[1]);
        }

        /// <summary>
        /// Final presentation-only arm solve of a batter's gripping hand: hinge-respecting, with the elbow's plane continuous
        /// from the frame before (ProductionHeroArm.Solve). The wrist is not translated (the shoulder reach was made before),
        /// so the hand may stop short of a target beyond the arm's reach. Returns the wrist's distance from `target` (m).
        /// </summary>
        public float SolveBatterArm(bool left, Vector3 target, Quaternion wristRotation, Vector3 poleDirection)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!Finite(target) || !Finite(wristRotation) || !Finite(poleDirection))
                throw new ArgumentException("Hero IK target contains a non-finite value.");
            ProductionArmMemory memory = null;
            if (ArmMemoryEnabled)
            {
                memory = armMemory[left ? 0 : 1];
                memory.BeginFrame(ArmClockSeconds);
            }
            return ProductionHeroArm.Solve(this, left, target, wristRotation, poleDirection, memory);
        }

        /// <summary>
        /// Final presentation-only two-bone arm solve. It runs after canonical and optional reference motion.
        /// A terminal wrist translation reconciles the MakeHuman and canonical arm-length contracts; this affects
        /// only visible skin/glove bones and can never move the bat, release marker, ball or scoring authority.
        /// </summary>
        public void SolveArmToTarget(bool left, Vector3 target, Quaternion wristRotation,
            Vector3 poleDirection, bool preserveAuthoredWristPosition = false)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            if (!Finite(target) || !Finite(wristRotation) || !Finite(poleDirection))
                throw new ArgumentException("Hero IK target contains a non-finite value.");

            var upper = Driver(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var forearm = Driver(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight);
            var hand = Driver(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
            var shoulder = upper.position;
            var upperLength = Vector3.Distance(shoulder, forearm.position);
            var lowerLength = Vector3.Distance(forearm.position, hand.position);
            var reach = target - shoulder;
            if (upperLength <= 0.001f || lowerLength <= 0.001f || reach.sqrMagnitude <= 0.000001f)
                throw new InvalidOperationException("Hero arm geometry cannot satisfy the IK contract.");

            var direction = reach.normalized;
            var distance = Mathf.Clamp(reach.magnitude,
                Mathf.Abs(upperLength - lowerLength) + 0.001f,
                upperLength + lowerLength - 0.001f);
            var cosine = Mathf.Clamp(
                (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
                (2f * upperLength * distance), -1f, 1f);
            var along = upperLength * cosine;
            var across = upperLength * Mathf.Sqrt(Mathf.Max(0f, 1f - cosine * cosine));
            var pole = poleDirection - direction * Vector3.Dot(poleDirection, direction);
            if (pole.sqrMagnitude <= 0.000001f)
            {
                pole = Vector3.Cross(direction, Vector3.up);
                if (pole.sqrMagnitude <= 0.000001f) pole = Vector3.Cross(direction, Vector3.right);
            }
            pole.Normalize();
            var desiredElbow = shoulder + direction * along + pole * across;

            RotateTowards(upper, forearm.position - shoulder, desiredElbow - shoulder);
            RotateTowards(forearm, hand.position - forearm.position, target - forearm.position);

            // Delivery-arm closure retains the legacy exact marker reconciliation.  The batter path prepares
            // clavicle/scapular reach first and forbids this translation: moving the wrist joint stretches
            // wrist-weighted glove vertices away from the lower-arm skin and creates the orange tearing visible in
            // the locked rear-shoulder camera.
            if (!preserveAuthoredWristPosition) hand.position = target;
            hand.rotation = wristRotation;
        }

        private static void RotateReachHelper(
            Transform helper,
            Transform shoulder,
            Vector3 target,
            float maximumArmReach,
            float maximumDegrees,
            Quaternion sourceLocalRotation)
        {
            if (helper == null || shoulder == null) return;
            if (Vector3.Distance(shoulder.position, target) <= maximumArmReach) return;

            var pivot = helper.position;
            var current = shoulder.position - pivot;
            var toTarget = target - pivot;
            var helperLength = current.magnitude;
            var targetDistance = toTarget.magnitude;
            if (helperLength <= 0.001f || targetDistance <= 0.001f) return;

            var axis = toTarget / targetDistance;
            Vector3 desired;
            if (targetDistance > helperLength + maximumArmReach)
            {
                desired = axis * helperLength;
            }
            else
            {
                // Closest point to the authored shoulder on the intersection of the helper-length sphere and the
                // maximum-arm-reach sphere.  It is the minimum scapular change that makes the fixed-length arm fit.
                var planeDistance = (helperLength * helperLength -
                                     maximumArmReach * maximumArmReach +
                                     targetDistance * targetDistance) /
                                    (2f * targetDistance);
                planeDistance = Mathf.Clamp(planeDistance, -helperLength, helperLength);
                var circleRadius = Mathf.Sqrt(Mathf.Max(
                    0f, helperLength * helperLength - planeDistance * planeDistance));
                var radial = current - axis * Vector3.Dot(current, axis);
                if (radial.sqrMagnitude <= 0.000001f)
                {
                    radial = Vector3.Cross(axis, Vector3.up);
                    if (radial.sqrMagnitude <= 0.000001f)
                        radial = Vector3.Cross(axis, Vector3.right);
                }
                desired = axis * planeDistance + radial.normalized * circleRadius;
            }

            if (desired.sqrMagnitude <= 0.000001f) return;
            var currentLocal = helper.localRotation;
            var currentWorld = helper.rotation;
            var parentWorld = helper.parent == null ? Quaternion.identity : helper.parent.rotation;
            var correction = Quaternion.FromToRotation(current.normalized, desired.normalized);
            var candidateWorld = correction * currentWorld;
            var candidateLocal = Quaternion.Inverse(parentWorld) * candidateWorld;
            candidateLocal = Quaternion.RotateTowards(
                sourceLocalRotation, candidateLocal, maximumDegrees);

            // If the minimum-change sphere-intersection direction itself lies outside this joint's angular cap,
            // the cap-clamped geodesic is not necessarily the direction that brings the shoulder closest to the
            // handle. Compare it with a cap-clamped direct aim and retain the actually shorter shoulder-to-target
            // result. This changes only the axis choice inside the existing cap.
            var directCorrection = Quaternion.FromToRotation(current.normalized, axis);
            var directWorld = directCorrection * currentWorld;
            var directLocal = Quaternion.RotateTowards(
                sourceLocalRotation,
                Quaternion.Inverse(parentWorld) * directWorld,
                maximumDegrees);
            var bestLocal = currentLocal;
            var bestDistance = Vector3.Distance(shoulder.position, target);
            helper.localRotation = candidateLocal;
            var candidateDistance = Vector3.Distance(shoulder.position, target);
            if (candidateDistance < bestDistance)
            {
                bestDistance = candidateDistance;
                bestLocal = candidateLocal;
            }
            helper.localRotation = directLocal;
            var directDistance = Vector3.Distance(shoulder.position, target);
            if (directDistance < bestDistance)
                bestLocal = directLocal;
            helper.localRotation = bestLocal;
        }

        private static void RetainBestReachPair(
            Transform clavicle,
            Transform shoulderHelper,
            Transform shoulder,
            Vector3 target,
            ref Quaternion bestClavicle,
            ref Quaternion bestShoulder,
            ref float bestDistance)
        {
            var distance = Vector3.Distance(shoulder.position, target);
            if (distance >= bestDistance) return;
            bestDistance = distance;
            bestClavicle = clavicle.localRotation;
            bestShoulder = shoulderHelper.localRotation;
        }

        private static void RefineReachHelperPair(
            Transform clavicle,
            Transform shoulderHelper,
            Transform shoulder,
            Vector3 target,
            Quaternion clavicleSource,
            Quaternion shoulderSource,
            ref Quaternion bestClavicle,
            ref Quaternion bestShoulder,
            ref float bestDistance)
        {
            // Projected local search runs only for a pose that remains infeasible after the analytic two-order CCD.
            // Six shrinking steps refine the axes on the existing rotation-cone boundaries; every candidate is
            // clamped from the immutable sampled rotation, so this cannot raise or accumulate either angular cap.
            var step = 4f;
            for (var level = 0; level < 6; level++, step *= 0.25f)
            {
                for (var joint = 0; joint < 2; joint++)
                {
                    var baseClavicle = bestClavicle;
                    var baseShoulder = bestShoulder;
                    for (var axisIndex = 0; axisIndex < 3; axisIndex++)
                    {
                        var axis = axisIndex == 0
                            ? Vector3.right
                            : axisIndex == 1 ? Vector3.up : Vector3.forward;
                        for (var multiplication = 0; multiplication < 2; multiplication++)
                        {
                            for (var sign = -1; sign <= 1; sign += 2)
                            {
                                clavicle.localRotation = baseClavicle;
                                shoulderHelper.localRotation = baseShoulder;
                                var delta = Quaternion.AngleAxis(sign * step, axis);
                                if (joint == 0)
                                {
                                    var candidate = multiplication == 0
                                        ? baseClavicle * delta
                                        : delta * baseClavicle;
                                    clavicle.localRotation = Quaternion.RotateTowards(
                                        clavicleSource,
                                        candidate,
                                        MaximumClavicleReachDegrees);
                                }
                                else
                                {
                                    var candidate = multiplication == 0
                                        ? baseShoulder * delta
                                        : delta * baseShoulder;
                                    shoulderHelper.localRotation = Quaternion.RotateTowards(
                                        shoulderSource,
                                        candidate,
                                        MaximumShoulderHelperReachDegrees);
                                }
                                RetainBestReachPair(
                                    clavicle,
                                    shoulderHelper,
                                    shoulder,
                                    target,
                                    ref bestClavicle,
                                    ref bestShoulder,
                                    ref bestDistance);
                            }
                        }
                    }
                    clavicle.localRotation = bestClavicle;
                    shoulderHelper.localRotation = bestShoulder;
                }
            }
        }

        private static void ExploreReachConeSeeds(
            Transform clavicle,
            Transform shoulderHelper,
            Transform shoulder,
            Vector3 target,
            float maximumArmReach,
            Quaternion clavicleSource,
            Quaternion shoulderSource,
            ref Quaternion bestClavicle,
            ref Quaternion bestShoulder,
            ref float bestDistance)
        {
            // A saturated two-joint CCD can settle on the wrong point of either four-dimensional cone boundary.
            // Seed both source-relative cones with a deterministic Fibonacci sphere, then run a few bounded CCD
            // projections from each seed. This path executes only when the existing 35 mm glide still cannot close
            // the pose, and every candidate remains inside the unchanged 42/24-degree limits.
            const int seedCount = 48;
            const float goldenAngle = 2.39996323f;
            for (var seed = 0; seed < seedCount; seed++)
            {
                var y = 1f - 2f * (seed + 0.5f) / seedCount;
                var radius = Mathf.Sqrt(Mathf.Max(0f, 1f - y * y));
                var angle = goldenAngle * seed;
                var axis = new Vector3(Mathf.Cos(angle) * radius, y, Mathf.Sin(angle) * radius);
                for (var seededJoint = 0; seededJoint < 2; seededJoint++)
                {
                    clavicle.localRotation = seededJoint == 0
                        ? clavicleSource * Quaternion.AngleAxis(MaximumClavicleReachDegrees, axis)
                        : clavicleSource;
                    shoulderHelper.localRotation = seededJoint == 1
                        ? shoulderSource * Quaternion.AngleAxis(MaximumShoulderHelperReachDegrees, axis)
                        : shoulderSource;
                    for (var pass = 0; pass < 4; pass++)
                    {
                        RotateReachHelper(
                            clavicle,
                            shoulder,
                            target,
                            maximumArmReach,
                            MaximumClavicleReachDegrees,
                            clavicleSource);
                        RotateReachHelper(
                            shoulderHelper,
                            shoulder,
                            target,
                            maximumArmReach,
                            MaximumShoulderHelperReachDegrees,
                            shoulderSource);
                        RetainBestReachPair(
                            clavicle,
                            shoulderHelper,
                            shoulder,
                            target,
                            ref bestClavicle,
                            ref bestShoulder,
                            ref bestDistance);
                    }
                }
            }
            clavicle.localRotation = bestClavicle;
            shoulderHelper.localRotation = bestShoulder;
        }

        private static void TranslateClavicleReach(
            Transform clavicle,
            Transform shoulder,
            Vector3 target,
            float maximumArmReach)
        {
            if (clavicle == null || shoulder == null) return;
            var reach = target - shoulder.position;
            var excess = reach.magnitude - maximumArmReach;
            if (excess <= 0f || reach.sqrMagnitude <= 0.000001f) return;
            // Rotations remain the primary shoulder solve. This final scapular glide is capped at 35 mm, below the
            // visible clavicle's own length, and moves the complete arm branch as one unit. It closes the last small
            // trace mismatch without translating the wrist, changing segment lengths or tearing the glove away from
            // the forearm. Synchronize restores authored positions before every deterministic sample.
            clavicle.position += reach.normalized * Mathf.Min(
                excess,
                MaximumBatterClavicleTranslationMetres);
        }

        private Transform Driver(ProductionCharacterJoint joint)
        {
            var driverIndex = (int)joint;
            if (driverIndex < 0 || driverIndex >= driverToBone.Length)
                throw new ArgumentOutOfRangeException(nameof(joint));
            var boneIndex = driverToBone[driverIndex];
            if (boneIndex < 0 || boneIndex >= bones.Length || bones[boneIndex] == null)
                throw new InvalidOperationException("The hero driver mapping is incomplete.");
            return bones[boneIndex];
        }

        /// <summary>The hero bone behind a semantic joint (read by the arm tests and the builder evidence).</summary>
        internal Transform BoneOf(ProductionCharacterJoint joint)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            return Driver(joint);
        }

        /// <summary>A semantic joint's bone's rest rotation (identity in VSK1) and canonical rest correction (Synchronize: rest * canonical * correction).</summary>
        internal void RestFramesOf(ProductionCharacterJoint joint, out Quaternion rest, out Quaternion correction)
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionHeroSkeletonInstance));
            Driver(joint);
            var boneIndex = driverToBone[(int)joint];
            rest = restRotations[boneIndex];
            correction = canonicalRestCorrections[boneIndex];
        }

        private static void RotateTowards(Transform bone, Vector3 current, Vector3 desired)
        {
            if (current.sqrMagnitude <= 0.000001f || desired.sqrMagnitude <= 0.000001f)
                throw new InvalidOperationException("Hero IK contains a degenerate arm segment.");
            bone.rotation = Quaternion.FromToRotation(current.normalized, desired.normalized) * bone.rotation;
        }

        private static bool Finite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool Finite(Quaternion value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            ProductionCharacterResources.DestroyOwned(rootObject);
        }
    }

    internal readonly struct ProductionHeroDecodedMesh
    {
        public ProductionHeroDecodedMesh(Mesh mesh, ulong skeletonId, ushort boneCount)
        {
            Mesh = mesh;
            SkeletonId = skeletonId;
            BoneCount = boneCount;
        }

        public Mesh Mesh { get; }
        public ulong SkeletonId { get; }
        public ushort BoneCount { get; }
    }

    /// <summary>
    /// Exact, all-or-nothing resource admission contract for a close hero. Presence is checked separately from
    /// decoding so a partially copied bundle can never become player-visible.
    /// </summary>
    internal readonly struct ProductionHeroBundleAssets
    {
        public ProductionHeroBundleAssets(
            TextAsset skeleton,
            TextAsset eyes,
            TextAsset closeUp,
            TextAsset liveBatter,
            TextAsset liveBowler,
            TextAsset distantFielderPremium,
            TextAsset distantFielderBalancedLite,
            TextAsset gearCloseUp,
            TextAsset gearLiveBatter,
            TextAsset batCloseUp,
            TextAsset batLiveBatter)
        {
            Skeleton = skeleton;
            Eyes = eyes;
            CloseUp = closeUp;
            LiveBatter = liveBatter;
            LiveBowler = liveBowler;
            DistantFielderPremium = distantFielderPremium;
            DistantFielderBalancedLite = distantFielderBalancedLite;
            GearCloseUp = gearCloseUp;
            GearLiveBatter = gearLiveBatter;
            BatCloseUp = batCloseUp;
            BatLiveBatter = batLiveBatter;
        }

        public TextAsset Skeleton { get; }
        public TextAsset Eyes { get; }
        public TextAsset CloseUp { get; }
        public TextAsset LiveBatter { get; }
        public TextAsset LiveBowler { get; }
        public TextAsset DistantFielderPremium { get; }
        public TextAsset DistantFielderBalancedLite { get; }
        public TextAsset GearCloseUp { get; }
        public TextAsset GearLiveBatter { get; }
        public TextAsset BatCloseUp { get; }
        public TextAsset BatLiveBatter { get; }
        public bool AnyPresent => Skeleton != null || Eyes != null ||
                                  CloseUp != null || LiveBatter != null || LiveBowler != null ||
                                  DistantFielderPremium != null || DistantFielderBalancedLite != null ||
                                  GearCloseUp != null || GearLiveBatter != null ||
                                  BatCloseUp != null || BatLiveBatter != null;
        public bool CommonComplete =>
            Skeleton != null && Eyes != null &&
            CloseUp != null && LiveBatter != null && LiveBowler != null;
        public bool BatterComplete => CommonComplete &&
                                      GearCloseUp != null && GearLiveBatter != null &&
                                      BatCloseUp != null && BatLiveBatter != null;
        public bool FielderComplete => CommonComplete &&
                                       DistantFielderPremium != null &&
                                       DistantFielderBalancedLite != null;
        public bool KeeperComplete => FielderComplete;

        public bool IsCompleteFor(ProductionCharacterRole role)
        {
            if (role == ProductionCharacterRole.Batter) return BatterComplete;
            if (role == ProductionCharacterRole.Fielder) return FielderComplete;
            if (role == ProductionCharacterRole.Wicketkeeper) return KeeperComplete;
            return CommonComplete;
        }

        public static ProductionHeroBundleAssets Load(
            ProductionCharacterResourceLoader loader,
            ProductionCharacterRole role)
        {
            if (loader == null) throw new ArgumentNullException(nameof(loader));
            var batter = role == ProductionCharacterRole.Batter;
            var fieldRole = role == ProductionCharacterRole.Fielder ||
                            role == ProductionCharacterRole.Wicketkeeper;
            return new ProductionHeroBundleAssets(
                loader(ProductionHeroSkeletonDefinition.ResourceKey),
                loader(ProductionHeroCharacterMesh.EyeResourceKey),
                loader(ProductionHeroCharacterMesh.ResourceBase + "-lod0"),
                loader(ProductionHeroCharacterMesh.ResourceBase + "-lod1"),
                loader(ProductionHeroCharacterMesh.ResourceBase + "-lod2"),
                fieldRole ? loader(ProductionHeroCharacterMesh.ResourceBase + "-lod3") : null,
                fieldRole ? loader(ProductionHeroCharacterMesh.ResourceBase + "-lod4") : null,
                batter ? loader(ProductionHeroCharacterMesh.GearResourceBase + "-lod0") : null,
                batter ? loader(ProductionHeroCharacterMesh.GearResourceBase + "-lod1") : null,
                batter ? loader(ProductionHeroBatMesh.ResourceBase + "-lod0") : null,
                batter ? loader(ProductionHeroBatMesh.ResourceBase + "-lod1") : null);
        }
    }

    /// <summary>Strict decoder for the four-weight, tangent-bearing VPM3 hero mesh format.</summary>
    internal static class ProductionHeroCharacterMesh
    {
        internal const string ResourceBase = "ProductionCharacters/hero";
        internal const string EyeResourceKey = "ProductionCharacters/hero-eyes";
        internal const string GearResourceBase = "ProductionCharacters/hero-gear";
        internal const int EyeVertexCount = 96;
        internal const int EyeTriangleCount = 172;
        internal const byte EyeShaderRegion = 16;
        internal const int EyeHeadBoneIndex = 11;
        internal const ushort FormatVersion = 3;
        internal const ushort VertexStride = 72;
        private const int HeaderBytes = 32;
        private const byte InfluenceCount = 4;
        private const byte IndexWidth = 2;
        private const int MaximumVertices = 65_535;
        private const int MaximumIndices = 200_000;

        public static ProductionHeroDecodedMesh Decode(byte[] bytes, string name,
            ProductionHeroSkeletonDefinition skeleton)
        {
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (bytes == null || bytes.Length < HeaderBytes)
                throw new InvalidOperationException("Hero character mesh data is missing or truncated.");

            var reader = new HeroLittleEndianReader(bytes);
            if (reader.Byte() != (byte)'V' || reader.Byte() != (byte)'P' ||
                reader.Byte() != (byte)'M' || reader.Byte() != (byte)'3')
                throw new InvalidOperationException("Hero character mesh magic is invalid.");
            if (reader.UInt16() != FormatVersion)
                throw new InvalidOperationException("Hero character mesh version is unsupported.");
            var boneCount = reader.UInt16();
            if (boneCount != skeleton.BoneCount)
                throw new InvalidOperationException("Hero character mesh skeleton bone count does not match.");
            var vertexCount = checked((int)reader.UInt32());
            var indexCount = checked((int)reader.UInt32());
            if (vertexCount < 3 || vertexCount > MaximumVertices ||
                indexCount < 3 || indexCount > MaximumIndices || indexCount % 3 != 0)
                throw new InvalidOperationException("Hero character mesh counts are outside the bounded contract.");
            if (reader.UInt16() != VertexStride || reader.Byte() != InfluenceCount ||
                reader.Byte() != IndexWidth)
                throw new InvalidOperationException("Hero character mesh layout is unsupported.");
            var skeletonId = reader.UInt64();
            if (skeletonId != skeleton.SkeletonId)
                throw new InvalidOperationException("Hero character mesh skeleton identity does not match.");
            if (reader.UInt32() != 0)
                throw new InvalidOperationException("Hero character mesh flags are unsupported.");

            var expectedLength = checked(HeaderBytes + vertexCount * VertexStride + indexCount * IndexWidth);
            if (bytes.Length != expectedLength)
                throw new InvalidOperationException("Hero character mesh byte length does not match its header.");

            var positions = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var tangents = new Vector4[vertexCount];
            var bindPositions = new Vector3[vertexCount];
            var textureCoordinates = new Vector2[vertexCount];
            var colours = new Color32[vertexCount];
            var weights = new BoneWeight[vertexCount];

            for (var index = 0; index < vertexCount; index++)
            {
                positions[index] = reader.Vector3();
                normals[index] = reader.Vector3();
                tangents[index] = reader.Vector4();
                bindPositions[index] = reader.Vector3();
                textureCoordinates[index] = reader.Vector2();
                if (!Finite(positions[index]) || !Finite(normals[index]) || !Finite(tangents[index]) ||
                    !Finite(bindPositions[index]) || !Finite(textureCoordinates[index]) ||
                    positions[index].sqrMagnitude > 100f || bindPositions[index].sqrMagnitude > 100f ||
                    normals[index].sqrMagnitude < 0.01f ||
                    new Vector3(tangents[index].x, tangents[index].y, tangents[index].z).sqrMagnitude < 0.01f ||
                    Mathf.Abs(Mathf.Abs(tangents[index].w) - 1f) > 0.001f)
                    throw new InvalidOperationException("Hero character mesh contains an invalid vertex.");

                var region = reader.Byte();
                var bone0 = reader.Byte();
                var bone1 = reader.Byte();
                var bone2 = reader.Byte();
                var bone3 = reader.Byte();
                var weight0 = reader.Byte();
                var weight1 = reader.Byte();
                var weight2 = reader.Byte();
                var weight3 = reader.Byte();
                if (reader.Byte() != 0 || reader.Byte() != 0 || reader.Byte() != 0)
                    throw new InvalidOperationException("Hero character mesh reserved vertex bytes must be zero.");
                if (region > 16 || bone0 >= boneCount || bone1 >= boneCount ||
                    bone2 >= boneCount || bone3 >= boneCount ||
                    weight0 + weight1 + weight2 + weight3 != byte.MaxValue)
                    throw new InvalidOperationException(
                        "Hero character mesh contains an invalid vertex skin binding.");

                weights[index] = new BoneWeight
                {
                    boneIndex0 = bone0,
                    boneIndex1 = bone1,
                    boneIndex2 = bone2,
                    boneIndex3 = bone3,
                    weight0 = (float)weight0 / byte.MaxValue,
                    weight1 = (float)weight1 / byte.MaxValue,
                    weight2 = (float)weight2 / byte.MaxValue,
                    weight3 = (float)weight3 / byte.MaxValue
                };
                colours[index] = new Color32(region, byte.MaxValue, 0, byte.MaxValue);
            }

            var triangles = new int[indexCount];
            for (var index = 0; index < indexCount; index++)
            {
                triangles[index] = reader.UInt16();
                if (triangles[index] >= vertexCount)
                    throw new InvalidOperationException("Hero character mesh index is outside its vertex buffer.");
            }
            if (!reader.AtEnd)
                throw new InvalidOperationException("Hero character mesh contains undeclared trailing bytes.");

            var mesh = new Mesh
            {
                name = name,
                hideFlags = HideFlags.DontSave,
                indexFormat = IndexFormat.UInt16
            };
            mesh.vertices = positions;
            mesh.normals = normals;
            mesh.tangents = tangents;
            mesh.colors32 = colours;
            mesh.uv = textureCoordinates;
            mesh.SetUVs(1, new System.Collections.Generic.List<Vector3>(bindPositions));
            mesh.boneWeights = weights;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return new ProductionHeroDecodedMesh(mesh, skeletonId, boneCount);
        }

        private static bool Finite(Vector2 value)
        {
            return IsFinite(value.x) && IsFinite(value.y);
        }

        private static bool Finite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool Finite(Vector4 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }

    /// <summary>Strict decoder for the original VANDE VBT1 law-scale bat candidate.</summary>
    internal static class ProductionHeroBatMesh
    {
        internal const string ResourceBase = "ProductionCharacters/hero-bat";
        internal const ushort FormatVersion = 1;
        internal const ushort VertexStride = 56;
        private const int HeaderBytes = 32;
        private const byte IndexWidth = 2;
        private const int MaterialRegionCount = 3;
        private const int MaximumVertices = 65_535;
        private const int MaximumIndices = 200_000;

        public static Mesh Decode(byte[] bytes, string name)
        {
            if (bytes == null || bytes.Length < HeaderBytes)
                throw new InvalidOperationException("Hero bat data is missing or truncated.");

            var reader = new HeroLittleEndianReader(bytes);
            if (reader.Byte() != (byte)'V' || reader.Byte() != (byte)'B' ||
                reader.Byte() != (byte)'T' || reader.Byte() != (byte)'1')
                throw new InvalidOperationException("Hero bat magic is invalid.");
            if (reader.UInt16() != FormatVersion)
                throw new InvalidOperationException("Hero bat version is unsupported.");
            if (reader.UInt16() != VertexStride)
                throw new InvalidOperationException("Hero bat vertex layout is unsupported.");
            var vertexCount = checked((int)reader.UInt32());
            var indexCount = checked((int)reader.UInt32());
            if (vertexCount < 3 || vertexCount > MaximumVertices ||
                indexCount < 3 || indexCount > MaximumIndices || indexCount % 3 != 0)
                throw new InvalidOperationException("Hero bat counts are outside the bounded contract.");
            if (reader.Byte() != IndexWidth)
                throw new InvalidOperationException("Hero bat index layout is unsupported.");
            for (var index = 17; index < HeaderBytes; index++)
            {
                if (reader.Byte() != 0)
                    throw new InvalidOperationException("Hero bat reserved header bytes must be zero.");
            }

            var expectedLength = checked(HeaderBytes + vertexCount * VertexStride + indexCount * IndexWidth);
            if (bytes.Length != expectedLength)
                throw new InvalidOperationException("Hero bat byte length does not match its header.");

            var positions = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var tangents = new Vector4[vertexCount];
            var textureCoordinates = new Vector2[vertexCount];
            var regions = new byte[vertexCount];
            for (var index = 0; index < vertexCount; index++)
            {
                positions[index] = reader.Vector3();
                normals[index] = reader.Vector3();
                tangents[index] = reader.Vector4();
                textureCoordinates[index] = reader.Vector2();
                regions[index] = reader.Byte();
                for (var reserved = 0; reserved < 7; reserved++)
                {
                    if (reader.Byte() != 0)
                        throw new InvalidOperationException("Hero bat reserved vertex bytes must be zero.");
                }
                if (!Finite(positions[index]) || !Finite(normals[index]) ||
                    !Finite(tangents[index]) || !Finite(textureCoordinates[index]) ||
                    positions[index].sqrMagnitude > 4f || normals[index].sqrMagnitude < 0.01f ||
                    new Vector3(tangents[index].x, tangents[index].y, tangents[index].z).sqrMagnitude < 0.01f ||
                    Mathf.Abs(Mathf.Abs(tangents[index].w) - 1f) > 0.001f ||
                    regions[index] >= MaterialRegionCount)
                    throw new InvalidOperationException("Hero bat contains an invalid vertex.");
            }

            var regionTriangles = new System.Collections.Generic.List<int>[MaterialRegionCount];
            for (var index = 0; index < regionTriangles.Length; index++)
                regionTriangles[index] = new System.Collections.Generic.List<int>();
            for (var triangle = 0; triangle < indexCount / 3; triangle++)
            {
                var a = reader.UInt16();
                var b = reader.UInt16();
                var c = reader.UInt16();
                if (a >= vertexCount || b >= vertexCount || c >= vertexCount)
                    throw new InvalidOperationException("Hero bat index is outside its vertex buffer.");
                // The rounded blade intentionally shares boundary vertices between its face and edge. Assign the
                // triangle to the majority region; an all-different triangle is corrupt/ambiguous and fails closed.
                byte triangleRegion;
                if (regions[a] == regions[b] || regions[a] == regions[c])
                    triangleRegion = regions[a];
                else if (regions[b] == regions[c])
                    triangleRegion = regions[b];
                else
                    throw new InvalidOperationException("Hero bat triangle has ambiguous material regions.");
                var target = regionTriangles[triangleRegion];
                target.Add(a);
                target.Add(b);
                target.Add(c);
            }
            if (!reader.AtEnd)
                throw new InvalidOperationException("Hero bat contains undeclared trailing bytes.");

            var mesh = new Mesh
            {
                name = name,
                hideFlags = HideFlags.DontSave,
                indexFormat = IndexFormat.UInt16
            };
            mesh.vertices = positions;
            mesh.normals = normals;
            mesh.tangents = tangents;
            mesh.uv = textureCoordinates;
            mesh.subMeshCount = MaterialRegionCount;
            for (var index = 0; index < regionTriangles.Length; index++)
                mesh.SetTriangles(regionTriangles[index], index, false);
            mesh.RecalculateBounds();
            return mesh;
        }

        private static bool Finite(Vector2 value)
        {
            return IsFinite(value.x) && IsFinite(value.y);
        }

        private static bool Finite(Vector3 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private static bool Finite(Vector4 value)
        {
            return IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z) && IsFinite(value.w);
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }

    internal sealed class HeroLittleEndianReader
    {
        private readonly byte[] bytes;
        private int offset;

        public HeroLittleEndianReader(byte[] bytes)
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
            return unchecked((short)UInt16());
        }

        public ushort UInt16()
        {
            Require(2);
            var value = (ushort)(bytes[offset] | bytes[offset + 1] << 8);
            offset += 2;
            return value;
        }

        public uint UInt32()
        {
            Require(4);
            var value = (uint)(bytes[offset] |
                               bytes[offset + 1] << 8 |
                               bytes[offset + 2] << 16 |
                               bytes[offset + 3] << 24);
            offset += 4;
            return value;
        }

        public ulong UInt64()
        {
            var low = UInt32();
            var high = UInt32();
            return low | (ulong)high << 32;
        }

        public float Single()
        {
            Require(4);
            var value = BitConverter.ToSingle(bytes, offset);
            offset += 4;
            return value;
        }

        public Vector2 Vector2()
        {
            return new Vector2(Single(), Single());
        }

        public Vector3 Vector3()
        {
            return new Vector3(Single(), Single(), Single());
        }

        public Vector4 Vector4()
        {
            return new Vector4(Single(), Single(), Single(), Single());
        }

        public Quaternion Quaternion()
        {
            return new Quaternion(Single(), Single(), Single(), Single());
        }

        private void Require(int count)
        {
            if (count < 0 || offset > bytes.Length - count)
                throw new InvalidOperationException("Hero character data ended unexpectedly.");
        }
    }
}
