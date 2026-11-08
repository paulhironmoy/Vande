using System;
using System.Diagnostics;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Props;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    public sealed class ProductionCharacterDimensionsTests
    {
        [TestCase(ProductionCharacterRole.Batter)]
        [TestCase(ProductionCharacterRole.PaceBowler)]
        [TestCase(ProductionCharacterRole.SpinBowler)]
        [TestCase(ProductionCharacterRole.Wicketkeeper)]
        [TestCase(ProductionCharacterRole.Fielder)]
        [TestCase(ProductionCharacterRole.Umpire)]
        public void StandingRole_UsesCredibleAdultCricketProportions(ProductionCharacterRole role)
        {
            var host = new GameObject("ProductionCharacterDimensionsHost");
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(role, ProductionCharacterDetail.High);
                spec.HeightMetres = 1.78f;
                rig = ProductionCharacterFactory.Create(host.transform, spec);
                rig.SampleAndApply(ProductionCharacterMotion.Stand, 0f);

                var bounds = rig.MeasureVisibleWorldBounds();
                var boundsDiagnostic = DescribeHeroBounds(rig, bounds);
                Assert.That(bounds.size.y, Is.InRange(1.68f, 1.95f),
                    role + " height; " + boundsDiagnostic);
                Assert.That(bounds.size.x, Is.InRange(0.35f, 1.05f),
                    role + " shoulder/equipment width; " + boundsDiagnostic);
                Assert.That(bounds.size.z, Is.InRange(0.18f, 0.90f),
                    role + " body/equipment depth; " + boundsDiagnostic);
                Assert.That(rig.Joint(ProductionCharacterJoint.Head).position.y -
                            rig.Joint(ProductionCharacterJoint.Hips).position.y,
                    Is.InRange(0.58f, 0.78f), role + " torso/head proportion");
                Assert.That(rig.Joint(ProductionCharacterJoint.FootLeft).position.y,
                    Is.LessThan(rig.Joint(ProductionCharacterJoint.Hips).position.y - 0.7f));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CharacterLimbs_UseSharedRoundedCapsulesAtBothDetailLevels()
        {
            var host = new GameObject("ProductionRoundedLimbHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.High));
                var limbNames = new[]
                {
                    "UpperArmLeft", "ForearmLeft", "UpperArmRight", "ForearmRight",
                    "ThighLeft", "ShinLeft", "ThighRight", "ShinRight"
                };

                Mesh highMesh = null;
                for (var index = 0; index < limbNames.Length; index++)
                {
                    var mesh = rig.FindPart(limbNames[index]).GetComponent<MeshFilter>().sharedMesh;
                    Assert.That(mesh.name, Does.Contain("Capsule High"), limbNames[index]);
                    if (highMesh == null) highMesh = mesh;
                    else Assert.That(mesh, Is.SameAs(highMesh),
                        "every high-detail limb reuses the one rounded mesh");
                }
                Assert.That(highMesh.bounds.size.x, Is.EqualTo(1f).Within(0.0001f));
                Assert.That(highMesh.bounds.size.y, Is.EqualTo(1f).Within(0.0001f));

                rig.SetDetail(ProductionCharacterDetail.Low);
                var lowMesh = rig.FindPart("UpperArmLeft").GetComponent<MeshFilter>().sharedMesh;
                Assert.That(lowMesh.name, Does.Contain("Capsule Low"));
                Assert.That(lowMesh, Is.Not.SameAs(highMesh));
                Assert.That(lowMesh.bounds.size.y, Is.EqualTo(1f).Within(0.0001f),
                    "rounded LOD preserves authored limb length and joint placement");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void PaceAndSpinHeroes_KeepDistinctReadableBowlingSilhouettes()
        {
            var host = new GameObject("ProductionBowlerKitHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig pace = null;
            ProductionCharacterRig spin = null;
            try
            {
                var paceSpec = ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                    ProductionCharacterDetail.High);
                paceSpec.Handedness = ProductionCharacterHandedness.Right;
                pace = ProductionCharacterFactory.CreateShared(host.transform, paceSpec, resources);

                var spinSpec = ProductionCharacterSpec.For(ProductionCharacterRole.SpinBowler,
                    ProductionCharacterDetail.High);
                spinSpec.Handedness = ProductionCharacterHandedness.Left;
                spin = ProductionCharacterFactory.CreateShared(host.transform, spinSpec, resources);

                Assert.That(pace.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(spin.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(pace.FindPart("PaceBowlerCapCrown"), Is.Null,
                    "the pace silhouette stays bare-headed through its long approach");

                Assert.That(spin.FindPart("SpinBowlerCapCrown"), Is.Not.Null);
                Assert.That(spin.FindPart("SpinBowlerCapPeak"), Is.Not.Null);
                Assert.That(spin.FindPart("SpinBowlerCapCrown").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the shared hero body must retain a spinner-specific cap silhouette");
                Assert.That(spin.FindPart("SpinBowlerCapPeak").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(pace.FindPart("SpinBowlerCapCrown"), Is.Null);
                Assert.That(pace.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(4_000));
                Assert.That(spin.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(4_000));
            }
            finally
            {
                if (pace != null) pace.Dispose();
                if (spin != null) spin.Dispose();
                resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void Batter_AdmitsCompleteHeroBodyProtectiveEquipmentAndBatAtomically()
        {
            var host = new GameObject("ProductionBatterEquipmentHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High));

                Assert.That(rig.FindPart("HeroCricketGearMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroCricketBatMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroEyeMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HeroCricketGearMesh")
                    .GetComponent<SkinnedMeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HeroCricketBatMesh")
                    .GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.UsesBakedMesh, Is.True,
                    "the complete bounded hero replaces the proxy body when every required asset exists");
                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(rig.HeroBoneCount, Is.EqualTo(75));
                Assert.That(rig.BakedHighVertexCount, Is.GreaterThan(8_000));
                Assert.That(rig.BakedLowVertexCount, Is.GreaterThan(1_000));
                Assert.That(rig.FindPart("BakedCharacterMesh"), Is.Not.Null);
                Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.False,
                    "a complete hero cannot double-render the retained proxy helmet");
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.False,
                    "VBT1 is the only visible bat after complete hero admission");
                Assert.That(rig.ActiveTotalTriangleCount, Is.EqualTo(7_639));
                Assert.That(rig.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(8_000),
                    "the complete live batter budget includes body, protective gear and bat");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void BakedCharacters_ShareUnityMotionSkeletonAndSwitchToBoundedLowLod()
        {
            var host = new GameObject("ProductionBakedCharacterHost");
            ProductionCharacterRig bowler = null;
            ProductionCharacterRig fielder = null;
            try
            {
                bowler = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.High));
                var baked = bowler.FindPart("BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
                Assert.That(bowler.UsesBakedMesh, Is.True);
                Assert.That(baked.bones.Length, Is.EqualTo(75));
                Assert.That(baked.rootBone.name, Is.EqualTo("HeroBone-0"),
                    "the VSK root, not a torso descendant, must drive the skinned hero");
                Assert.That(baked.sharedMaterial.shader.name, Is.EqualTo("Vande/Practice/Character"));
                Assert.That(bowler.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(bowler.HeroBoneCount, Is.EqualTo(75));
                var liveVertices = baked.sharedMesh.vertexCount;

                bowler.SetDetail(ProductionCharacterDetail.Medium);
                Assert.That(baked.sharedMesh.vertexCount, Is.EqualTo(liveVertices),
                    "live bowlers use the bounded role LOD independent of presentation tier");

                bowler.SetDetail(ProductionCharacterDetail.Low);
                Assert.That(baked.sharedMesh.vertexCount, Is.EqualTo(liveVertices));
                Assert.That(bowler.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(4_000));

                fielder = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.High));
                Assert.That(fielder.UsesBakedMesh, Is.True);
                Assert.That(fielder.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(fielder.HeroBoneCount, Is.EqualTo(75));
                fielder.SetPresentationDistanceMetres(24f);
                Assert.That(fielder.BakedActiveTriangleCount,
                    Is.EqualTo(fielder.HeroLiveBowlerTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount),
                    "a close/ring fielder uses the bounded common live VPM3 body plus shared eyes");
                fielder.SetPresentationDistanceMetres(35f);
                Assert.That(fielder.BakedDistantPremiumTriangleCount,
                    Is.InRange(1, ProductionBakedCharacterMesh.DistantPremiumBodyTriangleBudget));
                Assert.That(fielder.BakedActiveTriangleCount,
                    Is.EqualTo(fielder.BakedDistantPremiumTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                fielder.SetDetail(ProductionCharacterDetail.Medium);
                Assert.That(fielder.BakedDistantBalancedTriangleCount,
                    Is.InRange(1, ProductionBakedCharacterMesh.DistantBalancedBodyTriangleBudget));
                Assert.That(fielder.BakedActiveTriangleCount,
                    Is.EqualTo(fielder.BakedDistantBalancedTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
            }
            finally
            {
                if (bowler != null) bowler.Dispose();
                if (fielder != null) fielder.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void LicensedAnatomy_KeepsOriginalCricketEquipmentAndHidesOnlyBodyPrimitives()
        {
            var host = new GameObject("ProductionLicensedAnatomyOverlayHost");
            ProductionCharacterRig batter = null;
            ProductionCharacterRig keeper = null;
            ProductionCharacterRig fielder = null;
            try
            {
                batter = CreateWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High));
                keeper = CreateWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Wicketkeeper,
                        ProductionCharacterDetail.High));
                fielder = CreateWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.High));

                Assert.That(batter.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(keeper.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));
                Assert.That(fielder.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedAnatomyCandidate));

                Assert.That(batter.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(batter.FindPart("UpperArmLeft").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(batter.FindPart("EyeWhiteLeft").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the licensed body contains no eye helper geometry; retain the original visible eye treatment");
                Assert.That(batter.FindPart("EyeWhiteRight").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("IrisLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("IrisRight").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("EyeWhiteLeft").gameObject.activeInHierarchy, Is.True);
                Assert.That(batter.FindPart("IrisLeft").gameObject.activeInHierarchy, Is.True);
                Assert.That(batter.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the glove-coloured palm shell must cover the anatomy hand at every detail level");
                Assert.That(batter.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("BattingPadLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("BattingGloveCuffLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.True);

                Assert.That(keeper.FindPart("KeeperPadLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(keeper.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.False,
                    "generic anatomy hands remain hidden on the licensed path");
                Assert.That(keeper.FindPart("KeeperGlovePalmLeft").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the explicit equipment palm covers the keeper glove");
                Assert.That(keeper.FindPart("KeeperWebLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(fielder.FindPart("FielderCapCrown").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(fielder.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.False,
                    "non-gloved roles do not double-render anatomy hands");

                batter.SetDetail(ProductionCharacterDetail.Medium);
                Assert.That(batter.FindPart("EyeWhiteLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("IrisLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(batter.FindPart("EyeWhiteLeft").gameObject.activeInHierarchy, Is.True,
                    "Balanced licensed faces keep coherent whites and irises");
                Assert.That(batter.FindPart("IrisLeft").gameObject.activeInHierarchy, Is.True);

                batter.SetDetail(ProductionCharacterDetail.Low);
                Assert.That(batter.FindPart("EyeWhiteLeft").gameObject.activeInHierarchy, Is.False);
                Assert.That(batter.FindPart("IrisLeft").gameObject.activeInHierarchy, Is.False,
                    "Low/Lite culls both eye layers together rather than leaving blank whites");
            }
            finally
            {
                if (batter != null) batter.Dispose();
                if (keeper != null) keeper.Dispose();
                if (fielder != null) fielder.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void DistantFielder_UsesTierSpecificSharedLod2WithinRegisteredTriangleBudgets()
        {
            var host = new GameObject("ProductionFielderLod2BudgetHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig premium = null;
            ProductionCharacterRig balanced = null;
            try
            {
                premium = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.High), resources);
                balanced = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.Medium), resources);
                premium.SetPresentationDistanceMetres(45f);
                balanced.SetPresentationDistanceMetres(45f);

                Assert.That(premium.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(premium.BakedDistantPremiumTriangleCount,
                    Is.EqualTo(1_756),
                    "the body reserves the shared eyes and retained cap inside the complete 2,000-triangle ceiling");
                Assert.That(premium.BakedDistantPremiumTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantPremiumBodyTriangleBudget));
                Assert.That(balanced.BakedDistantBalancedTriangleCount,
                    Is.EqualTo(948),
                    "the body reserves the shared eyes and retained cap inside the complete 1,200-triangle ceiling");
                Assert.That(balanced.BakedDistantBalancedTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantBalancedBodyTriangleBudget));
                Assert.That(premium.BakedActiveTriangleCount,
                    Is.EqualTo(premium.BakedDistantPremiumTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                Assert.That(balanced.BakedActiveTriangleCount,
                    Is.EqualTo(balanced.BakedDistantBalancedTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                Assert.That(premium.ActiveTotalTriangleCount, Is.EqualTo(1_988));
                Assert.That(premium.ActiveTotalTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantPremiumTriangleBudget));
                Assert.That(balanced.ActiveTotalTriangleCount, Is.EqualTo(1_180));
                Assert.That(balanced.ActiveTotalTriangleCount,
                    Is.LessThanOrEqualTo(ProductionBakedCharacterMesh.DistantBalancedTriangleBudget));

                premium.SetPresentationDistanceMetres(29.99f);
                Assert.That(premium.BakedActiveTriangleCount,
                    Is.EqualTo(premium.HeroLiveBowlerTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount));
                Assert.That(premium.BakedActiveTriangleCount, Is.LessThanOrEqualTo(4_000),
                    "the 20 m gameplay LOD1 remains within both live Premium and Balanced budgets");
                premium.SetPresentationDistanceMetres(30f);
                Assert.That(premium.BakedActiveTriangleCount,
                    Is.EqualTo(premium.BakedDistantPremiumTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount),
                    "the canonical 30 m threshold selects LOD2");
                balanced.SetDetail(ProductionCharacterDetail.High);
                Assert.That(balanced.FindPart("BakedCharacterMesh")
                        .GetComponent<SkinnedMeshRenderer>().sharedMesh,
                    Is.SameAs(premium.FindPart("BakedCharacterMesh")
                        .GetComponent<SkinnedMeshRenderer>().sharedMesh),
                    "same-tier fielders share one decoded offline far LOD per production resource owner");
                balanced.SetDetail(ProductionCharacterDetail.Low);
                Assert.That(balanced.BakedActiveTriangleCount,
                    Is.EqualTo(balanced.BakedDistantBalancedTriangleCount +
                               ProductionBakedCharacterMesh.HeroEyeTriangleCount),
                    "Low/Lite never exceeds the Balanced fielder budget");
            }
            finally
            {
                if (premium != null) premium.Dispose();
                if (balanced != null) balanced.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void LicensedMeshFreshResourceOwner_ReportsDecodeLoadAndPersistentEditorMemory()
        {
            var host = new GameObject("ProductionLicensedResourceCostHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig bowler = null;
            ProductionCharacterRig fielder = null;
            var sharedTeamRigs = new ProductionCharacterRig[11];
            ProductionCharacterResources dynamicBowlerResources = null;
            ProductionCharacterRig dynamicBowler = null;
            try
            {
                var allocatedBefore = GC.GetAllocatedBytesForCurrentThread();
                var editorAllocatedBefore = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
                var editorMonoBefore = UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
                var decode = Stopwatch.StartNew();
                bowler = CreateSharedWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.Medium), resources);
                decode.Stop();
                var allocatedAfterBowler = GC.GetAllocatedBytesForCurrentThread();
                var editorAllocatedAfterBowler = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
                var editorMonoAfterBowler = UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
                var bowlerOwnerBytes = resources.SharedBakedMeshObjectMemoryBytes;

                Assert.That(resources.BakedMeshDecodeCount, Is.EqualTo(2),
                    "a fresh licensed pair decodes LOD0/LOD1 exactly once");
                Assert.That(resources.SharedDistantBakedMeshCount, Is.Zero,
                    "a bowler-only owner does not allocate fielder LOD2");
                Assert.That(bowlerOwnerBytes, Is.GreaterThan(0));

                var distant = Stopwatch.StartNew();
                fielder = CreateSharedWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.Medium), resources);
                fielder.SetPresentationDistanceMetres(45f);
                distant.Stop();
                var allocatedAfterFielder = GC.GetAllocatedBytesForCurrentThread();
                var editorAllocatedAfterFielder = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
                var editorMonoAfterFielder = UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
                var teamOwnerBytes = resources.SharedBakedMeshObjectMemoryBytes;

                Assert.That(resources.BakedMeshDecodeCount, Is.EqualTo(4),
                    "the first fielder lazily decodes the two offline manifold far meshes exactly once");
                Assert.That(resources.DistantLodDecodeCount, Is.EqualTo(2));
                Assert.That(resources.SharedDistantBakedMeshCount, Is.EqualTo(2));
                Assert.That(teamOwnerBytes, Is.GreaterThan(bowlerOwnerBytes));

                var teamAllocatedBefore = GC.GetAllocatedBytesForCurrentThread();
                var teamExpansion = Stopwatch.StartNew();
                sharedTeamRigs[0] = CreateSharedWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.Medium), resources);
                sharedTeamRigs[1] = CreateSharedWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Wicketkeeper,
                        ProductionCharacterDetail.Medium), resources);
                for (var index = 2; index < sharedTeamRigs.Length; index++)
                {
                    sharedTeamRigs[index] = CreateSharedWithoutHero(host.transform,
                        ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                            ProductionCharacterDetail.Medium), resources);
                }
                teamExpansion.Stop();
                var teamAllocatedAfter = GC.GetAllocatedBytesForCurrentThread();
                var editorAllocatedAfterTeam = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
                var editorMonoAfterTeam = UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
                Assert.That(resources.ActiveRigCount, Is.EqualTo(13));
                Assert.That(resources.BakedMeshDecodeCount, Is.EqualTo(4),
                    "the complete shared team does not re-decode licensed source payloads per role");
                Assert.That(resources.SharedBakedMeshObjectMemoryBytes, Is.EqualTo(teamOwnerBytes),
                    "thirteen shared rigs do not duplicate persistent baked geometry");

                dynamicBowlerResources = new ProductionCharacterResources(
                    ProductionCharacterPalette.OriginalNightKit());
                var dynamicAllocatedBefore = GC.GetAllocatedBytesForCurrentThread();
                var dynamicDecode = Stopwatch.StartNew();
                dynamicBowler = CreateSharedWithoutHero(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.Medium), dynamicBowlerResources);
                dynamicDecode.Stop();
                var dynamicAllocatedAfter = GC.GetAllocatedBytesForCurrentThread();
                var editorAllocatedAfterDynamic = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
                var editorMonoAfterDynamic = UnityEngine.Profiling.Profiler.GetMonoUsedSizeLong();
                Assert.That(dynamicBowlerResources.SharedDistantBakedMeshCount, Is.Zero);
                Assert.That(dynamicBowlerResources.BakedMeshDecodeCount, Is.EqualTo(2));
                var dynamicBowlerMeshBytes = dynamicBowlerResources.SharedBakedMeshObjectMemoryBytes;

                // Match the live EnsureBowler ownership shape: the provisional shared bowler leaves, while one
                // palette-specific dynamic bowler owns a bounded second LOD0/LOD1 pair.
                bowler.Dispose();
                bowler = null;
                Assert.That(resources.ActiveRigCount, Is.EqualTo(12));
                var liveRendererCount = dynamicBowler.RendererCount + fielder.RendererCount;
                for (var index = 0; index < sharedTeamRigs.Length; index++)
                    liveRendererCount += sharedTeamRigs[index].RendererCount;
                var payloadHigh = Resources.Load<TextAsset>("ProductionCharacters/human-lod0");
                var payloadLow = Resources.Load<TextAsset>("ProductionCharacters/human-lod1");
                var payloadDistantPremium = Resources.Load<TextAsset>("ProductionCharacters/human-lod2");
                var payloadDistantBalanced = Resources.Load<TextAsset>("ProductionCharacters/human-lod3");
                var sourcePayloadBytes = payloadHigh.bytes.Length + payloadLow.bytes.Length +
                                         payloadDistantPremium.bytes.Length + payloadDistantBalanced.bytes.Length;

                TestContext.Out.WriteLine(
                    "VANDE_PRODUCTION_HUMAN_RESOURCE_COST " +
                    "freshOwnerDecodeMs=" + decode.Elapsed.TotalMilliseconds.ToString("F3") + " " +
                    "freshOwnerThreadAllocatedBytes=" + (allocatedAfterBowler - allocatedBefore) + " " +
                    "freshOwnerEditorAllocatedDeltaBytes=" +
                        (editorAllocatedAfterBowler - editorAllocatedBefore) + " " +
                    "freshOwnerEditorMonoDeltaBytes=" + (editorMonoAfterBowler - editorMonoBefore) + " " +
                    "freshOwnerEditorMeshObjectBytes=" + bowlerOwnerBytes + " " +
                    "firstFielderLod2Ms=" + distant.Elapsed.TotalMilliseconds.ToString("F3") + " " +
                    "firstFielderThreadAllocatedBytes=" + (allocatedAfterFielder - allocatedAfterBowler) + " " +
                    "firstFielderEditorAllocatedDeltaBytes=" +
                        (editorAllocatedAfterFielder - editorAllocatedAfterBowler) + " " +
                    "firstFielderEditorMonoDeltaBytes=" +
                        (editorMonoAfterFielder - editorMonoAfterBowler) + " " +
                    "sharedTeamExpansionMs=" + teamExpansion.Elapsed.TotalMilliseconds.ToString("F3") + " " +
                    "sharedTeamExpansionThreadAllocatedBytes=" + (teamAllocatedAfter - teamAllocatedBefore) + " " +
                    "sharedTeamEditorAllocatedDeltaBytes=" +
                        (editorAllocatedAfterTeam - editorAllocatedAfterFielder) + " " +
                    "sharedTeamEditorMonoDeltaBytes=" + (editorMonoAfterTeam - editorMonoAfterFielder) + " " +
                    "sharedTeamEditorMeshObjectBytes=" + teamOwnerBytes + " " +
                    "dynamicBowlerDecodeMs=" + dynamicDecode.Elapsed.TotalMilliseconds.ToString("F3") + " " +
                    "dynamicBowlerThreadAllocatedBytes=" +
                        (dynamicAllocatedAfter - dynamicAllocatedBefore) + " " +
                    "dynamicBowlerEditorAllocatedDeltaBytes=" +
                        (editorAllocatedAfterDynamic - editorAllocatedAfterTeam) + " " +
                    "dynamicBowlerEditorMonoDeltaBytes=" +
                        (editorMonoAfterDynamic - editorMonoAfterTeam) + " " +
                    "dynamicBowlerEditorMeshObjectBytes=" + dynamicBowlerMeshBytes + " " +
                    "combinedEditorMeshObjectBytes=" + (teamOwnerBytes + dynamicBowlerMeshBytes) + " " +
                    "sourcePayloadBytes=" + sourcePayloadBytes + " " +
                    "liveRendererCount=" + liveRendererCount + " " +
                    "liveSharedMaterialCount=" +
                        (resources.SharedMaterialCount + dynamicBowlerResources.SharedMaterialCount) + " " +
                    "decodeCount=" + resources.BakedMeshDecodeCount + " " +
                    "distantLodDecodeCount=" + resources.DistantLodDecodeCount + " " +
                    "lod2PremiumTriangles=" + fielder.BakedDistantPremiumTriangleCount + " " +
                    "lod2BalancedTriangles=" + fielder.BakedDistantBalancedTriangleCount);
            }
            finally
            {
                if (bowler != null) bowler.Dispose();
                if (fielder != null) fielder.Dispose();
                for (var index = 0; index < sharedTeamRigs.Length; index++)
                    if (sharedTeamRigs[index] != null) sharedTeamRigs[index].Dispose();
                if (dynamicBowler != null) dynamicBowler.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                if (dynamicBowlerResources != null && !dynamicBowlerResources.IsDisposed &&
                    dynamicBowlerResources.ActiveRigCount == 0)
                    dynamicBowlerResources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterRole.Batter)]
        [TestCase(ProductionCharacterRole.PaceBowler)]
        [TestCase(ProductionCharacterRole.SpinBowler)]
        [TestCase(ProductionCharacterRole.Wicketkeeper)]
        [TestCase(ProductionCharacterRole.Fielder)]
        public void StageOneVisibleRole_PrefersCompleteHeroThenLicensedAnatomyFallback(
            ProductionCharacterRole role)
        {
            var host = new GameObject("ProductionLicensedRoleHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(role, ProductionCharacterDetail.Medium));

                Assert.That(rig.UsesBakedMesh, Is.True);
                var expectedSource = ProductionCharacterMeshSource.LicensedHeroCandidate;
                Assert.That(rig.BakedMeshSource, Is.EqualTo(expectedSource));
                Assert.That(rig.FindPart("BakedCharacterMesh"), Is.Not.Null);
                Assert.That(rig.HeroBoneCount,
                    Is.EqualTo(expectedSource == ProductionCharacterMeshSource.LicensedHeroCandidate ? 75 : 0));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void CharacterLod_ChangesOnlyGeometryAndNeverCanonicalPose()
        {
            var host = new GameObject("ProductionCharacterLodAuthorityHost");
            ProductionCharacterRig high = null;
            ProductionCharacterRig medium = null;
            try
            {
                high = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.High));
                medium = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler,
                        ProductionCharacterDetail.Medium));

                high.SampleAndApply(ProductionCharacterMotion.PaceBowling, 0.63f);
                medium.SampleAndApply(ProductionCharacterMotion.PaceBowling, 0.63f);
                Assert.That(high.HeroBoneCount, Is.EqualTo(75));
                Assert.That(medium.HeroBoneCount, Is.EqualTo(75));
                Assert.That(Vector3.Distance(
                        high.FindPart("MotionRoot").localPosition,
                        medium.FindPart("MotionRoot").localPosition),
                    Is.LessThan(0.000001f), "motion-root offset remains canonical");
                Assert.That(Quaternion.Angle(
                        high.FindPart("MotionRoot").localRotation,
                        medium.FindPart("MotionRoot").localRotation),
                    Is.LessThan(0.0001f), "motion-root rotation remains canonical");
                for (var index = 0; index < (int)ProductionCharacterJoint.Count; index++)
                {
                    var joint = (ProductionCharacterJoint)index;
                    Assert.That(Quaternion.Angle(
                            high.Joint(joint).localRotation,
                            medium.Joint(joint).localRotation),
                        Is.LessThan(0.0001f), joint + " canonical pose");
                    Assert.That(high.Joint(joint).localPosition,
                        Is.EqualTo(medium.Joint(joint).localPosition), joint + " rest offset");
                    Assert.That(Vector3.Distance(
                            high.Joint(joint).position,
                            medium.Joint(joint).position),
                        Is.LessThan(0.000001f), joint + " canonical world position");
                    Assert.That(Quaternion.Angle(
                            high.Joint(joint).rotation,
                            medium.Joint(joint).rotation),
                        Is.LessThan(0.0001f), joint + " canonical world rotation");
                }

                Assert.That(Vector3.Distance(
                        high.ReleaseHandAnchor.position,
                        medium.ReleaseHandAnchor.position),
                    Is.LessThan(0.000001f), "release world position remains canonical");
                Assert.That(Quaternion.Angle(
                        high.ReleaseHandAnchor.rotation,
                        medium.ReleaseHandAnchor.rotation),
                    Is.LessThan(0.0001f), "release world rotation remains canonical");
                Assert.That(high.FindPart("BakedCharacterMesh")
                        .GetComponent<SkinnedMeshRenderer>().sharedMesh.vertexCount,
                    Is.EqualTo(medium.FindPart("BakedCharacterMesh")
                        .GetComponent<SkinnedMeshRenderer>().sharedMesh.vertexCount),
                    "normal live bowlers use the same bounded LOD at every tier");
                high.SetHeroCloseUp(true);
                Assert.That(high.FindPart("BakedCharacterMesh")
                        .GetComponent<SkinnedMeshRenderer>().sharedMesh.vertexCount,
                    Is.EqualTo(high.BakedHighVertexCount),
                    "LOD0 is selected only by an explicit High-detail close-up");
            }
            finally
            {
                if (high != null) high.Dispose();
                if (medium != null) medium.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void LicensedCandidateMissing_FallsBackToRetainedRoleMeshWithoutDoubleRendering()
        {
            var host = new GameObject("ProductionRetainedFallbackHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig rig = null;
            try
            {
                ProductionCharacterResourceLoader withoutLicensedAnatomy = resourceKey =>
                    resourceKey.StartsWith("ProductionCharacters/", System.StringComparison.Ordinal)
                        ? null
                        : Resources.Load<TextAsset>(resourceKey);
                rig = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High),
                    resources,
                    false,
                    withoutLicensedAnatomy);

                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.RetainedProceduralCandidate));
                Assert.That(rig.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(rig.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.False,
                    "the retained complete mesh must not double-render procedural equipment");
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.True,
                    "the separately authoritative bat remains visible with every body source");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [TestCase(ProductionCharacterRole.Wicketkeeper)]
        [TestCase(ProductionCharacterRole.Fielder)]
        public void LicensedCandidateMissing_RolesWithoutRetainedBakeUseCompleteRoleSpecificProceduralFallback(
            ProductionCharacterRole role)
        {
            var host = new GameObject("ProductionRoleSpecificProceduralFallbackHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig rig = null;
            try
            {
                var spec = ProductionCharacterSpec.For(role, ProductionCharacterDetail.High);
                if (role == ProductionCharacterRole.Wicketkeeper)
                    spec.KeeperStandingUpToStumps = true;
                ProductionCharacterResourceLoader withoutLicensedAnatomy = resourceKey =>
                    resourceKey.StartsWith("ProductionCharacters/", StringComparison.Ordinal)
                        ? null
                        : Resources.Load<TextAsset>(resourceKey);
                rig = new ProductionCharacterRig(
                    host.transform,
                    spec,
                    resources,
                    false,
                    withoutLicensedAnatomy);

                Assert.That(rig.UsesBakedMesh, Is.False);
                Assert.That(rig.BakedMeshSource, Is.EqualTo(ProductionCharacterMeshSource.None));
                Assert.That(rig.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                if (role == ProductionCharacterRole.Wicketkeeper)
                {
                    Assert.That(rig.FindPart("KeeperPadLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                    Assert.That(rig.FindPart("KeeperWebLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                    Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.True);
                }
                else
                {
                    Assert.That(rig.FindPart("FielderCapCrown").GetComponent<MeshRenderer>().enabled, Is.True);
                    Assert.That(rig.FindPart("KeeperPadLeft"), Is.Null);
                }
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void AllBakedCandidatesMissing_SupportedRoleFailsClosedToCompleteProceduralRig()
        {
            var host = new GameObject("ProductionCompleteFallbackHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig rig = null;
            try
            {
                rig = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.Low),
                    resources,
                    false,
                    resourceKey => null);

                Assert.That(rig.UsesBakedMesh, Is.False);
                Assert.That(rig.BakedMeshSource, Is.EqualTo(ProductionCharacterMeshSource.None));
                Assert.That(rig.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HandLeft").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.True);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void HeroAndLicensedFielderFarAssetsMissing_FailClosedToCompleteProceduralFielder()
        {
            var host = new GameObject("ProductionIncompleteFielderLodFallbackHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig batter = null;
            ProductionCharacterRig fielder = null;
            try
            {
                ProductionCharacterResourceLoader withoutBalancedFar = resourceKey =>
                    string.Equals(resourceKey, "ProductionCharacters/hero-lod4", StringComparison.Ordinal) ||
                    string.Equals(resourceKey, "ProductionCharacters/human-lod3", StringComparison.Ordinal)
                        ? null
                        : Resources.Load<TextAsset>(resourceKey);
                batter = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High),
                    resources,
                    false,
                    withoutBalancedFar);
                fielder = new ProductionCharacterRig(
                    host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.High),
                    resources,
                    false,
                    withoutBalancedFar);

                Assert.That(batter.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate),
                    "the hero batter does not depend on either field-role Balanced/Lite far asset");
                Assert.That(fielder.UsesBakedMesh, Is.False,
                    "an incomplete licensed fielder set must not silently violate a distance-tier budget");
                Assert.That(fielder.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(fielder.FindPart("FielderCapCrown").GetComponent<MeshRenderer>().enabled, Is.True);
            }
            finally
            {
                if (batter != null) batter.Dispose();
                if (fielder != null) fielder.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void UnsupportedRole_RetainsCompleteProceduralFallback()
        {
            var host = new GameObject("ProductionProceduralFallbackHost");
            ProductionCharacterRig umpire = null;
            try
            {
                umpire = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Umpire,
                        ProductionCharacterDetail.High));

                Assert.That(umpire.UsesBakedMesh, Is.False);
                Assert.That(umpire.BakedMeshSource, Is.EqualTo(ProductionCharacterMeshSource.None));
                Assert.That(umpire.FindPart("Head").GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(umpire.FindPart("UmpireHatBrim").GetComponent<MeshRenderer>().enabled, Is.True);
            }
            finally
            {
                if (umpire != null) umpire.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void BakedCharacterMaterial_PreservesEquipmentPaletteAndDarkKitReadability()
        {
            var host = new GameObject("ProductionBakedCharacterMaterialHost");
            ProductionCharacterRig rig = null;
            try
            {
                var palette = ProductionCharacterPalette.OriginalNightKit();
                var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                    ProductionCharacterDetail.High);
                spec.Palette = palette;
                rig = ProductionCharacterFactory.Create(host.transform, spec);

                var renderer = rig.FindPart("BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
                var material = renderer.sharedMaterial;
                Assert.That(material.HasProperty("_Sole"), Is.True);
                Assert.That(material.HasProperty("_Strap"), Is.True);
                Assert.That(material.HasProperty("_Padding"), Is.True);
                Assert.That(material.HasProperty("_MinimumAmbient"), Is.True);
                Assert.That(material.HasProperty("_BroadcastFill"), Is.True);
                Assert.That(material.HasProperty("_SkinTextureExposure"), Is.True);
                Assert.That(material.HasProperty("_SkinPaletteTintStrength"), Is.True);
                Assert.That(material.HasProperty("_SkinShadowLift"), Is.True);
                Assert.That(material.HasProperty("_FaceReadability"), Is.True);
                Assert.That(material.HasProperty("_KitShadowLift"), Is.True);
                Assert.That(material.HasProperty("_KitNormalTex"), Is.True);
                Assert.That(material.HasProperty("_KitAoTex"), Is.True);
                Assert.That(material.HasProperty("_KitSurfaceEnabled"), Is.True);
                Assert.That(material.HasProperty("_KitNormalStrength"), Is.True);
                Assert.That(material.HasProperty("_KitAoStrength"), Is.True);
                Assert.That(material.HasProperty("_KitDetail"), Is.True);
                Assert.That(material.HasProperty("_HelmetNapeContrast"), Is.True);
                Assert.That(material.HasProperty("_CompressionSleeveEnabled"), Is.True);
                Assert.That(material.GetColor("_Sole"), Is.EqualTo(palette.Sole));
                Assert.That(material.GetFloat("_MinimumAmbient"), Is.EqualTo(0.12f).Within(0.0001f),
                    "dark uniforms retain a restrained lighting floor instead of becoming black silhouettes");
                Assert.That(material.GetFloat("_BroadcastFill"), Is.EqualTo(0.42f).Within(0.0001f),
                    "the camera-side fill is explicit and invariant across WebGL and Android materials");
                Assert.That(material.GetFloat("_SkinTextureExposure"), Is.InRange(1.10f, 1.25f),
                    "the photographic skin remains readable without replacing or washing out its albedo");
                Assert.That(material.GetFloat("_SkinPaletteTintStrength"), Is.InRange(0.30f, 0.55f),
                    "the pinned photographic skin retains bounded per-palette variation");
                Assert.That(material.GetFloat("_SkinShadowLift"),
                    Is.GreaterThan(material.GetFloat("_KitShadowLift")),
                    "skin needs more shadow separation than the dark kit while white equipment stays restrained");
                Assert.That(material.GetFloat("_FaceReadability"), Is.InRange(0.12f, 0.20f),
                    "the helmet-shadowed face receives one bounded, face-only readability term");
                Assert.That(material.GetFloat("_KitShadowLift"), Is.InRange(0.02f, 0.08f));
                Assert.That(material.GetFloat("_KitSurfaceEnabled"), Is.Zero,
                    "fitted anatomy UVs must not sample the incompatible legacy suit atlas");
                Assert.That(material.GetTexture("_KitNormalTex"), Is.Null);
                Assert.That(material.GetTexture("_KitAoTex"), Is.Null);
                Assert.That(material.GetFloat("_KitNormalStrength"), Is.InRange(0.15f, 0.30f),
                    "licensed cloth relief stays restrained at gameplay distance");
                Assert.That(material.GetFloat("_KitAoStrength"), Is.InRange(0.10f, 0.25f),
                    "licensed cloth occlusion cannot crush the dark kit into a silhouette");
                Assert.That(material.GetFloat("_KitDetail"), Is.InRange(0.5f, 0.85f),
                    "procedural cloth/equipment detail remains visible without overpowering the ball corridor");
                Assert.That(material.GetFloat("_HelmetNapeContrast"), Is.InRange(0.20f, 0.32f),
                    "the occipital shell needs a bounded panel break instead of one smooth navy blob");
                Assert.That(material.GetFloat("_CompressionSleeveEnabled"), Is.EqualTo(1f),
                    "the fitted undersleeve prevents crossed lower-arm skin from reading as a waist gap");
                Assert.That(palette.Helmet.b, Is.InRange(0.18f, 0.20f),
                    "the night-kit helmet retains the measured navy uplift without becoming a bright arcade prop");
                Assert.That(palette.Helmet.maxColorComponent,
                    Is.GreaterThan(palette.Hair.maxColorComponent * 3f),
                    "the rear shell needs tonal headroom above hair and grille shadows");
                Assert.That(palette.Glove.maxColorComponent, Is.InRange(0.80f, 0.90f),
                    "gloves remain off-white so the live finger channels retain visible tonal headroom");
                Assert.That(palette.Metal.maxColorComponent, Is.InRange(0.62f, 0.72f),
                    "the complete metal grille must remain readable against the navy shell");
                Assert.That(palette.Metal.maxColorComponent,
                    Is.GreaterThan(palette.Helmet.maxColorComponent * 3f),
                    "grille/helmet contrast must survive the gameplay-distance silhouette");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void Batter_RearViewEquipmentRemainsReadableAtLowDetail()
        {
            var host = new GameObject("ProductionBatterRearEquipmentHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.Low));

                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(rig.FindPart("HeroCricketGearMesh")
                    .GetComponent<SkinnedMeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HeroCricketBatMesh")
                    .GetComponent<MeshRenderer>().enabled, Is.True);
                Assert.That(rig.FindPart("HelmetRearGuard").GetComponent<MeshRenderer>().enabled, Is.False,
                    "the retained proxy rear guard cannot double-render over the complete VPM3 gear");
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.False);
                Assert.That(rig.ActiveTotalTriangleCount, Is.EqualTo(6_408));
                Assert.That(rig.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(8_000));
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void BatterBat_UsesLawScaleHighResolutionWoodenBlade()
        {
            var host = new GameObject("ProductionBatterBatHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High));
                var blade = rig.FindPart("HeroCricketBatMesh");
                var mesh = blade.GetComponent<MeshFilter>().sharedMesh;
                var renderer = blade.GetComponent<MeshRenderer>();

                Assert.That(rig.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(mesh.vertexCount, Is.GreaterThan(121),
                    "the original VBT1 candidate contains the rounded blade, edges and ribbed handle");
                Assert.That(mesh.subMeshCount, Is.EqualTo(3),
                    "willow face, edge and grip remain separately materialized");
                Assert.That(mesh.bounds.size.x,
                    Is.EqualTo(CricketPropDimensions.BladeWidth).Within(0.0001f));
                Assert.That(mesh.bounds.size.y,
                    Is.EqualTo(CricketPropDimensions.TotalBatLength).Within(0.0001f));
                Assert.That(renderer.sharedMaterials[0].name,
                    Does.Contain("willow").IgnoreCase);
                Assert.That(rig.FindPart("BatBlade").GetComponent<MeshRenderer>().enabled, Is.False,
                    "the legacy procedural blade remains a fail-closed fallback, not a second visible bat");
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void KeeperFielderAndUmpire_UseRoleSpecificEquipment()
        {
            var host = new GameObject("ProductionRoleEquipmentHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig keeper = null;
            ProductionCharacterRig fielder = null;
            ProductionCharacterRig umpire = null;
            try
            {
                var keeperSpec = ProductionCharacterSpec.For(ProductionCharacterRole.Wicketkeeper,
                    ProductionCharacterDetail.High);
                keeperSpec.KeeperStandingUpToStumps = true;
                keeper = ProductionCharacterFactory.CreateShared(host.transform, keeperSpec, resources);
                fielder = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder,
                        ProductionCharacterDetail.High), resources);
                umpire = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Umpire,
                        ProductionCharacterDetail.High), resources);

                Assert.That(keeper.FindPart("KeeperWebLeft"), Is.Not.Null);
                Assert.That(keeper.FindPart("KeeperPadLeft"), Is.Not.Null);
                Assert.That(keeper.FindPart("HelmetShell"), Is.Not.Null,
                    "a keeper standing up to the stumps uses a helmet rather than a cap");
                Assert.That(fielder.FindPart("FielderCapCrown"), Is.Not.Null);
                Assert.That(fielder.FindPart("KeeperWebLeft"), Is.Null);
                Assert.That(umpire.FindPart("UmpireHatBrim"), Is.Not.Null);
                Assert.That(umpire.FindPart("BatBlade"), Is.Null);
            }
            finally
            {
                if (keeper != null) keeper.Dispose();
                if (fielder != null) fielder.Dispose();
                if (umpire != null) umpire.Dispose();
                resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void DetailControl_RemovesCloseUpPartsAndUsesSharedLowMesh()
        {
            var host = new GameObject("ProductionCharacterDetailHost");
            ProductionCharacterRig rig = null;
            try
            {
                rig = ProductionCharacterFactory.Create(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Batter,
                        ProductionCharacterDetail.High));
                var heroRenderer = rig.FindPart("BakedCharacterMesh")
                    .GetComponent<SkinnedMeshRenderer>();
                rig.SetHeroCloseUp(true);
                var closeUpMesh = heroRenderer.sharedMesh;
                Assert.That(closeUpMesh.vertexCount, Is.EqualTo(rig.BakedHighVertexCount));
                Assert.That(rig.ActiveTotalTriangleCount, Is.EqualTo(39_454));
                Assert.That(rig.ActiveTotalTriangleCount, Is.LessThanOrEqualTo(40_000));

                rig.SetDetail(ProductionCharacterDetail.Low);
                Assert.That(heroRenderer.sharedMesh, Is.Not.SameAs(closeUpMesh));
                Assert.That(heroRenderer.sharedMesh.vertexCount,
                    Is.LessThan(closeUpMesh.vertexCount));
                Assert.That(rig.FindPart("HeroCricketGearMesh")
                    .GetComponent<SkinnedMeshRenderer>().enabled, Is.True,
                    "the complete protective silhouette remains at live Low detail");
                Assert.That(rig.FindPart("HelmetShell").GetComponent<MeshRenderer>().enabled, Is.False);
            }
            finally
            {
                if (rig != null) rig.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        [Test]
        public void SharedResources_AreReusedAndRequireBalancedCleanup()
        {
            var host = new GameObject("ProductionCharacterSharedResourcesHost");
            var resources = new ProductionCharacterResources(ProductionCharacterPalette.OriginalNightKit());
            ProductionCharacterRig first = null;
            ProductionCharacterRig second = null;
            ProductionCharacterRig third = null;
            try
            {
                first = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.PaceBowler), resources);
                Assert.That(resources.SharedDistantBakedMeshCount, Is.Zero,
                    "a bowler-only owner must not decode or upload fielder-only far meshes");
                var bowlerOnlyMemory = resources.SharedBakedMeshObjectMemoryBytes;
                second = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder), resources);
                Assert.That(resources.BakedMeshDecodeCount, Is.EqualTo(6),
                    "three common hero body LODs, one shared eye mesh and the two field-role LODs are decoded once");
                Assert.That(resources.DistantLodDecodeCount, Is.EqualTo(2));
                third = ProductionCharacterFactory.CreateShared(host.transform,
                    ProductionCharacterSpec.For(ProductionCharacterRole.Fielder), resources);
                Assert.That(resources.BakedMeshDecodeCount, Is.EqualTo(6),
                    "a second fielder reuses meshes without reading/decoding either source payload again");
                Assert.That(resources.DistantLodDecodeCount, Is.EqualTo(2));
                third.Dispose();
                third = null;
                Assert.That(resources.ActiveRigCount, Is.EqualTo(2));
                Assert.That(first.FindPart("Head").GetComponent<MeshFilter>().sharedMesh,
                    Is.SameAs(second.FindPart("Head").GetComponent<MeshFilter>().sharedMesh));
                Assert.That(first.FindPart("Chest").GetComponent<MeshRenderer>().sharedMaterial,
                    Is.SameAs(second.FindPart("Chest").GetComponent<MeshRenderer>().sharedMaterial));
                var firstBaked = first.FindPart("BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
                var secondBaked = second.FindPart("BakedCharacterMesh").GetComponent<SkinnedMeshRenderer>();
                Assert.That(firstBaked.sharedMesh, Is.SameAs(secondBaked.sharedMesh),
                    "the live bowler and close/ring fielder share the bounded common VPM3 LOD2");
                Assert.That(first.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(second.BakedMeshSource,
                    Is.EqualTo(ProductionCharacterMeshSource.LicensedHeroCandidate));
                Assert.That(resources.SharedBakedMeshSetCount, Is.EqualTo(3));
                Assert.That(resources.HeroCachedMeshSetCount, Is.EqualTo(3),
                    "the common body, protected shared eyes and field-only pair each own one cache entry");
                Assert.That(resources.HeroCachedSkeletonCount, Is.EqualTo(1));
                Assert.That(resources.SharedDistantBakedMeshCount, Is.EqualTo(2),
                    "the shared resource upgrades exactly once when its first fielder arrives");
                Assert.That(resources.SharedBakedMeshObjectMemoryBytes, Is.GreaterThan(bowlerOnlyMemory));
                Assert.That(resources.SharedBakedVertexCount,
                    Is.GreaterThan(first.BakedHighVertexCount + first.BakedLowVertexCount),
                    "the shared candidate also owns its two bounded LOD2 meshes exactly once");
                Assert.Throws<System.InvalidOperationException>(() => resources.Dispose());

                var firstRoot = first.Root.gameObject;
                first.Dispose();
                first = null;
                Assert.That(firstRoot == null, Is.True, "rig cleanup destroys its hierarchy immediately in EditMode");
                Assert.That(resources.ActiveRigCount, Is.EqualTo(1));
                second.Dispose();
                second = null;
                Assert.That(resources.ActiveRigCount, Is.Zero);
                resources.Dispose();
                Assert.That(resources.IsDisposed, Is.True);
                Assert.That(resources.SharedMeshCount, Is.Zero);
                Assert.That(resources.SharedMaterialCount, Is.Zero);
            }
            finally
            {
                if (first != null) first.Dispose();
                if (second != null) second.Dispose();
                if (third != null) third.Dispose();
                if (!resources.IsDisposed && resources.ActiveRigCount == 0) resources.Dispose();
                Object.DestroyImmediate(host);
            }
        }

        private static ProductionCharacterRig CreateWithoutHero(
            Transform parent, ProductionCharacterSpec spec)
        {
            var resources = new ProductionCharacterResources(spec.Palette);
            try
            {
                return new ProductionCharacterRig(parent, spec, resources, true, WithoutHero);
            }
            catch
            {
                resources.Dispose();
                throw;
            }
        }

        private static ProductionCharacterRig CreateSharedWithoutHero(
            Transform parent, ProductionCharacterSpec spec, ProductionCharacterResources resources)
        {
            return new ProductionCharacterRig(parent, spec, resources, false, WithoutHero);
        }

        private static TextAsset WithoutHero(string resourceKey)
        {
            return resourceKey.StartsWith("ProductionCharacters/hero", StringComparison.Ordinal)
                ? null
                : Resources.Load<TextAsset>(resourceKey);
        }

        private static string DescribeHeroBounds(ProductionCharacterRig rig, Bounds overall)
        {
            return "overall=" + FormatBounds(overall) +
                   "; body=" + DescribePartBounds(rig, "BakedCharacterMesh") +
                   "; gear=" + DescribePartBounds(rig, "HeroCricketGearMesh") +
                   "; bat=" + DescribePartBounds(rig, "HeroCricketBatMesh");
        }

        private static string DescribePartBounds(ProductionCharacterRig rig, string partName)
        {
            var part = rig.FindPart(partName);
            if (part == null) return "absent";

            var renderer = part.GetComponent<Renderer>();
            if (renderer == null) return "no renderer";
            if (!renderer.enabled || !renderer.gameObject.activeInHierarchy) return "disabled";

            if (!(renderer is SkinnedMeshRenderer skinned)) return FormatBounds(renderer.bounds);

            var sampled = new Mesh { hideFlags = HideFlags.DontSave };
            try
            {
                skinned.BakeMesh(sampled, false);
                return FormatBounds(TransformBounds(
                    sampled.bounds, skinned.transform.localToWorldMatrix));
            }
            finally
            {
                Object.DestroyImmediate(sampled);
            }
        }

        private static Bounds TransformBounds(Bounds localBounds, Matrix4x4 localToWorld)
        {
            var center = localToWorld.MultiplyPoint3x4(localBounds.center);
            var localExtents = localBounds.extents;
            var axisX = localToWorld.MultiplyVector(new Vector3(localExtents.x, 0f, 0f));
            var axisY = localToWorld.MultiplyVector(new Vector3(0f, localExtents.y, 0f));
            var axisZ = localToWorld.MultiplyVector(new Vector3(0f, 0f, localExtents.z));
            var worldExtents = new Vector3(
                Mathf.Abs(axisX.x) + Mathf.Abs(axisY.x) + Mathf.Abs(axisZ.x),
                Mathf.Abs(axisX.y) + Mathf.Abs(axisY.y) + Mathf.Abs(axisZ.y),
                Mathf.Abs(axisX.z) + Mathf.Abs(axisY.z) + Mathf.Abs(axisZ.z));
            return new Bounds(center, worldExtents * 2f);
        }

        private static string FormatBounds(Bounds bounds)
        {
            return "center " + bounds.center.ToString("F4") +
                   ", size " + bounds.size.ToString("F4");
        }
    }
}
