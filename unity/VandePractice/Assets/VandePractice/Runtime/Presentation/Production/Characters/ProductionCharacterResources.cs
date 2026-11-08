using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.Rendering;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Presentation.Production.Characters
{
    internal delegate Texture2D ProductionCharacterTextureResourceLoader(string resourceKey);

    internal enum ProductionMeshKind
    {
        SphereLow,
        SphereHigh,
        CylinderLow,
        CylinderHigh,
        CapsuleLow,
        CapsuleHigh,
        Box,
        DomeLow,
        DomeHigh,
        Count
    }

    internal enum ProductionMaterialKind
    {
        Skin,
        SkinShade,
        Hair,
        EyeWhite,
        Iris,
        KitPrimary,
        KitSecondary,
        Trousers,
        Helmet,
        Pad,
        Glove,
        Shoe,
        Sole,
        Metal,
        BatWillow,
        BatEdge,
        BatGrip,
        BakedCharacter,
        HeroCharacter,
        HeroCharacterCloseUp,
        Count
    }

    /// <summary>
    /// One explicitly owned set of shared procedural meshes and materials. A team can share one set across every
    /// character, keeping geometry/material memory and state changes bounded. Dispose it only after its rigs.
    /// </summary>
    public sealed class ProductionCharacterResources : IDisposable
    {
        internal const string BakedSkinTextureResourceKey =
            "ProductionCharacters/human-skin-albedo-1024";
        internal const string HeroSkinTextureResourceKey =
            "ProductionCharacters/hero-skin-albedo-1024";
        internal const string HeroLiveSkinTextureResourceKey =
            "ProductionCharacters/hero-skin-albedo-512";
        internal const string HeroEyeTextureResourceKey =
            "ProductionCharacters/hero-eye-albedo-256";
        internal const string HeroKitNormalTextureResourceKey =
            "ProductionCharacters/hero-kit-normal";
        internal const string HeroKitAmbientOcclusionTextureResourceKey =
            "ProductionCharacters/hero-kit-ao";

        private sealed class BakedMeshPair
        {
            public Mesh High;
            public Mesh Low;
            public Mesh DistantPremium;
            public Mesh DistantBalanced;
        }

        internal sealed class HeroAdmissionCacheTransaction : IDisposable
        {
            private readonly ProductionCharacterResources owner;
            private readonly HashSet<string> meshKeys;
            private readonly HashSet<string> skeletonKeys;
            private readonly int decodeCount;
            private readonly int distantDecodeCount;
            private bool committed;
            private bool disposed;

            public HeroAdmissionCacheTransaction(ProductionCharacterResources owner)
            {
                this.owner = owner ?? throw new ArgumentNullException(nameof(owner));
                owner.ThrowIfDisposed();
                meshKeys = new HashSet<string>(owner.heroMeshes.Keys, StringComparer.Ordinal);
                skeletonKeys = new HashSet<string>(owner.heroSkeletons.Keys, StringComparer.Ordinal);
                decodeCount = owner.bakedMeshDecodeCount;
                distantDecodeCount = owner.distantLodDecodeCount;
            }

            public void Commit()
            {
                if (disposed) throw new ObjectDisposedException(nameof(HeroAdmissionCacheTransaction));
                committed = true;
            }

            public void Dispose()
            {
                if (disposed) return;
                disposed = true;
                if (committed || owner.disposed) return;

                var addedMeshes = new List<string>();
                foreach (var key in owner.heroMeshes.Keys)
                {
                    if (!meshKeys.Contains(key)) addedMeshes.Add(key);
                }
                for (var index = 0; index < addedMeshes.Count; index++)
                {
                    BakedMeshPair pair;
                    if (!owner.heroMeshes.TryGetValue(addedMeshes[index], out pair)) continue;
                    DestroyOwned(pair.High);
                    DestroyOwned(pair.Low);
                    DestroyOwned(pair.DistantPremium);
                    DestroyOwned(pair.DistantBalanced);
                    owner.heroMeshes.Remove(addedMeshes[index]);
                }

                var addedSkeletons = new List<string>();
                foreach (var key in owner.heroSkeletons.Keys)
                {
                    if (!skeletonKeys.Contains(key)) addedSkeletons.Add(key);
                }
                for (var index = 0; index < addedSkeletons.Count; index++)
                    owner.heroSkeletons.Remove(addedSkeletons[index]);
                owner.bakedMeshDecodeCount = decodeCount;
                owner.distantLodDecodeCount = distantDecodeCount;
            }
        }

        private readonly Mesh[] meshes = new Mesh[(int)ProductionMeshKind.Count];
        private readonly Material[] materials = new Material[(int)ProductionMaterialKind.Count];
        private readonly Dictionary<string, BakedMeshPair> bakedMeshes =
            new Dictionary<string, BakedMeshPair>(StringComparer.Ordinal);
        private readonly Dictionary<string, BakedMeshPair> heroMeshes =
            new Dictionary<string, BakedMeshPair>(StringComparer.Ordinal);
        private readonly Dictionary<string, ProductionHeroSkeletonDefinition> heroSkeletons =
            new Dictionary<string, ProductionHeroSkeletonDefinition>(StringComparer.Ordinal);
        private readonly ProductionCharacterPalette palette;
        private readonly ProductionCharacterTextureResourceLoader textureLoader;
        private int activeRigCount;
        private int bakedMeshDecodeCount;
        private int distantLodDecodeCount;
        private bool heroSkinTextureAvailable;
        private bool heroEyeTextureAvailable;
        private bool heroKitSurfaceTexturesAvailable;
        private bool disposed;

        public ProductionCharacterResources(ProductionCharacterPalette palette)
            : this(palette, key => Resources.Load<Texture2D>(key))
        {
        }

        internal ProductionCharacterResources(
            ProductionCharacterPalette palette,
            ProductionCharacterTextureResourceLoader textureLoader)
        {
            this.palette = palette;
            this.textureLoader = textureLoader ?? throw new ArgumentNullException(nameof(textureLoader));
            try
            {
                CreateMaterials();
                CreateMeshes();
            }
            catch
            {
                DestroyArrays();
                disposed = true;
                throw;
            }
        }

        public bool IsDisposed => disposed;
        public int ActiveRigCount => activeRigCount;
        internal bool HeroSkinTextureAvailable => !disposed && heroSkinTextureAvailable;
        internal bool HeroEyeTextureAvailable => !disposed && heroEyeTextureAvailable;
        internal bool HeroKitSurfaceTexturesAvailable => !disposed && heroKitSurfaceTexturesAvailable;
        internal int HeroCachedMeshSetCount => disposed ? 0 : heroMeshes.Count;
        internal int HeroCachedSkeletonCount => disposed ? 0 : heroSkeletons.Count;
        public int SharedMeshCount
        {
            get
            {
                if (disposed) return 0;
                var count = meshes.Length;
                foreach (var pair in bakedMeshes.Values)
                {
                    count += pair.High == null ? 0 : 1;
                    count += pair.Low == null ? 0 : 1;
                    count += pair.DistantPremium == null ? 0 : 1;
                    count += pair.DistantBalanced == null ? 0 : 1;
                }
                foreach (var pair in heroMeshes.Values)
                {
                    count += pair.High == null ? 0 : 1;
                    count += pair.Low == null ? 0 : 1;
                    count += pair.DistantPremium == null ? 0 : 1;
                    count += pair.DistantBalanced == null ? 0 : 1;
                }
                return count;
            }
        }
        public int SharedMaterialCount => disposed ? 0 : materials.Length;
        public int SharedBakedMeshSetCount => disposed ? 0 : bakedMeshes.Count + heroMeshes.Count;
        public int BakedMeshDecodeCount => disposed ? 0 : bakedMeshDecodeCount;
        public int DistantLodDecodeCount => disposed ? 0 : distantLodDecodeCount;
        public int SharedDistantBakedMeshCount
        {
            get
            {
                if (disposed) return 0;
                var count = 0;
                foreach (var pair in bakedMeshes.Values)
                {
                    count += pair.DistantPremium == null ? 0 : 1;
                    count += pair.DistantBalanced == null ? 0 : 1;
                }
                foreach (var pair in heroMeshes.Values)
                {
                    // The common hero uses DistantPremium internally for its live-bowler LOD. Only a complete
                    // premium+balanced pair is a fielder-distance allocation.
                    if (pair.DistantPremium != null && pair.DistantBalanced != null) count += 2;
                }
                return count;
            }
        }
        /// <summary>
        /// Unity Editor profiler size of the shared baked Mesh objects only. It deliberately excludes TextAssets,
        /// transient byte arrays, materials, renderers, skeleton objects and the rest of the world; it is neither a
        /// peak-memory number nor Android/device evidence.
        /// </summary>
        public long SharedBakedMeshObjectMemoryBytes
        {
            get
            {
                if (disposed) return 0L;
                long bytes = 0;
                foreach (var pair in bakedMeshes.Values)
                {
                    if (pair.High != null) bytes += Profiler.GetRuntimeMemorySizeLong(pair.High);
                    if (pair.Low != null) bytes += Profiler.GetRuntimeMemorySizeLong(pair.Low);
                    if (pair.DistantPremium != null)
                        bytes += Profiler.GetRuntimeMemorySizeLong(pair.DistantPremium);
                    if (pair.DistantBalanced != null)
                        bytes += Profiler.GetRuntimeMemorySizeLong(pair.DistantBalanced);
                }
                foreach (var pair in heroMeshes.Values)
                {
                    if (pair.High != null) bytes += Profiler.GetRuntimeMemorySizeLong(pair.High);
                    if (pair.Low != null) bytes += Profiler.GetRuntimeMemorySizeLong(pair.Low);
                    if (pair.DistantPremium != null)
                        bytes += Profiler.GetRuntimeMemorySizeLong(pair.DistantPremium);
                    if (pair.DistantBalanced != null)
                        bytes += Profiler.GetRuntimeMemorySizeLong(pair.DistantBalanced);
                }
                return bytes;
            }
        }
        public int SharedBakedVertexCount
        {
            get
            {
                if (disposed) return 0;
                var count = 0;
                foreach (var pair in bakedMeshes.Values)
                {
                    count += pair.High == null ? 0 : pair.High.vertexCount;
                    count += pair.Low == null ? 0 : pair.Low.vertexCount;
                    count += pair.DistantPremium == null ? 0 : pair.DistantPremium.vertexCount;
                    count += pair.DistantBalanced == null ? 0 : pair.DistantBalanced.vertexCount;
                }
                foreach (var pair in heroMeshes.Values)
                {
                    count += pair.High == null ? 0 : pair.High.vertexCount;
                    count += pair.Low == null ? 0 : pair.Low.vertexCount;
                    count += pair.DistantPremium == null ? 0 : pair.DistantPremium.vertexCount;
                    count += pair.DistantBalanced == null ? 0 : pair.DistantBalanced.vertexCount;
                }
                return count;
            }
        }

        internal Mesh Mesh(ProductionMeshKind kind)
        {
            ThrowIfDisposed();
            return meshes[(int)kind];
        }

        internal Material Material(ProductionMaterialKind kind)
        {
            ThrowIfDisposed();
            return materials[(int)kind];
        }

        internal HeroAdmissionCacheTransaction BeginHeroAdmissionCacheTransaction()
        {
            ThrowIfDisposed();
            return new HeroAdmissionCacheTransaction(this);
        }

        /// <summary>
        /// Decodes each immutable VPM asset once per explicitly owned team resource set. The first rig supplies the
        /// canonical 17-joint bind pose; every role then uses the same mesh objects with its own bone transform
        /// array. Distant fielder assets are added lazily. This prevents the eleven fielding characters from
        /// multiplying CPU/GPU geometry memory and keeps bowler-only resource owners free of fielder-only meshes.
        /// </summary>
        internal void GetOrCreateBakedMeshes(
            string resourceBase,
            TextAsset highAsset,
            TextAsset lowAsset,
            TextAsset distantPremiumAsset,
            TextAsset distantBalancedAsset,
            string displayName,
            Matrix4x4[] bindPoses,
            bool createDistantLods,
            out Mesh high,
            out Mesh low,
            out Mesh distantPremium,
            out Mesh distantBalanced)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceBase)) throw new ArgumentException("A resource key is required.", nameof(resourceBase));
            if (highAsset == null) throw new ArgumentNullException(nameof(highAsset));
            if (lowAsset == null) throw new ArgumentNullException(nameof(lowAsset));
            if (createDistantLods && distantPremiumAsset == null)
                throw new ArgumentNullException(nameof(distantPremiumAsset));
            if (createDistantLods && distantBalancedAsset == null)
                throw new ArgumentNullException(nameof(distantBalancedAsset));
            if (bindPoses == null || bindPoses.Length != (int)ProductionCharacterJoint.Count)
                throw new ArgumentException("The canonical character bind pose is incomplete.", nameof(bindPoses));

            BakedMeshPair cached;
            if (bakedMeshes.TryGetValue(resourceBase, out cached))
            {
                if (createDistantLods &&
                    (cached.DistantPremium == null || cached.DistantBalanced == null))
                {
                    if (cached.DistantPremium != null || cached.DistantBalanced != null)
                        throw new InvalidOperationException("The shared distant character LOD pair is incomplete.");
                    DecodeDistantLods(
                        distantPremiumAsset,
                        distantBalancedAsset,
                        displayName,
                        bindPoses,
                        out cached.DistantPremium,
                        out cached.DistantBalanced);
                    bakedMeshDecodeCount += 2;
                    distantLodDecodeCount += 2;
                }
                high = cached.High;
                low = cached.Low;
                distantPremium = cached.DistantPremium;
                distantBalanced = cached.DistantBalanced;
                return;
            }

            Mesh decodedHigh = null;
            Mesh decodedLow = null;
            Mesh decodedDistantPremium = null;
            Mesh decodedDistantBalanced = null;
            try
            {
                decodedHigh = ProductionBakedCharacterMesh.Decode(
                    highAsset.bytes, "VANDE " + displayName + " LOD0");
                decodedLow = ProductionBakedCharacterMesh.Decode(
                    lowAsset.bytes, "VANDE " + displayName + " LOD1");
                if (createDistantLods)
                {
                    DecodeDistantLods(
                        distantPremiumAsset,
                        distantBalancedAsset,
                        displayName,
                        bindPoses,
                        out decodedDistantPremium,
                        out decodedDistantBalanced);
                    bakedMeshDecodeCount += 2;
                    distantLodDecodeCount += 2;
                }
                bakedMeshDecodeCount += 2;
                decodedHigh.bindposes = bindPoses;
                decodedLow.bindposes = bindPoses;
                decodedHigh.UploadMeshData(true);
                decodedLow.UploadMeshData(true);
                bakedMeshes.Add(resourceBase, new BakedMeshPair
                {
                    High = decodedHigh,
                    Low = decodedLow,
                    DistantPremium = decodedDistantPremium,
                    DistantBalanced = decodedDistantBalanced
                });
                high = decodedHigh;
                low = decodedLow;
                distantPremium = decodedDistantPremium;
                distantBalanced = decodedDistantBalanced;
            }
            catch
            {
                DestroyOwned(decodedHigh);
                DestroyOwned(decodedLow);
                DestroyOwned(decodedDistantPremium);
                DestroyOwned(decodedDistantBalanced);
                throw;
            }
        }

        internal ProductionHeroSkeletonDefinition GetOrCreateHeroSkeleton(
            string resourceKey,
            TextAsset skeletonAsset)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceKey))
                throw new ArgumentException("A hero skeleton resource key is required.", nameof(resourceKey));
            if (skeletonAsset == null) throw new ArgumentNullException(nameof(skeletonAsset));
            ProductionHeroSkeletonDefinition cached;
            if (heroSkeletons.TryGetValue(resourceKey, out cached)) return cached;
            var decoded = ProductionHeroSkeletonDefinition.Decode(skeletonAsset.bytes);
            heroSkeletons.Add(resourceKey, decoded);
            return decoded;
        }

        /// <summary>
        /// Decodes one complete VPM3 hero LOD bundle per team resource set. The bundle is admitted atomically and is
        /// bound to the VSK1 identity before any mesh can become visible.
        /// </summary>
        internal void GetOrCreateHeroMeshes(
            string resourceBase,
            TextAsset highAsset,
            TextAsset lowAsset,
            TextAsset liveBowlerAsset,
            string displayName,
            ProductionHeroSkeletonDefinition skeleton,
            Matrix4x4[] bindPoses,
            out Mesh high,
            out Mesh low,
            out Mesh liveBowler)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceBase))
                throw new ArgumentException("A hero resource key is required.", nameof(resourceBase));
            if (highAsset == null) throw new ArgumentNullException(nameof(highAsset));
            if (lowAsset == null) throw new ArgumentNullException(nameof(lowAsset));
            if (liveBowlerAsset == null) throw new ArgumentNullException(nameof(liveBowlerAsset));
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (bindPoses == null || bindPoses.Length != skeleton.BoneCount)
                throw new ArgumentException("The hero bind pose is incomplete.", nameof(bindPoses));

            BakedMeshPair cached;
            if (heroMeshes.TryGetValue(resourceBase, out cached))
            {
                high = cached.High;
                low = cached.Low;
                liveBowler = cached.DistantPremium;
                return;
            }

            Mesh decodedHigh = null;
            Mesh decodedLow = null;
            Mesh decodedLiveBowler = null;
            try
            {
                var highResult = ProductionHeroCharacterMesh.Decode(
                    highAsset.bytes, "VANDE " + displayName + " LOD0", skeleton);
                decodedHigh = highResult.Mesh;
                var lowResult = ProductionHeroCharacterMesh.Decode(
                    lowAsset.bytes, "VANDE " + displayName + " LOD1", skeleton);
                decodedLow = lowResult.Mesh;
                var liveBowlerResult = ProductionHeroCharacterMesh.Decode(
                    liveBowlerAsset.bytes, "VANDE " + displayName + " LOD2", skeleton);
                decodedLiveBowler = liveBowlerResult.Mesh;
                if (highResult.SkeletonId != lowResult.SkeletonId ||
                    highResult.SkeletonId != liveBowlerResult.SkeletonId ||
                    highResult.BoneCount != lowResult.BoneCount ||
                    highResult.BoneCount != liveBowlerResult.BoneCount)
                    throw new InvalidOperationException("The hero LOD bundle does not share one skeleton identity.");
                decodedHigh.bindposes = bindPoses;
                decodedLow.bindposes = bindPoses;
                decodedLiveBowler.bindposes = bindPoses;
                decodedHigh.UploadMeshData(true);
                decodedLow.UploadMeshData(true);
                decodedLiveBowler.UploadMeshData(true);
                heroMeshes.Add(resourceBase, new BakedMeshPair
                {
                    High = decodedHigh,
                    Low = decodedLow,
                    DistantPremium = decodedLiveBowler
                });
                bakedMeshDecodeCount += 3;
                high = decodedHigh;
                low = decodedLow;
                liveBowler = decodedLiveBowler;
            }
            catch
            {
                DestroyOwned(decodedHigh);
                DestroyOwned(decodedLow);
                DestroyOwned(decodedLiveBowler);
                throw;
            }
        }

        /// <summary>
        /// Decodes the one protected CC0 eye mesh once per team resource set. The 96-vertex/172-triangle mesh is
        /// reused unchanged at every body LOD and remains bound to the same VSK1 identity as the admitted hero.
        /// </summary>
        internal Mesh GetOrCreateHeroEyeMesh(
            string resourceKey,
            TextAsset eyeAsset,
            string displayName,
            ProductionHeroSkeletonDefinition skeleton,
            Matrix4x4[] bindPoses)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceKey))
                throw new ArgumentException("A hero-eye resource key is required.", nameof(resourceKey));
            if (eyeAsset == null) throw new ArgumentNullException(nameof(eyeAsset));
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (bindPoses == null || bindPoses.Length != skeleton.BoneCount)
                throw new ArgumentException("The hero-eye bind pose is incomplete.", nameof(bindPoses));

            BakedMeshPair cached;
            if (heroMeshes.TryGetValue(resourceKey, out cached))
            {
                if (cached.High == null)
                    throw new InvalidOperationException("The shared hero-eye mesh is incomplete.");
                return cached.High;
            }

            Mesh decoded = null;
            try
            {
                var result = ProductionHeroCharacterMesh.Decode(
                    eyeAsset.bytes, "VANDE " + displayName, skeleton);
                decoded = result.Mesh;
                var triangles = decoded.subMeshCount == 0
                    ? 0
                    : checked((int)(decoded.GetIndexCount(0) / 3));
                if (result.SkeletonId != skeleton.SkeletonId ||
                    result.BoneCount != skeleton.BoneCount ||
                    decoded.vertexCount != ProductionHeroCharacterMesh.EyeVertexCount ||
                    triangles != ProductionHeroCharacterMesh.EyeTriangleCount)
                    throw new InvalidOperationException(
                        "The hero-eye mesh violates its skeleton or fixed topology contract.");
                var colours = decoded.colors32;
                var weights = decoded.boneWeights;
                if (colours.Length != decoded.vertexCount || weights.Length != decoded.vertexCount)
                    throw new InvalidOperationException("The hero-eye vertex records are incomplete.");
                for (var index = 0; index < decoded.vertexCount; index++)
                {
                    if (colours[index].r != ProductionHeroCharacterMesh.EyeShaderRegion ||
                        weights[index].boneIndex0 != ProductionHeroCharacterMesh.EyeHeadBoneIndex ||
                        Mathf.Abs(weights[index].weight0 - 1f) > 0.000001f ||
                        weights[index].weight1 > 0f || weights[index].weight2 > 0f ||
                        weights[index].weight3 > 0f)
                        throw new InvalidOperationException(
                            "The hero-eye mesh is not rigidly protected on the VSK1 head bone.");
                }
                decoded.bindposes = bindPoses;
                decoded.UploadMeshData(true);
                heroMeshes.Add(resourceKey, new BakedMeshPair { High = decoded });
                bakedMeshDecodeCount++;
                return decoded;
            }
            catch
            {
                DestroyOwned(decoded);
                throw;
            }
        }

        /// <summary>
        /// Lazily decodes the two field-only VPM3 LODs as their own cache transaction. Keeping this pair under a
        /// distinct key means a corrupt or incomplete fielder resource can never mutate an already admitted
        /// batter/bowler body set, and a rejected first keeper/fielder leaves no partial pair behind.
        /// </summary>
        internal void GetOrCreateHeroFielderMeshes(
            string resourceBase,
            TextAsset premiumAsset,
            TextAsset balancedLiteAsset,
            string displayName,
            ProductionHeroSkeletonDefinition skeleton,
            Matrix4x4[] bindPoses,
            out Mesh premium,
            out Mesh balancedLite)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceBase))
                throw new ArgumentException("A hero fielder resource key is required.", nameof(resourceBase));
            if (premiumAsset == null) throw new ArgumentNullException(nameof(premiumAsset));
            if (balancedLiteAsset == null) throw new ArgumentNullException(nameof(balancedLiteAsset));
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (bindPoses == null || bindPoses.Length != skeleton.BoneCount)
                throw new ArgumentException("The hero fielder bind pose is incomplete.", nameof(bindPoses));

            BakedMeshPair cached;
            if (heroMeshes.TryGetValue(resourceBase, out cached))
            {
                if (cached.DistantPremium == null || cached.DistantBalanced == null)
                    throw new InvalidOperationException("The shared hero fielder LOD pair is incomplete.");
                premium = cached.DistantPremium;
                balancedLite = cached.DistantBalanced;
                return;
            }

            Mesh decodedPremium = null;
            Mesh decodedBalancedLite = null;
            try
            {
                var premiumResult = ProductionHeroCharacterMesh.Decode(
                    premiumAsset.bytes, "VANDE " + displayName + " LOD3 Premium", skeleton);
                decodedPremium = premiumResult.Mesh;
                var balancedResult = ProductionHeroCharacterMesh.Decode(
                    balancedLiteAsset.bytes, "VANDE " + displayName + " LOD4 Balanced/Lite", skeleton);
                decodedBalancedLite = balancedResult.Mesh;
                if (premiumResult.SkeletonId != balancedResult.SkeletonId ||
                    premiumResult.BoneCount != balancedResult.BoneCount ||
                    premiumResult.BoneCount != ProductionHeroSkeletonDefinition.ExpectedBoneCount)
                    throw new InvalidOperationException(
                        "The hero fielder LOD pair does not share the exact 75-bone skeleton identity.");

                var premiumTriangles = checked((int)(decodedPremium.GetIndexCount(0) / 3));
                var balancedTriangles = checked((int)(decodedBalancedLite.GetIndexCount(0) / 3));
                if (premiumTriangles > ProductionBakedCharacterMesh.DistantPremiumBodyTriangleBudget ||
                    balancedTriangles > ProductionBakedCharacterMesh.DistantBalancedBodyTriangleBudget)
                    throw new InvalidOperationException("Hero fielder LOD exceeds its tier triangle budget.");

                decodedPremium.bindposes = bindPoses;
                decodedBalancedLite.bindposes = bindPoses;
                decodedPremium.UploadMeshData(true);
                decodedBalancedLite.UploadMeshData(true);
                heroMeshes.Add(resourceBase, new BakedMeshPair
                {
                    DistantPremium = decodedPremium,
                    DistantBalanced = decodedBalancedLite
                });
                bakedMeshDecodeCount += 2;
                distantLodDecodeCount += 2;
                premium = decodedPremium;
                balancedLite = decodedBalancedLite;
            }
            catch
            {
                DestroyOwned(decodedPremium);
                DestroyOwned(decodedBalancedLite);
                throw;
            }
        }

        /// <summary>
        /// Decodes the batter's two VPM3 equipment LODs as one skeleton-bound transaction. A cached partial pair is
        /// never returned, so the caller can keep the complete-batter admission decision atomic.
        /// </summary>
        internal void GetOrCreateHeroGearMeshes(
            string resourceBase,
            TextAsset highAsset,
            TextAsset liveAsset,
            string displayName,
            ProductionHeroSkeletonDefinition skeleton,
            Matrix4x4[] bindPoses,
            out Mesh high,
            out Mesh live)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceBase))
                throw new ArgumentException("A hero gear resource key is required.", nameof(resourceBase));
            if (highAsset == null) throw new ArgumentNullException(nameof(highAsset));
            if (liveAsset == null) throw new ArgumentNullException(nameof(liveAsset));
            if (skeleton == null) throw new ArgumentNullException(nameof(skeleton));
            if (bindPoses == null || bindPoses.Length != skeleton.BoneCount)
                throw new ArgumentException("The hero gear bind pose is incomplete.", nameof(bindPoses));

            BakedMeshPair cached;
            if (heroMeshes.TryGetValue(resourceBase, out cached))
            {
                if (cached.High == null || cached.Low == null)
                    throw new InvalidOperationException("The shared hero gear LOD pair is incomplete.");
                high = cached.High;
                live = cached.Low;
                return;
            }

            Mesh decodedHigh = null;
            Mesh decodedLive = null;
            try
            {
                var highResult = ProductionHeroCharacterMesh.Decode(
                    highAsset.bytes, "VANDE " + displayName + " LOD0", skeleton);
                decodedHigh = highResult.Mesh;
                var liveResult = ProductionHeroCharacterMesh.Decode(
                    liveAsset.bytes, "VANDE " + displayName + " LOD1", skeleton);
                decodedLive = liveResult.Mesh;
                if (highResult.SkeletonId != liveResult.SkeletonId ||
                    highResult.BoneCount != liveResult.BoneCount)
                    throw new InvalidOperationException("The hero gear LOD pair does not share one skeleton identity.");
                decodedHigh.bindposes = bindPoses;
                decodedLive.bindposes = bindPoses;
                decodedHigh.UploadMeshData(true);
                decodedLive.UploadMeshData(true);
                heroMeshes.Add(resourceBase, new BakedMeshPair
                {
                    High = decodedHigh,
                    Low = decodedLive
                });
                bakedMeshDecodeCount += 2;
                high = decodedHigh;
                live = decodedLive;
            }
            catch
            {
                DestroyOwned(decodedHigh);
                DestroyOwned(decodedLive);
                throw;
            }
        }

        /// <summary>Decodes the two static VBT1 bat LODs atomically for attachment to the existing bat root.</summary>
        internal void GetOrCreateHeroBatMeshes(
            string resourceBase,
            TextAsset highAsset,
            TextAsset liveAsset,
            string displayName,
            out Mesh high,
            out Mesh live)
        {
            ThrowIfDisposed();
            if (string.IsNullOrEmpty(resourceBase))
                throw new ArgumentException("A hero bat resource key is required.", nameof(resourceBase));
            if (highAsset == null) throw new ArgumentNullException(nameof(highAsset));
            if (liveAsset == null) throw new ArgumentNullException(nameof(liveAsset));

            BakedMeshPair cached;
            if (heroMeshes.TryGetValue(resourceBase, out cached))
            {
                if (cached.High == null || cached.Low == null)
                    throw new InvalidOperationException("The shared hero bat LOD pair is incomplete.");
                high = cached.High;
                live = cached.Low;
                return;
            }

            Mesh decodedHigh = null;
            Mesh decodedLive = null;
            try
            {
                decodedHigh = ProductionHeroBatMesh.Decode(
                    highAsset.bytes, "VANDE " + displayName + " LOD0");
                decodedLive = ProductionHeroBatMesh.Decode(
                    liveAsset.bytes, "VANDE " + displayName + " LOD1");
                decodedHigh.UploadMeshData(true);
                decodedLive.UploadMeshData(true);
                heroMeshes.Add(resourceBase, new BakedMeshPair
                {
                    High = decodedHigh,
                    Low = decodedLive
                });
                bakedMeshDecodeCount += 2;
                high = decodedHigh;
                live = decodedLive;
            }
            catch
            {
                DestroyOwned(decodedHigh);
                DestroyOwned(decodedLive);
                throw;
            }
        }

        private static void DecodeDistantLods(
            TextAsset premiumAsset,
            TextAsset balancedAsset,
            string displayName,
            Matrix4x4[] bindPoses,
            out Mesh distantPremium,
            out Mesh distantBalanced)
        {
            distantPremium = null;
            distantBalanced = null;
            try
            {
                // Offline deterministic manifold reductions preserve the licensed source's skin authority. They
                // are decoded only when a resource owner first creates an actual fielder; bowler-only owners do
                // not load or upload fielder-only geometry.
                distantPremium = ProductionBakedCharacterMesh.Decode(
                    premiumAsset.bytes, "VANDE " + displayName + " LOD2 Premium");
                distantBalanced = ProductionBakedCharacterMesh.Decode(
                    balancedAsset.bytes, "VANDE " + displayName + " LOD3 Balanced/Lite");
                var premiumTriangles = checked((int)(distantPremium.GetIndexCount(0) / 3));
                var balancedTriangles = checked((int)(distantBalanced.GetIndexCount(0) / 3));
                if (premiumTriangles > ProductionBakedCharacterMesh.DistantPremiumTriangleBudget ||
                    balancedTriangles > ProductionBakedCharacterMesh.DistantBalancedTriangleBudget)
                    throw new InvalidOperationException("Offline distant character LOD exceeds its tier budget.");
                distantPremium.bindposes = bindPoses;
                distantBalanced.bindposes = bindPoses;
                distantPremium.UploadMeshData(true);
                distantBalanced.UploadMeshData(true);
            }
            catch
            {
                DestroyOwned(distantPremium);
                DestroyOwned(distantBalanced);
                distantPremium = null;
                distantBalanced = null;
                throw;
            }
        }

        internal void Acquire()
        {
            ThrowIfDisposed();
            activeRigCount++;
        }

        internal void Release()
        {
            if (activeRigCount <= 0)
                throw new InvalidOperationException("Production character resource ownership is unbalanced.");
            activeRigCount--;
        }

        public void Dispose()
        {
            if (disposed) return;
            if (activeRigCount != 0)
                throw new InvalidOperationException("Dispose every production character rig before its shared resources.");

            disposed = true;
            DestroyArrays();
        }

        private void DestroyArrays()
        {
            foreach (var pair in bakedMeshes.Values)
            {
                DestroyOwned(pair.High);
                DestroyOwned(pair.Low);
                DestroyOwned(pair.DistantPremium);
                DestroyOwned(pair.DistantBalanced);
            }
            bakedMeshes.Clear();
            foreach (var pair in heroMeshes.Values)
            {
                DestroyOwned(pair.High);
                DestroyOwned(pair.Low);
                DestroyOwned(pair.DistantPremium);
                DestroyOwned(pair.DistantBalanced);
            }
            heroMeshes.Clear();
            heroSkeletons.Clear();
            heroSkinTextureAvailable = false;
            heroKitSurfaceTexturesAvailable = false;
            for (var index = 0; index < meshes.Length; index++)
            {
                DestroyOwned(meshes[index]);
                meshes[index] = null;
            }
            for (var index = 0; index < materials.Length; index++)
            {
                DestroyOwned(materials[index]);
                materials[index] = null;
            }
        }

        private void ThrowIfDisposed()
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionCharacterResources));
        }

        private void CreateMaterials()
        {
            materials[(int)ProductionMaterialKind.Skin] = NewMaterial("VANDE Character Skin", palette.Skin);
            materials[(int)ProductionMaterialKind.SkinShade] = NewMaterial("VANDE Character Skin Shade", palette.SkinShade);
            materials[(int)ProductionMaterialKind.Hair] = NewMaterial("VANDE Character Hair", palette.Hair);
            materials[(int)ProductionMaterialKind.EyeWhite] = NewMaterial("VANDE Character Eye White", new Color(0.90f, 0.88f, 0.82f));
            materials[(int)ProductionMaterialKind.Iris] = NewMaterial("VANDE Character Iris", palette.Iris);
            materials[(int)ProductionMaterialKind.KitPrimary] = NewMaterial("VANDE Original Kit Primary", palette.KitPrimary);
            materials[(int)ProductionMaterialKind.KitSecondary] = NewMaterial("VANDE Original Kit Secondary", palette.KitSecondary);
            materials[(int)ProductionMaterialKind.Trousers] = NewMaterial("VANDE Original Trousers", palette.Trousers);
            materials[(int)ProductionMaterialKind.Helmet] = NewMaterial("VANDE Original Helmet", palette.Helmet);
            materials[(int)ProductionMaterialKind.Pad] = NewMaterial("VANDE Original Pads", palette.Pad);
            materials[(int)ProductionMaterialKind.Glove] = NewMaterial("VANDE Original Gloves", palette.Glove);
            materials[(int)ProductionMaterialKind.Shoe] = NewMaterial("VANDE Original Shoes", palette.Shoe);
            materials[(int)ProductionMaterialKind.Sole] = NewMaterial("VANDE Original Soles", palette.Sole);
            materials[(int)ProductionMaterialKind.Metal] = NewMaterial("VANDE Equipment Metal", palette.Metal);
            materials[(int)ProductionMaterialKind.BatWillow] = NewMaterial(
                "VANDE Original Bat Willow", new Color(0.88f, 0.76f, 0.53f));
            materials[(int)ProductionMaterialKind.BatEdge] = NewMaterial(
                "VANDE Original Bat Edge", new Color(0.66f, 0.49f, 0.28f));
            materials[(int)ProductionMaterialKind.BatGrip] = NewMaterial(
                "VANDE Original Bat Grip", new Color(0.055f, 0.08f, 0.22f));
            ProductionVisualPrimitives.ApplyResourceTexture(
                materials[(int)ProductionMaterialKind.BatWillow],
                "Textures/bat-willow-albedo", Vector2.one);
            ProductionVisualPrimitives.ApplyResourceTexture(
                materials[(int)ProductionMaterialKind.BatEdge],
                "Textures/bat-willow-albedo", Vector2.one);
            var humanSkin = textureLoader(BakedSkinTextureResourceKey);
            var heroCloseUpSkin = textureLoader(HeroSkinTextureResourceKey);
            var heroLiveSkin = textureLoader(HeroLiveSkinTextureResourceKey);
            var heroEye = textureLoader(HeroEyeTextureResourceKey);
            heroSkinTextureAvailable = heroCloseUpSkin != null && heroLiveSkin != null;
            heroEyeTextureAvailable = heroEye != null;
            // The fitted hero uses the MakeHuman base-body UV atlas and tangent basis. The retained
            // male_casualsuit06 normal/AO pair was authored for a different garment atlas, so binding it here
            // would place seams and occlusion arbitrarily across the torso and legs. Keep the pair out of the
            // fitted-material readiness contract and fail closed to the shader's bind-position cloth detail.
            heroKitSurfaceTexturesAvailable = false;
            materials[(int)ProductionMaterialKind.BakedCharacter] = NewBakedCharacterMaterial(
                palette, humanSkin, null, null, null, "VANDE Baked Production Character");
            materials[(int)ProductionMaterialKind.HeroCharacter] = NewBakedCharacterMaterial(
                palette, heroLiveSkin, heroEye, null, null,
                "VANDE Licensed Hero Character Live 512");
            materials[(int)ProductionMaterialKind.HeroCharacterCloseUp] = NewBakedCharacterMaterial(
                palette, heroCloseUpSkin, heroEye, null, null,
                "VANDE Licensed Hero Character Close-Up 1024");
        }

        private static Material NewBakedCharacterMaterial(
            ProductionCharacterPalette value,
            Texture2D skinTexture,
            Texture2D eyeTexture,
            Texture2D kitNormalTexture,
            Texture2D kitAmbientOcclusionTexture,
            string materialName)
        {
            var shader = Resources.Load<Shader>("VandeProductionCharacter") ??
                         Shader.Find("Vande/Practice/Character");
            if (shader == null)
                throw new InvalidOperationException("The VANDE production character shader is unavailable.");
            var material = new Material(shader)
            {
                name = materialName,
                enableInstancing = true,
                hideFlags = HideFlags.DontSave
            };
            material.SetColor("_Skin", value.Skin);
            material.SetColor("_SkinShade", value.SkinShade);
            material.SetColor("_Hair", value.Hair);
            material.SetColor("_Iris", value.Iris);
            material.SetColor("_KitPrimary", value.KitPrimary);
            material.SetColor("_KitSecondary", value.KitSecondary);
            material.SetColor("_Trousers", value.Trousers);
            material.SetColor("_Helmet", value.Helmet);
            material.SetColor("_Pad", value.Pad);
            material.SetColor("_Glove", value.Glove);
            material.SetColor("_Shoe", value.Shoe);
            material.SetColor("_Sole", value.Sole);
            material.SetColor("_Strap", Color.Lerp(value.Trousers, value.Hair, 0.55f));
            material.SetColor("_Padding", Color.Lerp(value.Hair, value.Glove, 0.10f));
            material.SetColor("_Metal", value.Metal);
            // Explicit values keep WebGL, Android and editor previews on the same restrained material-readability
            // contract even if a future shader default is inspected or changed independently.
            material.SetFloat("_MinimumAmbient", 0.12f);
            material.SetFloat("_BroadcastFill", 0.42f);
            material.SetFloat("_SkinTextureExposure", 1.18f);
            material.SetFloat("_SkinPaletteTintStrength", 0.45f);
            material.SetFloat("_SkinShadowLift", 0.16f);
            material.SetFloat("_FaceReadability", 0.16f);
            material.SetFloat("_KitShadowLift", 0.04f);
            material.SetFloat("_KitNormalStrength", 0.24f);
            material.SetFloat("_KitAoStrength", 0.20f);
            material.SetFloat("_KitDetail", 0.72f);
            material.SetFloat("_HelmetNapeContrast", 0.26f);
            material.SetFloat("_CompressionSleeveEnabled", 1f);
            ConfigureBakedSkinTexture(material, skinTexture);
            ConfigureHeroEyeTexture(material, eyeTexture);
            ConfigureBakedKitSurfaceTextures(
                material, kitNormalTexture, kitAmbientOcclusionTexture);
            return material;
        }

        internal static void ConfigureBakedSkinTexture(Material material, Texture2D texture)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            if (!material.HasProperty("_SkinTex") || !material.HasProperty("_SkinTextureEnabled"))
                throw new InvalidOperationException("The VANDE character shader lacks its skin-texture contract.");

            // Absence is deliberately procedural, never Unity's implicit white texture. VPM1 vertices also carry
            // a zero UV-capability bit, so a complete retained fallback cannot accidentally sample this resource.
            material.SetFloat("_SkinTextureEnabled", texture == null ? 0f : 1f);
            material.SetTexture("_SkinTex", texture);
        }

        internal static void ConfigureHeroEyeTexture(Material material, Texture2D texture)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            if (!material.HasProperty("_EyeTex") || !material.HasProperty("_EyeTextureEnabled"))
                throw new InvalidOperationException(
                    "The VANDE character shader lacks its protected eye-texture contract.");

            // The region-16 renderer is admitted only with this pinned derivative. Null explicitly disables the
            // lookup so retained/anatomy fallbacks can never sample Unity's implicit white texture.
            material.SetFloat("_EyeTextureEnabled", texture == null ? 0f : 1f);
            material.SetTexture("_EyeTex", texture);
        }

        internal static void ConfigureBakedKitSurfaceTextures(
            Material material,
            Texture2D normalTexture,
            Texture2D ambientOcclusionTexture)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            if (!material.HasProperty("_KitNormalTex") ||
                !material.HasProperty("_KitAoTex") ||
                !material.HasProperty("_KitSurfaceEnabled"))
                throw new InvalidOperationException(
                    "The VANDE character shader lacks its kit-surface texture contract.");

            // A partial pair fails closed to the palette material. This avoids Unity's implicit normal/white
            // textures and ensures a missing resource cannot shade a different region or platform differently.
            var complete = normalTexture != null && ambientOcclusionTexture != null;
            material.SetFloat("_KitSurfaceEnabled", complete ? 1f : 0f);
            material.SetTexture("_KitNormalTex", complete ? normalTexture : null);
            material.SetTexture("_KitAoTex", complete ? ambientOcclusionTexture : null);
        }

        private void CreateMeshes()
        {
            meshes[(int)ProductionMeshKind.SphereLow] = CreateSphere("VANDE Shared Sphere Low", 8, 5);
            meshes[(int)ProductionMeshKind.SphereHigh] = CreateSphere("VANDE Shared Sphere High", 16, 10);
            meshes[(int)ProductionMeshKind.CylinderLow] = CreateCylinder("VANDE Shared Cylinder Low", 8);
            meshes[(int)ProductionMeshKind.CylinderHigh] = CreateCylinder("VANDE Shared Cylinder High", 16);
            meshes[(int)ProductionMeshKind.CapsuleLow] = CreateCapsule("VANDE Shared Capsule Low", 8, 2);
            meshes[(int)ProductionMeshKind.CapsuleHigh] = CreateCapsule("VANDE Shared Capsule High", 16, 4);
            meshes[(int)ProductionMeshKind.Box] = CreateBox("VANDE Shared Box");
            meshes[(int)ProductionMeshKind.DomeLow] = CreateDome("VANDE Shared Dome Low", 8, 3);
            meshes[(int)ProductionMeshKind.DomeHigh] = CreateDome("VANDE Shared Dome High", 16, 6);
        }

        private static Material NewMaterial(string name, Color color)
        {
            var shader = Shader.Find("Vande/Practice/Surface") ??
                         Shader.Find("Vande/Practice/Lit") ??
                         Shader.Find("Universal Render Pipeline/Lit") ??
                         Shader.Find("Standard") ?? Shader.Find("Unlit/Color");
            if (shader == null)
                throw new InvalidOperationException("No compatible character shader is available.");
            var material = new Material(shader)
            {
                name = name,
                color = color,
                enableInstancing = true,
                hideFlags = HideFlags.DontSave
            };
            if (material.HasProperty("_Smoothness"))
            {
                // Keep the low-byte procedural kit readable through physically distinct highlights. In particular,
                // the hard helmet must not merge into the fabric kit and the soft gloves must not read as plastic.
                var smoothness = name.Contains("Metal") ? 0.62f :
                    name.Contains("Helmet") ? 0.46f :
                    name.Contains("Pads") ? 0.31f :
                    name.Contains("Gloves") ? 0.18f : 0.24f;
                material.SetFloat("_Smoothness", smoothness);
            }
            return material;
        }

        private static Mesh CreateSphere(string name, int segments, int rings)
        {
            var columns = segments + 1;
            var vertices = new Vector3[(rings + 1) * columns];
            var normals = new Vector3[vertices.Length];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[rings * segments * 6];
            var vertex = 0;
            for (var ring = 0; ring <= rings; ring++)
            {
                var latitude = -Mathf.PI * 0.5f + Mathf.PI * ring / rings;
                var y = Mathf.Sin(latitude) * 0.5f;
                var radius = Mathf.Cos(latitude) * 0.5f;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var longitude = Mathf.PI * 2f * segment / segments;
                    var point = new Vector3(Mathf.Sin(longitude) * radius, y,
                        Mathf.Cos(longitude) * radius);
                    vertices[vertex] = point;
                    normals[vertex] = point.normalized;
                    uv[vertex] = new Vector2((float)segment / segments, (float)ring / rings);
                    vertex++;
                }
            }
            var triangle = 0;
            for (var ring = 0; ring < rings; ring++)
            for (var segment = 0; segment < segments; segment++)
            {
                var current = ring * columns + segment;
                var next = current + columns;
                triangles[triangle++] = current;
                triangles[triangle++] = next;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = next;
                triangles[triangle++] = next + 1;
            }
            return CreateMesh(name, vertices, normals, uv, triangles);
        }

        private static Mesh CreateDome(string name, int segments, int rings)
        {
            var columns = segments + 1;
            var vertices = new Vector3[(rings + 1) * columns];
            var normals = new Vector3[vertices.Length];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[rings * segments * 6];
            var vertex = 0;
            for (var ring = 0; ring <= rings; ring++)
            {
                var latitude = Mathf.PI * 0.5f * ring / rings;
                var y = Mathf.Sin(latitude) * 0.5f;
                var radius = Mathf.Cos(latitude) * 0.5f;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var longitude = Mathf.PI * 2f * segment / segments;
                    var point = new Vector3(Mathf.Sin(longitude) * radius, y,
                        Mathf.Cos(longitude) * radius);
                    vertices[vertex] = point;
                    normals[vertex] = point.normalized;
                    uv[vertex] = new Vector2((float)segment / segments, (float)ring / rings);
                    vertex++;
                }
            }
            var triangle = 0;
            for (var ring = 0; ring < rings; ring++)
            for (var segment = 0; segment < segments; segment++)
            {
                var current = ring * columns + segment;
                var next = current + columns;
                triangles[triangle++] = current;
                triangles[triangle++] = next;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = next;
                triangles[triangle++] = next + 1;
            }
            return CreateMesh(name, vertices, normals, uv, triangles);
        }

        private static Mesh CreateCylinder(string name, int segments)
        {
            // Two rings for the side plus independent cap centres/rings for correct hard-edge normals.
            var sideCount = (segments + 1) * 2;
            var capCount = (segments + 1) * 2 + 2;
            var vertices = new Vector3[sideCount + capCount];
            var normals = new Vector3[vertices.Length];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[segments * 12];
            var vertex = 0;
            for (var yIndex = 0; yIndex < 2; yIndex++)
            {
                var y = yIndex == 0 ? -0.5f : 0.5f;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var angle = Mathf.PI * 2f * segment / segments;
                    var normal = new Vector3(Mathf.Sin(angle), 0f, Mathf.Cos(angle));
                    vertices[vertex] = new Vector3(normal.x * 0.5f, y, normal.z * 0.5f);
                    normals[vertex] = normal;
                    uv[vertex] = new Vector2((float)segment / segments, yIndex);
                    vertex++;
                }
            }
            var sideBottom = 0;
            var sideTop = segments + 1;
            var bottomCentre = vertex++;
            vertices[bottomCentre] = new Vector3(0f, -0.5f, 0f);
            normals[bottomCentre] = Vector3.down;
            var bottomRing = vertex;
            for (var segment = 0; segment <= segments; segment++)
            {
                var angle = Mathf.PI * 2f * segment / segments;
                vertices[vertex] = new Vector3(Mathf.Sin(angle) * 0.5f, -0.5f,
                    Mathf.Cos(angle) * 0.5f);
                normals[vertex] = Vector3.down;
                vertex++;
            }
            var topCentre = vertex++;
            vertices[topCentre] = new Vector3(0f, 0.5f, 0f);
            normals[topCentre] = Vector3.up;
            var topRing = vertex;
            for (var segment = 0; segment <= segments; segment++)
            {
                var angle = Mathf.PI * 2f * segment / segments;
                vertices[vertex] = new Vector3(Mathf.Sin(angle) * 0.5f, 0.5f,
                    Mathf.Cos(angle) * 0.5f);
                normals[vertex] = Vector3.up;
                vertex++;
            }
            var triangle = 0;
            for (var segment = 0; segment < segments; segment++)
            {
                triangles[triangle++] = sideBottom + segment;
                triangles[triangle++] = sideTop + segment;
                triangles[triangle++] = sideBottom + segment + 1;
                triangles[triangle++] = sideBottom + segment + 1;
                triangles[triangle++] = sideTop + segment;
                triangles[triangle++] = sideTop + segment + 1;
                triangles[triangle++] = bottomCentre;
                triangles[triangle++] = bottomRing + segment + 1;
                triangles[triangle++] = bottomRing + segment;
                triangles[triangle++] = topCentre;
                triangles[triangle++] = topRing + segment;
                triangles[triangle++] = topRing + segment + 1;
            }
            return CreateMesh(name, vertices, normals, uv, triangles);
        }

        private static Mesh CreateCapsule(string name, int segments, int capRings)
        {
            // Unit-height rounded limb: broad shoulders retain the existing limb width while the short elliptical
            // caps remove the rigid cut ends. Non-uniform rig scaling then makes the cap curvature approximately
            // circular in world space for the authored arm and leg proportions.
            const float radius = 0.5f;
            const float capHeight = 0.18f;
            const float straightHalfHeight = 0.32f;
            var rows = capRings * 2 + 2;
            var columns = segments + 1;
            var vertices = new Vector3[rows * columns];
            var normals = new Vector3[vertices.Length];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[(rows - 1) * segments * 6];
            var vertex = 0;

            for (var row = 0; row < rows; row++)
            {
                float angle;
                float y;
                if (row <= capRings)
                {
                    var amount = (float)row / capRings;
                    angle = -Mathf.PI * 0.5f + Mathf.PI * 0.5f * amount;
                    y = -straightHalfHeight + Mathf.Sin(angle) * capHeight;
                }
                else
                {
                    var amount = (float)(row - capRings - 1) / capRings;
                    angle = Mathf.PI * 0.5f * amount;
                    y = straightHalfHeight + Mathf.Sin(angle) * capHeight;
                }

                var ringRadius = Mathf.Cos(angle) * radius;
                var normalRadial = Mathf.Cos(angle) / radius;
                var normalY = Mathf.Sin(angle) / capHeight;
                for (var segment = 0; segment <= segments; segment++)
                {
                    var longitude = Mathf.PI * 2f * segment / segments;
                    var sin = Mathf.Sin(longitude);
                    var cos = Mathf.Cos(longitude);
                    vertices[vertex] = new Vector3(sin * ringRadius, y, cos * ringRadius);
                    normals[vertex] = new Vector3(
                        sin * normalRadial,
                        normalY,
                        cos * normalRadial).normalized;
                    uv[vertex] = new Vector2((float)segment / segments, (float)row / (rows - 1));
                    vertex++;
                }
            }

            var triangle = 0;
            for (var row = 0; row < rows - 1; row++)
            for (var segment = 0; segment < segments; segment++)
            {
                var current = row * columns + segment;
                var next = current + columns;
                triangles[triangle++] = current;
                triangles[triangle++] = next;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = current + 1;
                triangles[triangle++] = next;
                triangles[triangle++] = next + 1;
            }

            return CreateMesh(name, vertices, normals, uv, triangles);
        }

        private static Mesh CreateBox(string name)
        {
            var vertices = new[]
            {
                new Vector3(-.5f,-.5f,.5f), new Vector3(.5f,-.5f,.5f), new Vector3(.5f,.5f,.5f), new Vector3(-.5f,.5f,.5f),
                new Vector3(.5f,-.5f,-.5f), new Vector3(-.5f,-.5f,-.5f), new Vector3(-.5f,.5f,-.5f), new Vector3(.5f,.5f,-.5f),
                new Vector3(-.5f,.5f,.5f), new Vector3(.5f,.5f,.5f), new Vector3(.5f,.5f,-.5f), new Vector3(-.5f,.5f,-.5f),
                new Vector3(-.5f,-.5f,-.5f), new Vector3(.5f,-.5f,-.5f), new Vector3(.5f,-.5f,.5f), new Vector3(-.5f,-.5f,.5f),
                new Vector3(.5f,-.5f,.5f), new Vector3(.5f,-.5f,-.5f), new Vector3(.5f,.5f,-.5f), new Vector3(.5f,.5f,.5f),
                new Vector3(-.5f,-.5f,-.5f), new Vector3(-.5f,-.5f,.5f), new Vector3(-.5f,.5f,.5f), new Vector3(-.5f,.5f,-.5f)
            };
            var normals = new Vector3[24];
            for (var index = 0; index < 4; index++) normals[index] = Vector3.forward;
            for (var index = 4; index < 8; index++) normals[index] = Vector3.back;
            for (var index = 8; index < 12; index++) normals[index] = Vector3.up;
            for (var index = 12; index < 16; index++) normals[index] = Vector3.down;
            for (var index = 16; index < 20; index++) normals[index] = Vector3.right;
            for (var index = 20; index < 24; index++) normals[index] = Vector3.left;
            var uv = new Vector2[24];
            var triangles = new int[36];
            for (var face = 0; face < 6; face++)
            {
                var v = face * 4;
                var t = face * 6;
                triangles[t] = v;
                triangles[t + 1] = v + 1;
                triangles[t + 2] = v + 2;
                triangles[t + 3] = v;
                triangles[t + 4] = v + 2;
                triangles[t + 5] = v + 3;
            }
            return CreateMesh(name, vertices, normals, uv, triangles);
        }

        private static Mesh CreateMesh(string name, Vector3[] vertices, Vector3[] normals,
            Vector2[] uv, int[] triangles)
        {
            var mesh = new Mesh
            {
                name = name,
                hideFlags = HideFlags.DontSave,
                indexFormat = vertices.Length > ushort.MaxValue ? IndexFormat.UInt32 : IndexFormat.UInt16
            };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            mesh.UploadMeshData(true);
            return mesh;
        }

        internal static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
#if UNITY_EDITOR
            if (!Application.isPlaying) UnityEngine.Object.DestroyImmediate(value);
            else UnityEngine.Object.Destroy(value);
#else
            UnityEngine.Object.Destroy(value);
#endif
        }
    }
}
