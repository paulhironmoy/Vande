using System;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Vande.Practice.Presentation.Production.Motion;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation
{
    /// <summary>
    /// The face-and-life Director on the Unity world (UNITY-E2): the stage binding (Production/Director/Stage) wired to the world's own clocks,
    /// run-up and ball. Per drawn frame the world sets each rig's life (breath, sway, hip roll, posture, twist: the rig adds it to every pose it
    /// applies, before the foot and arm solves) at the top of <c>Tick</c> and runs the head pass (the neck and head to the plan's head in space,
    /// under the section 9 caps) at the end of it, on the finished bones. Plans are baked in the spare slices of frames (a budget after the
    /// frame), never in the call that registers a script: <c>BeginDelivery</c> and <c>AcceptResult</c> only queue.
    /// Honest by construction: the plan sees the ball only as this world draws it, the opponent only as a point to look at, and the result only
    /// through the anchors the live ball does not have; the quiet windows are zero in the plan, and every pass is a no-op (bit for bit) when its
    /// channels are zero. Any failure switches the Director off for the session and the world draws as it always did.
    /// </summary>
    public sealed partial class ProceduralPracticeWorld
    {
        /// <summary>The spare time a frame gives the Director's bakes after it is drawn (at least one slice of 64 integration steps is always taken).</summary>
        internal const double DirectorWorkBudgetMs = 0.5;

        /// <summary>The look seed of the striker (the web's cast: practice:batter).</summary>
        internal const string DirectorStrikerLook = "practice:batter";

        private static bool? directorEnvironmentOff;

        /// <summary>
        /// Builder seam (A/B in one build): false draws the world as it was before the Director (no life, no head pass, no bakes). The Editor harness
        /// reads VANDE_DIRECTOR=off once; a device build is always on.
        /// </summary>
        internal bool DirectorEnabled { get; set; } = !DirectorSwitchedOffByEnvironment();

        /// <summary>
        /// Builder seam (A/B in one build; UNITY-E2): a striker who has begun his stroke (the press) and whose result has not arrived keeps his head
        /// still in space, the way a batter does through the swing, and the world already holds his body in the load until the result (UNITY-5 F2:
        /// "the torso is where the press left it, the bat is the only thing that has moved"). False lets the head follow the ball through the committed
        /// swing, which moves it 6 to 28 degrees before a result that arrives 3 to 10 frames after the commitment.
        /// </summary>
        internal bool DirectorHoldsHeadInCommittedSwing { get; set; } = true;

        /// <summary>Builder seam (A/B in one build): false runs the head pass without the bone caps and the world guard, to show what the pass itself asks of the bones.</summary>
        internal bool DirectorHeadLimiterEnabled { get; set; } = true;

        /// <summary>Builder seam (UNITY-9 A/B in one build): false lets the head pass draw a head that turns faster in the world than the section 9 cap while the body is quiet (the bowler's look back through the walk-back: 930 to 1,300 deg/s).</summary>
        internal bool DirectorHeadWorldCapEnabled { get; set; } = true;

        private bool DirectorStrikerHeadHeld()
        {
            return DirectorHoldsHeadInCommittedSwing && DeliveryActive && localPreparation && !canonicalBat;
        }

        private static bool DirectorSwitchedOffByEnvironment()
        {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            if (!directorEnvironmentOff.HasValue)
                directorEnvironmentOff = string.Equals(Environment.GetEnvironmentVariable("VANDE_DIRECTOR"), "off", StringComparison.Ordinal);
            return directorEnvironmentOff.Value;
#else
            return false;
#endif
        }

        private DirectorStageRuntime directorStage;
        private DirectorStageRuntime.Script directorScript;
        private DirectorStageRuntime.Script directorLiveScript;
        private DirectorStageRuntime.Script directorResultScript;
        private DirectorStageRuntime.Script directorNextIdle;
        private StageDeliveryInputs directorInputs;
        private DirectorStageGeometry directorLiveGeometry;
        private readonly DirectedFrame[] directedFrames = { new DirectedFrame(), new DirectedFrame() };
        private readonly DirectorLife[] directedLives = { new DirectorLife(), new DirectorLife() };
        private readonly DirectorHeadPass[] directedHeads = new DirectorHeadPass[2];
        private readonly ProductionCharacterRig[] directedHeadRigs = new ProductionCharacterRig[2];
        private double directorSceneMs;
        private double directorIdleMs;
        // The clock of the head pass's rate limit: the world's own presentation time, continuous across the scripts (scene time restarts with each).
        private double directorClockMs;
        private bool directorFrameOn;
        private string directorBowlerLook = string.Empty;
        private string directorFailure;

#if UNITY_EDITOR || DEVELOPMENT_BUILD
        // Builder evidence: what the last frame's two halves cost (microseconds), the begin (plans sampled, life set) and the end (head passes, spare-time bakes).
        private long directorBeginStart;
        internal double DirectorLastBeginMicroseconds { get; private set; }
        internal double DirectorLastEndMicroseconds { get; private set; }
        internal double DirectorLastWorkMicroseconds { get; private set; }
#endif

        /// <summary>The failure that switched the Director off for this session (null: none). Builder evidence and tests.</summary>
        internal string DirectorFailureForEvidence => directorFailure;

        internal DirectorStageRuntime DirectorStageForEvidence => directorStage;
        internal double DirectorSceneMsForEvidence => directorSceneMs;
        internal DirectorStageRuntime.Script DirectorScriptForEvidence => directorScript;
        internal DirectedFrame DirectedFrameForEvidence(DirectorRole role) => directedFrames[(int)role];
        internal DirectorLife DirectedLifeForEvidence(DirectorRole role) => directedLives[(int)role];
        internal DirectorHeadPass DirectedHeadPassForEvidence(DirectorRole role) => directedHeads[(int)role];

        private ProductionCharacterRig DirectedRig(DirectorRole role) => role == DirectorRole.Bowler ? bowlerRig : batterRig;

        private void EnsureDirector()
        {
            if (directorStage != null) return;
            directorStage = new DirectorStageRuntime();
            directorStage.Detail = 0;
        }

        private void DirectorFail(Exception error)
        {
            // The Director never breaks a delivery: it is switched off for the session and the world draws as it always did.
            directorFailure = error.GetType().Name + ": " + error.Message;
            DirectorEnabled = false;
            DirectorClearLife();
            directorFrameOn = false;
            Debug.LogWarning("VANDE Director switched off: " + directorFailure);
        }

        /// <summary>Both rigs draw with no life (the next pose they apply is the pose as it always was): the quiet moments of the world's own measurements.</summary>
        private void DirectorClearLife()
        {
            directedLives[0].Clear();
            directedLives[1].Clear();
            for (var role = 0; role < 2; role++)
            {
                var rig = DirectedRig((DirectorRole)role);
                if (rig != null && !rig.IsDisposed) rig.DirectedLife = directedLives[role];
            }
        }

        /// <summary>
        /// Takes the head passes off the bones (the neck and head go back to what the world left them with) before anything of the world's touches them:
        /// the arms' IK on a held pose and the neck clearance read the head, and must not answer a turn the Director made.
        /// </summary>
        private void DirectorUndoHeadPasses()
        {
            for (var r = 0; r < 2; r++)
            {
                var pass = directedHeads[r];
                var rig = DirectedRig((DirectorRole)r);
                if (pass != null && rig != null && !rig.IsDisposed && ReferenceEquals(directedHeadRigs[r], rig)) pass.Undo(rig.PoseSerial);
            }
        }

        private void DirectorOnScene(PracticeScenePresentation scene)
        {
            directorBowlerLook = scene != null && scene.BowlerLookSeed != null ? scene.BowlerLookSeed : string.Empty;
        }

        // ---- the physics frame ------------------------------------------------------------------------------------------

        /// <summary>The striker's eye in the stance (physics frame): the stance head of the frozen body plus the scene's lateral and crease offsets.</summary>
        private StageVec DirectorStrikerEye()
        {
            var offset = batterBody != null ? batterBody.transform.position - nominalBatterWorldPosition : Vector3.zero;
            // batterBody(null).head.c = (-0.2, 1.62, PITCH_HALF - 1.2); the eye is 0.06 above it (script.ts batterEye)
            return new StageVec(-0.2 + PresentationMirror * offset.x, 1.62 + 0.06, 10.06 - 1.2 + offset.z);
        }

        /// <summary>A snapshot of the bowler's composed run-up (the root's track): a pure function of the visible time, whatever the world does next.</summary>
        private sealed class DirectorBowlerTrack
        {
            public ProductionBowlerRunUp RunUp;
            public Vector3 Anchor;
            public float K;
            public float ReleaseGroundX;
            public float ReleaseGroundZ;
            public double ApproachSeconds;

            // code-authored run-up (no composed clips)
            public Vector3 Start;
            public Vector3 Release;
            public ProductionCharacterMotion Motion;
            public bool Pace;
            public float ArmSign;
            public float ReleaseSpeed;

            public void Root(double visibleSeconds, out double x, out double z, out double yawDeg)
            {
                if (RunUp != null)
                {
                    float gx, gz, yaw;
                    if (visibleSeconds <= ApproachSeconds + 1e-9)
                        RunUp.GroundVisible(visibleSeconds, out gx, out gz, out yaw);
                    else
                        RunUp.Ground(Math.Min(RunUp.TRelease + (visibleSeconds - ApproachSeconds), RunUp.TEnd), out gx, out gz, out yaw);
                    x = Anchor.x + (gx - ReleaseGroundX) * K;
                    z = Anchor.z + (gz - ReleaseGroundZ) * K;
                    yawDeg = yaw;
                    return;
                }
                yawDeg = 0;
                if (visibleSeconds <= ApproachSeconds)
                {
                    var amount = (float)Math.Max(0.0, visibleSeconds / ApproachSeconds);
                    var p = Vector3.Lerp(Start, Release, BowlerRootTravelNormalized(amount, Motion));
                    x = p.x;
                    z = p.z;
                    return;
                }
                // the natural follow-through (no convergence onto the physics bowler's spot: that depends on the result)
                var t = (float)(visibleSeconds - ApproachSeconds);
                var brakeMetres = Pace ? 3.2f : 1.6f;
                var brakeSeconds = Mathf.Max(0.2f, 2f * brakeMetres / Mathf.Max(0.5f, ReleaseSpeed));
                var u = Mathf.Clamp01(t / brakeSeconds);
                var forward = brakeMetres * (2f * u - u * u);
                var lateral = (Pace ? 0.35f : 0.30f) * ArmSign * u * u * (3f - 2f * u);
                x = Release.x + lateral;
                z = Release.z + forward;
            }
        }

        private DirectorBowlerTrack DirectorSnapshotBowlerTrack()
        {
            var track = new DirectorBowlerTrack { ApproachSeconds = bowlingPresentation.ApproachSeconds };
            if (bowlerRunUp != null)
            {
                track.RunUp = bowlerRunUp;
                track.Anchor = bowlerRunUpAnchor;
                track.K = bowlerRunUpScale * MotionPacks.Vmp.UnityDriverHorizontalScale;
                track.ReleaseGroundX = bowlerRunUpReleaseGroundX;
                track.ReleaseGroundZ = bowlerRunUpReleaseGroundZ;
                return track;
            }
            track.Start = bowlerStartPosition;
            track.Release = bowlerReleasePosition;
            track.Motion = bowlingPresentation.Motion;
            track.Pace = bowlingPresentation.Role == ProductionCharacterRole.PaceBowler;
            track.ArmSign = (bowlerArmLeft ? -1f : 1f) * PresentationMirror;
            track.ReleaseSpeed = BowlerReleaseTravelRate(bowlingPresentation.Motion) * bowlingPresentation.ApproachDistanceMetres /
                                 Mathf.Max(0.1f, bowlingPresentation.ApproachSeconds);
            return track;
        }

        private DirectorStageGeometry DirectorBaseGeometry(double releaseMs)
        {
            var track = DirectorSnapshotBowlerTrack();
            return new DirectorStageGeometry
            {
                Mirror = PresentationMirror,
                Scale = bowler != null ? bowler.transform.localScale.y : 1.0,
                ArmLeft = bowlerArmLeft,
                StrikerEyePosition = DirectorStrikerEye(),
                Root = track.Root,
                ReleaseMs = releaseMs,
            };
        }

        // ---- registering the scripts ------------------------------------------------------------------------------------

        /// <summary>Abandons every script of the Director (a new delivery, or the scene between balls, begins): their geometry no longer answers for them.</summary>
        private void DirectorRetireAll()
        {
            if (directorStage == null) return;
            directorStage.Retire(directorLiveScript);
            directorStage.Retire(directorResultScript);
            if (directorScript != directorNextIdle) directorStage.Retire(directorScript);
            directorLiveScript = null;
            directorResultScript = null;
            directorScript = null;
        }

        /// <summary>A delivery begins (after the bowler's approach is prepared): queue its plans; nothing is baked here.</summary>
        private void DirectorOnBeginDelivery(PracticeDeliveryPresentation value)
        {
            if (!DirectorEnabled) return;
            // A delivery the host did not time cannot be directed: the striker's task (watch the ball to the bat) has no end, and the ball no
            // flight to follow. (A delivery packet always carries its flight and ideal contact; the legacy tests' hand-made ones do not.)
            if (value == null || value.Flight == null || value.Flight.Length < 2 || !(value.IdealContactT > 0.0))
            {
                // (and the scene between balls that was showing is over: nothing directs this ball, not even its leftovers)
                if (directorStage != null)
                {
                    directorStage.Retire(directorNextIdle);
                    directorNextIdle = null;
                    DirectorRetireAll();
                }
                directorScript = null;
                return;
            }
            try
            {
                EnsureDirector();
                // a scene baked ahead for a ball that did not end in the scene between balls (another delivery begins first) is dropped
                directorStage.Retire(directorNextIdle);
                directorNextIdle = null;
                DirectorRetireAll();
                var approachMs = bowlingPresentation.ApproachSeconds * 1000.0;
                double? gather = null;
                double? followEnd = null;
                if (bowlerRunUp != null)
                {
                    gather = approachMs - (bowlerRunUp.TRelease - bowlerRunUp.TEntry) * 1000.0;
                    followEnd = (bowlerRunUp.TEnd - bowlerRunUp.Plan.PreRoll) * 1000.0;
                }
                directorInputs = new StageDeliveryInputs
                {
                    Seed = value.Seed,
                    BowlerLook = directorBowlerLook,
                    StrikerLook = DirectorStrikerLook,
                    ReleaseMs = approachMs,
                    GatherMs = gather,
                    FollowEndMs = followEnd,
                    Flight = value.Flight,
                    IdealContactT = value.IdealContactT,
                };
                var spec = StageSpecs.Live(directorInputs);
                directorLiveGeometry = DirectorBaseGeometry(approachMs);
                directorLiveGeometry.Flight = value.Flight;
                directorLiveGeometry.LiveVisibleUntilMs = spec.FlightEnd ?? double.PositiveInfinity;
                directorLiveScript = directorStage.Register(spec, StageKind.Live, directorLiveGeometry, null);
                directorScript = directorLiveScript;
                directorSceneMs = 0;
            }
            catch (Exception error)
            {
                DirectorFail(error);
            }
        }

        /// <summary>A result is accepted (at the end of the accept): queue its plans, with the live ones standing in; nothing is baked here.</summary>
        private void DirectorOnAcceptResult(PracticeResultPresentation result)
        {
            if (!DirectorEnabled || directorStage == null || result == null || result.Trace == null) return;
            try
            {
                var trace = result.Trace;
                var live = directorScript != null && directorScript.ScriptKind == StageKind.Live ? directorScript : null;
                // A result is the continuation of a delivery the Director directed, or a replay (directed from the trace alone); the result of a
                // delivery drawn undirected is drawn undirected too.
                if (live == null && !result.IsReplay) return;
                var sameDelivery = directorInputs != null && directorLiveGeometry != null &&
                                   string.Equals(directorInputs.Seed ?? string.Empty, result.RecordSeed ?? directorInputs.Seed ?? string.Empty, StringComparison.Ordinal);
                StageDeliveryInputs inputs;
                DirectorStageGeometry baseGeometry;
                if (sameDelivery)
                {
                    inputs = directorInputs;
                    baseGeometry = directorLiveGeometry;
                }
                else
                {
                    // a replay of another delivery: its flight is the trace's own ball, the bowler the one the world has
                    var approachMs = bowlingPresentation.ApproachSeconds * 1000.0;
                    var touch = StageSpecs.TouchT(trace);
                    inputs = new StageDeliveryInputs
                    {
                        Seed = result.RecordSeed,
                        BowlerLook = directorBowlerLook,
                        StrikerLook = DirectorStrikerLook,
                        ReleaseMs = approachMs,
                        Flight = trace.ball,
                        IdealContactT = trace.batterMotion != null && trace.bat != null && trace.bat.Length > 0
                            ? trace.batterMotion.contactT
                            : touch ?? StageSpecs.PassT(trace.ball, 0.0),
                    };
                    baseGeometry = DirectorBaseGeometry(approachMs);
                    baseGeometry.Flight = null;
                }
                var stumpsT = StageSpecs.FirstEventT(trace, "stumps") ?? (directorInputs != null && sameDelivery ? directorInputs.IdealContactT : 0.0);
                var closeness = StageSpecs.StumpsCloseness(inputs.Flight, stumpsT);
                var spec = StageSpecs.Result(inputs, trace, result.Dismissal, result.ContactKind, result.DeliveryRuns, result.SwingStartT,
                    closeness, string.Equals(result.ShotIntent, "leave", StringComparison.Ordinal));
                var flightEnd = inputs.Flight != null && inputs.Flight.Length > 0 ? inputs.Flight[inputs.Flight.Length - 1].t : double.NegativeInfinity;
                var split = sameDelivery ? Math.Min(StageSpecs.TouchT(trace) ?? double.PositiveInfinity, flightEnd) : double.NegativeInfinity;
                var geometry = baseGeometry.ForResult(trace.ball, split);
                var kind = live != null ? StageKind.Result : StageKind.Replay;
                var script = directorStage.Register(spec, kind, geometry, live);
                if (script == null) return;
                directorResultScript = script;
                directorScript = script;
                if (kind == StageKind.Replay) directorSceneMs = spec.Striker.Release ?? 0;
                // The scene between balls that follows is baked in the spare slices of the frames of this ball (after the result's own plans),
                // so that its plans are there when it is shown and the actors do not stand still while they are baked.
                if (directorNextIdle == null || directorNextIdle.IsRetired) directorNextIdle = DirectorRegisterIdle(true);
            }
            catch (Exception error)
            {
                DirectorFail(error);
            }
        }

        private DirectorStageRuntime.Script DirectorRegisterIdle(bool prefetch)
        {
            var geometry = new DirectorStageGeometry
            {
                Mirror = PresentationMirror,
                Scale = bowler != null ? bowler.transform.localScale.y : 1.0,
                ArmLeft = bowlerArmLeft,
                StrikerEyePosition = DirectorStrikerEye(),
                StandX = bowlerStartPosition.x,
                StandZ = bowlerStartPosition.z,
                NoBall = true,
            };
            return directorStage.Register(StageSpecs.Idle(directorBowlerLook, DirectorStrikerLook), StageKind.Idle, geometry, null, prefetch);
        }

        /// <summary>The scene between balls begins: a loop of its own, its plans fade in while it shows (baked ahead, while the ball was on, when it can be).</summary>
        private void DirectorEnterIdle()
        {
            var ahead = directorNextIdle;
            directorNextIdle = null;
            DirectorRetireAll();
            if (ahead != null && !ahead.IsRetired)
            {
                ahead.Prefetch = false;
                directorScript = ahead;
            }
            else directorScript = DirectorRegisterIdle(false);
            directorIdleMs = 0;
            directorSceneMs = 0;
        }

        // ---- the frame --------------------------------------------------------------------------------------------------

        /// <summary>The scene time this frame draws at, and the script it draws from; false when the Director has nothing to do (paused, no script).</summary>
        private bool DirectorSelectScript(double deltaSeconds)
        {
            var approach = bowlingPresentation.ApproachSeconds;
            switch (state)
            {
                case WorldState.Idle:
                    if (directorScript == null || directorScript.ScriptKind != StageKind.Idle) DirectorEnterIdle();
                    if (directorScript == null) return false;
                    directorIdleMs += deltaSeconds * 1000.0;
                    if (directorIdleMs >= DirectorStageRuntime.IdleLoopMs) directorIdleMs -= DirectorStageRuntime.IdleLoopMs;
                    directorSceneMs = directorIdleMs;
                    return true;
                case WorldState.RunUp:
                case WorldState.Flight:
                    if (directorScript == null) return false;
                    directorSceneMs = (timeline + deltaSeconds + approach) * 1000.0;
                    return true;
                case WorldState.Resolved:
                {
                    if (directorScript == null) return false;
                    var p = timeline;
                    if (playback != null)
                    {
                        p = playback.Time + deltaSeconds * playbackSpeed;
                        if (acceptedTrace != null) p = Math.Min(acceptedTrace.durationSeconds, p);
                    }
                    directorSceneMs = (p + approach) * 1000.0;
                    return true;
                }
                case WorldState.Recovery:
                case WorldState.Outcome:
                    if (directorScript == null) return false;
                    directorSceneMs += deltaSeconds * 1000.0;
                    return true;
                default:
                    return false;
            }
        }

        /// <summary>Top of the frame: samples the plans and sets each rig's life, before any pose of the frame is applied.</summary>
        private void DirectorBeginFrame(double deltaSeconds)
        {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            directorBeginStart = System.Diagnostics.Stopwatch.GetTimestamp();
            DirectorBeginFrameCore(deltaSeconds);
            DirectorLastBeginMicroseconds = (System.Diagnostics.Stopwatch.GetTimestamp() - directorBeginStart) * 1e6 / System.Diagnostics.Stopwatch.Frequency;
        }

        private void DirectorBeginFrameCore(double deltaSeconds)
        {
#endif
            directorFrameOn = false;
            if (!built) return;
            DirectorUndoHeadPasses();
            directorClockMs += deltaSeconds * 1000.0;
            if (!DirectorEnabled || benchmarkActive)
            {
                DirectorClearLife();
                return;
            }
            try
            {
                EnsureDirector();
                directorStage.SetReducedMotion(settings != null && settings.ReducedMotion);
                if (!DirectorSelectScript(deltaSeconds))
                {
                    if (state != WorldState.Paused) DirectorClearLife();
                    return;
                }
                for (var r = 0; r < 2; r++)
                {
                    var role = (DirectorRole)r;
                    var rig = DirectedRig(role);
                    var frame = directedFrames[r];
                    if (rig == null || rig.IsDisposed || !rig.Root.gameObject.activeInHierarchy)
                    {
                        frame.Clear();
                        continue;
                    }
                    rig.DirectedLife = directedLives[r];
                    directorStage.Frame(directorScript, role, directorSceneMs, frame);
                    directedLives[r].Set(frame.On && frame.HasChannels ? frame.Ch : null, frame.W, frame.On ? frame.Seam : null);
                    directorStage.NoteLife(role, directedLives[r]);
                }
                directorFrameOn = true;
            }
            catch (Exception error)
            {
                DirectorFail(error);
            }
        }

        /// <summary>
        /// The world re-posed the rig outside a frame (a result was accepted): the heads get the turn they had back, on the new base, so that the bones
        /// are never seen without it between two frames (and the cap, which hangs from the head, goes with them).
        /// </summary>
        private void DirectorRedoHeadPasses()
        {
            if (!DirectorEnabled || benchmarkActive) return;
            for (var r = 0; r < 2; r++)
            {
                var pass = directedHeads[r];
                var rig = DirectedRig((DirectorRole)r);
                if (pass == null || rig == null || rig.IsDisposed || !ReferenceEquals(directedHeadRigs[r], rig)) continue;
                if (pass.Redo(rig.PoseSerial, directorClockMs)) rig.FollowHeadPassWithCap();
            }
        }

        private DirectorHeadPass DirectorHeadPassFor(DirectorRole role)
        {
            var r = (int)role;
            var rig = DirectedRig(role);
            if (rig == null || rig.IsDisposed) return null;
            if (directedHeads[r] != null && ReferenceEquals(directedHeadRigs[r], rig)) return directedHeads[r];
            Transform chest, neck, head;
            if (!rig.TryGetVisibleHeadBones(out chest, out neck, out head)) return null;
            directedHeadRigs[r] = rig;
            directedHeads[r] = new DirectorHeadPass(chest, neck, head, role);
            return directedHeads[r];
        }

        /// <summary>End of the frame: the head pass on the finished bones, then the spare time of the frame for the bakes.</summary>
        private void DirectorEndFrame()
        {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            var start = System.Diagnostics.Stopwatch.GetTimestamp();
            DirectorEndFrameCore();
            DirectorLastEndMicroseconds = (System.Diagnostics.Stopwatch.GetTimestamp() - start) * 1e6 / System.Diagnostics.Stopwatch.Frequency - DirectorLastWorkMicroseconds;
        }

        private void DirectorEndFrameCore()
        {
            DirectorLastWorkMicroseconds = 0;
#endif
            if (!directorFrameOn) return;
            directorFrameOn = false;
            try
            {
                var mirror = PresentationMirror;
                for (var r = 0; r < 2; r++)
                {
                    var role = (DirectorRole)r;
                    var frame = directedFrames[r];
                    if (!frame.On) continue;
                    var pass = DirectorHeadPassFor(role);
                    if (pass == null) continue;
                    var rig = DirectedRig(role);
                    pass.LimiterEnabled = DirectorHeadLimiterEnabled;
                    pass.WorldCapEnabled = DirectorHeadWorldCapEnabled;
                    pass.Apply(frame, directorClockMs, mirror, directorStage.Drawn(role), rig.PoseSerial, role == DirectorRole.Striker && DirectorStrikerHeadHeld());
                    rig.FollowHeadPassWithCap();
                }
                if (directorStage.Busy)
                {
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                    var workStart = System.Diagnostics.Stopwatch.GetTimestamp();
                    directorStage.Work(DirectorWorkBudgetMs, directorScript);
                    DirectorLastWorkMicroseconds = (System.Diagnostics.Stopwatch.GetTimestamp() - workStart) * 1e6 / System.Diagnostics.Stopwatch.Frequency;
#else
                    directorStage.Work(DirectorWorkBudgetMs, directorScript);
#endif
                }
            }
            catch (Exception error)
            {
                DirectorFail(error);
            }
        }
    }
}
