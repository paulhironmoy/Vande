using System;
using Vande.Practice.MotionPacks;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Motion
{
    /// <summary>What the host decided on the deciding ball of a Target Chase (bridge contract v7, `chase.outcome`).</summary>
    public enum ResultMomentOutcome
    {
        /// <summary>No chase, or a chase still in progress: no result moment is played.</summary>
        None,
        /// <summary>The winning run: a boundary or the last run.</summary>
        Won,
        /// <summary>Bowled, caught or lbw on the deciding ball.</summary>
        LostWicket,
        /// <summary>The last ball bowled and the target not reached.</summary>
        LostBalls
    }

    /// <summary>
    /// The Target Chase result moments (UNI-07; the web's src/render3d/practice/resultMoments.ts, MOTION-SPEC section 11, pack
    /// `result_moments`): what the striker and the bowler do after the physics has decided the deciding ball.
    /// <para>
    ///   won          striker `bat_celebrate_win` (the winning run), bowler `bowl_disappointed`<br/>
    ///   lost_wicket  striker `bat_walk_off`, bowler `bowl_celebrate_defend`<br/>
    ///   lost_balls   the same as lost_wicket (the last ball bowled, the target not reached)
    /// </para>
    /// Honesty (MOTION-SPEC section 6, SYS1/FAIR5/CTL8): nothing here starts before the physics event that earns it (the last run, the
    /// boundary, the dismissal or the dead ball, plus a reaction latency) or before the actor's own move has ended (his stroke, his run's
    /// pull-up, the follow-through); it moves no ball, bat, fielder or result. Everything in this class is a pure function of the
    /// trace and the host's verdict, so a replay of the deciding ball draws the same moment as the live ball. No UnityEngine here
    /// (the scheduling is checked in a plain .NET harness as well as in the Editor).
    /// </summary>
    public static class ProductionResultMoments
    {
        /// <summary>The Resources/Motion pack the four clips are shipped in.</summary>
        public const string Pack = "result_moments";

        public const string StrikerWon = "bat_celebrate_win";
        public const string StrikerLost = "bat_walk_off";
        public const string BowlerDefended = "bowl_celebrate_defend";
        public const string BowlerBeaten = "bowl_disappointed";

        /// <summary>
        /// Reaction latencies after the deciding physics event (s): a person sees it first, and a reaction never starts sooner than
        /// 180 ms after the outcome (the Director's honesty rule). The clips open with their own short register beat, so these are the
        /// least that reads as watching it happen (resultMoments.ts MOMENT_LATENCY_MS).
        /// </summary>
        public const double WonBoundaryLatency = 0.20;
        public const double WonRunsLatency = 0.30;
        public const double WonBowlerLatency = 0.45;
        public const double LostWicketStrikerLatency = 0.25;
        public const double LostWicketBowlerLatency = 0.40;
        public const double LostBallsStrikerLatency = 0.40;
        public const double LostBallsBowlerLatency = 0.60;

        /// <summary>An lbw is decided this long after the dead ball (the umpire's finger; resultMoments.ts momentEventT).</summary>
        public const double LbwDecisionSeconds = 0.40;

        /// <summary>The inertial hand-over from whatever the actor was doing into the clip (s; the web's `inertial: 260`).</summary>
        public const double HandOverSeconds = 0.26;

        /// <summary>
        /// The hand-over into Reduced Motion's held marker frame (s): a still frame is eased into a little slower than a clip is, so the
        /// largest step of any bone in one frame stays well under the pop floors (the web's 260 ms ease into the held peak was the one open pop).
        /// </summary>
        public const double ReducedHandOverSeconds = 0.40;

        /// <summary>
        /// A runner's pull-up after the last run is completed (s): the gait presenter lets its speed go at 9 m/s^2 from the 7.5 m/s top
        /// speed, so he is still visibly slowing for about this long. It is part of his own business; the clip waits for it.
        /// </summary>
        public const double RunPullUpSeconds = 0.8;

        /// <summary>The longest a hand-over is lengthened to when a bone has far to turn (s).</summary>
        public const double MaxHandOverSeconds = 1.0;

        /// <summary>
        /// The pop floor of each VC17 joint (degrees in one 60 Hz frame; MOTION-SPEC section 9: the smaller of 25 and the bone's cap a frame; VC17 order: hips, spine, chest,
        /// neck, head, left arm (upper, fore, hand), right arm, left leg (thigh, shin, foot), right leg).
        /// </summary>
        private static readonly double[] PopFloorDegreesByJoint = { 10, 10, 10, 12, 12, 25, 25, 25, 25, 25, 25, 20, 20, 20, 20, 20, 20 };

        public static double PopFloorDegrees(int joint) => joint >= 0 && joint < PopFloorDegreesByJoint.Length ? PopFloorDegreesByJoint[joint] : 10.0;

        /// <summary>The steepest step of HandOverWeight in one 60 Hz frame at the 260 ms hand-over (the weight's step scales with 1 / duration).</summary>
        public const double SteepestWeightStepAt260 = 0.1355;

        /// <summary>
        /// How long a hand-over must be so that a bone `angleDegrees` from where the clip wants it never steps more than 80% of its pop floor in a frame:
        /// angle x steepest step x (0.26 / T) <= 0.8 x floor. A bone that has little to turn needs less than the usual 260 ms (the caller takes the larger).
        /// </summary>
        public static double HandOverSecondsFor(double angleDegrees, double floorDegreesPerFrame)
        {
            if (!(angleDegrees > 0.0) || !(floorDegreesPerFrame > 0.0)) return 0.0;
            return Math.Min(MaxHandOverSeconds, angleDegrees * SteepestWeightStepAt260 * HandOverSeconds / (0.8 * floorDegreesPerFrame));
        }

        /// <summary>The walk-off turns the striker to his stance heading over this long (s; resultMoments.ts turnMs = 900).</summary>
        public const double WalkOffTurnSeconds = 0.9;

        /// <summary>The clip a striker plays for an outcome (null: none).</summary>
        public static string StrikerClipId(ResultMomentOutcome outcome)
        {
            switch (outcome)
            {
                case ResultMomentOutcome.Won: return StrikerWon;
                case ResultMomentOutcome.LostWicket:
                case ResultMomentOutcome.LostBalls: return StrikerLost;
                default: return null;
            }
        }

        /// <summary>The clip the bowler plays for an outcome (null: none).</summary>
        public static string BowlerClipId(ResultMomentOutcome outcome)
        {
            switch (outcome)
            {
                case ResultMomentOutcome.Won: return BowlerBeaten;
                case ResultMomentOutcome.LostWicket:
                case ResultMomentOutcome.LostBalls: return BowlerDefended;
                default: return null;
            }
        }

        /// <summary>The marker frame Reduced Motion holds in place of a clip (MOTION-SPEC section 6): the peak or the slump.</summary>
        public static string ReducedMarker(string clipId)
        {
            switch (clipId)
            {
                case StrikerWon:
                case BowlerDefended: return "peak";
                case StrikerLost:
                case BowlerBeaten: return "slump";
                default: return null;
            }
        }

        /// <summary>Whether a clip holds the bat in the bottom hand only (the striker's two clips; the web's ONE_HAND_BAT_CLIPS).</summary>
        public static bool HoldsBatInOneHand(string clipId) => clipId == StrikerWon || clipId == StrikerLost;

        /// <summary>The striker's reaction latency (s) after the event.</summary>
        public static double StrikerLatency(ResultMomentOutcome outcome, bool boundary)
        {
            switch (outcome)
            {
                case ResultMomentOutcome.Won: return boundary ? WonBoundaryLatency : WonRunsLatency;
                case ResultMomentOutcome.LostWicket: return LostWicketStrikerLatency;
                case ResultMomentOutcome.LostBalls: return LostBallsStrikerLatency;
                default: return double.PositiveInfinity;
            }
        }

        /// <summary>The bowler's reaction latency (s) after the event.</summary>
        public static double BowlerLatency(ResultMomentOutcome outcome)
        {
            switch (outcome)
            {
                case ResultMomentOutcome.Won: return WonBowlerLatency;
                case ResultMomentOutcome.LostWicket: return LostWicketBowlerLatency;
                case ResultMomentOutcome.LostBalls: return LostBallsBowlerLatency;
                default: return double.PositiveInfinity;
            }
        }

        /// <summary>The dead ball's time (s after the release): the trace's `dead` event, else its duration (deadT).</summary>
        public static double DeadTime(CanonicalDeliveryTrace trace)
        {
            if (trace == null) return 0.0;
            if (trace.events != null)
                for (var index = trace.events.Length - 1; index >= 0; index--)
                    if (trace.events[index] != null && trace.events[index].kind == "dead") return trace.events[index].t;
            return trace.durationSeconds;
        }

        /// <summary>
        /// The physics instant that decides the moment (s after the release): the last run, the boundary, the dismissal or the dead
        /// ball (resultMoments.ts momentEventT, line for line). `boundary` is true only for a win by a boundary.
        /// </summary>
        public static double EventTime(ResultMomentOutcome outcome, string dismissal, CanonicalDeliveryTrace trace, out bool boundary)
        {
            boundary = false;
            if (trace == null || outcome == ResultMomentOutcome.None) return 0.0;
            var dead = DeadTime(trace);
            double? lastRun = null, boundaryT = null, stumps = null, caught = null, keeperTake = null;
            var events = trace.events ?? new CanonicalTraceEvent[0];
            for (var index = 0; index < events.Length; index++)
            {
                var item = events[index];
                if (item == null) continue;
                switch (item.kind)
                {
                    case "run":
                        if (!lastRun.HasValue || item.t > lastRun.Value) lastRun = item.t;
                        break;
                    case "boundary":
                        if (!boundaryT.HasValue) boundaryT = item.t;
                        break;
                    case "stumps":
                        if (!stumps.HasValue) stumps = item.t;
                        break;
                    case "catch":
                        if (!caught.HasValue) caught = item.t;
                        break;
                    case "keeper_take":
                        if (!keeperTake.HasValue) keeperTake = item.t;
                        break;
                }
            }

            if (outcome == ResultMomentOutcome.LostWicket)
            {
                if (dismissal == "bowled") return stumps ?? dead;
                if (dismissal == "lbw") return dead + LbwDecisionSeconds;
                return caught ?? keeperTake ?? dead;
            }

            if (outcome == ResultMomentOutcome.Won)
            {
                if (lastRun.HasValue) return lastRun.Value;
                if (boundaryT.HasValue)
                {
                    boundary = true;
                    return boundaryT.Value;
                }

                return dead;
            }

            // lost_balls: not out; the last ball's runs (if any) are done and the ball is dead.
            return Math.Max(dead, lastRun ?? 0.0);
        }

        /// <summary>
        /// When the striker's clip starts (s after the release): not before the event plus his latency, not before his own business is
        /// over (`ownEnd`: his stroke and follow-through, or his last run and its pull-up), and not before `notBefore` (a result that
        /// arrives late starts it from the moment it arrives, never in the past).
        /// </summary>
        public static double StrikerStart(ResultMomentOutcome outcome, bool boundary, double eventT, double ownEnd, double notBefore) =>
            Math.Max(Math.Max(ownEnd, eventT + StrikerLatency(outcome, boundary)), notBefore);

        /// <summary>
        /// When the bowler's clip starts: not before the event plus his latency, not before his follow-through is over (`ownEnd`, seconds
        /// after the release), and not before `notBefore`.
        /// </summary>
        public static double BowlerStart(ResultMomentOutcome outcome, double eventT, double ownEnd, double notBefore) =>
            Math.Max(Math.Max(ownEnd, eventT + BowlerLatency(outcome)), notBefore);

        /// <summary>
        /// The critically damped weight of an inertial hand-over `elapsed` seconds in (0 = the actor as he was, 1 = the clip): w = 1 - (1 + x)
        /// e^-x with x = 5.8 elapsed / duration (98% at the duration, then exactly 1), as the striker's and the non-striker's hand-overs.
        /// </summary>
        public static float HandOverWeight(double elapsed, double duration)
        {
            if (!(duration > 0.0) || elapsed >= duration) return 1f;
            if (elapsed <= 0.0) return 0f;
            var x = 5.8 * elapsed / duration;
            return (float)(1.0 - (1.0 + x) * Math.Exp(-x));
        }

        /// <summary>
        /// The clip time to sample (s) `playedFor` seconds after the clip began: the clip's own time held on its last frame, or, with Reduced
        /// Motion, its marker frame held (`peak` or `slump`, MOTION-SPEC section 6) over the same window.
        /// </summary>
        public static double SampleTime(VmpClip clip, double playedFor, bool reducedMotion, string marker)
        {
            if (clip == null) return 0.0;
            if (reducedMotion)
            {
                float at;
                if (marker != null && clip.TryGetMarker(marker, out at)) return at;
            }

            return Math.Min(Math.Max(0.0, playedFor), clip.Duration);
        }

        /// <summary>
        /// The heading the walk-off shows `elapsed` seconds in: from the heading he was standing in to his stance heading (his off side)
        /// over WalkOffTurnSeconds, smooth at both ends (the web turns him while he stands; usually he is side-on already).
        /// </summary>
        public static float WalkOffYaw(float fromDegrees, float stanceDegrees, double elapsed)
        {
            var u = (float)Math.Min(1.0, Math.Max(0.0, elapsed / WalkOffTurnSeconds));
            u = u * u * (3f - 2f * u);
            var delta = (stanceDegrees - fromDegrees) % 360f;
            if (delta > 180f) delta -= 360f;
            if (delta < -180f) delta += 360f;
            return fromDegrees + delta * u;
        }
    }
}
