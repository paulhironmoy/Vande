using System;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>What the world knows about a delivery when it begins (all plain data; the physics frame).</summary>
    public sealed class StageDeliveryInputs
    {
        /// <summary>The delivery record's seed (the key of every draw of the ball, live and replayed).</summary>
        public string Seed;

        public string BowlerLook;
        public string StrikerLook;

        /// <summary>Scene ms of the release: the visible run-up's length (scene ms 0 is the run-up's first visible frame).</summary>
        public double ReleaseMs;

        /// <summary>The bowler's delivery stride starts (scene ms) and his follow-through ends; null: the defaults.</summary>
        public double? GatherMs;

        public double? FollowEndMs;

        /// <summary>The delivery's flight (simulation seconds from the release, physics frame).</summary>
        public BallTraceSample[] Flight;

        /// <summary>The physics' ideal contact time (simulation seconds).</summary>
        public double IdealContactT;
    }

    /// <summary>
    /// The Director's anchors for the scripts the Unity world plays (script.ts directorSpec, runtime stage binding): from the delivery as
    /// the host sent it (a live ball knows no contact, outcome, dead ball or stroke end; its task ends when the UNHIT ball passes the batter,
    /// which no contact can outlast) and from the result's trace. Pure functions of plain data.
    /// </summary>
    public static class StageSpecs
    {
        /// <summary>The batting crease line in the physics frame (z): the pitch's half-length less the popping crease.</summary>
        public const double CreaseZ = 10.06 - 1.22;

        /// <summary>The unhit ball is taken to have passed the batter this long after it crosses the crease line (a late contact behind it).</summary>
        public const double PassMarginMs = 30;

        /// <summary>The run-up's default delivery stride and follow-through (ms before / after the release) when the run-up model has no markers.</summary>
        public const double DefaultGatherBeforeMs = 650;

        public const double DefaultFollowAfterMs = 1400;

        /// <summary>A live script covers the release and this long after it (a result that comes later holds the last frame).</summary>
        public const double LiveTailMs = 7000;

        /// <summary>A result's or replay's script covers the trace and this long after it (the recovery, the outcome hold).</summary>
        public const double ResultTailMs = 4000;

        /// <summary>The batter's visual task ends this long after the unhit ball passes (stage constant of the web).</summary>
        public const double TaskPassMs = PassMarginMs;

        /// <summary>The time (simulation s) the unhit flight crosses the batting crease, else the physics' ideal contact time.</summary>
        public static double PassT(BallTraceSample[] flight, double idealContactT)
        {
            if (flight != null)
                for (int i = 0; i < flight.Length; i++)
                    if (flight[i].p != null && flight[i].p.z >= CreaseZ) return flight[i].t;
            return idealContactT;
        }

        /// <summary>
        /// The simulation time (s) up to which a delivery's own flight is certainly the ball the world draws, whatever swing is committed
        /// (UNITY-7 hides the pre-contact ball when a committed swing's ball reaches the bat, and when the flight data is used up): the
        /// earlier of the flight's end and the ball's arrival at the earliest contact plane the footworks have (down the track). The
        /// Director never looks at a ball the world might not have drawn.
        /// </summary>
        public static double LiveBallVisibleUntilT(BallTraceSample[] flight, double idealContactT)
        {
            if (flight == null || flight.Length == 0) return 0;
            double end = flight[flight.Length - 1].t;
            if (flight.Length < 2 || !(idealContactT > flight[0].t) || !(idealContactT < end)) return end;
            double earliest = ProductionBatterBodyModel.IdealTimeFor(flight, idealContactT, "down_track");
            return Math.Min(end, earliest);
        }

        /// <summary>
        /// The time (simulation s) the ball first touches bat, pad or body in the trace (a miss and a leave are no contact), else null: the
        /// first moment the hit ball can differ from the delivery's own flight.
        /// </summary>
        public static double? TouchT(CanonicalDeliveryTrace trace)
        {
            CanonicalTraceEvent[] events = trace == null ? null : trace.events;
            if (events == null) return null;
            for (int i = 0; i < events.Length; i++)
            {
                CanonicalTraceEvent e = events[i];
                if (e.kind == "pad") return e.t;
                if (e.kind == "contact" && e.contact != "miss" && e.contact != "leave") return e.t;
            }
            return null;
        }

        /// <summary>The time (simulation s) of the first event of a kind in the trace, else null.</summary>
        public static double? FirstEventT(CanonicalDeliveryTrace trace, string kind)
        {
            CanonicalTraceEvent[] events = trace == null ? null : trace.events;
            if (events == null) return null;
            for (int i = 0; i < events.Length; i++)
                if (events[i].kind == kind) return events[i].t;
            return null;
        }

        private static StageActorSpec BowlerSpec(StageDeliveryInputs d, double end)
        {
            double release = d.ReleaseMs;
            return new StageActorSpec
            {
                Start = 0,
                End = end,
                RunStart = 0,
                Gather = d.GatherMs ?? release - DefaultGatherBeforeMs,
                Release = release,
                FollowEnd = d.FollowEndMs ?? release + DefaultFollowAfterMs,
                Runs = 0,
            };
        }

        /// <summary>The live script's anchors: nothing about the result, the swing, the contact, the dead ball or the stroke's end.</summary>
        public static StageSpec Live(StageDeliveryInputs d)
        {
            if (d == null) throw new ArgumentNullException(nameof(d));
            double release = d.ReleaseMs;
            double end = release + LiveTailMs;
            double passMs = release + PassT(d.Flight, d.IdealContactT) * 1000.0;
            double visibleUntil = release + LiveBallVisibleUntilT(d.Flight, d.IdealContactT) * 1000.0;
            return new StageSpec
            {
                Seed = d.Seed,
                BowlerLook = d.BowlerLook,
                StrikerLook = d.StrikerLook,
                FlightEnd = visibleUntil,
                Bowler = BowlerSpec(d, end),
                Striker = new StageActorSpec
                {
                    Start = 0,
                    End = end,
                    Release = release,
                    // the unhit ball passing: the live task window (no contact can outlast it)
                    TaskEnd = passMs + TaskPassMs,
                },
            };
        }

        /// <summary>
        /// The result's anchors: the live script's with the contact, the swing, the dead ball, the outcome and the stroke's end the trace
        /// has. The bowler is outcome-blind: his spec is the live one's (apart from a longer script).
        /// </summary>
        public static StageSpec Result(StageDeliveryInputs d, CanonicalDeliveryTrace trace, string dismissal, string contactKind,
            int deliveryRuns, double? swingStartT, double closeness, bool leave)
        {
            if (d == null) throw new ArgumentNullException(nameof(d));
            if (trace == null) throw new ArgumentNullException(nameof(trace));
            double release = d.ReleaseMs;
            double duration = trace.durationSeconds;
            double end = release + duration * 1000.0 + ResultTailMs;
            double passMs = release + PassT(d.Flight, d.IdealContactT) * 1000.0;
            double? contactT = null;
            double? padT = null;
            double? deadT = null;
            double? boundaryT = null;
            int boundaryRuns = 0;
            double? stumpsT = null;
            double? catchT = null;
            int runEvents = 0;
            CanonicalTraceEvent[] events = trace.events ?? new CanonicalTraceEvent[0];
            for (int i = 0; i < events.Length; i++)
            {
                CanonicalTraceEvent e = events[i];
                switch (e.kind)
                {
                    case "contact":
                        if (e.contact != "miss" && e.contact != "leave" && contactT == null) contactT = e.t;
                        if ((e.contact == "pad" || e.contact == "body") && padT == null) padT = e.t;
                        break;
                    case "pad":
                        if (padT == null) padT = e.t;
                        if (contactT == null) contactT = e.t;
                        break;
                    case "dead":
                        if (deadT == null) deadT = e.t;
                        break;
                    case "boundary":
                        if (boundaryT == null)
                        {
                            boundaryT = e.t;
                            boundaryRuns = e.runs;
                        }
                        break;
                    case "stumps":
                        if (stumpsT == null) stumpsT = e.t;
                        break;
                    case "catch":
                        if (catchT == null) catchT = e.t;
                        break;
                    case "run":
                        runEvents++;
                        break;
                }
            }
            double dead = deadT ?? duration;
            bool dismissed = !string.IsNullOrEmpty(dismissal);
            // When the physics has confirmed the outcome (emotion.ts confirmedAt): the boundary, the stumps, the catch, the decision.
            double outcomeT;
            if (boundaryT != null) outcomeT = boundaryT.Value;
            else if (stumpsT != null && dismissal == "bowled") outcomeT = stumpsT.Value;
            else if (catchT != null && dismissed) outcomeT = catchT.Value;
            else if (dismissal == "lbw") outcomeT = (padT ?? dead) + 0.9;
            else outcomeT = dead;
            string outcome = OutcomeCategory(dismissal, boundaryT != null ? boundaryRuns : 0, contactKind, closeness, deliveryRuns, leave);
            double? contactMs = contactT == null ? (double?)null : release + contactT.Value * 1000.0;
            // The stroke ends when his recovery to the balanced finish is over; a leave or a ball he did not touch with a bat has no
            // bat trace: the ball's passing and the clip's length.
            double strokeEndMs;
            if (trace.bat != null && trace.bat.Length > 0)
            {
                double lastBat = trace.bat[trace.bat.Length - 1].t;
                double motionEnd = trace.batterMotion != null ? trace.batterMotion.endT : lastBat;
                strokeEndMs = release + (Math.Max(lastBat, motionEnd) + 0.6 + 0.28) * 1000.0;
            }
            else
            {
                strokeEndMs = release + (Math.Min(dead, d.IdealContactT + 0.7)) * 1000.0;
            }
            return new StageSpec
            {
                Seed = d.Seed,
                BowlerLook = d.BowlerLook,
                StrikerLook = d.StrikerLook,
                FlightEnd = release + LiveBallVisibleUntilT(d.Flight, d.IdealContactT) * 1000.0,
                Bowler = BowlerSpec(d, end),
                Striker = new StageActorSpec
                {
                    Start = 0,
                    End = end,
                    Release = release,
                    Swing = swingStartT.HasValue ? release + swingStartT.Value * 1000.0 : (double?)null,
                    Contact = contactMs,
                    TaskEnd = contactMs ?? passMs + TaskPassMs,
                    OutcomeAt = release + outcomeT * 1000.0,
                    Outcome = outcome,
                    Dead = release + dead * 1000.0,
                    StrokeEnd = strokeEndMs,
                    Runs = runEvents,
                },
            };
        }

        /// <summary>
        /// How the crowd reads the outcome (emotion.ts outcomeOf): "wicket", "six", "four", "close_call" (a miss, an edge, a shout, a leave that
        /// came close), "runs", "leave" or "dot". <paramref name="closeness"/>: how close an unhit ball came to the stumps (0 far .. 1 grazing).
        /// </summary>
        public static string OutcomeCategory(string dismissal, int boundaryRuns, string contactKind, double closeness, int runs, bool leave)
        {
            if (!string.IsNullOrEmpty(dismissal)) return "wicket";
            if (boundaryRuns == 6) return "six";
            if (boundaryRuns == 4) return "four";
            bool edged = contactKind == "inside_edge" || contactKind == "outside_edge" || contactKind == "top_edge" || contactKind == "leading_edge";
            // a pad or body strike the umpire did not give is a shout
            bool shout = contactKind == "pad" || contactKind == "body";
            bool isLeave = leave || contactKind == "leave";
            if (contactKind == "miss" || edged || shout || (isLeave && closeness > 0.4)) return "close_call";
            if (runs > 0) return "runs";
            return isLeave ? "leave" : "dot";
        }

        /// <summary>How close an unhit ball came to the stumps (emotion.ts stumpsCloseness): the flight at the stumps plane against the wicket.</summary>
        public static double StumpsCloseness(BallTraceSample[] flight, double stumpsT)
        {
            if (flight == null || flight.Length == 0) return 0;
            ProductionBatterBodyModel.Point p = ProductionBatterBodyModel.SampleAt(flight, stumpsT);
            double dx = Math.Max(0, Math.Abs(p.X) - 0.1143);
            double dy = Math.Max(0, p.Y - 0.711);
            double d = Math.Sqrt(dx * dx + dy * dy);
            double c = 1 - d / 0.22;
            return c < 0 ? 0 : c > 1 ? 1 : c;
        }

        /// <summary>The scene between balls: it loops, its plans fade in while it shows; there is no delivery.</summary>
        public static StageSpec Idle(string bowlerLook, string strikerLook)
        {
            return new StageSpec
            {
                Seed = null,
                BowlerLook = bowlerLook,
                StrikerLook = strikerLook,
                Bowler = new StageActorSpec { Start = 0, End = DirectorStageRuntime.IdleLoopMs },
                Striker = new StageActorSpec { Start = 0, End = DirectorStageRuntime.IdleLoopMs },
            };
        }
    }
}
