using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>What the physics trace says about the world around one fielder (all positions world, mirrored).</summary>
    public sealed class ProductionFieldingContext
    {
        /// <summary>The physics ball at simulation time t (clamped to the trace); null when there is none.</summary>
        public Func<double, Vector3?> Ball;
        /// <summary>The physics ball's velocity at t.</summary>
        public Func<double, Vector3?> BallVelocity;
        /// <summary>The wicketkeeper: crouch, shuffle, keeper dive and take.</summary>
        public bool Keeper;
        /// <summary>The catch is above head height (the high catch).</summary>
        public bool CatchHigh;
        /// <summary>Heading (radians, 0 = +z) held before the first action.</summary>
        public float Heading;
        /// <summary>Where the striker stands: faced when the ball gives no direction.</summary>
        public Vector3 Striker = new Vector3(0f, 0f, 9f);
        /// <summary>A post-ball reaction on the spot from this simulation time; it waits for any run, throw or dive.</summary>
        public double? ReactionTime;
        public ProductionFieldingClip ReactionClip;
        /// <summary>Extend the last hold to this simulation time.</summary>
        public double? EndTime;
        /// <summary>Seconds into looping holds (deterministic per fielder, so the field does not breathe in step).</summary>
        public float Phase;
    }

    /// <summary>One timed body move on the physics path (clips.ts/actors.ts Move, in simulation seconds).</summary>
    public readonly struct ProductionFieldingMove
    {
        public ProductionFieldingMove(double t0, double t1, ProductionFieldingClip clip, double clipStart, double rate,
            bool hasLower, ProductionFieldingClip lower, double lowerStart, double lowerRate, Vector3 from, Vector3 to,
            float heading, float headingTo, double blendSeconds, bool hasBody, Vector3 bodyFrom, Vector3 bodyTo,
            double blendStart = double.NaN, int blendFrom = -1)
        {
            BlendStart = double.IsNaN(blendStart) ? t0 : blendStart;
            BlendFrom = blendFrom;
            T0 = t0;
            T1 = t1;
            Clip = clip;
            ClipStart = clipStart;
            Rate = rate;
            HasLower = hasLower;
            Lower = lower;
            LowerStart = lowerStart;
            LowerRate = lowerRate;
            From = from;
            To = to;
            Heading = heading;
            HeadingTo = headingTo;
            BlendSeconds = blendSeconds;
            HasBody = hasBody;
            BodyFrom = bodyFrom;
            BodyTo = bodyTo;
        }

        public double T0 { get; }
        public double T1 { get; }
        public ProductionFieldingClip Clip { get; }
        public double ClipStart { get; }
        public double Rate { get; }
        public bool HasLower { get; }
        public ProductionFieldingClip Lower { get; }
        public double LowerStart { get; }
        public double LowerRate { get; }
        public Vector3 From { get; }
        public Vector3 To { get; }
        public float Heading { get; }
        public float HeadingTo { get; }
        public double BlendSeconds { get; }
        public bool HasBody { get; }
        public Vector3 BodyFrom { get; }
        public Vector3 BodyTo { get; }
        /// <summary>When this move's crossfade began: its own start, or (a continuation of the same clip split at a
        /// path sample or a turn step) the start of the clip switch it continues, so a fade is never cut short.</summary>
        public double BlendStart { get; }
        /// <summary>The move the crossfade comes from (-1: the move before this one).</summary>
        public int BlendFrom { get; }

        public double ClipTimeAt(double t) => ClipStart + (t - T0) * Rate;
        public double LowerTimeAt(double t) => LowerStart + (t - T0) * LowerRate;
    }

    /// <summary>One evaluated instant of a fielder's body (the actors.ts ActorState).</summary>
    public struct ProductionFieldingState
    {
        /// <summary>The physics position (world): the path at t, unchanged.</summary>
        public Vector3 Position;
        public float Heading;
        public ProductionFieldingClip Clip;
        public double ClipTime;
        public bool HasPrevious;
        public ProductionFieldingClip PreviousClip;
        /// <summary>Weight of the current clip (1 = fully current).</summary>
        public float Weight;
        /// <summary>Drawn-rig offset from Position (world metres): a dive's extension only; else zero.</summary>
        public Vector3 Body;
        public int MoveIndex;
        /// <summary>The move the crossfade comes from, when HasPrevious.</summary>
        public int PreviousIndex;
    }

    /// <summary>A fielder's whole choreography for one delivery: pure, deterministic, a function of time.</summary>
    public sealed class ProductionFieldingTrack
    {
        private readonly ProductionFieldingMove[] moves;
        private readonly ProductionCharacterPose scratchCurrent = new ProductionCharacterPose();
        private readonly ProductionCharacterPose scratchLower = new ProductionCharacterPose();
        private readonly ProductionCharacterPose scratchPrevious = new ProductionCharacterPose();

        internal ProductionFieldingTrack(ProductionFieldingMove[] moves)
        {
            this.moves = moves ?? Array.Empty<ProductionFieldingMove>();
        }

        public IReadOnlyList<ProductionFieldingMove> Moves => moves;

        /// <summary>evaluateActor(): the move at t, its heading, clip times, crossfade and body extension.</summary>
        public ProductionFieldingState Evaluate(double t)
        {
            var state = new ProductionFieldingState { Weight = 1f, MoveIndex = -1 };
            if (moves.Length == 0) return state;
            var index = 0;
            while (index < moves.Length - 1 && t >= moves[index + 1].T0) index++;
            var move = moves[index];
            var span = Math.Max(0.001, move.T1 - move.T0);
            var u = Math.Max(0.0, Math.Min(1.0, (t - move.T0) / span));
            state.MoveIndex = index;
            state.Position = Vector3.Lerp(move.From, move.To, (float)u);
            state.Heading = ProductionFieldingPlanner.LerpAngle(move.Heading, move.HeadingTo,
                ProductionFieldingPlanner.EaseInOut((float)u));
            state.Clip = move.Clip;
            state.ClipTime = move.ClipTimeAt(Math.Max(t, move.T0));
            if (move.HasBody) state.Body = Vector3.Lerp(move.BodyFrom, move.BodyTo, (float)u);
            var from = move.BlendFrom >= 0 ? move.BlendFrom : index - 1;
            if (from >= 0 && move.BlendSeconds > 0.0 && t - move.BlendStart < move.BlendSeconds)
            {
                state.HasPrevious = true;
                state.PreviousClip = moves[from].Clip;
                state.PreviousIndex = from;
                // Smoothstep, not linear: a linear crossfade steps the blended pose's velocity at both ends (the
                // third man's hips stepped 1.4 m/s in one frame out of the pack throw's 0.43 m forward step).
                var fade = Mathf.Clamp01((float)((t - move.BlendStart) / move.BlendSeconds));
                state.Weight = fade * fade * (3f - 2f * fade);
            }
            return state;
        }

        /// <summary>Samples the body pose at t into `output` (clips, the running-legs layer and the crossfade).</summary>
        public ProductionFieldingState SamplePose(double t, ProductionCharacterPose output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            var state = Evaluate(t);
            if (state.MoveIndex < 0)
            {
                ProductionFieldingClips.Sample(ProductionFieldingClip.Ready, 0.0, output);
                return state;
            }
            SampleBlended(state.MoveIndex, t, output, FadeDepth);
            return state;
        }

        /// <summary>
        /// Poses `rig` at t: the body pose, the heading on `root`, and a dive's extension as a hips offset only (the
        /// root's position is the caller's: the physics path). Returns the evaluated state.
        /// </summary>
        public ProductionFieldingState Apply(ProductionCharacterRig rig, Transform root, double t,
            ProductionCharacterPose scratch)
        {
            if (rig == null) throw new ArgumentNullException(nameof(rig));
            if (root == null) throw new ArgumentNullException(nameof(root));
            var state = SamplePose(t, scratch);
            if (rig.Handedness == ProductionCharacterHandedness.Left) ProductionFieldingClips.Mirror(scratch);
            root.rotation = Quaternion.Euler(0f, state.Heading * Mathf.Rad2Deg, 0f);
            if (state.Body.sqrMagnitude > 0f) scratch.RootOffset += root.InverseTransformVector(state.Body);
            rig.ApplyPose(scratch);
            return state;
        }

        /// <summary>
        /// How many crossfades deep a fade's source is itself sampled with its own fade (actors.ts stackAt): a clip
        /// switch while the last fade is still running starts from the pose on screen, not from the previous clip at
        /// full weight (the fielders' 105-degree shin pop at the Ready-to-Run-to-RunDrive switch, UNITY-2 r2).
        /// </summary>
        private const int FadeDepth = 3;
        private ProductionCharacterPose[] fadeScratch;

        private void SampleBlended(int index, double t, ProductionCharacterPose output, int depth)
        {
            var move = moves[index];
            SampleMove(move, Math.Max(t, move.T0), output);
            if (depth <= 0) return;
            var from = move.BlendFrom >= 0 ? move.BlendFrom : index - 1;
            if (from < 0 || move.BlendSeconds <= 0.0 || t - move.BlendStart >= move.BlendSeconds) return;
            if (fadeScratch == null)
            {
                fadeScratch = new ProductionCharacterPose[FadeDepth + 1];
                for (var k = 0; k < fadeScratch.Length; k++) fadeScratch[k] = new ProductionCharacterPose();
            }
            var source = fadeScratch[depth];
            var previous = moves[from];
            SampleBlended(from, Math.Min(t, previous.T1 + move.BlendSeconds), source, depth - 1);
            var u = Mathf.Clamp01((float)((t - move.BlendStart) / move.BlendSeconds));
            ProductionFieldingClips.Blend(source, output, u * u * (3f - 2f * u));
            Copy(source, output);
        }

        private void SampleMove(ProductionFieldingMove move, double t, ProductionCharacterPose output)
        {
            ProductionFieldingClips.Sample(move.Clip, move.ClipTimeAt(t), scratchCurrent);
            if (move.HasLower)
            {
                ProductionFieldingClips.Sample(move.Lower, move.LowerTimeAt(t), scratchLower);
                ProductionFieldingClips.OverlayLower(scratchCurrent, scratchLower);
            }
            Copy(scratchCurrent, output);
        }

        private static void Copy(ProductionCharacterPose source, ProductionCharacterPose destination)
        {
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                destination.Rotations[joint] = source.Rotations[joint];
            destination.RootOffset = source.RootOffset;
            destination.BatRotation = source.BatRotation;
        }
    }

    /// <summary>
    /// Practice fielders: presentation-only choreography on the physics fielder path, ported from
    /// src/render3d/practice/fielding.ts (fieldingMoves). The physics decides where every fielder is at every instant
    /// (the trace's samples, linear between samples) and when every fielding event happens (catch, field, throw); this
    /// never changes either. It only chooses how the body moves on that path:
    ///  - the root is the path, split at every sample, so the position at every time equals the physics position;
    ///  - clips are aligned to the physics times by their markers: the hands meet the ball at the pickup, the arm
    ///    releases at the throw event, the catch is taken at the catch event, the dive's hands are out at the instant
    ///    the ball is reached. A clip may start before its event (anticipation);
    ///  - legs keep running under a pickup or catch taken on the move; accelerating strides lean and quicken; a fielder
    ///    waiting for the ball or a throw does not run on the spot;
    ///  - headings: runs face the travel, a waiting or watching fielder turns (rate-limited) to follow the ball, a throw
    ///    faces where the physics ball goes, the keeper stays square to the bowler;
    ///  - a dive extends the drawn body from the physics position towards the ball (at most 1.35 m), so the gloves meet
    ///    the ball the physics says was reached; the physics position is unchanged;
    ///  - post-ball reactions start only after the event that earns them, and never over a run, throw or dive.
    /// </summary>
    public static class ProductionFieldingPlanner
    {
        /// <summary>Hips to fingertips in the extended dive pose (m).</summary>
        public const float DiveHandReachMetres = 1.1f;
        /// <summary>Largest presentation extension of a dive from the physics position (m).</summary>
        public const float DiveBodyMaxMetres = 1.35f;
        /// <summary>The keeper faces the bowler (world −z).</summary>
        public const float KeeperHeading = Mathf.PI;
        public const float StillMetresPerSecond = 0.3f;
        public const float LegsRunMetresPerSecond = 1.5f;
        public const double DrivePhaseSeconds = 0.55;
        public const float DrivePhaseSpeed = 0.8f;
        public const float BallAtHandMetres = 1.5f;
        public const float SnapThrowRate = 1.8f;
        /// <summary>A pack throw's lead-in (fld_throw_over, from the gather pose) is warped at most this much
        /// (fielding.ts PACK_THROW_WARP); a window still too short starts part-way in.</summary>
        public const float PackThrowWarp = 1.2f;
        /// <summary>A dive's landing after its reach (s at the clip's own pace) when the clip names no `land`
        /// marker: the code-authored dive is down on the ground 0.14 s after its reach.</summary>
        public const float DiveLandAfterReachSeconds = 0.14f;
        public const float MaximumTurnRadiansPerSecond = 14f;

        private enum SpanKind { Hold, Run, Shot }

        private delegate float? Face(double t, Vector3 at);

        private sealed class Span
        {
            public double T0;
            public double T1;
            public ProductionFieldingClip Clip;
            public SpanKind Kind;
            public double Start;
            public double Rate = 1.0;
            public double Blend;
            public Face Facing;
            public float Turn;
            public Func<double, Vector3?> Body;
            public double Step;
            public int Order;
        }

        private sealed class Group
        {
            public string Action;
            public int I0;
            public int I1;
            public double T0;
            public double T1;
        }

        /// <summary>
        /// Stride cadence: clip seconds per second for a run at ground speed v (m/s). HUM U11: tied to distance, two
        /// steps of ProductionGaitPresenter.StepLength(v) per clip cycle (about 0.8 m walking to 2 m sprinting), so the
        /// feet keep pace with the ground instead of shuffling at a fixed cadence when slow.
        /// </summary>
        public static double RunRate(double v, bool drive)
        {
            var speed = Math.Max(0.0, v);
            var clip = drive ? ProductionFieldingClip.RunDrive : ProductionFieldingClip.Run;
            var cycleSeconds = ProductionFieldingClips.Duration(clip);
            var cyclesPerSecond = speed / (2.0 * ProductionGaitPresenter.StepLength((float)speed));
            return Clamp(cyclesPerSecond * cycleSeconds, 0.15, 1.6);
        }

        public static ProductionFieldingTrack Plan(
            FielderTraceSample[] path,
            bool mirror,
            ProductionFieldingContext context)
        {
            if (context == null) throw new ArgumentNullException(nameof(context));
            if (path == null || path.Length == 0) return new ProductionFieldingTrack(Array.Empty<ProductionFieldingMove>());
            var s = (FielderTraceSample[])path.Clone();
            Array.Sort(s, (a, b) => a.t.CompareTo(b.t));
            var count = s.Length;
            var w = new Vector3[count];
            var times = new double[count];
            for (var index = 0; index < count; index++)
            {
                w[index] = new Vector3((mirror ? -1f : 1f) * (float)s[index].x, 0f, (float)s[index].z);
                times[index] = s[index].t;
            }
            var tFirst = times[0];
            var tPath = times[count - 1];
            var tEnd = context.EndTime.HasValue ? Math.Max(tPath, context.EndTime.Value) : tPath;

            Vector3 RootAt(double t)
            {
                if (t <= times[0]) return w[0];
                if (t >= tPath) return w[count - 1];
                // The last sample at or before t (binary search: dense physics paths carry hundreds of samples).
                var lo = 0;
                var hi = count - 1;
                while (hi - lo > 1)
                {
                    var mid = (lo + hi) >> 1;
                    if (times[mid] <= t) lo = mid;
                    else hi = mid;
                }
                var i = lo;
                var a = w[i];
                var b = w[Math.Min(i + 1, count - 1)];
                var spanT = times[i + 1] - times[i];
                var u = spanT > 0 ? (float)((t - times[i]) / spanT) : 0f;
                return new Vector3(a.x + (b.x - a.x) * u, 0f, a.z + (b.z - a.z) * u);
            }

            Vector3? Ball(double t) => context.Ball?.Invoke(t);
            var ballEnd = Ball(double.PositiveInfinity);
            Face FacePoint(Vector3? p) => p.HasValue
                ? (Face)((t, at) => Hypot(p.Value.x - at.x, p.Value.z - at.z) > 0.3f
                    ? HeadingOf(p.Value.x - at.x, p.Value.z - at.z)
                    : (float?)null)
                : null;
            Face faceBall = (t, at) =>
            {
                var b = Ball(t);
                if (!b.HasValue || Hypot(b.Value.x - at.x, b.Value.z - at.z) < BallAtHandMetres) return null;
                return HeadingOf(b.Value.x - at.x, b.Value.z - at.z);
            };
            Face Fixed(float h) => (t, at) => h;
            Vector3 Incoming(double t, Vector3 at)
            {
                var v = context.BallVelocity?.Invoke(t);
                if (v.HasValue && Hypot(v.Value.x, v.Value.z) > 1f)
                {
                    var n = Hypot(v.Value.x, v.Value.z);
                    return new Vector3(-v.Value.x / n, 0f, -v.Value.z / n);
                }
                var st = context.Striker;
                var m = Hypot(st.x - at.x, st.z - at.z);
                if (m <= 0f) m = 1f;
                return new Vector3((st.x - at.x) / m, 0f, (st.z - at.z) / m);
            }

            // Groups of consecutive samples with one action: [t0, t1) runs to the next group's first sample.
            var groups = new List<Group>();
            for (var i = 0; i < count;)
            {
                var j = i;
                while (j + 1 < count && s[j + 1].action == s[i].action) j++;
                groups.Add(new Group
                {
                    Action = s[i].action, I0 = i, I1 = j, T0 = times[i], T1 = j + 1 < count ? times[j + 1] : times[j]
                });
                i = j + 1;
            }

            var spans = new List<Span>();
            var order = 0;
            void Push(Span sp)
            {
                // A clip aligned before the path starts begins part-way through, so its marker still lands on time.
                if (sp.T0 < tFirst)
                {
                    var cut = tFirst - sp.T0;
                    sp.Start += cut * sp.Rate;
                    sp.T0 = tFirst;
                }
                if (sp.T1 > sp.T0 + 1e-6)
                {
                    sp.Order = order++;
                    spans.Add(sp);
                }
            }
            (double t0, double t1) Shot(ProductionFieldingClip clip, double alignT, string marker, Face facing,
                float turn = 8f, double blend = 110, double rate = 1.0, double until = 0.0,
                Func<double, Vector3?> body = null, double step = 0.0, double notBefore = double.NegativeInfinity)
            {
                // fielding.ts shot(): never before `notBefore` (the event it follows); a clip that cannot fit its
                // lead-in starts part-way in, so its marker still lands on the physics time.
                var mark = ProductionFieldingClips.Marker(clip, marker, 0f);
                var t0 = Math.Max(alignT - mark / rate, Math.Min(alignT, notBefore));
                var start = mark - (alignT - t0) * rate;
                var t1 = Math.Max(t0 + (ProductionFieldingClips.Duration(clip) - start) / rate, until);
                Push(new Span
                {
                    T0 = t0, T1 = t1, Clip = clip, Kind = SpanKind.Shot, Start = start, Rate = rate, Blend = blend,
                    Facing = facing, Turn = turn, Body = body, Step = step
                });
                return (t0, t1);
            }

            var gatheredT = double.NegativeInfinity;
            // When the last dive landed (its `land` marker on the clip's own pace after the reach).
            var landedT = double.NegativeInfinity;
            var holdClip = context.Keeper ? ProductionFieldingClip.KeepCrouch : ProductionFieldingClip.Ready;
            var sawRun = false;
            var lastDiveEnd = double.NegativeInfinity;

            for (var gi = 0; gi < groups.Count; gi++)
            {
                var g = groups[gi];
                var next = gi + 1 < groups.Count ? groups[gi + 1] : null;
                switch (g.Action)
                {
                    case "set":
                        Push(new Span
                        {
                            T0 = g.T0, T1 = g.T1, Clip = holdClip, Kind = SpanKind.Hold, Start = context.Phase,
                            Blend = 220, Facing = context.Keeper ? Fixed(KeeperHeading) : null, Turn = 4
                        });
                        break;
                    case "idle":
                        Push(new Span
                        {
                            T0 = g.T0, T1 = next != null ? g.T1 : tEnd, Clip = ProductionFieldingClip.Idle,
                            Kind = SpanKind.Hold, Start = context.Phase, Blend = 300, Facing = faceBall, Turn = 3.5f,
                            Step = 0.2
                        });
                        break;
                    case "run":
                        sawRun = true;
                        Push(new Span
                        {
                            T0 = g.T0, T1 = g.T1, Clip = ProductionFieldingClip.Run, Kind = SpanKind.Run, Start = 0,
                            Blend = 140, Facing = null, Turn = 9
                        });
                        break;
                    case "celebrate":
                    {
                        // After a dive he gets up first; the physics marks the celebration, not its first frame.
                        var at = Math.Max(g.T0, lastDiveEnd - 0.15);
                        Push(new Span
                        {
                            T0 = at,
                            T1 = Math.Max(at + ProductionFieldingClips.Duration(ProductionFieldingClip.CelebrateJump),
                                next != null ? g.T1 : tEnd),
                            Clip = ProductionFieldingClip.CelebrateJump, Kind = SpanKind.Shot, Start = 0, Blend = 140,
                            Facing = null, Turn = 4
                        });
                        break;
                    }
                    case "throw":
                    {
                        var at = RootAt(g.T0);
                        var target = FacePoint(ballEnd)?.Invoke(g.T0, at);
                        // The wind-up starts once the ball is gathered: a tight window gets a snap throw. A pack
                        // throw's lead-in (fld_throw_over, 0.66 s to its release) is warped at most PackThrowWarp and
                        // never starts before the gather + 0.05 s (fielding.ts): a window still too short starts
                        // part-way in. It also waits for a dive that gathered the ball to land (no standing wind-up
                        // in mid-air); the release always lands on the physics release.
                        var pack = ProductionFieldingClips.FromPack(ProductionFieldingClip.FieldThrow);
                        var windUp = ProductionFieldingClips.Marker(ProductionFieldingClip.FieldThrow, "release");
                        var cap = pack ? PackThrowWarp : SnapThrowRate;
                        var notBefore = pack ? Math.Max(gatheredT + 0.05, landedT) : double.NegativeInfinity;
                        var rate = Clamp(windUp / Math.Max(windUp / cap, g.T0 - gatheredT - 0.05), 1.0, cap);
                        Shot(ProductionFieldingClip.FieldThrow, g.T0, "release",
                            target.HasValue ? Fixed(target.Value) : null, 9f, 120, rate, notBefore: notBefore);
                        break;
                    }
                    case "pickup":
                    {
                        // A clean gather: the hand meets the ball at the event.
                        var collectT = g.T0;
                        gatheredT = collectT;
                        var turnTo = FacePoint(ballEnd)?.Invoke(collectT, RootAt(collectT));
                        Face facing = turnTo.HasValue
                            ? (Face)((t, at) => t >= collectT ? turnTo : null)
                            : null;
                        Shot(ProductionFieldingClip.FieldPickup, collectT, "collect", facing, 6f,
                            until: next != null ? next.T0 : tEnd);
                        break;
                    }
                    case "catch":
                    {
                        gatheredT = g.T0;
                        var until = next != null ? next.T0 : tEnd;
                        if (context.Keeper && !sawRun)
                        {
                            Shot(ProductionFieldingClip.KeepTake, g.T0, "catch", Fixed(KeeperHeading), until: until);
                        }
                        else
                        {
                            var high = context.CatchHigh || (Ball(g.T0)?.y ?? 0f) > 1.9f;
                            var inc = Incoming(g.T0, RootAt(g.T0));
                            Shot(high ? ProductionFieldingClip.CatchHigh : ProductionFieldingClip.CatchChest, g.T0,
                                "catch", Fixed(HeadingOf(inc.x, inc.z)), 7f, until: until);
                        }
                        break;
                    }
                    case "drop":
                    {
                        var y = Ball(g.T0)?.y ?? 0f;
                        var until = next != null ? next.T0 : tEnd;
                        if (y < 0.45f)
                        {
                            Shot(ProductionFieldingClip.FieldFumble, g.T0, "touch", null, until: until);
                        }
                        else
                        {
                            var inc = Incoming(g.T0, RootAt(g.T0));
                            Shot(y > 1.9f ? ProductionFieldingClip.CatchHigh : ProductionFieldingClip.CatchChest, g.T0,
                                "catch", Fixed(HeadingOf(inc.x, inc.z)), 7f);
                            Push(new Span
                            {
                                T0 = g.T0 + 0.12,
                                T1 = Math.Max(g.T0 + 0.12 +
                                              ProductionFieldingClips.Duration(ProductionFieldingClip.FieldSpill), until),
                                Clip = ProductionFieldingClip.FieldSpill, Kind = SpanKind.Shot, Start = 0, Blend = 90,
                                Facing = null, Turn = 4
                            });
                        }
                        break;
                    }
                    case "dive":
                    {
                        // The action the dive ends in (gather, catch or drop) happens at the next sample.
                        var ends = next != null &&
                                   (next.Action == "pickup" || next.Action == "catch" || next.Action == "drop")
                            ? next
                            : null;
                        var reachT = ends != null ? ends.T0 : g.T1;
                        if (ends != null && ends.Action != "drop") gatheredT = reachT;
                        var p = RootAt(reachT);
                        var b = Ball(reachT);
                        var dx = b.HasValue ? b.Value.x - p.x : 0f;
                        var dz = b.HasValue ? b.Value.z - p.z : 0f;
                        var r = Hypot(dx, dz);
                        if (r < 0.05f)
                        {
                            var p0 = RootAt(g.T0);
                            dx = p.x - p0.x;
                            dz = p.z - p0.z;
                            r = 0f;
                        }
                        var n = Hypot(dx, dz);
                        if (n <= 0f) n = 1f;
                        var d = new Vector3(dx / n, 0f, dz / n);
                        var keeperStyle = context.Keeper && !sawRun;
                        bool right;
                        float diveHeading;
                        if (keeperStyle)
                        {
                            diveHeading = KeeperHeading;
                            // Facing −z the keeper's right is +x.
                            right = d.x >= 0f;
                        }
                        else
                        {
                            // Dive square to the ball's line: the side whose facing looks most into the incoming ball.
                            var inc = Incoming(reachT, p);
                            var hr = Mathf.Atan2(d.z, -d.x);
                            var hl = Mathf.Atan2(-d.z, d.x);
                            var fr = Mathf.Sin(hr) * inc.x + Mathf.Cos(hr) * inc.z;
                            var fl = Mathf.Sin(hl) * inc.x + Mathf.Cos(hl) * inc.z;
                            right = fr >= fl;
                            diveHeading = right ? hr : hl;
                        }
                        var clip = keeperStyle
                            ? right ? ProductionFieldingClip.KeepDiveRight : ProductionFieldingClip.KeepDiveLeft
                            : right ? ProductionFieldingClip.FieldDiveRight : ProductionFieldingClip.FieldDiveLeft;
                        var mark = ProductionFieldingClips.Marker(clip, "reach", 0.2f);
                        var duration = ProductionFieldingClips.Duration(clip);
                        // The clip's launch (take-off to the reach) is timed to the physics dive, slower for a long
                        // dive and quicker for a short one, so it starts at the physics take-off (never during the
                        // run) and the hands are out at the reach; the rest of the clip runs at its own pace from the
                        // reach (fielding.ts).
                        var lead = Math.Max(1e-3, reachT - g.T0);
                        var t0 = reachT - lead;
                        var clipEnd = reachT + duration - mark;
                        var extension = b.HasValue ? Mathf.Clamp(r - DiveHandReachMetres, -0.5f, DiveBodyMaxMetres) : 0f;
                        // Out to the ball by the reach, held through the landing, back over the get-up.
                        Func<double, Vector3?> body = t =>
                        {
                            if (extension == 0f) return null;
                            var k = SmoothStep(t0, reachT, t) *
                                    (1.0 - SmoothStep(reachT + duration * 0.62 - mark, clipEnd, t));
                            return k > 0.0
                                ? new Vector3(d.x * extension * (float)k, 0f, d.z * extension * (float)k)
                                : (Vector3?)null;
                        };
                        var until = ends != null ? (gi + 2 < groups.Count ? groups[gi + 2].T0 : tEnd) : g.T1;
                        if (Math.Abs(lead - mark) > 1e-6)
                        {
                            var dh = diveHeading;
                            Push(new Span
                            {
                                T0 = t0, T1 = reachT, Clip = clip, Kind = SpanKind.Shot, Start = 0, Rate = mark / lead,
                                Blend = 70, Facing = Fixed(dh), Turn = 14, Body = body, Step = 0.05
                            });
                            Push(new Span
                            {
                                T0 = reachT, T1 = Math.Max(clipEnd, until), Clip = clip, Kind = SpanKind.Shot,
                                Start = mark, Blend = 70, Facing = Fixed(dh), Turn = 14, Body = body, Step = 0.05
                            });
                        }
                        else
                        {
                            Shot(clip, reachT, "reach", Fixed(diveHeading), 14f, 70, 1.0, until, body, 0.05);
                        }
                        lastDiveEnd = clipEnd;
                        landedT = reachT + Math.Max(0.0,
                            ProductionFieldingClips.Marker(clip, "land", mark + DiveLandAfterReachSeconds) - mark);
                        if (ends != null)
                        {
                            if (ends.Action == "drop")
                            {
                                // Up from the dive, then the scramble for the loose ball until the pickup.
                                var pick = gi + 2 < groups.Count ? groups[gi + 2] : null;
                                if (pick != null && pick.T0 > lastDiveEnd)
                                {
                                    Push(new Span
                                    {
                                        T0 = lastDiveEnd - 0.05, T1 = pick.T0, Clip = ProductionFieldingClip.FieldFumble,
                                        Kind = SpanKind.Shot,
                                        Start = ProductionFieldingClips.Marker(ProductionFieldingClip.FieldFumble, "touch") +
                                                0.3,
                                        Blend = 160, Facing = null, Turn = 4
                                    });
                                }
                            }
                            gi++;
                        }
                        break;
                    }
                }
            }

            if (context.ReactionTime.HasValue)
            {
                // On the spot, once nothing else is happening: never over a run, a throw, a dive or a pickup.
                var busy = double.NegativeInfinity;
                foreach (var sp in spans)
                {
                    if (sp.Kind == SpanKind.Hold) continue;
                    var end = sp.Kind == SpanKind.Run
                        ? sp.T1
                        : Math.Min(sp.T1, sp.T0 + ProductionFieldingClips.Duration(sp.Clip));
                    busy = Math.Max(busy, end);
                }
                var at = Math.Max(context.ReactionTime.Value, busy + 0.1);
                if (at < tEnd)
                {
                    Push(new Span
                    {
                        T0 = at, T1 = tEnd, Clip = context.ReactionClip, Kind = SpanKind.Shot, Start = 0, Blend = 260,
                        Facing = faceBall, Turn = 3, Step = 0.2
                    });
                }
            }

            Span Pick(double t)
            {
                Span shot = null;
                Span loop = null;
                foreach (var sp in spans)
                {
                    if (sp.T0 > t + 1e-9 || t >= sp.T1 - 1e-9) continue;
                    if (sp.Kind == SpanKind.Shot)
                    {
                        // Among one-shots the later physics event wins once its clip has begun.
                        if (shot == null || sp.Order > shot.Order) shot = sp;
                    }
                    else if (loop == null || sp.T0 > loop.T0 || (sp.T0 == loop.T0 && sp.Order > loop.Order)) loop = sp;
                }
                if (shot == null) return loop;
                if (loop == null || shot.T0 >= loop.T0) return shot;
                // A run that began after the one-shot interrupts it; a hold waits for it to finish.
                return loop.Kind == SpanKind.Run ? loop : shot;
            }

            // Between a span's end and a later clip's anticipation (a dive group whose clip starts at its reach
            // marker, say) the web leaves the previous move clamped, so the drawn root would stop short of the path.
            // Here the latest span carries on instead (a moving hold becomes the run or the keeper's shuffle), so the
            // root stays on the path at every instant.
            Span Latest(double t)
            {
                Span latest = null;
                foreach (var sp in spans)
                    if (sp.T0 <= t && (latest == null || sp.T1 > latest.T1)) latest = sp;
                if (latest == null) return null;
                return new Span
                {
                    T0 = latest.T0, T1 = double.PositiveInfinity, Clip = latest.Clip,
                    Kind = latest.Kind == SpanKind.Shot ? SpanKind.Hold : latest.Kind, Start = latest.Start,
                    Rate = latest.Rate, Blend = latest.Blend, Facing = latest.Facing, Turn = latest.Turn,
                    Order = latest.Order
                };
            }

            // Interval boundaries: every sample, every span edge, and the steps inside spans that turn or extend.
            var cuts = new List<double>();
            foreach (var t in times) if (t <= tEnd) cuts.Add(t);
            cuts.Add(tEnd);
            foreach (var sp in spans)
            {
                var a = Clamp(sp.T0, tFirst, tEnd);
                var b = Clamp(sp.T1, tFirst, tEnd);
                cuts.Add(a);
                cuts.Add(b);
                if (sp.Step > 0)
                    for (var t = a + sp.Step; t < b - 1e-6; t += sp.Step) cuts.Add(t);
            }
            cuts.Sort();
            var boundaries = new List<double>();
            foreach (var t in cuts)
                if (boundaries.Count == 0 || t - boundaries[boundaries.Count - 1] > 0.0015) boundaries.Add(t);

            Group RunGroupAt(double t)
            {
                foreach (var g in groups)
                    if (g.Action == "run" && g.T0 <= t && t < g.T1 + 1e-9) return g;
                return null;
            }
            var topSpeeds = new Dictionary<Group, double>();
            double TopSpeed(Group g)
            {
                double cached;
                if (topSpeeds.TryGetValue(g, out cached)) return cached;
                var top = 0.0;
                for (var i = g.I0; i <= Math.Min(g.I1 + 1, count - 1) - 1; i++)
                {
                    var dt = times[i + 1] - times[i];
                    if (dt > 0) top = Math.Max(top, Hypot(w[i + 1].x - w[i].x, w[i + 1].z - w[i].z) / dt);
                }
                topSpeeds[g] = top;
                return top;
            }

            var moves = new List<ProductionFieldingMove>();
            var heading = context.Heading;
            var runPhase = 0.0;
            var previousKey = string.Empty;
            var previousEnd = double.NaN;
            // The crossfade running now: when it began, from which move, and for how long.
            var fadeStart = double.NegativeInfinity;
            var fadeFrom = -1;
            var fadeSeconds = 0.0;
            for (var k = 0; k + 1 < boundaries.Count; k++)
            {
                var a = boundaries[k];
                var b = boundaries[k + 1];
                var sp = Pick((a + b) / 2) ?? Latest((a + b) / 2);
                if (sp == null) continue;
                var from = RootAt(a);
                var to = RootAt(b);
                var dt = b - a;
                var moved = Hypot(to.x - from.x, to.z - from.z);
                var v = moved / dt;
                var clip = sp.Clip;
                var clipStart = sp.Start + (a - sp.T0) * sp.Rate;
                var rate = sp.Rate;
                var hasLower = false;
                var lower = ProductionFieldingClip.Run;
                var lowerStart = 0.0;
                var lowerRate = 0.0;
                var facing = sp.Facing;
                var turn = sp.Turn;
                var blend = sp.Blend;

                if (sp.Kind == SpanKind.Run || (sp.Kind == SpanKind.Hold && v > StillMetresPerSecond))
                {
                    if (v <= StillMetresPerSecond)
                    {
                        // Arrived and waiting (for the ball, a throw or the rope): standing ready, watching the ball.
                        clip = holdClip;
                        clipStart = context.Phase + a;
                        facing = faceBall;
                        turn = 4;
                        blend = 200;
                    }
                    else if (context.Keeper && !sawRun && sp.Kind == SpanKind.Hold)
                    {
                        // The keeper's step across to the line: a crouched shuffle, square to the bowler.
                        clip = ProductionFieldingClip.KeepShuffle;
                        rate = Clamp(v / 2.2, 0.8, 1.6);
                        clipStart = runPhase;
                        runPhase += dt * rate;
                        facing = Fixed(KeeperHeading);
                    }
                    else
                    {
                        var g = RunGroupAt(a);
                        var drive = g != null && (a - g.T0 < DrivePhaseSeconds || v < DrivePhaseSpeed * TopSpeed(g));
                        clip = drive ? ProductionFieldingClip.RunDrive : ProductionFieldingClip.Run;
                        rate = RunRate(v, drive);
                        clipStart = runPhase;
                        runPhase += dt * rate;
                        var fx = to.x - from.x;
                        var fz = to.z - from.z;
                        facing = (t, at) => moved > 0.05f ? HeadingOf(fx, fz) : (float?)null;
                        turn = 9;
                    }
                }
                else if (sp.Kind == SpanKind.Shot && v > LegsRunMetresPerSecond && !ProductionFieldingClips.IsDive(sp.Clip))
                {
                    // Taken on the move: the arms do the pickup or the catch while the legs keep running.
                    hasLower = true;
                    lower = ProductionFieldingClip.Run;
                    lowerRate = RunRate(v, false);
                    lowerStart = runPhase;
                    runPhase += dt * lowerRate;
                    if (facing == null)
                    {
                        var fx = to.x - from.x;
                        var fz = to.z - from.z;
                        facing = (t, at) => moved > 0.05f ? HeadingOf(fx, fz) : (float?)null;
                    }
                }

                // Continuous clip time (same clip, no jump) needs no crossfade.
                var key = clip + "|" + (hasLower ? lower.ToString() : string.Empty);
                var continuous = key == previousKey &&
                                 (ProductionFieldingClips.IsRun(clip) || clip == ProductionFieldingClip.KeepShuffle ||
                                  Math.Abs(clipStart - previousEnd) < 1e-6);
                if (continuous) blend = 0;
                previousKey = key;
                previousEnd = clipStart + dt * rate;
                var moveBlendStart = double.NaN;
                var moveBlendFrom = -1;
                var moveBlendSeconds = blend / 1000.0;
                if (!continuous)
                {
                    fadeStart = a;
                    fadeFrom = moves.Count - 1;
                    fadeSeconds = moveBlendSeconds;
                }
                else if (fadeFrom >= 0 && fadeSeconds > 0.0 && a - fadeStart < fadeSeconds)
                {
                    // The same clip carried on past a boundary while its fade is still running: keep fading.
                    moveBlendStart = fadeStart;
                    moveBlendFrom = fadeFrom;
                    moveBlendSeconds = fadeSeconds;
                }

                var h0 = heading;
                var want = facing?.Invoke(b, to);
                if (want.HasValue)
                    heading = h0 + Mathf.Clamp(AngleDelta(h0, want.Value), -turn * (float)dt, turn * (float)dt);
                var bodyFrom = sp.Body?.Invoke(a);
                var bodyTo = sp.Body?.Invoke(b);
                moves.Add(new ProductionFieldingMove(
                    a, Math.Max(a + 0.001, b), clip, clipStart, rate, hasLower, lower, lowerStart,
                    hasLower ? lowerRate : rate, from, to, h0, heading, moveBlendSeconds,
                    bodyFrom.HasValue || bodyTo.HasValue, bodyFrom ?? Vector3.zero, bodyTo ?? Vector3.zero,
                    moveBlendStart, moveBlendFrom));
            }
            return new ProductionFieldingTrack(moves.ToArray());
        }

        /// <summary>
        /// Post-ball reactions on the spot (script.ts fieldReactions), each after the physical event that earns it: a
        /// wicket (stumps broken, catch taken, or the LBW decision), a ball beaten past the edge (after the keeper's
        /// take), a chase that lost the race to the rope (after the boundary), and the receiver's take of a throw.
        /// Who caught it, the keeper and the bowler already move in the physics paths. Returns fielderId → reaction.
        /// </summary>
        public static Dictionary<string, (double time, ProductionFieldingClip clip)> Reactions(
            CanonicalDeliveryTrace trace,
            IReadOnlyList<(string id, string role, double x, double z)> fielders,
            string dismissal,
            string outcomeFielderId,
            bool swung,
            string contactKind,
            bool mirror)
        {
            var output = new Dictionary<string, (double, ProductionFieldingClip)>(StringComparer.Ordinal);
            if (trace == null || fielders == null) return output;
            double? At(string kind)
            {
                foreach (var e in trace.events) if (e.kind == kind) return e.t;
                return null;
            }
            double Jitter(string id, double k) =>
                ProductionFielding.Fnv1a32("react:" + id) % 1000u / 1000.0 * k;
            var deadT = At("dead") ?? trace.durationSeconds;
            if (!string.IsNullOrEmpty(dismissal))
            {
                var tD = dismissal == "bowled"
                    ? At("stumps") ?? deadT
                    : dismissal == "lbw" ? deadT + 0.4 : At("catch") ?? At("keeper_take") ?? deadT;
                foreach (var f in fielders)
                {
                    if (f.role == "keeper" || f.role == "bowler" || f.id == outcomeFielderId) continue;
                    output[f.id] = ProductionFielding.IsCloseRole(f.role)
                        ? (tD + 0.2 + Jitter(f.id, 0.25), ProductionFieldingClip.CelebrateJump)
                        : (tD + 0.45 + Jitter(f.id, 0.5), ProductionFieldingClip.Clap);
                }
                return output;
            }
            var boundary = At("boundary");
            if (boundary.HasValue)
            {
                // Only the fielders who chased it down (fielding.ts chasedBall), not everyone who moved.
                TraceVector3 end = null;
                foreach (var e in trace.events) if (e.kind == "boundary") { end = e.p; break; }
                foreach (var f in fielders)
                {
                    var path = PathOf(trace, f.id);
                    if (end != null && path != null &&
                        ProductionFielding.ChasedBall(path, f.role, f.x, f.z, end.x, end.z, boundary.Value))
                        output[f.id] = (boundary.Value + 0.35 + Jitter(f.id, 0.3), ProductionFieldingClip.HandsOnHips);
                }
                return output;
            }
            var take = At("keeper_take");
            if (take.HasValue && swung && contactKind == "miss")
            {
                foreach (var f in fielders)
                    if (f.role == "slip" || f.role == "gully")
                        output[f.id] = (take.Value + 0.15 + Jitter(f.id, 0.15), ProductionFieldingClip.HandsOnHead);
                return output;
            }
            if (At("throw").HasValue && trace.ball.Length > 0)
            {
                var end = trace.ball[trace.ball.Length - 1].p;
                foreach (var f in fielders)
                {
                    if (f.role != "keeper" && f.role != "bowler") continue;
                    var last = LastSample(trace, f.id);
                    if (last == null || Math.Sqrt((last.x - end.x) * (last.x - end.x) + (last.z - end.z) * (last.z - end.z)) > 2.5)
                        continue;
                    var clip = f.role == "keeper" ? ProductionFieldingClip.KeepTake : ProductionFieldingClip.CatchChest;
                    output[f.id] = (deadT - ProductionFieldingClips.Marker(clip, "catch", 0.3f), clip);
                }
            }
            return output;
        }

        private static FielderTraceSample[] PathOf(CanonicalDeliveryTrace trace, string id)
        {
            foreach (var path in trace.fielders)
                if (path.fielderId == id && path.samples != null && path.samples.Length > 0) return path.samples;
            return null;
        }

        private static FielderTraceSample LastSample(CanonicalDeliveryTrace trace, string id)
        {
            foreach (var path in trace.fielders)
                if (path.fielderId == id && path.samples.Length > 0) return path.samples[path.samples.Length - 1];
            return null;
        }

        public static float HeadingOf(float dx, float dz) => Mathf.Atan2(dx, dz);

        public static float AngleDelta(float from, float to)
        {
            var d = (to - from) % (Mathf.PI * 2f);
            if (d > Mathf.PI) d -= Mathf.PI * 2f;
            if (d < -Mathf.PI) d += Mathf.PI * 2f;
            return d;
        }

        public static float LerpAngle(float a, float b, float t) => a + AngleDelta(a, b) * t;

        public static float EaseInOut(float t) =>
            t < 0.5f ? 4f * t * t * t : 1f - Mathf.Pow(-2f * t + 2f, 3f) / 2f;

        private static double SmoothStep(double a, double b, double v)
        {
            var t = b == a ? (v >= b ? 1.0 : 0.0) : Clamp((v - a) / (b - a), 0.0, 1.0);
            return t * t * (3.0 - 2.0 * t);
        }

        private static double Clamp(double value, double min, double max) => value < min ? min : value > max ? max : value;
        private static float Hypot(float x, float z) => Mathf.Sqrt(x * x + z * z);
        private static double Hypot(double x, double z) => Math.Sqrt(x * x + z * z);
    }

    /// <summary>Shared fielding helpers.</summary>
    public static class ProductionFielding
    {
        private static readonly HashSet<string> CloseRoles =
            new HashSet<string>(StringComparer.Ordinal) { "slip", "gully", "leg_slip", "short_leg", "silly_point" };

        /// <summary>A chase counts above this share of the fielder's class top speed (fielding.ts CHASE_SPEED_SHARE).</summary>
        public const double ChaseSpeedShare = 0.7;
        /// <summary>…and when it ended at least this much nearer the rope crossing (fielding.ts CHASE_GAIN_M).</summary>
        public const double ChaseGainMetres = 2.0;
        /// <summary>
        /// The physics' class top speeds and the deep boundary (src/physics/fielding.ts ATHLETICS, DEEP_FROM_M; the
        /// striker reference is geometry.ts STRIKER_REF, z = CONTACT_Z = 10.06 − 1.22 − 0.25). The trace does not
        /// carry them; ProductionFieldingChoreographyTests pins these against the TypeScript source, so they cannot
        /// drift silently.
        /// </summary>
        public const double KeeperTopSpeed = 6.5;
        public const double BowlerTopSpeed = 7.0;
        public const double CloseTopSpeed = 6.5;
        public const double RingTopSpeed = 7.5;
        public const double DeepTopSpeed = 8.0;
        public const double DeepFromMetres = 38.0;
        public const double StrikerReferenceZ = 10.06 - 1.22 - 0.25;

        public static bool IsCloseRole(string role) => role != null && CloseRoles.Contains(role);

        /// <summary>The physics fielderClass() top speed for a fielder at its set position (physics frame).</summary>
        public static double ClassTopSpeed(string role, double x, double z)
        {
            if (role == "keeper") return KeeperTopSpeed;
            if (role == "bowler") return BowlerTopSpeed;
            if (IsCloseRole(role)) return CloseTopSpeed;
            var dz = z - StrikerReferenceZ;
            return Math.Sqrt(x * x + dz * dz) > DeepFromMetres ? DeepTopSpeed : RingTopSpeed;
        }

        /// <summary>
        /// fielding.ts chasedBall(): whether a path chased the ball to the rope crossing (endX, endZ; the path's own
        /// frame) by `untilT`: running faster than 0.7 of the class top speed over a window of at least 0.2 s (so a
        /// path's millimetre rounding cannot fake it), and ending at least 2 m nearer the crossing. The keeper and the
        /// bowler go to their stumps, never after the ball.
        /// </summary>
        public static bool ChasedBall(FielderTraceSample[] samples, string role, double x, double z, double endX,
            double endZ, double untilT)
        {
            if (role == "keeper" || role == "bowler" || samples == null || samples.Length < 2) return false;
            var s = samples;
            var top = ClassTopSpeed(role, x, z);
            var peak = 0.0;
            for (int i = 0, j = 0; i < s.Length && s[i].t <= untilT + 1e-9; i++)
            {
                while (j < s.Length && s[j].t - s[i].t < 0.2 - 1e-9) j++;
                if (j >= s.Length) break;
                peak = Math.Max(peak, Hypot(s[j].x - s[i].x, s[j].z - s[i].z) / (s[j].t - s[i].t));
            }
            var atX = s[s.Length - 1].x;
            var atZ = s[s.Length - 1].z;
            for (var i = 0; i + 1 < s.Length; i++)
            {
                if (s[i + 1].t < untilT) continue;
                var u = s[i + 1].t > s[i].t ? Math.Min(1.0, Math.Max(0.0, (untilT - s[i].t) / (s[i + 1].t - s[i].t))) : 1.0;
                atX = s[i].x + (s[i + 1].x - s[i].x) * u;
                atZ = s[i].z + (s[i + 1].z - s[i].z) * u;
                break;
            }
            var gain = Hypot(s[0].x - endX, s[0].z - endZ) - Hypot(atX - endX, atZ - endZ);
            return peak > ChaseSpeedShare * top && gain >= ChaseGainMetres;
        }

        private static double Hypot(double x, double z) => Math.Sqrt(x * x + z * z);

        /// <summary>A deterministic per-fielder phase into looping holds (0–2 s).</summary>
        public static float PhaseFor(string id) => Fnv1a32(id ?? string.Empty) % 1000u / 500f;

        public static uint Fnv1a32(string value)
        {
            var hash = 0x811c9dc5u;
            unchecked
            {
                for (var index = 0; index < value.Length; index++)
                {
                    hash ^= value[index];
                    hash *= 0x01000193u;
                }
            }
            return hash;
        }
    }
}
