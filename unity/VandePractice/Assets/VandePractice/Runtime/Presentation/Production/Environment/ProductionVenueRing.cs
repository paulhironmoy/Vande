using System;
using UnityEngine;
using UnityEngine.Rendering;
using Vande.Practice.Presentation.Production.Props;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// The baked venue on the Unity stage (the add-on of the owner's sideload build; the web's src/render3d/three/venueBaked.ts): one 6-degree wedge, 60 rotations
    /// about +Y make the ring. Azimuth 0 is towards the striker's end (+z), azimuth 180 towards the bowler's, as the physics and the web's venueGeometry.ts have it, so the wedge
    /// (centred on +z in the FBX, 69 to 110 m out, 33 m high) needs no other placement. The three wedges at each end, behind the sight screens, are the gap wedge (level 2:
    /// back wall, parapet and roof, no tiers); wedges within 60 degrees of the bowler's end use level 0 (stepped rows) when the add-on has it; the rest level 1.
    /// The material is the stage's own surface shader, unlit, with the vertex colour (baked ambient occlusion times the surface colour) times the atlas. Pure presentation:
    /// nothing here reads or changes a ball, a bat, a fielder or a result.
    /// </summary>
    public static class ProductionVenueRing
    {
        /// <summary>The Resources name of the add-on asset (it exists only in an export that carries the venue).</summary>
        public const string ResourceName = "VandeVenueAddon";

        public const int Wedges = 60;
        public const float WedgeDegrees = 6f;

        /// <summary>The azimuth span around the bowler's end where wedges use level 0 (degrees).</summary>
        public const float Lod0SpanDegrees = 60f;

        /// <summary>Half the width of the gap behind each end for the sight screen: atan2(18 / 2 + 1.5, 62 + 6.5) in degrees (venueGeometry.ts SIGHT_SCREEN_GAP_HALF).</summary>
        public static readonly float SightScreenGapHalfDegrees = Mathf.Atan2(10.5f, 68.5f) * Mathf.Rad2Deg;

        /// <summary>Builder seam (tests and evidence): an add-on built in memory from the project's own files, used instead of the Resources one.</summary>
        internal static ProductionVenueAddon AddonOverride;

        /// <summary>The add-on this build carries, or null (a default export: none).</summary>
        public static ProductionVenueAddon Load()
        {
            var addon = AddonOverride != null ? AddonOverride : Resources.Load<ProductionVenueAddon>(ResourceName);
            return addon != null && addon.IsComplete ? addon : null;
        }

        /// <summary>Whether wedge `index` is one of the three at each end behind a sight screen (gapWedges in venueBaked.ts).</summary>
        public static bool IsGapWedge(int index)
        {
            var half = (int)Math.Ceiling(SightScreenGapHalfDegrees / WedgeDegrees - 0.5f);
            foreach (var centre in new[] { 0, Wedges / 2 })
                for (var d = -half; d <= half; d++)
                    if (((centre + d) % Wedges + Wedges) % Wedges == index) return true;
            return false;
        }

        /// <summary>The level of detail wedge `index` uses: 2 behind a sight screen, 0 within 60 degrees of the bowler's end, else 1.</summary>
        public static int LodOf(int index)
        {
            if (IsGapWedge(index)) return 2;
            var away = Mathf.Abs(Mathf.DeltaAngle(index * WedgeDegrees, 180f));
            return away <= Lod0SpanDegrees + 1e-3f ? 0 : 1;
        }

        /// <summary>
        /// Builds the ring under `parent` (a root named BakedVenue holding 60 wedges named Wedge-00 to Wedge-59). The meshes and the atlas are the add-on's own and are never owned
        /// (never destroyed with the stage); the material is, through `owner`.
        /// </summary>
        internal static Transform Build(Transform parent, ProductionVenueAddon addon, ProductionOwnedVisual owner)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (addon == null || !addon.IsComplete) throw new ArgumentException("The venue add-on is incomplete.", nameof(addon));
            var root = new GameObject("BakedVenue").transform;
            root.SetParent(parent, false);
            var material = ProductionVisualPrimitives.CreateMaterial("VANDE baked venue", Color.white);
            if (owner != null) owner.Own(material);
            if (material.HasProperty("_MainTex")) material.SetTexture("_MainTex", addon.Atlas);
            SetFloat(material, "_Unlit", 1f);
            SetFloat(material, "_UseVertexColor", 1f);
            SetFloat(material, "_Smoothness", 0f);
            SetFloat(material, "_Metallic", 0f);
            SetFloat(material, "_AmbientStrength", 1f);
            SetFloat(material, "_RimStrength", 0f);
            for (var index = 0; index < Wedges; index++)
            {
                var lod = LodOf(index);
                var mesh = lod == 0 ? (addon.Wedge0 != null ? addon.Wedge0 : addon.Wedge1) : lod == 1 ? addon.Wedge1 : addon.Wedge2;
                var wedge = new GameObject("Wedge-" + index.ToString("00"));
                wedge.transform.SetParent(root, false);
                wedge.transform.localRotation = Quaternion.AngleAxis(index * WedgeDegrees, Vector3.up);
                wedge.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = wedge.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                renderer.receiveShadows = false;
            }

            return root;
        }

        private static void SetFloat(Material material, string property, float value)
        {
            if (material != null && material.HasProperty(property)) material.SetFloat(property, value);
        }
    }
}
