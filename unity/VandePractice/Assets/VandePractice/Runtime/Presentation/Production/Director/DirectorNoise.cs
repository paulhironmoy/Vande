using System;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>
    /// Smooth noise and the breath wave: a C# port of src/render3d/core/motion/director/noise.ts. Pure functions of
    /// (seed, time): the same input always gives the same number.
    /// </summary>
    public static class DirectorNoise
    {
        public const double Tau = Math.PI * 2;

        /// <summary>Quintic ease: zero first and second derivative at both ends (C2 noise).</summary>
        public static double Quint(double f)
        {
            return f * f * f * (f * (f * 6 - 15) + 10);
        }

        /// <summary>C2 value noise in [-1, 1] on an integer lattice hashed from (seed, i).</summary>
        public static double VNoise(uint seed, double x)
        {
            double fl = Math.Floor(x);
            int i = (int)fl;
            double a = DirectorSeeds.U01(seed, i) * 2 - 1;
            double b = DirectorSeeds.U01(seed, i + 1) * 2 - 1;
            return a + (b - a) * Quint(x - fl);
        }

        /// <summary>
        /// Fractal noise: octaves with lattice spacings <paramref name="spacing"/> (s) and amplitudes <paramref name="amp"/>, so the
        /// strength falls with frequency (about 1/f). <paramref name="x0"/> offsets the lattice so two balls never share it.
        /// The octave k uses seed + 977 k (modulo 2^32, as the web's mix does).
        /// </summary>
        public static double Fractal(uint seed, double tS, double x0, double[] spacing, double[] amp)
        {
            double s = 0;
            for (int k = 0; k < spacing.Length; k++)
                s += amp[k] * VNoise(unchecked(seed + 977u * (uint)k), tS / spacing[k] + x0);
            return s;
        }

        /// <summary>One breath, unit amplitude, for a phase in cycles: the inhale (rising) is faster than the exhale when skew > 0.</summary>
        public static double SkewSin(double cycles, double skew)
        {
            double a = Tau * cycles;
            return Math.Sin(a + skew * Math.Sin(a));
        }
    }
}
