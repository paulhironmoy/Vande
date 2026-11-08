using System.Diagnostics;

namespace Vande.Practice.Presentation
{
    /// <summary>
    /// Stage timings of ProceduralPracticeWorld.AcceptResult, for the evidence harness. The calls are [Conditional("UNITY_EDITOR")]:
    /// in a player build the compiler removes them, so the production path is untouched. Each Mark adds the time since the
    /// previous Mark (or Begin) to its stage.
    /// </summary>
    internal static class AcceptResultTimings
    {
        internal static readonly string[] Stages =
        {
            "validate trace and body frame",
            "stance pad step / replay reset",
            "shown pose capture",
            "stroke flags and hero capture",
            "batter timing",
            "batter carry",
            "restore + latch root, posture, body frame",
            "stroke blend sample / no-shot blend",
            "striker physics body",
            "presented bat",
            "pack stroke",
            "replay delivery reset",
            "effects path, accepted trace",
            "fielding choreography",
            "running plan",
            "held ball windows",
            "new playback",
            "reconcile historical events",
            "playback seek",
            "apply held ball",
            "state, quiet"
        };

        internal static readonly double[] Milliseconds = new double[Stages.Length];
        private static long mark;

        [Conditional("UNITY_EDITOR")]
        internal static void Begin()
        {
            for (var index = 0; index < Milliseconds.Length; index++) Milliseconds[index] = 0.0;
            mark = Stopwatch.GetTimestamp();
        }

        [Conditional("UNITY_EDITOR")]
        internal static void Mark(int stage)
        {
            var now = Stopwatch.GetTimestamp();
            Milliseconds[stage] += (now - mark) * 1000.0 / Stopwatch.Frequency;
            mark = now;
        }
    }
}
