using System;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UIElements;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// UI Toolkit reads for the HUD tests that were written against retained TextMesh objects (wedge phase 3 port).
    /// Rectangles are in the HUD's pixel space (origin bottom-left, y up), the space of ProductionHudLayoutSnapshot:
    /// each label host is placed there with inline left/bottom/width/height. A label's text rectangle is its measured
    /// shaped text, at its own font and size, placed by its own alignment inside that host, so a label whose copy
    /// does not fit shows up as a rectangle outside its rail, exactly as a TextMesh renderer's bounds did.
    /// </summary>
    internal static class HudLabelProbe
    {
        public static ProductionHudAdvancedTextLayer Layer(GameObject owner)
        {
            foreach (var candidate in owner.GetComponentsInChildren<ProductionHudAdvancedTextLayer>(true))
                if (candidate.RootForTesting.Q<Label>("Score Text") != null) return candidate;
            Assert.Fail("The production HUD's UI Toolkit text layer was not created.");
            return null;
        }

        public static Label Label(GameObject owner, string name)
        {
            var label = Layer(owner).RootForTesting.Q<Label>(name);
            Assert.That(label, Is.Not.Null, "Missing HUD label: " + name);
            return label;
        }

        public static VisualElement Host(Label label)
        {
            for (var current = label.parent; current != null; current = current.parent)
                if (current is ScrollView) return current;
            return label;
        }

        public static bool IsScrollable(Label label) => Host(label) != label;

        /// <summary>What the HUD shows: the host's own display, set inline by SetVisible.</summary>
        public static bool Visible(Label label)
        {
            var display = Host(label).style.display;
            return display.keyword != StyleKeyword.Undefined || display.value != DisplayStyle.None;
        }

        public static Rect HostRect(Label label)
        {
            var host = Host(label);
            Assert.That(host.style.left.value.unit, Is.EqualTo(LengthUnit.Pixel), label.name + " left");
            Assert.That(host.style.bottom.value.unit, Is.EqualTo(LengthUnit.Pixel), label.name + " bottom");
            Assert.That(host.style.width.value.unit, Is.EqualTo(LengthUnit.Pixel), label.name + " width");
            Assert.That(host.style.height.value.unit, Is.EqualTo(LengthUnit.Pixel), label.name + " height");
            return new Rect(
                host.style.left.value.value,
                host.style.bottom.value.value,
                host.style.width.value.value,
                host.style.height.value.value);
        }

        public static float FontSize(Label label)
        {
            var size = label.style.fontSize;
            Assert.That(size.value.unit, Is.EqualTo(LengthUnit.Pixel), label.name + " font size");
            return size.value.value;
        }

        /// <summary>The shaped text measured at the host's width, the way the label wraps it.</summary>
        public static Vector2 TextSize(Label label)
        {
            var host = HostRect(label);
            // Compact rail copy does not wrap (white-space: nowrap); other copy wraps at its host's width.
            var noWrap = label.style.whiteSpace.keyword == StyleKeyword.Undefined &&
                         label.style.whiteSpace.value == WhiteSpace.NoWrap;
            var measured = label.MeasureTextSize(
                label.text ?? string.Empty,
                noWrap ? 0f : host.width,
                noWrap ? VisualElement.MeasureMode.Undefined : VisualElement.MeasureMode.AtMost,
                0f,
                VisualElement.MeasureMode.Undefined,
                FontSize(label));
            return new Vector2(measured.x, measured.y);
        }

        /// <summary>
        /// The text's rectangle on screen. Compact labels are placed by their alignment and may overflow their host;
        /// scrollable copy is clipped to its host (the overflow scrolls inside it).
        /// </summary>
        public static Rect TextRect(Label label)
        {
            var host = HostRect(label);
            var size = TextSize(label);
            var width = size.x;
            var height = size.y;
            if (IsScrollable(label)) height = Mathf.Min(height, host.height);
            var anchor = label.style.unityTextAlign.value;
            float x;
            switch (anchor)
            {
                case TextAnchor.UpperCenter:
                case TextAnchor.MiddleCenter:
                case TextAnchor.LowerCenter:
                    x = host.center.x - width * 0.5f;
                    break;
                case TextAnchor.UpperRight:
                case TextAnchor.MiddleRight:
                case TextAnchor.LowerRight:
                    x = host.xMax - width;
                    break;
                default:
                    x = host.xMin;
                    break;
            }
            float y;
            switch (anchor)
            {
                case TextAnchor.UpperLeft:
                case TextAnchor.UpperCenter:
                case TextAnchor.UpperRight:
                    y = host.yMax - height;
                    break;
                case TextAnchor.LowerLeft:
                case TextAnchor.LowerCenter:
                case TextAnchor.LowerRight:
                    y = host.yMin;
                    break;
                default:
                    y = host.center.y - height * 0.5f;
                    break;
            }
            return new Rect(x, y, width, height);
        }

        public static float Area(Rect value) => Mathf.Max(0f, value.width) * Mathf.Max(0f, value.height);

        /// <summary>
        /// Renders the HUD's UI Toolkit panel into a texture through Unity's runtime panel path (offscreen target),
        /// the same draw the player makes, and returns the pixels with row 0 at the bottom like the HUD's pixel space.
        /// </summary>
        public static Texture2D RenderPanel(GameObject owner, int width, int height)
        {
            var layer = Layer(owner);
            var settings = layer.PanelSettingsForTesting;
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            target.Create();
            var priorTarget = settings.targetTexture;
            var priorClear = settings.clearColor;
            var priorActive = RenderTexture.active;
            var pixels = new Texture2D(width, height, TextureFormat.RGBA32, false, true);
            try
            {
                settings.targetTexture = target;
                settings.clearColor = true;
                settings.colorClearValue = Color.clear;
                var utility = typeof(VisualElement).Assembly.GetType("UnityEngine.UIElements.UIElementsRuntimeUtility");
                Assert.That(utility, Is.Not.Null, "UIElementsRuntimeUtility");
                Invoke(utility, "UpdatePanels");
                // Repaint (updates the panel's render data), then render offscreen panels into their target: the order that
                // draws in EditMode (RenderOffscreenPanels alone draws nothing before a repaint).
                foreach (var attempt in new[] { "RepaintPanels:True", "RepaintPanels:False", "RenderOffscreenPanels" })
                {
                    var parts = attempt.Split(':');
                    var invoked = parts.Length == 2
                        ? Invoke(utility, parts[0], bool.Parse(parts[1]))
                        : Invoke(utility, parts[0]);
                    RenderTexture.active = target;
                    pixels.ReadPixels(new Rect(0f, 0f, width, height), 0, 0, false);
                    pixels.Apply(false, false);
                    var drawn = 0;
                    foreach (var pixel in pixels.GetPixels32()) if (pixel.a > 0) drawn++;
                    TestContext.WriteLine(attempt + " invoked=" + invoked + " drawn pixels=" + drawn);
                    if (drawn > 0) return pixels;
                }
                return pixels;
            }
            finally
            {
                RenderTexture.active = priorActive;
                settings.targetTexture = priorTarget;
                settings.clearColor = priorClear;
                target.Release();
                UnityEngine.Object.DestroyImmediate(target);
            }
        }

        public static int BrightPixelCount(Texture2D texture, Rect bounds, float threshold)
        {
            var xMin = Mathf.Clamp(Mathf.FloorToInt(bounds.xMin), 0, texture.width);
            var xMax = Mathf.Clamp(Mathf.CeilToInt(bounds.xMax), 0, texture.width);
            var yMin = Mathf.Clamp(Mathf.FloorToInt(bounds.yMin), 0, texture.height);
            var yMax = Mathf.Clamp(Mathf.CeilToInt(bounds.yMax), 0, texture.height);
            var count = 0;
            for (var y = yMin; y < yMax; y++)
                for (var x = xMin; x < xMax; x++)
                {
                    var pixel = texture.GetPixel(x, y);
                    if (pixel.a > 0.5f && pixel.grayscale >= threshold) count++;
                }
            return count;
        }

        private static bool Invoke(Type type, string name, params object[] arguments)
        {
            var method = type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .FirstOrDefault(candidate => candidate.Name == name &&
                                             candidate.GetParameters().Length == arguments.Length);
            if (method == null) return false;
            method.Invoke(null, arguments);
            return true;
        }
    }
}
