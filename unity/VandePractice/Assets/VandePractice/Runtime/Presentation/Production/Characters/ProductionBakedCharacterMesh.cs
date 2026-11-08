using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.Presentation.Production.Characters
{
    internal delegate TextAsset ProductionCharacterResourceLoader(string resourceKey);

    /// <summary>
    /// Identifies the geometry source selected for presentation diagnostics. This is provenance, not an art
    /// acceptance label: both imported and retained assets remain candidates until the independent gates pass.
    /// </summary>
    public enum ProductionCharacterMeshSource
    {
        None,
        LicensedAnatomyCandidate,
        RetainedProceduralCandidate,
        LicensedHeroCandidate
    }

    /// <summary>
    /// Loads bounded VPM1/VPM2 character candidates. A provenance-complete licensed anatomy derivative is preferred;
    /// VANDE's retained Three.js bake and then the complete procedural rig remain fail-closed fallbacks. Geometry is
    /// presentation data only: the existing Unity joints, motion sampler and canonical trace remain the sole runtime
    /// pose authorities.
    /// </summary>
    internal sealed class ProductionBakedCharacterMesh : IDisposable
    {
        private const ushort Vpm1FormatVersion = 1;
        private const ushort Vpm2FormatVersion = 2;
        private const ushort ExpectedBoneCount = (ushort)ProductionCharacterJoint.Count;
        private const int HeaderBytes = 16;
        private const int Vpm1VertexBytes = 44;
        private const int Vpm2VertexBytes = 52;
        private const int MaximumVertices = 65_535;
        private const int MaximumIndices = 200_000;
        internal const int DistantPremiumTriangleBudget = 2_000;
        internal const int DistantBalancedTriangleBudget = 1_200;
        internal const int RetainedFielderCapTriangleCount = 60;
        internal const int HeroEyeTriangleCount = ProductionHeroCharacterMesh.EyeTriangleCount;
        internal const int DistantPremiumBodyTriangleBudget =
            DistantPremiumTriangleBudget - RetainedFielderCapTriangleCount - HeroEyeTriangleCount;
        internal const int DistantBalancedBodyTriangleBudget =
            DistantBalancedTriangleBudget - RetainedFielderCapTriangleCount - HeroEyeTriangleCount;
        internal const float DistantLodMinimumDistanceMetres = 30f;
        internal const float GameplayBowlerLodMinimumDistanceMetres = 12f;

        private readonly GameObject gameObject;
        private readonly Mesh highMesh;
        private readonly Mesh lowMesh;
        private readonly Mesh distantPremiumMesh;
        private readonly Mesh distantBalancedMesh;
        private readonly Mesh heroLiveBowlerMesh;
        private readonly Mesh heroGearHighMesh;
        private readonly Mesh heroGearLiveMesh;
        private readonly Mesh heroBatHighMesh;
        private readonly Mesh heroBatLiveMesh;
        private readonly Material heroLiveMaterial;
        private readonly Material heroCloseUpMaterial;
        private readonly GameObject heroBatObject;
        private readonly MeshFilter heroBatFilter;
        private readonly ProductionCharacterRole role;
        private readonly ProductionCharacterMeshSource source;
        private readonly ProductionHeroSkeletonInstance heroSkeleton;
        private bool heroCloseUp;
        private bool disposed;

        private ProductionBakedCharacterMesh(
            GameObject gameObject,
            SkinnedMeshRenderer renderer,
            Mesh highMesh,
            Mesh lowMesh,
            Mesh distantPremiumMesh,
            Mesh distantBalancedMesh,
            ProductionCharacterRole role,
            ProductionCharacterMeshSource source,
            ProductionHeroSkeletonInstance heroSkeleton = null,
            Mesh heroLiveBowlerMesh = null,
            SkinnedMeshRenderer eyeRenderer = null,
            SkinnedMeshRenderer gearRenderer = null,
            Mesh heroGearHighMesh = null,
            Mesh heroGearLiveMesh = null,
            GameObject heroBatObject = null,
            MeshFilter heroBatFilter = null,
            MeshRenderer heroBatRenderer = null,
            Mesh heroBatHighMesh = null,
            Mesh heroBatLiveMesh = null,
            Material heroLiveMaterial = null,
            Material heroCloseUpMaterial = null)
        {
            this.gameObject = gameObject;
            Renderer = renderer;
            this.highMesh = highMesh;
            this.lowMesh = lowMesh;
            this.distantPremiumMesh = distantPremiumMesh;
            this.distantBalancedMesh = distantBalancedMesh;
            this.role = role;
            this.source = source;
            this.heroSkeleton = heroSkeleton;
            this.heroLiveBowlerMesh = heroLiveBowlerMesh;
            EyeRenderer = eyeRenderer;
            GearRenderer = gearRenderer;
            this.heroGearHighMesh = heroGearHighMesh;
            this.heroGearLiveMesh = heroGearLiveMesh;
            this.heroBatObject = heroBatObject;
            this.heroBatFilter = heroBatFilter;
            HeroBatRenderer = heroBatRenderer;
            this.heroBatHighMesh = heroBatHighMesh;
            this.heroBatLiveMesh = heroBatLiveMesh;
            this.heroLiveMaterial = heroLiveMaterial;
            this.heroCloseUpMaterial = heroCloseUpMaterial;
        }

        public SkinnedMeshRenderer Renderer { get; }
        public SkinnedMeshRenderer EyeRenderer { get; }
        public SkinnedMeshRenderer GearRenderer { get; }
        public MeshRenderer HeroBatRenderer { get; }
        public int HighVertexCount => disposed || highMesh == null ? 0 : highMesh.vertexCount;
        public int LowVertexCount => disposed || lowMesh == null ? 0 : lowMesh.vertexCount;
        public int HighTriangleCount => TriangleCount(highMesh);
        public int LowTriangleCount => TriangleCount(lowMesh);
        public int DistantPremiumTriangleCount => TriangleCount(distantPremiumMesh);
        public int DistantBalancedTriangleCount => TriangleCount(distantBalancedMesh);
        public int ActiveTriangleCount => disposed || Renderer == null
            ? 0
            : TriangleCount(Renderer.sharedMesh) +
              (EyeRenderer == null ? 0 : TriangleCount(EyeRenderer.sharedMesh)) +
              (GearRenderer == null ? 0 : TriangleCount(GearRenderer.sharedMesh)) +
              (heroBatFilter == null ? 0 : TriangleCount(heroBatFilter.sharedMesh));
        public int ActiveTotalTriangleCount => ActiveTriangleCount;
        public ProductionCharacterMeshSource Source => disposed
            ? ProductionCharacterMeshSource.None
            : source;
        public int HeroBoneCount => disposed || heroSkeleton == null ? 0 : heroSkeleton.BoneCount;
        /// <summary>The visible hero skeleton (arm tests and builder evidence); null without one.</summary>
        internal ProductionHeroSkeletonInstance HeroSkeleton => disposed ? null : heroSkeleton;
        public int HeroLiveBowlerTriangleCount => TriangleCount(heroLiveBowlerMesh);
        public bool UsesCompleteHeroBundle =>
            Source == ProductionCharacterMeshSource.LicensedHeroCandidate;
        public bool RequiresEquipmentOverlay =>
            Source == ProductionCharacterMeshSource.LicensedAnatomyCandidate;

        public static bool TryCreate(
            ProductionCharacterRole role,
            Transform parent,
            Transform[] bones,
            Transform batRoot,
            ProductionCharacterResources resources,
            ProductionCharacterResourceLoader resourceLoader,
            bool castShadows,
            out ProductionBakedCharacterMesh value)
        {
            value = null;
            if (parent == null || resources == null ||
                bones == null || bones.Length != ExpectedBoneCount)
                return false;
            if (resourceLoader == null) resourceLoader = DefaultResourceLoader;

            if (SupportsHero(role) && TryCreateHeroCandidate(
                    parent,
                    resources,
                    resourceLoader,
                    castShadows,
                    role,
                    batRoot,
                    out value))
                return true;

            if (SupportsLicensedAnatomy(role) && TryCreateCandidate(
                    "ProductionCharacters/human",
                    "licensed anatomy",
                    ProductionCharacterMeshSource.LicensedAnatomyCandidate,
                    parent,
                    bones,
                    resources,
                    resourceLoader,
                    castShadows,
                    role,
                    out value))
                return true;

            var retainedKey = RetainedResourceKey(role);
            return retainedKey != null && TryCreateCandidate(
                "Characters/" + retainedKey,
                "retained " + retainedKey,
                ProductionCharacterMeshSource.RetainedProceduralCandidate,
                parent,
                bones,
                resources,
                resourceLoader,
                castShadows,
                role,
                out value);
        }

        private static bool TryCreateCandidate(
            string resourceBase,
            string displayName,
            ProductionCharacterMeshSource source,
            Transform parent,
            Transform[] bones,
            ProductionCharacterResources resources,
            ProductionCharacterResourceLoader resourceLoader,
            bool castShadows,
            ProductionCharacterRole role,
            out ProductionBakedCharacterMesh value)
        {
            value = null;
            var highAsset = resourceLoader(resourceBase + "-lod0");
            var lowAsset = resourceLoader(resourceBase + "-lod1");
            var needsDistantLods = source == ProductionCharacterMeshSource.LicensedAnatomyCandidate &&
                                    role == ProductionCharacterRole.Fielder;
            var distantPremiumAsset = needsDistantLods
                ? resourceLoader(resourceBase + "-lod2")
                : null;
            var distantBalancedAsset = needsDistantLods
                ? resourceLoader(resourceBase + "-lod3")
                : null;
            if (highAsset == null && lowAsset == null) return false;
            if (highAsset == null || lowAsset == null ||
                (needsDistantLods && (distantPremiumAsset == null || distantBalancedAsset == null)))
            {
                Debug.LogWarning("VANDE " + displayName +
                                 " candidate is incomplete; trying the next complete character source.");
                return false;
            }

            Mesh high = null;
            Mesh low = null;
            Mesh distantPremium = null;
            Mesh distantBalanced = null;
            GameObject rendererObject = null;
            try
            {
                rendererObject = new GameObject("BakedCharacterMesh");
                rendererObject.hideFlags = HideFlags.DontSave;
                rendererObject.transform.SetParent(parent, false);

                var bindPoses = new Matrix4x4[bones.Length];
                for (var index = 0; index < bones.Length; index++)
                {
                    if (bones[index] == null)
                        throw new InvalidOperationException("The production character skeleton is incomplete.");
                    bindPoses[index] = bones[index].worldToLocalMatrix *
                                       rendererObject.transform.localToWorldMatrix;
                }
                resources.GetOrCreateBakedMeshes(
                    resourceBase,
                    highAsset,
                    lowAsset,
                    distantPremiumAsset,
                    distantBalancedAsset,
                    displayName,
                    bindPoses,
                    needsDistantLods,
                    out high,
                    out low,
                    out distantPremium,
                    out distantBalanced);

                var renderer = rendererObject.AddComponent<SkinnedMeshRenderer>();
                renderer.sharedMaterial = resources.Material(ProductionMaterialKind.BakedCharacter);
                renderer.sharedMesh = high;
                renderer.bones = bones;
                renderer.rootBone = bones[(int)ProductionCharacterJoint.Hips];
                renderer.updateWhenOffscreen = false;
                renderer.allowOcclusionWhenDynamic = true;
                renderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = castShadows;
                // Covers the complete authored stroke/bowling vocabulary without forcing per-frame bounds updates.
                renderer.localBounds = new Bounds(new Vector3(0f, 0.88f, 0f), new Vector3(2.4f, 2.35f, 2.4f));
                value = new ProductionBakedCharacterMesh(
                    rendererObject,
                    renderer,
                    high,
                    low,
                    distantPremium,
                    distantBalanced,
                    role,
                    source);
                return true;
            }
            catch (Exception error)
            {
                Debug.LogWarning("VANDE " + displayName +
                                 " candidate rejected; trying the next complete character source. " + error.Message);
                DestroyOwned(rendererObject);
                return false;
            }
        }

        private static bool TryCreateHeroCandidate(
            Transform parent,
            ProductionCharacterResources resources,
            ProductionCharacterResourceLoader resourceLoader,
            bool castShadows,
            ProductionCharacterRole role,
            Transform batRoot,
            out ProductionBakedCharacterMesh value)
        {
            value = null;
            var bundle = ProductionHeroBundleAssets.Load(resourceLoader, role);
            if (!bundle.AnyPresent) return false;
            if (!bundle.IsCompleteFor(role) ||
                (role == ProductionCharacterRole.Batter && batRoot == null))
            {
                Debug.LogWarning("VANDE licensed hero candidate is incomplete; trying the anatomy fallback.");
                return false;
            }
            if (!resources.HeroSkinTextureAvailable)
            {
                Debug.LogWarning("VANDE licensed hero skin texture is missing; trying the anatomy fallback.");
                return false;
            }
            if (!resources.HeroEyeTextureAvailable)
            {
                Debug.LogWarning("VANDE licensed hero eye texture is missing; trying the anatomy fallback.");
                return false;
            }

            ProductionHeroSkeletonInstance skeletonInstance = null;
            GameObject rendererObject = null;
            GameObject batObject = null;
            ProductionCharacterResources.HeroAdmissionCacheTransaction cacheTransaction = null;
            try
            {
                cacheTransaction = resources.BeginHeroAdmissionCacheTransaction();
                var skeleton = resources.GetOrCreateHeroSkeleton(
                    ProductionHeroSkeletonDefinition.ResourceKey, bundle.Skeleton);
                skeletonInstance = new ProductionHeroSkeletonInstance(parent, skeleton);
                rendererObject = new GameObject("BakedCharacterMesh");
                rendererObject.hideFlags = HideFlags.DontSave;
                rendererObject.transform.SetParent(parent, false);

                var heroBones = skeletonInstance.Bones;
                var bindPoses = new Matrix4x4[heroBones.Length];
                for (var index = 0; index < heroBones.Length; index++)
                {
                    if (heroBones[index] == null)
                        throw new InvalidOperationException("The hero character skeleton is incomplete.");
                    bindPoses[index] = heroBones[index].worldToLocalMatrix *
                                       rendererObject.transform.localToWorldMatrix;
                }

                Mesh high;
                Mesh low;
                Mesh liveBowler;
                Mesh distantFielderPremium = null;
                Mesh distantFielderBalancedLite = null;
                resources.GetOrCreateHeroMeshes(
                    ProductionHeroCharacterMesh.ResourceBase,
                    bundle.CloseUp,
                    bundle.LiveBatter,
                    bundle.LiveBowler,
                    "licensed hero",
                    skeleton,
                    bindPoses,
                    out high,
                    out low,
                    out liveBowler);
                var eyeMesh = resources.GetOrCreateHeroEyeMesh(
                    ProductionHeroCharacterMesh.EyeResourceKey,
                    bundle.Eyes,
                    "licensed hero eyes",
                    skeleton,
                    bindPoses);
                if (role == ProductionCharacterRole.Fielder ||
                    role == ProductionCharacterRole.Wicketkeeper)
                {
                    resources.GetOrCreateHeroFielderMeshes(
                        ProductionHeroCharacterMesh.ResourceBase + "-fielder",
                        bundle.DistantFielderPremium,
                        bundle.DistantFielderBalancedLite,
                        "licensed hero fielder",
                        skeleton,
                        bindPoses,
                        out distantFielderPremium,
                        out distantFielderBalancedLite);
                }

                Mesh gearHigh = null;
                Mesh gearLive = null;
                Mesh batHigh = null;
                Mesh batLive = null;
                if (role == ProductionCharacterRole.Batter)
                {
                    resources.GetOrCreateHeroGearMeshes(
                        ProductionHeroCharacterMesh.GearResourceBase,
                        bundle.GearCloseUp,
                        bundle.GearLiveBatter,
                        "original hero cricket gear",
                        skeleton,
                        bindPoses,
                        out gearHigh,
                        out gearLive);
                    resources.GetOrCreateHeroBatMeshes(
                        ProductionHeroBatMesh.ResourceBase,
                        bundle.BatCloseUp,
                        bundle.BatLiveBatter,
                        "original hero cricket bat",
                        out batHigh,
                        out batLive);
                }

                var renderer = rendererObject.AddComponent<SkinnedMeshRenderer>();
                var heroLiveMaterial = resources.Material(ProductionMaterialKind.HeroCharacter);
                var heroCloseUpMaterial = resources.Material(ProductionMaterialKind.HeroCharacterCloseUp);
                renderer.sharedMaterial = heroLiveMaterial;
                renderer.sharedMesh = high;
                renderer.bones = heroBones;
                renderer.rootBone = skeletonInstance.RootBone;
                renderer.updateWhenOffscreen = false;
                renderer.allowOcclusionWhenDynamic = true;
                renderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = castShadows;
                renderer.localBounds = new Bounds(new Vector3(0f, 0.88f, 0f), new Vector3(2.4f, 2.35f, 2.4f));

                var eyeObject = new GameObject("HeroEyeMesh");
                eyeObject.hideFlags = HideFlags.DontSave;
                eyeObject.transform.SetParent(rendererObject.transform, false);
                var eyeRenderer = eyeObject.AddComponent<SkinnedMeshRenderer>();
                eyeRenderer.sharedMaterial = heroLiveMaterial;
                eyeRenderer.sharedMesh = eyeMesh;
                eyeRenderer.bones = heroBones;
                eyeRenderer.rootBone = skeletonInstance.RootBone;
                eyeRenderer.updateWhenOffscreen = false;
                eyeRenderer.allowOcclusionWhenDynamic = true;
                eyeRenderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                eyeRenderer.receiveShadows = castShadows;
                // The shared body culling envelope is intentionally broad. Applying that 2.4 m envelope to the
                // eye-only renderer makes bounds diagnostics (and some platform culling paths) treat the eyeballs
                // as a three-metre object. VPM3 stores bind-space eye positions, so its decoded bounds already sit
                // around the head and remain sufficient for this rigid head-bone attachment.
                eyeRenderer.localBounds = eyeMesh.bounds;

                SkinnedMeshRenderer gearRenderer = null;
                MeshFilter batFilter = null;
                MeshRenderer batRenderer = null;
                if (role == ProductionCharacterRole.Batter)
                {
                    var gearObject = new GameObject("HeroCricketGearMesh");
                    gearObject.hideFlags = HideFlags.DontSave;
                    gearObject.transform.SetParent(rendererObject.transform, false);
                    gearRenderer = gearObject.AddComponent<SkinnedMeshRenderer>();
                    gearRenderer.sharedMaterial = heroLiveMaterial;
                    gearRenderer.sharedMesh = gearHigh;
                    gearRenderer.bones = heroBones;
                    gearRenderer.rootBone = skeletonInstance.RootBone;
                    gearRenderer.updateWhenOffscreen = false;
                    gearRenderer.allowOcclusionWhenDynamic = true;
                    gearRenderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    gearRenderer.receiveShadows = castShadows;
                    gearRenderer.localBounds = renderer.localBounds;

                    // Keep the established batRoot as the sole grip/physics/presentation transform. VBT1 replaces
                    // only its old render children, so shot traces, sweet spot and hand coupling remain unchanged.
                    batObject = new GameObject("HeroCricketBatMesh");
                    batObject.hideFlags = HideFlags.DontSave;
                    batObject.transform.SetParent(batRoot, false);
                    batFilter = batObject.AddComponent<MeshFilter>();
                    batFilter.sharedMesh = batHigh;
                    batRenderer = batObject.AddComponent<MeshRenderer>();
                    batRenderer.sharedMaterials = new[]
                    {
                        resources.Material(ProductionMaterialKind.BatWillow),
                        resources.Material(ProductionMaterialKind.BatEdge),
                        resources.Material(ProductionMaterialKind.BatGrip)
                    };
                    batRenderer.shadowCastingMode = castShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    batRenderer.receiveShadows = castShadows;
                }

                value = new ProductionBakedCharacterMesh(
                    rendererObject,
                    renderer,
                    high,
                    low,
                    distantFielderPremium,
                    distantFielderBalancedLite,
                    role,
                    ProductionCharacterMeshSource.LicensedHeroCandidate,
                    skeletonInstance,
                    liveBowler,
                    eyeRenderer,
                    gearRenderer,
                    gearHigh,
                    gearLive,
                    batObject,
                    batFilter,
                    batRenderer,
                    batHigh,
                    batLive,
                    heroLiveMaterial,
                    heroCloseUpMaterial);
                cacheTransaction.Commit();
                return true;
            }
            catch (Exception error)
            {
                Debug.LogWarning("VANDE licensed hero candidate rejected; trying the anatomy fallback. " +
                                 error.Message);
                if (skeletonInstance != null) skeletonInstance.Dispose();
                DestroyOwned(batObject);
                DestroyOwned(rendererObject);
                return false;
            }
            finally
            {
                cacheTransaction?.Dispose();
            }
        }

        public void SetPresentation(ProductionCharacterDetail detail, float distanceFromStrikerMetres)
        {
            if (disposed) return;
            if (Source == ProductionCharacterMeshSource.LicensedHeroCandidate)
            {
                Renderer.quality = ProductionHeroPresentationPolicy.SelectSkinQuality(role, detail);
                // The close-up mesh is opt-in and is never selected by distance. Normal live play uses a bounded
                // role-specific LOD even when the world's presentation tier is High.
                switch (ProductionHeroPresentationPolicy.SelectLod(
                            role, detail, heroCloseUp, distanceFromStrikerMetres))
                {
                    case ProductionHeroLodSelection.CloseUp:
                        Renderer.sharedMesh = highMesh;
                        SetHeroMaterial(heroCloseUpMaterial);
                        if (GearRenderer != null) GearRenderer.sharedMesh = heroGearHighMesh;
                        if (heroBatFilter != null) heroBatFilter.sharedMesh = heroBatHighMesh;
                        break;
                    case ProductionHeroLodSelection.LiveBatter:
                        Renderer.sharedMesh = lowMesh;
                        SetHeroMaterial(heroLiveMaterial);
                        if (GearRenderer == null || heroBatFilter == null ||
                            heroGearLiveMesh == null || heroBatLiveMesh == null)
                            throw new InvalidOperationException("The admitted batter hero bundle is incomplete.");
                        GearRenderer.sharedMesh = heroGearLiveMesh;
                        heroBatFilter.sharedMesh = heroBatLiveMesh;
                        break;
                    case ProductionHeroLodSelection.LiveBowler:
                        Renderer.sharedMesh = heroLiveBowlerMesh;
                        SetHeroMaterial(heroLiveMaterial);
                        break;
                    case ProductionHeroLodSelection.LiveLow:
                        Renderer.sharedMesh = heroLiveBowlerMesh;
                        SetHeroMaterial(heroLiveMaterial);
                        if (role == ProductionCharacterRole.Batter)
                        {
                            if (GearRenderer == null || heroBatFilter == null ||
                                heroGearLiveMesh == null || heroBatLiveMesh == null)
                                throw new InvalidOperationException("The admitted batter hero bundle is incomplete.");
                            GearRenderer.sharedMesh = heroGearLiveMesh;
                            heroBatFilter.sharedMesh = heroBatLiveMesh;
                        }
                        break;
                    case ProductionHeroLodSelection.DistantFielderPremium:
                        if (distantPremiumMesh == null || distantBalancedMesh == null)
                            throw new InvalidOperationException(
                                "The admitted fielder hero LOD pair is incomplete.");
                        Renderer.sharedMesh = distantPremiumMesh;
                        SetHeroMaterial(heroLiveMaterial);
                        break;
                    case ProductionHeroLodSelection.DistantFielderBalancedLite:
                        if (distantPremiumMesh == null || distantBalancedMesh == null)
                            throw new InvalidOperationException(
                                "The admitted fielder hero LOD pair is incomplete.");
                        Renderer.sharedMesh = distantBalancedMesh;
                        SetHeroMaterial(heroLiveMaterial);
                        break;
                    default:
                        throw new InvalidOperationException("The hero LOD selection is unsupported.");
                }
                return;
            }
            if (role == ProductionCharacterRole.Fielder &&
                distanceFromStrikerMetres >= DistantLodMinimumDistanceMetres &&
                distantPremiumMesh != null && distantBalancedMesh != null)
            {
                // The canonical LOD2 budget applies only at 30–60 m. Close catchers and ring fielders retain LOD1;
                // deep fielders never pay a hero-mesh cost even when the world's global quality tier is High.
                Renderer.sharedMesh = detail == ProductionCharacterDetail.High
                    ? distantPremiumMesh
                    : distantBalancedMesh;
                return;
            }

            if (role == ProductionCharacterRole.Fielder)
            {
                // The licensed mobile LOD1 is 4,000 triangles: within both the Premium 8k and Balanced 4k live-
                // delivery budgets for a close/ring fielder around 20 m.
                Renderer.sharedMesh = lowMesh;
                return;
            }

            if ((role == ProductionCharacterRole.PaceBowler ||
                 role == ProductionCharacterRole.SpinBowler) &&
                distanceFromStrikerMetres >= GameplayBowlerLodMinimumDistanceMetres)
            {
                // A live bowler is approximately 20 m from the striker. The register assigns that view LOD1
                // (Premium <=8k, Balanced <=4k), not the close-up/replay LOD0.
                Renderer.sharedMesh = lowMesh;
                return;
            }

            if (role == ProductionCharacterRole.Wicketkeeper)
            {
                // The standing-up keeper is excluded from the rear-shoulder camera; keep its collection silhouette
                // bounded until a future explicit close-up path supplies a measured distance/shot contract.
                Renderer.sharedMesh = lowMesh;
                return;
            }

            // Balanced/Medium uses the bounded mobile LOD. Only a non-distant Premium/High role pays LOD0 cost.
            Renderer.sharedMesh = detail == ProductionCharacterDetail.High ? highMesh : lowMesh;
        }

        private void SetHeroMaterial(Material material)
        {
            if (material == null)
                throw new InvalidOperationException("The admitted hero material tier is unavailable.");
            Renderer.sharedMaterial = material;
            if (EyeRenderer != null) EyeRenderer.sharedMaterial = material;
            if (GearRenderer != null) GearRenderer.sharedMaterial = material;
        }

        public void SetHeroCloseUp(bool value, ProductionCharacterDetail detail,
            float distanceFromStrikerMetres)
        {
            if (disposed) return;
            heroCloseUp = value;
            SetPresentation(detail, distanceFromStrikerMetres);
        }

        private int TriangleCount(Mesh mesh)
        {
            if (disposed || mesh == null || mesh.subMeshCount == 0) return 0;
            var count = 0;
            for (var index = 0; index < mesh.subMeshCount; index++)
                count = checked(count + (int)(mesh.GetIndexCount(index) / 3));
            return count;
        }

        /// <summary>Expensive diagnostics/test path; live rendering uses the conservative local culling bounds.</summary>
        public Bounds MeasureWorldBounds()
        {
            if (disposed) return new Bounds();
            var sampled = new Mesh { hideFlags = HideFlags.DontSave };
            try
            {
                Renderer.BakeMesh(sampled, false);
                var bounds = TransformBounds(sampled.bounds, Renderer.transform.localToWorldMatrix);
                if (EyeRenderer != null)
                {
                    EyeRenderer.BakeMesh(sampled, false);
                    bounds.Encapsulate(TransformBounds(
                        sampled.bounds, EyeRenderer.transform.localToWorldMatrix));
                }
                if (GearRenderer != null)
                {
                    GearRenderer.BakeMesh(sampled, false);
                    bounds.Encapsulate(TransformBounds(
                        sampled.bounds, GearRenderer.transform.localToWorldMatrix));
                }
                if (HeroBatRenderer != null && HeroBatRenderer.enabled &&
                    HeroBatRenderer.gameObject.activeInHierarchy)
                    bounds.Encapsulate(HeroBatRenderer.bounds);
                return bounds;
            }
            finally
            {
                DestroyOwned(sampled);
            }
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (heroSkeleton != null) heroSkeleton.Dispose();
            DestroyOwned(heroBatObject);
            DestroyOwned(gameObject);
        }

        /// <summary>Lengthens the hero's arm chains after binding (see ProductionHeroSkeletonInstance).</summary>
        public void LengthenHeroArms(Transform space, float targetChainLength)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.LengthenArmChains(space, targetChainLength);
        }

        public void SynchronizeHeroPose(
            Transform[] canonicalDrivers,
            ProductionHeroReferenceMotionLayer referenceMotion = null,
            ProductionCharacterMotion motion = ProductionCharacterMotion.Stand,
            float normalizedTime = 0f)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.Synchronize(canonicalDrivers);
            referenceMotion?.Apply(heroSkeleton, motion, normalizedTime);
        }

        public Vector3 HeroJointWorldPosition(ProductionCharacterJoint joint)
        {
            if (disposed || heroSkeleton == null)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return heroSkeleton.JointWorldPosition(joint);
        }

        public Quaternion HeroJointWorldRotation(ProductionCharacterJoint joint)
        {
            if (disposed || heroSkeleton == null)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return heroSkeleton.JointWorldRotation(joint);
        }

        public Vector3 HeroJointLocalPosition(ProductionCharacterJoint joint)
        {
            if (disposed || heroSkeleton == null)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return heroSkeleton.JointLocalPosition(joint);
        }

        public Vector3 HeroJointAuthoredLocalPosition(ProductionCharacterJoint joint)
        {
            if (disposed || heroSkeleton == null)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return heroSkeleton.JointAuthoredLocalPosition(joint);
        }

        public Vector3 HeroJointAuthoredWorldPosition(ProductionCharacterJoint joint)
        {
            if (disposed || heroSkeleton == null)
                throw new InvalidOperationException("This character does not have an active hero skeleton.");
            return heroSkeleton.JointAuthoredWorldPosition(joint);
        }

        public Vector3 HeroHelmetCentreWorld
        {
            get
            {
                if (disposed || heroSkeleton == null)
                    throw new InvalidOperationException("This character does not have an active hero skeleton.");
                // The original gear bundle is fitted to VSK1 head bone 11. This is the measured centre used by
                // the admitted helmet mesh, rather than the neck proxy or the hidden procedural fallback shell.
                return heroSkeleton.Bones[11].TransformPoint(
                    new Vector3(0f, 0.088756f, 0.025890f));
            }
        }

        public void ApplyHeroBatterGripIk(
            Vector3 leftTarget,
            Vector3 rightTarget,
            Quaternion wristRotation,
            Vector3 leftPole,
            Vector3 rightPole,
            float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            var amount = Mathf.Clamp01(weight);
            if (amount <= 0f) return;
            leftTarget = Vector3.Lerp(
                heroSkeleton.JointWorldPosition(ProductionCharacterJoint.HandLeft),
                leftTarget,
                amount);
            rightTarget = Vector3.Lerp(
                heroSkeleton.JointWorldPosition(ProductionCharacterJoint.HandRight),
                rightTarget,
                amount);
            heroSkeleton.PrepareBatterShoulderReach(true, leftTarget);
            heroSkeleton.PrepareBatterShoulderReach(false, rightTarget);
            var handleAxis = wristRotation * Vector3.down;
            var leftWrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(ProductionCharacterJoint.HandLeft),
                Quaternion.AngleAxis(11f, handleAxis) * wristRotation,
                amount);
            var rightWrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(ProductionCharacterJoint.HandRight),
                Quaternion.AngleAxis(-11f, handleAxis) * wristRotation,
                amount);
            heroSkeleton.SolveBatterArm(true, leftTarget, leftWrist, leftPole);
            heroSkeleton.SolveBatterArm(false, rightTarget, rightWrist, rightPole);
        }

        /// <summary>
        /// Transition-only two-hand solve. The displayed elbow centres are resolved poses, not pole guesses: retain
        /// their branch after the bounded clavicle/scapular reach has moved each shoulder. Computing this pole before
        /// reach can put it on the other side of the new shoulder-to-grip line and invert an otherwise continuous arm.
        /// Bat authority and the exact ordered grip targets are unchanged.
        /// </summary>
        public void ApplyHeroBatterGripIkPreservingResolvedElbows(
            Vector3 leftTarget,
            Vector3 rightTarget,
            Quaternion wristRotation,
            Vector3 leftSourceElbow,
            Vector3 rightSourceElbow,
            Vector3 leftTargetElbow,
            Vector3 rightTargetElbow,
            Vector3 leftFallbackPole,
            Vector3 rightFallbackPole,
            float previousTransitionWeight,
            float transitionWeight,
            float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            var amount = Mathf.Clamp01(weight);
            if (amount <= 0f) return;
            leftTarget = Vector3.Lerp(
                heroSkeleton.JointWorldPosition(ProductionCharacterJoint.HandLeft),
                leftTarget,
                amount);
            rightTarget = Vector3.Lerp(
                heroSkeleton.JointWorldPosition(ProductionCharacterJoint.HandRight),
                rightTarget,
                amount);
            heroSkeleton.PrepareBatterShoulderReach(true, leftTarget);
            heroSkeleton.PrepareBatterShoulderReach(false, rightTarget);

            var leftSourcePole = ResolvedElbowPoleAfterReach(
                true, leftTarget, leftSourceElbow, leftFallbackPole);
            var rightSourcePole = ResolvedElbowPoleAfterReach(
                false, rightTarget, rightSourceElbow, rightFallbackPole);
            var leftTargetPole = ResolvedElbowPoleAfterReach(
                true, leftTarget, leftTargetElbow, leftFallbackPole);
            var rightTargetPole = ResolvedElbowPoleAfterReach(
                false, rightTarget, rightTargetElbow, rightFallbackPole);
            var leftPole = BlendResolvedElbowPoles(
                true, leftTarget, leftSourcePole, leftTargetPole, leftFallbackPole,
                previousTransitionWeight, transitionWeight);
            var rightPole = BlendResolvedElbowPoles(
                false, rightTarget, rightSourcePole, rightTargetPole, rightFallbackPole,
                previousTransitionWeight, transitionWeight);
            var handleAxis = wristRotation * Vector3.down;
            var leftWrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(ProductionCharacterJoint.HandLeft),
                Quaternion.AngleAxis(11f, handleAxis) * wristRotation,
                amount);
            var rightWrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(ProductionCharacterJoint.HandRight),
                Quaternion.AngleAxis(-11f, handleAxis) * wristRotation,
                amount);
            heroSkeleton.SolveBatterArm(true, leftTarget, leftWrist, leftPole);
            heroSkeleton.SolveBatterArm(false, rightTarget, rightWrist, rightPole);
        }

        /// <summary>
        /// One-hand version of the batter grip solve for a running or walking batter carrying the bat. The free arm
        /// remains in the authored locomotion pose; solving it back onto the handle every frame made both elbows swap
        /// analytic IK branches as the gait crossed a straight arm. This is presentation-only and preserves the same
        /// no-wrist-translation rule as the normal two-hand batter solve.
        /// </summary>
        public void ApplyHeroBatterCarryGripIk(
            bool left,
            Vector3 target,
            Quaternion wristRotation,
            Vector3 pole,
            float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            var amount = Mathf.Clamp01(weight);
            if (amount <= 0f) return;
            var hand = left ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight;
            target = Vector3.Lerp(heroSkeleton.JointWorldPosition(hand), target, amount);
            heroSkeleton.PrepareBatterShoulderReach(left, target);
            var handleAxis = wristRotation * Vector3.down;
            var wrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(hand),
                Quaternion.AngleAxis(left ? 11f : -11f, handleAxis) * wristRotation,
                amount);
            heroSkeleton.SolveBatterArm(left, target, wrist, pole);
        }

        /// <summary>One-hand counterpart used when a locomotion carry itself changes pose source.</summary>
        public void ApplyHeroBatterCarryGripIkPreservingResolvedElbow(
            bool left,
            Vector3 target,
            Quaternion wristRotation,
            Vector3 sourceElbow,
            Vector3 targetElbow,
            Vector3 fallbackPole,
            float previousTransitionWeight,
            float transitionWeight,
            float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            var amount = Mathf.Clamp01(weight);
            if (amount <= 0f) return;
            var hand = left ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight;
            target = Vector3.Lerp(heroSkeleton.JointWorldPosition(hand), target, amount);
            heroSkeleton.PrepareBatterShoulderReach(left, target);
            var sourcePole = ResolvedElbowPoleAfterReach(left, target, sourceElbow, fallbackPole);
            var targetPole = ResolvedElbowPoleAfterReach(left, target, targetElbow, fallbackPole);
            var pole = BlendResolvedElbowPoles(
                left, target, sourcePole, targetPole, fallbackPole,
                previousTransitionWeight, transitionWeight);
            var handleAxis = wristRotation * Vector3.down;
            var wrist = Quaternion.Slerp(
                heroSkeleton.JointWorldRotation(hand),
                Quaternion.AngleAxis(left ? 11f : -11f, handleAxis) * wristRotation,
                amount);
            heroSkeleton.SolveBatterArm(left, target, wrist, pole);
        }

        private Vector3 ResolvedElbowPoleAfterReach(
            bool left,
            Vector3 target,
            Vector3 resolvedElbow,
            Vector3 fallbackPole)
        {
            var shoulder = heroSkeleton.JointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var reach = target - shoulder;
            if (reach.sqrMagnitude <= 0.000001f) return fallbackPole;
            var direction = reach.normalized;
            var pole = resolvedElbow - shoulder;
            pole -= direction * Vector3.Dot(pole, direction);
            if (pole.sqrMagnitude > 0.000001f) return pole.normalized;
            pole = fallbackPole - direction * Vector3.Dot(fallbackPole, direction);
            if (pole.sqrMagnitude > 0.000001f) return pole.normalized;
            pole = Vector3.Cross(direction, Vector3.up);
            return pole.sqrMagnitude > 0.000001f
                ? pole.normalized
                : Vector3.Cross(direction, Vector3.right).normalized;
        }

        private Vector3 BlendResolvedElbowPoles(
            bool left,
            Vector3 target,
            Vector3 sourcePole,
            Vector3 targetPole,
            Vector3 fallbackPole,
            float previousTransitionWeight,
            float transitionWeight)
        {
            var previous = Mathf.Clamp01(previousTransitionWeight);
            var current = Mathf.Clamp01(transitionWeight);
            if (current <= previous + 0.000001f) return sourcePole;
            if (current >= 1f) return targetPole;
            // Advance from the last actually displayed elbow by exactly the remaining fraction of the global inertial
            // handover. That makes the branch causal even though the target skeleton is rebuilt before every frame.
            var amount = Mathf.Clamp01((current - previous) / Mathf.Max(0.000001f, 1f - previous));
            var shoulder = heroSkeleton.JointWorldPosition(left
                ? ProductionCharacterJoint.UpperArmLeft
                : ProductionCharacterJoint.UpperArmRight);
            var reach = target - shoulder;
            if (reach.sqrMagnitude <= 0.000001f) return sourcePole;
            var direction = reach.normalized;
            var signedAngle = Vector3.SignedAngle(sourcePole, targetPole, direction);
            if (Mathf.Abs(signedAngle) >= 179f)
            {
                // Exactly opposite poles do not define a direction. Use the authored chest pole only to choose which
                // side of the arm axis the elbow travels around; the source and target resolved poses remain endpoints.
                var guide = fallbackPole - direction * Vector3.Dot(fallbackPole, direction);
                if (guide.sqrMagnitude <= 0.000001f) guide = Vector3.Cross(direction, sourcePole);
                var guideAngle = Vector3.SignedAngle(sourcePole, guide.normalized, direction);
                signedAngle = guideAngle < 0f ? -180f : 180f;
            }
            return (Quaternion.AngleAxis(signedAngle * amount, direction) * sourcePole).normalized;
        }

        public void ApplyHeroBatterPosture(
            float crouchMetres,
            Vector3 leftFootTarget,
            Vector3 rightFootTarget,
            Quaternion leftFootRotation,
            Quaternion rightFootRotation)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.ApplyBatterPosture(
                crouchMetres,
                leftFootTarget,
                rightFootTarget,
                leftFootRotation,
                rightFootRotation);
        }

        internal void ReapplyHeroBatterBalanceEnvelope(
            ProductionHeroReferenceMotionLayer referenceMotion,
            float normalizedTime)
        {
            if (disposed || heroSkeleton == null || referenceMotion == null) return;
            referenceMotion.ReapplyBatterBalanceEnvelope(heroSkeleton, normalizedTime);
        }

        public void AlignHeroBatterShoulderFrameYaw(Vector3 desiredSpan, float maximumDegrees, float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.AlignBatterShoulderFrameYaw(desiredSpan, maximumDegrees, weight);
        }

        public void AlignHeroBatterShoulderFrameHeight(float targetY, float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.AlignBatterShoulderFrameHeight(targetY, weight);
        }

        public void PlantHeroBatterFeet(
            Vector3 leftFootTarget,
            Vector3 rightFootTarget,
            Quaternion leftFootRotation,
            Quaternion rightFootRotation)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.PlantBatterFeet(
                leftFootTarget,
                rightFootTarget,
                leftFootRotation,
                rightFootRotation);
        }

        public void CaptureHeroBatterSupportLegPose(Quaternion[] rotations)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.CaptureBatterSupportLegPose(rotations);
        }

        public void RestoreHeroBatterSupportLegPose(Quaternion[] rotations, float weight = 1f)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.RestoreBatterSupportLegPose(rotations, weight);
        }

        public void ApplyHeroDeliveryArmIk(
            bool left,
            Vector3 target,
            Quaternion wristRotation,
            Vector3 pole)
        {
            if (disposed || heroSkeleton == null) return;
            heroSkeleton.SolveArmToTarget(left, target, wristRotation, pole);
        }

        private static bool SupportsHero(ProductionCharacterRole role)
        {
            return role == ProductionCharacterRole.Batter ||
                   role == ProductionCharacterRole.PaceBowler ||
                   role == ProductionCharacterRole.SpinBowler ||
                   role == ProductionCharacterRole.Wicketkeeper ||
                   role == ProductionCharacterRole.Fielder;
        }

        private static bool SupportsLicensedAnatomy(ProductionCharacterRole role)
        {
            return role == ProductionCharacterRole.Batter ||
                   role == ProductionCharacterRole.PaceBowler ||
                   role == ProductionCharacterRole.SpinBowler ||
                   role == ProductionCharacterRole.Wicketkeeper ||
                   role == ProductionCharacterRole.Fielder;
        }

        private static TextAsset DefaultResourceLoader(string resourceKey)
        {
            return Resources.Load<TextAsset>(resourceKey);
        }

        private static string RetainedResourceKey(ProductionCharacterRole role)
        {
            switch (role)
            {
                case ProductionCharacterRole.Batter: return "batter";
                case ProductionCharacterRole.PaceBowler:
                case ProductionCharacterRole.SpinBowler: return "bowler";
                default: return null;
            }
        }

        internal static Mesh Decode(byte[] bytes, string name)
        {
            if (bytes == null || bytes.Length < HeaderBytes)
                throw new InvalidOperationException("Character mesh data is missing or truncated.");
            var reader = new LittleEndianReader(bytes);
            if (reader.Byte() != (byte)'V' || reader.Byte() != (byte)'P' ||
                reader.Byte() != (byte)'M')
                throw new InvalidOperationException("Character mesh magic is invalid.");
            var formatSuffix = reader.Byte();
            var hasUv = formatSuffix == (byte)'2';
            if (!hasUv && formatSuffix != (byte)'1')
                throw new InvalidOperationException("Character mesh magic is invalid.");
            var expectedVersion = hasUv ? Vpm2FormatVersion : Vpm1FormatVersion;
            if (reader.UInt16() != expectedVersion)
                throw new InvalidOperationException("Character mesh version is unsupported.");
            if (reader.UInt16() != ExpectedBoneCount)
                throw new InvalidOperationException("Character mesh skeleton does not match the production rig.");
            var vertexCount = checked((int)reader.UInt32());
            var indexCount = checked((int)reader.UInt32());
            if (vertexCount < 3 || vertexCount > MaximumVertices ||
                indexCount < 3 || indexCount > MaximumIndices || indexCount % 3 != 0)
                throw new InvalidOperationException("Character mesh counts are outside the bounded contract.");
            var vertexBytes = hasUv ? Vpm2VertexBytes : Vpm1VertexBytes;
            var expectedLength = checked(HeaderBytes + vertexCount * vertexBytes + indexCount * 2);
            if (bytes.Length != expectedLength)
                throw new InvalidOperationException("Character mesh byte length does not match its header.");

            var positions = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var bindPositions = new Vector3[vertexCount];
            var textureCoordinates = hasUv ? new Vector2[vertexCount] : null;
            var colours = new Color32[vertexCount];
            var weights = new BoneWeight[vertexCount];
            for (var index = 0; index < vertexCount; index++)
            {
                positions[index] = reader.Vector3();
                normals[index] = reader.Vector3();
                bindPositions[index] = reader.Vector3();
                if (hasUv) textureCoordinates[index] = reader.Vector2();
                if (!Finite(positions[index]) || !Finite(normals[index]) || !Finite(bindPositions[index]) ||
                    (hasUv && !Finite(textureCoordinates[index])) ||
                    positions[index].sqrMagnitude > 100f || bindPositions[index].sqrMagnitude > 100f ||
                    normals[index].sqrMagnitude < 0.01f)
                    throw new InvalidOperationException("Character mesh contains an invalid vertex.");
                var region = reader.Byte();
                var bone0 = reader.Byte();
                var bone1 = reader.Byte();
                reader.Byte(); // reserved
                var weight0 = reader.UInt16();
                var weight1 = reader.UInt16();
                if (region > 16 || bone0 >= ExpectedBoneCount || bone1 >= ExpectedBoneCount ||
                    weight0 + weight1 == 0)
                    throw new InvalidOperationException("Character mesh contains an invalid skin binding.");
                var total = weight0 + weight1;
                weights[index] = new BoneWeight
                {
                    boneIndex0 = bone0,
                    boneIndex1 = bone1,
                    weight0 = (float)weight0 / total,
                    weight1 = (float)weight1 / total
                };
                // Green is an immutable per-vertex capability bit. A shared material may therefore serve both the
                // UV-bearing licensed VPM2 candidate and retained VPM1 fallback without sampling a texture at (0,0).
                colours[index] = new Color32(region, hasUv ? (byte)255 : (byte)0, 0, 255);
            }

            var triangles = new int[indexCount];
            for (var index = 0; index < indexCount; index++)
            {
                triangles[index] = reader.UInt16();
                if (triangles[index] >= vertexCount)
                    throw new InvalidOperationException("Character mesh index is outside its vertex buffer.");
            }
            if (!reader.AtEnd)
                throw new InvalidOperationException("Character mesh contains undeclared trailing bytes.");

            var mesh = new Mesh
            {
                name = name,
                hideFlags = HideFlags.DontSave,
                indexFormat = IndexFormat.UInt16
            };
            mesh.vertices = positions;
            mesh.normals = normals;
            mesh.colors32 = colours;
            if (hasUv) mesh.uv = textureCoordinates;
            mesh.SetUVs(1, new List<Vector3>(bindPositions));
            mesh.boneWeights = weights;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private static bool Finite(Vector3 value)
        {
            return !(float.IsNaN(value.x) || float.IsInfinity(value.x) ||
                     float.IsNaN(value.y) || float.IsInfinity(value.y) ||
                     float.IsNaN(value.z) || float.IsInfinity(value.z));
        }

        private static bool Finite(Vector2 value)
        {
            return !(float.IsNaN(value.x) || float.IsInfinity(value.x) ||
                     float.IsNaN(value.y) || float.IsInfinity(value.y));
        }

        private static Bounds TransformBounds(Bounds local, Matrix4x4 matrix)
        {
            var centre = matrix.MultiplyPoint3x4(local.center);
            var extents = local.extents;
            var axisX = matrix.MultiplyVector(new Vector3(extents.x, 0f, 0f));
            var axisY = matrix.MultiplyVector(new Vector3(0f, extents.y, 0f));
            var axisZ = matrix.MultiplyVector(new Vector3(0f, 0f, extents.z));
            var worldExtents = new Vector3(
                Mathf.Abs(axisX.x) + Mathf.Abs(axisY.x) + Mathf.Abs(axisZ.x),
                Mathf.Abs(axisX.y) + Mathf.Abs(axisY.y) + Mathf.Abs(axisZ.y),
                Mathf.Abs(axisX.z) + Mathf.Abs(axisY.z) + Mathf.Abs(axisZ.z));
            return new Bounds(centre, worldExtents * 2f);
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }

        private sealed class LittleEndianReader
        {
            private readonly byte[] bytes;
            private int offset;

            public LittleEndianReader(byte[] bytes) { this.bytes = bytes; }
            public bool AtEnd => offset == bytes.Length;
            public byte Byte() => bytes[offset++];

            public ushort UInt16()
            {
                var value = (ushort)(bytes[offset] | bytes[offset + 1] << 8);
                offset += 2;
                return value;
            }

            public uint UInt32()
            {
                var value = (uint)(bytes[offset] | bytes[offset + 1] << 8 |
                                   bytes[offset + 2] << 16 | bytes[offset + 3] << 24);
                offset += 4;
                return value;
            }

            public Vector3 Vector3()
            {
                return new Vector3(Single(), Single(), Single());
            }

            public Vector2 Vector2()
            {
                return new Vector2(Single(), Single());
            }

            private float Single()
            {
                if (!BitConverter.IsLittleEndian)
                    throw new PlatformNotSupportedException("VANDE character meshes require little-endian runtime data.");
                var value = BitConverter.ToSingle(bytes, offset);
                offset += 4;
                return value;
            }
        }
    }
}
