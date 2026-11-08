using System;

namespace Vande.Practice.Input
{
    public static class PracticeFootworkSelection
    {
        public const double ForwardAbove = 0.38;
        public const double BackBelow = 0.62;

        public static bool ManualSelectionAvailable(string assistance)
        {
            return string.Equals(assistance, "real", StringComparison.Ordinal);
        }

        /// <summary>
        /// Mirrors src/input PRESS_FOOTWORK over the density-normalized native
        /// batting surface. This identifies raw intent only; TypeScript still
        /// normalizes the complete gesture and resolves physical footwork.
        /// </summary>
        public static string FromPress(double y, double surfaceHeight)
        {
            if (!Finite(y) || !Finite(surfaceHeight) || surfaceHeight <= 0.0)
                throw new ArgumentOutOfRangeException(nameof(surfaceHeight));
            var normalized = Math.Max(0.0, Math.Min(1.0, y / surfaceHeight));
            if (normalized < ForwardAbove) return "forward";
            if (normalized > BackBelow) return "back";
            return "auto";
        }

        public static bool IsNativePressWireValue(string value)
        {
            return value == "auto" || value == "forward" || value == "back";
        }

        public static bool IsWireValue(string value)
        {
            return IsNativePressWireValue(value) || value == "across" || value == "down_track";
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
