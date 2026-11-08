using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEngine;
using Vande.Practice.Presentation.Production.Environment;

namespace Vande.Practice.Editor
{
    /// <summary>
    /// The baked venue as a sideload add-on of the Android export (the owner's preview build; never a release). The venue's FBX and PNG sit in the project
    /// (Runtime/Presentation/Production/Venue) outside any Resources folder, so a player build holds none of their bytes. An export that is asked to carry the venue
    /// (the environment variable VANDE_UNITY_VENUE=1, read by VandeAndroidLibraryExporter) creates one ProductionVenueAddon asset in Resources that points at them, exports, and deletes
    /// the asset again; the receipt of what was carried is written beside the export. Without the variable nothing here runs.
    /// </summary>
    public static class VandeVenueAddonTool
    {
        public const string VenueFolder = "Assets/VandePractice/Runtime/Presentation/Production/Venue";
        public const string AddonAssetPath = "Assets/VandePractice/Runtime/Presentation/Resources/VandeVenueAddon.asset";
        public const string EnvironmentVariable = "VANDE_UNITY_VENUE";
        public const string ReceiptFile = ".vande-venue-addon.properties";

        private static readonly string[] Files = { "wedge-lod0.fbx", "wedge-lod1.fbx", "wedge-lod2.fbx", "venue-atlas.png" };

        /// <summary>Whether this run was asked to carry the venue.</summary>
        public static bool Requested => string.Equals(Environment.GetEnvironmentVariable(EnvironmentVariable), "1", StringComparison.Ordinal);

        /// <summary>An add-on built in memory from the venue files (not saved). Fields stay null for a file that is missing or not yet imported.</summary>
        public static ProductionVenueAddon BuildInMemory()
        {
            var addon = ScriptableObject.CreateInstance<ProductionVenueAddon>();
            addon.hideFlags = HideFlags.DontSave;
            addon.Wedge0 = MeshOf(VenueFolder + "/wedge-lod0.fbx");
            addon.Wedge1 = MeshOf(VenueFolder + "/wedge-lod1.fbx");
            addon.Wedge2 = MeshOf(VenueFolder + "/wedge-lod2.fbx");
            addon.Atlas = AssetDatabase.LoadAssetAtPath<Texture2D>(VenueFolder + "/venue-atlas.png");
            return addon;
        }

        private static Mesh MeshOf(string path) =>
            AssetDatabase.LoadAllAssetsAtPath(path).OfType<Mesh>().FirstOrDefault();

        /// <summary>Creates the add-on asset in Resources (the export is about to carry the venue).</summary>
        public static void CreateAsset()
        {
            var addon = BuildInMemory();
            if (!addon.IsComplete)
                throw new InvalidOperationException("The venue files are missing or not imported (" + VenueFolder + "): " + string.Join(", ", Files));
            addon.hideFlags = HideFlags.None;
            if (AssetDatabase.LoadAssetAtPath<ProductionVenueAddon>(AddonAssetPath) != null) AssetDatabase.DeleteAsset(AddonAssetPath);
            AssetDatabase.CreateAsset(addon, AddonAssetPath);
            AssetDatabase.SaveAssets();
        }

        /// <summary>Deletes the add-on asset (and its .meta): the project is as it was.</summary>
        public static void RemoveAsset()
        {
            if (AssetDatabase.LoadAssetAtPath<ProductionVenueAddon>(AddonAssetPath) != null || File.Exists(AddonAssetPath))
                AssetDatabase.DeleteAsset(AddonAssetPath);
        }

        /// <summary>The receipt of the add-on an export carried: each file's bytes and SHA-256 (java properties, sorted).</summary>
        public static string Receipt()
        {
            var project = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            var text = new StringBuilder();
            text.Append("schema=vande-venue-addon-1\n");
            text.Append("sideload=true\n");
            long total = 0;
            foreach (var name in Files.OrderBy(file => file, StringComparer.Ordinal))
            {
                var path = Path.Combine(project, VenueFolder, name);
                var bytes = File.ReadAllBytes(path);
                total += bytes.Length;
                text.Append("file.").Append(name).Append(".bytes=").Append(bytes.Length).Append('\n');
                using (var sha = SHA256.Create())
                    text.Append("file.").Append(name).Append(".sha256=")
                        .Append(string.Concat(sha.ComputeHash(bytes).Select(b => b.ToString("x2")))).Append('\n');
            }

            text.Append("sourceBytes=").Append(total).Append('\n');
            return text.ToString();
        }
    }
}
