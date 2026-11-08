using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Object = UnityEngine.Object;

namespace Vande.Practice.Tests
{
    public sealed class ProductionCharacterTextureAndFormatTests
    {
        [Test]
        public void Decoder_PreservesVpm2UvAndMarksOnlyUvCapableVertices()
        {
            var mesh = ProductionBakedCharacterMesh.Decode(BuildTriangle(true), "VPM2 UV test");
            try
            {
                Assert.That(mesh.uv, Is.EqualTo(new[]
                {
                    new Vector2(0.125f, 0.25f),
                    new Vector2(0.875f, 0.25f),
                    new Vector2(0.125f, 0.75f)
                }));
                Assert.That(mesh.colors32, Has.All.Matches<Color32>(colour => colour.g == 255));
                var bindPositions = new List<Vector3>();
                mesh.GetUVs(1, bindPositions);
                Assert.That(bindPositions, Has.Count.EqualTo(3));
                Assert.That(bindPositions[1], Is.EqualTo(new Vector3(1f, 0f, 0f)));
            }
            finally
            {
                Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void Decoder_RetainsVpm1AndFailsClosedWithoutSkinUvCapability()
        {
            var mesh = ProductionBakedCharacterMesh.Decode(BuildTriangle(false), "VPM1 compatibility test");
            try
            {
                Assert.That(mesh.uv, Is.Empty);
                Assert.That(mesh.colors32, Has.All.Matches<Color32>(colour => colour.g == 0));
                Assert.That(mesh.triangles, Is.EqualTo(new[] { 0, 1, 2 }));
            }
            finally
            {
                Object.DestroyImmediate(mesh);
            }
        }

        [Test]
        public void Decoder_RejectsMismatchedVpm2VersionAndByteLength()
        {
            var wrongVersion = BuildTriangle(true);
            wrongVersion[4] = 1;
            wrongVersion[5] = 0;
            Assert.That(() => ProductionBakedCharacterMesh.Decode(wrongVersion, "wrong version"),
                Throws.InvalidOperationException.With.Message.Contains("version"));

            var exact = BuildTriangle(true);
            var truncated = new byte[exact.Length - 1];
            Array.Copy(exact, truncated, truncated.Length);
            Assert.That(() => ProductionBakedCharacterMesh.Decode(truncated, "truncated"),
                Throws.InvalidOperationException.With.Message.Contains("byte length"));
        }

        [Test]
        public void BakedSkinMaterial_UsesPinnedTextureAndMissingResourceFailsClosed()
        {
            var shader = Resources.Load<Shader>("VandeProductionCharacter") ??
                         Shader.Find("Vande/Practice/Character");
            Assert.That(shader, Is.Not.Null);
            var material = new Material(shader);
            try
            {
                ProductionCharacterResources.ConfigureBakedSkinTexture(material, null);
                Assert.That(material.GetFloat("_SkinTextureEnabled"), Is.Zero);
                Assert.That(material.GetTexture("_SkinTex"), Is.Null);

                var texture = Resources.Load<Texture2D>(
                    ProductionCharacterResources.BakedSkinTextureResourceKey);
                Assert.That(texture, Is.Not.Null);
                Assert.That(texture.width, Is.EqualTo(1024));
                Assert.That(texture.height, Is.EqualTo(1024));
                Assert.That(texture.isReadable, Is.False);
                ProductionCharacterResources.ConfigureBakedSkinTexture(material, texture);
                Assert.That(material.GetFloat("_SkinTextureEnabled"), Is.EqualTo(1f));
                Assert.That(material.GetTexture("_SkinTex"), Is.SameAs(texture));
            }
            finally
            {
                Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void BakedKitSurfaceMaterial_RequiresCompleteNormalAndAoPair()
        {
            var shader = Resources.Load<Shader>("VandeProductionCharacter") ??
                         Shader.Find("Vande/Practice/Character");
            Assert.That(shader, Is.Not.Null);
            var material = new Material(shader);
            var normal = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            var ambientOcclusion = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
            try
            {
                ProductionCharacterResources.ConfigureBakedKitSurfaceTextures(
                    material, normal, null);
                Assert.That(material.GetFloat("_KitSurfaceEnabled"), Is.Zero);
                Assert.That(material.GetTexture("_KitNormalTex"), Is.Null);
                Assert.That(material.GetTexture("_KitAoTex"), Is.Null);

                ProductionCharacterResources.ConfigureBakedKitSurfaceTextures(
                    material, normal, ambientOcclusion);
                Assert.That(material.GetFloat("_KitSurfaceEnabled"), Is.EqualTo(1f));
                Assert.That(material.GetTexture("_KitNormalTex"), Is.SameAs(normal));
                Assert.That(material.GetTexture("_KitAoTex"), Is.SameAs(ambientOcclusion));
            }
            finally
            {
                Object.DestroyImmediate(ambientOcclusion);
                Object.DestroyImmediate(normal);
                Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void FittedHeroMaterials_DoNotLoadOrBindLegacySuitSurfaceAtlases()
        {
            var requestedKeys = new List<string>();
            var resources = new ProductionCharacterResources(
                ProductionCharacterPalette.OriginalNightKit(),
                key =>
                {
                    requestedKeys.Add(key);
                    return Resources.Load<Texture2D>(key);
                });
            try
            {
                Assert.That(requestedKeys,
                    Does.Not.Contain(ProductionCharacterResources.HeroKitNormalTextureResourceKey));
                Assert.That(requestedKeys,
                    Does.Not.Contain(ProductionCharacterResources.HeroKitAmbientOcclusionTextureResourceKey));
                Assert.That(resources.HeroKitSurfaceTexturesAvailable, Is.False,
                    "the legacy suit atlases do not match the fitted anatomy UV/tangent basis");

                var live = resources.Material(ProductionMaterialKind.HeroCharacter);
                var closeUp = resources.Material(ProductionMaterialKind.HeroCharacterCloseUp);
                foreach (var material in new[] { live, closeUp })
                {
                    Assert.That(material.GetFloat("_KitSurfaceEnabled"), Is.Zero);
                    Assert.That(material.GetTexture("_KitNormalTex"), Is.Null);
                    Assert.That(material.GetTexture("_KitAoTex"), Is.Null);
                }
            }
            finally
            {
                resources.Dispose();
            }
        }

        [Test]
        public void HeroEyeMaterial_RequiresExplicitPinnedTextureAndNeverImplicitWhite()
        {
            var shader = Resources.Load<Shader>("VandeProductionCharacter") ??
                         Shader.Find("Vande/Practice/Character");
            Assert.That(shader, Is.Not.Null);
            var material = new Material(shader);
            var eye = new Texture2D(2, 2, TextureFormat.RGB24, false, false);
            try
            {
                ProductionCharacterResources.ConfigureHeroEyeTexture(material, null);
                Assert.That(material.GetFloat("_EyeTextureEnabled"), Is.Zero);
                Assert.That(material.GetTexture("_EyeTex"), Is.Null);

                ProductionCharacterResources.ConfigureHeroEyeTexture(material, eye);
                Assert.That(material.GetFloat("_EyeTextureEnabled"), Is.EqualTo(1f));
                Assert.That(material.GetTexture("_EyeTex"), Is.SameAs(eye));
            }
            finally
            {
                Object.DestroyImmediate(eye);
                Object.DestroyImmediate(material);
            }
        }

        [Test]
        public void HeroEyeTexture_IsSrgbUnreadableAndImportBoundedAt256()
        {
            var texture = Resources.Load<Texture2D>(
                ProductionCharacterResources.HeroEyeTextureResourceKey);
            Assert.That(texture, Is.Not.Null,
                ProductionCharacterResources.HeroEyeTextureResourceKey);
            Assert.That(texture.width, Is.EqualTo(256));
            Assert.That(texture.height, Is.EqualTo(256));
            Assert.That(texture.isReadable, Is.False);

            var path = AssetDatabase.GetAssetPath(texture);
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            Assert.That(importer, Is.Not.Null, path);
            Assert.That(importer.sRGBTexture, Is.True,
                "the eye derivative is colour albedo, not linear data");
            Assert.That(importer.textureType, Is.EqualTo(TextureImporterType.Default));
            Assert.That(importer.maxTextureSize, Is.EqualTo(256));
            Assert.That(importer.GetPlatformTextureSettings("Android").maxTextureSize,
                Is.EqualTo(256));
            Assert.That(importer.GetPlatformTextureSettings("WebGL").maxTextureSize,
                Is.EqualTo(256));
        }

        [Test]
        public void HeroEyeShader_UsesDedicatedRegionAndFacialLightingInsteadOfSkinOrKitFallback()
        {
            var shader = Resources.Load<Shader>("VandeProductionCharacter") ??
                         Shader.Find("Vande/Practice/Character");
            Assert.That(shader, Is.Not.Null);
            var path = AssetDatabase.GetAssetPath(shader);
            var source = File.ReadAllText(path);
            StringAssert.Contains("sampler2D _EyeTex", source);
            StringAssert.Contains("else if (region < 16.5h)", source);
            StringAssert.Contains("tex2D(_EyeTex, skinUv)", source);
            StringAssert.Contains("const half eyeRegion = step(15.5h, region)", source);
            StringAssert.Contains("const half skinLikeRegion", source);
            StringAssert.Contains("lerp(_KitShadowLift, _SkinShadowLift, skinLikeRegion)", source);
            StringAssert.Contains("_FaceReadability * (faceRegion + eyeRegion", source);
        }

        [TestCase(ProductionCharacterResources.HeroKitNormalTextureResourceKey,
            TextureImporterType.NormalMap)]
        [TestCase(ProductionCharacterResources.HeroKitAmbientOcclusionTextureResourceKey,
            TextureImporterType.Default)]
        public void HeroKitSurfaceTexture_IsLinearUnreadableAndImportBoundedAt512(
            string resourceKey,
            TextureImporterType expectedType)
        {
            var texture = Resources.Load<Texture2D>(resourceKey);
            Assert.That(texture, Is.Not.Null, resourceKey);
            Assert.That(texture.width, Is.EqualTo(512), resourceKey);
            Assert.That(texture.height, Is.EqualTo(512), resourceKey);
            Assert.That(texture.isReadable, Is.False, resourceKey);

            var path = AssetDatabase.GetAssetPath(texture);
            var importer = AssetImporter.GetAtPath(path) as TextureImporter;
            Assert.That(importer, Is.Not.Null, path);
            Assert.That(importer.sRGBTexture, Is.False, resourceKey + " must sample in linear space");
            Assert.That(importer.textureType, Is.EqualTo(expectedType));
            Assert.That(importer.maxTextureSize, Is.EqualTo(512));
            Assert.That(importer.GetPlatformTextureSettings("Android").maxTextureSize, Is.EqualTo(512));
            Assert.That(importer.GetPlatformTextureSettings("WebGL").maxTextureSize, Is.EqualTo(512));
        }

        private static byte[] BuildTriangle(bool vpm2)
        {
            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(new[] { (byte)'V', (byte)'P', (byte)'M', vpm2 ? (byte)'2' : (byte)'1' });
                writer.Write(vpm2 ? (ushort)2 : (ushort)1);
                writer.Write((ushort)ProductionCharacterJoint.Count);
                writer.Write((uint)3);
                writer.Write((uint)3);
                var positions = new[]
                {
                    new Vector3(0f, 0f, 0f),
                    new Vector3(1f, 0f, 0f),
                    new Vector3(0f, 1f, 0f)
                };
                var uvs = new[]
                {
                    new Vector2(0.125f, 0.25f),
                    new Vector2(0.875f, 0.25f),
                    new Vector2(0.125f, 0.75f)
                };
                for (var index = 0; index < positions.Length; index++)
                {
                    Write(writer, positions[index]);
                    Write(writer, Vector3.forward);
                    Write(writer, positions[index]);
                    if (vpm2)
                    {
                        writer.Write(uvs[index].x);
                        writer.Write(uvs[index].y);
                    }
                    writer.Write((byte)index);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write((byte)0);
                    writer.Write(ushort.MaxValue);
                    writer.Write((ushort)0);
                }
                writer.Write((ushort)0);
                writer.Write((ushort)1);
                writer.Write((ushort)2);
                writer.Flush();
                return stream.ToArray();
            }
        }

        private static void Write(BinaryWriter writer, Vector3 value)
        {
            writer.Write(value.x);
            writer.Write(value.y);
            writer.Write(value.z);
        }
    }
}
