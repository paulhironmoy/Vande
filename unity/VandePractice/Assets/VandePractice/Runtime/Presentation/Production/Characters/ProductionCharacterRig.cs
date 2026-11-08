using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation.Production.Director.Stage;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Presentation.Production.Characters
{
    public static class ProductionCharacterFactory
    {
        /// <summary>Create one self-owned character. Dispose the returned rig to release its shared assets.</summary>
        public static ProductionCharacterRig Create(Transform parent, ProductionCharacterSpec spec)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));
            spec.Validate();
            var resources = new ProductionCharacterResources(spec.Palette);
            try
            {
                return new ProductionCharacterRig(parent, spec, resources, true);
            }
            catch
            {
                resources.Dispose();
                throw;
            }
        }

        /// <summary>
        /// Create a character which shares meshes and materials with its team. Dispose every rig, then resources.
        /// </summary>
        public static ProductionCharacterRig CreateShared(Transform parent, ProductionCharacterSpec spec,
            ProductionCharacterResources resources)
        {
            if (spec == null) throw new ArgumentNullException(nameof(spec));
            if (resources == null) throw new ArgumentNullException(nameof(resources));
            spec.Validate();
            return new ProductionCharacterRig(parent, spec, resources, false);
        }
    }

    /// <summary>
    /// Lightweight transform rig with original procedural equipment. It contains no AnimatorController and is
    /// driven by canonical time through ApplyPose, so replay seeking and 30/60 fps presentation remain identical.
    /// </summary>
    public sealed class ProductionCharacterRig : IDisposable
    {
        public const float ReferenceHeightMetres = 1.78f;
        /// <summary>
        /// Upper arm plus forearm as a share of stature (0.186 H + 0.146 H; Drillis &amp; Contini, Winter Table 4.1):
        /// 0.591 m for the 1.78 m reference body. The physics plans the batter's hands with this arm
        /// (src/physics/admissibility.ts BAT_HAND_REACH_M 0.57 = 0.591 m less the 20.1 mm elbow reserve), so the
        /// licensed hero, whose authored arm is 0.475 m, is lengthened to it and its hands can stay on the bat.
        /// </summary>
        public const float AnthropometricArmChainShare = 0.186f + 0.146f;
        // sim-v3 cross-platform grip contract: centres are measured down the 0.30 m handle from its cap.
        internal const float BatterTopHandGripOffsetMetres = 0.025f;
        internal const float BatterLowerHandGripOffsetMetres = 0.125f;
        // Measured VSK1 upper-arm centres relative to the shipped hero's canonical torso-top reference
        // (0, 1.42, 0). These mirror the simulation-v3 ordered-shoulder contract.
        internal const float CanonicalBatterShoulderXMetres = 0.187264f;
        internal const float CanonicalBatterShoulderYMetres = 0.013219f;
        internal const float CanonicalBatterShoulderZMetres = 0.015605f;
        private const float CanonicalBatterTorsoTopYMetres = 1.42f;
        private const float CanonicalBatterHipsLocalYMetres = 0.96f;
        internal const float BatterHipsLocalHeightMetres = CanonicalBatterHipsLocalYMetres;
        internal const float MaximumBatterGripPoleDepth = 0.15f;
        private const float BatterGripPoleTopOutward = 0.90f;
        private const float BatterGripPoleBottomOutward = 0.62f;
        private const float BatterGripPoleTopAddressDown = 0.72f;
        private const float BatterGripPoleBottomAddressDown = 1.05f;
        private const float BatterGripPoleStrokeDown = 0.58f;
        private const float BatterGripPoleTopDepth = 0.08f;
        private const float BatterGripPoleBottomDepth = -0.12f;
        // Canonical bat samples can travel much farther than the body should.  Let the arms and bounded scapular
        // solve close most of that distance: translating the complete athlete through the full handle delta put
        // the helmet on the bat arc and made a legal stride read as a lateral split.  The remaining ground-plane
        // reconciliation is deliberately smaller than one batting step and never changes bat authority.
        internal const float MaximumBatterSpatialRetargetMetres = 0.42f;
        internal const float BatterSpatialRetargetFraction = 1f;
        // Reaching for a handle is a turn around the planted body axis, not a 62-degree bend of the spine toward
        // the hands.  These caps are used only as yaw; pitch and roll stay wholly in the authored stroke.
        internal const float MaximumBatterSpineReachDegrees = 12f;
        internal const float MaximumBatterChestReachDegrees = 7f;
        private const float MaximumBatterBodyFrameShoulderYawDegrees = 3f;
        internal const float BatterReadyGripCameraForwardMetres = 0.016865f;
        private static readonly Vector3 BatterReadyGripCameraForwardLocalRight =
            new Vector3(0.009511567f, -0.013712896f, 0.002433611f);

        private sealed class LodBinding
        {
            public MeshFilter Filter;
            public Mesh Low;
            public Mesh High;
        }

        private readonly ProductionCharacterResources resources;
        private readonly bool ownsResources;
        private readonly bool castShadows;
        private readonly bool keeperStandingUpToStumps;
        private readonly ProductionCharacterResourceLoader resourceLoader;
        private readonly Transform[] joints = new Transform[(int)ProductionCharacterJoint.Count];
        private readonly List<GameObject> mediumParts = new List<GameObject>(24);
        private readonly List<GameObject> highParts = new List<GameObject>(32);
        private readonly List<Renderer> renderers = new List<Renderer>(64);
        private readonly List<LodBinding> lodBindings = new List<LodBinding>(18);
        private readonly Dictionary<string, Transform> namedParts =
            new Dictionary<string, Transform>(StringComparer.Ordinal);
        private readonly ProductionCharacterPose restPose = new ProductionCharacterPose();
        private readonly ProductionCharacterPose secondaryPose = new ProductionCharacterPose();
        private readonly Quaternion[] batterRecoverySourceRotations =
            new Quaternion[(int)ProductionCharacterJoint.Count];
        private readonly Quaternion[] batterRecoveryTargetRotations =
            new Quaternion[(int)ProductionCharacterJoint.Count];
        private readonly Quaternion[] batterSupportLegPoseRotations = new Quaternion[10];
        private Quaternion[] batterNoShotHeroSourceRotations;
        private Vector3[] batterNoShotHeroSourcePositions;
        private GameObject rootObject;
        private Transform motionRoot;
        private Transform releaseAnchor;
        private Transform batRoot;
        private Vector3 batDefaultLocalPosition;
        private Quaternion batDefaultLocalRotation;
        private ProductionBatVisual batVisual;
        private ProductionBakedCharacterMesh bakedCharacter;
        private ProductionHeroReferenceMotionLayer heroReferenceLayer;
        private ProductionCharacterMotion heroReferenceMotion;
        private float heroReferenceNormalizedTime;
        private bool heroReferenceActive;
        private ProductionCharacterDetail detail;
        private float presentationDistanceMetres;
        private Vector3 batterRecoverySourceRoot;
        private Vector3 batterRecoveryTargetRoot;
        // The same poses without the Director's life (UNITY-E2): the recovery interpolates between these and adds the life of the frame.
        private readonly Quaternion[] batterRecoverySourceBase = new Quaternion[(int)ProductionCharacterJoint.Count];
        private readonly Quaternion[] batterRecoveryTargetBase = new Quaternion[(int)ProductionCharacterJoint.Count];
        private Vector3 batterRecoverySourceBaseRoot;
        private Vector3 batterRecoveryTargetBaseRoot;
        private Vector3 batterRecoverySourceGrip;
        private Vector3 batterRecoveryTargetGrip;
        private Quaternion batterRecoverySourceBatRotation = Quaternion.identity;
        private Quaternion batterRecoveryTargetBatRotation = Quaternion.identity;
        private ProductionBatterFootwork batterRecoveryFootwork;
        private bool batterRecoveryPrepared;
        private bool batterNoShotHeroBlendPrepared;
        private float canonicalBatterCrouchMetres;
        private bool canonicalBatterBodyFrameValid;
        private float canonicalBatterBodyFrameAlignmentWeight = 1f;
        private Vector3 canonicalBatterStanceWorld;
        private Vector3 canonicalBatterTorsoTopWorld;
        private Vector3 canonicalBatterHeadCentreWorld;
        private bool canonicalBatterAlignedShoulderFrameValid;
        private Vector3 canonicalBatterAlignedShoulderMidpointWorld;
        private bool capturingBatterPostureBaseline;
        private bool batterPostureAnchorsValid;
        private Vector3 batterPostureLeftFootAnchor;
        private Vector3 batterPostureRightFootAnchor;
        private Quaternion batterPostureLeftFootRotation = Quaternion.identity;
        private Quaternion batterPostureRightFootRotation = Quaternion.identity;
        private bool disposed;

        internal ProductionCharacterRig(Transform parent, ProductionCharacterSpec spec,
            ProductionCharacterResources resources, bool ownsResources,
            ProductionCharacterResourceLoader resourceLoader = null)
        {
            this.resources = resources;
            this.ownsResources = ownsResources;
            castShadows = spec.CastShadows;
            keeperStandingUpToStumps = spec.KeeperStandingUpToStumps;
            this.resourceLoader = resourceLoader;
            Role = spec.Role;
            Handedness = spec.Handedness;
            HeightMetres = spec.HeightMetres;
            resources.Acquire();
            try
            {
                Build(parent);
                SetDetail(spec.Detail);
                ApplyDefaultPose();
            }
            catch
            {
                if (bakedCharacter != null) bakedCharacter.Dispose();
                bakedCharacter = null;
                if (batVisual != null) batVisual.Dispose();
                batVisual = null;
                if (rootObject != null) ProductionCharacterResources.DestroyOwned(rootObject);
                resources.Release();
                throw;
            }
        }

        public ProductionCharacterRole Role { get; }
        public ProductionCharacterHandedness Handedness { get; }

        /// <summary>
        /// The handedness used by the code-authored batter stroke and its blends. Stance, stroke, bat parent, ordered
        /// grip roles and visible hero now share this single anatomical label; the world boundary performs the one
        /// required reflection. The retired opposite-label bridge changed bat parents at stroke phase zero, producing a
        /// 0.52 m address-to-stroke toe discontinuity and nonlinear canonical/recovery reconciliation.
        /// </summary>
        /// <summary>
        /// A batter carrying his bat in one hand (non-striker clips and both batters while locomoting: bat.grip is the
        /// hand that holds it). Only the bottom hand is solved onto the handle; the free arm keeps the clip's own pose.
        /// </summary>
        internal bool BatterOneHandCarry { get; set; }

        internal ProductionCharacterHandedness PoseHandedness => Handedness;

        public float HeightMetres { get; }
        public ProductionCharacterDetail Detail => detail;
        public bool IsDisposed => disposed;
        public Transform Root => disposed ? null : rootObject.transform;
        public Transform Bat => disposed ? null : batRoot;
        public Transform ReleaseHandAnchor => disposed ? null : releaseAnchor;
        /// <summary>The root offset the last applied pose put on the motion root (local to Root): a hand-over source.</summary>
        internal Vector3 PoseRootOffset => disposed ? Vector3.zero : motionRoot.localPosition;

        /// <summary>True when the visible body is the complete hero skeleton (the foot lock's leg IK needs it).</summary>
        internal bool HasCompleteHero => !disposed && bakedCharacter != null && bakedCharacter.UsesCompleteHeroBundle;

        /// <summary>
        /// Plants the visible hero's ankles on world targets (ProductionFootLock), keeping each foot's rotation; the
        /// legs only (two-bone IK from the hips), any role. Presentation only.
        /// </summary>
        internal void PlantHeroFeetOn(Vector3 leftAnkle, Vector3 rightAnkle)
        {
            if (!HasCompleteHero) return;
            bakedCharacter.PlantHeroBatterFeet(leftAnkle, rightAnkle,
                bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootLeft),
                bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootRight));
        }
        public int RendererCount => disposed ? 0 : renderers.Count;
        public bool UsesBakedMesh => !disposed && bakedCharacter != null;
        public ProductionCharacterMeshSource BakedMeshSource => disposed || bakedCharacter == null
            ? ProductionCharacterMeshSource.None
            : bakedCharacter.Source;
        public int BakedHighVertexCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.HighVertexCount;
        public int BakedLowVertexCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.LowVertexCount;
        public int BakedHighTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.HighTriangleCount;
        public int BakedLowTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.LowTriangleCount;
        public int BakedDistantPremiumTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.DistantPremiumTriangleCount;
        public int BakedDistantBalancedTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.DistantBalancedTriangleCount;
        public int BakedActiveTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.ActiveTriangleCount;
        /// <summary>
        /// Diagnostic sum of every currently enabled renderer/submesh on this character. This reports the shipped
        /// selection truthfully; it is not a device-performance or tier-budget certification.
        /// </summary>
        public int ActiveTotalTriangleCount
        {
            get
            {
                if (disposed) return 0;
                var total = 0;
                for (var index = 0; index < renderers.Count; index++)
                {
                    var renderer = renderers[index];
                    if (renderer == null || !renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                    Mesh mesh = null;
                    var skinned = renderer as SkinnedMeshRenderer;
                    if (skinned != null) mesh = skinned.sharedMesh;
                    else
                    {
                        var filter = renderer.GetComponent<MeshFilter>();
                        if (filter != null) mesh = filter.sharedMesh;
                    }
                    if (mesh == null) continue;
                    for (var subMesh = 0; subMesh < mesh.subMeshCount; subMesh++)
                        total = checked(total + (int)(mesh.GetIndexCount(subMesh) / 3));
                }
                return total;
            }
        }
        public int HeroBoneCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.HeroBoneCount;
        public int HeroLiveBowlerTriangleCount => disposed || bakedCharacter == null
            ? 0
            : bakedCharacter.HeroLiveBowlerTriangleCount;
        internal SkinnedMeshRenderer HeroSkinnedRenderer =>
            disposed || bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle
                ? null
                : bakedCharacter.Renderer;
        internal SkinnedMeshRenderer HeroGearSkinnedRenderer =>
            disposed || bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle
                ? null
                : bakedCharacter.GearRenderer;
        public float PresentationDistanceMetres => disposed ? 0f : presentationDistanceMetres;
        public Vector3 BatSweetSpotWorld
        {
            get
            {
                ThrowIfDisposed();
                if (batVisual == null) throw new InvalidOperationException("This character has no bat.");
                return batRoot.TransformPoint(batVisual.SweetSpotLocal);
            }
        }

        public Vector3 BatToeWorld
        {
            get
            {
                ThrowIfDisposed();
                RequireBatter();
                return batRoot.TransformPoint(
                    new Vector3(0f, -CricketPropDimensions.TotalBatLength, 0f));
            }
        }

        /// <summary>The visible skeleton when the licensed hero is active, else the canonical driver (evidence).</summary>
        internal bool VisibleHeroSkeletonActive =>
            !disposed && bakedCharacter != null && bakedCharacter.UsesCompleteHeroBundle;

        /// <summary>The visible hero skeleton (arm tests and builder evidence), else null.</summary>
        internal ProductionHeroSkeletonInstance VisibleHeroSkeleton =>
            VisibleHeroSkeletonActive ? bakedCharacter.HeroSkeleton : null;

        internal Vector3 VisibleJointWorldPosition(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            return VisibleHeroSkeletonActive ? bakedCharacter.HeroJointWorldPosition(joint) : Joint(joint).position;
        }

        internal Quaternion VisibleJointWorldRotation(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            return VisibleHeroSkeletonActive ? bakedCharacter.HeroJointWorldRotation(joint) : Joint(joint).rotation;
        }

        public Vector3 HeroJointWorldPosition(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return bakedCharacter.HeroJointWorldPosition(joint);
        }

        public Vector3 HeroJointLocalPosition(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return bakedCharacter.HeroJointLocalPosition(joint);
        }

        public Vector3 HeroJointAuthoredLocalPosition(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return bakedCharacter.HeroJointAuthoredLocalPosition(joint);
        }

        internal Vector3 HeroJointAuthoredWorldPosition(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return bakedCharacter.HeroJointAuthoredWorldPosition(joint);
        }

        public Vector3 HeroHandWorldPosition(bool left)
        {
            return HeroJointWorldPosition(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
        }

        internal Vector3 HeroCanonicalTorsoTopWorld
        {
            get
            {
                ThrowIfDisposed();
                RequireBatter();
                return motionRoot.TransformPoint(new Vector3(0f, CanonicalBatterTorsoTopYMetres, 0f));
            }
        }

        internal Vector3 HeroCanonicalShoulderContractWorld(bool left)
        {
            ThrowIfDisposed();
            RequireBatter();
            var offset = new Vector3(
                left ? CanonicalBatterShoulderXMetres : -CanonicalBatterShoulderXMetres,
                CanonicalBatterShoulderYMetres,
                CanonicalBatterShoulderZMetres);
            return HeroCanonicalTorsoTopWorld + motionRoot.TransformVector(offset);
        }

        internal float HeroBatterArmUsableReach(bool left)
        {
            ThrowIfDisposed();
            RequireBatter();
            return HeroArmMaximumReach(left);
        }

        public Vector3 HeroBatterGripTargetWorld(bool left)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (batRoot == null) throw new InvalidOperationException("This character has no bat.");
            var topIsLeft = Handedness == ProductionCharacterHandedness.Right;
            // The law-scale handle is 0.30 m. Keep the glove centres 100 mm apart, with the top centre 25 mm
            // below the cap and the lower centre 125 mm below it. This preserves two independently
            // readable gloves while leaving the shorter licensed arm chain to reach through articulated shoulder
            // motion rather than wrist translation.
            var offset = left == topIsLeft
                ? BatterTopHandGripOffsetMetres
                : BatterLowerHandGripOffsetMetres;
            return batRoot.position + batRoot.TransformDirection(Vector3.down).normalized * offset;
        }

        /// <summary>
        /// Deterministic elbow bend plane in the animated chest frame.  X opens each elbow away from the sternum,
        /// Y keeps the address below the shoulder line, and the tightly bounded Z term distinguishes the rear
        /// bottom arm from the top arm without recreating the former 0.82 m root-forward bias.
        /// </summary>
        internal static Vector3 BatterGripPoleChestLocal(
            bool left,
            bool bottomIsLeft,
            float addressWeight)
        {
            if (float.IsNaN(addressWeight) || float.IsInfinity(addressWeight))
                throw new ArgumentOutOfRangeException(nameof(addressWeight));
            var amount = Mathf.Clamp01(addressWeight);
            var bottomArm = left == bottomIsLeft;
            // A symmetric pole put both elbow centres on the same horizontal rail in the locked camera.  The
            // resulting arm chains technically cleared the helmet but still looked assembled: the top forearm
            // cut across the abdomen while the bottom forearm disappeared behind the joined gloves. Give the top
            // arm the open, slightly higher front-elbow plane of a relaxed guard; fold the bottom arm lower and
            // closer to the ribcage. Their downward bias converges to the restrained stroke value as the bat rises
            // while the small role-specific outward/depth distinction keeps the two chains independently legible.
            var outward = bottomArm ? BatterGripPoleBottomOutward : BatterGripPoleTopOutward;
            var addressDown = bottomArm
                ? BatterGripPoleBottomAddressDown
                : BatterGripPoleTopAddressDown;
            var down = Mathf.Lerp(BatterGripPoleStrokeDown, addressDown, amount);
            var depth = bottomArm ? BatterGripPoleBottomDepth : BatterGripPoleTopDepth;
            if (Mathf.Abs(depth) > MaximumBatterGripPoleDepth)
                throw new InvalidOperationException("The batter grip pole exceeds its anatomical depth bound.");
            return new Vector3(
                left ? outward : -outward,
                -down,
                depth);
        }

        /// <summary>
        /// Measured mirrored translation which gives the ready handle camera clearance in the complete breathing
        /// address. The former 16 mm vector missed the locked view by 0.816 mm; this 16.865 mm vector supplies
        /// 0.860 mm along that phase's camera axis while its component orthogonal to the neutral hand basis cancels
        /// first-order bat-toe height drift. Using only hand-local Z would require roughly 130 mm because that axis
        /// is almost lateral in the side-on address. Canonical playback remains unaffected because
        /// SetCanonicalBatPose always overwrites the bat's complete world pose.
        /// </summary>
        internal static Vector3 BatterReadyGripCameraForwardLocalOffset(
            ProductionCharacterHandedness handedness)
        {
            if (!Enum.IsDefined(typeof(ProductionCharacterHandedness), handedness))
                throw new ArgumentOutOfRangeException(nameof(handedness));
            var value = BatterReadyGripCameraForwardLocalRight;
            if (handedness == ProductionCharacterHandedness.Left) value.x = -value.x;
            return value;
        }

        public Transform Joint(ProductionCharacterJoint joint)
        {
            ThrowIfDisposed();
            var index = (int)joint;
            if (index < 0 || index >= joints.Length) throw new ArgumentOutOfRangeException(nameof(joint));
            return joints[index];
        }

        public Transform FindPart(string name)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(name)) return null;
            Transform value;
            return namedParts.TryGetValue(name, out value) ? value : null;
        }

        public void ApplyPose(ProductionCharacterPose pose)
        {
            ThrowIfDisposed();
            if (pose == null) throw new ArgumentNullException(nameof(pose));
            heroReferenceActive = false;
            heroReferenceMotion = ProductionCharacterMotion.Stand;
            heroReferenceNormalizedTime = 0f;
            ApplyPoseInternal(pose);
        }

        /// <summary>
        /// A pose already placed in the world by its caller (TRACKB's anticipation, placed exactly as the web): the
        /// physics body-frame alignment must not move it away from the bat it holds (with a result accepted before
        /// the physics bat starts, that alignment shifted the body up to ~0.37 m from the pack's bat and the hand IK
        /// flipped an elbow: the 169-degree forearm pop). The physics stroke's own poses still align.
        /// </summary>
        internal bool PlacedPose
        {
            get => placedPackPose;
            set => placedPackPose = value;
        }

        private bool placedPackPose;

        // ---- The face-and-life Director (UNITY-E2): the life pass and the head pass ------------------------------------------------
        //
        // The life pass (breath, hip roll, posture, twist, and the root's sway) is part of every pose this rig applies: ApplyPoseInternal adds
        // it to the driver joints right after the pose is assigned and BEFORE the hero is synchronized, so every later solve (the planted feet,
        // the arms' IK to the bat, the hand coupling) works from the body that is breathing and the feet stay where they landed. It is a no-op
        // (bit for bit) unless the stage has set a life that is not zero: the quiet windows and Reduced Motion are zero. The head pass runs LAST
        // on the finished bones (DirectorHeadPass, from the world), through VisibleHeadBones.

        private DirectorLife directedLife;
        private int poseSerial;

        /// <summary>Counts the poses and hero synchronizations this rig has applied: the head pass undoes its turn only while it has not changed.</summary>
        internal int PoseSerial => poseSerial;
        private Quaternion lifeHips = Quaternion.identity;
        private Quaternion lifeSpine = Quaternion.identity;
        private Quaternion lifeChest = Quaternion.identity;
        private Vector3 lifeRoot;
        private bool lifeApplied;

        /// <summary>The Director's life for this rig, set by the stage each drawn frame (null or inactive: the rig draws as it always did).</summary>
        internal DirectorLife DirectedLife
        {
            get => directedLife;
            set => directedLife = value;
        }

        /// <summary>True when the pose applied last carries the Director's life (builder evidence).</summary>
        internal bool DirectedLifeApplied => lifeApplied;

        /// <summary>
        /// The bones the camera sees the head with: the hero skeleton's chest, neck and head when the rig has the complete hero, else the
        /// driver joints (which then carry the visible body). False for a rig that cannot be directed.
        /// </summary>
        internal bool TryGetVisibleHeadBones(out Transform chest, out Transform neck, out Transform head)
        {
            chest = neck = head = null;
            if (disposed) return false;
            if (HasCompleteHero)
            {
                var skeleton = bakedCharacter.HeroSkeleton;
                if (skeleton == null) return false;
                chest = skeleton.BoneOf(ProductionCharacterJoint.Chest);
                neck = skeleton.BoneOf(ProductionCharacterJoint.Neck);
                head = skeleton.BoneOf(ProductionCharacterJoint.Head);
            }
            else
            {
                chest = joints[(int)ProductionCharacterJoint.Chest];
                neck = joints[(int)ProductionCharacterJoint.Neck];
                head = joints[(int)ProductionCharacterJoint.Head];
            }
            return chest != null && neck != null && head != null;
        }

        /// <summary>
        /// Adds the Director's life to the driver joints and the motion root (after a pose has been assigned to them) and remembers what it
        /// added, so that a pose captured from the joints (the dead-ball recovery's) can be taken back to the pose without it.
        /// </summary>
        private void ApplyDirectedLifeToDrivers()
        {
            var life = directedLife;
            if (life == null || !life.Active)
            {
                lifeApplied = false;
                lifeHips = lifeSpine = lifeChest = Quaternion.identity;
                lifeRoot = Vector3.zero;
                return;
            }
            var mirrored = Handedness == ProductionCharacterHandedness.Left;
            life.ApplyRotations(joints[(int)ProductionCharacterJoint.Hips], joints[(int)ProductionCharacterJoint.Spine],
                joints[(int)ProductionCharacterJoint.Chest], mirrored);
            // what was added to each bone (bone * offset): the offsets the life composed once for the frame
            lifeHips = life.HipsOffset(mirrored);
            lifeSpine = life.SpineOffset(mirrored);
            lifeChest = life.ChestOffset(mirrored);
            lifeRoot = life.RootShift(rootObject.transform.localScale.x, mirrored);
            motionRoot.localPosition += lifeRoot;
            lifeApplied = true;
        }

        /// <summary>Takes the life this rig last applied out of a captured driver pose (rotations by joint index, and the motion root's local position).</summary>
        private void StripDirectedLife(Quaternion[] rotations, ref Vector3 root)
        {
            if (!lifeApplied) return;
            rotations[(int)ProductionCharacterJoint.Hips] *= Quaternion.Inverse(lifeHips);
            rotations[(int)ProductionCharacterJoint.Spine] *= Quaternion.Inverse(lifeSpine);
            rotations[(int)ProductionCharacterJoint.Chest] *= Quaternion.Inverse(lifeChest);
            root -= lifeRoot;
        }

        /// <summary>Copies a captured driver pose into <paramref name="into"/> and takes the life this rig last applied out of the copy (a copy only when there is none).</summary>
        private void CaptureRecoveryBase(Quaternion[] captured, Quaternion[] into, Vector3 root, out Vector3 baseRoot)
        {
            for (var index = 0; index < captured.Length; index++) into[index] = captured[index];
            baseRoot = root;
            StripDirectedLife(into, ref baseRoot);
        }

        private void ApplyPoseWithHeroReference(
            ProductionCharacterPose pose,
            ProductionCharacterMotion motion,
            float normalizedTime,
            bool applyBatterNeckClearance = true)
        {
            if (pose == null) throw new ArgumentNullException(nameof(pose));
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));
            heroReferenceMotion = motion;
            heroReferenceNormalizedTime = Mathf.Clamp01(normalizedTime);
            heroReferenceActive = heroReferenceLayer != null;
            ApplyPoseInternal(pose, applyBatterNeckClearance);
        }

        private void ApplyPoseInternal(
            ProductionCharacterPose pose,
            bool applyBatterNeckClearance = true)
        {
            poseFrame++;
            poseSerial++;
            motionRoot.localPosition = pose.RootOffset;
            AlignCanonicalBatterBodyFrameOnGround();
            // Posture is an explicit per-result channel, not an accumulating transform. Restore the authored hip
            // anchor before every deterministic sample, then articulate the requested crouch from that pose.
            joints[(int)ProductionCharacterJoint.Hips].localPosition =
                new Vector3(0f, CanonicalBatterHipsLocalYMetres, 0f);
            for (var index = 0; index < joints.Length; index++)
                joints[index].localRotation = pose.Rotations[index];
            // The Director's life: after the pose, before the hero is synchronized and before every foot and arm solve.
            ApplyDirectedLifeToDrivers();
            if (batRoot != null) batRoot.localRotation = pose.BatRotation;
            batterPostureAnchorsValid = false;
            if (Role == ProductionCharacterRole.Batter && !placedPackPose &&
                canonicalBatterCrouchMetres > 0f && bakedCharacter != null)
            {
                // Capture the visible hero's own authored ankle anchors before bending the fallback driver legs.
                // Every later synchronization can then restore those exact anchors after its deterministic reset.
                capturingBatterPostureBaseline = true;
                try
                {
                    SynchronizeHeroPose(applyBatterNeckClearance: applyBatterNeckClearance);
                }
                finally
                {
                    capturingBatterPostureBaseline = false;
                }
                batterPostureLeftFootAnchor =
                    bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
                batterPostureRightFootAnchor =
                    bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
                batterPostureLeftFootRotation =
                    bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootLeft);
                batterPostureRightFootRotation =
                    bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootRight);
                batterPostureAnchorsValid = true;
            }
            ApplyCanonicalBatterPostureToDrivers();
            SynchronizeHeroPose(applyBatterNeckClearance: applyBatterNeckClearance);
        }

        private void SynchronizeHeroPose(
            float batterGripWeight = 1f,
            bool applyBatterNeckClearance = true)
        {
            poseSerial++;
            if (bakedCharacter == null) return;
            if (heroReferenceLayer != null && Role == ProductionCharacterRole.Batter && batRoot != null)
            {
                // The world camera's side follows the physics-to-Unity reflection (ProceduralPracticeWorld):
                // a right-hander's off side, and so the rear camera, is at world -x.
                // A "Left" rig presents a canonical right-hander (ProceduralPracticeWorld.RigHandednessFor), whose
                // world, and so the rear camera on his off side, is reflected to -x.
                var mirror = ProceduralPracticeWorld.WorldReflectionFor(
                    Handedness == ProductionCharacterHandedness.Left ? "right" : "left");
                var lateral = rootObject.transform.position.x;
                var creaseOffset = 9.25f - rootObject.transform.position.z;
                var cameraPosition = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraPosition(lateral, creaseOffset, mirror);
                var cameraTarget = Vande.Practice.Presentation.ProceduralPracticeWorld
                    .BatterCameraTarget(lateral);
                heroReferenceLayer.SetBatterBatClearanceSegment(
                    batRoot.position,
                    batRoot.TransformPoint(new Vector3(
                        0f, -CricketPropDimensions.TotalBatLength, 0f)),
                    HeroBatterGripTargetWorld(true),
                    HeroBatterGripTargetWorld(false),
                    cameraPosition,
                    Quaternion.LookRotation(cameraTarget - cameraPosition, Vector3.up));
            }
            var previousNeckClearance = heroReferenceLayer != null &&
                                        heroReferenceLayer.BatterNeckClearanceEnabled;
            var previousNeckClearanceWeight = heroReferenceLayer != null
                ? heroReferenceLayer.BatterNeckClearanceWeight
                : 1f;
            if (heroReferenceLayer != null)
            {
                heroReferenceLayer.BatterNeckClearanceEnabled = applyBatterNeckClearance;
                heroReferenceLayer.BatterNeckClearanceWeight = Mathf.Clamp01(batterGripWeight);
            }
            try
            {
                bakedCharacter.SynchronizeHeroPose(
                    joints,
                    heroReferenceActive ? heroReferenceLayer : null,
                    heroReferenceMotion,
                    heroReferenceNormalizedTime);
                if (Role == ProductionCharacterRole.Batter &&
                    canonicalBatterBodyFrameValid &&
                    heroReferenceMotion == ProductionCharacterMotion.BatterStroke)
                {
                    // The physics shoulder span (right minus left, front-on) is +x; reflected into Unity it is -x, and
                    // this rig's mirrored labels negate it once more: +x in the rig's own label convention.
                    bakedCharacter.AlignHeroBatterShoulderFrameYaw(
                        Vector3.right,
                        MaximumBatterBodyFrameShoulderYawDegrees,
                        canonicalBatterBodyFrameAlignmentWeight);
                    // The yaw pivots at spine04, so a leaning follow-through head swings with it (up to ~5 mm past the
                    // 0.278 m head-over-base envelope on the 5c golden). Re-apply that envelope last, as the
                    // reference layer already does after its own neck-clearance pass.
                    if (heroReferenceActive && heroReferenceLayer != null)
                        bakedCharacter.ReapplyHeroBatterBalanceEnvelope(
                            heroReferenceLayer,
                            heroReferenceNormalizedTime);
                    // batterBodyFrame.torsoTop is already the final postured physics frame. Reconstruct its encoded
                    // pre-crouch height from the canonical 1.42 m torso reference; this stays stable while tests/replay
                    // sample posture zero and the resolved crouch, and the posture pass below removes it exactly once.
                    var bodyFrameCrouch = Mathf.Clamp(
                        CanonicalBatterTorsoTopYMetres - canonicalBatterTorsoTopWorld.y,
                        0f,
                        (float)BridgeConstants.MaxBatterCrouchMetres);
                    bakedCharacter.AlignHeroBatterShoulderFrameHeight(
                        canonicalBatterTorsoTopWorld.y +
                        CanonicalBatterShoulderYMetres +
                        bodyFrameCrouch,
                        canonicalBatterBodyFrameAlignmentWeight);
                }
                AlignVisibleBatterShouldersToCanonicalFrameOnGround();
                if (Role == ProductionCharacterRole.Batter && !placedPackPose &&
                    canonicalBatterCrouchMetres > 0f &&
                    !capturingBatterPostureBaseline)
                {
                    if (!batterPostureAnchorsValid)
                        throw new InvalidOperationException(
                            "Batter posture requires authored visible-foot anchors for this sampled pose.");
                    bakedCharacter.ApplyHeroBatterPosture(
                        canonicalBatterCrouchMetres,
                        batterPostureLeftFootAnchor,
                        batterPostureRightFootAnchor,
                        batterPostureLeftFootRotation,
                        batterPostureRightFootRotation);
                    // The cached frame is pre-grip evidence. Refresh only its vertical component after the explicit
                    // crouch channel has lowered the complete upper body; X/Z remain the exact ground-plane mapping
                    // captured above and no hand/bat transform participates.
                    var posturedLeftShoulder = bakedCharacter.HeroJointWorldPosition(
                        ProductionCharacterJoint.UpperArmLeft);
                    var posturedRightShoulder = bakedCharacter.HeroJointWorldPosition(
                        ProductionCharacterJoint.UpperArmRight);
                    canonicalBatterAlignedShoulderMidpointWorld.y =
                        (posturedLeftShoulder.y + posturedRightShoulder.y) * 0.5f;
                }
            }
            finally
            {
                if (heroReferenceLayer != null)
                {
                    heroReferenceLayer.BatterNeckClearanceEnabled = previousNeckClearance;
                    heroReferenceLayer.BatterNeckClearanceWeight = previousNeckClearanceWeight;
                }
            }
            if (Role == ProductionCharacterRole.Batter && batRoot != null)
            {
                // A placed pack pose (TRACKB's anticipation) is authored with the hands on the bat: keep its own elbow
                // planes. The chest poles crossed the compact backlift's cocked arms (a 90-degree forearm step at
                // 0.167 s, UNITY-2 r1); the stroke's code-authored poses keep the chest poles.
                ApplyHeroBatterGripIkNow(batterGripWeight, keepCurrentElbowPlanes: placedPackPose);
            }
            else if ((Role == ProductionCharacterRole.PaceBowler ||
                      Role == ProductionCharacterRole.SpinBowler) &&
                     releaseAnchor != null &&
                     (heroReferenceMotion == ProductionCharacterMotion.PaceBowling ||
                      heroReferenceMotion == ProductionCharacterMotion.SpinBowling))
            {
                var deliveryIsLeft = Handedness == ProductionCharacterHandedness.Left;
                bakedCharacter.ApplyHeroDeliveryArmIk(
                    deliveryIsLeft,
                    releaseAnchor.position,
                    releaseAnchor.rotation,
                    rootObject.transform.forward + rootObject.transform.right *
                    (deliveryIsLeft ? 0.42f : -0.42f));
            }
            PlaceCapOnHero();
        }

        // ---- UNITY-7 D: the spin bowler's cap sits on the hero's head ------------------------------------------------------
        //
        // The cap is a procedural prop the hero keeps (ProductionHeroPresentationPolicy); it was parented to the DRIVER rig's head
        // joint, which is 1 to 6.5 cm from the visible hero's head and turns differently (the hero's retarget and reach: 1.1, 2.4,
        // 1.4, 4.5, 4.7 and 6.5 cm at the run-up, gather, release, two follow-through frames and the walk back). Its parts now hang
        // from a follower that takes the hero head's pose after every hero pose, with the parts' offsets from the head unchanged.

        private Transform capFollower;

        /// <summary>Builder seam (A/B in one build): false leaves the cap on the driver's head, as before.</summary>
        internal bool CapFollowsHeroEnabled { get; set; } = true;

        private void AttachCapToHero()
        {
            if (capFollower != null || joints == null) return;
            var head = joints[(int)ProductionCharacterJoint.Head];
            var parts = new List<Transform>();
            foreach (var renderer in rootObject.GetComponentsInChildren<Renderer>(true))
                if (renderer.transform.parent == head && renderer.gameObject.name.StartsWith("SpinBowlerCap", StringComparison.Ordinal))
                    parts.Add(renderer.transform);
            if (parts.Count == 0) return;
            var follower = new GameObject("SpinBowlerCapFollower").transform;
            follower.SetParent(rootObject.transform, false);
            foreach (var part in parts)
            {
                var position = part.localPosition;
                var rotation = part.localRotation;
                var scale = part.localScale;
                part.SetParent(follower, false);
                part.localPosition = position;
                part.localRotation = rotation;
                part.localScale = scale;
            }
            capFollower = follower;
            PlaceCapOnHero();
        }

        /// <summary>
        /// UNITY-E2: the Director's head pass has turned the hero's neck and head after the pose was applied; the cap, the one prop that hangs from the
        /// head, takes the head's pose again (it sat on the head the pose left, which the pass has since turned).
        /// </summary>
        internal void FollowHeadPassWithCap()
        {
            PlaceCapOnHero();
        }

        private void PlaceCapOnHero()
        {
            if (capFollower == null) return;
            if (CapFollowsHeroEnabled)
                capFollower.SetPositionAndRotation(
                    VisibleJointWorldPosition(ProductionCharacterJoint.Head),
                    VisibleJointWorldRotation(ProductionCharacterJoint.Head));
            else
            {
                // The builder seam: the driver's head, where the cap was parented before UNITY-7.
                var driverHead = joints[(int)ProductionCharacterJoint.Head];
                capFollower.SetPositionAndRotation(driverHead.position, driverHead.rotation);
            }
        }

        public void SampleAndApply(ProductionCharacterMotion motion, float normalizedTime)
        {
            ThrowIfDisposed();
            ResetBatToCharacterGrip();
            var sampled = Role == ProductionCharacterRole.Batter && motion == ProductionCharacterMotion.BatterStroke
                ? PoseHandedness
                : Handedness;
            EnsureBatParent(sampled);
            ResetBatToCharacterGrip();
            ProductionCharacterMotionSampler.SampleInto(motion, normalizedTime, sampled, restPose);
            ApplyPoseWithHeroReference(restPose, motion, normalizedTime);
            if (Role == ProductionCharacterRole.Batter &&
                (motion == ProductionCharacterMotion.BatterStance ||
                 motion == ProductionCharacterMotion.BatterStroke))
            {
                CoupleBatterHandsToCurrentBat(1f);
            }
        }

        /// <summary>
        /// Latches the simulation-v3 static posture channel. The amount is applied by every subsequent sampled
        /// pose. It never translates the character root: both ankle anchors stay at their uncrouched authored
        /// positions while the articulated leg chains lower the pelvis and complete upper body.
        /// </summary>
        public void SetCanonicalBatterPosture(float crouchMetres)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(crouchMetres) || float.IsInfinity(crouchMetres) ||
                crouchMetres < 0f ||
                crouchMetres > (float)BridgeConstants.MaxBatterCrouchMetres)
                throw new ArgumentOutOfRangeException(nameof(crouchMetres));
            canonicalBatterCrouchMetres = crouchMetres;
            if (crouchMetres <= 0f) batterPostureAnchorsValid = false;
        }

        internal float CanonicalBatterCrouchMetres => canonicalBatterCrouchMetres;

        /// <summary>
        /// Latches the final physics-owned planted body frame for one canonical result. The frame is already in
        /// Unity's handed world coordinates when it arrives here; this rig never mirrors it again. Every sampled
        /// footwork pose aligns its torso reference on the ground plane before visible-foot posture and hand IK are
        /// solved. The root object remains the separate authoritative batterRootOffset, so this cannot become a
        /// second grip-derived gameplay root.
        /// </summary>
        internal void SetCanonicalBatterBodyFrame(
            Vector3 stanceWorld,
            Vector3 torsoTopWorld,
            Vector3 headCentreWorld)
        {
            ThrowIfDisposed();
            RequireBatter();
            RequireFiniteBodyAnchor(stanceWorld, nameof(stanceWorld));
            RequireFiniteBodyAnchor(torsoTopWorld, nameof(torsoTopWorld));
            RequireFiniteBodyAnchor(headCentreWorld, nameof(headCentreWorld));
            canonicalBatterStanceWorld = stanceWorld;
            canonicalBatterTorsoTopWorld = torsoTopWorld;
            canonicalBatterHeadCentreWorld = headCentreWorld;
            canonicalBatterBodyFrameValid = true;
            canonicalBatterAlignedShoulderFrameValid = false;
        }

        internal void ClearCanonicalBatterBodyFrame()
        {
            ThrowIfDisposed();
            RequireBatter();
            canonicalBatterBodyFrameValid = false;
            canonicalBatterBodyFrameAlignmentWeight = 1f;
            canonicalBatterStanceWorld = Vector3.zero;
            canonicalBatterTorsoTopWorld = Vector3.zero;
            canonicalBatterHeadCentreWorld = Vector3.zero;
            canonicalBatterAlignedShoulderFrameValid = false;
            canonicalBatterAlignedShoulderMidpointWorld = Vector3.zero;
        }

        internal bool CanonicalBatterBodyFrameValid => canonicalBatterBodyFrameValid;

        /// <summary>
        /// How much of the body frame's shoulder yaw and height the hero takes (1 = all, the default). The world's
        /// batter carry eases it in from the pose on screen, so result acceptance never turns or lifts the torso in
        /// one frame (wedge phase 3: the 5 mm pelvis residual left by the ground-plane carry).
        /// </summary>
        internal void SetCanonicalBatterBodyFrameAlignmentWeight(float weight)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(weight) || float.IsInfinity(weight))
                throw new ArgumentOutOfRangeException(nameof(weight));
            canonicalBatterBodyFrameAlignmentWeight = Mathf.Clamp01(weight);
        }

        internal float CanonicalBatterBodyFrameAlignmentWeight => canonicalBatterBodyFrameAlignmentWeight;
        internal Vector3 CanonicalBatterStanceWorld => canonicalBatterStanceWorld;
        internal Vector3 CanonicalBatterTorsoTopTargetWorld => canonicalBatterTorsoTopWorld;
        internal Vector3 CanonicalBatterHeadCentreWorld => canonicalBatterHeadCentreWorld;
        internal bool CanonicalBatterAlignedShoulderFrameValid =>
            canonicalBatterAlignedShoulderFrameValid;
        internal Vector3 CanonicalBatterAlignedShoulderMidpointWorld =>
            canonicalBatterAlignedShoulderMidpointWorld;

        private void AlignCanonicalBatterBodyFrameOnGround()
        {
            if (Role != ProductionCharacterRole.Batter || !canonicalBatterBodyFrameValid || placedPackPose) return;
            var sampledTorsoTop = HeroCanonicalTorsoTopWorld;
            var groundDelta = canonicalBatterTorsoTopWorld - sampledTorsoTop;
            groundDelta.y = 0f;
            motionRoot.position += groundDelta;
        }

        private void AlignVisibleBatterShouldersToCanonicalFrameOnGround()
        {
            if (Role != ProductionCharacterRole.Batter || !canonicalBatterBodyFrameValid || placedPackPose ||
                bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                return;
            // Physics admits the bat against shoulders reconstructed from the final torso frame in world pitch
            // coordinates. The licensed skeleton's shoulder centres are authored behind its local torso origin
            // after the live 180-degree batting yaw, and footwork/reference motion can turn that line further.
            // Map the sampled, pre-grip shoulder midpoint to the physics frame once on the ground plane. This is a
            // body-frame placement channel: it never reads the bat/grip, never changes Y, and never mutates the
            // authoritative gameplay root. Scapular/arm IK remains free to articulate from this aligned source.
            var leftShoulder = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.UpperArmLeft);
            var rightShoulder = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.UpperArmRight);
            var sampledMidpoint = (leftShoulder + rightShoulder) * 0.5f;
            var desiredMidpoint = canonicalBatterTorsoTopWorld +
                                  Vector3.forward * CanonicalBatterShoulderZMetres;
            var groundDelta = desiredMidpoint - sampledMidpoint;
            groundDelta.y = 0f;
            motionRoot.position += groundDelta;
            canonicalBatterAlignedShoulderMidpointWorld = sampledMidpoint + groundDelta;
            canonicalBatterAlignedShoulderFrameValid = true;
        }

        private static void RequireFiniteBodyAnchor(Vector3 value, string parameterName)
        {
            if (float.IsNaN(value.x) || float.IsInfinity(value.x) ||
                float.IsNaN(value.y) || float.IsInfinity(value.y) ||
                float.IsNaN(value.z) || float.IsInfinity(value.z))
                throw new ArgumentOutOfRangeException(parameterName);
        }

        public void SampleBowling(float normalizedTime, ProductionBowlingCueProfile cue)
        {
            ThrowIfDisposed();
            if (Role != ProductionCharacterRole.PaceBowler &&
                Role != ProductionCharacterRole.SpinBowler)
                throw new InvalidOperationException("Only a bowler can sample a bowling cue.");
            if ((Role == ProductionCharacterRole.PaceBowler &&
                 cue.Motion != ProductionCharacterMotion.PaceBowling) ||
                (Role == ProductionCharacterRole.SpinBowler &&
                 cue.Motion != ProductionCharacterMotion.SpinBowling))
                throw new ArgumentException("The bowling cue does not match this bowler.", nameof(cue));
            ProductionCharacterMotionSampler.SampleBowlingInto(
                cue.Motion,
                normalizedTime,
                Handedness,
                cue,
                restPose);
            ApplyPoseWithHeroReference(restPose, cue.Motion, normalizedTime);
        }

        public void SampleBatterStroke(float normalizedTime, ProductionBatterFootwork footwork)
        {
            ThrowIfDisposed();
            RequireBatter();
            ResetBatToCharacterGrip();
            EnsureBatParent(PoseHandedness);
            ResetBatToCharacterGrip();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                normalizedTime, PoseHandedness, footwork, restPose);
            ApplyPoseWithHeroReference(restPose, ProductionCharacterMotion.BatterStroke, normalizedTime);
            CoupleBatterHandsToCurrentBat(1f);
        }

        /// <summary>
        /// Where the code-authored stroke puts the bat at `normalizedTime`, in the world, without drawing it: the driver
        /// joints are posed as SampleBatterStroke would, and the bat's cap, toe and face normal are read. The visible hero
        /// and the hands are not touched, so this is cheap, and the caller poses the rig for the frame afterwards (the
        /// touch-down stroke's hitting pose, ProductionTouchDownBat).
        /// </summary>
        internal void LegacyStrokeBatPose(float normalizedTime, ProductionBatterFootwork footwork,
            out Vector3 grip, out Vector3 toe, out Vector3 face)
        {
            LegacyStrokeBatPose(normalizedTime, footwork, Quaternion.identity, out grip, out toe, out face);
        }

        /// <summary>
        /// The same, with `extraLocalRotation` (the swing's elevation, direction and power turns, applied as the provisional
        /// stroke does: the bat's local rotation times it) put on the bat first.
        /// </summary>
        internal void LegacyStrokeBatPose(float normalizedTime, ProductionBatterFootwork footwork, Quaternion extraLocalRotation,
            out Vector3 grip, out Vector3 toe, out Vector3 face)
        {
            ThrowIfDisposed();
            RequireBatter();
            ResetBatToCharacterGrip();
            EnsureBatParent(PoseHandedness);
            ResetBatToCharacterGrip();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                normalizedTime, PoseHandedness, footwork, restPose);
            motionRoot.localPosition = restPose.RootOffset;
            joints[(int)ProductionCharacterJoint.Hips].localPosition =
                new Vector3(0f, CanonicalBatterHipsLocalYMetres, 0f);
            for (var index = 0; index < joints.Length; index++)
                joints[index].localRotation = restPose.Rotations[index];
            batRoot.localRotation = restPose.BatRotation * extraLocalRotation;
            grip = batRoot.position;
            toe = grip + batRoot.TransformDirection(Vector3.down) * (float)BridgeConstants.CanonicalBatLengthMetres;
            face = batRoot.forward;
        }

        /// <summary>
        /// Reconciles provisional body motion into canonical playback without a one-frame pop. This blends only
        /// presentation poses; the canonical bat trace remains exact and is applied afterwards by the caller.
        /// </summary>
        public void SampleBatterStrokeBlend(
            float fromNormalizedTime,
            ProductionBatterFootwork fromFootwork,
            float toNormalizedTime,
            ProductionBatterFootwork toFootwork,
            float weight,
            bool applyBatterNeckClearance = true)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(weight) || float.IsInfinity(weight))
                throw new ArgumentOutOfRangeException(nameof(weight));
            var amount = Mathf.Clamp01(weight);
            ResetBatToCharacterGrip();
            EnsureBatParent(PoseHandedness);
            ResetBatToCharacterGrip();
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                fromNormalizedTime, PoseHandedness, fromFootwork, restPose);
            ProductionCharacterMotionSampler.SampleBatterStrokeInto(
                toNormalizedTime, PoseHandedness, toFootwork, secondaryPose);
            restPose.RootOffset = Vector3.Lerp(restPose.RootOffset, secondaryPose.RootOffset, amount);
            restPose.BatRotation = Quaternion.Slerp(
                restPose.BatRotation, secondaryPose.BatRotation, amount);
            for (var index = 0; index < restPose.Rotations.Length; index++)
            {
                restPose.Rotations[index] = Quaternion.Slerp(
                    restPose.Rotations[index], secondaryPose.Rotations[index], amount);
            }
            ApplyPoseWithHeroReference(
                restPose,
                ProductionCharacterMotion.BatterStroke,
                Mathf.Lerp(fromNormalizedTime, toNormalizedTime, amount),
                applyBatterNeckClearance);
            CoupleBatterHandsToCurrentBat(1f, applyBatterNeckClearance);
        }

        private Quaternion[] heroTransitionRotations;
        private Vector3[] heroTransitionPositions;
        private Quaternion[] heroTransitionWorldRotations;
        private Vector3[] heroTransitionWorldPositions;
        private bool[] heroTransitionTopLevel;
        private bool heroTransitionCaptured;
        private Vector3 heroTransitionSourceLeftElbow;
        private Vector3 heroTransitionSourceRightElbow;
        private Vector3 heroTransitionTargetLeftElbow;
        private Vector3 heroTransitionTargetRightElbow;
        private Vector3 heroTransitionPreviousLeftElbow;
        private Vector3 heroTransitionPreviousRightElbow;
        private float heroTransitionPreviousArmWeight;
        private bool heroTransitionArmTargetCaptured;

        /// <summary>What the last visible-hero grip solve was given (builder evidence only).</summary>
        internal struct HeroGripSolveRecord
        {
            /// <summary>0 none, 1 two hands with the chest poles, 2 two hands keeping the displayed elbows, 3 one-hand carry, 4 one-hand carry keeping the elbow.</summary>
            public int Path;
            public float GripWeight;
            public Vector3 LeftTarget, RightTarget;
            public Vector3 LeftElbowIn, RightElbowIn;
            public Vector3 LeftPole, RightPole;
            /// <summary>The elbows the pole was built from (path 2): the source and target of the handover, and its weights.</summary>
            public Vector3 LeftSourceElbow, RightSourceElbow, LeftTargetElbow, RightTargetElbow;
            public float PreviousTransitionWeight, TransitionWeight;
            public bool TransitionCaptured, ArmTargetCaptured;
        }

        private HeroGripSolveRecord lastHeroGripSolve;
        internal HeroGripSolveRecord LastHeroGripSolveForEvidence => lastHeroGripSolve;

        /// <summary>Builder evidence only: records every hero grip solve's inputs (off in production; a character without a hero skeleton cannot be asked its elbows).</summary>
        internal bool RecordGripSolvesForEvidence { get; set; }

        // ---- The end of a handover: the elbow planes ---------------------------------------------------------------
        //
        // Each arm is solved onto the bat with a pole: the direction its elbow bends towards, square to the line from the
        // shoulder to the grip. Across a pose-source handover the solve keeps the plane the arm had shown (the source) and
        // turns it to the plane the new pose source has (the target) as the handover's weight rises, so the arm does not
        // change side in a frame (BlendResolvedElbowPoles). The target it turns to is the solved arm's own last output, not
        // the pose source's elbow (the solve that poses a frame reads the target captured the frame before, which is the elbow
        // after that frame's first solve), so the arm stays on the plane it began with as long as the handover lasts and the
        // pose source's own plane arrives all at once, a frame after the handover ends: the visible forearm turned 104.9 degrees
        // and the upper arm 86 in one frame at t = 0.583 s in both grounded cases (UNITY-3 U-D 3; 6,293 degrees/s against the
        // 1,800 cap) while the driver arms moved 4.5 degrees.
        //
        // Reading the pose source's elbow as the target instead (tried) cures that and makes thin-edge worse: the plane of the
        // pack pose's elbow about the line to the bat's grip swings by 130 degrees in a few frames while the stroke is fast, and
        // the arm followed it (a forearm step of 111 degrees at t = 0.48 s). A rate limit on the plane (tried) held the arm
        // away from the pose source's plane and flipped the forearm's roll near the run start (162 degrees). The old handover
        // is kept as it was; only its end is changed: the arm leaves the plane it was held on for the pose source's over
        // ElbowReleaseFrames frames.
        //
        // UNITY-4 (the web's round 6 to 8): the arms are no longer swing-only turns of whatever pose the driver put them in, which
        // inherited their twist from it and could flip the forearm's roll 100 to 165 degrees across two overlapping handovers.
        // ProductionHeroArm solves each gripping arm as a hinge (the forearm about its own X, within the section 9 elbow range, the
        // upper arm's twist within its range) and remembers the upper arm's rotation from the frame before: while frames come
        // within 50 ms of each other it keeps the arm nearest to where it was and eases back to the pole's plane at 180
        // degrees a second. The poles above are the plane it eases to, so a pole that jumps (a handover's end) moves the arm 3
        // degrees a frame, not all at once. ElbowHandoverFixEnabled false solves from the pole alone, as a seek does.

        /// <summary>The presented frames over which an arm leaves the plane a handover held it on for the pose source's plane (0.13 s at 60 Hz).</summary>
        internal const int ElbowReleaseFrames = 8;

        /// <summary>Measurement seam: false puts the one-frame release of the handover's elbow plane back and solves each arm from its pole alone (A/B in one build).</summary>
        internal bool ElbowHandoverFixEnabled { get; set; } = true;

        /// <summary>
        /// The clock (seconds) of the frame being posed, advanced by the world each tick: the arms' elbow memory (ProductionHeroArm)
        /// follows a plane from the frame before only when that frame is at most 50 ms earlier. NaN (a rig posed without a world,
        /// a seek): each arm is solved from its pole alone.
        /// </summary>
        internal double PresentationClockSeconds { get; set; } = double.NaN;

        /// <summary>What the arms remember of the frame on screen (a copy), or null without a hero.</summary>
        internal ProductionArmMemory[] CaptureElbowMemory() => bakedCharacter?.HeroSkeleton?.CaptureArmMemory();

        /// <summary>Puts back what CaptureElbowMemory took.</summary>
        internal void RestoreElbowMemory(ProductionArmMemory[] captured) => bakedCharacter?.HeroSkeleton?.RestoreArmMemory(captured);

        /// <summary>Forgets what the arms remember of their last frame (a new script or a seek).</summary>
        internal void ResetElbowMemory()
        {
            var heroSkeleton = bakedCharacter?.HeroSkeleton;
            if (heroSkeleton != null) heroSkeleton.ResetArmMemory();
            governedHasNow = false;
            governedHasPrevious = false;
            governedStamp = double.NaN;
        }

        /// <summary>The batter's arms stood still since their last solve (a held follow-through): see ProductionHeroSkeletonInstance.HoldArmMemory.</summary>
        internal void HoldArmMemory(double frameSeconds)
        {
            ThrowIfDisposed();
            if (bakedCharacter != null && bakedCharacter.HeroSkeleton != null) bakedCharacter.HeroSkeleton.HoldArmMemory(PresentationClockSeconds, frameSeconds);
        }

        /// <summary>
        /// Forgets only the torso governor's last frame (the arms keep their elbow memory): the root frame it was measured in is gone because
        /// the root itself was moved or turned to another (a result moment's clip took the striker over on its own anchor), so the apparent
        /// change of every torso bone's root-relative rotation is the root's, not the torso's.
        /// </summary>
        internal void ResetTorsoRateGovernor()
        {
            governedHasNow = false;
            governedHasPrevious = false;
            governedStamp = double.NaN;
        }

        // ---- The visible torso's angular speed (MOTION-SPEC section 9: hips, spine and chest 600, neck and head 720 degrees/s) ----
        //
        // A pose-source change (the anticipation to a stroke) is a pose difference of up to ~100 degrees at the hips and chest;
        // the inertial blend (ProceduralPracticeWorld.FinishStrikerFrame) spreads it over 0.2 s, which is 2x the chest's cap. The
        // governor holds each torso bone of the displayed hero to its cap from the frame before (the web's easeLean and
        // limitHead do the same for the trunk's lean and the head), so a hand-over reaches the new pose a few frames later
        // instead of faster than a spine can turn. It works on rotations relative to the rig's root (a heading change is the
        // gait's, not the torso's), from the hips down the chain, and only in a run of frames (each within 50 ms of the one
        // before): a seek or a first frame shows the pose as it is.

        private static readonly ProductionCharacterJoint[] GovernedTorsoJoints =
        {
            ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest,
            ProductionCharacterJoint.Neck, ProductionCharacterJoint.Head
        };

        /// <summary>Section 9's angular speed caps for the governed torso joints (degrees per second).</summary>
        internal static readonly float[] GovernedTorsoCapsDegreesPerSecond = { 600f, 600f, 600f, 720f, 720f };

        private readonly Quaternion[] governedPrevious = new Quaternion[5];
        private readonly Quaternion[] governedNow = new Quaternion[5];
        private bool governedHasPrevious;
        private bool governedHasNow;
        private double governedStamp = double.NaN;
        private double governedDelta;

        /// <summary>Measurement seam: false lets the torso turn as fast as the pose asks (A/B in one build).</summary>
        internal bool TorsoRateGovernorEnabled { get; set; } = true;

        /// <summary>
        /// Holds the visible torso (hips, spine, chest, neck, head) to its section 9 angular speed from the frame before; returns
        /// whether a bone was held back (the arms are then solved again by the caller, to stay on the bat). Runs on
        /// PresentationClockSeconds; none (NaN): nothing is held.
        /// </summary>
        internal bool GovernHeroTorsoRates()
        {
            var skeleton = VisibleHeroSkeleton;
            var clock = PresentationClockSeconds;
            if (skeleton == null || !TorsoRateGovernorEnabled || double.IsNaN(clock))
            {
                governedHasNow = false;
                governedStamp = double.NaN;
                return false;
            }
            if (clock != governedStamp)
            {
                var delta = clock - governedStamp;
                governedHasPrevious = governedHasNow && delta > 0.0 && delta <= ProductionHeroArm.MemorySeconds;
                governedDelta = delta;
                governedStamp = clock;
                Array.Copy(governedNow, governedPrevious, governedNow.Length);
                governedHasNow = false;
            }
            var rootRotation = rootObject.transform.rotation;
            var inverseRoot = Quaternion.Inverse(rootRotation);
            var held = false;
            for (var index = 0; index < GovernedTorsoJoints.Length; index++)
            {
                var bone = skeleton.BoneOf(GovernedTorsoJoints[index]);
                var relative = inverseRoot * bone.rotation;
                if (governedHasPrevious)
                {
                    var most = GovernedTorsoCapsDegreesPerSecond[index] * (float)governedDelta;
                    if (Quaternion.Angle(governedPrevious[index], relative) > most)
                    {
                        relative = Quaternion.RotateTowards(governedPrevious[index], relative, most);
                        bone.rotation = rootRotation * relative;
                        held = true;
                    }
                }
                governedNow[index] = relative;
            }
            governedHasNow = true;
            if (held) torsoGovernorEngagements++;
            return held;
        }

        private int torsoGovernorEngagements;

        /// <summary>The frames the torso governor held a bone back so far (builder evidence only: it is 0 when the pose sources never ask for more than a spine can turn).</summary>
        internal int TorsoGovernorEngagementsForEvidence => torsoGovernorEngagements;

        // The release counts presented frames (ApplyPoseInternal), not solves: a frame solves the arms two or three times.
        private int poseFrame;
        private bool elbowReleaseActive;
        private int elbowReleaseFrame;
        private int elbowReleaseStamp = -1;
        private readonly Vector3[] elbowReleaseOffset = new Vector3[2];

        /// <summary>
        /// An elbow whose plane (about the line from the shoulder to the grip) is `fraction` of the way from the plane of
        /// `fromOffset` (an elbow's offset from its shoulder when the handover ended) to the plane of `to`, the pose
        /// source's elbow, by the shorter way; `to` itself when the planes are within 5 degrees.
        /// </summary>
        private Vector3 ElbowPartwayPlane(bool left, Vector3 gripTarget, Vector3 fromOffset, Vector3 to, float fraction)
        {
            var shoulder = bakedCharacter.HeroJointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var reach = gripTarget - shoulder;
            if (reach.sqrMagnitude < 1e-6f) return to;
            var axis = reach.normalized;
            var from = fromOffset - axis * Vector3.Dot(fromOffset, axis);
            var toSide = to - shoulder;
            var along = axis * Vector3.Dot(toSide, axis);
            toSide -= along;
            if (from.sqrMagnitude < 1e-6f || toSide.sqrMagnitude < 1e-6f) return to;
            var angle = Vector3.SignedAngle(from, toSide, axis);
            if (Mathf.Abs(angle) < 5f) return to;
            return shoulder + along + Quaternion.AngleAxis(angle * Mathf.Clamp01(fraction), axis) * from.normalized * toSide.magnitude;
        }

        /// <summary>
        /// The visible hero's two-hand grip IK onto the bat as it is now (address/stroke poles, one-hand carry).
        /// SynchronizeHeroPose runs it last; a hand-over blend re-runs it after blending so the hands stay on the bat.
        /// </summary>
        internal void ApplyHeroBatterGripIkNow(
            float batterGripWeight = 1f,
            bool keepCurrentElbowPlanes = false,
            float transitionWeight = 1f)
        {
            if (bakedCharacter == null || Role != ProductionCharacterRole.Batter || batRoot == null) return;
            // The arms' elbow memory runs on the world's presentation clock (frames of one clock value are one frame).
            var heroSkeleton = bakedCharacter.HeroSkeleton;
            if (heroSkeleton != null)
            {
                heroSkeleton.ArmClockSeconds = PresentationClockSeconds;
                heroSkeleton.ArmMemoryEnabled = ElbowHandoverFixEnabled;
            }
            // A batting address needs the elbows to fold down and away from the face.  The previous pole was
            // dominated by root.forward, so the analytic bend plane put both elbows in front of the sternum;
            // from the locked rear-shoulder camera those forearms crossed the helmet even though the wrists
            // finished on the low handle.  Bias the poles anatomically outward and down, with only a small
            // down-pitch component.  This remains presentation-only: the bat, trace and gameplay transforms
            // are still read-only inputs to the hero solve.
            // The address needs substantially more downward bend than a raised backlift. Blend out of the
            // low address plane during the opening stroke so t=0 stays continuous while contact/follow-through
            // retain the authored cricket action.
            var addressWeight = BatterGripAddressWeight();
            // The elbow plane belongs to the animated chest, not the presentation root.  Root-forward poles
            // stayed fixed while the guard turned and made the rear arm cut back across the torso.  These local
            // vectors mirror exactly once with handedness and keep the rear-depth component within 0.15.
            Vector3 leftPole;
            Vector3 rightPole;
            BatterGripPoles(addressWeight, out leftPole, out rightPole);
            var leftGripTarget = HeroBatterGripTargetWorld(true);
            var rightGripTarget = HeroBatterGripTargetWorld(false);
            var topIsLeftHand = Handedness == ProductionCharacterHandedness.Right;
            if (RecordGripSolvesForEvidence && bakedCharacter.UsesCompleteHeroBundle)
            {
                lastHeroGripSolve = new HeroGripSolveRecord
                {
                    Path = BatterOneHandCarry ? (keepCurrentElbowPlanes ? 4 : 3) : (keepCurrentElbowPlanes ? 2 : 1),
                    GripWeight = batterGripWeight,
                    LeftTarget = leftGripTarget,
                    RightTarget = rightGripTarget,
                    LeftElbowIn = bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.ForearmLeft),
                    RightElbowIn = bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.ForearmRight),
                    LeftPole = leftPole,
                    RightPole = rightPole,
                    PreviousTransitionWeight = heroTransitionPreviousArmWeight,
                    TransitionWeight = transitionWeight,
                    TransitionCaptured = heroTransitionCaptured,
                    ArmTargetCaptured = heroTransitionArmTargetCaptured
                };
                lastHeroGripSolve.LeftSourceElbow = heroTransitionCaptured
                    ? heroTransitionPreviousLeftElbow
                    : lastHeroGripSolve.LeftElbowIn;
                lastHeroGripSolve.RightSourceElbow = heroTransitionCaptured
                    ? heroTransitionPreviousRightElbow
                    : lastHeroGripSolve.RightElbowIn;
                lastHeroGripSolve.LeftTargetElbow = heroTransitionArmTargetCaptured
                    ? heroTransitionTargetLeftElbow
                    : lastHeroGripSolve.LeftElbowIn;
                lastHeroGripSolve.RightTargetElbow = heroTransitionArmTargetCaptured
                    ? heroTransitionTargetRightElbow
                    : lastHeroGripSolve.RightElbowIn;
            }
            if (BatterOneHandCarry)
            {
                var holderIsLeft = !topIsLeftHand;
                var holderTarget = holderIsLeft ? leftGripTarget : rightGripTarget;
                var holderPole = holderIsLeft ? leftPole : rightPole;
                if (keepCurrentElbowPlanes)
                {
                    var currentElbow = bakedCharacter.HeroJointWorldPosition(holderIsLeft
                        ? ProductionCharacterJoint.ForearmLeft
                        : ProductionCharacterJoint.ForearmRight);
                    var sourceElbow = heroTransitionCaptured
                        ? holderIsLeft ? heroTransitionSourceLeftElbow : heroTransitionSourceRightElbow
                        : currentElbow;
                    var targetElbow = heroTransitionArmTargetCaptured
                        ? holderIsLeft ? heroTransitionTargetLeftElbow : heroTransitionTargetRightElbow
                        : currentElbow;
                    bakedCharacter.ApplyHeroBatterCarryGripIkPreservingResolvedElbow(
                        holderIsLeft,
                        holderTarget,
                        batRoot.rotation,
                        heroTransitionCaptured
                            ? holderIsLeft ? heroTransitionPreviousLeftElbow : heroTransitionPreviousRightElbow
                            : sourceElbow,
                        targetElbow,
                        holderPole,
                        heroTransitionPreviousArmWeight,
                        transitionWeight,
                        batterGripWeight);
                    if (transitionWeight < 1f && heroTransitionCaptured && heroTransitionArmTargetCaptured)
                    {
                        if (holderIsLeft)
                            heroTransitionPreviousLeftElbow = bakedCharacter.HeroJointWorldPosition(
                                ProductionCharacterJoint.ForearmLeft);
                        else
                            heroTransitionPreviousRightElbow = bakedCharacter.HeroJointWorldPosition(
                                ProductionCharacterJoint.ForearmRight);
                        heroTransitionPreviousArmWeight = Mathf.Clamp01(transitionWeight);
                    }
                }
                else
                {
                    bakedCharacter.ApplyHeroBatterCarryGripIk(
                        holderIsLeft,
                        holderTarget,
                        batRoot.rotation,
                        holderPole,
                        batterGripWeight);
                }
                return;
            }
            if (keepCurrentElbowPlanes)
            {
                // Preserve the actually displayed elbow branch across a pose-source handover. The bounded shoulder
                // reach runs inside this solve; its final pole is therefore reconstructed from these resolved world
                // elbow points after reach, rather than guessed in the old shoulder frame.
                var currentLeftElbow = bakedCharacter.HeroJointWorldPosition(
                    ProductionCharacterJoint.ForearmLeft);
                var currentRightElbow = bakedCharacter.HeroJointWorldPosition(
                    ProductionCharacterJoint.ForearmRight);
                var sourceLeft = heroTransitionCaptured ? heroTransitionPreviousLeftElbow : currentLeftElbow;
                var sourceRight = heroTransitionCaptured ? heroTransitionPreviousRightElbow : currentRightElbow;
                var targetLeft = heroTransitionArmTargetCaptured ? heroTransitionTargetLeftElbow : currentLeftElbow;
                var targetRight = heroTransitionArmTargetCaptured ? heroTransitionTargetRightElbow : currentRightElbow;
                if (ElbowHandoverFixEnabled && elbowReleaseActive && transitionWeight >= 1f)
                {
                    // The frames after a handover: the arm leaves the plane it was held on for the pose source's (see above).
                    if (elbowReleaseStamp != poseFrame)
                    {
                        elbowReleaseStamp = poseFrame;
                        elbowReleaseFrame++;
                    }
                    if (elbowReleaseFrame > ElbowReleaseFrames) elbowReleaseActive = false;
                    else
                    {
                        var fraction = elbowReleaseFrame / (float)ElbowReleaseFrames;
                        targetLeft = sourceLeft = ElbowPartwayPlane(true, leftGripTarget, elbowReleaseOffset[0], currentLeftElbow, fraction);
                        targetRight = sourceRight = ElbowPartwayPlane(false, rightGripTarget, elbowReleaseOffset[1], currentRightElbow, fraction);
                    }
                }
                bakedCharacter.ApplyHeroBatterGripIkPreservingResolvedElbows(
                    leftGripTarget,
                    rightGripTarget,
                    batRoot.rotation,
                    sourceLeft,
                    sourceRight,
                    targetLeft,
                    targetRight,
                    leftPole,
                    rightPole,
                    heroTransitionPreviousArmWeight,
                    transitionWeight,
                    batterGripWeight);
                if (transitionWeight < 1f && heroTransitionCaptured && heroTransitionArmTargetCaptured)
                {
                    heroTransitionPreviousLeftElbow = bakedCharacter.HeroJointWorldPosition(
                        ProductionCharacterJoint.ForearmLeft);
                    heroTransitionPreviousRightElbow = bakedCharacter.HeroJointWorldPosition(
                        ProductionCharacterJoint.ForearmRight);
                    heroTransitionPreviousArmWeight = Mathf.Clamp01(transitionWeight);
                }
                return;
            }
            bakedCharacter.ApplyHeroBatterGripIk(
                leftGripTarget,
                rightGripTarget,
                batRoot.rotation,
                leftPole,
                rightPole,
                batterGripWeight);
        }

        private void BatterGripPoles(float addressWeight, out Vector3 leftPole, out Vector3 rightPole)
        {
            var bottomIsLeft = Handedness == ProductionCharacterHandedness.Left;
            var chest = joints[(int)ProductionCharacterJoint.Chest];
            leftPole = chest.TransformDirection(BatterGripPoleChestLocal(true, bottomIsLeft, addressWeight));
            rightPole = chest.TransformDirection(BatterGripPoleChestLocal(false, bottomIsLeft, addressWeight));
        }

        private float BatterGripAddressWeight()
        {
            if (heroReferenceMotion != ProductionCharacterMotion.BatterStroke) return 1f;
            var progress = Mathf.Clamp01(
                heroReferenceNormalizedTime /
                ProductionCharacterMotionSampler.BatterBacklift);
            progress = progress * progress * (3f - 2f * progress);
            return 1f - progress;
        }

        /// <summary>
        /// Captures the visible hero skeleton as the source of an inertial transition (a pack clip handing over to the
        /// code-authored stroke, for example). ApplyHeroTransitionBlend then eases the newly posed skeleton out of it.
        /// </summary>
        internal void CaptureHeroTransitionSource()
        {
            ThrowIfDisposed();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
            {
                heroTransitionCaptured = false;
                return;
            }
            var bones = bakedCharacter.Renderer.bones;
            if (heroTransitionRotations == null || heroTransitionRotations.Length != bones.Length)
            {
                heroTransitionRotations = new Quaternion[bones.Length];
                heroTransitionPositions = new Vector3[bones.Length];
                heroTransitionWorldRotations = new Quaternion[bones.Length];
                heroTransitionWorldPositions = new Vector3[bones.Length];
                heroTransitionTopLevel = new bool[bones.Length];
                var set = new HashSet<Transform>(bones);
                for (var index = 0; index < bones.Length; index++)
                    heroTransitionTopLevel[index] = bones[index] != null && !set.Contains(bones[index].parent);
            }
            for (var index = 0; index < bones.Length; index++)
            {
                heroTransitionRotations[index] = bones[index].localRotation;
                heroTransitionPositions[index] = bones[index].localPosition;
                heroTransitionWorldRotations[index] = bones[index].rotation;
                heroTransitionWorldPositions[index] = bones[index].position;
            }
            heroTransitionSourceLeftElbow = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.ForearmLeft);
            heroTransitionSourceRightElbow = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.ForearmRight);
            heroTransitionPreviousLeftElbow = heroTransitionSourceLeftElbow;
            heroTransitionPreviousRightElbow = heroTransitionSourceRightElbow;
            heroTransitionPreviousArmWeight = 0f;
            heroTransitionArmTargetCaptured = false;
            heroTransitionCaptured = true;
        }

        // The hero's shoulder girdles, arms, hands and fingers (VSK1 bones 13 to 64): the bones a grip solve puts on the bat.
        private const int HeroArmBoneFirst = 13;
        private const int HeroArmBoneLast = 64;

        /// <summary>
        /// weight 0 shows the captured source, 1 the current pose. Presentation only. With `bodyOnly` the shoulder girdles, arms,
        /// hands and fingers are not blended (the caller solves the grip again on the blended body, so they are on the bat at
        /// the pose source's own elbow planes and no blended plane is held): a hand-over of the body alone (UNITY-5 F2).
        /// </summary>
        internal void ApplyHeroTransitionBlend(float weight, bool bodyOnly = false)
        {
            ThrowIfDisposed();
            if (!heroTransitionCaptured || bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle) return;
            var amount = Mathf.Clamp01(weight);
            if (bodyOnly)
            {
                if (amount >= 1f) return;
                var bodyBones = bakedCharacter.Renderer.bones;
                for (var index = 0; index < bodyBones.Length; index++)
                {
                    if (index >= HeroArmBoneFirst && index <= HeroArmBoneLast) continue;
                    if (heroTransitionTopLevel[index])
                    {
                        bodyBones[index].SetPositionAndRotation(
                            Vector3.Lerp(heroTransitionWorldPositions[index], bodyBones[index].position, amount),
                            Quaternion.Slerp(heroTransitionWorldRotations[index], bodyBones[index].rotation, amount));
                        continue;
                    }
                    bodyBones[index].localRotation = Quaternion.Slerp(heroTransitionRotations[index], bodyBones[index].localRotation,
                        amount);
                    bodyBones[index].localPosition = Vector3.Lerp(heroTransitionPositions[index], bodyBones[index].localPosition,
                        amount);
                }
                return;
            }
            if (amount >= 1f)
            {
                // The handover ends: the arms leave the plane it held them on over the next frames (see ElbowReleaseFrames).
                if (ElbowHandoverFixEnabled && heroTransitionArmTargetCaptured)
                {
                    elbowReleaseOffset[0] = heroTransitionPreviousLeftElbow -
                                            bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft);
                    elbowReleaseOffset[1] = heroTransitionPreviousRightElbow -
                                            bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight);
                    elbowReleaseActive = true;
                    elbowReleaseFrame = 0;
                    elbowReleaseStamp = poseFrame;
                }
                return;
            }
            elbowReleaseActive = false;
            heroTransitionTargetLeftElbow = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.ForearmLeft);
            heroTransitionTargetRightElbow = bakedCharacter.HeroJointWorldPosition(
                ProductionCharacterJoint.ForearmRight);
            heroTransitionArmTargetCaptured = true;
            var bones = bakedCharacter.Renderer.bones;
            for (var index = 0; index < bones.Length; index++)
            {
                if (heroTransitionTopLevel[index])
                {
                    // The skeleton's top bones blend in world space: their parent (the motion root) may itself jump
                    // between the two sources, which a local blend would pass straight through.
                    bones[index].SetPositionAndRotation(
                        Vector3.Lerp(heroTransitionWorldPositions[index], bones[index].position, amount),
                        Quaternion.Slerp(heroTransitionWorldRotations[index], bones[index].rotation, amount));
                    continue;
                }
                bones[index].localRotation = Quaternion.Slerp(heroTransitionRotations[index], bones[index].localRotation,
                    amount);
                bones[index].localPosition = Vector3.Lerp(heroTransitionPositions[index], bones[index].localPosition,
                    amount);
            }
        }

        internal void BeginBatterNoShotHeroBlend()
        {
            ThrowIfDisposed();
            RequireBatter();
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
            {
                batterNoShotHeroBlendPrepared = false;
                return;
            }
            var bones = bakedCharacter.Renderer.bones;
            if (batterNoShotHeroSourceRotations == null ||
                batterNoShotHeroSourceRotations.Length != bones.Length)
            {
                batterNoShotHeroSourceRotations = new Quaternion[bones.Length];
                batterNoShotHeroSourcePositions = new Vector3[bones.Length];
            }
            for (var index = 0; index < bones.Length; index++)
            {
                batterNoShotHeroSourceRotations[index] = bones[index].localRotation;
                batterNoShotHeroSourcePositions[index] = bones[index].localPosition;
            }
            batterNoShotHeroBlendPrepared = true;
        }

        internal void ApplyBatterNoShotHeroBlend(float weight)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(weight) || float.IsInfinity(weight))
                throw new ArgumentOutOfRangeException(nameof(weight));
            if (!batterNoShotHeroBlendPrepared || bakedCharacter == null ||
                !bakedCharacter.UsesCompleteHeroBundle)
                return;
            var amount = Mathf.Clamp01(weight);
            var bones = bakedCharacter.Renderer.bones;
            for (var index = 0; index < bones.Length; index++)
            {
                bones[index].localRotation = Quaternion.Slerp(
                    batterNoShotHeroSourceRotations[index],
                    bones[index].localRotation,
                    amount);
                bones[index].localPosition = Vector3.Lerp(
                    batterNoShotHeroSourcePositions[index],
                    bones[index].localPosition,
                    amount);
            }
        }

        public void ResetBatToCharacterGrip()
        {
            ThrowIfDisposed();
            batterRecoveryPrepared = false;
            if (batRoot == null) return;
            batRoot.localPosition = batDefaultLocalPosition;
            batRoot.localRotation = batDefaultLocalRotation;
        }

        /// <summary>
        /// Keeps a presentation-only ball at the actual delivery fingertips before the canonical release marker.
        /// The caller remains responsible for detaching and handing visibility to the authoritative trace at release.
        /// </summary>
        public void AlignObjectToReleaseHand(Transform value)
        {
            ThrowIfDisposed();
            if (value == null) throw new ArgumentNullException(nameof(value));
            value.SetPositionAndRotation(releaseAnchor.position, releaseAnchor.rotation);
        }

        /// <summary>
        /// Places the single law-scale bat from the canonical TypeScript trace. The trace grip is the top of the
        /// handle, local -Y points to the toe, and local +Z is the bat-face normal used by Coach/replay.
        /// </summary>
        public void SetCanonicalBatPose(
            Vector3 grip,
            Vector3 toe,
            Vector3 faceNormal,
            float handCouplingWeight = 1f,
            bool retargetBodyToTrace = true,
            bool applyBatterNeckClearance = true)
        {
            ThrowIfDisposed();
            RequireBatter();
            batterRecoveryPrepared = false;
            if (batRoot == null) throw new InvalidOperationException("This character has no bat.");
            if (float.IsNaN(handCouplingWeight) || float.IsInfinity(handCouplingWeight))
                throw new ArgumentOutOfRangeException(nameof(handCouplingWeight));
            var blade = toe - grip;
            if (blade.sqrMagnitude <= 0.000001f)
                throw new ArgumentException("Canonical bat grip and toe must be distinct.", nameof(toe));
            var face = faceNormal;
            if (face.sqrMagnitude <= 0.000001f) face = rootObject.transform.forward;
            var up = -blade.normalized;
            face -= up * Vector3.Dot(face, up);
            if (face.sqrMagnitude <= 0.000001f)
                face = Vector3.Cross(up, rootObject.transform.right);
            var rotation = Quaternion.LookRotation(face.normalized, up);
            SetBatterBatWorldPose(
                grip,
                rotation,
                blade.normalized,
                Mathf.Clamp01(handCouplingWeight),
                retargetBodyToTrace,
                applyBatterNeckClearance);
        }

        /// <summary>
        /// Captures the final canonical body and precomputes one authored, joined finish without changing the
        /// rendered frame.  Recovery can then be sampled deterministically from that exact source instead of
        /// popping the torso back to a generic time-only pose on its first frame.
        /// </summary>
        public void BeginBatterDeadBallRecovery(
            Vector3 canonicalGrip,
            Quaternion canonicalRotation,
            ProductionBatterFootwork footwork)
        {
            ThrowIfDisposed();
            RequireBatter();
            ValidateBatterRecoveryPose(canonicalGrip, canonicalRotation, footwork);

            batterRecoveryPrepared = false;
            // The rendered support legs (the canonical frames restore them after IK). Re-synchronizing the hero below
            // without them re-solved the legs and stepped the feet 10-14 cm in one frame (TRACKB P1, wedge phase 2).
            var keepRenderedLegs = bakedCharacter != null && bakedCharacter.UsesCompleteHeroBundle;
            if (keepRenderedLegs)
                bakedCharacter.CaptureHeroBatterSupportLegPose(batterSupportLegPoseRotations);
            batterRecoverySourceRoot = motionRoot.localPosition;
            batterRecoverySourceGrip = canonicalGrip;
            batterRecoverySourceBatRotation = canonicalRotation;
            for (var index = 0; index < joints.Length; index++)
                batterRecoverySourceRotations[index] = joints[index].localRotation;
            CaptureRecoveryBase(batterRecoverySourceRotations, batterRecoverySourceBase, batterRecoverySourceRoot,
                out batterRecoverySourceBaseRoot);

            // The canonical body is held at BatterFollowThrough while the separate dead-ball beat owns the authored
            // FollowThrough-to-1 recovery. Capture that same stroke/footwork endpoint here: sampling a generic stance
            // while the visible reference layer advances a stroke clock creates a mismatched hybrid body whose head
            // and support base cannot agree. This remains presentation-only and leaves result authority untouched.
            SampleBatterStroke(1f, footwork);
            batterRecoveryTargetRoot = motionRoot.localPosition;
            batterRecoveryTargetGrip = batRoot.position;
            batterRecoveryTargetBatRotation = batRoot.rotation;
            for (var index = 0; index < joints.Length; index++)
                batterRecoveryTargetRotations[index] = joints[index].localRotation;
            CaptureRecoveryBase(batterRecoveryTargetRotations, batterRecoveryTargetBase, batterRecoveryTargetRoot,
                out batterRecoveryTargetBaseRoot);

            // Restore the exact already-rendered terminal body and bat. The first recovery sample is therefore
            // continuous even when its elapsed time is zero or a replay is seeked one frame at a time.
            motionRoot.localPosition = batterRecoverySourceRoot;
            for (var index = 0; index < joints.Length; index++)
                joints[index].localRotation = batterRecoverySourceRotations[index];
            heroReferenceMotion = ProductionCharacterMotion.BatterStroke;
            heroReferenceNormalizedTime = ProductionCharacterMotionSampler.BatterFollowThrough;
            heroReferenceActive = heroReferenceLayer != null;
            batRoot.SetPositionAndRotation(canonicalGrip, canonicalRotation);
            SynchronizeHeroPose();
            if (keepRenderedLegs)
                bakedCharacter.RestoreHeroBatterSupportLegPose(batterSupportLegPoseRotations);
            batRoot.SetPositionAndRotation(canonicalGrip, canonicalRotation);

            batterRecoveryFootwork = footwork;
            batterRecoveryPrepared = true;
        }

        /// <summary>
        /// After canonical playback has completed, resolves its held final bat into the authored balanced finish.
        /// The start pose is copied from the already-rendered terminal sample and remains exact at amount zero.
        /// This method is presentation-only and is never called while contact, trace time or scoring are active.
        /// </summary>
        public void ApplyBatterDeadBallRecovery(
            Vector3 canonicalGrip,
            Quaternion canonicalRotation,
            ProductionBatterFootwork footwork,
            float amount)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(amount) || float.IsInfinity(amount))
                throw new ArgumentOutOfRangeException(nameof(amount));
            ValidateBatterRecoveryPose(canonicalGrip, canonicalRotation, footwork);

            if (!batterRecoveryPrepared || batterRecoveryFootwork != footwork ||
                Vector3.Distance(batterRecoverySourceGrip, canonicalGrip) > 0.000001f ||
                Quaternion.Angle(batterRecoverySourceBatRotation, canonicalRotation) > 0.0001f)
            {
                BeginBatterDeadBallRecovery(canonicalGrip, canonicalRotation, footwork);
            }

            var progress = Mathf.Clamp01(amount);
            motionRoot.localPosition = Vector3.Lerp(
                batterRecoverySourceBaseRoot, batterRecoveryTargetBaseRoot, progress);
            for (var index = 0; index < joints.Length; index++)
            {
                joints[index].localRotation = Quaternion.Slerp(
                    batterRecoverySourceBase[index],
                    batterRecoveryTargetBase[index],
                    progress);
            }
            // UNITY-E2: the finish breathes (the balanced finish is held for seconds when the ball is still travelling).
            ApplyDirectedLifeToDrivers();
            heroReferenceMotion = ProductionCharacterMotion.BatterStroke;
            heroReferenceNormalizedTime = Mathf.Lerp(
                ProductionCharacterMotionSampler.BatterFollowThrough, 1f, progress);
            heroReferenceActive = heroReferenceLayer != null;
            var grip = Vector3.Lerp(
                batterRecoverySourceGrip, batterRecoveryTargetGrip, progress);
            var rotation = Quaternion.Slerp(
                batterRecoverySourceBatRotation, batterRecoveryTargetBatRotation, progress);
            SetBatterBatWorldPose(
                grip,
                rotation,
                rotation * Vector3.down,
                1f,
                retargetBodyToTrace: false,
                preserveHeroFootAnchors: true,
                // The recovery's first frame kept the exact sampled support legs and its last frame the solved ones;
                // switching between them at the first step moved the feet 10-14 cm in one frame (TRACKB P1). Hand
                // them over with the recovery instead.
                supportLegPoseWeight: 1f - progress);
        }

        private static void ValidateBatterRecoveryPose(
            Vector3 canonicalGrip,
            Quaternion canonicalRotation,
            ProductionBatterFootwork footwork)
        {
            if (!Enum.IsDefined(typeof(ProductionBatterFootwork), footwork))
                throw new ArgumentOutOfRangeException(nameof(footwork));
            if (float.IsNaN(canonicalGrip.x) || float.IsInfinity(canonicalGrip.x) ||
                float.IsNaN(canonicalGrip.y) || float.IsInfinity(canonicalGrip.y) ||
                float.IsNaN(canonicalGrip.z) || float.IsInfinity(canonicalGrip.z) ||
                float.IsNaN(canonicalRotation.x) || float.IsInfinity(canonicalRotation.x) ||
                float.IsNaN(canonicalRotation.y) || float.IsInfinity(canonicalRotation.y) ||
                float.IsNaN(canonicalRotation.z) || float.IsInfinity(canonicalRotation.z) ||
                float.IsNaN(canonicalRotation.w) || float.IsInfinity(canonicalRotation.w))
                throw new ArgumentException("Dead-ball recovery contains a non-finite bat pose.");
        }

        /// <summary>
        /// Couples both fallback hands to the same ordered handle targets used by the visible hero after an
        /// intent-only rotation. No IK result is fed back into physics, and the captured bat pose remains authority.
        /// </summary>
        public void CoupleBatterHandsToCurrentBat(
            float weight,
            bool applyBatterNeckClearance = true)
        {
            ThrowIfDisposed();
            RequireBatter();
            if (float.IsNaN(weight) || float.IsInfinity(weight))
                throw new ArgumentOutOfRangeException(nameof(weight));
            if (batRoot == null) return;
            var amount = Mathf.Clamp01(weight);
            var downHandle = batRoot.TransformDirection(Vector3.down).normalized;
            var grip = batRoot.position;
            var rotation = batRoot.rotation;
            CoupleBatterHandsToCanonicalBat(
                grip, downHandle, rotation, amount, retargetBodyToTrace: false);
            // The bat is parented to the fallback lower hand. Solving that arm may temporarily move the child;
            // restore the captured presentation pose so coupling can never become bat or gameplay authority.
            batRoot.SetPositionAndRotation(grip, rotation);
            SynchronizeHeroPose(applyBatterNeckClearance: applyBatterNeckClearance);
        }

        public void SetDetail(ProductionCharacterDetail value)
        {
            ThrowIfDisposed();
            if (!Enum.IsDefined(typeof(ProductionCharacterDetail), value))
                throw new ArgumentOutOfRangeException(nameof(value));
            detail = value;
            var showMedium = (int)value >= (int)ProductionCharacterDetail.Medium;
            var showHigh = (int)value >= (int)ProductionCharacterDetail.High;
            for (var index = 0; index < mediumParts.Count; index++) mediumParts[index].SetActive(showMedium);
            for (var index = 0; index < highParts.Count; index++) highParts[index].SetActive(showHigh);
            for (var index = 0; index < lodBindings.Count; index++)
                lodBindings[index].Filter.sharedMesh = showMedium ? lodBindings[index].High : lodBindings[index].Low;
            bakedCharacter?.SetPresentation(value, presentationDistanceMetres);

            var shadows = castShadows && value != ProductionCharacterDetail.Low;
            for (var index = 0; index < renderers.Count; index++)
            {
                renderers[index].shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderers[index].receiveShadows = shadows;
            }
        }

        /// <summary>
        /// Latches the role's actual world distance from the striker for visual LOD selection. This is presentation
        /// metadata only and never changes the canonical fielder transform, trace, collision, scoring or motion.
        /// </summary>
        public void SetPresentationDistanceMetres(float value)
        {
            ThrowIfDisposed();
            if (float.IsNaN(value) || float.IsInfinity(value) || value < 0f)
                throw new ArgumentOutOfRangeException(nameof(value));
            presentationDistanceMetres = value;
            bakedCharacter?.SetPresentation(detail, presentationDistanceMetres);
        }

        /// <summary>
        /// Explicitly opts a complete hero into its LOD0 close-up mesh. Distance never enables this state; normal
        /// live Practice remains on the role-specific bounded mesh.
        /// </summary>
        public void SetHeroCloseUp(bool value)
        {
            ThrowIfDisposed();
            bakedCharacter?.SetHeroCloseUp(value, detail, presentationDistanceMetres);
        }

        /// <summary>Diagnostics and tests only; not intended for a live-delivery update loop.</summary>
        public Bounds MeasureVisibleWorldBounds()
        {
            ThrowIfDisposed();
            var found = bakedCharacter != null;
            var bounds = found
                ? bakedCharacter.MeasureWorldBounds()
                : new Bounds(rootObject.transform.position, Vector3.zero);
            for (var index = 0; index < renderers.Count; index++)
            {
                var renderer = renderers[index];
                // MeasureWorldBounds already bakes the complete admitted candidate, including its shared eyes,
                // skinned protective gear and original bat. Re-encapsulating any of those renderers here is not merely
                // redundant: a SkinnedMeshRenderer.bounds read uses its deliberately conservative culling box,
                // which can turn a credible 1.8 m batter into a three-metre diagnostic silhouette.
                if (bakedCharacter != null &&
                    (renderer == bakedCharacter.Renderer ||
                     renderer == bakedCharacter.EyeRenderer ||
                     renderer == bakedCharacter.GearRenderer ||
                     renderer == bakedCharacter.HeroBatRenderer))
                    continue;
                if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) continue;
                if (!found)
                {
                    bounds = renderer.bounds;
                    found = true;
                }
                else bounds.Encapsulate(renderer.bounds);
            }
            return bounds;
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (bakedCharacter != null) bakedCharacter.Dispose();
            bakedCharacter = null;
            heroReferenceLayer = null;
            heroReferenceActive = false;
            if (batVisual != null) batVisual.Dispose();
            batVisual = null;
            if (rootObject != null) ProductionCharacterResources.DestroyOwned(rootObject);
            rootObject = null;
            namedParts.Clear();
            renderers.Clear();
            mediumParts.Clear();
            highParts.Clear();
            lodBindings.Clear();
            resources.Release();
            if (ownsResources) resources.Dispose();
        }

        private void Build(Transform parent)
        {
            rootObject = new GameObject("VANDE " + Role + " Production Character");
            rootObject.hideFlags = HideFlags.DontSave;
            rootObject.transform.SetParent(parent, false);
            rootObject.transform.localScale = Vector3.one * (HeightMetres / ReferenceHeightMetres);
            namedParts.Add(rootObject.name, rootObject.transform);

            var motion = new GameObject("MotionRoot");
            motion.hideFlags = HideFlags.DontSave;
            motion.transform.SetParent(rootObject.transform, false);
            motionRoot = motion.transform;
            namedParts.Add(motion.name, motionRoot);

            BuildSkeleton();
            BuildBody();
            BuildFace();
            BuildRoleEquipment();
            BuildBakedCharacterIfAvailable();
            BuildReleaseAnchor();
        }

        private void BuildBakedCharacterIfAvailable()
        {
            ProductionBakedCharacterMesh value;
            if (!ProductionBakedCharacterMesh.TryCreate(
                    Role,
                    motionRoot,
                    joints,
                    batRoot,
                    resources,
                    resourceLoader,
                    castShadows,
                    out value))
                return;

            // Preserve the complete procedural hierarchy as an inactive zero-asset fallback and attachment
            // authority. A hero batter is admitted only after body, original gear and original bat all decode, so
            // every old visible renderer (including the procedural bat) must be disabled as one transaction.
            for (var index = 0; index < renderers.Count; index++)
            {
                var renderer = renderers[index];
                if (value.UsesCompleteHeroBundle)
                {
                    renderer.enabled = ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                        Role, renderer.gameObject.name);
                }
                else if (value.RequiresEquipmentOverlay)
                {
                    if (batRoot != null && renderer.transform.IsChildOf(batRoot)) continue;
                    if (IsAnatomyPrimitive(renderer.gameObject.name) &&
                        !IsLicensedAnatomyFeatureOverlay(renderer.gameObject.name))
                        renderer.enabled = false;
                }
                else
                {
                    if (batRoot != null && renderer.transform.IsChildOf(batRoot)) continue;
                    if (Role == ProductionCharacterRole.SpinBowler &&
                        renderer.gameObject.name.StartsWith("SpinBowlerCap", StringComparison.Ordinal))
                        continue;
                    renderer.enabled = false;
                }
            }
            bakedCharacter = value;
            if (value.UsesCompleteHeroBundle && Role == ProductionCharacterRole.SpinBowler) AttachCapToHero();
            if (Role == ProductionCharacterRole.Batter)
                value.LengthenHeroArms(rootObject.transform, AnthropometricArmChainShare * ReferenceHeightMetres);
            heroReferenceLayer = value.UsesCompleteHeroBundle
                ? ProductionHeroReferenceMotionLayer.TryCreate(Role, Handedness, resourceLoader)
                : null;
            heroReferenceActive = false;
            renderers.Add(value.Renderer);
            namedParts.Add(value.Renderer.gameObject.name, value.Renderer.transform);
            if (value.EyeRenderer != null)
            {
                renderers.Add(value.EyeRenderer);
                namedParts.Add(value.EyeRenderer.gameObject.name, value.EyeRenderer.transform);
            }
            if (value.GearRenderer != null)
            {
                renderers.Add(value.GearRenderer);
                namedParts.Add(value.GearRenderer.gameObject.name, value.GearRenderer.transform);
            }
            if (value.HeroBatRenderer != null)
            {
                renderers.Add(value.HeroBatRenderer);
                namedParts.Add(value.HeroBatRenderer.gameObject.name, value.HeroBatRenderer.transform);
            }
        }

        private static bool IsAnatomyPrimitive(string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            switch (name)
            {
                case "Pelvis":
                case "LowerTorso":
                case "Chest":
                case "NeckSkin":
                case "Head":
                case "UpperArmLeft":
                case "UpperArmRight":
                case "ForearmLeft":
                case "ForearmRight":
                case "HandLeft":
                case "HandRight":
                case "ThighLeft":
                case "ThighRight":
                case "ShinLeft":
                case "ShinRight":
                case "EarLeft":
                case "EarRight":
                case "Nose":
                case "EyeWhiteLeft":
                case "EyeWhiteRight":
                case "IrisLeft":
                case "IrisRight":
                case "BrowLeft":
                case "BrowRight":
                case "Mouth":
                    return true;
                default:
                    return false;
            }
        }

        private bool IsLicensedAnatomyFeatureOverlay(string name)
        {
            // The pinned MakeHuman derivative deliberately excludes helper eye geometry. Keep VANDE's original
            // whites/irises as explicit facial features rather than shipping an eyeless licensed-path face.
            if (string.Equals(name, "EyeWhiteLeft", StringComparison.Ordinal) ||
                string.Equals(name, "EyeWhiteRight", StringComparison.Ordinal) ||
                string.Equals(name, "IrisLeft", StringComparison.Ordinal) ||
                string.Equals(name, "IrisRight", StringComparison.Ordinal))
                return true;

            if (Role == ProductionCharacterRole.Batter)
            {
                return string.Equals(name, "HandLeft", StringComparison.Ordinal) ||
                       string.Equals(name, "HandRight", StringComparison.Ordinal);
            }
            return false;
        }

        private void BuildSkeleton()
        {
            CreateJoint(ProductionCharacterJoint.Hips, null, new Vector3(0f, 0.96f, 0f));
            CreateJoint(ProductionCharacterJoint.Spine, ProductionCharacterJoint.Hips, new Vector3(0f, 0.11f, 0f));
            CreateJoint(ProductionCharacterJoint.Chest, ProductionCharacterJoint.Spine, new Vector3(0f, 0.21f, 0f));
            CreateJoint(ProductionCharacterJoint.Neck, ProductionCharacterJoint.Chest, new Vector3(0f, 0.235f, 0f));
            CreateJoint(ProductionCharacterJoint.Head, ProductionCharacterJoint.Neck, new Vector3(0f, 0.085f, 0.012f));
            CreateJoint(ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.Chest, new Vector3(0.205f, 0.18f, -0.012f));
            CreateJoint(ProductionCharacterJoint.ForearmLeft, ProductionCharacterJoint.UpperArmLeft, new Vector3(0f, -0.285f, 0f));
            CreateJoint(ProductionCharacterJoint.HandLeft, ProductionCharacterJoint.ForearmLeft, new Vector3(0f, -0.25f, 0f));
            CreateJoint(ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.Chest, new Vector3(-0.205f, 0.18f, -0.012f));
            CreateJoint(ProductionCharacterJoint.ForearmRight, ProductionCharacterJoint.UpperArmRight, new Vector3(0f, -0.285f, 0f));
            CreateJoint(ProductionCharacterJoint.HandRight, ProductionCharacterJoint.ForearmRight, new Vector3(0f, -0.25f, 0f));
            CreateJoint(ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.Hips, new Vector3(0.095f, -0.055f, 0f));
            CreateJoint(ProductionCharacterJoint.ShinLeft, ProductionCharacterJoint.ThighLeft, new Vector3(0f, -0.43f, 0f));
            CreateJoint(ProductionCharacterJoint.FootLeft, ProductionCharacterJoint.ShinLeft, new Vector3(0f, -0.415f, 0f));
            CreateJoint(ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.Hips, new Vector3(-0.095f, -0.055f, 0f));
            CreateJoint(ProductionCharacterJoint.ShinRight, ProductionCharacterJoint.ThighRight, new Vector3(0f, -0.43f, 0f));
            CreateJoint(ProductionCharacterJoint.FootRight, ProductionCharacterJoint.ShinRight, new Vector3(0f, -0.415f, 0f));
        }

        private void CreateJoint(ProductionCharacterJoint joint, ProductionCharacterJoint? parent,
            Vector3 localPosition)
        {
            var value = new GameObject("Joint-" + joint);
            value.hideFlags = HideFlags.DontSave;
            value.transform.SetParent(parent.HasValue ? joints[(int)parent.Value] : motionRoot, false);
            value.transform.localPosition = localPosition;
            joints[(int)joint] = value.transform;
            namedParts.Add(value.name, value.transform);
        }

        private void BuildBody()
        {
            CreateLodPart("Pelvis", joints[(int)ProductionCharacterJoint.Hips],
                ProductionMaterialKind.Trousers, new Vector3(0f, 0.02f, 0f), new Vector3(0.31f, 0.21f, 0.20f));
            CreateLodPart("LowerTorso", joints[(int)ProductionCharacterJoint.Spine],
                ProductionMaterialKind.KitPrimary, new Vector3(0f, 0.10f, 0f), new Vector3(0.35f, 0.30f, 0.21f));
            CreateLodPart("Chest", joints[(int)ProductionCharacterJoint.Chest],
                ProductionMaterialKind.KitPrimary, new Vector3(0f, 0.09f, 0f), new Vector3(0.43f, 0.31f, 0.23f));
            CreatePart("KitSidePanelLeft", joints[(int)ProductionCharacterJoint.Chest], ProductionMeshKind.Box,
                ProductionMaterialKind.KitSecondary, new Vector3(0.205f, 0.08f, 0f), new Vector3(0.018f, 0.24f, 0.13f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            CreatePart("KitSidePanelRight", joints[(int)ProductionCharacterJoint.Chest], ProductionMeshKind.Box,
                ProductionMaterialKind.KitSecondary, new Vector3(-0.205f, 0.08f, 0f), new Vector3(0.018f, 0.24f, 0.13f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            CreatePart("Collar", joints[(int)ProductionCharacterJoint.Neck], ProductionMeshKind.CylinderHigh,
                ProductionMaterialKind.KitSecondary, Vector3.zero, new Vector3(0.13f, 0.045f, 0.13f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            CreateLodPart("NeckSkin", joints[(int)ProductionCharacterJoint.Neck], ProductionMaterialKind.Skin,
                new Vector3(0f, 0.035f, 0f), new Vector3(0.105f, 0.10f, 0.105f));
            CreateLodPart("Head", joints[(int)ProductionCharacterJoint.Head], ProductionMaterialKind.Skin,
                new Vector3(0f, 0.105f, 0.014f), new Vector3(0.158f, 0.225f, 0.184f));
            CreateLodPart("Hair", joints[(int)ProductionCharacterJoint.Head], ProductionMaterialKind.Hair,
                new Vector3(0f, 0.18f, -0.004f), new Vector3(0.166f, 0.10f, 0.188f), true);

            var longSleeve = Role == ProductionCharacterRole.Umpire;
            BuildArm(ProductionCharacterJoint.UpperArmLeft, ProductionCharacterJoint.ForearmLeft,
                ProductionCharacterJoint.HandLeft, "Left", longSleeve);
            BuildArm(ProductionCharacterJoint.UpperArmRight, ProductionCharacterJoint.ForearmRight,
                ProductionCharacterJoint.HandRight, "Right", longSleeve);
            BuildLeg(ProductionCharacterJoint.ThighLeft, ProductionCharacterJoint.ShinLeft,
                ProductionCharacterJoint.FootLeft, "Left");
            BuildLeg(ProductionCharacterJoint.ThighRight, ProductionCharacterJoint.ShinRight,
                ProductionCharacterJoint.FootRight, "Right");
        }

        private void BuildArm(ProductionCharacterJoint upper, ProductionCharacterJoint forearm,
            ProductionCharacterJoint hand, string side, bool longSleeve)
        {
            CreateLodPart("UpperArm" + side, joints[(int)upper], ProductionMaterialKind.KitPrimary,
                new Vector3(0f, -0.1425f, 0f), new Vector3(0.115f, 0.285f, 0.115f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            CreateLodPart("Forearm" + side, joints[(int)forearm],
                longSleeve ? ProductionMaterialKind.KitPrimary : ProductionMaterialKind.Skin,
                new Vector3(0f, -0.125f, 0f), new Vector3(0.095f, 0.25f, 0.095f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            var handMaterial = Role == ProductionCharacterRole.Batter || Role == ProductionCharacterRole.Wicketkeeper
                ? ProductionMaterialKind.Glove : ProductionMaterialKind.Skin;
            CreateLodPart("Hand" + side, joints[(int)hand], handMaterial,
                new Vector3(0f, -0.065f, 0.008f), new Vector3(0.09f, 0.14f, 0.072f));
        }

        private void BuildLeg(ProductionCharacterJoint thigh, ProductionCharacterJoint shin,
            ProductionCharacterJoint foot, string side)
        {
            CreateLodPart("Thigh" + side, joints[(int)thigh], ProductionMaterialKind.Trousers,
                new Vector3(0f, -0.215f, 0f), new Vector3(0.15f, 0.43f, 0.15f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            CreateLodPart("Shin" + side, joints[(int)shin], ProductionMaterialKind.Trousers,
                new Vector3(0f, -0.2075f, 0f), new Vector3(0.125f, 0.415f, 0.125f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            if (Role == ProductionCharacterRole.Batter)
            {
                // A rounded shared mesh keeps the rear-view batting shoe recognisable without a texture or a new
                // binary asset. Other distant roles retain the cheaper box silhouette.
                var shoe = CreateLodPart("Shoe" + side, joints[(int)foot], ProductionMaterialKind.Shoe,
                    new Vector3(0f, -0.045f, 0.085f), new Vector3(0.15f, 0.09f, 0.26f), false,
                    ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
                shoe.transform.localRotation = Quaternion.Euler(4f, 0f, 0f);
            }
            else
            {
                CreatePart("Shoe" + side, joints[(int)foot], ProductionMeshKind.Box,
                    ProductionMaterialKind.Shoe, new Vector3(0f, -0.045f, 0.085f),
                    new Vector3(0.15f, 0.09f, 0.26f), Quaternion.Euler(4f, 0f, 0f),
                    ProductionCharacterDetail.Low);
            }
            CreatePart("Sole" + side, joints[(int)foot], ProductionMeshKind.Box,
                ProductionMaterialKind.Sole, new Vector3(0f, -0.093f, 0.085f), new Vector3(0.155f, 0.018f, 0.27f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            for (var spike = 0; spike < 3; spike++)
                CreatePart("Spike" + side + spike, joints[(int)foot], ProductionMeshKind.CylinderLow,
                    ProductionMaterialKind.Metal, new Vector3((spike - 1) * 0.045f, -0.11f, 0.02f + spike * 0.055f),
                    new Vector3(0.012f, 0.025f, 0.012f), Quaternion.identity, ProductionCharacterDetail.High);
        }

        private void BuildFace()
        {
            var head = joints[(int)ProductionCharacterJoint.Head];
            CreatePart("EarLeft", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.SkinShade,
                new Vector3(0.086f, 0.105f, 0.01f), new Vector3(0.025f, 0.052f, 0.035f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("EarRight", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.SkinShade,
                new Vector3(-0.086f, 0.105f, 0.01f), new Vector3(0.025f, 0.052f, 0.035f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("Nose", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.SkinShade,
                new Vector3(0f, 0.105f, 0.107f), new Vector3(0.026f, 0.050f, 0.038f),
                Quaternion.Euler(10f, 0f, 0f), ProductionCharacterDetail.Medium);
            CreatePart("EyeWhiteLeft", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.EyeWhite,
                new Vector3(0.037f, 0.137f, 0.098f), new Vector3(0.038f, 0.021f, 0.015f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("EyeWhiteRight", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.EyeWhite,
                new Vector3(-0.037f, 0.137f, 0.098f), new Vector3(0.038f, 0.021f, 0.015f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("IrisLeft", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.Iris,
                new Vector3(0.037f, 0.137f, 0.108f), new Vector3(0.014f, 0.014f, 0.009f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("IrisRight", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.Iris,
                new Vector3(-0.037f, 0.137f, 0.108f), new Vector3(0.014f, 0.014f, 0.009f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("BrowLeft", head, ProductionMeshKind.Box, ProductionMaterialKind.Hair,
                new Vector3(0.038f, 0.165f, 0.103f), new Vector3(0.056f, 0.009f, 0.010f),
                Quaternion.Euler(0f, 0f, -8f), ProductionCharacterDetail.High);
            CreatePart("BrowRight", head, ProductionMeshKind.Box, ProductionMaterialKind.Hair,
                new Vector3(-0.038f, 0.165f, 0.103f), new Vector3(0.056f, 0.009f, 0.010f),
                Quaternion.Euler(0f, 0f, 8f), ProductionCharacterDetail.High);
            CreatePart("Mouth", head, ProductionMeshKind.Box, ProductionMaterialKind.SkinShade,
                new Vector3(0f, 0.050f, 0.103f), new Vector3(0.060f, 0.009f, 0.010f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
        }

        private void BuildRoleEquipment()
        {
            switch (Role)
            {
                case ProductionCharacterRole.Batter:
                    BuildBatterEquipment();
                    break;
                case ProductionCharacterRole.PaceBowler:
                    BuildBowlerEquipment(false);
                    break;
                case ProductionCharacterRole.SpinBowler:
                    BuildBowlerEquipment(true);
                    break;
                case ProductionCharacterRole.Wicketkeeper:
                    BuildKeeperEquipment();
                    break;
                case ProductionCharacterRole.Fielder:
                    BuildCap("FielderCap");
                    break;
                case ProductionCharacterRole.Umpire:
                    BuildUmpireHat();
                    break;
            }
        }

        private void BuildBatterEquipment()
        {
            BuildHelmet();
            BuildPads(false);
            BuildGloveDetails(false);
            CreatePart("ThighGuard", joints[(int)ProductionCharacterJoint.ThighLeft], ProductionMeshKind.Box,
                ProductionMaterialKind.Pad, new Vector3(0f, -0.13f, 0.082f), new Vector3(0.15f, 0.24f, 0.045f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            CreatePart("ArmGuard", joints[(int)ProductionCharacterJoint.ForearmLeft], ProductionMeshKind.Box,
                ProductionMaterialKind.Pad, new Vector3(0f, -0.11f, 0.06f), new Vector3(0.10f, 0.19f, 0.035f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            BuildBat();
        }

        private void BuildBowlerEquipment(bool spinBowler)
        {
            var prefix = spinBowler ? "SpinBowler" : "PaceBowler";
            // A spinner commonly keeps a cap through the short approach. The pace bowler stays bare-headed so the
            // two silhouettes remain honest to their different actions rather than becoming palette swaps.
            if (spinBowler) BuildCap(prefix + "Cap");

            var supportIsLeft = Handedness == ProductionCharacterHandedness.Right;
            var supportSide = supportIsLeft ? "Left" : "Right";
            var supportForearm = joints[(int)(supportIsLeft
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight)];
            CreatePart(prefix + "Wristband" + supportSide, supportForearm,
                ProductionMeshKind.CylinderHigh, ProductionMaterialKind.KitSecondary,
                new Vector3(0f, -0.235f, 0f), new Vector3(0.105f, 0.032f, 0.105f),
                Quaternion.identity, ProductionCharacterDetail.Low);

            var chest = joints[(int)ProductionCharacterJoint.Chest];
            CreatePart(prefix + "JerseyChevronLeft", chest, ProductionMeshKind.Box,
                ProductionMaterialKind.KitSecondary, new Vector3(0.04f, 0.115f, 0.109f),
                new Vector3(0.105f, 0.022f, 0.014f), Quaternion.Euler(0f, 0f, 14f),
                ProductionCharacterDetail.Medium);
            CreatePart(prefix + "JerseyChevronRight", chest, ProductionMeshKind.Box,
                ProductionMaterialKind.KitSecondary, new Vector3(-0.04f, 0.115f, 0.109f),
                new Vector3(0.105f, 0.022f, 0.014f), Quaternion.Euler(0f, 0f, -14f),
                ProductionCharacterDetail.Medium);

            BuildTrouserPiping(prefix, ProductionCharacterJoint.ThighLeft,
                ProductionCharacterJoint.ShinLeft, "Left", 1f);
            BuildTrouserPiping(prefix, ProductionCharacterJoint.ThighRight,
                ProductionCharacterJoint.ShinRight, "Right", -1f);
        }

        private void BuildTrouserPiping(string prefix, ProductionCharacterJoint thigh,
            ProductionCharacterJoint shin, string side, float outside)
        {
            CreatePart(prefix + "TrouserPipe" + side + "Upper", joints[(int)thigh],
                ProductionMeshKind.Box, ProductionMaterialKind.KitSecondary,
                new Vector3(outside * 0.076f, -0.215f, 0f), new Vector3(0.012f, 0.28f, 0.016f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
            CreatePart(prefix + "TrouserPipe" + side + "Lower", joints[(int)shin],
                ProductionMeshKind.Box, ProductionMaterialKind.KitSecondary,
                new Vector3(outside * 0.064f, -0.2075f, 0f), new Vector3(0.012f, 0.27f, 0.016f),
                Quaternion.identity, ProductionCharacterDetail.Medium);
        }

        private void BuildKeeperEquipment()
        {
            if (keeperStandingUpToStumps) BuildHelmet();
            else BuildCap("KeeperCap");
            BuildPads(true);
            var left = joints[(int)ProductionCharacterJoint.HandLeft];
            var right = joints[(int)ProductionCharacterJoint.HandRight];
            // A complete hero turns every old anatomy renderer off. These explicitly named glove palms preserve
            // the existing bounded procedural keeper equipment without relying on the old generic Hand anatomy.
            CreateLodPart("KeeperGlovePalmLeft", left, ProductionMaterialKind.Glove,
                new Vector3(0f, -0.065f, 0.008f), new Vector3(0.09f, 0.14f, 0.072f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            CreateLodPart("KeeperGlovePalmRight", right, ProductionMaterialKind.Glove,
                new Vector3(0f, -0.065f, 0.008f), new Vector3(0.09f, 0.14f, 0.072f), false,
                ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
            BuildGloveDetails(true);
            CreatePart("KeeperWebLeft", left, ProductionMeshKind.Box, ProductionMaterialKind.Glove,
                new Vector3(0f, -0.12f, 0.04f), new Vector3(0.12f, 0.16f, 0.045f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
            CreatePart("KeeperWebRight", right, ProductionMeshKind.Box, ProductionMaterialKind.Glove,
                new Vector3(0f, -0.12f, 0.04f), new Vector3(0.12f, 0.16f, 0.045f), Quaternion.identity,
                ProductionCharacterDetail.Medium);
        }

        private void BuildHelmet()
        {
            var head = joints[(int)ProductionCharacterJoint.Head];
            CreatePart("HelmetShell", head, ProductionMeshKind.DomeHigh, ProductionMaterialKind.Helmet,
                new Vector3(0f, 0.12f, 0f), new Vector3(0.21f, 0.19f, 0.22f), Quaternion.identity,
                ProductionCharacterDetail.Low);
            CreatePart("HelmetPeak", head, ProductionMeshKind.Box, ProductionMaterialKind.Helmet,
                new Vector3(0f, 0.135f, 0.135f), new Vector3(0.15f, 0.018f, 0.12f),
                Quaternion.Euler(-8f, 0f, 0f), ProductionCharacterDetail.Low);
            CreatePart("HelmetEarGuardLeft", head, ProductionMeshKind.Box, ProductionMaterialKind.Helmet,
                new Vector3(0.102f, 0.09f, 0.015f), new Vector3(0.028f, 0.09f, 0.085f), Quaternion.identity,
                ProductionCharacterDetail.Low);
            CreatePart("HelmetEarGuardRight", head, ProductionMeshKind.Box, ProductionMaterialKind.Helmet,
                new Vector3(-0.102f, 0.09f, 0.015f), new Vector3(0.028f, 0.09f, 0.085f), Quaternion.identity,
                ProductionCharacterDetail.Low);
            // Rear-shoulder gameplay sees the back of the helmet, not its grille. This low-LOD occipital guard
            // gives that view an unmistakable protective silhouette while the grille remains correct up front.
            CreatePart("HelmetRearGuard", head, ProductionMeshKind.SphereHigh, ProductionMaterialKind.Helmet,
                new Vector3(0f, 0.055f, -0.128f), new Vector3(0.17f, 0.13f, 0.045f),
                Quaternion.Euler(-8f, 0f, 0f), ProductionCharacterDetail.Low);
            CreatePartBetween("HelmetGrilleTop", head, new Vector3(-0.105f, 0.12f, 0.145f),
                new Vector3(0.105f, 0.12f, 0.145f), 0.008f, ProductionMaterialKind.Metal,
                ProductionCharacterDetail.Medium);
            CreatePartBetween("HelmetGrilleBottom", head, new Vector3(-0.095f, 0.035f, 0.145f),
                new Vector3(0.095f, 0.035f, 0.145f), 0.007f, ProductionMaterialKind.Metal,
                ProductionCharacterDetail.High);
            for (var index = -2; index <= 2; index++)
                CreatePartBetween("HelmetGrilleVertical" + index, head,
                    new Vector3(index * 0.045f, 0.125f, 0.145f),
                    new Vector3(index * 0.040f, 0.030f, 0.145f), 0.006f,
                    ProductionMaterialKind.Metal, ProductionCharacterDetail.High);
            CreatePartBetween("HelmetChinStrapLeft", head, new Vector3(0.09f, 0.08f, 0.01f),
                new Vector3(0.035f, 0.00f, 0.085f), 0.009f, ProductionMaterialKind.SkinShade,
                ProductionCharacterDetail.High);
            CreatePartBetween("HelmetChinStrapRight", head, new Vector3(-0.09f, 0.08f, 0.01f),
                new Vector3(-0.035f, 0.00f, 0.085f), 0.009f, ProductionMaterialKind.SkinShade,
                ProductionCharacterDetail.High);
        }

        private void BuildCap(string prefix)
        {
            var head = joints[(int)ProductionCharacterJoint.Head];
            CreatePart(prefix + "Crown", head, ProductionMeshKind.DomeLow, ProductionMaterialKind.KitPrimary,
                new Vector3(0f, 0.155f, 0f), new Vector3(0.18f, 0.12f, 0.19f), Quaternion.identity,
                ProductionCharacterDetail.Low);
            CreatePart(prefix + "Peak", head, ProductionMeshKind.Box, ProductionMaterialKind.KitPrimary,
                new Vector3(0f, 0.15f, 0.13f), new Vector3(0.15f, 0.016f, 0.13f),
                Quaternion.Euler(-7f, 0f, 0f), ProductionCharacterDetail.Low);
        }

        private void BuildUmpireHat()
        {
            var head = joints[(int)ProductionCharacterJoint.Head];
            CreatePart("UmpireHatCrown", head, ProductionMeshKind.DomeLow, ProductionMaterialKind.KitPrimary,
                new Vector3(0f, 0.16f, 0f), new Vector3(0.18f, 0.13f, 0.19f), Quaternion.identity,
                ProductionCharacterDetail.Low);
            CreatePart("UmpireHatBrim", head, ProductionMeshKind.CylinderHigh, ProductionMaterialKind.KitPrimary,
                new Vector3(0f, 0.15f, 0f), new Vector3(0.29f, 0.014f, 0.29f), Quaternion.identity,
                ProductionCharacterDetail.Low);
        }

        private void BuildPads(bool keeper)
        {
            BuildPad(joints[(int)ProductionCharacterJoint.ShinLeft], "Left", keeper);
            BuildPad(joints[(int)ProductionCharacterJoint.ShinRight], "Right", keeper);
        }

        private void BuildPad(Transform shin, string side, bool keeper)
        {
            var height = keeper ? 0.31f : 0.37f;
            if (keeper)
            {
                CreatePart("KeeperPad" + side, shin, ProductionMeshKind.Box,
                    ProductionMaterialKind.Pad, new Vector3(0f, -0.19f, 0.07f),
                    new Vector3(0.14f, height, 0.055f), Quaternion.identity,
                    ProductionCharacterDetail.Low);
            }
            else
            {
                CreateLodPart("BattingPad" + side, shin, ProductionMaterialKind.Pad,
                    new Vector3(0f, -0.19f, 0.07f), new Vector3(0.155f, height, 0.055f), false,
                    ProductionMeshKind.CapsuleLow, ProductionMeshKind.CapsuleHigh);
                CreatePart("BattingPadRearGuard" + side, shin, ProductionMeshKind.CapsuleLow,
                    ProductionMaterialKind.Pad, new Vector3(0f, -0.19f, -0.058f),
                    new Vector3(0.115f, height * 0.82f, 0.032f), Quaternion.identity,
                    ProductionCharacterDetail.Low);
            }
            var rolls = keeper ? 4 : 6;
            for (var index = 0; index < rolls; index++)
            {
                var x = (index - (rolls - 1) * 0.5f) * (keeper ? 0.027f : 0.025f);
                CreatePart("PadRoll" + side + index, shin, ProductionMeshKind.CylinderLow,
                    ProductionMaterialKind.Pad, new Vector3(x, -0.19f, 0.105f),
                    new Vector3(0.018f, height * 0.88f, 0.018f), Quaternion.identity,
                    ProductionCharacterDetail.High);
            }
            CreatePart("PadStrap" + side + "Top", shin, ProductionMeshKind.Box,
                ProductionMaterialKind.SkinShade, new Vector3(0f, -0.10f, -0.07f),
                new Vector3(0.17f, 0.025f, 0.018f), Quaternion.identity, ProductionCharacterDetail.Medium);
            CreatePart("PadStrap" + side + "Bottom", shin, ProductionMeshKind.Box,
                ProductionMaterialKind.SkinShade, new Vector3(0f, -0.28f, -0.07f),
                new Vector3(0.17f, 0.025f, 0.018f), Quaternion.identity, ProductionCharacterDetail.Medium);
        }

        private void BuildGloveDetails(bool keeper)
        {
            BuildGlove(joints[(int)ProductionCharacterJoint.HandLeft], "Left", keeper);
            BuildGlove(joints[(int)ProductionCharacterJoint.HandRight], "Right", keeper);
        }

        private void BuildGlove(Transform hand, string side, bool keeper)
        {
            var count = keeper ? 3 : 4;
            if (!keeper)
            {
                // The hand already carries the glove material. A separate low-LOD cuff makes both gloves legible
                // as protective cricket equipment from behind, even when finger rolls are culled.
                CreatePart("BattingGloveCuff" + side, hand, ProductionMeshKind.CylinderHigh,
                    ProductionMaterialKind.KitSecondary, new Vector3(0f, -0.018f, 0f),
                    new Vector3(0.105f, 0.052f, 0.090f), Quaternion.identity,
                    ProductionCharacterDetail.Low);
            }
            for (var index = 0; index < count; index++)
                CreatePart((keeper ? "KeeperGloveFinger" : "BattingGloveFinger") + side + index,
                    hand, ProductionMeshKind.CylinderLow, ProductionMaterialKind.Glove,
                    new Vector3((index - (count - 1) * 0.5f) * 0.018f, -0.125f, 0.018f),
                    new Vector3(0.016f, keeper ? 0.085f : 0.072f, 0.016f), Quaternion.identity,
                    keeper ? ProductionCharacterDetail.High : ProductionCharacterDetail.Medium);
        }

        private void BuildBat()
        {
            var hand = Handedness == ProductionCharacterHandedness.Right
                ? joints[(int)ProductionCharacterJoint.HandRight]
                : joints[(int)ProductionCharacterJoint.HandLeft];
            // Reuse the one law-scale production bat implementation; the character layer only owns its grip pose.
            // High remains tiny (121 blade vertices) but removes the coarse shoulder/toe stepping that is obvious
            // when the bat fills the rear-view foreground. Dimensions and the canonical pose stay unchanged.
            batVisual = ProductionCricketProps.CreateBat(hand, "OriginalCricketBat",
                ProductionPropQuality.High, castShadows);
            batRoot = batVisual.Root.transform;
            batRoot.localPosition = new Vector3(0f, -0.02f, 0.035f) +
                                    BatterReadyGripCameraForwardLocalOffset(Handedness);
            batDefaultLocalPosition = batRoot.localPosition;
            batDefaultLocalRotation = batRoot.localRotation;
            namedParts.Add(batRoot.name, batRoot);
            namedParts.Add("BatBlade", batVisual.Blade);
            namedParts.Add("BatHandle", batVisual.Handle);
            var batRenderers = batRoot.GetComponentsInChildren<MeshRenderer>(true);
            for (var index = 0; index < batRenderers.Length; index++) renderers.Add(batRenderers[index]);
        }

        /// <summary>
        /// A sampled BatRotation is local to its pose's bat hand. When a sample uses the other handedness (the legacy
        /// stroke, PoseHandedness), the bat moves to that hand first, keeping the same authored local grip offset.
        /// </summary>
        private void EnsureBatParent(ProductionCharacterHandedness sampled)
        {
            if (batRoot == null) return;
            var hand = joints[(int)(sampled == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.HandRight
                : ProductionCharacterJoint.HandLeft)];
            if (batRoot.parent == hand) return;
            batRoot.SetParent(hand, false);
            batDefaultLocalPosition = new Vector3(0f, -0.02f, 0.035f) + BatterReadyGripCameraForwardLocalOffset(sampled);
            batRoot.localPosition = batDefaultLocalPosition;
            batRoot.localRotation = batDefaultLocalRotation;
        }

        /// <summary>
        /// The release reach (the web's stageScene.ts reachRelease, lead ruling 2026-11-07). The physics release point
        /// is authoritative, while the ball in the delivery palm, as the clip draws it at the release marker, is a few
        /// centimetres off it (the body-scale clamp leaves a residual). That residual `delta`, scaled by `weight`, is
        /// taken up by the trunk's side flexion (at most ReleaseReachTrunkMaxDegrees in all, split over the spine and
        /// the chest: it lifts or lowers the shoulder, which a straight arm cannot do by itself) and by the shoulder's
        /// turn. The turn is rigid: the elbow angle, the forearm and the hand keep their authored rotations, so the
        /// bowling arm stays the clip's own, legal one (the earlier arm IK dragged the hand to the point and folded the
        /// elbow). The feet and the hips are not touched. Presentation only; the release point itself is never moved.
        /// Returns the miss (m) left when the flexion is at its limit.
        /// </summary>
        internal float ReachReleaseWithTrunkAndShoulder(Vector3 delta, float weight)
        {
            ThrowIfDisposed();
            if (releaseAnchor == null || weight <= 0f || delta.sqrMagnitude < 1e-8f) return 0f;
            var deliveryIsLeft = Handedness == ProductionCharacterHandedness.Left;
            var upper = joints[(int)(deliveryIsLeft
                ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)];
            var spine = joints[(int)ProductionCharacterJoint.Spine];
            var chest = joints[(int)ProductionCharacterJoint.Chest];
            var want = releaseAnchor.position + delta * Mathf.Clamp01(weight);
            var radius = Vector3.Distance(upper.position, releaseAnchor.position);
            // Side flexion is a lean about the bowler's own forward axis (horizontal).
            var axis = rootObject.transform.forward;
            axis.y = 0f;
            axis = axis.sqrMagnitude > 1e-6f ? axis.normalized : Vector3.forward;
            var keepSpine = spine.localRotation;
            var keepChest = chest.localRotation;
            var limit = ReleaseReachTrunkMaxDegrees * Mathf.Deg2Rad;
            var rad = 0f;
            var left = ReleaseReachMiss(0f, axis, spine, chest, keepSpine, keepChest, upper, want, radius);
            if (Mathf.Abs(left) > 2e-4f)
            {
                var step = limit / ReleaseReachTrunkMaxDegrees;
                var slope = (ReleaseReachMiss(step, axis, spine, chest, keepSpine, keepChest, upper, want, radius) - left) / step;
                if (Mathf.Abs(slope) > 1e-3f)
                {
                    var a = Mathf.Clamp(-left / slope, -limit, limit);
                    var g = ReleaseReachMiss(a, axis, spine, chest, keepSpine, keepChest, upper, want, radius);
                    if (Mathf.Abs(g) > 2e-4f && Mathf.Abs(a) > 1e-6f && Mathf.Abs(a) < limit)
                    {
                        var secondSlope = (g - left) / a;
                        if (Mathf.Abs(secondSlope) > 1e-3f)
                        {
                            var b = Mathf.Clamp(a - g / secondSlope, -limit, limit);
                            var h = ReleaseReachMiss(b, axis, spine, chest, keepSpine, keepChest, upper, want, radius);
                            if (Mathf.Abs(h) < Mathf.Abs(g))
                            {
                                a = b;
                                g = h;
                            }
                        }
                    }
                    if (Mathf.Abs(g) < Mathf.Abs(left))
                    {
                        rad = a;
                        left = g;
                    }
                }
            }
            if (rad != 0f) FlexTrunk(rad, axis, spine, chest);
            // The shoulder's turn: the palm's direction from the shoulder onto the wanted point's.
            var along = releaseAnchor.position - upper.position;
            var onto = want - upper.position;
            if (along.sqrMagnitude > 1e-8f && onto.sqrMagnitude > 1e-8f)
                upper.rotation = Quaternion.FromToRotation(along, onto) * upper.rotation;
            SynchronizeHeroPose();
            return Mathf.Abs(left);
        }

        /// <summary>The trunk's side flexion in all (degrees) the release reach may use (the web's RELEASE_REACH.trunkMaxDeg).</summary>
        internal const float ReleaseReachTrunkMaxDegrees = 6f;

        /// <summary>Leans the trunk by `rad` about `axis`: half at the spine, half more at the chest (a child of it).</summary>
        private static void FlexTrunk(float rad, Vector3 axis, Transform spine, Transform chest)
        {
            var half = Quaternion.AngleAxis(rad * Mathf.Rad2Deg * 0.5f, axis);
            spine.rotation = half * spine.rotation;
            chest.rotation = half * chest.rotation;
        }

        /// <summary>The shoulder's distance to the wanted point, less the arm's reach, after a flexion of `rad` (then undone).</summary>
        private static float ReleaseReachMiss(float rad, Vector3 axis, Transform spine, Transform chest,
            Quaternion keepSpine, Quaternion keepChest, Transform upper, Vector3 want, float radius)
        {
            FlexTrunk(rad, axis, spine, chest);
            var miss = Vector3.Distance(upper.position, want) - radius;
            spine.localRotation = keepSpine;
            chest.localRotation = keepChest;
            return miss;
        }

        /// <summary>
        /// Reaches one arm so its palm centre (6.5 cm along the wrist from the wrist joint, MOTION-SPEC hand points)
        /// is on a target: two-bone IK on the driver arm, blended by weight, then the visible hero is re-synchronised.
        /// Presentation only (a fielder's throwing hand onto the physics throw release point).
        /// <para>
        /// UNITY-9 (shoulderSphere, the default): the palm goes the weighted share of the way from where the clip has it to the target AROUND the
        /// shoulder (its direction turns along the shortest arc, its distance from the shoulder changes linearly), not along the straight line
        /// between them. The straight line passes within a few centimetres of the shoulder when the two points are on either side of it, and
        /// a goal that close makes the elbow's azimuth swing 130 to 160 degrees in a frame (the defensive-tap bowler's throw). The elbow bend
        /// is the clip's, carried onto the goal line once for all passes (TransportedElbowPole); the trunk joins in only as the goal is well past the arm's reach.
        /// shoulderSphere false is the earlier straight-line reach, kept as the A/B seam.
        /// </para>
        /// </summary>
        internal void ReachPalmTo(bool leftLabel, Vector3 palmTarget, float weight, bool shoulderSphere = true)
        {
            ThrowIfDisposed();
            if (weight <= 0f) return;
            var w = Mathf.Clamp01(weight);
            var palm = DriverPalmWorld(leftLabel);
            var goal = Vector3.Lerp(palm, palmTarget, w);
            if (shoulderSphere)
            {
                var shoulder = joints[(int)(leftLabel ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)].position;
                var toPalm = palm - shoulder;
                var toTarget = palmTarget - shoulder;
                if (toPalm.sqrMagnitude > 1e-4f && toTarget.sqrMagnitude > 1e-4f)
                {
                    var turn = Quaternion.Slerp(Quaternion.identity, Quaternion.FromToRotation(toPalm.normalized, toTarget.normalized), w);
                    goal = shoulder + turn * toPalm.normalized * Mathf.Lerp(toPalm.magnitude, toTarget.magnitude, w);
                }
            }

            ReachPalmToGoal(leftLabel, goal, palmTarget, w, shoulderSphere);
        }

        /// <summary>The offset a throwing hand's reach took up at the release, kept for the follow-through (in the actor's own frame).</summary>
        internal struct PalmReachResidual
        {
            public bool Captured;
            /// <summary>The turn about the shoulder that took the clip's palm direction to the release point's, in the actor's frame.</summary>
            public Quaternion Turn;
            /// <summary>The change of the palm's distance from the shoulder that did the same (m).</summary>
            public float RadiusChange;
        }

        /// <summary>
        /// The reach AFTER the release: the hand carries on with the follow-through the clip draws and only the offset the release left fades out. The
        /// offset (the turn about the shoulder and the change of distance that took the clip's palm to the release point) is taken on the first call,
        /// where the goal is the release point exactly, and kept in the actor's frame. Pulling the palm back to the fixed release point instead dragged
        /// the goal through the shoulder's neighbourhood and the elbow swung 130 to 160 degrees a frame for five frames.
        /// </summary>
        internal void ReachPalmFollowing(bool leftLabel, Vector3 releasePoint, float weight, ref PalmReachResidual residual)
        {
            ThrowIfDisposed();
            if (weight <= 0f) return;
            var w = Mathf.Clamp01(weight);
            var palm = DriverPalmWorld(leftLabel);
            var shoulder = joints[(int)(leftLabel ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)].position;
            var toPalm = palm - shoulder;
            var toTarget = releasePoint - shoulder;
            if (toPalm.sqrMagnitude <= 1e-4f || toTarget.sqrMagnitude <= 1e-4f)
            {
                ReachPalmToGoal(leftLabel, Vector3.Lerp(palm, releasePoint, w), releasePoint, w, true);
                return;
            }

            var frame = rootObject.transform.rotation;
            var inverse = Quaternion.Inverse(frame);
            if (!residual.Captured)
            {
                residual.Turn = Quaternion.FromToRotation(inverse * toPalm.normalized, inverse * toTarget.normalized);
                residual.RadiusChange = toTarget.magnitude - toPalm.magnitude;
                residual.Captured = true;
            }

            var direction = frame * (Quaternion.Slerp(Quaternion.identity, residual.Turn, w) * (inverse * toPalm.normalized));
            var goal = shoulder + direction * Mathf.Max(0.05f, toPalm.magnitude + residual.RadiusChange * w);
            ReachPalmToGoal(leftLabel, goal, releasePoint, w, true);
        }

        private void ReachPalmToGoal(bool leftLabel, Vector3 palmGoal, Vector3 palmTarget, float w, bool smooth)
        {
            var hand = joints[(int)(leftLabel ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
            var forearm = joints[(int)(leftLabel ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)];
            Func<Vector3> palmOffset = () =>
            {
                var along = hand.position - forearm.position;
                return along.sqrMagnitude > 1e-6f ? along.normalized * PalmAlongWristMetres : Vector3.zero;
            };
            // The web's whole-body reach (locomotion.ts bodyReach, BODY_REACH_LIMITS.normal): the trunk swings the
            // shoulder towards the target when the arm alone cannot reach it; the feet stay planted.
            ReachTrunkTowards(leftLabel, (smooth ? palmGoal : palmTarget) - palmOffset(), 30f, w, smooth);
            // The palm is 6.5 cm along the forearm from the wrist, and the solve turns the forearm: re-aim the wrist
            // from the solved forearm a few times so the palm itself lands on the goal (one pass left up to 9 cm).
            // UNITY-9: the elbow's plane is the clip's, taken once from the arm as the clip drew it. Taking it again from each pass's half-solved
            // arm made the plane drift between passes when the goal was near the shoulder (the folded arm's bend direction is ill-conditioned).
            var pole = smooth ? TransportedElbowPole(leftLabel, palmGoal - palmOffset()) : null;
            for (var pass = 0; pass < 3; pass++)
                SolveArmToGrip(leftLabel, palmGoal - palmOffset(), hand.rotation, 1f, smooth ? pole : AnimatedElbowPole(leftLabel));
            SynchronizeHeroPose();
        }

        /// <summary>The driver palm centre (6.5 cm along the forearm from the wrist joint) of one arm, in the world.</summary>
        internal Vector3 DriverPalmWorld(bool leftLabel)
        {
            ThrowIfDisposed();
            var hand = joints[(int)(leftLabel ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
            var forearm = joints[(int)(leftLabel ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)];
            var along = hand.position - forearm.position;
            return along.sqrMagnitude > 1e-6f ? hand.position + along.normalized * PalmAlongWristMetres : hand.position;
        }

        private const float PalmAlongWristMetres = 0.065f;

        /// <summary>
        /// A port of the web's bodyReach trunk step on the driver: when the wrist target is beyond 93% of the arm chain,
        /// the spine then the chest each turn about their own joint to swing the shoulder towards it (a half, then the
        /// rest, each at most limitDegrees, scaled by weight); then two-bone IK puts the wrist on the target (clamped
        /// to the chain: never stretched). The hips and legs are not touched, so planted feet stay planted.
        /// </summary>
        /// <summary>
        /// Plants the visible hero's ankles on ground targets (the physics pads, the lead's 5f body ruling), each blended
        /// from where the foot is now by its own weight and lifted by its own height, keeping the feet's rotations.
        /// Presentation only; the bat, trace and root are untouched.
        /// </summary>
        internal void PlantBatterAnklesOn(Vector3 labelLeftGround, float leftWeight, float leftLift,
            Vector3 labelRightGround, float rightWeight, float rightLift)
        {
            ThrowIfDisposed();
            if (Role != ProductionCharacterRole.Batter || bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle)
                return;
            if (leftWeight <= 0f && rightWeight <= 0f) return;
            var left = bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
            var right = bakedCharacter.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
            var lw = Mathf.Clamp01(leftWeight);
            var rw = Mathf.Clamp01(rightWeight);
            var leftTarget = new Vector3(Mathf.Lerp(left.x, labelLeftGround.x, lw), left.y + leftLift,
                Mathf.Lerp(left.z, labelLeftGround.z, lw));
            var rightTarget = new Vector3(Mathf.Lerp(right.x, labelRightGround.x, rw), right.y + rightLift,
                Mathf.Lerp(right.z, labelRightGround.z, rw));
            bakedCharacter.PlantHeroBatterFeet(leftTarget, rightTarget,
                bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootLeft),
                bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootRight));
        }

        private static readonly ProductionCharacterJoint[] ReachTrunk =
            { ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest };
        private static readonly float[] ReachTrunkShares = { 0.5f, 1f };

        /// <summary>The trunk half of the web's bodyReach: spine then chest swing the shoulder towards the target.</summary>
        private void ReachTrunkTowards(bool leftLabel, Vector3 wristTarget, float limitDegrees, float weight, bool smooth = false)
        {
            if (weight <= 0f) return;
            var upper = joints[(int)(leftLabel ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)];
            var forearm = joints[(int)(leftLabel ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)];
            var hand = joints[(int)(leftLabel ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
            var chain = Vector3.Distance(upper.position, forearm.position) + Vector3.Distance(forearm.position, hand.position);
            var want = chain * 0.93f;
            // UNITY-9: the trunk joins in as the target goes past the arm's reach, over the next 8 cm, not all at once at the threshold (the
            // defensive-tap bowler's spine and chest stepped 17 to 20 degrees in a frame as the target crossed it).
            if (smooth) weight *= Mathf.SmoothStep(0f, 1f, (Vector3.Distance(upper.position, wristTarget) - want) / 0.08f);
            if (weight <= 0f) return;
            for (var index = 0; index < ReachTrunk.Length; index++)
            {
                if (Vector3.Distance(upper.position, wristTarget) <= want) break;
                var joint = joints[(int)ReachTrunk[index]];
                var a = upper.position - joint.position;
                var b = wristTarget - joint.position;
                if (a.sqrMagnitude < 1e-8f || b.sqrMagnitude < 1e-8f) continue;
                var full = Vector3.Angle(a, b);
                var angle = Mathf.Min(limitDegrees, full * ReachTrunkShares[index]) * weight;
                var axis = Vector3.Cross(a, b);
                if (angle < 1e-3f || axis.sqrMagnitude < 1e-12f) continue;
                joint.rotation = Quaternion.AngleAxis(angle, axis.normalized) * joint.rotation;
            }
        }

        /// <summary>
        /// Stable elbow pole (third man's 180-degree forearm flip at 4.45 s, r4c): the root-forward pole projected
        /// across the reach direction changes sign whenever an overarm throw or a release sweeps the arm through it.
        /// Keep the elbow in the plane the clip already bends it in (the animated elbow's offset from its
        /// shoulder-to-wrist line); only an arm the clip holds straight falls back to the root pole (null).
        /// </summary>
        private Vector3? AnimatedElbowPole(bool leftLabel)
        {
            var upper = joints[(int)(leftLabel ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)];
            var forearm = joints[(int)(leftLabel ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight)];
            var hand = joints[(int)(leftLabel ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
            var line = hand.position - upper.position;
            if (line.sqrMagnitude <= 1e-6f) return null;
            var d = line.normalized;
            var bend = forearm.position - upper.position;
            bend -= d * Vector3.Dot(bend, d);
            return bend.sqrMagnitude > ReachPoleMinimumBendMetres * ReachPoleMinimumBendMetres
                ? bend.normalized
                : (Vector3?)null;
        }

        /// <summary>
        /// UNITY-9: the clip's elbow bend carried onto the line to a wrist goal by the rotation that takes the clip's shoulder-to-wrist line to the
        /// goal's, not by projecting it across the goal line (AnimatedElbowPole's pole is projected by SolveArmToGrip). The projection is singular
        /// when the bend points along the goal line, which a goal near the shoulder (a folded arm) does within a few centimetres of travel, and the
        /// elbow then swings to the far side of the arm in one frame; the carried bend turns with the line instead. Null for an arm the clip holds straight.
        /// </summary>
        private Vector3? TransportedElbowPole(bool leftLabel, Vector3 wristGoal)
        {
            var clipPole = AnimatedElbowPole(leftLabel);
            if (!clipPole.HasValue) return null;
            var upper = joints[(int)(leftLabel ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight)];
            var hand = joints[(int)(leftLabel ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight)];
            var clipLine = hand.position - upper.position;
            var goalLine = wristGoal - upper.position;
            if (clipLine.sqrMagnitude <= 1e-6f || goalLine.sqrMagnitude <= 1e-6f) return clipPole;
            var carried = Quaternion.FromToRotation(clipLine.normalized, goalLine.normalized) * clipPole.Value;
            return carried.sqrMagnitude > 1e-6f ? carried.normalized : clipPole;
        }

        /// <summary>Below this elbow offset from the shoulder-to-wrist line (m) the clip's arm counts as straight.</summary>
        private const float ReachPoleMinimumBendMetres = 0.01f;

        private void BuildReleaseAnchor()
        {
            var deliveryHand = Handedness == ProductionCharacterHandedness.Right
                ? joints[(int)ProductionCharacterJoint.HandRight]
                : joints[(int)ProductionCharacterJoint.HandLeft];
            var anchor = new GameObject("ReleaseHandAnchor");
            anchor.hideFlags = HideFlags.DontSave;
            anchor.transform.SetParent(deliveryHand, false);
            // The ball in hand, MOTION's BALL_IN_HAND (bowler_kin.py, MOTION-BOWL 2026-11-04): the hand joint plus
            // (0, -0.085, 0.03) in the hand frame, so both renderers measure the same ball point at the release.
            anchor.transform.localPosition = new Vector3(0f, -0.085f, 0.03f);
            releaseAnchor = anchor.transform;
            namedParts.Add(anchor.name, releaseAnchor);
        }

        private void CoupleBatterHandsToCanonicalBat(Vector3 grip, Vector3 bladeDirection,
            Quaternion batRotation, float weight, bool retargetBodyToTrace = true)
        {
            var topIsLeft = Handedness == ProductionCharacterHandedness.Right;
            var topTarget = grip + bladeDirection * BatterTopHandGripOffsetMetres;
            var lowerTarget = grip + bladeDirection * BatterLowerHandGripOffsetMetres;
            // The host bat can put its handle well down-pitch while a generic time-only body phase still leaves
            // both shoulders over the crease. Rotating only the arms cannot bridge that mismatch without either a
            // floating bat or stretched wrist-weighted glove vertices. Aim the articulated upper-body chain at the
            // actual ordered targets first, within explicit posture bounds. This changes presentation only: the
            // gameplay root, feet, bat trace, contact and score never read these transforms. Every seek begins from
            // the newly sampled pose, so the bounded deltas never accumulate between frames or replays.
            if (weight <= 0f) return;
            if (BatterOneHandCarry)
            {
                SolveArmToGrip(!topIsLeft, lowerTarget, batRotation, weight,
                    placedPackPose ? AnimatedElbowPole(!topIsLeft) : null);
                return;
            }
            if (retargetBodyToTrace)
            {
                RetargetBatterUpperBodyToGrip(
                    topIsLeft ? topTarget : lowerTarget,
                    topIsLeft ? lowerTarget : topTarget,
                    weight);
            }
            // A placed pack pose keeps its authored elbow planes (see SynchronizeHeroPose); the stroke's root poles stay.
            SolveArmToGrip(topIsLeft, topTarget, batRotation, weight, placedPackPose ? AnimatedElbowPole(topIsLeft) : null);
            SolveArmToGrip(!topIsLeft, lowerTarget, batRotation, weight,
                placedPackPose ? AnimatedElbowPole(!topIsLeft) : null);
        }

        private void SetBatterBatWorldPose(
            Vector3 grip,
            Quaternion rotation,
            Vector3 bladeDirection,
            float handCouplingWeight,
            bool retargetBodyToTrace = true,
            bool applyBatterNeckClearance = true,
            bool preserveHeroFootAnchors = true,
            float supportLegPoseWeight = 1f)
        {
            var spatialOrigin = motionRoot.position;
            var preserveHeroSupportLegPose = preserveHeroFootAnchors && !retargetBodyToTrace &&
                                             supportLegPoseWeight > 0f &&
                                             bakedCharacter != null &&
                                             bakedCharacter.UsesCompleteHeroBundle;
            if (preserveHeroSupportLegPose)
                bakedCharacter.CaptureHeroBatterSupportLegPose(batterSupportLegPoseRotations);
            // A no-body-retarget solve is reconstructed deterministically from the same canonical pose and only
            // articulates torso/arms; re-running leg IK in that path can introduce a residual that was not present.
            // Foot restoration is needed only when the bounded body/clearance reconciliation may move MotionRoot.
            var plantHeroFeet = preserveHeroFootAnchors && retargetBodyToTrace &&
                                bakedCharacter != null && bakedCharacter.UsesCompleteHeroBundle;
            var leftFootOrigin = plantHeroFeet
                ? HeroJointWorldPosition(ProductionCharacterJoint.FootLeft)
                : Vector3.zero;
            var rightFootOrigin = plantHeroFeet
                ? HeroJointWorldPosition(ProductionCharacterJoint.FootRight)
                : Vector3.zero;
            var leftFootRotation = plantHeroFeet
                ? bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootLeft)
                : Quaternion.identity;
            var rightFootRotation = plantHeroFeet
                ? bakedCharacter.HeroJointWorldRotation(ProductionCharacterJoint.FootRight)
                : Quaternion.identity;
            CoupleBatterHandsToCanonicalBat(
                grip,
                bladeDirection.normalized,
                rotation,
                handCouplingWeight,
                retargetBodyToTrace);
            // The bat is parented to the lower hand for the generated fallback rig. Re-apply the requested world
            // pose after arm/body solving so no presentation transform can become bat or gameplay authority.
            batRoot.SetPositionAndRotation(grip, rotation);
            // At canonical blend zero the just-sampled provisional body, including its visible hero arm solve, is
            // the source pose. Re-synchronizing without IK would reopen those arms for one frame even though the
            // body blend is explicitly zero. The authoritative bat is already exact and may intentionally lead the
            // hands until bounded reconciliation begins on the following frames.
            if (handCouplingWeight <= 0f) return;
            SynchronizeHeroPose(handCouplingWeight, applyBatterNeckClearance: false);
            batRoot.SetPositionAndRotation(grip, rotation);
            if (retargetBodyToTrace && ReconcileBatterBodyClearance(
                    spatialOrigin, grip, rotation, handCouplingWeight))
            {
                batRoot.SetPositionAndRotation(grip, rotation);
                CoupleBatterHandsToCanonicalBat(
                    grip,
                    bladeDirection.normalized,
                    rotation,
                    handCouplingWeight,
                    retargetBodyToTrace: false);
                batRoot.SetPositionAndRotation(grip, rotation);
            }
            SynchronizeHeroPose(handCouplingWeight, applyBatterNeckClearance);
            batRoot.SetPositionAndRotation(grip, rotation);
            for (var clearancePass = 0;
                 clearancePass < 3 && retargetBodyToTrace && applyBatterNeckClearance;
                 clearancePass++)
            {
                if (!ReconcileBatterBodyClearance(
                        spatialOrigin, grip, rotation, handCouplingWeight))
                    break;
                batRoot.SetPositionAndRotation(grip, rotation);
                CoupleBatterHandsToCanonicalBat(
                    grip,
                    bladeDirection.normalized,
                    rotation,
                    handCouplingWeight,
                    retargetBodyToTrace: false);
                batRoot.SetPositionAndRotation(grip, rotation);
                SynchronizeHeroPose(handCouplingWeight, applyBatterNeckClearance);
                batRoot.SetPositionAndRotation(grip, rotation);
            }
            if (plantHeroFeet)
            {
                var plantedTranslation = motionRoot.position - spatialOrigin;
                plantedTranslation.y = 0f;
                bakedCharacter.PlantHeroBatterFeet(
                    leftFootOrigin + plantedTranslation,
                    rightFootOrigin + plantedTranslation,
                    leftFootRotation,
                    rightFootRotation);
            }
            if (preserveHeroSupportLegPose)
            {
                // Arm-only reconciliation has no authority over either support leg. Restore the exact sampled
                // licensed leg rotations after all hero synchronization/IK so numerical leg solvers cannot perturb
                // an already-planted no-retarget pose; local positions and segment lengths remain authored.
                bakedCharacter.RestoreHeroBatterSupportLegPose(batterSupportLegPoseRotations, supportLegPoseWeight);
            }
        }

        private bool ReconcileBatterBodyClearance(
            Vector3 spatialOrigin,
            Vector3 grip,
            Quaternion rotation,
            float weight)
        {
            if (bakedCharacter == null || !bakedCharacter.UsesCompleteHeroBundle) return false;

            var mirror = ProceduralPracticeWorld.WorldReflectionFor(
                Handedness == ProductionCharacterHandedness.Left ? "right" : "left");
            var lateral = rootObject.transform.position.x;
            var creaseOffset = 9.25f - rootObject.transform.position.z;
            var cameraPosition = Vande.Practice.Presentation.ProceduralPracticeWorld
                .BatterCameraPosition(lateral, creaseOffset, mirror);
            var cameraTarget = Vande.Practice.Presentation.ProceduralPracticeWorld
                .BatterCameraTarget(lateral);
            var cameraRotation = Quaternion.LookRotation(cameraTarget - cameraPosition, Vector3.up);
            var toe = grip + rotation * Vector3.down * CricketPropDimensions.TotalBatLength;
            var neck = HeroJointWorldPosition(ProductionCharacterJoint.Neck);
            var helmet = bakedCharacter.HeroHelmetCentreWorld;
            var originalOffset = motionRoot.position - spatialOrigin;
            originalOffset.y = 0f;
            var amount = Mathf.Clamp01(weight);
            if (amount <= 0f) return false;
            // Clearance is solved once at full coupling and only then blended. Solving directly around the already
            // weighted pose makes the safety correction nonlinear (half coupling followed a different ground
            // path than half of the full pose). Recover the unweighted base and full candidate so body, hands and
            // the canonical blend all share one deterministic interpolation.
            var neckOrigin = neck - originalOffset;
            var helmetOrigin = helmet - originalOffset;
            var candidate = Vector3.ClampMagnitude(
                originalOffset / amount,
                MaximumBatterSpatialRetargetMetres);
            const float requiredPhysicalClearance = 0.012f;
            const float requiredHelmetProjectedClearance = 0.005f;
            const float requiredNeckProjectedClearance = 0.024f;
            var maximumOffset = MaximumBatterSpatialRetargetMetres;

            for (var iteration = 0; iteration < 6; iteration++)
            {
                var pointShift = candidate;
                // HelmetShell belongs to the hidden procedural fallback. Reconcile the measured centre/radius of
                // the admitted skinned helmet first, then the cervical envelope, against the same planted-body
                // translation. Both checks use the exact law-scale bat segment and locked gameplay camera.
                var correction = ClearanceCorrectionOnGround(
                    helmetOrigin + pointShift,
                    0.11f,
                    grip,
                    toe,
                    cameraPosition,
                    cameraRotation,
                    requiredPhysicalClearance,
                    requiredHelmetProjectedClearance);
                correction.y = 0f;
                pointShift += correction;
                correction += ClearanceCorrectionOnGround(
                    neckOrigin + pointShift,
                    0.075f,
                    grip,
                    toe,
                    cameraPosition,
                    cameraRotation,
                    requiredPhysicalClearance,
                    requiredNeckProjectedClearance);
                correction.y = 0f;
                if (correction.sqrMagnitude <= 0.000001f) break;
                correction = Vector3.ClampMagnitude(correction, 0.14f);
                if (candidate.magnitude >= maximumOffset - 0.0001f && maximumOffset > 0f)
                {
                    var radial = candidate.normalized;
                    var outward = Vector3.Dot(correction, radial);
                    if (outward > 0f) correction -= radial * outward;
                }
                candidate = Vector3.ClampMagnitude(candidate + correction, maximumOffset);
            }

            var bodyDelta = candidate * amount - originalOffset;
            bodyDelta.y = 0f;
            var leftShoulder = HeroJointWorldPosition(ProductionCharacterJoint.UpperArmLeft);
            var rightShoulder = HeroJointWorldPosition(ProductionCharacterJoint.UpperArmRight);
            var leftTarget = HeroBatterGripTargetWorld(true);
            var rightTarget = HeroBatterGripTargetWorld(false);
            var leftReach = HeroArmMaximumReach(true) + 0.0195f;
            var rightReach = HeroArmMaximumReach(false) + 0.0195f;
            for (var attempt = 0; attempt < 4; attempt++)
            {
                if (Vector3.Distance(leftShoulder + bodyDelta, leftTarget) <= leftReach &&
                    Vector3.Distance(rightShoulder + bodyDelta, rightTarget) <= rightReach)
                    break;
                bodyDelta *= 0.5f;
            }
            if (bodyDelta.sqrMagnitude <= 0.00000001f) return false;
            motionRoot.position += bodyDelta;
            return true;
        }

        private float HeroArmMaximumReach(bool left)
        {
            var upper = HeroJointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var forearm = HeroJointWorldPosition(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight);
            var hand = HeroJointWorldPosition(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
            return Vector3.Distance(upper, forearm) + Vector3.Distance(forearm, hand) - 0.0201f;
        }

        private static Vector3 ClearanceCorrectionOnGround(
            Vector3 point,
            float pointRadius,
            Vector3 segmentStart,
            Vector3 segmentEnd,
            Vector3 cameraPosition,
            Quaternion cameraRotation,
            float requiredPhysicalClearance,
            float requiredProjectedClearance)
        {
            var correction = Vector3.zero;
            const float derivativeStep = 0.005f;
            for (var pass = 0; pass < 2; pass++)
            {
                var shiftedPoint = point + correction;
                var physical = PhysicalSurfaceClearance(
                    shiftedPoint, pointRadius, segmentStart, segmentEnd);
                if (physical < requiredPhysicalClearance)
                {
                    var gradient = GroundClearanceGradient(
                        shiftedPoint,
                        derivativeStep,
                        value => PhysicalSurfaceClearance(
                            value, pointRadius, segmentStart, segmentEnd));
                    var gradientSquared = gradient.sqrMagnitude;
                    if (gradientSquared > 0.000001f)
                        correction += gradient *
                                      ((requiredPhysicalClearance - physical) / gradientSquared);
                }

                shiftedPoint = point + correction;
                var projected = ProjectedSurfaceClearance(
                    shiftedPoint,
                    pointRadius,
                    segmentStart,
                    segmentEnd,
                    cameraPosition,
                    cameraRotation);
                if (projected < requiredProjectedClearance)
                {
                    var gradient = GroundClearanceGradient(
                        shiftedPoint,
                        derivativeStep,
                        value => ProjectedSurfaceClearance(
                            value,
                            pointRadius,
                            segmentStart,
                            segmentEnd,
                            cameraPosition,
                            cameraRotation));
                    var gradientSquared = gradient.sqrMagnitude;
                    if (gradientSquared > 0.000001f)
                        correction += gradient *
                                      ((requiredProjectedClearance - projected) / gradientSquared);
                }
            }
            correction.y = 0f;
            return correction;
        }

        private static Vector3 GroundClearanceGradient(
            Vector3 point,
            float step,
            Func<Vector3, float> clearance)
        {
            var x = (clearance(point + Vector3.right * step) -
                     clearance(point - Vector3.right * step)) / (2f * step);
            var z = (clearance(point + Vector3.forward * step) -
                     clearance(point - Vector3.forward * step)) / (2f * step);
            return new Vector3(x, 0f, z);
        }

        private static float PhysicalSurfaceClearance(
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
            var closest = segmentStart + segment * along;
            return Vector3.Distance(point, closest) - pointRadius -
                   CricketPropDimensions.BladeWidth * 0.5f;
        }

        private static float ProjectedSurfaceClearance(
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
            var distance = Vector2.Distance(projectedPoint, projectedStart + segment * along);
            return distance - pointRadius / pointView.z -
                   CricketPropDimensions.BladeWidth * 0.5f /
                   Mathf.Min(startView.z, endView.z);
        }

        private void RetargetBatterUpperBodyToGrip(
            Vector3 leftTarget,
            Vector3 rightTarget,
            float weight)
        {
            var target = (leftTarget + rightTarget) * 0.5f;
            if (float.IsNaN(target.x) || float.IsInfinity(target.x) ||
                float.IsNaN(target.y) || float.IsInfinity(target.y) ||
                float.IsNaN(target.z) || float.IsInfinity(target.z)) return;
            var spine = joints[(int)ProductionCharacterJoint.Spine];
            var chest = joints[(int)ProductionCharacterJoint.Chest];
            var leftHand = joints[(int)ProductionCharacterJoint.HandLeft];
            var rightHand = joints[(int)ProductionCharacterJoint.HandRight];

            // If the admitted hero can already reach both ordered targets with its authored segment lengths, moving
            // the complete planted athlete only chases the held bat and can put the helmet into its terminal arc.
            // Retarget the body only for trace excursions which genuinely exceed at least one visible arm chain.
            if (bakedCharacter != null && bakedCharacter.UsesCompleteHeroBundle &&
                HeroArmCanReachTarget(true, leftTarget) &&
                HeroArmCanReachTarget(false, rightTarget))
                return;

            // The host body can follow line and length farther than the broad Unity footwork enum expresses.
            // Reconcile only part of the missing ground-plane component; the joined arm/scapular solve owns the
            // remainder so the complete support base is not dragged onto the handle. The sampler rewrites
            // MotionRoot before every canonical sample, so this is absolute per-sample alignment, never drift.
            // Vertical placement, authored foot articulation and the authoritative world root stay unchanged.
            var gripDelta = target - (leftHand.position + rightHand.position) * 0.5f;
            gripDelta.y = 0f;
            var spatialRetarget = Vector3.ClampMagnitude(
                gripDelta * BatterSpatialRetargetFraction * weight,
                MaximumBatterSpatialRetargetMetres * weight);
            motionRoot.position += spatialRetarget;

            // Turn the upper body modestly towards the handle while preserving authored pitch and roll. The old
            // FromToRotation aimed the vertical spine/shoulder vector directly at the grip, creating a severe
            // sideways lean and taking the helmet through the blade in late canonical samples.
            // Resolve both nested pivots from the same sampled source pose before mutating either one. Computing the
            // chest correction after rotating its spine parent made half coupling turn farther than full coupling in
            // one mirror: the first rotation changed the second pivot's frame and could reverse its signed angle.
            // Precomputing the two bounded yaw deltas keeps the canonical reconciliation proportional and mirrored.
            var bodyUp = rootObject.transform.up;
            var spineYaw = UpperBodyYawTowardGrip(
                spine, target, bodyUp, MaximumBatterSpineReachDegrees, weight);
            var chestYaw = UpperBodyYawTowardGrip(
                chest, target, bodyUp, MaximumBatterChestReachDegrees, weight);
            ApplyUpperBodyYaw(spine, bodyUp, spineYaw);
            ApplyUpperBodyYaw(chest, bodyUp, chestYaw);
        }

        private bool HeroArmCanReachTarget(bool left, Vector3 target)
        {
            var upper = bakedCharacter.HeroJointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var forearm = bakedCharacter.HeroJointWorldPosition(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight);
            var hand = bakedCharacter.HeroJointWorldPosition(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight);
            var authoredReach = Vector3.Distance(upper, forearm) +
                                Vector3.Distance(forearm, hand) - 0.0201f;
            return Vector3.Distance(upper, target) <= authoredReach;
        }

        private static float UpperBodyYawTowardGrip(
            Transform pivot,
            Vector3 target,
            Vector3 bodyUp,
            float maximumDegrees,
            float weight)
        {
            var current = Vector3.ProjectOnPlane(pivot.forward, bodyUp);
            var desired = Vector3.ProjectOnPlane(target - pivot.position, bodyUp);
            if (current.sqrMagnitude <= 0.000001f || desired.sqrMagnitude <= 0.000001f) return 0f;
            var signed = Vector3.SignedAngle(current.normalized, desired.normalized, bodyUp);
            return Mathf.Clamp(signed, -maximumDegrees, maximumDegrees) * Mathf.Clamp01(weight);
        }

        private static void ApplyUpperBodyYaw(Transform pivot, Vector3 bodyUp, float degrees)
        {
            if (Mathf.Abs(degrees) <= 0.0001f) return;
            pivot.rotation = Quaternion.AngleAxis(degrees, bodyUp) * pivot.rotation;
        }

        private void ApplyCanonicalBatterPostureToDrivers()
        {
            if (Role != ProductionCharacterRole.Batter || canonicalBatterCrouchMetres <= 0f || placedPackPose) return;
            var hips = joints[(int)ProductionCharacterJoint.Hips];
            var leftShin = joints[(int)ProductionCharacterJoint.ShinLeft];
            var rightShin = joints[(int)ProductionCharacterJoint.ShinRight];
            var leftFoot = joints[(int)ProductionCharacterJoint.FootLeft];
            var rightFoot = joints[(int)ProductionCharacterJoint.FootRight];
            var leftTarget = leftFoot.position;
            var rightTarget = rightFoot.position;
            var leftRotation = leftFoot.rotation;
            var rightRotation = rightFoot.rotation;
            var leftKneeReference = leftShin.position;
            var rightKneeReference = rightShin.position;

            // The root/motion root remains authoritative and unchanged. Only the pelvis joint descends; both
            // two-bone leg chains articulate back to their pre-crouch ankle anchors.
            hips.position += Vector3.down * canonicalBatterCrouchMetres;
            SolveLegToPlantedFoot(true, leftTarget, leftRotation, leftKneeReference);
            SolveLegToPlantedFoot(false, rightTarget, rightRotation, rightKneeReference);
        }

        private void SolveLegToPlantedFoot(
            bool left,
            Vector3 target,
            Quaternion targetRotation,
            Vector3 kneeReference)
        {
            var thigh = joints[(int)(left
                ? ProductionCharacterJoint.ThighLeft
                : ProductionCharacterJoint.ThighRight)];
            var shin = joints[(int)(left
                ? ProductionCharacterJoint.ShinLeft
                : ProductionCharacterJoint.ShinRight)];
            var foot = joints[(int)(left
                ? ProductionCharacterJoint.FootLeft
                : ProductionCharacterJoint.FootRight)];
            SolveTwoBonePlantedChain(
                thigh, shin, foot, target, targetRotation, kneeReference,
                rootObject.transform.forward);
        }

        internal static void SolveTwoBonePlantedChain(
            Transform upper,
            Transform lower,
            Transform end,
            Vector3 target,
            Quaternion targetRotation,
            Vector3 bendReference,
            Vector3 fallbackBendDirection)
        {
            if (upper == null || lower == null || end == null)
                throw new ArgumentNullException("A planted two-bone chain is incomplete.");
            var origin = upper.position;
            var reach = target - origin;
            var upperLength = Vector3.Distance(origin, lower.position);
            var lowerLength = Vector3.Distance(lower.position, end.position);
            if (upperLength <= 0.0001f || lowerLength <= 0.0001f || reach.sqrMagnitude <= 0.000001f)
                throw new InvalidOperationException("A planted two-bone chain is degenerate.");

            var direction = reach.normalized;
            var distance = Mathf.Clamp(
                reach.magnitude,
                Mathf.Abs(upperLength - lowerLength) + 0.0001f,
                upperLength + lowerLength);
            var cosine = Mathf.Clamp(
                (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
                (2f * upperLength * distance), -1f, 1f);
            var along = upperLength * cosine;
            var across = upperLength * Mathf.Sqrt(Mathf.Max(0f, 1f - cosine * cosine));
            var pole = bendReference - origin;
            pole -= direction * Vector3.Dot(pole, direction);
            if (pole.sqrMagnitude <= 0.000001f)
            {
                pole = fallbackBendDirection -
                       direction * Vector3.Dot(fallbackBendDirection, direction);
                if (pole.sqrMagnitude <= 0.000001f)
                    pole = Vector3.Cross(direction, Vector3.right);
            }
            pole.Normalize();
            var desiredJoint = origin + direction * along + pole * across;

            var currentUpper = lower.position - origin;
            var desiredUpper = desiredJoint - origin;
            upper.rotation = Quaternion.FromToRotation(
                currentUpper.normalized, desiredUpper.normalized) * upper.rotation;
            var currentLower = end.position - lower.position;
            var desiredLower = target - lower.position;
            lower.rotation = Quaternion.FromToRotation(
                currentLower.normalized, desiredLower.normalized) * lower.rotation;
            end.rotation = targetRotation;
        }

        /// <summary>
        /// Two-segment analytic reach for the generated fallback skeleton. It performs no allocation and operates
        /// only on presentation transforms; unreachable targets are clamped to the arm's measured world length.
        /// </summary>
        private void SolveArmToGrip(bool left, Vector3 target, Quaternion gripRotation, float weight,
            Vector3? poleOverride = null)
        {
            if (weight <= 0f) return;
            var upper = joints[(int)(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight)];
            var forearm = joints[(int)(left
                ? ProductionCharacterJoint.ForearmLeft
                : ProductionCharacterJoint.ForearmRight)];
            var hand = joints[(int)(left
                ? ProductionCharacterJoint.HandLeft
                : ProductionCharacterJoint.HandRight)];

            var shoulder = upper.position;
            var desiredHand = Vector3.Lerp(hand.position, target, weight);
            var reach = desiredHand - shoulder;
            var upperLength = Vector3.Distance(shoulder, forearm.position);
            var lowerLength = Vector3.Distance(forearm.position, hand.position);
            if (upperLength <= 0.0001f || lowerLength <= 0.0001f || reach.sqrMagnitude <= 0.000001f)
                return;

            var direction = reach.normalized;
            var distance = Mathf.Clamp(reach.magnitude,
                Mathf.Abs(upperLength - lowerLength) + 0.002f,
                upperLength + lowerLength - 0.002f);
            var cosine = Mathf.Clamp(
                (upperLength * upperLength + distance * distance - lowerLength * lowerLength) /
                (2f * upperLength * distance), -1f, 1f);
            var along = upperLength * cosine;
            var across = upperLength * Mathf.Sqrt(Mathf.Max(0f, 1f - cosine * cosine));

            var pole = poleOverride ?? rootObject.transform.forward +
                       rootObject.transform.right * (left ? 0.42f : -0.42f);
            pole -= direction * Vector3.Dot(pole, direction);
            if (pole.sqrMagnitude <= 0.000001f)
            {
                pole = Vector3.Cross(direction, rootObject.transform.up);
                if (pole.sqrMagnitude <= 0.000001f)
                    pole = rootObject.transform.right * (left ? 1f : -1f);
            }
            pole.Normalize();
            var desiredElbow = shoulder + direction * along + pole * across;

            var upperDirection = forearm.position - shoulder;
            var desiredUpperDirection = desiredElbow - shoulder;
            if (upperDirection.sqrMagnitude > 0.000001f && desiredUpperDirection.sqrMagnitude > 0.000001f)
            {
                upper.rotation = Quaternion.FromToRotation(
                    upperDirection.normalized, desiredUpperDirection.normalized) * upper.rotation;
            }

            var lowerDirection = hand.position - forearm.position;
            var desiredLowerDirection = desiredHand - forearm.position;
            if (lowerDirection.sqrMagnitude > 0.000001f && desiredLowerDirection.sqrMagnitude > 0.000001f)
            {
                forearm.rotation = Quaternion.FromToRotation(
                    lowerDirection.normalized, desiredLowerDirection.normalized) * forearm.rotation;
            }
            hand.rotation = Quaternion.Slerp(hand.rotation, gripRotation, weight * 0.68f);
        }

        private GameObject CreateLodPart(string name, Transform parent,
            ProductionMaterialKind material, Vector3 position, Vector3 scale, bool dome = false,
            ProductionMeshKind low = ProductionMeshKind.SphereLow,
            ProductionMeshKind high = ProductionMeshKind.SphereHigh)
        {
            if (dome)
            {
                low = ProductionMeshKind.DomeLow;
                high = ProductionMeshKind.DomeHigh;
            }
            var value = CreatePart(name, parent, low, material, position, scale, Quaternion.identity,
                ProductionCharacterDetail.Low);
            lodBindings.Add(new LodBinding
            {
                Filter = value.GetComponent<MeshFilter>(),
                Low = resources.Mesh(low),
                High = resources.Mesh(high)
            });
            return value;
        }

        private GameObject CreatePart(string name, Transform parent, ProductionMeshKind mesh,
            ProductionMaterialKind material, Vector3 position, Vector3 scale, Quaternion rotation,
            ProductionCharacterDetail requiredDetail)
        {
            var value = new GameObject(name);
            value.hideFlags = HideFlags.DontSave;
            value.transform.SetParent(parent, false);
            value.transform.localPosition = position;
            value.transform.localRotation = rotation;
            value.transform.localScale = scale;
            var filter = value.AddComponent<MeshFilter>();
            filter.sharedMesh = resources.Mesh(mesh);
            var renderer = value.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = resources.Material(material);
            renderer.allowOcclusionWhenDynamic = true;
            renderers.Add(renderer);
            namedParts.Add(name, value.transform);
            if (requiredDetail == ProductionCharacterDetail.Medium) mediumParts.Add(value);
            else if (requiredDetail == ProductionCharacterDetail.High) highParts.Add(value);
            return value;
        }

        private void CreatePartBetween(string name, Transform parent, Vector3 from, Vector3 to,
            float radius, ProductionMaterialKind material, ProductionCharacterDetail requiredDetail)
        {
            var delta = to - from;
            if (delta.sqrMagnitude <= 0.000001f) return;
            CreatePart(name, parent, ProductionMeshKind.CylinderLow, material, (from + to) * 0.5f,
                new Vector3(radius * 2f, delta.magnitude, radius * 2f),
                Quaternion.FromToRotation(Vector3.up, delta.normalized), requiredDetail);
        }

        private void ApplyDefaultPose()
        {
            var motion = ProductionCharacterMotion.Stand;
            if (Role == ProductionCharacterRole.Batter) motion = ProductionCharacterMotion.BatterStance;
            else if (Role == ProductionCharacterRole.Wicketkeeper) motion = ProductionCharacterMotion.KeeperCrouch;
            else if (Role == ProductionCharacterRole.Umpire) motion = ProductionCharacterMotion.UmpireStand;
            SampleAndApply(motion, 0f);
        }

        private void RequireBatter()
        {
            if (Role != ProductionCharacterRole.Batter)
                throw new InvalidOperationException("Batter presentation motion requires a batter rig.");
        }

        private void ThrowIfDisposed()
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionCharacterRig));
        }
    }
}
