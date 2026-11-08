#if VANDE_THEME_PROBE
using UnityEngine;
using UnityEngine.UIElements;

namespace Vande.Practice.UI.Production
{
    /// <summary>
    /// Evidence-only player probe, compiled only into the VANDE_THEME_PROBE standalone build that
    /// Editor/Evidence/VandeWedgeUnityEvidence.BuildThemeProbe makes (never into a shipped build). In a player, it
    /// creates the shipped HUD text layer, then a control panel built exactly as the HUD's was before the fix (the same
    /// settings, no theme), logs markers around both and quits, so the player log shows which panel warns.
    /// </summary>
    internal static class ProductionHudThemeProbe
    {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void Run()
        {
            new GameObject("VANDE theme probe").AddComponent<ProbeBehaviour>();
        }

        private sealed class ProbeBehaviour : MonoBehaviour
        {
            private int frames;

            private void Start()
            {
                Debug.Log("VANDE_THEME_PROBE begin shipped-layer");
                var layer = ProductionHudAdvancedTextLayer.For(transform);
                var theme = layer.PanelSettingsForTesting.themeStyleSheet;
                Debug.Log("VANDE_THEME_PROBE shipped-layer panel=\"" + layer.PanelSettingsForTesting.name +
                          "\" theme=" + (theme != null ? theme.name : "null") + " ready=" + layer.IsReady);

                // The one scrollable copy, overfull, so its scroll layout is measured in a player.
                scrollable = layer.CreateLabel("Dead Ball Reason Text", TextAnchor.UpperLeft, TextAlignment.Left);
                var copy = string.Join(" ", System.Linq.Enumerable.Repeat(
                    "The ball pitched on a good length outside off stump and you were late on it.", 12));
                scrollable.SetFitted(copy, new Vector2(40f, 40f), 28f, Color.white,
                    new Rect(40f, 40f, 320f, 140f), new Vector2(6f, 6f));
                // Control: a plain wrapped label of the same copy and width on the same panel (no ScrollView), so
                // the log shows whether text measurement itself works in this player.
                plain = new Label(copy);
                plain.style.position = Position.Absolute;
                plain.style.left = 400f;
                plain.style.top = 10f;
                plain.style.width = 308f;
                plain.style.whiteSpace = WhiteSpace.Normal;
                plain.style.fontSize = 28f;
                plain.style.unityFontDefinition = new StyleFontDefinition(layer.LatinFontForTesting);
                layer.RootForTesting.Add(plain);
                Debug.Log("VANDE_THEME_PROBE begin legacy-control");
                var settings = ScriptableObject.CreateInstance<PanelSettings>();
                settings.name = "VANDE theme probe legacy control (no theme)";
                settings.scaleMode = PanelScaleMode.ConstantPixelSize;
                settings.scale = 1f;
                settings.clearColor = false;
                settings.clearDepthStencil = false;
                settings.sortingOrder = 1000f;
                var control = new GameObject("VANDE theme probe legacy control");
                control.SetActive(false);
                control.AddComponent<UIDocument>().panelSettings = settings;
                control.SetActive(true);
                Debug.Log("VANDE_THEME_PROBE end legacy-control");
            }

            private ProductionHudAdvancedLabel scrollable;
            private Label plain;

            private static string R(Rect r) =>
                "[" + r.x.ToString("F1") + "," + r.y.ToString("F1") + "," + r.width.ToString("F1") + "," + r.height.ToString("F1") + "]";

            private static void Describe(string what, VisualElement e)
            {
                if (e == null) { Debug.Log("VANDE_THEME_PROBE describe " + what + " null"); return; }
                var r = e.resolvedStyle;
                Debug.Log("VANDE_THEME_PROBE describe " + what + " name=" + e.name + " classes=" +
                          string.Join("|", e.GetClasses()) + " dir=" + r.flexDirection + " grow=" + r.flexGrow +
                          " shrink=" + r.flexShrink + " basis=" + r.flexBasis + " pos=" + r.position + " h=" + r.height +
                          " minH=" + r.minHeight + " maxH=" + r.maxHeight + " ov=" + e.style.overflow +
                          " children=" + e.hierarchy.childCount);
            }

            private void LogScroll(string when)
            {
                var view = scrollable.HostForTesting as ScrollView;
                if (view == null) { Debug.Log("VANDE_THEME_PROBE scroll " + when + " no-scroll-view"); return; }
                var dragger = view.verticalScroller.slider.Q("unity-dragger");
                Debug.Log("VANDE_THEME_PROBE scroll " + when + " host=" + R(view.layout) +
                          " viewport=" + R(view.contentViewport.layout) +
                          " content=" + R(view.contentContainer.layout) +
                          " label=" + R(scrollable.ElementForTesting.layout) +
                          " scroller=" + R(view.verticalScroller.layout) +
                          " scrollerDisplay=" + view.verticalScroller.resolvedStyle.display +
                          " dragger=" + (dragger != null ? R(dragger.layout) : "null") +
                          " offset=" + view.scrollOffset.y.ToString("F1") +
                          " labelFont=" + scrollable.ElementForTesting.resolvedStyle.fontSize.ToString("F1") +
                          " measured=" + scrollable.ElementForTesting.MeasureTextSize(
                              scrollable.ElementForTesting.text, 308f, VisualElement.MeasureMode.Exactly,
                              0f, VisualElement.MeasureMode.Undefined) +
                          " plain=" + (plain != null ? R(plain.layout) : "null"));
            }

            private void Update()
            {
                ++frames;
                if (frames == 6 && scrollable != null) LogScroll("early");
                if (frames == 30 && scrollable != null)
                {
                    LogScroll("laid-out");
                    var view = scrollable.HostForTesting as ScrollView;
                    if (view != null) view.scrollOffset = new Vector2(0f, 100000f);
                }
                if (frames == 32 && scrollable != null)
                {
                    LogScroll("scrolled-to-end");
                    var view = scrollable.HostForTesting as ScrollView;
                    if (view != null)
                    {
                        Describe("view", view);
                        Describe("row", view.contentViewport.parent);
                        Describe("viewport", view.contentViewport);
                        Describe("content", view.contentContainer);
                        Describe("label", scrollable.ElementForTesting);
                        Describe("scroller", view.verticalScroller);
                    }
                }
                if (frames < 40) return;
                Debug.Log("VANDE_THEME_PROBE quit after " + frames + " frames");
                Application.Quit(0);
            }
        }
    }
}
#endif
