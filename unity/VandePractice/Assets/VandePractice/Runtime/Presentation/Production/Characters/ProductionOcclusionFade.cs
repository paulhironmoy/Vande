using System;
using System.Collections.Generic;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Keeps a foreground character (the wicketkeeper standing up to spin) visible from the rear batting camera without
    /// hiding the striker: only the keeper fragments that fall inside the striker's screen ellipse, and only while the
    /// keeper is nearer the camera than the striker, are screen-door faded (VandeProductionCharacter.shader). The fade is
    /// capped at <see cref="MaximumFade"/> so the keeper is never removed, eases in and out instead of popping, and is
    /// applied only while the rear camera renders (the PIP and any other camera always see the complete keeper).
    /// Presentation only: no position, pose or physics value changes.
    /// </summary>
    public sealed class ProductionOcclusionFade : IDisposable
    {
        public const float MaximumFade = 0.62f;
        /// <summary>A keeper running past the lens (towards the stumps for a return) fades as a whole inside this depth.</summary>
        public const float NearFadeDepthMetres = 2.0f;
        public const float NearFadeFullDepthMetres = 0.8f;
        public const float MaximumNearFade = 0.85f;
        private const float EaseSeconds = 0.18f;
        private const float EllipseMargin = 1.18f;
        private static readonly int EllipseId = Shader.PropertyToID("_VandeOcclusionEllipse");
        private static readonly int FadeId = Shader.PropertyToID("_VandeOcclusionFade");

        private readonly Camera camera;
        private readonly Func<ProductionCharacterRig> occluder;
        private readonly Func<ProductionCharacterRig> protectedRig;
        private readonly Func<Bounds?> protectedExtra;
        private readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        private readonly List<Renderer> renderers = new List<Renderer>();
        private Vector4 ellipse;
        private Vector4 appliedEllipse = new Vector4(float.NaN, 0f, 0f, 0f);
        private float appliedFade = float.NaN;
        private float fade;
        private float target;
        private bool disposed;

        public ProductionOcclusionFade(Camera camera, Func<ProductionCharacterRig> occluder,
            Func<ProductionCharacterRig> protectedRig, Func<Bounds?> protectedExtra = null)
        {
            this.protectedExtra = protectedExtra;
            this.camera = camera ? camera : throw new ArgumentNullException(nameof(camera));
            this.occluder = occluder ?? throw new ArgumentNullException(nameof(occluder));
            this.protectedRig = protectedRig ?? throw new ArgumentNullException(nameof(protectedRig));
            Camera.onPreRender += OnPreRender;
        }

        /// <summary>Current screen-door fade (0..MaximumFade) inside the protected ellipse.</summary>
        public float Fade => fade;
        public Vector4 Ellipse => ellipse;
        public bool Overlapping => target > 0f;

        /// <summary>Measures the overlap in the rear camera and eases the fade (call once per presented frame).</summary>
        public void Update(float deltaSeconds)
        {
            if (disposed) return;
            if (camera == null)
            {
                // The world was destroyed without OnDestroy (EditMode): never outlive it on the static callback.
                Dispose();
                return;
            }
            var keeper = occluder();
            var striker = protectedRig();
            target = 0f;
            if (keeper != null && striker != null && keeper.Root != null && striker.Root != null &&
                keeper.Root.gameObject.activeInHierarchy)
            {
                Rect keeperRect, strikerRect;
                float keeperDepth, strikerDepth;
                if (ViewportRect(keeper.Root, out keeperRect, out keeperDepth) &&
                    ViewportRect(striker.Root, out strikerRect, out strikerDepth))
                {
                    var extra = protectedExtra?.Invoke();
                    Rect extraRect;
                    if (extra.HasValue && BoundsViewportRect(extra.Value, out extraRect))
                        strikerRect = Rect.MinMaxRect(
                            Mathf.Min(strikerRect.xMin, extraRect.xMin), Mathf.Min(strikerRect.yMin, extraRect.yMin),
                            Mathf.Max(strikerRect.xMax, extraRect.xMax), Mathf.Max(strikerRect.yMax, extraRect.yMax));
                    var protectedRect = Expand(strikerRect, EllipseMargin);
                    ellipse = new Vector4(protectedRect.center.x, protectedRect.center.y,
                        protectedRect.width * 0.5f, protectedRect.height * 0.5f);
                    if (keeperDepth < strikerDepth && keeperRect.Overlaps(protectedRect)) target = MaximumFade;
                    // A transient pass close to the lens (not a set, standing-up keeper at ~2.6 m) fades the whole body,
                    // softly and never completely, so the frame is not filled by one body for a few hundred ms.
                    var near = Mathf.Clamp01((NearFadeDepthMetres - keeperDepth) /
                                             (NearFadeDepthMetres - NearFadeFullDepthMetres)) * MaximumNearFade;
                    if (near > 0f && near >= target)
                    {
                        target = near;
                        ellipse = new Vector4(0.5f, 0.5f, 8f, 8f);
                    }
                }
            }
            var step = EaseSeconds <= 0f ? 1f : Mathf.Clamp01(deltaSeconds / EaseSeconds) * MaximumNearFade;
            fade = Mathf.MoveTowards(fade, target, step);
            // Applied on change. Other cameras (the PIP) draw markers, not the characters, so a rear-camera fade
            // on these renderers is never seen from another viewpoint.
            if (!Mathf.Approximately(fade, appliedFade) || (fade > 0f && ellipse != appliedEllipse)) Apply(fade);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            Camera.onPreRender -= OnPreRender;
            if (camera != null) Apply(0f);
        }

        private void OnPreRender(Camera rendering)
        {
            if (disposed) return;
            if (camera == null) Dispose();
        }

        private void Apply(float value)
        {
            ProductionCharacterRig keeper;
            try
            {
                keeper = occluder();
                if (keeper == null || keeper.Root == null || keeper.Root.gameObject == null) return;
            }
            catch (MissingReferenceException)
            {
                return;
            }
            keeper.Root.GetComponentsInChildren(true, renderers);
            foreach (var renderer in renderers)
            {
                if (renderer == null) continue;
                renderer.GetPropertyBlock(block);
                block.SetVector(EllipseId, ellipse);
                block.SetFloat(FadeId, value);
                renderer.SetPropertyBlock(block);
            }
            appliedFade = value;
            appliedEllipse = ellipse;
        }

        private bool ViewportRect(Transform root, out Rect rect, out float depth)
        {
            rect = default(Rect);
            depth = Vector3.Dot(root.position - camera.transform.position, camera.transform.forward);
            root.GetComponentsInChildren(false, renderers);
            var min = new Vector2(float.MaxValue, float.MaxValue);
            var max = new Vector2(float.MinValue, float.MinValue);
            var any = false;
            foreach (var renderer in renderers)
            {
                if (renderer == null || !renderer.enabled) continue;
                var b = renderer.bounds;
                for (var corner = 0; corner < 8; corner++)
                {
                    var p = new Vector3(
                        (corner & 1) == 0 ? b.min.x : b.max.x,
                        (corner & 2) == 0 ? b.min.y : b.max.y,
                        (corner & 4) == 0 ? b.min.z : b.max.z);
                    var v = camera.WorldToViewportPoint(p);
                    if (v.z <= 0f) continue;
                    any = true;
                    min = Vector2.Min(min, new Vector2(v.x, v.y));
                    max = Vector2.Max(max, new Vector2(v.x, v.y));
                }
            }
            if (!any) return false;
            rect = Rect.MinMaxRect(min.x, min.y, max.x, max.y);
            return rect.xMax > 0f && rect.xMin < 1f && rect.yMax > 0f && rect.yMin < 1f;
        }

        private bool BoundsViewportRect(Bounds b, out Rect rect)
        {
            rect = default(Rect);
            var min = new Vector2(float.MaxValue, float.MaxValue);
            var max = new Vector2(float.MinValue, float.MinValue);
            var any = false;
            for (var corner = 0; corner < 8; corner++)
            {
                var v = camera.WorldToViewportPoint(new Vector3(
                    (corner & 1) == 0 ? b.min.x : b.max.x,
                    (corner & 2) == 0 ? b.min.y : b.max.y,
                    (corner & 4) == 0 ? b.min.z : b.max.z));
                if (v.z <= 0f) continue;
                any = true;
                min = Vector2.Min(min, new Vector2(v.x, v.y));
                max = Vector2.Max(max, new Vector2(v.x, v.y));
            }
            if (any) rect = Rect.MinMaxRect(min.x, min.y, max.x, max.y);
            return any;
        }

        private static Rect Expand(Rect rect, float factor)
        {
            var size = rect.size * factor;
            return new Rect(rect.center - size * 0.5f, size);
        }
    }
}
