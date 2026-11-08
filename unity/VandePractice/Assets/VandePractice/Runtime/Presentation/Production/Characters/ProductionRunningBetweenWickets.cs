using System;
using System.Collections.Generic;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// The batters' running between the wickets, reconstructed exactly from the physics (src/physics/running.ts,
    /// frozen): both batters leave START_S after the ball leaves the bat, sprint RUN_M at ACCEL up to TOP_SPEED, and
    /// lose TURN_S at each turn; one trace "run" event marks each completed run. Presentation only: this never adds,
    /// removes or retimes a run. If the trace's run events do not reproduce from its bat-contact time with these
    /// constants the plan is empty (fail closed: the batters stay put rather than show runs the physics did not make).
    /// </summary>
    public sealed class ProductionRunningBetweenWickets
    {
        // src/physics/running.ts RUNNING (frozen 5d).
        public const double StartSeconds = 0.35;
        public const double Acceleration = 5.5;
        public const double TopSpeed = 7.5;
        public const double RunMetres = 16.5;
        public const double TurnSeconds = 0.15;
        private const double ToleranceSeconds = 1e-6;

        private readonly double[] runStart;
        private readonly double[] runEnd;

        private ProductionRunningBetweenWickets(double contactT, double[] start, double[] end)
        {
            ContactT = contactT;
            runStart = start;
            runEnd = end;
        }

        public static ProductionRunningBetweenWickets Empty { get; } =
            new ProductionRunningBetweenWickets(double.NaN, new double[0], new double[0]);

        public double ContactT { get; }
        public int Runs => runStart.Length;
        public double FirstStartT => Runs == 0 ? double.PositiveInfinity : runStart[0];
        public double LastEndT => Runs == 0 ? double.NegativeInfinity : runEnd[Runs - 1];
        public double RunStartT(int index) => runStart[index];
        public double RunEndT(int index) => runEnd[index];

        /// <summary>Seconds to sprint one run from standing (running.ts sprintS).</summary>
        public static double SprintSeconds(double metres = RunMetres)
        {
            var accelerationDistance = TopSpeed * TopSpeed / (2.0 * Acceleration);
            if (metres <= accelerationDistance) return Math.Sqrt(2.0 * metres / Acceleration);
            return TopSpeed / Acceleration + (metres - accelerationDistance) / TopSpeed;
        }

        /// <summary>Distance covered (m) τ seconds into one run, from standing, capped at RUN_M.</summary>
        public static double DistanceAt(double tau)
        {
            if (tau <= 0.0) return 0.0;
            var accelerationTime = TopSpeed / Acceleration;
            var distance = tau <= accelerationTime
                ? 0.5 * Acceleration * tau * tau
                : 0.5 * Acceleration * accelerationTime * accelerationTime + TopSpeed * (tau - accelerationTime);
            return Math.Min(RunMetres, distance);
        }

        /// <summary>Ground speed (m/s) τ seconds into one run.</summary>
        public static double SpeedAt(double tau)
        {
            if (tau <= 0.0 || tau >= SprintSeconds()) return 0.0;
            return Math.Min(TopSpeed, Acceleration * tau);
        }

        public static ProductionRunningBetweenWickets FromTrace(CanonicalDeliveryTrace trace)
        {
            if (trace?.events == null) return Empty;
            double? contactT = null;
            var completions = new List<double>();
            foreach (var traceEvent in trace.events)
            {
                if (traceEvent == null) continue;
                if (traceEvent.kind == "contact" && !contactT.HasValue && IsBatContact(traceEvent.contact))
                    contactT = traceEvent.t;
                if (traceEvent.kind == "run") completions.Add(traceEvent.t);
            }
            if (completions.Count == 0 || !contactT.HasValue || completions.Count > 3) return Empty;
            completions.Sort();
            var sprint = SprintSeconds();
            var start = new double[completions.Count];
            var end = new double[completions.Count];
            for (var index = 0; index < completions.Count; index++)
            {
                var expected = contactT.Value + StartSeconds + sprint + index * (sprint + TurnSeconds);
                if (Math.Abs(expected - completions[index]) > ToleranceSeconds) return Empty;
                end[index] = completions[index];
                start[index] = end[index] - sprint;
            }
            return new ProductionRunningBetweenWickets(contactT.Value, start, end);
        }

        /// <summary>
        /// Where a runner is at time t: 0 at the end it started from, 1 at the other end; runs alternate direction.
        /// `speed` is the ground speed (m/s); `running` is false before the first run, in a turn and after the last.
        /// </summary>
        public double Progress(double t, out double speed, out bool running)
        {
            speed = 0.0;
            running = false;
            if (Runs == 0 || t <= runStart[0]) return 0.0;
            var position = 0.0;
            for (var index = 0; index < Runs; index++)
            {
                var direction = index % 2 == 0 ? 1.0 : -1.0;
                var origin = index % 2 == 0 ? 0.0 : 1.0;
                if (t < runStart[index]) return position;
                if (t <= runEnd[index])
                {
                    var tau = t - runStart[index];
                    speed = SpeedAt(tau);
                    running = true;
                    return origin + direction * DistanceAt(tau) / RunMetres;
                }
                position = origin + direction;
            }
            return position;
        }

        private static bool IsBatContact(string contact) =>
            contact == "middle" || contact == "inside_edge" || contact == "outside_edge" ||
            contact == "top_edge" || contact == "leading_edge";
    }
}
