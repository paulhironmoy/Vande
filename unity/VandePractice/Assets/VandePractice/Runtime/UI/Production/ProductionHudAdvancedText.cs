using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.TextCore.Text;
using UnityEngine.UIElements;

namespace Vande.Practice.UI.Production
{
    /// <summary>
    /// Owns the single screen-space UI Toolkit document used by the Stage-1
    /// HUD. Text remains presentation-only: score, outcome and action
    /// authority continue to live outside this layer.
    /// </summary>
    internal sealed class ProductionHudAdvancedTextLayer : MonoBehaviour
    {
        internal const string LatinFontResource = "Fonts/ManropeLatin-Regular";
        internal const string DevanagariFontResource =
            "Fonts/NotoSansDevanagari-Regular";
        // The editor silently assigns its own default runtime theme to every PanelSettings it creates
        // (PanelSettings.GetOrCreateDefaultTheme, editor-only), so EditMode never shows the problem. A
        // player has no such hook: without an explicit, shipped theme it logs "No Theme Style Sheet set
        // to PanelSettings ..., UI will not render properly". This Resources theme imports exactly the
        // same Unity default runtime theme, so the player now renders what the editor tests measure.
        internal const string ThemeResource = "VandeProductionHudTheme";

        private readonly List<ProductionHudAdvancedLabel> labels =
            new List<ProductionHudAdvancedLabel>();

        private GameObject documentObject;
        private UIDocument document;
        private VisualElement canvas;
        private FontAsset latinFont;
        private FontAsset devanagariFont;
        private PanelTextSettings textSettings;
        private PanelSettings panelSettings;
        private ThemeStyleSheet theme;

        public static ProductionHudAdvancedTextLayer For(Transform parent)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            var layer = parent.GetComponent<ProductionHudAdvancedTextLayer>();
            if (layer == null) layer = parent.gameObject.AddComponent<ProductionHudAdvancedTextLayer>();
            layer.EnsureReady();
            return layer;
        }

        internal bool IsReady
        {
            get
            {
                EnsureReady();
                return canvas != null && latinFont != null && devanagariFont != null;
            }
        }

        internal VisualElement RootForTesting
        {
            get
            {
                EnsureReady();
                return canvas;
            }
        }

        internal PanelSettings PanelSettingsForTesting
        {
            get
            {
                EnsureReady();
                return panelSettings;
            }
        }

        internal FontAsset LatinFontForTesting
        {
            get
            {
                EnsureReady();
                return latinFont;
            }
        }

        internal FontAsset DevanagariFontForTesting
        {
            get
            {
                EnsureReady();
                return devanagariFont;
            }
        }

        internal ProductionHudAdvancedLabel CreateLabel(
            string name,
            TextAnchor anchor,
            TextAlignment alignment)
        {
            EnsureReady();
            var result = new ProductionHudAdvancedLabel(
                canvas,
                latinFont,
                name,
                anchor,
                alignment,
                IsScrollableCopy(name));
            labels.Add(result);
            return result;
        }

        private static bool IsScrollableCopy(string name)
        {
            // The caption wraps to more lines and grows its rail at the requested size (lead ruling, wedge phase 3);
            // where even the grown rail is too short, it scrolls rather than shrinking.
            return string.Equals(name, "Caption Text", StringComparison.Ordinal) ||
                   string.Equals(name, "Dead Ball Reason Text", StringComparison.Ordinal) ||
                   string.Equals(name, "Dead Ball Recommendation Text", StringComparison.Ordinal) ||
                   string.Equals(name, "Setup Brief Text", StringComparison.Ordinal);
        }

        private void EnsureReady()
        {
            if (canvas != null) return;

            var latinSource = Resources.Load<Font>(LatinFontResource);
            var devanagariSource = Resources.Load<Font>(DevanagariFontResource);
            if (latinSource == null || devanagariSource == null)
            {
                throw new InvalidOperationException(
                    "The repository-pinned VANDE OFL source fonts are missing from Resources.");
            }
            theme = Resources.Load<ThemeStyleSheet>(ThemeResource);
            if (theme == null)
            {
                throw new InvalidOperationException(
                    "The shipped VANDE HUD theme style sheet is missing from Resources.");
            }

            latinFont = CreateDynamicFontAsset(latinSource, "VANDE Manrope Latin Dynamic");
            devanagariFont = CreateDynamicFontAsset(
                devanagariSource,
                "VANDE Noto Sans Devanagari Dynamic");
            latinFont.fallbackFontAssetTable = new List<FontAsset> { devanagariFont };

            textSettings = ScriptableObject.CreateInstance<PanelTextSettings>();
            textSettings.name = "VANDE Production HUD Text Settings";
            textSettings.hideFlags = HideFlags.DontSave;
            textSettings.defaultFontAsset = latinFont;
            textSettings.fallbackFontAssets = new List<FontAsset> { devanagariFont };
            textSettings.missingCharacterUnicode = 0x25A1;
            textSettings.clearDynamicDataOnBuild = false;
            textSettings.displayWarnings = true;

            panelSettings = ScriptableObject.CreateInstance<PanelSettings>();
            panelSettings.name = "VANDE Production HUD Panel Settings";
            panelSettings.hideFlags = HideFlags.DontSave;
            panelSettings.scaleMode = PanelScaleMode.ConstantPixelSize;
            panelSettings.scale = 1f;
            panelSettings.clearColor = false;
            panelSettings.clearDepthStencil = false;
            panelSettings.sortingOrder = 1000f;
            panelSettings.textSettings = textSettings;
            // Assigned before the document is enabled, so the runtime panel is created with it.
            panelSettings.themeStyleSheet = theme;

            documentObject = new GameObject("VANDE Advanced Text Document");
            documentObject.hideFlags = HideFlags.DontSave;
            documentObject.SetActive(false);
            documentObject.transform.SetParent(transform, false);
            document = documentObject.AddComponent<UIDocument>();
            document.panelSettings = panelSettings;
            document.sortingOrder = 1000;
            documentObject.SetActive(true);

            canvas = document.rootVisualElement;
            canvas.name = "VANDE Advanced Text Canvas";
            canvas.pickingMode = PickingMode.Ignore;
            canvas.style.position = Position.Absolute;
            canvas.style.left = 0f;
            canvas.style.right = 0f;
            canvas.style.top = 0f;
            canvas.style.bottom = 0f;
            canvas.style.overflow = Overflow.Visible;
        }

        private static FontAsset CreateDynamicFontAsset(Font source, string assetName)
        {
            var result = FontAsset.CreateFontAsset(
                source,
                90,
                9,
                GlyphRenderMode.SDFAA,
                512,
                512,
                AtlasPopulationMode.Dynamic,
                true);
            if (result == null)
                throw new InvalidOperationException("Unable to create TextCore font: " + assetName);
            result.name = assetName;
            result.hideFlags = HideFlags.DontSave;
            result.atlasPopulationMode = AtlasPopulationMode.Dynamic;
            result.isMultiAtlasTexturesEnabled = true;
            return result;
        }

        private void OnDestroy()
        {
            for (var index = labels.Count - 1; index >= 0; index--)
                labels[index].RemoveFromHierarchy();
            labels.Clear();

            if (documentObject != null)
            {
                if (Application.isPlaying) Destroy(documentObject);
                else DestroyImmediate(documentObject);
            }

            documentObject = null;
            document = null;
            canvas = null;
            DestroyGeneratedFont(latinFont);
            DestroyGeneratedFont(devanagariFont);
            DestroyOwned(panelSettings);
            DestroyOwned(textSettings);
            latinFont = null;
            devanagariFont = null;
            panelSettings = null;
            textSettings = null;
            // The theme is a Unity-owned Resources asset: released by Unity, never destroyed here.
            theme = null;
        }

        private static void DestroyGeneratedFont(FontAsset fontAsset)
        {
            if (fontAsset == null) return;
            var material = fontAsset.material;
            var textures = fontAsset.atlasTextures;
            DestroyOwned(fontAsset);
            DestroyOwned(material);
            for (var index = 0; index < textures.Length; index++) DestroyOwned(textures[index]);
        }

        private static void DestroyOwned(UnityEngine.Object value)
        {
            if (value == null) return;
            if (Application.isPlaying) Destroy(value);
            else DestroyImmediate(value);
        }
    }

    /// <summary>
    /// Bounded Stage-1 HUD text rendered by UI Toolkit/TextCore Advanced Text.
    /// Requested accessibility size is never reduced. Long essential copy is
    /// retained in a vertical scroll surface instead of being elided.
    /// </summary>
    internal sealed class ProductionHudAdvancedLabel
    {
        private readonly VisualElement host;
        private readonly Label label;
        private readonly ScrollView scrollView;
        private readonly TextAnchor anchor;
        private bool compact;
        private bool compactWraps;
        private string text = string.Empty;
        private Color colour = Color.white;

        public ProductionHudAdvancedLabel(
            VisualElement parent,
            FontAsset latinFont,
            string name,
            TextAnchor anchor,
            TextAlignment alignment,
            bool scrollable)
        {
            if (parent == null) throw new ArgumentNullException(nameof(parent));
            if (latinFont == null) throw new ArgumentNullException(nameof(latinFont));

            this.anchor = anchor;
            if (scrollable)
            {
                scrollView = new ScrollView(ScrollViewMode.Vertical)
                {
                    name = name + " Scroll"
                };
                scrollView.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
                scrollView.verticalScrollerVisibility = ScrollerVisibility.Auto;
                scrollView.pickingMode = PickingMode.Position;
                host = scrollView;
                label = new Label { name = name };
                scrollView.Add(label);
            }
            else
            {
                label = new Label { name = name };
                host = label;
                host.pickingMode = PickingMode.Ignore;
            }

            host.style.position = Position.Absolute;
            host.style.marginLeft = 0f;
            host.style.marginRight = 0f;
            host.style.marginTop = 0f;
            host.style.marginBottom = 0f;
            host.style.paddingLeft = 0f;
            host.style.paddingRight = 0f;
            host.style.paddingTop = 0f;
            host.style.paddingBottom = 0f;
            host.style.overflow = scrollable ? Overflow.Hidden : Overflow.Visible;

            label.enableRichText = false;
            label.displayTooltipWhenElided = false;
            label.pickingMode = scrollable ? PickingMode.Position : PickingMode.Ignore;
            label.style.unityFontDefinition = new StyleFontDefinition(latinFont);
            label.style.unityTextGenerator = TextGeneratorType.Advanced;
            label.style.unityTextAlign = anchor;
            label.style.whiteSpace = WhiteSpace.Normal;
            label.style.textOverflow = TextOverflow.Clip;
            label.style.overflow = Overflow.Visible;
            label.style.flexShrink = 0f;
            label.style.unityTextAutoSize = TextAutoSize.None();
            ApplyAlignment(alignment);

            parent.Add(host);
        }

        /// <summary>
        /// Compact rail copy (score, over, conditions, caption, outcome, actions) never wraps on its own and never
        /// leaves its box: its explicit lines are kept and, where the shaped copy is larger than the box, the font is
        /// reduced until it fits (wedge phase 3: the TextMesh-era sizes overflowed once measured with real UI Toolkit
        /// shaping). Scrollable long-form copy keeps its requested size and scrolls instead.
        /// </summary>
        internal void ConfigureCompact(bool wrap = false)
        {
            if (scrollView != null) return;
            compact = true;
            compactWraps = wrap;
            label.style.whiteSpace = wrap ? WhiteSpace.Normal : WhiteSpace.NoWrap;
        }

        internal bool IsCompact => compact;

        /// <summary>The copy's shaped size on its explicit lines (no wrapping) at a font size.</summary>
        internal Vector2 MeasureUnwrapped(string value, float fontSize)
        {
            return label.MeasureTextSize(
                value ?? string.Empty,
                0f,
                VisualElement.MeasureMode.Undefined,
                0f,
                VisualElement.MeasureMode.Undefined,
                Mathf.Max(1f, fontSize));
        }

        /// <summary>Shaped size of the copy wrapped at a width (as a wrapping label lays it out).</summary>
        internal Vector2 MeasureWrapped(string value, float width, float fontSize)
        {
            return label.MeasureTextSize(
                value ?? string.Empty,
                Mathf.Max(1f, width),
                VisualElement.MeasureMode.AtMost,
                0f,
                VisualElement.MeasureMode.Undefined,
                Mathf.Max(1f, fontSize));
        }

        /// <summary>
        /// Lets a scrollable host take pointers (to scroll) only when it may: never during the live ball, where the
        /// one gesture surface owns every pointer.
        /// </summary>
        internal void SetPointerInteractive(bool value)
        {
            if (scrollView == null) return;
            scrollView.pickingMode = value ? PickingMode.Position : PickingMode.Ignore;
            label.pickingMode = value ? PickingMode.Position : PickingMode.Ignore;
        }

        private void FitCompactFont(Rect box, float requestedPixelHeight, float minimumPixelHeight)
        {
            // Never below the floor (lead ruling: at 200% no label below its 100% size; caption and outcome at
            // least 1.5x); copy that still does not fit at the floor overflows visibly rather than shrinking further.
            var floor = Mathf.Clamp(minimumPixelHeight, 1f, Mathf.Max(1f, requestedPixelHeight));
            var size = Mathf.Max(1f, requestedPixelHeight);
            for (var attempt = 0; attempt < 6; attempt++)
            {
                var measured = compactWraps
                    ? label.MeasureTextSize(text, box.width, VisualElement.MeasureMode.AtMost, 0f,
                        VisualElement.MeasureMode.Undefined, size)
                    : MeasureUnwrapped(text, size);
                if (measured.x <= 0f || measured.y <= 0f) break;
                if (measured.x <= box.width + 0.25f && measured.y <= box.height + 0.25f) break;
                var shrink = Mathf.Min(box.width / measured.x, box.height / measured.y);
                size = Mathf.Max(floor, size * Mathf.Min(0.98f, shrink));
                if (size <= floor) break;
            }
            label.style.fontSize = size;
        }

        public string Text => text;
        public Color Colour => colour;
        public bool Visible => host.resolvedStyle.display != DisplayStyle.None;
        internal Label ElementForTesting => label;
        internal VisualElement HostForTesting => host;
        internal bool IsScrollable => scrollView != null;

        public void Set(
            string value,
            Vector2 position,
            float pixelHeight,
            Color valueColour,
            float depth = 0f)
        {
            SetText(value, pixelHeight, valueColour);

            var width = Mathf.Max(8f, pixelHeight * 2.5f);
            var height = Mathf.Max(8f, pixelHeight * 1.7f);
            var left = position.x - HorizontalAnchorOffset(width, anchor);
            var bottom = position.y - VerticalAnchorOffset(height, anchor);
            SetHostRect(new Rect(left, bottom, width, height));
        }

        public void SetFitted(
            string value,
            Vector2 position,
            float requestedPixelHeight,
            Color valueColour,
            Rect bounds,
            Vector2 padding,
            float depth = 0f,
            float minimumPixelHeight = 0f)
        {
            SetText(value, requestedPixelHeight, valueColour);
            var insetX = Mathf.Clamp(padding.x, 0f, bounds.width * 0.5f);
            var insetY = Mathf.Clamp(padding.y, 0f, bounds.height * 0.5f);
            var content = new Rect(
                bounds.xMin + insetX,
                bounds.yMin + insetY,
                Mathf.Max(1f, bounds.width - insetX * 2f),
                Mathf.Max(1f, bounds.height - insetY * 2f));
            SetHostRect(content);
            if (compact) FitCompactFont(content, requestedPixelHeight, minimumPixelHeight);

            // Only scrollable copy sizes its label to the content inside the bounded host: full host width, auto
            // height so every shaped line is kept. A compact label IS its host, so it keeps the fitted box; setting
            // 100% here made it as wide as the whole canvas (right-aligned text ran to the screen edge and nothing
            // wrapped inside its rail), found when the HUD tests moved from TextMesh to UI Toolkit (wedge phase 3).
            if (scrollView == null) return;
            label.style.width = Length.Percent(100f);
            label.style.height = StyleKeyword.Auto;
            label.style.minHeight = content.height;
        }

        public void SetColour(Color value)
        {
            colour = value;
            label.style.color = value;
        }

        public void SetVisible(bool value)
        {
            host.style.display = value ? DisplayStyle.Flex : DisplayStyle.None;
        }

        public void RemoveFromHierarchy()
        {
            host.RemoveFromHierarchy();
        }

        private void SetText(string value, float requestedPixelHeight, Color valueColour)
        {
            text = value ?? string.Empty;
            colour = valueColour;
            label.text = text;
            label.style.fontSize = Mathf.Max(1f, requestedPixelHeight);
            label.style.color = colour;
        }

        private void SetHostRect(Rect rect)
        {
            host.style.left = rect.xMin;
            host.style.bottom = rect.yMin;
            host.style.width = rect.width;
            host.style.height = rect.height;
        }

        private void ApplyAlignment(TextAlignment alignment)
        {
            switch (alignment)
            {
                case TextAlignment.Center:
                    label.style.alignSelf = Align.Center;
                    break;
                case TextAlignment.Right:
                    label.style.alignSelf = Align.FlexEnd;
                    break;
                default:
                    label.style.alignSelf = Align.FlexStart;
                    break;
            }
        }

        private static float HorizontalAnchorOffset(float width, TextAnchor value)
        {
            switch (value)
            {
                case TextAnchor.UpperCenter:
                case TextAnchor.MiddleCenter:
                case TextAnchor.LowerCenter:
                    return width * 0.5f;
                case TextAnchor.UpperRight:
                case TextAnchor.MiddleRight:
                case TextAnchor.LowerRight:
                    return width;
                default:
                    return 0f;
            }
        }

        private static float VerticalAnchorOffset(float height, TextAnchor value)
        {
            switch (value)
            {
                case TextAnchor.MiddleLeft:
                case TextAnchor.MiddleCenter:
                case TextAnchor.MiddleRight:
                    return height * 0.5f;
                case TextAnchor.UpperLeft:
                case TextAnchor.UpperCenter:
                case TextAnchor.UpperRight:
                    return height;
                default:
                    return 0f;
            }
        }
    }
}
