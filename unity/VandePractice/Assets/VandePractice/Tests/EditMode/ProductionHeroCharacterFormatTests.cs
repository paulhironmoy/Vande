using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    public sealed class ProductionHeroCharacterFormatTests
    {
        private const ulong SkeletonId = 0x8877665544332211UL;

        [Test]
        public void Vsk1Decoder_RequiresCompleteCanonicalSeventyFiveBoneHierarchy()
        {
            var definition = ProductionHeroSkeletonDefinition.Decode(BuildSkeleton());
            Assert.That(definition.BoneCount, Is.EqualTo(75));
            Assert.That(definition.SkeletonId, Is.EqualTo(SkeletonId));
            Assert.That(definition.Bones[0].ParentIndex, Is.EqualTo(-1));
            Assert.That(definition.Bones[16].SemanticId, Is.EqualTo(16));
            Assert.That(definition.Bones[17].SemanticId,
                Is.EqualTo(ProductionHeroSkeletonDefinition.NoDriverSemantic));
        }

        [Test]
        public void ShippedVsk1_HipsSemanticIsTheSingleRootAndOwnsTheFullCanonicalChain()
        {
            var asset = Resources.Load<TextAsset>(ProductionHeroSkeletonDefinition.ResourceKey);
            Assert.That(asset, Is.Not.Null, "the shipped hero bundle needs its VSK1 skeleton");
            var definition = ProductionHeroSkeletonDefinition.Decode(asset.bytes);

            var rootIndex = -1;
            var rootCount = 0;
            for (var index = 0; index < definition.BoneCount; index++)
            {
                if (definition.Bones[index].ParentIndex != -1) continue;
                rootIndex = index;
                rootCount++;
            }

            Assert.That(rootCount, Is.EqualTo(1));
            Assert.That(rootIndex, Is.Zero,
                "the source VSK root remains the skinned hierarchy root");
            Assert.That(definition.Bones[rootIndex].SemanticId,
                Is.EqualTo((ushort)ProductionCharacterJoint.Hips),
                "canonical hips authority must move the pelvis and legs, not only a torso descendant");

            for (var semantic = 0; semantic < (int)ProductionCharacterJoint.Count; semantic++)
            {
                var bone = FindSemanticBone(definition, semantic);
                Assert.That(IsDescendantOf(definition, bone, rootIndex), Is.True,
                    ((ProductionCharacterJoint)semantic) + " must descend from the semantic root");
            }
        }

        [Test]
        public void Vsk1Decoder_RejectsDuplicateSemanticAndNonTopologicalParent()
        {
            var duplicate = BuildSkeleton();
            duplicate[32 + 32 + 2] = 0;
            duplicate[32 + 32 + 3] = 0;
            Assert.That(() => ProductionHeroSkeletonDefinition.Decode(duplicate),
                Throws.InvalidOperationException.With.Message.Contains("semantic"));

            var cyclic = BuildSkeleton();
            cyclic[32 + 32] = 1;
            cyclic[32 + 32 + 1] = 0;
            Assert.That(() => ProductionHeroSkeletonDefinition.Decode(cyclic),
                Throws.InvalidOperationException.With.Message.Contains("parent"));
        }

        [Test]
        public void Vpm3Decoder_PreservesTangentsUvsAndFourNormalizedWeights()
        {
            var skeleton = ProductionHeroSkeletonDefinition.Decode(BuildSkeleton());
            var decoded = ProductionHeroCharacterMesh.Decode(BuildTriangle(), "VPM3 test", skeleton);
            try
            {
                Assert.That(decoded.SkeletonId, Is.EqualTo(SkeletonId));
                Assert.That(decoded.BoneCount, Is.EqualTo(75));
                Assert.That(decoded.Mesh.vertexCount, Is.EqualTo(3));
                Assert.That(decoded.Mesh.tangents, Has.Length.EqualTo(3));
                Assert.That(decoded.Mesh.tangents[0], Is.EqualTo(new Vector4(1f, 0f, 0f, 1f)));
                Assert.That(decoded.Mesh.uv[1], Is.EqualTo(new Vector2(1f, 0f)));
                Assert.That(decoded.Mesh.boneWeights[0].weight0, Is.EqualTo(1f));
                Assert.That(decoded.Mesh.boneWeights[0].boneIndex0, Is.Zero);
                Assert.That(decoded.Mesh.colors32[0].g, Is.EqualTo(byte.MaxValue));
            }
            finally
            {
                Object.DestroyImmediate(decoded.Mesh);
            }
        }

        [Test]
        public void Vpm3Decoder_FailsClosedOnSkeletonIdentityWeightOrLengthMismatch()
        {
            var skeleton = ProductionHeroSkeletonDefinition.Decode(BuildSkeleton());

            var eyeRegion = BuildTriangle();
            eyeRegion[32 + 60] = ProductionHeroCharacterMesh.EyeShaderRegion;
            var decodedEyeRegion = ProductionHeroCharacterMesh.Decode(
                eyeRegion, "protected eye region", skeleton);
            Object.DestroyImmediate(decodedEyeRegion.Mesh);

            var unsupportedRegion = BuildTriangle();
            unsupportedRegion[32 + 60] = ProductionHeroCharacterMesh.EyeShaderRegion + 1;
            Assert.That(() => ProductionHeroCharacterMesh.Decode(
                    unsupportedRegion, "unsupported region", skeleton),
                Throws.InvalidOperationException.With.Message.Contains("vertex"));

            var wrongIdentity = BuildTriangle();
            wrongIdentity[20] ^= 0xff;
            Assert.That(() => ProductionHeroCharacterMesh.Decode(wrongIdentity, "identity", skeleton),
                Throws.InvalidOperationException.With.Message.Contains("identity"));

            var wrongWeights = BuildTriangle();
            wrongWeights[32 + 65] = 254;
            Assert.That(() => ProductionHeroCharacterMesh.Decode(wrongWeights, "weights", skeleton),
                Throws.InvalidOperationException.With.Message.Contains("skin binding"));

            var exact = BuildTriangle();
            var truncated = new byte[exact.Length - 1];
            Array.Copy(exact, truncated, truncated.Length);
            Assert.That(() => ProductionHeroCharacterMesh.Decode(truncated, "truncated", skeleton),
                Throws.InvalidOperationException.With.Message.Contains("byte length"));
        }

        [Test]
        public void ShippedHeroAssets_MeetExactCompleteBatterBudgetsAndFourInfluenceBodyContract()
        {
            var skeletonAsset = RequiredTextAsset(ProductionHeroSkeletonDefinition.ResourceKey);
            var skeleton = ProductionHeroSkeletonDefinition.Decode(skeletonAsset.bytes);
            var eyes = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset(ProductionHeroCharacterMesh.EyeResourceKey).bytes,
                "shipped shared hero eyes", skeleton);
            var closeBody = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-lod0").bytes,
                "shipped close batter", skeleton);
            var batter = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-lod1").bytes,
                "shipped live batter", skeleton);
            var bowler = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-lod2").bytes,
                "shipped live bowler", skeleton);
            var distantPremium = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-lod3").bytes,
                "shipped distant premium fielder", skeleton);
            var distantBalancedLite = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-lod4").bytes,
                "shipped distant balanced/lite fielder", skeleton);
            var gear = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-gear-lod1").bytes,
                "shipped live batter gear", skeleton);
            var closeGear = ProductionHeroCharacterMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-gear-lod0").bytes,
                "shipped close batter gear", skeleton);
            var bat = ProductionHeroBatMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-bat-lod1").bytes,
                "shipped live batter bat");
            var closeBat = ProductionHeroBatMesh.Decode(
                RequiredTextAsset("ProductionCharacters/hero-bat-lod0").bytes,
                "shipped close batter bat");
            try
            {
                Assert.That(eyes.Mesh.vertexCount,
                    Is.EqualTo(ProductionHeroCharacterMesh.EyeVertexCount));
                Assert.That(TriangleCount(eyes.Mesh),
                    Is.EqualTo(ProductionHeroCharacterMesh.EyeTriangleCount));
                var batterTriangles = TriangleCount(batter.Mesh) + TriangleCount(eyes.Mesh) +
                                      TriangleCount(gear.Mesh) +
                                      TriangleCount(bat);
                Assert.That(batterTriangles, Is.EqualTo(7_639),
                    "live complete batter is body + protected eyes + helmet/pads/gloves + bat");
                Assert.That(batterTriangles, Is.LessThanOrEqualTo(8_000),
                    "the live batter budget includes body, helmet, pads, gloves and bat");
                var closeTriangles = TriangleCount(closeBody.Mesh) + TriangleCount(eyes.Mesh) +
                                     TriangleCount(closeGear.Mesh) +
                                     TriangleCount(closeBat);
                Assert.That(closeTriangles, Is.EqualTo(39_454));
                Assert.That(closeTriangles, Is.LessThanOrEqualTo(40_000),
                    "the explicit close-up complete batter stays inside its registered Premium ceiling");
                Assert.That(MaxPositiveInfluences(closeBody.Mesh), Is.EqualTo(4));
                Assert.That(MaxPositiveInfluences(batter.Mesh), Is.EqualTo(4),
                    "the foreground batter retains all four fixed VPM3 influence slots");
                Assert.That(MaxPositiveInfluences(bowler.Mesh), Is.EqualTo(4),
                    "the live bowler asset retains authored deformation data even when runtime quality is bounded");
                Assert.That(TriangleCount(distantPremium.Mesh),
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantPremiumBodyTriangleBudget));
                Assert.That(TriangleCount(distantBalancedLite.Mesh),
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantBalancedBodyTriangleBudget));
                Assert.That(MaxPositiveInfluences(distantPremium.Mesh), Is.EqualTo(4));
                Assert.That(MaxPositiveInfluences(distantBalancedLite.Mesh), Is.EqualTo(4));
                Assert.That(MaxPositiveInfluences(gear.Mesh), Is.EqualTo(1),
                    "each protective-equipment component is rigidly bound to one owning bone");
            }
            finally
            {
                Object.DestroyImmediate(batter.Mesh);
                Object.DestroyImmediate(eyes.Mesh);
                Object.DestroyImmediate(closeBody.Mesh);
                Object.DestroyImmediate(bowler.Mesh);
                Object.DestroyImmediate(distantPremium.Mesh);
                Object.DestroyImmediate(distantBalancedLite.Mesh);
                Object.DestroyImmediate(gear.Mesh);
                Object.DestroyImmediate(closeGear.Mesh);
                Object.DestroyImmediate(bat);
                Object.DestroyImmediate(closeBat);
            }
        }

        [Test]
        public void HeroSkeletonInstance_MapsCanonicalDriversWithoutChangingTheirAuthority()
        {
            var host = new GameObject("Hero skeleton host");
            var drivers = new Transform[(int)ProductionCharacterJoint.Count];
            ProductionHeroSkeletonInstance instance = null;
            try
            {
                for (var index = 0; index < drivers.Length; index++)
                {
                    var driver = new GameObject("Driver-" + index);
                    driver.transform.SetParent(host.transform, false);
                    drivers[index] = driver.transform;
                }
                drivers[(int)ProductionCharacterJoint.Head].localRotation = Quaternion.Euler(5f, 12f, -2f);
                var expectedDriverRotation = drivers[(int)ProductionCharacterJoint.Head].localRotation;

                instance = new ProductionHeroSkeletonInstance(
                    host.transform, ProductionHeroSkeletonDefinition.Decode(BuildSkeleton()));
                instance.Synchronize(drivers);

                Assert.That(instance.BoneCount, Is.EqualTo(75));
                Assert.That(instance.Bones[(int)ProductionCharacterJoint.Head].localRotation.eulerAngles.y,
                    Is.EqualTo(expectedDriverRotation.eulerAngles.y).Within(0.01f));
                Assert.That(drivers[(int)ProductionCharacterJoint.Head].localRotation,
                    Is.EqualTo(expectedDriverRotation), "presentation mapping must never feed back into authority");
            }
            finally
            {
                if (instance != null) instance.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void HeroBundle_BatterRequiresCommonBodyGearAndBatWithExactResourceNames()
        {
            var assets = new Dictionary<string, TextAsset>
            {
                { "ProductionCharacters/hero-skeleton", new TextAsset("skeleton") },
                { "ProductionCharacters/hero-eyes", new TextAsset("eyes") },
                { "ProductionCharacters/hero-lod0", new TextAsset("close") },
                { "ProductionCharacters/hero-lod1", new TextAsset("batter") },
                { "ProductionCharacters/hero-lod2", new TextAsset("bowler") },
                { "ProductionCharacters/hero-gear-lod0", new TextAsset("gear close") },
                { "ProductionCharacters/hero-gear-lod1", new TextAsset("gear live") },
                { "ProductionCharacters/hero-bat-lod0", new TextAsset("bat close") },
                { "ProductionCharacters/hero-bat-lod1", new TextAsset("bat live") }
            };
            try
            {
                var requested = new List<string>();
                var complete = ProductionHeroBundleAssets.Load(key =>
                {
                    requested.Add(key);
                    TextAsset value;
                    return assets.TryGetValue(key, out value) ? value : null;
                }, ProductionCharacterRole.Batter);
                Assert.That(complete.AnyPresent, Is.True);
                Assert.That(complete.CommonComplete, Is.True);
                Assert.That(complete.BatterComplete, Is.True);
                Assert.That(complete.IsCompleteFor(ProductionCharacterRole.Batter), Is.True);
                Assert.That(requested, Is.EqualTo(new[]
                {
                    "ProductionCharacters/hero-skeleton",
                    "ProductionCharacters/hero-eyes",
                    "ProductionCharacters/hero-lod0",
                    "ProductionCharacters/hero-lod1",
                    "ProductionCharacters/hero-lod2",
                    "ProductionCharacters/hero-gear-lod0",
                    "ProductionCharacters/hero-gear-lod1",
                    "ProductionCharacters/hero-bat-lod0",
                    "ProductionCharacters/hero-bat-lod1"
                }));

                var eyeAsset = assets["ProductionCharacters/hero-eyes"];
                assets.Remove("ProductionCharacters/hero-eyes");
                var missingEyes = ProductionHeroBundleAssets.Load(key =>
                {
                    TextAsset value;
                    return assets.TryGetValue(key, out value) ? value : null;
                }, ProductionCharacterRole.Batter);
                Assert.That(missingEyes.CommonComplete, Is.False,
                    "the protected eye mesh is part of common atomic hero admission");
                Assert.That(missingEyes.BatterComplete, Is.False);
                assets.Add("ProductionCharacters/hero-eyes", eyeAsset);

                Object.DestroyImmediate(assets["ProductionCharacters/hero-bat-lod1"]);
                assets.Remove("ProductionCharacters/hero-bat-lod1");
                var partial = ProductionHeroBundleAssets.Load(key =>
                {
                    TextAsset value;
                    return assets.TryGetValue(key, out value) ? value : null;
                }, ProductionCharacterRole.Batter);
                Assert.That(partial.AnyPresent, Is.True);
                Assert.That(partial.CommonComplete, Is.True);
                Assert.That(partial.BatterComplete, Is.False,
                    "one missing batter asset must reject the complete hero atomically");
            }
            finally
            {
                foreach (var asset in assets.Values) Object.DestroyImmediate(asset);
            }
        }

        [Test]
        public void HeroBundle_BowlerRequiresOnlyTheCommonBodyAndEyeAssets()
        {
            var requested = new List<string>();
            var assets = new List<TextAsset>();
            try
            {
                var bundle = ProductionHeroBundleAssets.Load(key =>
                {
                    requested.Add(key);
                    var asset = new TextAsset(key);
                    assets.Add(asset);
                    return asset;
                }, ProductionCharacterRole.PaceBowler);
                Assert.That(bundle.CommonComplete, Is.True);
                Assert.That(bundle.IsCompleteFor(ProductionCharacterRole.PaceBowler), Is.True);
                Assert.That(requested, Is.EqualTo(new[]
                {
                    "ProductionCharacters/hero-skeleton",
                    "ProductionCharacters/hero-eyes",
                    "ProductionCharacters/hero-lod0",
                    "ProductionCharacters/hero-lod1",
                    "ProductionCharacters/hero-lod2"
                }), "bowler admission must not depend on batter-only gear or bat resources");
            }
            finally
            {
                foreach (var asset in assets) Object.DestroyImmediate(asset);
            }
        }

        [Test]
        public void HeroBundle_FielderAtomicallyRequiresBothDistanceLodsInAdditionToCommonBody()
        {
            var assets = new Dictionary<string, TextAsset>();
            foreach (var key in new[]
                     {
                         "ProductionCharacters/hero-skeleton",
                         "ProductionCharacters/hero-eyes",
                         "ProductionCharacters/hero-lod0",
                         "ProductionCharacters/hero-lod1",
                         "ProductionCharacters/hero-lod2",
                         "ProductionCharacters/hero-lod3",
                         "ProductionCharacters/hero-lod4"
                     })
                assets.Add(key, new TextAsset(key));
            try
            {
                ProductionCharacterResourceLoader loader = key =>
                {
                    TextAsset value;
                    return assets.TryGetValue(key, out value) ? value : null;
                };
                var complete = ProductionHeroBundleAssets.Load(loader, ProductionCharacterRole.Fielder);
                Assert.That(complete.CommonComplete, Is.True);
                Assert.That(complete.FielderComplete, Is.True);
                Assert.That(complete.IsCompleteFor(ProductionCharacterRole.Fielder), Is.True);

                Object.DestroyImmediate(assets["ProductionCharacters/hero-lod4"]);
                assets.Remove("ProductionCharacters/hero-lod4");
                var partial = ProductionHeroBundleAssets.Load(loader, ProductionCharacterRole.Fielder);
                Assert.That(partial.CommonComplete, Is.True,
                    "a fielder-only omission must not invalidate another role's common body family");
                Assert.That(partial.FielderComplete, Is.False);
                Assert.That(partial.IsCompleteFor(ProductionCharacterRole.Fielder), Is.False,
                    "one missing fielder LOD rejects the fielder role atomically");
                Assert.That(partial.IsCompleteFor(ProductionCharacterRole.PaceBowler), Is.True);
            }
            finally
            {
                foreach (var asset in assets.Values) Object.DestroyImmediate(asset);
            }
        }

        [Test]
        public void Vbt1Decoder_PreservesTangentsUvsAndThreeMaterialSubmeshes()
        {
            var mesh = ProductionHeroBatMesh.Decode(BuildBat(), "VBT1 test");
            try
            {
                Assert.That(mesh.vertexCount, Is.EqualTo(9));
                Assert.That(mesh.subMeshCount, Is.EqualTo(3));
                Assert.That(mesh.GetIndexCount(0), Is.EqualTo(3));
                Assert.That(mesh.GetIndexCount(1), Is.EqualTo(3));
                Assert.That(mesh.GetIndexCount(2), Is.EqualTo(3));
                Assert.That(mesh.tangents[0], Is.EqualTo(new Vector4(1f, 0f, 0f, 1f)));
                Assert.That(mesh.uv[1], Is.EqualTo(Vector2.right));
            }
            finally
            {
                Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void Vbt1Decoder_FailsClosedOnVersionReservedRegionCrossingOrLengthCorruption()
        {
            var version = BuildBat();
            version[4] = 2;
            Assert.That(() => ProductionHeroBatMesh.Decode(version, "version"),
                Throws.InvalidOperationException.With.Message.Contains("version"));

            var reserved = BuildBat();
            reserved[17] = 1;
            Assert.That(() => ProductionHeroBatMesh.Decode(reserved, "reserved"),
                Throws.InvalidOperationException.With.Message.Contains("reserved"));

            var region = BuildBat();
            region[32 + 48] = 3;
            Assert.That(() => ProductionHeroBatMesh.Decode(region, "region"),
                Throws.InvalidOperationException.With.Message.Contains("vertex"));

            var ambiguous = BuildBat();
            ambiguous[32 + 56 + 48] = 1;
            ambiguous[32 + 112 + 48] = 2;
            Assert.That(() => ProductionHeroBatMesh.Decode(ambiguous, "ambiguous"),
                Throws.InvalidOperationException.With.Message.Contains("ambiguous material regions"));

            var exact = BuildBat();
            var truncated = new byte[exact.Length - 1];
            Array.Copy(exact, truncated, truncated.Length);
            Assert.That(() => ProductionHeroBatMesh.Decode(truncated, "truncated"),
                Throws.InvalidOperationException.With.Message.Contains("byte length"));
        }

        [Test]
        public void HeroLods_AreRoleSelectedAndCloseUpIsExplicit()
        {
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.High, false),
                Is.EqualTo(ProductionHeroLodSelection.LiveBatter));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.PaceBowler, ProductionCharacterDetail.High, false),
                Is.EqualTo(ProductionHeroLodSelection.LiveBowler));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.SpinBowler, ProductionCharacterDetail.Low, false),
                Is.EqualTo(ProductionHeroLodSelection.LiveLow));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Low, false),
                Is.EqualTo(ProductionHeroLodSelection.LiveLow));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.High, true),
                Is.EqualTo(ProductionHeroLodSelection.CloseUp));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium, true),
                Is.EqualTo(ProductionHeroLodSelection.LiveBatter),
                "LOD0 needs both an explicit close-up and High detail");
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Wicketkeeper, ProductionCharacterDetail.High, true),
                Is.EqualTo(ProductionHeroLodSelection.DistantFielderPremium),
                "keeper geometry remains within the four-thousand-triangle live-role ceiling");
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Wicketkeeper, ProductionCharacterDetail.Medium, false),
                Is.EqualTo(ProductionHeroLodSelection.DistantFielderBalancedLite));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Fielder, ProductionCharacterDetail.High, false, 29.99f),
                Is.EqualTo(ProductionHeroLodSelection.LiveBowler));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Fielder, ProductionCharacterDetail.High, false, 30f),
                Is.EqualTo(ProductionHeroLodSelection.DistantFielderPremium));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Fielder, ProductionCharacterDetail.Medium, false, 45f),
                Is.EqualTo(ProductionHeroLodSelection.DistantFielderBalancedLite));
            Assert.That(ProductionHeroPresentationPolicy.SelectLod(
                    ProductionCharacterRole.Fielder, ProductionCharacterDetail.Low, false, 45f),
                Is.EqualTo(ProductionHeroLodSelection.DistantFielderBalancedLite));
        }

        [Test]
        public void HeroSkinningQuality_RetainsFourInfluencesOnlyForForegroundBatter()
        {
            Assert.That(ProductionHeroPresentationPolicy.SelectSkinQuality(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.High),
                Is.EqualTo(SkinQuality.Bone4));
            Assert.That(ProductionHeroPresentationPolicy.SelectSkinQuality(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium),
                Is.EqualTo(SkinQuality.Bone4));
            Assert.That(ProductionHeroPresentationPolicy.SelectSkinQuality(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Low),
                Is.EqualTo(SkinQuality.Auto));

            foreach (var role in new[]
                     {
                         ProductionCharacterRole.PaceBowler,
                         ProductionCharacterRole.SpinBowler,
                         ProductionCharacterRole.Fielder,
                         ProductionCharacterRole.Wicketkeeper
                     })
            {
                Assert.That(ProductionHeroPresentationPolicy.SelectSkinQuality(
                        role, ProductionCharacterDetail.High),
                    Is.EqualTo(SkinQuality.Auto), role.ToString());
            }
        }

        [Test]
        public void HeroOverlayPolicy_DisablesEveryProceduralPartAfterCompleteAdmission()
        {
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Batter, "HelmetShell"), Is.False);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Batter, "BattingPadLeft"), Is.False);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Batter, "BattingGloveFingerLeft0"), Is.False);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Batter, "HandLeft"), Is.False);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Batter, "LawScaleBlade"), Is.False);

            foreach (var bundledPart in new[]
                     {
                         "Pelvis", "Chest", "Head", "EyeWhiteLeft", "Hair", "KitSidePanelLeft",
                         "ShoeLeft", "SoleLeft", "SpinBowlerCapCrown", "ThighGuard", "ArmGuard"
                     })
            {
                Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                    ProductionCharacterRole.Batter, bundledPart), Is.False, bundledPart);
            }
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.PaceBowler, "PaceBowlerJerseyChevronLeft"), Is.False);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.SpinBowler, "SpinBowlerCapCrown"), Is.True,
                "the current body bundle needs one original role marker to keep pace and spin readable");
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.SpinBowler, "SpinBowlerCapPeak"), Is.True);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Fielder, "FielderCapCrown"), Is.True);
            Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                ProductionCharacterRole.Fielder, "Head"), Is.False,
                "old procedural anatomy stays disabled");
            foreach (var keeperEquipment in new[]
                     {
                         "KeeperCapCrown", "HelmetShell", "KeeperPadLeft", "PadRollLeft0",
                         "PadStrapLeftTop", "KeeperGlovePalmLeft", "KeeperGloveFingerLeft0", "KeeperWebLeft"
                     })
            {
                Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                    ProductionCharacterRole.Wicketkeeper, keeperEquipment), Is.True, keeperEquipment);
            }
            foreach (var keeperAnatomy in new[]
                     { "Pelvis", "Head", "Chest", "ForearmLeft", "HandLeft", "ShoeLeft" })
            {
                Assert.That(ProductionHeroPresentationPolicy.KeepProceduralCricketEquipment(
                    ProductionCharacterRole.Wicketkeeper, keeperAnatomy), Is.False, keeperAnatomy);
            }
        }

        [Test]
        public void CompleteBatterResources_AdmitBodyGearAndBatOnTheExistingBatRoot()
        {
            var host = new GameObject("Complete hero batter host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig rig = null;
            try
            {
                rig = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.High),
                    resources,
                    false);

                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(rig.HeroBoneCount, Is.EqualTo(75));
                Assert.That(rig.FindPart("HeroCricketGearMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroCricketBatMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroEyeMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroEyeMesh").GetComponent<SkinnedMeshRenderer>().enabled,
                    Is.True);
                Assert.That(rig.FindPart("EyeWhiteLeft").GetComponent<MeshRenderer>().enabled,
                    Is.False, "the protected VPM3 eyes replace the old procedural spheres");
                Assert.That(rig.FindPart("HeroCricketBatMesh").IsChildOf(rig.Bat), Is.True,
                    "the VBT1 renderer must preserve the authoritative batRoot transform");
                Assert.That(rig.FindPart("HeroCricketGearMesh").GetComponent<SkinnedMeshRenderer>().enabled,
                    Is.True);
                Assert.That(rig.FindPart("HeroCricketBatMesh").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(rig.ActiveTotalTriangleCount, Is.EqualTo(7_639));
                Assert.That(rig.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(8_000));
                Assert.That(resources.HeroSkinTextureAvailable, Is.True,
                    "hero admission cannot silently apply the anatomy candidate's skin texture");
                Assert.That(resources.HeroEyeTextureAvailable, Is.True,
                    "hero admission requires the pinned eye albedo rather than an implicit white texture");
                Assert.That(resources.HeroKitSurfaceTexturesAvailable, Is.False,
                    "the fitted anatomy UV/tangent atlas must not sample the incompatible legacy suit normal/AO pair");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CompleteFieldRoles_UseSeventyFiveBoneHeroWithOnlyRoleEquipmentRetained()
        {
            var host = new GameObject("Complete hero field-role host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig keeper = null;
            ProductionCharacterRig fielder = null;
            try
            {
                keeper = ProductionCharacterFactory.CreateShared(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Wicketkeeper, ProductionCharacterDetail.High),
                    resources);
                fielder = ProductionCharacterFactory.CreateShared(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Fielder, ProductionCharacterDetail.High),
                    resources);

                foreach (var rig in new[] { keeper, fielder })
                {
                    Assert.That(rig.BakedMeshSource,
                        Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                    Assert.That(rig.HeroBoneCount, Is.EqualTo(75));
                    Assert.That(rig.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.False,
                        "old anatomy must not double-render after complete VPM3 admission");
                }

                Assert.That(keeper.FindPart("KeeperPadLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(keeper.FindPart("KeeperWebLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(keeper.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.False,
                    "old generic hand anatomy must not double-render");
                Assert.That(keeper.FindPart("KeeperGlovePalmLeft").GetComponent<MeshRenderer>().enabled,
                    Is.True, "the explicitly named glove palm remains as keeper equipment");
                Assert.That(keeper.BakedActiveTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantPremiumTriangleBudget));
                Assert.That(keeper.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(4_000),
                    "hero plus every High-detail keeper-equipment overlay remains bounded");

                Assert.That(fielder.FindPart("FielderCapCrown").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(fielder.BakedActiveTriangleCount, Is.LessThanOrEqualTo(4_000));
                Assert.That(fielder.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(4_000));
                fielder.SetPresentationDistanceMetres(45f);
                Assert.That(fielder.BakedActiveTriangleCount,
                    Is.EqualTo(fielder.BakedDistantPremiumTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                Assert.That(fielder.BakedDistantPremiumTriangleCount,
                    Is.InRange(1, ProductionBakedCharacterMesh.DistantPremiumBodyTriangleBudget));
                Assert.That(fielder.ActiveTotalTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantPremiumTriangleBudget),
                    "the retained cap is part of the complete far-fielder ceiling");
                fielder.SetDetail(ProductionCharacterDetail.Medium);
                Assert.That(fielder.BakedActiveTriangleCount,
                    Is.EqualTo(fielder.BakedDistantBalancedTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                Assert.That(fielder.BakedDistantBalancedTriangleCount,
                    Is.InRange(1, ProductionBakedCharacterMesh.DistantBalancedBodyTriangleBudget));
                Assert.That(fielder.ActiveTotalTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantBalancedTriangleBudget),
                    "Balanced/Lite includes the retained cap in its 1,200-triangle ceiling");
                Assert.That(resources.HeroCachedMeshSetCount, Is.EqualTo(3),
                    "one common body set, one eye set and one field-role distance pair serve keeper plus fielders");
                Assert.That(resources.HeroCachedSkeletonCount, Is.EqualTo(1));
            }
            finally
            {
                if (keeper != null) keeper.Dispose();
                if (fielder != null) fielder.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CorruptFielderDistanceAsset_RejectsOnlyThatRoleAndLeavesNoPartialHeroCache()
        {
            var host = new GameObject("Rejected hero fielder host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            var corrupt = new TextAsset("not a VPM3 payload");
            ProductionCharacterRig fallback = null;
            ProductionCharacterRig bowler = null;
            try
            {
                ProductionCharacterResourceLoader corruptFielder = key =>
                    string.Equals(key, "ProductionCharacters/hero-lod4", StringComparison.Ordinal)
                        ? corrupt
                        : Resources.Load<TextAsset>(key);
                fallback = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Fielder, ProductionCharacterDetail.Medium),
                    resources,
                    false,
                    corruptFielder);
                Assert.That(fallback.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(resources.HeroCachedMeshSetCount, Is.Zero);
                Assert.That(resources.HeroCachedSkeletonCount, Is.Zero);
                Assert.That(resources.DistantLodDecodeCount, Is.EqualTo(2),
                    "only the admitted VPM2 fallback pair remains accounted after hero rollback");

                fallback.Dispose();
                fallback = null;
                bowler = ProductionCharacterFactory.CreateShared(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.PaceBowler, ProductionCharacterDetail.Medium),
                    resources);
                Assert.That(bowler.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate),
                    "a fielder-only corruption cannot invalidate the common bundle for another role");
            }
            finally
            {
                if (fallback != null) fallback.Dispose();
                if (bowler != null) bowler.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(corrupt);
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void HeroTextureAndGeometryTiers_ArePerRigImmutableAndLowIsCheaperThanMedium()
        {
            var host = new GameObject("Hero tier material host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig closeUp = null;
            ProductionCharacterRig live = null;
            try
            {
                closeUp = ProductionCharacterFactory.CreateShared(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.High),
                    resources);
                live = ProductionCharacterFactory.CreateShared(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium),
                    resources);

                var closeRenderer = closeUp.FindPart("BakedCharacterMesh")
                    .GetComponent<SkinnedMeshRenderer>();
                var liveRenderer = live.FindPart("BakedCharacterMesh")
                    .GetComponent<SkinnedMeshRenderer>();
                var closeLiveSkin = closeRenderer.sharedMaterial.GetTexture("_SkinTex");
                var liveSkin = liveRenderer.sharedMaterial.GetTexture("_SkinTex");
                Assert.That(closeLiveSkin, Is.Not.Null);
                Assert.That(liveSkin, Is.Not.Null);
                Assert.That(closeLiveSkin.name, Does.Contain("hero-skin-albedo-512"));
                Assert.That(liveSkin.name, Does.Contain("hero-skin-albedo-512"));

                closeUp.SetHeroCloseUp(true);
                var closeUpSkin = closeRenderer.sharedMaterial.GetTexture("_SkinTex");
                var unchangedLiveSkin = liveRenderer.sharedMaterial.GetTexture("_SkinTex");
                Assert.That(closeUpSkin, Is.Not.Null);
                Assert.That(unchangedLiveSkin, Is.Not.Null);
                Assert.That(closeUpSkin.name, Does.Contain("hero-skin-albedo-1024"));
                Assert.That(unchangedLiveSkin.name,
                    Does.Contain("hero-skin-albedo-512"),
                    "one close-up cannot mutate the shared material of another live character");
                Assert.That(closeUp.ActiveTotalTriangleCount, Is.EqualTo(39_454));
                Assert.That(closeUp.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(40_000));

                var mediumTriangles = live.ActiveTotalTriangleCount;
                Assert.That(mediumTriangles, Is.EqualTo(7_639));
                live.SetDetail(ProductionCharacterDetail.Low);
                var lowTriangles = live.ActiveTotalTriangleCount;
                Assert.That(lowTriangles, Is.EqualTo(6_408));
                Assert.That(lowTriangles, Is.LessThan(mediumTriangles),
                    "Low selects the smaller body LOD while retaining complete live gear and bat");
                TestContext.Out.WriteLine(
                    "VANDE_HERO_BATTER_TIER_TRIANGLES medium=" + mediumTriangles +
                    " low=" + lowTriangles +
                    " status=engineering-preflight-not-android-certification");
            }
            finally
            {
                if (closeUp != null) closeUp.Dispose();
                if (live != null) live.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void MissingOneBatterAsset_AtomicallyFallsBackWithoutAnyHeroGearOrBat()
        {
            var host = new GameObject("Incomplete hero batter host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig rig = null;
            try
            {
                ProductionCharacterResourceLoader withoutLiveBat = key =>
                    string.Equals(key, "ProductionCharacters/hero-bat-lod1", StringComparison.Ordinal)
                        ? null
                        : Resources.Load<TextAsset>(key);
                rig = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.High),
                    resources,
                    false,
                    withoutLiveBat);

                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(rig.FindPart("HeroCricketGearMesh"), Is.Null);
                Assert.That(rig.FindPart("HeroCricketBatMesh"), Is.Null);
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the complete procedural bat must survive an atomic hero rejection");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase("ProductionCharacters/hero-eyes")]
        [TestCase("ProductionCharacters/hero-gear-lod1")]
        [TestCase("ProductionCharacters/hero-bat-lod1")]
        public void CorruptHeroRoleAsset_LeavesNoPartialHeroCacheAndNextCompleteAdmissionSucceeds(
            string corruptResourceKey)
        {
            var host = new GameObject("Transactional hero cache host");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            var corrupt = new TextAsset("not a VPM3 payload");
            ProductionCharacterRig fallback = null;
            ProductionCharacterRig complete = null;
            try
            {
                ProductionCharacterResourceLoader corruptRoleAsset = key =>
                    string.Equals(key, corruptResourceKey, StringComparison.Ordinal)
                        ? corrupt
                        : Resources.Load<TextAsset>(key);
                fallback = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium),
                    resources,
                    false,
                    corruptRoleAsset);

                Assert.That(fallback.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(fallback.FindPart("HeroCricketGearMesh"), Is.Null);
                Assert.That(fallback.FindPart("HeroCricketBatMesh"), Is.Null);
                Assert.That(resources.HeroCachedMeshSetCount, Is.Zero,
                    "a rejected body/gear/bat transaction cannot leak reusable partial geometry");
                Assert.That(resources.HeroCachedSkeletonCount, Is.Zero,
                    "a rejected transaction cannot leave a skeleton admitted without its complete role bundle");

                fallback.Dispose();
                fallback = null;
                complete = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium),
                    resources,
                    false);
                Assert.That(complete.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(resources.HeroCachedMeshSetCount, Is.EqualTo(4),
                    "one complete batter transaction owns body, eyes, gear and bat mesh sets");
                Assert.That(resources.HeroCachedSkeletonCount, Is.EqualTo(1));
            }
            finally
            {
                if (fallback != null) fallback.Dispose();
                if (complete != null) complete.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(corrupt);
                Object.DestroyImmediate(host);
            }
        }

        [TestCase("ProductionCharacters/hero-skin-albedo-1024")]
        [TestCase("ProductionCharacters/hero-skin-albedo-512")]
        [TestCase(ProductionCharacterResources.HeroEyeTextureResourceKey)]
        public void MissingRequiredHeroTexture_RejectsHeroWithoutChangingTheAnatomyFallbackMaterial(
            string missingTextureKey)
        {
            var host = new GameObject("Missing hero skin host");
            var resources = new ProductionCharacterResources(
                ProductionCharacterPalette.OriginalNightKit(),
                key => string.Equals(key, missingTextureKey, StringComparison.Ordinal)
                    ? null
                    : Resources.Load<Texture2D>(key));
            ProductionCharacterRig rig = null;
            try
            {
                rig = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(
                        ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium),
                    resources,
                    false);

                if (string.Equals(missingTextureKey,
                        ProductionCharacterResources.HeroEyeTextureResourceKey,
                        StringComparison.Ordinal))
                    Assert.That(resources.HeroEyeTextureAvailable, Is.False);
                else
                    Assert.That(resources.HeroSkinTextureAvailable, Is.False);
                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(resources.HeroCachedMeshSetCount, Is.Zero);
                Assert.That(resources.HeroCachedSkeletonCount, Is.Zero);
                var material = rig.FindPart("BakedCharacterMesh")
                    .GetComponent<SkinnedMeshRenderer>().sharedMaterial;
                var fallbackSkin = material.GetTexture("_SkinTex");
                Assert.That(fallbackSkin, Is.Not.Null);
                Assert.That(fallbackSkin.name, Does.Contain("human-skin-albedo"),
                    "the VPM2 fallback must retain its own texture instead of inheriting the rejected hero skin");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterHandedness.Right,
            ProductionCharacterMotion.BatterStance, 0.35f)]
        [TestCase(ProductionCharacterHandedness.Left,
            ProductionCharacterMotion.BatterStance, 0.35f)]
        [TestCase(ProductionCharacterHandedness.Right,
            ProductionCharacterMotion.BatterStroke, ProductionCharacterMotionSampler.BatterContact)]
        [TestCase(ProductionCharacterHandedness.Left,
            ProductionCharacterMotion.BatterStroke, ProductionCharacterMotionSampler.BatterContact)]
        public void HeroBatterHands_StayWithinTwoCentimetresOfBothBatGripTargetsAtStanceAndContact(
            ProductionCharacterHandedness handedness,
            ProductionCharacterMotion motion,
            float normalizedTime)
        {
            var host = new GameObject("Hero grip IK host");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(motion, normalizedTime);

                Assert.That(Vector3.Distance(
                        rig.HeroHandWorldPosition(true), rig.HeroBatterGripTargetWorld(true)),
                    Is.LessThanOrEqualTo(0.02f), "left visible hand must remain on its authored grip target");
                Assert.That(Vector3.Distance(
                        rig.HeroHandWorldPosition(false), rig.HeroBatterGripTargetWorld(false)),
                    Is.LessThanOrEqualTo(0.02f), "right visible hand must remain on its authored grip target");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterRole.PaceBowler, ProductionCharacterMotion.PaceBowling,
            ProductionCharacterHandedness.Right, false)]
        [TestCase(ProductionCharacterRole.PaceBowler, ProductionCharacterMotion.PaceBowling,
            ProductionCharacterHandedness.Left, true)]
        [TestCase(ProductionCharacterRole.SpinBowler, ProductionCharacterMotion.SpinBowling,
            ProductionCharacterHandedness.Right, false)]
        [TestCase(ProductionCharacterRole.SpinBowler, ProductionCharacterMotion.SpinBowling,
            ProductionCharacterHandedness.Left, true)]
        public void HeroBowlerReleaseHand_StaysWithinTwoCentimetresOfCanonicalReleaseAnchor(
            ProductionCharacterRole role,
            ProductionCharacterMotion motion,
            ProductionCharacterHandedness handedness,
            bool releaseIsLeft)
        {
            var host = new GameObject("Hero release IK host");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(
                    role, ProductionCharacterDetail.Medium);
                spec.Handedness = handedness;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(motion, 1f);

                Assert.That(Vector3.Distance(
                        rig.HeroHandWorldPosition(releaseIsLeft), rig.ReleaseHandAnchor.position),
                    Is.LessThanOrEqualTo(0.02f),
                    "the rendered release hand must agree with the ball's canonical release origin");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        private static TextAsset RequiredTextAsset(string resourceKey)
        {
            var asset = Resources.Load<TextAsset>(resourceKey);
            Assert.That(asset, Is.Not.Null, "missing shipped hero asset " + resourceKey);
            return asset;
        }

        private static int FindSemanticBone(
            ProductionHeroSkeletonDefinition definition, int semantic)
        {
            for (var index = 0; index < definition.BoneCount; index++)
            {
                if (definition.Bones[index].SemanticId == semantic) return index;
            }
            Assert.Fail("Missing canonical hero semantic " + semantic);
            return -1;
        }

        private static bool IsDescendantOf(
            ProductionHeroSkeletonDefinition definition, int bone, int ancestor)
        {
            var cursor = bone;
            while (cursor >= 0)
            {
                if (cursor == ancestor) return true;
                cursor = definition.Bones[cursor].ParentIndex;
            }
            return false;
        }

        private static int TriangleCount(Mesh mesh)
        {
            var count = 0;
            for (var index = 0; index < mesh.subMeshCount; index++)
                count += checked((int)(mesh.GetIndexCount(index) / 3));
            return count;
        }

        private static int MaxPositiveInfluences(Mesh mesh)
        {
            var result = 0;
            var weights = mesh.boneWeights;
            for (var index = 0; index < weights.Length; index++)
            {
                var count = 0;
                if (weights[index].weight0 > 0f) count++;
                if (weights[index].weight1 > 0f) count++;
                if (weights[index].weight2 > 0f) count++;
                if (weights[index].weight3 > 0f) count++;
                result = Mathf.Max(result, count);
            }
            return result;
        }

        private static byte[] BuildSkeleton()
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'S', (byte)'K', (byte)'1' });
                writer.Write((ushort)1);
                writer.Write((ushort)75);
                writer.Write((ushort)32);
                writer.Write((ushort)0);
                writer.Write((uint)0);
                writer.Write(SkeletonId);
                writer.Write((ulong)0);
                for (var index = 0; index < 75; index++)
                {
                    writer.Write((short)(index == 0 ? -1 : 0));
                    writer.Write(index < (int)ProductionCharacterJoint.Count
                        ? (ushort)index
                        : ushort.MaxValue);
                    Write(writer, index == 0 ? new Vector3(0f, 0.96f, 0f) : Vector3.zero);
                    Write(writer, Quaternion.identity);
                }
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static byte[] BuildTriangle()
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'P', (byte)'M', (byte)'3' });
                writer.Write((ushort)3);
                writer.Write((ushort)75);
                writer.Write((uint)3);
                writer.Write((uint)3);
                writer.Write((ushort)72);
                writer.Write((byte)4);
                writer.Write((byte)2);
                writer.Write(SkeletonId);
                writer.Write((uint)0);

                var positions = new[] { Vector3.zero, Vector3.right, Vector3.up };
                var uvs = new[] { Vector2.zero, Vector2.right, Vector2.up };
                for (var index = 0; index < positions.Length; index++)
                {
                    Write(writer, positions[index]);
                    Write(writer, Vector3.forward);
                    Write(writer, new Vector4(1f, 0f, 0f, 1f));
                    Write(writer, positions[index]);
                    Write(writer, uvs[index]);
                    writer.Write((byte)index);
                    writer.Write((byte)0);
                    writer.Write((byte)1);
                    writer.Write((byte)2);
                    writer.Write((byte)3);
                    writer.Write(byte.MaxValue);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                }
                writer.Write((ushort)0);
                writer.Write((ushort)1);
                writer.Write((ushort)2);
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static byte[] BuildBat()
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'B', (byte)'T', (byte)'1' });
                writer.Write((ushort)1);
                writer.Write((ushort)56);
                writer.Write((uint)9);
                writer.Write((uint)9);
                writer.Write((byte)2);
                for (var index = 17; index < 32; index++) writer.Write((byte)0);

                for (var index = 0; index < 9; index++)
                {
                    var corner = index % 3;
                    Write(writer, corner == 0 ? Vector3.zero :
                        corner == 1 ? Vector3.right : Vector3.up);
                    Write(writer, Vector3.forward);
                    Write(writer, new Vector4(1f, 0f, 0f, 1f));
                    Write(writer, corner == 0 ? Vector2.zero :
                        corner == 1 ? Vector2.right : Vector2.up);
                    writer.Write((byte)(index / 3));
                    for (var reserved = 0; reserved < 7; reserved++) writer.Write((byte)0);
                }
                for (var index = 0; index < 9; index++) writer.Write((ushort)index);
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static void Write(BinaryWriter writer, Vector2 value)
        {
            writer.Write(value.x);
            writer.Write(value.y);
        }

        private static void Write(BinaryWriter writer, Vector3 value)
        {
            writer.Write(value.x);
            writer.Write(value.y);
            writer.Write(value.z);
        }

        private static void Write(BinaryWriter writer, Vector4 value)
        {
            writer.Write(value.x);
            writer.Write(value.y);
            writer.Write(value.z);
            writer.Write(value.w);
        }

        private static void Write(BinaryWriter writer, Quaternion value)
        {
            writer.Write(value.x);
            writer.Write(value.y);
            writer.Write(value.z);
            writer.Write(value.w);
        }
    }
}
