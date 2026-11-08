using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Environment
{
    /// <summary>
    /// Practice's neutral boundary boards: the Unity port of the web's paintPracticeBoards
    /// (src/render3d/three/stadium.ts). Eight dark, muted panels with a faint frame and seam, each carrying one cricket
    /// pictogram (a wicket, a solid seamed ball, a bat) or a plain weave, under faint scan lines. No words, no brand,
    /// team, sponsor or logo, and no external asset: the strip is painted in code, 2048 × 64 (1024 × 32 on Lite), and
    /// repeats round the ring at its painted aspect. Presentation only.
    /// </summary>
    public static class ProductionPracticeBoards
    {
        public const int Panels = 8;
        /// <summary>The strip's own aspect (2048 × 64): each panel is 4:1.</summary>
        public const float StripAspect = 2048f / 64f;

        /// <summary>
        /// Whole strip repeats round a board ring of this radius and height that keep the painted aspect, so a ball
        /// pictogram stays a disc (never a stretched ring). The web's 0.9 m boards repeat six times; Unity's 0.40 m
        /// boards need about thirty-one.
        /// </summary>
        public static int RingRepeatsFor(float radius, float height)
        {
            if (!(radius > 0f) || !(height > 0f)) throw new ArgumentOutOfRangeException(nameof(radius));
            return Mathf.Max(1, Mathf.RoundToInt(2f * Mathf.PI * radius / (height * StripAspect)));
        }
        internal static readonly Color32[] PanelColours =
        {
            Hex(0x16301f), Hex(0x1b2433), Hex(0x2a1c22), Hex(0x1f2326),
            Hex(0x18282c), Hex(0x262119), Hex(0x1a2230), Hex(0x22201f)
        };

        private static readonly Color Ink = new Color(214f / 255f, 220f / 255f, 210f / 255f, 0.42f);

        /// <summary>Paints the strip. `scale` 1 is 2048 × 64 canvas pixels; 0.5 is the Lite strip.</summary>
        internal static Texture2D Create(float scale)
        {
            if (!(scale > 0f) || scale > 1f) throw new ArgumentOutOfRangeException(nameof(scale));
            var width = Mathf.RoundToInt(2048 * scale);
            var height = Mathf.RoundToInt(64 * scale);
            var canvas = new Canvas(width, height, scale);
            Paint(canvas);
            var texture = new Texture2D(width, height, TextureFormat.RGBA32, true, false)
            {
                name = "VANDE Practice neutral boundary boards",
                wrapMode = TextureWrapMode.Repeat,
                filterMode = FilterMode.Trilinear,
                anisoLevel = 4,
                hideFlags = HideFlags.DontSave
            };
            texture.SetPixels32(canvas.ToUnityRows());
            texture.Apply(true, false);
            return texture;
        }

        /// <summary>The painted canvas (evidence and tests): RGBA in canvas order (row 0 at the top).</summary>
        public static Color[] PaintCanvas(float scale, out int width, out int height)
        {
            width = Mathf.RoundToInt(2048 * scale);
            height = Mathf.RoundToInt(64 * scale);
            var canvas = new Canvas(width, height, scale);
            Paint(canvas);
            return canvas.Pixels;
        }

        private static void Paint(Canvas g)
        {
            const float panelWidth = 2048f / Panels;
            for (var index = 0; index < Panels; index++)
            {
                var x0 = index * panelWidth;
                var background = (Color)PanelColours[index];
                g.FillRect(x0, 0f, panelWidth, 64f, background);
                // A faint inner frame and a darker seam between panels.
                g.StrokeRect(x0 + 6f, 6f, panelWidth - 12f, 52f, 2f, new Color(1f, 1f, 1f, 0.07f));
                g.FillRect(x0, 0f, 3f, 64f, new Color(0f, 0f, 0f, 0.45f));
                var cx = x0 + panelWidth / 2f;
                switch (index % 4)
                {
                    case 0:
                        // A wicket: three stumps and two bails.
                        foreach (var dx in new[] { -12f, 0f, 12f }) g.Line(cx + dx, 50f, cx + dx, 18f, 3f, Ink);
                        g.FillRect(cx - 14f, 13f, 13f, 3f, Ink);
                        g.FillRect(cx + 1f, 13f, 13f, 3f, Ink);
                        break;
                    case 1:
                    {
                        // A solid ball with one stitched seam (a single disc: never read as interlocking rings).
                        g.FillCircle(cx, 32f, 14f, Ink);
                        var seam = new Color(background.r, background.g, background.b, 1f);
                        g.Arc(cx - 26f, 32f, 28f, -0.52f, 0.52f, 2f, seam);
                        for (var k = -3; k <= 3; k++)
                        {
                            var a = k * 0.13f;
                            var x = cx - 26f + Mathf.Cos(a) * 28f;
                            var y = 32f + Mathf.Sin(a) * 28f;
                            g.Line(x - 3f, y, x + 3f, y, 2f, seam);
                        }
                        break;
                    }
                    case 2:
                        // A bat, laid across the panel.
                        g.FillRotatedRect(cx, 32f, -0.38f, -46f, -6f, 62f, 12f, Ink);
                        g.FillRotatedRect(cx, 32f, -0.38f, 16f, -2.5f, 30f, 5f, Ink);
                        break;
                    default:
                        // A plain weave of short dashes.
                        for (var y = 18; y <= 46; y += 7)
                        {
                            for (var x = x0 + 26f + (y / 7f % 2f) * 8f; x < x0 + panelWidth - 26f; x += 16f)
                                g.Line(x, y, x + 8f, y, 2f, Ink);
                        }
                        break;
                }
            }
            for (var y = 0; y < 64; y += 4) g.FillRect(0f, y, 2048f, 1f, new Color(1f, 1f, 1f, 0.05f));
        }

        private static Color32 Hex(int rgb)
        {
            return new Color32((byte)(rgb >> 16), (byte)((rgb >> 8) & 0xff), (byte)(rgb & 0xff), 255);
        }

        /// <summary>
        /// A tiny anti-aliased painter in 2048 × 64 canvas units (y down), drawing at `scale` into a sRGB buffer, with
        /// canvas source-over blending. Coverage comes from each shape's signed distance at the pixel centre.
        /// </summary>
        private sealed class Canvas
        {
            private readonly int width;
            private readonly int height;
            private readonly float scale;

            public Canvas(int width, int height, float scale)
            {
                this.width = width;
                this.height = height;
                this.scale = scale;
                Pixels = new Color[width * height];
            }

            public Color[] Pixels { get; }

            public Color32[] ToUnityRows()
            {
                var rows = new Color32[Pixels.Length];
                for (var y = 0; y < height; y++)
                    for (var x = 0; x < width; x++)
                    {
                        var c = Pixels[y * width + x];
                        rows[(height - 1 - y) * width + x] = new Color(c.r, c.g, c.b, 1f);
                    }
                return rows;
            }

            public void FillRect(float x, float y, float w, float h, Color colour)
            {
                Shade(x, y, x + w, y + h, colour, (px, py) =>
                {
                    var dx = Mathf.Max(x - px, px - (x + w));
                    var dy = Mathf.Max(y - py, py - (y + h));
                    return Mathf.Max(dx, dy);
                });
            }

            public void StrokeRect(float x, float y, float w, float h, float line, Color colour)
            {
                var half = line / 2f;
                Shade(x - half, y - half, x + w + half, y + h + half, colour, (px, py) =>
                {
                    var outer = Mathf.Max(Mathf.Max(x - half - px, px - (x + w + half)),
                        Mathf.Max(y - half - py, py - (y + h + half)));
                    var inner = Mathf.Max(Mathf.Max(x + half - px, px - (x + w - half)),
                        Mathf.Max(y + half - py, py - (y + h - half)));
                    return Mathf.Max(outer, -inner);
                });
            }

            public void Line(float x0, float y0, float x1, float y1, float line, Color colour)
            {
                var half = line / 2f;
                Shade(Mathf.Min(x0, x1) - half, Mathf.Min(y0, y1) - half, Mathf.Max(x0, x1) + half,
                    Mathf.Max(y0, y1) + half, colour, (px, py) => SegmentDistance(px, py, x0, y0, x1, y1) - half);
            }

            public void FillCircle(float cx, float cy, float r, Color colour)
            {
                Shade(cx - r, cy - r, cx + r, cy + r, colour,
                    (px, py) => Mathf.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) - r);
            }

            public void Arc(float cx, float cy, float r, float from, float to, float line, Color colour)
            {
                var half = line / 2f;
                var ax = cx + Mathf.Cos(from) * r;
                var ay = cy + Mathf.Sin(from) * r;
                var bx = cx + Mathf.Cos(to) * r;
                var by = cy + Mathf.Sin(to) * r;
                Shade(cx - r - half, cy - r - half, cx + r + half, cy + r + half, colour, (px, py) =>
                {
                    var angle = Mathf.Atan2(py - cy, px - cx);
                    if (angle >= from && angle <= to)
                        return Mathf.Abs(Mathf.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy)) - r) - half;
                    // Round caps (the painter's lineCap is round).
                    var da = Mathf.Sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
                    var db = Mathf.Sqrt((px - bx) * (px - bx) + (py - by) * (py - by));
                    return Mathf.Min(da, db) - half;
                });
            }

            public void FillRotatedRect(float ox, float oy, float angle, float x, float y, float w, float h, Color colour)
            {
                var cos = Mathf.Cos(angle);
                var sin = Mathf.Sin(angle);
                var reach = Mathf.Max(Mathf.Abs(x), Mathf.Abs(x + w)) + Mathf.Max(Mathf.Abs(y), Mathf.Abs(y + h));
                Shade(ox - reach, oy - reach, ox + reach, oy + reach, colour, (px, py) =>
                {
                    // Into the rotated frame (canvas rotate(a): x' = x cos − y sin, y' = x sin + y cos).
                    var lx = (px - ox) * cos + (py - oy) * sin;
                    var ly = -(px - ox) * sin + (py - oy) * cos;
                    var dx = Mathf.Max(x - lx, lx - (x + w));
                    var dy = Mathf.Max(y - ly, ly - (y + h));
                    return Mathf.Max(dx, dy);
                });
            }

            private void Shade(float minX, float minY, float maxX, float maxY, Color colour,
                Func<float, float, float> distance)
            {
                var x0 = Mathf.Max(0, Mathf.FloorToInt(minX * scale) - 1);
                var y0 = Mathf.Max(0, Mathf.FloorToInt(minY * scale) - 1);
                var x1 = Mathf.Min(width - 1, Mathf.CeilToInt(maxX * scale) + 1);
                var y1 = Mathf.Min(height - 1, Mathf.CeilToInt(maxY * scale) + 1);
                for (var py = y0; py <= y1; py++)
                {
                    for (var px = x0; px <= x1; px++)
                    {
                        // The pixel centre in canvas units; coverage over about one device pixel.
                        var d = distance((px + 0.5f) / scale, (py + 0.5f) / scale) * scale;
                        var coverage = Mathf.Clamp01(0.5f - d);
                        if (coverage <= 0f) continue;
                        var alpha = colour.a * coverage;
                        var index = py * width + px;
                        var dst = Pixels[index];
                        Pixels[index] = new Color(
                            colour.r * alpha + dst.r * (1f - alpha),
                            colour.g * alpha + dst.g * (1f - alpha),
                            colour.b * alpha + dst.b * (1f - alpha),
                            alpha + dst.a * (1f - alpha));
                    }
                }
            }

            private static float SegmentDistance(float px, float py, float ax, float ay, float bx, float by)
            {
                var vx = bx - ax;
                var vy = by - ay;
                var length = vx * vx + vy * vy;
                var u = length > 0f ? Mathf.Clamp01(((px - ax) * vx + (py - ay) * vy) / length) : 0f;
                var dx = px - (ax + vx * u);
                var dy = py - (ay + vy * u);
                return Mathf.Sqrt(dx * dx + dy * dy);
            }
        }
    }
}
