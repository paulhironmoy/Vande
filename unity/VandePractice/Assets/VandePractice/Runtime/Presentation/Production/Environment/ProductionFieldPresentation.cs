using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation.Production.Props;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Environment
{
    public readonly struct ProductionFieldPoint
    {
        public ProductionFieldPoint(string id, string role, double x, double z, string action)
        {
            Id = id;
            Role = role;
            X = x;
            Z = z;
            Action = action;
        }

        public string Id { get; }
        public string Role { get; }
        public double X { get; }
        public double Z { get; }
        public string Action { get; }
    }

    /// <summary>
    /// Allocation-free live field snapshot for the compact field PIP. Scene
    /// positions and subsequent samples remain canonical (unmirrored); the view
    /// applies handedness exactly once when it projects the point.
    /// </summary>
    public sealed class ProductionFieldState
    {
        public const float RadarRadiusMetres = 75f;

        private readonly Dictionary<string, int> indexById =
            new Dictionary<string, int>(11, StringComparer.Ordinal);
        private ProductionFieldPoint[] points = Array.Empty<ProductionFieldPoint>();

        public int Count => points.Length;
        public int Version { get; private set; }

        public void Configure(PracticeFielderPresentation[] fielders)
        {
            if (fielders == null || fielders.Length != 11)
                throw new BridgeValidationException("A complete field is required for presentation.");

            var next = new ProductionFieldPoint[fielders.Length];
            indexById.Clear();
            for (var index = 0; index < fielders.Length; index++)
            {
                var source = fielders[index];
                if (source == null || string.IsNullOrEmpty(source.Id) ||
                    !Finite(source.X) || !Finite(source.Z))
                    throw new BridgeValidationException("Field presentation contains an invalid fielder.");
                if (!indexById.TryAdd(source.Id, index))
                    throw new BridgeValidationException("Field presentation contains a duplicate fielder id.");
                next[index] = new ProductionFieldPoint(
                    source.Id, source.Role, source.X, source.Z, "set");
            }

            points = next;
            Version++;
        }

        public ProductionFieldPoint Point(int index)
        {
            if (index < 0 || index >= points.Length) throw new ArgumentOutOfRangeException(nameof(index));
            return points[index];
        }

        public void ApplyAuthoritativeSample(string fielderId, FielderTraceSample sample)
        {
            if (sample == null) throw new ArgumentNullException(nameof(sample));
            if (!Finite(sample.x) || !Finite(sample.z) || string.IsNullOrEmpty(sample.action))
                throw new BridgeValidationException("The authoritative fielder sample is invalid.");
            if (!indexById.TryGetValue(fielderId, out var index))
                throw new BridgeValidationException("Authoritative trace references an unknown fielder.");

            var previous = points[index];
            points[index] = new ProductionFieldPoint(
                previous.Id, previous.Role, sample.x, sample.z, sample.action);
            Version++;
        }

        /// <summary>
        /// Returns a clamped 0..1 radar position. It performs no screen-layout
        /// work and therefore remains reusable by retained HUD and accessibility
        /// views without making this field model own either.
        /// </summary>
        public Vector2 NormalizedRadarPoint(int index, bool leftHanded)
        {
            var point = Point(index);
            var shownX = leftHanded ? -point.X : point.X;
            return new Vector2(
                Mathf.Clamp01(0.5f + (float)shownX / (RadarRadiusMetres * 2f)),
                // Bowler's end at the top, striker at the bottom (the rear batting view's orientation).
                Mathf.Clamp01(0.5f - (float)point.Z / (RadarRadiusMetres * 2f)));
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    /// <summary>
    /// One prebuilt ground marker that identifies the authoritative fielder
    /// consequence after contact. It never predicts interception and never
    /// selects a fielder; callers may show it only for an event already present
    /// in the canonical trace.
    /// </summary>
    public sealed class ProductionFieldConsequenceView
    {
        private const float VisibleSeconds = 0.66f;
        private readonly GameObject root;
        private readonly Renderer renderer;
        private readonly Material material;
        private readonly bool reducedMotion;
        private Transform trackedFielder;
        private Color colour;
        private float elapsed;

        internal ProductionFieldConsequenceView(
            GameObject root,
            Renderer renderer,
            Material material,
            bool reducedMotion)
        {
            this.root = root;
            this.renderer = renderer;
            this.material = material;
            this.reducedMotion = reducedMotion;
        }

        public bool Visible => root.activeSelf;
        public string EventKind { get; private set; }
        public Vector3 Position => root.transform.position;

        internal static ProductionFieldConsequenceView Create(
            Transform parent,
            ProductionOwnedVisual owner,
            bool reducedMotion)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (owner == null) throw new ArgumentNullException(nameof(owner));
            var material = owner.Own(ProductionVisualPrimitives.CreateTransparentMaterial(
                "VANDE authoritative fielder focus", new Color(0.95f, 0.76f, 0.28f, 0.7f)));
            var mesh = owner.Own(BuildGroundRing());
            var marker = ProductionVisualPrimitives.CreateMeshObject(
                "AuthoritativeFielderConsequence", parent, mesh, new[] { material }, false);
            marker.SetActive(false);
            return new ProductionFieldConsequenceView(
                marker, marker.GetComponent<Renderer>(), material, reducedMotion);
        }

        public bool ShowAuthoritativeEvent(
            string eventKind,
            Transform fielder,
            Vector3 eventPosition)
        {
            if (!Finite(eventPosition))
                throw new ArgumentOutOfRangeException(nameof(eventPosition));
            if (!Supported(eventKind) || fielder == null)
            {
                Hide();
                return false;
            }

            EventKind = eventKind;
            trackedFielder = fielder;
            elapsed = 0f;
            colour = ColourFor(eventKind);
            root.transform.position = Grounded(fielder.position, eventPosition);
            root.transform.localScale = Vector3.one;
            material.color = colour;
            renderer.enabled = true;
            root.SetActive(true);
            return true;
        }

        public void Tick(float deltaSeconds)
        {
            if (float.IsNaN(deltaSeconds) || float.IsInfinity(deltaSeconds) || deltaSeconds < 0f)
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
            if (!Visible) return;

            elapsed = Mathf.Min(VisibleSeconds, elapsed + deltaSeconds);
            if (trackedFielder != null)
            {
                var current = trackedFielder.position;
                root.transform.position = new Vector3(current.x, 0.014f, current.z);
            }

            var progress = elapsed / VisibleSeconds;
            var scale = reducedMotion ? 1f : Mathf.Lerp(0.78f, 1.18f, Mathf.Sin(progress * Mathf.PI));
            root.transform.localScale = new Vector3(scale, 1f, scale);
            var shown = colour;
            var fade = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.58f, 1f, progress));
            shown.a *= 1f - fade;
            material.color = shown;
            if (elapsed >= VisibleSeconds) Hide();
        }

        public void Hide()
        {
            EventKind = null;
            trackedFielder = null;
            elapsed = 0f;
            if (root != null) root.SetActive(false);
        }

        private static Mesh BuildGroundRing()
        {
            const int segments = 28;
            const float outer = 0.78f;
            const float inner = 0.63f;
            var builder = new ProductionMeshBuilder();
            for (var index = 0; index < segments; index++)
            {
                var next = (index + 1) % segments;
                var a0 = Mathf.PI * 2f * index / segments;
                var a1 = Mathf.PI * 2f * next / segments;
                var outer0 = new Vector3(Mathf.Sin(a0) * outer, 0f, Mathf.Cos(a0) * outer);
                var outer1 = new Vector3(Mathf.Sin(a1) * outer, 0f, Mathf.Cos(a1) * outer);
                var inner1 = new Vector3(Mathf.Sin(a1) * inner, 0f, Mathf.Cos(a1) * inner);
                var inner0 = new Vector3(Mathf.Sin(a0) * inner, 0f, Mathf.Cos(a0) * inner);
                builder.AddQuad(outer0, outer1, inner1, inner0, Vector3.up);
            }
            return builder.Build("VANDE authoritative field consequence ring");
        }

        private static Vector3 Grounded(Vector3 fielderPosition, Vector3 eventPosition)
        {
            var x = Finite(fielderPosition) ? fielderPosition.x : eventPosition.x;
            var z = Finite(fielderPosition) ? fielderPosition.z : eventPosition.z;
            return new Vector3(x, 0.014f, z);
        }

        private static bool Supported(string eventKind)
        {
            return string.Equals(eventKind, "field", StringComparison.Ordinal) ||
                   string.Equals(eventKind, "catch", StringComparison.Ordinal) ||
                   string.Equals(eventKind, "throw", StringComparison.Ordinal);
        }

        private static Color ColourFor(string eventKind)
        {
            if (eventKind == "catch") return new Color(0.84f, 0.25f, 0.22f, 0.78f);
            if (eventKind == "throw") return new Color(0.92f, 0.91f, 0.84f, 0.64f);
            return new Color(0.95f, 0.68f, 0.16f, 0.70f);
        }

        private static bool Finite(Vector3 value)
        {
            return !float.IsNaN(value.x) && !float.IsInfinity(value.x) &&
                   !float.IsNaN(value.y) && !float.IsInfinity(value.y) &&
                   !float.IsNaN(value.z) && !float.IsInfinity(value.z);
        }
    }
}
