using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// The field-overview PIP (HUM item 6): a second, low-resolution orthographic camera looking straight down on the
    /// ground, rendering only a PIP layer into a render texture that the HUD shows in its pinned radar rect. The layer
    /// holds the field, pitch and boundary plus the striker and eleven defenders (bowler, keeper and nine other
    /// fielders) and the ball, placed every frame from the presented world (which follows the physics). The non-striker
    /// remains present in the 3D world but is deliberately omitted here: this inset communicates the field setting,
    /// and its frozen exact-screen identity is one batter plus eleven defenders. The image
    /// reads like the rear batting view: bowler's end at the top, and world -x (a right-hander's off side after the
    /// physics-to-Unity reflection) on the right. Characters themselves are never drawn here, so no character fade or
    /// LOD from the rear camera leaks into it. Presentation only.
    /// </summary>
    public sealed class ProductionFieldPip : IDisposable
    {
        public const int Layer = 29;
        public const float FieldRadiusMetres = 75f;
        // Keep neighbouring fielders individually legible after the 192px source is reduced into the frozen 84px
        // HUD panel's 76px field aperture. The striker and keeper use role-specific pitch-oriented glyphs below;
        // the remaining humans retain this measured disc radius.
        public const float HumanMarkerRadiusMetres = 1.8f;
        public const float BatterMarkerRadiusMetres = 4.0f;
        public const float BallMarkerRadiusMetres = 2.6f;
        private const float CameraHeightMetres = 200f;
        private static readonly int ColourId = Shader.PropertyToID("_Color");

        private readonly GameObject root;
        private readonly Material material;
        private readonly Mesh disc;
        private readonly Mesh strikerGlyph;
        private readonly Mesh keeperGlyph;
        private readonly Vector3[] strikerVertices;
        private readonly Vector3[] keeperVertices;
        private readonly Mesh ring;
        private readonly Mesh quad;
        private readonly List<MeshRenderer> humanMarkers = new List<MeshRenderer>();
        private readonly List<MeshFilter> humanMarkerFilters = new List<MeshFilter>();
        private readonly List<Vector3> humanPositions = new List<Vector3>();
        private readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        private MeshRenderer ballOutline;
        private MeshRenderer ballMarker;
        private int strikerIndex = -1;
        private int bowlerIndex = -1;
        private int keeperIndex = -1;
        private bool disposed;

        public ProductionFieldPip(Transform parent, int resolution)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            resolution = Mathf.Clamp(resolution, 64, 512);
            root = new GameObject("FieldPip") { hideFlags = HideFlags.DontSave };
            root.transform.SetParent(parent, false);
            root.layer = Layer;
            var shader = Resources.Load<Shader>("VandeProductionHud") ?? Shader.Find("Sprites/Default") ??
                         Shader.Find("Unlit/Color");
            material = new Material(shader) { name = "VANDE Field PIP", hideFlags = HideFlags.DontSave };
            disc = Disc(48);
            strikerVertices = new[]
            {
                Vertex(new Vector2(-0.50f, 0.05f)),
                Vertex(new Vector2(0f, 0.45f)),
                Vertex(new Vector2(0.50f, 0.05f))
            };
            strikerGlyph = Build("VANDE PIP Striker Triangle", strikerVertices,
                new[] { 0, 1, 2, 0, 2, 1 });
            keeperVertices = new[]
            {
                Vertex(new Vector2(-0.625f, 0f)),
                Vertex(new Vector2(0.625f, 0f)),
                Vertex(new Vector2(0.175f, 0.90f)),
                Vertex(new Vector2(-0.175f, 0.90f))
            };
            keeperGlyph = Build("VANDE PIP Keeper Chevron", keeperVertices,
                new[] { 0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3 });
            ring = Ring(64, 0.985f);
            quad = Quad();

            Texture = new RenderTexture(resolution, resolution, 16, RenderTextureFormat.ARGB32)
            {
                name = "VANDE Field PIP",
                antiAliasing = 1,
                useMipMap = false,
                filterMode = FilterMode.Bilinear,
                hideFlags = HideFlags.DontSave
            };
            Texture.Create();

            var cameraObject = new GameObject("FieldPipCamera") { hideFlags = HideFlags.DontSave };
            cameraObject.transform.SetParent(root.transform, false);
            cameraObject.transform.SetPositionAndRotation(new Vector3(0f, CameraHeightMetres, 0f),
                Quaternion.LookRotation(Vector3.down, Vector3.back));
            Camera = cameraObject.AddComponent<Camera>();
            Camera.orthographic = true;
            Camera.orthographicSize = FieldRadiusMetres + 2f;
            Camera.aspect = 1f;
            Camera.nearClipPlane = 1f;
            Camera.farClipPlane = CameraHeightMetres + 10f;
            Camera.cullingMask = 1 << Layer;
            Camera.clearFlags = CameraClearFlags.SolidColor;
            Camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            Camera.allowMSAA = false;
            Camera.allowHDR = false;
            Camera.useOcclusionCulling = false;
            Camera.depth = -50f;
            Camera.targetTexture = Texture;

            Piece("Field", disc, Vector3.zero, FieldRadiusMetres * 2f, FieldRadiusMetres * 2f, 0,
                new Color(0.17f, 0.36f, 0.20f, 1f));
            Piece("Boundary", ring, Vector3.zero, FieldRadiusMetres * 2f, FieldRadiusMetres * 2f, 1,
                new Color(1f, 1f, 1f, 0.55f));
            Piece("Pitch", quad, Vector3.zero, 3.05f, 20.12f, 1, new Color(0.80f, 0.70f, 0.48f, 1f));
            ballOutline = Piece("BallOutline", disc, Vector3.zero, BallMarkerRadiusMetres * 2.8f,
                BallMarkerRadiusMetres * 2.8f, 5, new Color(0.05f, 0.05f, 0.08f, 0.95f));
            ballMarker = Piece("Ball", disc, Vector3.zero, BallMarkerRadiusMetres * 2f, BallMarkerRadiusMetres * 2f, 6,
                new Color(1f, 0.96f, 0.80f, 1f));
            SetBall(null);
        }

        public Camera Camera { get; }
        public RenderTexture Texture { get; }
        public int MarkerCount => humanMarkers.Count;

        public static Color StrikerColour => new Color(1f, 0.62f, 0.16f, 1f);
        public static Color BowlerColour => new Color(0.96f, 0.36f, 0.36f, 1f);
        public static Color KeeperColour => new Color(1f, 0.90f, 0.30f, 1f);
        public static Color FielderColour => new Color(0.93f, 0.95f, 1f, 1f);

        /// <summary>Places marker `index` (created on first use) at a world ground position.</summary>
        public void SetHuman(int index, Vector3 worldPosition, Color colour, bool batter)
        {
            if (disposed) return;
            while (humanMarkers.Count <= index)
            {
                var markerRenderer = Piece(
                    "Human" + humanMarkers.Count, disc, Vector3.zero, 1f, 1f, 3, Color.white);
                humanMarkers.Add(markerRenderer);
                humanMarkerFilters.Add(markerRenderer.GetComponent<MeshFilter>());
                humanPositions.Add(Vector3.zero);
            }
            var marker = humanMarkers[index];
            var radius = batter ? BatterMarkerRadiusMetres : HumanMarkerRadiusMetres;
            Place(marker.transform, worldPosition, radius * 2f, radius * 2f);
            humanPositions[index] = worldPosition;
            var filter = humanMarkerFilters[index];
            Mesh roleMesh;
            if (batter)
            {
                strikerIndex = index;
                roleMesh = strikerGlyph;
            }
            else if (SameColour(colour, BowlerColour))
            {
                bowlerIndex = index;
                roleMesh = disc;
            }
            else if (SameColour(colour, KeeperColour))
            {
                keeperIndex = index;
                roleMesh = keeperGlyph;
            }
            else
            {
                roleMesh = disc;
            }
            if (filter.sharedMesh != roleMesh) filter.sharedMesh = roleMesh;
            Colour(marker, colour);
            if (!marker.gameObject.activeSelf) marker.gameObject.SetActive(true);
        }

        public void HideHumansFrom(int index)
        {
            for (var i = index; i < humanMarkers.Count; i++)
                if (humanMarkers[i].gameObject.activeSelf) humanMarkers[i].gameObject.SetActive(false);
            // SetHuman is called once per presented actor. Commit the two oriented meshes only after the whole
            // authoritative frame has been supplied, avoiding repeated bounds work and per-frame allocations.
            UpdateRoleGlyphs();
        }

        public void SetBall(Vector3? worldPosition)
        {
            if (disposed) return;
            var visible = worldPosition.HasValue;
            if (ballMarker.gameObject.activeSelf != visible)
            {
                ballMarker.gameObject.SetActive(visible);
                ballOutline.gameObject.SetActive(visible);
            }
            if (!visible) return;
            Place(ballOutline.transform, worldPosition.Value, BallMarkerRadiusMetres * 2.8f, BallMarkerRadiusMetres * 2.8f);
            Place(ballMarker.transform, worldPosition.Value, BallMarkerRadiusMetres * 2f, BallMarkerRadiusMetres * 2f);
        }

        /// <summary>Viewport (0..1, bottom-left origin) of a world ground point in the PIP image.</summary>
        public Vector2 ViewportOf(Vector3 worldPosition)
        {
            var v = Camera.WorldToViewportPoint(new Vector3(worldPosition.x, 0f, worldPosition.z));
            return new Vector2(v.x, v.y);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            if (Camera != null) Camera.targetTexture = null;
            if (Texture != null)
            {
                Texture.Release();
                Destroy(Texture);
            }
            Destroy(material);
            Destroy(disc);
            Destroy(strikerGlyph);
            Destroy(keeperGlyph);
            Destroy(ring);
            Destroy(quad);
            Destroy(root);
        }

        private MeshRenderer Piece(string name, Mesh mesh, Vector3 position, float width, float depth, int order,
            Color colour)
        {
            var piece = new GameObject(name) { hideFlags = HideFlags.DontSave };
            piece.layer = Layer;
            piece.transform.SetParent(root.transform, false);
            piece.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = piece.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.sortingOrder = order;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off;
            renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            Place(piece.transform, position, width, depth);
            Colour(renderer, colour);
            return renderer;
        }

        private static void Place(Transform piece, Vector3 position, float width, float depth)
        {
            // Meshes lie in their local XY plane; rotate them flat onto the ground (facing up, towards the camera).
            piece.SetPositionAndRotation(new Vector3(position.x, 0.5f, position.z), Quaternion.Euler(90f, 0f, 0f));
            piece.localScale = new Vector3(width, depth, 1f);
        }

        private void Colour(Renderer renderer, Color colour)
        {
            block.Clear();
            block.SetColor(ColourId, colour);
            renderer.SetPropertyBlock(block);
        }

        private void UpdateRoleGlyphs()
        {
            if (strikerIndex >= 0 && bowlerIndex >= 0 &&
                strikerIndex < humanMarkers.Count && bowlerIndex < humanPositions.Count)
            {
                OrientTriangle(
                    strikerGlyph,
                    humanMarkers[strikerIndex].transform,
                    humanPositions[bowlerIndex] - humanPositions[strikerIndex],
                    0.05f,
                    0.45f,
                    1f,
                    strikerVertices);
            }
            if (keeperIndex >= 0 && strikerIndex >= 0 &&
                keeperIndex < humanMarkers.Count && strikerIndex < humanPositions.Count)
            {
                OrientTrapezoid(
                    keeperGlyph,
                    humanMarkers[keeperIndex].transform,
                    humanPositions[strikerIndex] - humanPositions[keeperIndex],
                    0f,
                    0.90f,
                    1.25f,
                    0.35f,
                    true,
                    keeperVertices);
            }
        }

        private static void OrientTriangle(
            Mesh mesh,
            Transform marker,
            Vector3 towardWorld,
            float start,
            float end,
            float width,
            Vector3[] vertices)
        {
            var direction = LocalPlanarDirection(marker, towardWorld);
            var across = new Vector2(-direction.y, direction.x);
            vertices[0] = Vertex(direction * start - across * width * 0.5f);
            vertices[1] = Vertex(direction * end);
            vertices[2] = Vertex(direction * start + across * width * 0.5f);
            mesh.vertices = vertices;
            mesh.RecalculateBounds();
        }

        private static void OrientTrapezoid(
            Mesh mesh,
            Transform marker,
            Vector3 otherWorld,
            float start,
            float end,
            float startWidth,
            float endWidth,
            bool away,
            Vector3[] vertices)
        {
            var direction = LocalPlanarDirection(marker, otherWorld);
            if (away) direction = -direction;
            var across = new Vector2(-direction.y, direction.x);
            var startPoint = direction * start;
            var endPoint = direction * end;
            var startAcross = across * startWidth * 0.5f;
            var endAcross = across * endWidth * 0.5f;
            vertices[0] = Vertex(startPoint - startAcross);
            vertices[1] = Vertex(startPoint + startAcross);
            vertices[2] = Vertex(endPoint + endAcross);
            vertices[3] = Vertex(endPoint - endAcross);
            mesh.vertices = vertices;
            mesh.RecalculateBounds();
        }

        private static Vector2 LocalPlanarDirection(Transform marker, Vector3 worldDirection)
        {
            worldDirection.y = 0f;
            if (worldDirection.sqrMagnitude <= 0.000001f) return Vector2.up;
            var local = marker.InverseTransformDirection(worldDirection.normalized);
            var direction = new Vector2(local.x, local.y);
            return direction.sqrMagnitude <= 0.000001f ? Vector2.up : direction.normalized;
        }

        private static Vector3 Vertex(Vector2 value)
        {
            return new Vector3(value.x, value.y, 0f);
        }

        private static bool SameColour(Color left, Color right)
        {
            return Mathf.Abs(left.r - right.r) <= 0.0001f &&
                   Mathf.Abs(left.g - right.g) <= 0.0001f &&
                   Mathf.Abs(left.b - right.b) <= 0.0001f &&
                   Mathf.Abs(left.a - right.a) <= 0.0001f;
        }

        private static Mesh Disc(int segments)
        {
            var vertices = new Vector3[segments + 1];
            var triangles = new int[segments * 3];
            for (var i = 0; i < segments; i++)
            {
                var a = Mathf.PI * 2f * i / segments;
                vertices[i + 1] = new Vector3(Mathf.Cos(a) * 0.5f, Mathf.Sin(a) * 0.5f, 0f);
                triangles[i * 3] = 0;
                triangles[i * 3 + 1] = 1 + (i + 1) % segments;
                triangles[i * 3 + 2] = 1 + i;
            }
            return Build("VANDE PIP Disc", vertices, triangles);
        }

        private static Mesh Ring(int segments, float inner)
        {
            var vertices = new Vector3[segments * 2];
            var triangles = new int[segments * 6];
            for (var i = 0; i < segments; i++)
            {
                var a = Mathf.PI * 2f * i / segments;
                var d = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0f) * 0.5f;
                vertices[i * 2] = d;
                vertices[i * 2 + 1] = d * inner;
                var n = (i + 1) % segments;
                var o = i * 6;
                triangles[o] = i * 2;
                triangles[o + 1] = n * 2;
                triangles[o + 2] = i * 2 + 1;
                triangles[o + 3] = i * 2 + 1;
                triangles[o + 4] = n * 2;
                triangles[o + 5] = n * 2 + 1;
            }
            return Build("VANDE PIP Ring", vertices, triangles);
        }

        private static Mesh Quad()
        {
            return Build("VANDE PIP Quad",
                new[]
                {
                    new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 0f),
                    new Vector3(0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f)
                },
                new[] { 0, 2, 1, 0, 3, 2 });
        }

        private static Mesh Build(string name, Vector3[] vertices, int[] triangles)
        {
            var mesh = new Mesh { name = name, hideFlags = HideFlags.DontSave };
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void Destroy(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) UnityEngine.Object.Destroy(value);
            else UnityEngine.Object.DestroyImmediate(value);
        }
    }
}
