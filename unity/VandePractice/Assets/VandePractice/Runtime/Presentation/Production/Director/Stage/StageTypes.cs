using System;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// Why a script was built (the web's session.ts ScriptKind, the four the Unity world has): what the runtime does at once
    /// and what it leaves to spare time. A replay is a result accepted with no delivery awaiting it; a demonstration is a
    /// delivery whose result is accepted as a replay (it is registered as Live and then Result, like a player's ball).
    /// </summary>
    public enum StageKind
    {
        /// <summary>The scene between balls: it loops, its plans are baked in spare slices while it is shown.</summary>
        Idle = 0,
        /// <summary>A delivery before its result: the bowler's and the striker's plans from the anchors the live ball has.</summary>
        Live = 1,
        /// <summary>The result of a live delivery: the live plans stand in while the result's are baked with reuse.</summary>
        Result = 2,
        /// <summary>A result played with no live delivery before it: baked in spare slices, served while baked.</summary>
        Replay = 3,
    }

    /// <summary>A point in the physics frame (metres): x across the pitch, y up, z down the pitch from the bowler's end to the striker's.</summary>
    public struct StageVec
    {
        public double X;
        public double Y;
        public double Z;

        public StageVec(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }
    }

    /// <summary>The ball as a script draws it at a scene time.</summary>
    public struct StageBall
    {
        public StageVec Pos;
        /// <summary>0: in the air (or on the ground); 1: held in the bowler's (generic) hand. A change of holder or of kind is not one motion.</summary>
        public int Holder;
    }

    /// <summary>
    /// What the Director asks of a script's geometry while it bakes (all in the physics frame, scene ms, pure functions of the
    /// scene time; none may allocate). The binding implements it from the world's own run-up and ball tracks, as DRAWN.
    /// </summary>
    public interface IStageGeometry
    {
        /// <summary>The striker's eye in the stance, whatever the result's planted offset: what the bowler looks at.</summary>
        StageVec StrikerEye();

        /// <summary>The bowler's eye (head) as the script draws him at scene time <paramref name="sceneMs"/>.</summary>
        StageVec BowlerEye(double sceneMs);

        /// <summary>
        /// The bowling hand as a generic action that rises over the 650 ms before <paramref name="releaseMs"/>: the same for every
        /// ball, never the true release point.
        /// </summary>
        StageVec BowlerHand(double sceneMs, double releaseMs);

        /// <summary>The ball as the script draws it at <paramref name="sceneMs"/> (in the generic hand before the release); false while it is not drawn.</summary>
        bool Ball(double sceneMs, out StageBall ball);
    }

    /// <summary>
    /// What the Director needs to know about one actor's script (script.ts DirectorActorSpec; scene ms, null = does not exist or
    /// is not known yet). Plain data: the plan is baked from it outside the frame that builds the script.
    /// </summary>
    public sealed class StageActorSpec
    {
        public double Start;
        public double End;
        public double? RunStart;
        public double? Gather;
        public double? Release;
        public double? FollowEnd;
        public double? Swing;
        public double? Contact;
        public double? TaskEnd;
        public double? OutcomeAt;
        /// <summary>"six", "four", "runs", "dot", "leave", "close_call", "wicket" or null.</summary>
        public string Outcome;
        public double? Dead;
        public double? StrokeEnd;
        public double Runs;

        public StageActorSpec Clone()
        {
            return (StageActorSpec)MemberwiseClone();
        }
    }

    /// <summary>The Director's anchors for both actors of a script (script.ts DirectorSpec). They never depend on the result before it is known.</summary>
    public sealed class StageSpec
    {
        /// <summary>The ball's seed (the delivery record's): the key of the delivery, the same live and in every replay; null between balls.</summary>
        public string Seed;
        /// <summary>The look seeds of the two actors (the person traits are constant for the over).</summary>
        public string BowlerLook;
        public string StrikerLook;
        /// <summary>When the flight the script draws before the result ends (the ball holds still there), scene ms.</summary>
        public double? FlightEnd;
        public StageActorSpec Bowler;
        public StageActorSpec Striker;
    }

    /// <summary>
    /// The seam between two scripts (face.ts Seam): a delivery begins as a hard cut from the scene before it. The head pass
    /// continues from the head that scene ended with and lets the difference go over the script's first <see cref="DirectorStageRuntime.SeamHeadMs"/>.
    /// </summary>
    public sealed class StageSeam
    {
        public bool Pending;
        /// <summary>The head as drawn on the last frame of the scene before (yaw + left, pitch + down, roll + right, degrees; physics role frame).</summary>
        public double H0Yaw;
        public double H0Pitch;
        public double H0Roll;
        /// <summary>The offset: h0 minus the head of the first frame.</summary>
        public double OYaw;
        public double OPitch;
        public double ORoll;
        /// <summary>The share of the offset still applied (1 at the first frame, 0 from SeamHeadMs).</summary>
        public double K;
        /// <summary>The script time of the first frame, ms.</summary>
        public double T0;
        /// <summary>
        /// The life the scene before ended with (breath deg, sway X mm, sway Z mm, hip roll deg, posture deg, twist deg: what the rig was given on its
        /// last frame), given back over the same seam by the share <see cref="K"/>. Only where the new script has no quiet window to keep exactly
        /// zero (<see cref="LifeOn"/>): the scene between balls, and the striker of a delivery (whose quiet window begins long after the seam ends).
        /// </summary>
        public readonly float[] Life0 = new float[6];
        public bool LifeOn;
    }

    /// <summary>The life each role was last given (see <see cref="StageSeam.Life0"/>): what the next script's first frames continue from.</summary>
    public sealed class StageDrawnLife
    {
        public bool Ok;
        public readonly float[] V = new float[6];
    }

    /// <summary>The head each role was last drawn with by the head pass (physics role frame, degrees): what the next script's first frames continue from.</summary>
    public sealed class StageDrawnHead
    {
        public bool Ok;
        public double Yaw;
        public double Pitch;
        public double Roll;
    }

    /// <summary>
    /// What one actor's frame hands to the rig (face.ts FRAME.head): the channels the plan was sampled into, the fade, whether the
    /// neck and head brake on arrival and the seam. Reused every frame (no allocation).
    /// </summary>
    public sealed class DirectedFrame
    {
        /// <summary>A plan (or only a seam) is on this frame: the life pass and the head pass have something to do.</summary>
        public bool On;
        /// <summary>The channels are valid (a plan was sampled); false with a seam only (a delivery's first frames, before its plans are baked).</summary>
        public bool HasChannels;
        /// <summary>The runtime's own cache of the channels (24 floats); valid until the next frame of this role.</summary>
        public float[] Ch;
        /// <summary>The plan's Reduced Motion setting.</summary>
        public bool Reduced;
        /// <summary>The weight of the passes (0..1): the fade in from the clip.</summary>
        public double W;
        public DirectorRole Role;
        /// <summary>The striker's neck and head always brake on arrival; the bowler's only after the release.</summary>
        public bool Brake;
        public StageSeam Seam;

        public void Clear()
        {
            On = false;
            HasChannels = false;
            Ch = null;
            Reduced = false;
            W = 0;
            Brake = false;
            Seam = null;
        }
    }

    /// <summary>Counters for the tests and the probes (stage/runtime.ts stats).</summary>
    public sealed class StageStats
    {
        public int SyncBakes;
        public int Jobs;
        public int Swaps;
        public int Forced;
        public int ForcedSlices;
        public int ForcedMax;
        public int Slices;
    }
}
