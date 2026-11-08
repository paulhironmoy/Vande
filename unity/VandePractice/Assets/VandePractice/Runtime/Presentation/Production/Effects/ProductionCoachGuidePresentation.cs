using System;
using UnityEngine;
using UnityEngine.Rendering;
using Vande.Practice.Bridge;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Effects
{
    /// <summary>
    /// One lightweight, world-space contact guide for an exact-ball Coach attempt.
    /// Its point and time are supplied by the TypeScript-owned StageGuide. It never
    /// predicts contact, changes input tolerance, or participates in resolution.
    /// </summary>
    public sealed class ProductionCoachGuidePresentation : IDisposable
    {
        private const double CueLeadSeconds = 0.065;
        private const double CueTailSeconds = 0.085;
        private const float ContactRadius = 0.115f;
        private const float ContactWidth = 0.007f;

        private readonly GameObject root;
        private readonly LineRenderer ring;
        private readonly Material material;
        private bool reducedMotion;
        private bool prepared;
        private bool released;
        private bool contactReached;
        private bool disposed;
        private int stage;
        private double contactT;

        private ProductionCoachGuidePresentation(
            GameObject root,
            LineRenderer ring,
            Material material,
            bool reducedMotion)
        {
            this.root = root;
            this.ring = ring;
            this.material = material;
            this.reducedMotion = reducedMotion;
        }

        public bool IsVisible => ring.gameObject.activeSelf;
        public bool IsPrepared => prepared;
        public int Stage => stage;
        public double ContactT => contactT;
        public Vector3 ContactPosition => root.transform.position;

        public static ProductionCoachGuidePresentation Create(
            Transform parent,
            PracticePresentationQuality quality,
            bool reducedMotion)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var root = new GameObject("AuthoritativeCoachContactGuide");
            root.transform.SetParent(parent, false);
            var material = CreateMaterial();
            var ring = root.AddComponent<LineRenderer>();
            ring.useWorldSpace = false;
            ring.loop = true;
            ring.material = material;
            ring.startWidth = ring.endWidth = ContactWidth;
            ring.textureMode = LineTextureMode.Stretch;
            ring.alignment = LineAlignment.TransformZ;
            ring.shadowCastingMode = ShadowCastingMode.Off;
            ring.receiveShadows = false;
            ring.lightProbeUsage = LightProbeUsage.Off;
            ring.reflectionProbeUsage = ReflectionProbeUsage.Off;
            ring.startColor = ring.endColor = new Color(0.92f, 0.77f, 0.36f, 0.42f);
            var value = new ProductionCoachGuidePresentation(root, ring, material, reducedMotion);
            value.ApplyProfile(quality, reducedMotion);
            value.Reset();
            return value;
        }

        public void ApplyProfile(PracticePresentationQuality quality, bool useReducedMotion)
        {
            RequireAlive();
            reducedMotion = useReducedMotion;
            var segments = quality == PracticePresentationQuality.Lite
                ? 12
                : quality == PracticePresentationQuality.Standard ? 16 : 20;
            ring.positionCount = segments;
            for (var index = 0; index < segments; index++)
            {
                var radians = Mathf.PI * 2f * index / segments;
                ring.SetPosition(index, new Vector3(
                    Mathf.Cos(radians) * ContactRadius,
                    Mathf.Sin(radians) * ContactRadius,
                    0f));
            }
        }

        public void Begin(PracticeCoachGuidePresentation guide, float lateralMirror)
        {
            RequireAlive();
            Reset();
            if (guide == null || guide.Stage == 4) return;
            if (guide.Stage < 1 || guide.Stage > 4)
                throw new BridgeValidationException("Coach assistance stage is unsupported.");
            if (!guide.ContactT.HasValue || guide.ContactPoint == null) return;
            if (!IsFinite(guide.ContactT.Value) || guide.ContactT.Value < 0.0 ||
                !IsFinite(guide.ContactPoint) || !IsFinite(lateralMirror) || Mathf.Abs(lateralMirror) < 0.5f)
                throw new BridgeValidationException("Coach contact guide is outside the presentation domain.");

            stage = guide.Stage;
            contactT = guide.ContactT.Value;
            root.transform.position = new Vector3(
                lateralMirror < 0f ? -(float)guide.ContactPoint.x : (float)guide.ContactPoint.x,
                (float)guide.ContactPoint.y,
                (float)guide.ContactPoint.z);
            prepared = true;
        }

        public void MarkReleased()
        {
            RequireAlive();
            released = true;
        }

        public void SetSimulationTime(double simulationTime, Quaternion cameraRotation)
        {
            RequireAlive();
            if (!IsFinite(simulationTime) || simulationTime < 0.0)
                throw new ArgumentOutOfRangeException(nameof(simulationTime));
            root.transform.rotation = cameraRotation;
            var visible = false;
            if (prepared && released && !contactReached)
            {
                visible = stage <= 2 ||
                          (stage == 3 && simulationTime >= contactT - CueLeadSeconds &&
                           simulationTime <= contactT + CueTailSeconds);
            }
            ring.gameObject.SetActive(visible);
            if (!visible) return;

            var alpha = 0.42f;
            if (!reducedMotion && stage == 3)
            {
                var distance = Math.Abs(simulationTime - contactT);
                alpha = Mathf.Lerp(0.24f, 0.62f,
                    1f - Mathf.Clamp01((float)(distance / CueTailSeconds)));
            }
            ring.startColor = ring.endColor = new Color(0.92f, 0.77f, 0.36f, alpha);
        }

        public void MarkContact()
        {
            RequireAlive();
            contactReached = true;
            ring.gameObject.SetActive(false);
        }

        public void Reset()
        {
            RequireAlive();
            prepared = false;
            released = false;
            contactReached = false;
            stage = 0;
            contactT = 0.0;
            ring.gameObject.SetActive(false);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            DestroyObject(root);
            DestroyObject(material);
        }

        private static Material CreateMaterial()
        {
            var shader = Resources.Load<Shader>("VandeProductionDeliveryEffects") ??
                         Shader.Find("Vande/Practice/DeliveryEffects") ??
                         Shader.Find("Sprites/Default") ??
                         Shader.Find("Unlit/Transparent") ??
                         Shader.Find("Unlit/Color") ??
                         Shader.Find("Standard");
            if (shader == null)
                throw new InvalidOperationException("A built-in presentation shader is required.");
            return new Material(shader)
            {
                name = "VANDE Authoritative Coach Contact Guide",
                hideFlags = HideFlags.DontSave
            };
        }

        private static bool IsFinite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static bool IsFinite(TraceVector3 value)
        {
            return value != null && IsFinite(value.x) && IsFinite(value.y) && IsFinite(value.z);
        }

        private void RequireAlive()
        {
            if (disposed) throw new ObjectDisposedException(nameof(ProductionCoachGuidePresentation));
        }

        private static void DestroyObject(UnityEngine.Object value)
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
