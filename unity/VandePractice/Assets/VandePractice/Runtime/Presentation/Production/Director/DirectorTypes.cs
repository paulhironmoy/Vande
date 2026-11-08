using System;

namespace Vande.Practice.Presentation.Production.Director
{
    /// <summary>The fixed-meaning targets an actor can look at (the ball and the ground are handled by the Director itself).</summary>
    public enum DirectorAim
    {
        /// <summary>The opponent's eye: the bowler looks at the batter's stance eye, the batter at the bowler's head as drawn at t.</summary>
        Opponent = 0,
        /// <summary>The bowling hand (batter only), as a generic action that rises over the last 650 ms before the release; never the true release point.</summary>
        Hand = 1,
    }

    /// <summary>What the head channels hold.</summary>
    public enum DirectorHeadMode
    {
        /// <summary>Degrees to add to <see cref="IDirectorWorld.ClipHead"/> (tests only; the web's P1 mode).</summary>
        Overlay = 0,
        /// <summary>The head in space itself and the raw gaze; ClipHead is never called. What the stage uses.</summary>
        Space = 1,
    }

    /// <summary>
    /// What the Director asks of the world while it bakes a plan. Called from the bake only, off the frame path, at most once per
    /// 1/240 s of script. Every call writes into <c>output</c> and must not allocate. Directions are degrees in the actor's
    /// (pre-mirror) role frame: output[0] = yaw (+ left), output[1] = pitch (+ down). Honesty (H1 to H7): nothing here may read
    /// the plan, the speed, length, line or result of the ball before it is visible.
    /// </summary>
    public interface IDirectorWorld
    {
        /// <summary>The direction from the actor's eye to the opponent's eye or to the bowling hand at scene time <c>tMs</c>; false if unknown.</summary>
        bool Aim(DirectorAim target, double tMs, double[] output);

        /// <summary>
        /// The direction from the actor's eye (at <c>tMs + aheadMs</c>) to the ball as the script draws it at <c>tMs</c> (in the
        /// generic bowling hand before the release); false while it is not drawn. With <c>aheadMs</c> above 0 the ball's position
        /// is carried on at the constant velocity it had at <c>tMs</c>, measured from the ball as drawn at <c>tMs</c> and 10 ms
        /// earlier (nothing later than <c>tMs</c>), with no extrapolation across a change of holder or of kind. No ground clamp,
        /// no use of the plan, the bounce or the result.
        /// </summary>
        bool VisibleBall(double tMs, double[] output, double aheadMs);

        /// <summary>The clip's own head: output[0] = yaw, output[1] = pitch of its line of sight, output[2] = roll about it. Only called in <see cref="DirectorHeadMode.Overlay"/> mode.</summary>
        void ClipHead(double tMs, double[] output);
    }

    /// <summary>
    /// Everything the Director needs to know about one actor in one script (types.ts DirectorAnchors). Times are scene ms (the
    /// script clock, never the wall clock); a null time means the thing does not exist or is not known yet: a live pre-result
    /// script has no contact, outcome or dead time, and the plan built from it agrees with the plan built later up to the first
    /// time one of them matters.
    /// </summary>
    public sealed class DirectorAnchors
    {
        public DirectorRole Role;
        /// <summary>The actor's look seed: the person traits (breath rate, blink rate, sway size) are constant for the over.</summary>
        public string Person;
        /// <summary><see cref="DirectorSeeds.DeliveryTakeKey"/> of the delivery, or an idle key between balls: draws are identical on replay.</summary>
        public string Key;
        /// <summary>The trace covers [Start, End] (scene ms).</summary>
        public double Start;
        public double End;
        /// <summary>The bowler's delivery-stride start (before the back foot lands). Unused by the striker.</summary>
        public double? Gather;
        /// <summary>The ball leaves the hand. Null: between balls (no delivery, no task window).</summary>
        public double? Release;
        /// <summary>The striker's own swing input (his own action, not an outcome). Not read by the plan or the bake.</summary>
        public double? Swing;
        /// <summary>Bat, pad or body contact.</summary>
        public double? Contact;
        /// <summary>The striker's visual task ends: contact, or the ball passing. Null: contact, else release + 1100 ms.</summary>
        public double? TaskEnd;
        /// <summary>The physics has confirmed the outcome. Reactions start no sooner than +180 ms.</summary>
        public double? OutcomeAt;
        /// <summary>Dead ball.</summary>
        public double? Dead;
        /// <summary>The striker's stroke or leave ends (his body life resumes 800 ms later). Null: not known, life stays off.</summary>
        public double? StrokeEnd;
        /// <summary>Runs completed by this ball (exertion after the outcome).</summary>
        public double Runs;
        /// <summary>How the crowd reads the outcome once the physics has confirmed it: "six", "four", "runs", "dot", "leave", "close_call", "wicket". Null or empty: no reaction.</summary>
        public string Outcome;
        /// <summary>The bowler's run-up starts: his life channels are off from here to release + 150 ms. Null: off from the gather only.</summary>
        public double? RunStart;
        /// <summary>The bowler's follow-through ends and his walk back begins: his eyes go back to the idle dwell. Null: they hold the ground look.</summary>
        public double? FollowEnd;
        /// <summary>The script loops (a between-balls scene): the last SeamMs of it fade into the SeamMs before Start (so Start is -SeamMs). No blink falls across the seam. Null: not a loop.</summary>
        public double? SeamMs;
        public DirectorHeadMode HeadMode;
        public bool ReducedMotion;
        /// <summary>The actor's head height on screen (CSS px) at the start; sets the default detail level.</summary>
        public double HeadPx;
        /// <summary>The world that answers the three questions above.</summary>
        public IDirectorWorld World;

        /// <summary>A shallow copy (the world is shared): for a variation of the same script.</summary>
        public DirectorAnchors Clone()
        {
            return (DirectorAnchors)MemberwiseClone();
        }
    }

    /// <summary>
    /// What a plan holds besides the trace: the events and the few draws, all a function of the key and the anchors (types.ts
    /// DirectorEvents). Float32 arrays, as the web's Float32Array: the trace is baked from these rounded values.
    /// </summary>
    public class DirectorEvents
    {
        /// <summary>Gaze fixations, <see cref="DirectorPlanBuilder.FixN"/> floats each: [t0 ms, target, mode (0 saccade, 1 pursuit), lag ms (yaw offset for a side glance, downward angle for the ground), blink-with-shift flag].</summary>
        public float[] Fix;
        /// <summary>Blinks, 6 floats each: [t0 ms, close ms, hold ms, open ms, depth, left-right skew ms].</summary>
        public float[] Blink;
        /// <summary>Microsaccades, 3 floats each: [t0 ms, dx deg, dy deg].</summary>
        public float[] Micro;
        /// <summary>Fidgets, 8 floats each: [t0 ms, kind, duration ms, a, b, c, direction, spare].</summary>
        public float[] Fidget;
        /// <summary>The reaction to the outcome: none (length 0) or one event of 12 floats: [t0 ms, valence, strength, rise ms, hold ms, decay ms, shake deg, shake Hz, head pitch deg, exhale, relief weight, concentration weight].</summary>
        public float[] React;
        /// <summary>Per-ball draws (see <see cref="DirectorDraw"/>).</summary>
        public float[] Draw;
        /// <summary>Person amplitudes (see <see cref="DirectorAmp"/>).</summary>
        public float[] Amp;
    }

    /// <summary>A baked plan: the events, and the 24-channel Int16 trace at <see cref="Hz"/> frames per second. Data only.</summary>
    public sealed class DirectorPlan : DirectorEvents
    {
        public DirectorRole Role;
        /// <summary>The ball's key (person and delivery).</summary>
        public uint Key;
        /// <summary>Baked in: switching Reduced Motion needs a new plan.</summary>
        public bool ReducedMotion;
        /// <summary>Time of frame 0 (scene ms).</summary>
        public double T0;
        public int Hz;
        /// <summary>Frame count of <see cref="Trace"/>.</summary>
        public int N;
        /// <summary><see cref="DirectorChannels.Count"/> Int16 values per frame.</summary>
        public short[] Trace;
        /// <summary>0 head and life only, 1 plus eyes and lids, 2 plus expressions (by the head's size on screen).</summary>
        public int Detail;
    }
}
