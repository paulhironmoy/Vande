using System;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Vande.Practice.Editor
{
    /// <summary>
    /// Enables Unity 6 Advanced Text and validates the repository-pinned OFL
    /// font imports. Runtime dynamic TextCore assets are intentionally created
    /// from these exact Font resources so no generated atlas asset or
    /// operating-system font is shipped.
    /// </summary>
    public static class VandeProductionTypographyAssetGenerator
    {
        private const string FontsDirectory =
            "Assets/VandePractice/Runtime/UI/Production/Resources/Fonts";
        private const string LatinSource = FontsDirectory + "/ManropeLatin-Regular.ttf";
        private const string DevanagariSource =
            FontsDirectory + "/NotoSansDevanagari-Regular.ttf";
        [MenuItem("VANDE/Stage 1/Configure production typography")]
        public static void Generate()
        {
            EnableAdvancedTextProjectSetting();
            AssetDatabase.ImportAsset(LatinSource, ImportAssetOptions.ForceSynchronousImport);
            AssetDatabase.ImportAsset(
                DevanagariSource,
                ImportAssetOptions.ForceSynchronousImport);

            RequireSourceFont(LatinSource);
            RequireSourceFont(DevanagariSource);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            Debug.Log(
                "Configured VANDE Advanced Text: runtime-dynamic Manrope primary, " +
                "runtime-dynamic Noto Sans Devanagari fallback.");
        }

        private static Font RequireSourceFont(string path)
        {
            var result = AssetDatabase.LoadAssetAtPath<Font>(path);
            if (result == null)
                throw new InvalidOperationException("Unable to import source font: " + path);
            return result;
        }

        private static void EnableAdvancedTextProjectSetting()
        {
            const string qualifiedName =
                "UnityEditor.UIElements.UIToolkitProjectSettings, UnityEditor.UIElementsModule";
            var settingsType = Type.GetType(qualifiedName, false);
            var property = settingsType?.GetProperty(
                "enableAdvancedText",
                BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic);
            if (property == null || property.PropertyType != typeof(bool))
            {
                throw new InvalidOperationException(
                    "Unity 6 Advanced Text project setting could not be resolved.");
            }

            property.SetValue(null, true);
            if (!(bool)property.GetValue(null))
                throw new InvalidOperationException("Unity Advanced Text did not remain enabled.");
        }
    }
}
