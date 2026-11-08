using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.UI.Production
{
    internal sealed class ProductionHudShape
    {
        private static readonly int ColourId = Shader.PropertyToID("_Color");
        private readonly GameObject target;
        private readonly MeshRenderer renderer;
        private readonly MaterialPropertyBlock properties = new MaterialPropertyBlock();

        public ProductionHudShape(
            Transform parent,
            string name,
            int layer,
            Mesh mesh,
            Material material,
            int sortingOrder)
        {
            target = new GameObject(name);
            target.hideFlags = HideFlags.DontSave;
            target.layer = layer;
            target.transform.SetParent(parent, false);
            var filter = target.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            renderer = target.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.sortingOrder = sortingOrder;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
        }

        public bool Visible => target.activeSelf;

        public void SetRect(Rect value, float depth = 0f)
        {
            target.transform.localPosition = new Vector3(value.center.x, value.center.y, depth);
            target.transform.localRotation = Quaternion.identity;
            target.transform.localScale = new Vector3(value.width, value.height, 1f);
        }

        public void SetColour(Color value)
        {
            properties.Clear();
            properties.SetColor(ColourId, value);
            renderer.SetPropertyBlock(properties);
        }

        public void SetVisible(bool value)
        {
            if (target.activeSelf != value) target.SetActive(value);
        }
    }

    internal sealed class ProductionHudLabel
    {
        private readonly ProductionHudAdvancedLabel advancedLabel;

        public ProductionHudLabel(
            Transform parent,
            string name,
            int layer,
            int sortingOrder,
            TextAnchor anchor,
            TextAlignment alignment)
        {
            advancedLabel = ProductionHudAdvancedTextLayer.For(parent).CreateLabel(
                name,
                anchor,
                alignment);
        }

        public string Text => advancedLabel.Text;
        public Color Colour => advancedLabel.Colour;
        public bool Visible => advancedLabel.Visible;

        /// <summary>Rail copy: explicit lines only, reduced to fit its box (see ProductionHudAdvancedLabel).</summary>
        public ProductionHudLabel Compact(bool wrap = false)
        {
            advancedLabel.ConfigureCompact(wrap);
            return this;
        }

        public Vector2 MeasureUnwrapped(string value, float fontSize) =>
            advancedLabel.MeasureUnwrapped(value, fontSize);

        public void Set(string value, Vector2 position, float pixelHeight, Color colour, float depth = 0f)
        {
            advancedLabel.Set(value, position, pixelHeight, colour, depth);
        }

        /// <summary>
        /// Keeps the requested accessible size. UI Toolkit wraps bounded text;
        /// essential long-form copy uses its dedicated scroll surface rather
        /// than shrinking, truncating or inserting an ellipsis.
        /// </summary>
        public void SetFitted(
            string value,
            Vector2 position,
            float requestedPixelHeight,
            Color colour,
            Rect bounds,
            Vector2 padding,
            float depth = 0f,
            float minimumPixelHeight = 0f)
        {
            advancedLabel.SetFitted(
                value,
                position,
                requestedPixelHeight,
                colour,
                bounds,
                padding,
                depth,
                minimumPixelHeight);
        }

        public Vector2 MeasureWrapped(string value, float width, float fontSize) =>
            advancedLabel.MeasureWrapped(value, width, fontSize);

        public void SetPointerInteractive(bool value) => advancedLabel.SetPointerInteractive(value);

        public void SetColour(Color value)
        {
            advancedLabel.SetColour(value);
        }

        public void SetVisible(bool value)
        {
            advancedLabel.SetVisible(value);
        }
    }

    internal sealed class ProductionHudVisualResources
    {
        public ProductionHudVisualResources()
        {
            var shader = Resources.Load<Shader>("VandeProductionHud");
            if (shader == null) shader = Shader.Find("Sprites/Default");
            if (shader == null) shader = Shader.Find("Unlit/Color");
            if (shader == null)
                throw new InvalidOperationException("A transparent unlit shader is required for the Practice HUD.");

            Material = new Material(shader)
            {
                name = "VANDE Production HUD Material",
                hideFlags = HideFlags.DontSave
            };
            RoundedRectangle = CreateRoundedRectangle();
            Circle = CreateCircle(40);
            Ring = CreateRing(48, 0.82f);
            Quad = CreateQuad();
        }

        public Material Material { get; private set; }
        public Mesh RoundedRectangle { get; private set; }
        public Mesh Circle { get; private set; }
        public Mesh Ring { get; private set; }
        public Mesh Quad { get; private set; }

        public void Release()
        {
            DestroyOwned(Material);
            DestroyOwned(RoundedRectangle);
            DestroyOwned(Circle);
            DestroyOwned(Ring);
            DestroyOwned(Quad);
            Material = null;
            RoundedRectangle = null;
            Circle = null;
            Ring = null;
            Quad = null;
        }

        private static Mesh CreateQuad()
        {
            var mesh = NewMesh("VANDE HUD Quad");
            mesh.vertices = new[]
            {
                new Vector3(-0.5f, -0.5f), new Vector3(0.5f, -0.5f),
                new Vector3(0.5f, 0.5f), new Vector3(-0.5f, 0.5f)
            };
            mesh.triangles = new[] { 0, 2, 1, 0, 3, 2 };
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateCircle(int segments)
        {
            var vertices = new Vector3[segments + 1];
            var triangles = new int[segments * 3];
            for (var index = 0; index < segments; index++)
            {
                var angle = Mathf.PI * 2f * index / segments;
                vertices[index + 1] = new Vector3(Mathf.Cos(angle) * 0.5f, Mathf.Sin(angle) * 0.5f);
                var offset = index * 3;
                triangles[offset] = 0;
                triangles[offset + 1] = index + 1;
                triangles[offset + 2] = (index + 1) % segments + 1;
            }
            var mesh = NewMesh("VANDE HUD Circle");
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateRing(int segments, float innerRatio)
        {
            var vertices = new Vector3[segments * 2];
            var triangles = new int[segments * 6];
            for (var index = 0; index < segments; index++)
            {
                var angle = Mathf.PI * 2f * index / segments;
                var direction = new Vector3(Mathf.Cos(angle), Mathf.Sin(angle));
                vertices[index * 2] = direction * 0.5f;
                vertices[index * 2 + 1] = direction * (0.5f * innerRatio);
                var next = (index + 1) % segments;
                var offset = index * 6;
                triangles[offset] = index * 2;
                triangles[offset + 1] = next * 2 + 1;
                triangles[offset + 2] = next * 2;
                triangles[offset + 3] = index * 2;
                triangles[offset + 4] = index * 2 + 1;
                triangles[offset + 5] = next * 2 + 1;
            }
            var mesh = NewMesh("VANDE HUD Ring");
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private static Mesh CreateRoundedRectangle()
        {
            const int cornerSteps = 5;
            const float radius = 0.14f;
            var perimeter = new List<Vector3>(cornerSteps * 4);
            AddCorner(perimeter, 0.5f - radius, 0.5f - radius, radius, 0f, cornerSteps);
            AddCorner(perimeter, -0.5f + radius, 0.5f - radius, radius, 90f, cornerSteps);
            AddCorner(perimeter, -0.5f + radius, -0.5f + radius, radius, 180f, cornerSteps);
            AddCorner(perimeter, 0.5f - radius, -0.5f + radius, radius, 270f, cornerSteps);

            var vertices = new Vector3[perimeter.Count + 1];
            for (var index = 0; index < perimeter.Count; index++) vertices[index + 1] = perimeter[index];
            var triangles = new int[perimeter.Count * 3];
            for (var index = 0; index < perimeter.Count; index++)
            {
                var offset = index * 3;
                triangles[offset] = 0;
                triangles[offset + 1] = index + 1;
                triangles[offset + 2] = (index + 1) % perimeter.Count + 1;
            }
            var mesh = NewMesh("VANDE HUD Rounded Rectangle");
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void AddCorner(
            ICollection<Vector3> values,
            float centerX,
            float centerY,
            float radius,
            float startDegrees,
            int steps)
        {
            for (var index = 0; index < steps; index++)
            {
                var radians = (startDegrees + 90f * index / (steps - 1)) * Mathf.Deg2Rad;
                values.Add(new Vector3(
                    centerX + Mathf.Cos(radians) * radius,
                    centerY + Mathf.Sin(radians) * radius));
            }
        }

        private static Mesh NewMesh(string name)
        {
            return new Mesh { name = name, hideFlags = HideFlags.DontSave };
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
