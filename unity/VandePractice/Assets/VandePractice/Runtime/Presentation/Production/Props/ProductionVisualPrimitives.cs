using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.Presentation.Production.Props
{
    /// <summary>
    /// Owns only the runtime objects created by one production visual. The caller's
    /// parent is never destroyed. This makes rebuilds between deliveries and EditMode
    /// verification deterministic without relying on Resources.UnloadUnusedAssets.
    /// </summary>
    public abstract class ProductionOwnedVisual : IDisposable
    {
        private readonly List<Mesh> meshes = new List<Mesh>();
        private readonly List<Material> materials = new List<Material>();
        private readonly List<Texture> textures = new List<Texture>();

        protected ProductionOwnedVisual(GameObject root)
        {
            Root = root != null ? root : throw new ArgumentNullException(nameof(root));
        }

        public GameObject Root { get; private set; }
        public bool IsDisposed => Root == null;

        internal T Own<T>(T value) where T : UnityEngine.Object
        {
            if (value is Mesh mesh) meshes.Add(mesh);
            else if (value is Material material) materials.Add(material);
            else if (value is Texture texture) textures.Add(texture);
            return value;
        }

        public virtual void Dispose()
        {
            if (Root == null) return;
            ProductionVisualPrimitives.DestroyOwned(Root);
            Root = null;
            for (var index = 0; index < meshes.Count; index++)
                ProductionVisualPrimitives.DestroyOwned(meshes[index]);
            for (var index = 0; index < materials.Count; index++)
                ProductionVisualPrimitives.DestroyOwned(materials[index]);
            for (var index = 0; index < textures.Count; index++)
                ProductionVisualPrimitives.DestroyOwned(textures[index]);
            meshes.Clear();
            materials.Clear();
            textures.Clear();
        }
    }

    internal static class ProductionVisualPrimitives
    {
        private static readonly Dictionary<string, Texture2D> TextureCache =
            new Dictionary<string, Texture2D>(StringComparer.Ordinal);

        internal static Material CreateMaterial(string name, Color colour)
        {
            var shader = Shader.Find("Vande/Practice/Surface") ??
                         Shader.Find("Vande/Practice/Lit") ??
                         Shader.Find("Universal Render Pipeline/Lit") ??
                         Shader.Find("Standard") ??
                         Shader.Find("Unlit/Color");
            if (shader == null)
                throw new InvalidOperationException("No compatible production presentation shader is available.");
            return new Material(shader) { name = name, color = colour };
        }

        internal static Material CreateTransparentMaterial(string name, Color colour)
        {
            var shader = Resources.Load<Shader>("VandeProductionDeliveryEffects") ??
                         Shader.Find("Vande/Practice/DeliveryEffects") ??
                         Shader.Find("Sprites/Default") ??
                         Shader.Find("Unlit/Transparent") ??
                         Shader.Find("Standard");
            if (shader == null)
                throw new InvalidOperationException("No compatible transparent presentation shader is available.");
            var material = new Material(shader) { name = name, color = colour };
            if (material.HasProperty("_UseVertexColor"))
                material.SetFloat("_UseVertexColor", 0f);
            return material;
        }

        /// <summary>
        /// Resource lookup happens only while a visual is built. A missing import is
        /// deliberately harmless: the material's authored flat colour remains valid.
        /// Resource textures are Unity-owned and therefore are never destroyed here.
        /// </summary>
        internal static void ApplyResourceTexture(
            Material material,
            string resourcePath,
            Vector2 tiling,
            Vector2? offset = null)
        {
            if (material == null) throw new ArgumentNullException(nameof(material));
            if (string.IsNullOrEmpty(resourcePath) || !material.HasProperty("_MainTex")) return;
            if (!TextureCache.TryGetValue(resourcePath, out var texture))
            {
                texture = Resources.Load<Texture2D>(resourcePath);
                TextureCache.Add(resourcePath, texture);
            }
            if (texture == null) return;
            material.SetTexture("_MainTex", texture);
            material.SetTextureScale("_MainTex", tiling);
            material.SetTextureOffset("_MainTex", offset ?? Vector2.zero);
        }

        internal static GameObject CreateMeshObject(
            string name,
            Transform parent,
            Mesh mesh,
            Material[] materials,
            bool shadows)
        {
            var value = new GameObject(name);
            value.transform.SetParent(parent, false);
            value.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = value.AddComponent<MeshRenderer>();
            renderer.sharedMaterials = materials;
            renderer.shadowCastingMode = shadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = shadows;
            return value;
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

    /// <summary>Small allocation-at-build-time mesh combiner; never used during a delivery.</summary>
    internal sealed class ProductionMeshBuilder
    {
        private readonly List<Vector3> vertices = new List<Vector3>();
        private readonly List<Vector3> normals = new List<Vector3>();
        private readonly List<List<int>> triangles;

        internal ProductionMeshBuilder(int submeshCount = 1)
        {
            if (submeshCount < 1) throw new ArgumentOutOfRangeException(nameof(submeshCount));
            triangles = new List<List<int>>(submeshCount);
            for (var index = 0; index < submeshCount; index++) triangles.Add(new List<int>());
        }

        internal int VertexCount => vertices.Count;

        internal void AddTriangle(Vector3 a, Vector3 b, Vector3 c, Vector3 normal, int submesh = 0)
        {
            ValidateSubmesh(submesh);
            var start = vertices.Count;
            vertices.Add(a);
            vertices.Add(b);
            vertices.Add(c);
            normals.Add(normal);
            normals.Add(normal);
            normals.Add(normal);
            triangles[submesh].Add(start);
            triangles[submesh].Add(start + 1);
            triangles[submesh].Add(start + 2);
        }

        internal void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 normal, int submesh = 0)
        {
            ValidateSubmesh(submesh);
            var start = vertices.Count;
            vertices.Add(a);
            vertices.Add(b);
            vertices.Add(c);
            vertices.Add(d);
            normals.Add(normal);
            normals.Add(normal);
            normals.Add(normal);
            normals.Add(normal);
            triangles[submesh].Add(start);
            triangles[submesh].Add(start + 1);
            triangles[submesh].Add(start + 2);
            triangles[submesh].Add(start);
            triangles[submesh].Add(start + 2);
            triangles[submesh].Add(start + 3);
        }

        internal void AddBox(Vector3 centre, Vector3 size, int submesh = 0)
        {
            AddBox(centre, size, Quaternion.identity, submesh);
        }

        internal void AddBox(Vector3 centre, Vector3 size, Quaternion rotation, int submesh = 0)
        {
            var half = size * 0.5f;
            var p000 = centre + rotation * new Vector3(-half.x, -half.y, -half.z);
            var p001 = centre + rotation * new Vector3(-half.x, -half.y, half.z);
            var p010 = centre + rotation * new Vector3(-half.x, half.y, -half.z);
            var p011 = centre + rotation * new Vector3(-half.x, half.y, half.z);
            var p100 = centre + rotation * new Vector3(half.x, -half.y, -half.z);
            var p101 = centre + rotation * new Vector3(half.x, -half.y, half.z);
            var p110 = centre + rotation * new Vector3(half.x, half.y, -half.z);
            var p111 = centre + rotation * new Vector3(half.x, half.y, half.z);
            AddQuad(p001, p101, p111, p011, rotation * Vector3.forward, submesh);
            AddQuad(p100, p000, p010, p110, rotation * Vector3.back, submesh);
            AddQuad(p101, p100, p110, p111, rotation * Vector3.right, submesh);
            AddQuad(p000, p001, p011, p010, rotation * Vector3.left, submesh);
            AddQuad(p011, p111, p110, p010, rotation * Vector3.up, submesh);
            AddQuad(p000, p100, p101, p001, rotation * Vector3.down, submesh);
        }

        internal void AddCylinder(
            Vector3 centre,
            float radius,
            float height,
            int segments,
            Quaternion rotation,
            int submesh = 0)
        {
            if (radius <= 0f || height <= 0f) throw new ArgumentOutOfRangeException(nameof(radius));
            if (segments < 3) throw new ArgumentOutOfRangeException(nameof(segments));
            var half = height * 0.5f;
            for (var index = 0; index < segments; index++)
            {
                var next = (index + 1) % segments;
                var a0 = Mathf.PI * 2f * index / segments;
                var a1 = Mathf.PI * 2f * next / segments;
                var radial0 = new Vector3(Mathf.Sin(a0), 0f, Mathf.Cos(a0));
                var radial1 = new Vector3(Mathf.Sin(a1), 0f, Mathf.Cos(a1));
                var bottom0 = centre + rotation * (radial0 * radius + Vector3.down * half);
                var bottom1 = centre + rotation * (radial1 * radius + Vector3.down * half);
                var top0 = centre + rotation * (radial0 * radius + Vector3.up * half);
                var top1 = centre + rotation * (radial1 * radius + Vector3.up * half);
                var sideNormal = rotation * (radial0 + radial1).normalized;
                AddQuad(bottom1, bottom0, top0, top1, sideNormal, submesh);
                AddTriangle(centre + rotation * Vector3.up * half, top0, top1,
                    rotation * Vector3.up, submesh);
                AddTriangle(centre + rotation * Vector3.down * half, bottom1, bottom0,
                    rotation * Vector3.down, submesh);
            }
        }

        internal Mesh Build(string name)
        {
            var mesh = new Mesh { name = name };
            if (vertices.Count > ushort.MaxValue) mesh.indexFormat = IndexFormat.UInt32;
            mesh.SetVertices(vertices);
            mesh.SetNormals(normals);
            var uv = new List<Vector2>(vertices.Count);
            for (var index = 0; index < vertices.Count; index++)
                uv.Add(new Vector2(vertices[index].x, vertices[index].z));
            mesh.SetUVs(0, uv);
            mesh.subMeshCount = triangles.Count;
            for (var index = 0; index < triangles.Count; index++)
                mesh.SetTriangles(triangles[index], index, false);
            mesh.RecalculateBounds();
            return mesh;
        }

        private void ValidateSubmesh(int submesh)
        {
            if (submesh < 0 || submesh >= triangles.Count)
                throw new ArgumentOutOfRangeException(nameof(submesh));
        }
    }
}
