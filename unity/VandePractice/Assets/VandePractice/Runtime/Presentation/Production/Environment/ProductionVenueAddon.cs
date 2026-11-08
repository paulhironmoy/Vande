using UnityEngine;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// The baked venue's meshes and crowd atlas (ASSETS-VENUE: one 6-degree stadium wedge in three levels of detail and a 512x256 palette atlas, an
    /// FBX and a PNG under Runtime/Presentation/Production/Venue). It is a SIDELOAD ADD-ON, never part of the first-ball install
    /// (docs/ANDROID_SIZE_AND_REACH.md, docs/ANDROID_RELEASE.md): this asset does not exist in the project. The Android export creates it only when it is asked
    /// to carry the venue (VANDE_UNITY_VENUE=1, VandeAndroidLibraryExporter) and deletes it afterwards, so a default export holds none of the venue's
    /// bytes and the world builds without it (ProductionVenueRing.Load returns null).
    /// </summary>
    public sealed class ProductionVenueAddon : ScriptableObject
    {
        /// <summary>The stepped-rows wedge (372 triangles): used within 60 degrees of the bowler's end. May be null (the next level stands in).</summary>
        public Mesh Wedge0;

        /// <summary>The sloped-tiers wedge (24 triangles): the rest of the ring.</summary>
        public Mesh Wedge1;

        /// <summary>The wedge behind a sight screen (16 triangles: the back wall, the parapet and the roof, no tiers).</summary>
        public Mesh Wedge2;

        /// <summary>The crowd atlas (two rows of four variants; variant 0 is used).</summary>
        public Texture2D Atlas;

        public bool IsComplete => Wedge1 != null && Wedge2 != null && Atlas != null;
    }
}
