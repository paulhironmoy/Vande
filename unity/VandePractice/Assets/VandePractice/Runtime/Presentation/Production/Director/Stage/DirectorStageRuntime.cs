using System;
using System.Collections.Generic;
using System.Diagnostics;
using P = Vande.Practice.Presentation.Production.Director.DirectorParams;

namespace Vande.Practice.Presentation.Production.Director.Stage
{
    /// <summary>
    /// The Director's stage binding for Unity (a port of stage/runtime.ts, contract director/3): one runtime per Practice world. It
    /// turns a script's anchors (<see cref="StageSpec"/>, plain data) into the two actors' plans, keeps the baking off the frame path,
    /// and per drawn frame hands the rig the channels of the plan (<see cref="Frame"/>): the life pass (breath, sway, hip roll,
    /// posture, twist) and the head pass (the head in space) are applied by the rig from them.
    /// <para>
    /// When a plan is baked:
    /// a delivery (<see cref="StageKind.Live"/>): NOTHING in the call that registers it. Both plans are baked in the first spare slices
    /// of the run-up (the head fades in from the clip over the script's first 400 ms, so a late plan is no pop).
    /// its result (<see cref="StageKind.Result"/>): NOTHING in the call that registers it. The live plans keep drawing; the result's are
    /// baked in the spare slices after it from the same anchors, copying the live trace up to the first moment the result matters
    /// (reuse), and swapped in before that moment (a frame that reaches it first bakes the slices it needs and serves the plan while
    /// it is baked).
    /// the scene between balls (<see cref="StageKind.Idle"/>) and a replay: in slices, served while baked.
    /// A Reduced Motion change rebakes what is on screen the same way.
    /// </para>
    /// Pure in (script, scene time): the draw of a frame depends on nothing but the plan, so a replay of the same result draws what the
    /// live frame drew. No clock but the one a budgeted <see cref="Work"/> call is given, no random source, no frame count.
    /// </summary>
    public sealed class DirectorStageRuntime
    {
        /// <summary>The script's loop (a scene between balls): the last SeamMs are cross-faded into the SeamMs before its start.</summary>
        public const double SeamMs = 600;

        /// <summary>A plan that appears while a scene is already showing (a rebake) takes over over this long.</summary>
        public const double FadeMs = 500;

        /// <summary>A delivery's script cuts in from the scene before it: the Director's head takes over from the clip over its first 400 ms.</summary>
        public const double StartFadeMs = 400;

        /// <summary>The seam of a delivery after another scene is given back over this long (face.ts SEAM.ms).</summary>
        public const double SeamHeadMs = 400;

        /// <summary>The bowler's neck and head brake only this long after the release (face.ts BRAKE.bowlerAfterMs).</summary>
        public const double BrakeBowlerAfterMs = 150;

        /// <summary>The unhit ball stops differing from the hit one this long after the first moment they can (the shortest pursuit lag).</summary>
        public const double BallLagMs = 125;

        /// <summary>A delivery's plans must be in by this scene time; before that they are baked in the spare time of the frames.</summary>
        public const double LiveDeadlineMs = 700;

        /// <summary>A plan with a deadline is served from its deadline on while it is still being baked: a frame asks only for the trace up to this far ahead.</summary>
        public const double LookaheadMs = 100;

        /// <summary>The spare time bakes a plan with a deadline this far past it before it finishes any plan.</summary>
        public const double AheadMs = 300;

        /// <summary>A live plan is copied at most to this long before its end (its last blink may be cut by the end).</summary>
        public const double EndMarginMs = 1500;

        /// <summary>The length of the scene between balls (ms): it goes round every minute, each lap a plan of its own.</summary>
        public const double IdleLoopMs = 60000;

        private enum Mode
        {
            All,
            Urgent,
            Rest,
        }

        internal sealed class PendingBake
        {
            public DirectorRole Role;
            /// <summary>Makes the job on its first spare slice (the events of a plan are built there, not in the call that asked for it).</summary>
            public Func<PlanJob> Make;
            public PlanJob Job;
            /// <summary>The first scene time the old plan no longer holds for: the bake must be swapped in by then.</summary>
            public double Deadline;
            /// <summary>The plan replaces one the scene was already showing in another setting: it takes over over FadeMs.</summary>
            public bool FadeIn;
            /// <summary>The plan is in the entry and serving while it is still being baked (a deadline passed).</summary>
            public bool Serving;
            /// <summary>The job bakes the next lap of a scene between balls, not the plan the entry draws with.</summary>
            public bool Next;
        }

        internal sealed class Cache
        {
            public DirectorPlan Plan;
            public double T = double.NaN;
            public int Detail;
            public readonly float[] Out = new float[DirectorChannels.Count];
        }

        /// <summary>One script (the web's Entry): its plans, its pending bakes, its fade, its seam and its laps.</summary>
        public sealed class Script
        {
            internal StageSpec Spec;
            internal StageKind Kind;
            internal IStageGeometry Geometry;
            internal string Key;
            internal bool Rm;
            internal readonly DirectorPlan[] Plans = new DirectorPlan[2];
            internal readonly List<PendingBake> Pending = new List<PendingBake>(4);
            internal bool Fade;
            internal double Fade0 = double.NaN;
            internal bool Loop;
            internal readonly StageSeam[] Seam = new StageSeam[2];
            internal readonly bool[] SeamSet = new bool[2];
            internal readonly int[] Lap = new int[2];
            internal readonly DirectorPlan[] Next = new DirectorPlan[2];
            internal readonly bool[] NextQueued = new bool[2];
            internal readonly double[] LastT = { double.NaN, double.NaN };
            internal bool Retired;
            /// <summary>The live script whose plans this result stands on until its own are baked (they may still be baking).</summary>
            internal Script StandIn;
            /// <summary>A scene between balls baked ahead while a delivery is still on screen (so that its plans are there when it is shown).</summary>
            internal bool Prefetch;
            internal readonly StageSeam[] SeamObjects = { new StageSeam(), new StageSeam() };

            public StageKind ScriptKind
            {
                get { return Kind; }
            }

            public string DeliveryKey
            {
                get { return Key; }
            }

            public StageSpec ScriptSpec
            {
                get { return Spec; }
            }

            public bool IsLoop
            {
                get { return Loop; }
            }

            public bool IsRetired
            {
                get { return Retired; }
            }
        }

        /// <summary>The switch: off, every frame is empty and the rigs keep their own motion (today's behaviour).</summary>
        public bool Enabled = true;

        /// <summary>Whether a delivery continues from the head of the scene before it (the seam). Off: a hard cut.</summary>
        public bool SeamOn = true;

        /// <summary>The detail level the channels are read at: 0 head and life only (the Unity cameras show no face; the lid, gaze and expression channels stay in the layout).</summary>
        public int Detail;

        public readonly StageStats Stats = new StageStats();

        private bool reducedMotion;
        private readonly List<Script> queue = new List<Script>(4);
        private readonly List<Script> active = new List<Script>(4);
        private int idleCount;
        private readonly Cache[] cache = { new Cache(), new Cache() };
        private readonly float[] scratch = new float[DirectorChannels.Count];
        private readonly Script[] lastEntry = new Script[2];
        private readonly StageDrawnHead[] drawn = { new StageDrawnHead(), new StageDrawnHead() };
        private readonly StageDrawnLife[] drawnLife = { new StageDrawnLife(), new StageDrawnLife() };
        private Func<double> clock;

        public DirectorStageRuntime()
        {
            // A budget is measured with the high-resolution timer; no allocation per call.
            clock = StopwatchMs;
        }

        private static readonly double StopwatchTickMs = 1000.0 / Stopwatch.Frequency;

        private static double StopwatchMs()
        {
            return Stopwatch.GetTimestamp() * StopwatchTickMs;
        }

        /// <summary>The time source of the budgeted work (ms); the default is the high-resolution timer. For the tests.</summary>
        public Func<double> Clock
        {
            get { return clock; }
            set { clock = value ?? StopwatchMs; }
        }

        public bool ReducedMotion
        {
            get { return reducedMotion; }
        }

        /// <summary>The world has given a role's rig this life for the frame (<see cref="DirectorLife"/>): what the next script's first frames continue from.</summary>
        public void NoteLife(DirectorRole role, DirectorLife life)
        {
            StageDrawnLife d = drawnLife[(int)role];
            d.Ok = true;
            d.V[0] = life.BreathDeg;
            d.V[1] = life.SwayXMetres * 1000f;
            d.V[2] = life.SwayZMetres * 1000f;
            d.V[3] = life.SwayRollDeg;
            d.V[4] = life.PostureDeg;
            d.V[5] = life.TwistDeg;
        }

        /// <summary>The head each role was last drawn with by the head pass: what a delivery's first frames continue from (the seam).</summary>
        public StageDrawnHead Drawn(DirectorRole role)
        {
            return drawn[(int)role];
        }

        // ---- building ---------------------------------------------------------------------------------------------------

        /// <summary>
        /// A script was built: queue its plans (see the top of the file). Never throws; null if the Director is off or the script has no
        /// spec. <paramref name="prev"/>: the live script a result takes over (its plans carry on while the result's are baked).
        /// </summary>
        public Script Register(StageSpec spec, StageKind kind, IStageGeometry geometry, Script prev, bool prefetch = false)
        {
            if (!Enabled || spec == null || geometry == null) return null;
            string look = spec.BowlerLook ?? string.Empty;
            string key = spec.Seed != null
                ? DirectorSeeds.DeliveryTakeKey(spec.Seed, null, null)
                : look + "|" + KindName(kind) + "." + (kind == StageKind.Idle ? ++idleCount : 0);
            var e = new Script { Spec = spec, Kind = kind, Geometry = geometry, Key = key, Rm = reducedMotion, Loop = kind == StageKind.Idle, Prefetch = prefetch };
            try
            {
                if (kind == StageKind.Idle)
                {
                    // A scene between balls: the plans arrive while it is showing, so they fade in; nothing is racing them.
                    e.Fade = true;
                    QueueBoth(e, e.Rm, false, double.PositiveInfinity);
                }
                else if (kind == StageKind.Live)
                {
                    // A delivery: registering builds nothing. The plans are baked in the first spare slices of the run-up (the head takes
                    // over from the clip over the script's first StartFadeMs, so they may arrive late without a pop); a frame that
                    // reaches LiveDeadlineMs first bakes the slices it needs.
                    QueueBoth(e, e.Rm, false, LiveDeadlineMs);
                    queue.Insert(0, e);
                }
                else if (kind == StageKind.Result && prev != null && TakeOver(e, prev))
                {
                    // the live plans carry on; the result's are baked in the spare time that follows
                }
                else
                {
                    // A replay (or a result with no live plans to carry on with): nothing is racing it, but nothing is baked in this
                    // call either. Its plans are served from their first frame while they are baked (a frame asks only for what it needs).
                    QueueBoth(e, e.Rm, false, Math.Min(spec.Bowler.Start, spec.Striker.Start));
                    queue.Insert(0, e);
                }
                // The scene on screen between balls and the delivery, replay or result on screen: what a Reduced Motion change rebakes.
                if (!prefetch) active.RemoveAll(x => (x.Kind == StageKind.Idle) != (kind == StageKind.Idle));
                active.Add(e);
            }
            catch
            {
                // The Director never breaks a delivery: this script is drawn as it always was.
                Retire(e);
                return null;
            }
            return e;
        }

        private static string KindName(StageKind kind)
        {
            switch (kind)
            {
                case StageKind.Idle: return "idle";
                case StageKind.Live: return "live";
                case StageKind.Result: return "result";
                default: return "replay";
            }
        }

        /// <summary>Drops a script (its bakes are abandoned): the world has moved on and its geometry no longer answers for it.</summary>
        public void Retire(Script e)
        {
            if (e == null) return;
            e.Retired = true;
            e.Pending.Clear();
            queue.Remove(e);
            active.Remove(e);
            for (int r = 0; r < 2; r++)
                if (lastEntry[r] == e)
                {
                    // The next script's seam continues from the head that was last drawn (kept per role); only the identity goes, and a
                    // delivery that follows must still find that another entry was drawn before it: a marker stands in.
                    lastEntry[r] = Marker;
                }
        }

        /// <summary>A stand-in for a retired script, so that the delivery which follows still finds that something was drawn before it.</summary>
        private static readonly Script Marker = new Script { Retired = true };

        /// <summary>Reduced Motion changed: what is on screen is baked again with the new setting.</summary>
        public void SetReducedMotion(bool on)
        {
            if (reducedMotion == on) return;
            reducedMotion = on;
            for (int i = 0; i < active.Count; i++)
            {
                Script e = active[i];
                if (e.Rm == on) continue;
                try
                {
                    // A plan serving while it is baked must be whole before the job that fills it is dropped.
                    for (int k = e.Pending.Count - 1; k >= 0; k--)
                    {
                        PendingBake p = e.Pending[k];
                        if (k < e.Pending.Count && p.Serving && !p.Next) Complete(e, p);
                    }
                    e.Pending.Clear();
                    // the next lap of a scene between balls was baked in the other setting: dropped, and baked again when the scene is read
                    e.Next[0] = e.Next[1] = null;
                    e.NextQueued[0] = e.NextQueued[1] = false;
                    queue.Remove(e);
                    // The plans in the other setting go on serving only if they are the quiet ones (see PlanOf); the new ones take over.
                    QueueBoth(e, on, true, double.PositiveInfinity);
                }
                catch
                {
                    e.Plans[0] = e.Plans[1] = null;
                }
            }
        }

        private DirectorAnchors Anchors(Script e, DirectorRole role, bool rm, string key)
        {
            StageSpec spec = e.Spec;
            StageActorSpec a = role == DirectorRole.Bowler ? spec.Bowler : spec.Striker;
            double? seam = e.Loop ? SeamMs : (double?)null;
            return new DirectorAnchors
            {
                Role = role,
                Person = role == DirectorRole.Bowler ? spec.BowlerLook : spec.StrikerLook,
                Key = key,
                Start = seam == null ? a.Start : -SeamMs,
                End = a.End,
                Gather = a.Gather,
                Release = a.Release,
                Swing = a.Swing,
                Contact = a.Contact,
                TaskEnd = a.TaskEnd,
                OutcomeAt = a.OutcomeAt,
                Outcome = a.Outcome,
                Dead = a.Dead,
                StrokeEnd = a.StrokeEnd,
                Runs = a.Runs,
                RunStart = a.RunStart,
                FollowEnd = a.FollowEnd,
                SeamMs = seam,
                HeadMode = DirectorHeadMode.Space,
                ReducedMotion = rm,
                HeadPx = 40,
                World = new StageDirectorWorld(e.Geometry, role, a.Release),
            };
        }

        /// <summary>Queues both plans to be baked in the spare time of frames (no reuse); each must be in by scene time <paramref name="deadline"/>.</summary>
        private void QueueBoth(Script e, bool rm, bool fadeIn, double deadline)
        {
            e.Rm = rm;
            for (int r = 0; r < 2; r++)
            {
                DirectorRole role = (DirectorRole)r;
                e.Pending.Add(new PendingBake
                {
                    Role = role,
                    Make = () => DirectorCore.StartPrepare(Anchors(e, role, rm, e.Key), 60),
                    Deadline = deadline,
                    FadeIn = fadeIn,
                });
                Stats.Jobs++;
            }
            if (!queue.Contains(e)) queue.Add(e);
        }

        private static double OrInfinity(double? x, double add)
        {
            return x.HasValue ? x.Value + add : double.PositiveInfinity;
        }

        /// <summary>
        /// The result's script takes over a delivery: its plans are the live ones until they are rebaked from the result's anchors in
        /// the spare time that follows (copying the live trace up to the first moment the result matters). False when the live script has
        /// no plans to carry on with.
        /// </summary>
        private bool TakeOver(Script e, Script live)
        {
            if (live == null || live.Plans[0] == null || live.Plans[1] == null || live.Rm != e.Rm) return false;
            e.Plans[0] = live.Plans[0];
            e.Plans[1] = live.Plans[1];
            e.StandIn = live;
            // The first scene time the live plans can differ from the result's: the contact, the outcome, the dead ball, the stroke's end,
            // the end of the ball the live script draws (it holds still there), each a pursuit lag later, and the live task window's end
            // (no blink falls in it).
            StageActorSpec s = e.Spec.Striker;
            StageActorSpec liveS = live.Spec.Striker;
            double ball = Math.Min(Math.Min(OrInfinity(s.Contact, BallLagMs), OrInfinity(s.OutcomeAt, 180)),
                Math.Min(Math.Min(OrInfinity(s.Dead, BallLagMs), OrInfinity(live.Spec.FlightEnd, BallLagMs)), OrInfinity(liveS.TaskEnd, 150 - 12)));
            for (int r = 0; r < 2; r++)
            {
                DirectorRole role = (DirectorRole)r;
                DirectorPlan livePlan = live.Plans[r];
                double own = role == DirectorRole.Striker ? Math.Min(ball, OrInfinity(s.StrokeEnd, 0)) : ball;
                double untilMs = Math.Min(own, livePlan.T0 + ((livePlan.N - 1) * 1000.0) / livePlan.Hz - EndMarginMs);
                e.Pending.Add(new PendingBake
                {
                    Role = role,
                    Make = () =>
                    {
                        // The live trace must be final up to the moment the copy stops (it is, unless the result came before the live bake
                        // reached it; then the slices it lacks are baked here, in this spare slice, never in the accept frame).
                        FinishLiveUpTo(live, role, untilMs);
                        return DirectorCore.StartPrepare(Anchors(e, role, e.Rm, e.Key), 60, livePlan, untilMs);
                    },
                    Deadline = untilMs,
                });
                Stats.Jobs++;
            }
            // A result's plans have a deadline: ahead of anything between balls.
            queue.Insert(0, e);
            return true;
        }

        private void FinishLiveUpTo(Script live, DirectorRole role, double untilMs)
        {
            for (int i = 0; i < live.Pending.Count; i++)
            {
                PendingBake p = live.Pending[i];
                if (p.Role != role || p.Next) continue;
                PlanJob job = p.Job ?? (p.Job = p.Make());
                job.AdvanceTo(untilMs + AheadMs);
            }
        }

        // ---- spare time -------------------------------------------------------------------------------------------------

        /// <summary>True while some bake is waiting.</summary>
        public bool Busy
        {
            get { return queue.Count > 0; }
        }

        /// <summary>
        /// Bakes for at most <paramref name="budgetMs"/> (at least one slice), result plans first. <paramref name="shown"/>: the script the
        /// world is drawing; the scene between balls is baked only while it is the one shown. A plan with a deadline is baked past it
        /// (<see cref="AheadMs"/>) before any plan is finished, so a frame that reaches it finds the trace there. Returns true if work remains.
        /// </summary>
        public bool Work(double budgetMs, Script shown)
        {
            return Run(budgetMs, shown, Mode.All);
        }

        /// <summary>Only what has a deadline coming (the world gives it its spare time ahead of anything else).</summary>
        public bool WorkUrgent(double budgetMs, Script shown)
        {
            return Run(budgetMs, shown, Mode.Urgent);
        }

        /// <summary>Only the rest (the tails of the plans being served, the scene between balls).</summary>
        public bool WorkRest(double budgetMs, Script shown)
        {
            return Run(budgetMs, shown, Mode.Rest);
        }

        /// <summary>True while some plan is not yet baked as far past its deadline as the spare time should take it.</summary>
        public bool Urgent
        {
            get
            {
                for (int i = 0; i < queue.Count; i++)
                    for (int k = 0; k < queue[i].Pending.Count; k++)
                        if (IsUrgent(queue[i].Pending[k])) return true;
                return false;
            }
        }

        private static bool IsUrgent(PendingBake p)
        {
            return !double.IsInfinity(p.Deadline) && !double.IsNaN(p.Deadline) && (p.Job == null || p.Job.HorizonMs <= p.Deadline + AheadMs);
        }

        private bool EntryHasUrgent(Script e)
        {
            for (int k = 0; k < e.Pending.Count; k++)
                if (IsUrgent(e.Pending[k])) return true;
            return false;
        }

        private bool Run(double budgetMs, Script shown, Mode mode)
        {
            if (queue.Count == 0) return false;
            double until = clock() + budgetMs;
            for (;;)
            {
                Script e = null;
                for (int i = 0; i < queue.Count; i++)
                {
                    Script x = queue[i];
                    if ((x.Kind != StageKind.Idle || x == shown || x.Prefetch) && (mode != Mode.Urgent || EntryHasUrgent(x)))
                    {
                        e = x;
                        break;
                    }
                }
                PendingBake p = e != null ? NextPending(e, mode) : null;
                if (e == null || p == null)
                {
                    // an entry with nothing pending leaves the queue; one that is waiting for its scene to be shown stays
                    Script done = null;
                    for (int i = 0; i < queue.Count; i++)
                        if (queue[i].Pending.Count == 0)
                        {
                            done = queue[i];
                            break;
                        }
                    if (done == null || mode == Mode.Urgent) break;
                    queue.Remove(done);
                    continue;
                }
                PlanJob job = p.Job ?? (p.Job = p.Make());
                // Past its deadline plus the cushion the plan is finished slice by slice; before that it only runs up to it.
                double goal = !double.IsInfinity(p.Deadline) ? p.Deadline + AheadMs : double.NegativeInfinity;
                bool toGoal = mode == Mode.Urgent || job.HorizonMs <= goal;
                bool finished;
                do
                {
                    finished = job.Advance(1);
                    Stats.Slices++;
                }
                while (!finished && clock() < until && (!toGoal || job.HorizonMs <= goal));
                if (finished) Complete(e, p);
                else if (toGoal && job.HorizonMs <= goal) break; // the budget ran out on the way to the goal
                if (clock() >= until) break;
            }
            return queue.Count > 0;
        }

        /// <summary>The pending plan to work on next in an entry: one not yet baked up to its deadline's cushion, else the first.</summary>
        private PendingBake NextPending(Script e, Mode mode)
        {
            for (int k = 0; k < e.Pending.Count; k++)
                if (IsUrgent(e.Pending[k])) return e.Pending[k];
            return mode == Mode.Urgent || e.Pending.Count == 0 ? null : e.Pending[0];
        }

        /// <summary>Puts the plan a job is filling into its entry (once): from now on the entry draws with it.</summary>
        private void SwapIn(Script e, PendingBake p)
        {
            if (p.Serving) return;
            p.Serving = true;
            int r = (int)p.Role;
            if (p.Next)
            {
                // the next lap of a scene between balls waits for the wrap
                e.Next[r] = p.Job.Partial;
                e.NextQueued[r] = false;
                return;
            }
            e.Plans[r] = p.Job.Partial;
            if (p.FadeIn)
            {
                e.Fade = true;
                e.Fade0 = double.NaN;
            }
            Stats.Swaps++;
        }

        /// <summary>A job is done: its plan is the entry's, and the job is no longer pending.</summary>
        private void Complete(Script e, PendingBake p)
        {
            PlanJob job = p.Job ?? (p.Job = p.Make());
            while (!job.Advance(1 << 20))
            {
                // to the end
            }
            Settle(e, p);
        }

        private void Settle(Script e, PendingBake p)
        {
            SwapIn(e, p);
            e.Pending.Remove(p);
            if (e.Pending.Count == 0) queue.Remove(e);
        }

        /// <summary>
        /// A frame that has reached a pending plan's deadline before the spare time met it serves the plan from now on, baked as far as
        /// this frame needs (the playhead plus <see cref="LookaheadMs"/>): usually nothing is left to do, and never more than the slices the
        /// trace is behind by.
        /// </summary>
        private void Force(Script e, DirectorRole role, double t)
        {
            for (int i = e.Pending.Count - 1; i >= 0; i--)
            {
                if (i >= e.Pending.Count) continue;
                PendingBake p = e.Pending[i];
                if (p.Role != role || t < p.Deadline) continue;
                PlanJob job = p.Job ?? (p.Job = p.Make());
                int ran = job.AdvanceTo(t + LookaheadMs);
                if (ran > 0)
                {
                    Stats.Forced++;
                    Stats.ForcedSlices += ran;
                    Stats.Slices += ran;
                    if (ran > Stats.ForcedMax) Stats.ForcedMax = ran;
                }
                if (job.Done) Settle(e, p);
                else SwapIn(e, p);
            }
        }

        // ---- the plans on a frame ---------------------------------------------------------------------------------------

        /// <summary>
        /// A result that stands on the live plans until its own are baked reads them: they must be baked as far as the playhead needs (the
        /// spare time has normally finished them long before the result arrives; if it has not, the frame bakes the slices it lacks).
        /// </summary>
        private void ServeStandIn(Script e, DirectorRole role, double t)
        {
            Script live = e.StandIn;
            int r = (int)role;
            // nothing to serve once the live plans are whole, or once the result's own plan has replaced them
            if (live.Pending.Count == 0 || !ReferenceEquals(e.Plans[r], live.Plans[r])) return;
            for (int i = live.Pending.Count - 1; i >= 0; i--)
            {
                if (i >= live.Pending.Count) continue;
                PendingBake p = live.Pending[i];
                if (p.Role != role || p.Next) continue;
                PlanJob job = p.Job ?? (p.Job = p.Make());
                int ran = job.AdvanceTo(t + LookaheadMs);
                if (ran > 0)
                {
                    Stats.Forced++;
                    Stats.ForcedSlices += ran;
                    Stats.Slices += ran;
                    if (ran > Stats.ForcedMax) Stats.ForcedMax = ran;
                }
                if (job.Done) Settle(live, p);
                else SwapIn(live, p);
            }
        }

        /// <summary>The plan to draw <paramref name="role"/> with at scene time t in this entry, or null (none yet, or the wrong Reduced Motion setting).</summary>
        private DirectorPlan PlanOf(Script e, DirectorRole role, double t)
        {
            if (e.StandIn != null) ServeStandIn(e, role, t);
            if (e.Pending.Count > 0) Force(e, role, t);
            DirectorPlan plan = e.Plans[(int)role];
            // A plan baked loud cannot serve once Reduced Motion is on; a quiet one serves after it is off.
            if (plan == null || (reducedMotion && !plan.ReducedMotion)) return null;
            return plan;
        }

        private bool HasPending(Script e, DirectorRole role)
        {
            for (int k = 0; k < e.Pending.Count; k++)
                if (e.Pending[k].Role == role) return true;
            return false;
        }

        private float[] Read(Script e, DirectorRole role, DirectorPlan plan, double t)
        {
            int r = (int)role;
            Cache c = cache[r];
            if (e.Loop)
            {
                double end = e.Spec.Bowler.End;
                // The wrap: a scene between balls goes round every minute. Its next lap is a plan of its own (another key), baked ahead in
                // the spare time and faded into at the seam, so the minute never repeats; without it the lap repeats itself.
                if (t < e.LastT[r] - end / 2)
                {
                    e.Lap[r]++;
                    if (e.Next[r] != null)
                    {
                        e.Plans[r] = e.Next[r];
                        e.Next[r] = null;
                        plan = e.Plans[r];
                    }
                }
                e.LastT[r] = t;
                if (e.Next[r] == null && !e.NextQueued[r] && !HasPending(e, role)) QueueNext(e, role);
            }
            int detail = Detail;
            if (c.Plan == plan && c.T == t && c.Detail == detail && !e.Loop) return c.Out;
            if (e.Loop) DirectorCore.SampleWrapped(plan, t, e.Spec.Bowler.End, SeamMs, c.Out, scratch, detail, e.Next[r] ?? plan);
            else DirectorCore.Sample(plan, t, c.Out, detail);
            c.Plan = plan;
            c.T = t;
            c.Detail = detail;
            return c.Out;
        }

        /// <summary>Queues the bake of an actor's next lap of a scene between balls (its key is the scene's with the lap number).</summary>
        private void QueueNext(Script e, DirectorRole role)
        {
            int r = (int)role;
            e.NextQueued[r] = true;
            string key = e.Key + "." + (e.Lap[r] + 1);
            bool rm = e.Rm;
            e.Pending.Add(new PendingBake
            {
                Role = role,
                Make = () => DirectorCore.StartPrepare(Anchors(e, role, rm, key), 60),
                Deadline = double.PositiveInfinity,
                Next = true,
            });
            if (!queue.Contains(e)) queue.Add(e);
        }

        private static double Smooth(double x)
        {
            return DirectorMath.Smooth(x);
        }

        private double Weight(Script e, double t)
        {
            // A delivery's script starts as a hard cut from the scene before it (the bowler's head may have been on the ground a moment
            // ago): the head takes over from the clip over the first StartFadeMs of the script, whatever the clock.
            if (!e.Fade) return e.Loop ? 1 : Smooth(t / StartFadeMs);
            if (double.IsNaN(e.Fade0)) e.Fade0 = t;
            double dt = t - e.Fade0;
            if (dt < 0) dt += e.Spec.Bowler.End;
            double w = Smooth(dt / FadeMs);
            if (w >= 1) e.Fade = false;
            return w;
        }

        /// <summary>
        /// The seam of an actor's delivery: created at the entry's first frame for the actor when another entry was drawn for him just
        /// before (the scene between balls, usually) and remembers the head he was last drawn with; its share k falls from 1 to 0 over the
        /// script's first <see cref="SeamHeadMs"/>. Live deliveries only: a result takes over from a live script by plan identity, and a
        /// replay is built from the result alone (and must draw the same whatever came before it). Null: none.
        /// </summary>
        private StageSeam SeamOf(Script e, DirectorRole role, double t)
        {
            int r = (int)role;
            if (!e.SeamSet[r])
            {
                StageDrawnHead d = drawn[r];
                Script prev = lastEntry[r];
                StageSeam s = null;
                // A first frame later than the end of the seam has nothing left to give back. A delivery continues from the head of the scene
                // before it; so does the scene between balls from the delivery before it (Unity: the world's own hand-over blends the bones it
                // captured before the Director's turn, so without a seam the head would snap back to the clip's when the delivery ends).
                if (SeamOn && (e.Kind == StageKind.Live || e.Kind == StageKind.Idle) && prev != null && prev != e && d.Ok && t < SeamHeadMs - 50)
                {
                    s = e.SeamObjects[r];
                    s.Pending = true;
                    s.H0Yaw = d.Yaw;
                    s.H0Pitch = d.Pitch;
                    s.H0Roll = d.Roll;
                    s.OYaw = s.OPitch = s.ORoll = 0;
                    s.K = 1;
                    s.T0 = t;
                    // the life goes on from what the rig was last given (the bowler of a delivery is in his quiet window from his first frame: exactly zero)
                    StageDrawnLife dl = drawnLife[r];
                    s.LifeOn = dl.Ok && (e.Kind == StageKind.Idle || role == DirectorRole.Striker);
                    for (int i = 0; i < 6; i++) s.Life0[i] = s.LifeOn ? dl.V[i] : 0f;
                }
                e.Seam[r] = s;
                e.SeamSet[r] = true;
            }
            StageSeam seam = e.Seam[r];
            if (seam != null)
            {
                double x = (t - seam.T0) / Math.Max(50, SeamHeadMs - seam.T0);
                seam.K = 1 - Smooth(x);
            }
            return seam;
        }

        /// <summary>
        /// One actor's frame at scene time <paramref name="t"/> in script <paramref name="s"/>: samples the plan (baking the slices a
        /// deadline that has been reached needs) and fills <paramref name="into"/> with what the life pass and the head pass take. Returns
        /// <c>into.On</c>. Allocates nothing once the script's seam exists.
        /// </summary>
        public bool Frame(Script s, DirectorRole role, double t, DirectedFrame into)
        {
            into.Clear();
            into.Role = role;
            if (!Enabled || s == null || s.Retired) return false;
            DirectorPlan plan = PlanOf(s, role, t);
            StageSeam seam = SeamOf(s, role, t);
            lastEntry[(int)role] = s;
            double release = s.Spec.Bowler.Release ?? double.PositiveInfinity;
            bool brake = role == DirectorRole.Striker || t > release + BrakeBowlerAfterMs;
            if (plan == null)
            {
                // No plan yet (a delivery's first frames): nothing to breathe or look with, but the head still continues from the scene before.
                if (seam != null)
                {
                    into.On = true;
                    into.HasChannels = false;
                    into.Ch = null;
                    into.Reduced = reducedMotion;
                    into.W = 0;
                    into.Brake = brake;
                    into.Seam = seam;
                }
                return into.On;
            }
            float[] ch = Read(s, role, plan, t);
            double w = Weight(s, t);
            into.On = true;
            into.HasChannels = true;
            into.Ch = ch;
            into.Reduced = plan.ReducedMotion;
            into.W = w;
            // The striker's neck and head brake on arrival; the bowler's only after the release (until then they hold him on the batter)
            into.Brake = brake;
            into.Seam = seam;
            return true;
        }

        // ---- the tests and the probes -----------------------------------------------------------------------------------

        /// <summary>The plans of a script (the web's plansOf): null for a script the runtime does not know.</summary>
        public DirectorPlan PlanOfScript(Script s, DirectorRole role)
        {
            return s == null ? null : s.Plans[(int)role];
        }

        /// <summary>Runs every pending bake of a script to the end.</summary>
        public void Finish(Script s)
        {
            if (s == null) return;
            while (s.Pending.Count > 0) Complete(s, s.Pending[0]);
        }

        /// <summary>The pending bakes of a script (for the tests): how many are waiting.</summary>
        public int PendingCount(Script s)
        {
            return s == null ? 0 : s.Pending.Count;
        }
    }
}
