using System;
using System.Collections.Generic;
using System.IO;
using Vande.Practice.Presentation.Production.Director;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>Where the vendored fixtures are, whether the tests run in the Unity Editor or in the standalone Mono harness.</summary>
    internal static class DirectorFixtures
    {
        public static string Dir
        {
            get
            {
#if STANDALONE_HARNESS
                return Environment.GetEnvironmentVariable("VANDE_DIRECTOR_FIXTURES");
#else
                return Path.Combine(UnityEngine.Application.dataPath, "VandePractice/Tests/EditMode/Director/Fixtures");
#endif
            }
        }

        /// <summary>The Director's runtime sources (for the source scan).</summary>
        public static string RuntimeDir
        {
            get
            {
#if STANDALONE_HARNESS
                return Environment.GetEnvironmentVariable("VANDE_DIRECTOR_RUNTIME");
#else
                return Path.Combine(UnityEngine.Application.dataPath, "VandePractice/Runtime/Presentation/Production/Director");
#endif
            }
        }

        /// <summary>The repository root (three levels above Assets/).</summary>
        public static string RepoRoot
        {
            get
            {
#if STANDALONE_HARNESS
                return Environment.GetEnvironmentVariable("VANDE_REPO_ROOT");
#else
                return Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, "..", "..", ".."));
#endif
            }
        }

        public static string Read(string name)
        {
            return File.ReadAllText(Path.Combine(Dir, name));
        }

        private static Dictionary<string, ClipSeries> series;

        /// <summary>The bowler clip-head measurements (series "pace", "pace-late", "spin").</summary>
        public static Dictionary<string, ClipSeries> Series
        {
            get { return series ?? (series = ClipSeries.Parse(Read("bowler-clip-head.json"))); }
        }
    }

    /// <summary>Measurement helpers on baked plans (tests/unit/render3d/director/gates.ts).</summary>
    internal static class DirectorTestKit
    {
        public static readonly int[] LifeChannels =
        {
            DirectorChannels.Breath, DirectorChannels.SwayX, DirectorChannels.SwayZ, DirectorChannels.SwayRoll, DirectorChannels.Posture, DirectorChannels.Twist,
        };

        /// <summary>The value of channel c at frame i, in its unit.</summary>
        public static double Val(DirectorPlan p, int i, int c)
        {
            return p.Trace[i * DirectorChannels.Count + c] * DirectorChannels.Scale[c];
        }

        public static double TimeOf(DirectorPlan p, int i)
        {
            return p.T0 + (i * 1000.0) / p.Hz;
        }

        public static int FrameOf(DirectorPlan p, double tMs)
        {
            return (int)DirectorMath.JsRound(((tMs - p.T0) * p.Hz) / 1000);
        }

        /// <summary>Largest absolute difference between two traces over frames [i0, i1], in channel units.</summary>
        public static double MaxDiff(DirectorPlan a, DirectorPlan b, int i0, int i1)
        {
            double m = 0;
            for (int i = Math.Max(0, i0); i <= Math.Min(a.N, b.N) - 1 && i <= i1; i++)
                for (int c = 0; c < DirectorChannels.Count; c++)
                    m = Math.Max(m, Math.Abs(a.Trace[i * DirectorChannels.Count + c] - b.Trace[i * DirectorChannels.Count + c]) * DirectorChannels.Scale[c]);
            return m;
        }

        public static bool TraceEquals(DirectorPlan a, DirectorPlan b)
        {
            if (a.Trace.Length != b.Trace.Length) return false;
            for (int i = 0; i < a.Trace.Length; i++) if (a.Trace[i] != b.Trace[i]) return false;
            return true;
        }

        public static bool FloatsEqual(float[] a, float[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return false;
            return true;
        }

        public static bool EventsEqual(DirectorPlan a, DirectorPlan b)
        {
            return FloatsEqual(a.Fix, b.Fix) && FloatsEqual(a.Blink, b.Blink) && FloatsEqual(a.Micro, b.Micro) && FloatsEqual(a.Fidget, b.Fidget) && FloatsEqual(a.React, b.React) && FloatsEqual(a.Draw, b.Draw) && FloatsEqual(a.Amp, b.Amp);
        }

        /// <summary>Spearman rank correlation (ties share their mean rank).</summary>
        public static double Spearman(double[] x, double[] y)
        {
            double[] rx = Rank(x);
            double[] ry = Rank(y);
            double mx = Mean(rx);
            double my = Mean(ry);
            double sxy = 0;
            double sxx = 0;
            double syy = 0;
            for (int i = 0; i < rx.Length; i++)
            {
                sxy += (rx[i] - mx) * (ry[i] - my);
                sxx += (rx[i] - mx) * (rx[i] - mx);
                syy += (ry[i] - my) * (ry[i] - my);
            }
            double den = Math.Sqrt(sxx * syy);
            return sxy / (den == 0 ? 1 : den);
        }

        private static double[] Rank(double[] a)
        {
            int n = a.Length;
            var idx = new int[n];
            for (int i = 0; i < n; i++) idx[i] = i;
            Array.Sort(idx, (i, j) => a[i].CompareTo(a[j]));
            var r = new double[n];
            for (int i = 0; i < n;)
            {
                int j = i;
                while (j + 1 < n && a[idx[j + 1]] == a[idx[i]]) j++;
                double m = (i + j) / 2.0 + 1;
                for (int k = i; k <= j; k++) r[idx[k]] = m;
                i = j + 1;
            }
            return r;
        }

        public static double Mean(double[] a)
        {
            double s = 0;
            for (int i = 0; i < a.Length; i++) s += a[i];
            return s / (a.Length == 0 ? 1 : a.Length);
        }

        /// <summary>The key of ball k of a named series, as the web's tests build them.</summary>
        public static string KeyOf(string seed, int over, int ball)
        {
            return DirectorSeeds.DeliveryTakeKey(seed, over, ball);
        }
    }
}
