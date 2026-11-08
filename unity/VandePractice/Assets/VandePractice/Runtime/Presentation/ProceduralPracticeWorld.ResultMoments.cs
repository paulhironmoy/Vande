using System;
using UnityEngine;
using Vande.Practice.Bridge;
using Vande.Practice.MotionPacks;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Motion;

namespace Vande.Practice.Presentation
{
    /// <summary>
    /// The Target Chase result moments on the Unity world (UNI-07): after the physics has decided the deciding ball of a chase, the
    /// striker and the bowler play one of the four `result_moments` clips (the web's src/render3d/practice/resultMoments.ts,
    /// MOTION-SPEC section 11) through the C# VMP reader. Unity renders state and never decides a result: the verdict is the host's
    /// `chase.outcome` (bridge contract v7) on the result of the live ball and on its replay; the moment is a pure function of that
    /// verdict, the trace and the actor's own business (ProductionResultMoments), so a replay draws what the live ball drew.
    /// <para>
    /// How: AcceptResult plans the two actors' start times on the trace clock (the physics event plus a latency of 200 to 600 ms,
    /// and no sooner than the actor's own stroke, run or follow-through is over). Every frame TickCore advances `momentClock` (the
    /// trace time while the ball is played, then real time: the clips hold their last frame to the next ball). From its start an
    /// actor is posed from the clip at the end of the frame, over whatever the world just drew for him, through the canonical mirror
    /// at sampling, and handed over from the pose on screen by an inertial blend of 260 ms (the hero skeleton's world-space transition
    /// the striker's and the non-striker's other hand-overs use; 400 ms into Reduced Motion's held marker frame).
    /// The striker's root stays on his stance (the clip's origin, 0.3 m from it, rides in the hips as for every striker pack pose) and
    /// only the walk-off moves it, along the clip's own ground track in his stance heading; the bowler is planted where he stood. The
    /// striker's physics-body fit and his pad and foot locks are released at the start; the bowler's foot lock too. The striker's bat
    /// stays in the rig's character grip, in his bottom hand only (BatterOneHandCarry, the carry the running gait and the non-striker
    /// use), with the rig's own grip solve following it: the clip's bat keys are a hint to the author's arm, and a bat set from them
    /// flipped the hero's elbow (see ResultMomentBatFromKeys). The Director's face and life channels are not touched.
    /// </para>
    /// </summary>
    public sealed partial class ProceduralPracticeWorld
    {
        /// <summary>Builder seam (A/B in one build): false plays no result moment, the world as it was before UNI-07.</summary>
        internal bool ResultMomentsEnabled { get; set; } = true;

        /// <summary>Builder seam (A/B in one build): the striker's clip is posed as a placed pack pose, as TRACKB's anticipation and strokes are (the grip solve keeps the clip's own elbow planes); false solves the holder arm on the chest poles.</summary>
        internal bool ResultMomentPlacedPose { get; set; } = true;

        /// <summary>
        /// Builder seam (A/B in one build): the fraction of the holder arm's length the bat's grip target may be from his shoulder (0: no limit). A bat the clip
        /// raises to the very end of a straight arm is carried with the hand instead (shifted towards the shoulder by the excess), so the arm solve never meets
        /// the straight-arm singularity, where the forearm's roll flips by tens of degrees in a frame.
        /// </summary>
        internal float ResultMomentReachFraction { get; set; } = 0f;

        /// <summary>
        /// Builder seam (A/B in one build): how the striker's bat is placed in his bottom hand. false (the default for the clips since UNI-07) leaves it in the rig's
        /// character grip, on the clip's own hand (the carry the gait uses; the hero's hand follows it by the same grip solve a pose always makes, a few
        /// centimetres at most); true sets the bat from the clip's bat.grip/dir/face keys (SetCanonicalBatPose), which pulls the hero's arm to a point the clip
        /// authored for another arm length, and flips its elbow between two shoulder-reach solutions when the clip lifts the bat to the end of the arm.
        /// </summary>
        internal bool ResultMomentBatFromKeys { get; set; } = false;

        private float momentBatAngleDegrees;
        private float momentBatGripCentimetres;

        /// <summary>One actor's planned moment on one result.</summary>
        private sealed class ResultMomentActor
        {
            public string ClipId;
            public VmpClip Clip;
            public ProductionPackPose Pose;
            /// <summary>The earliest start on the trace clock (s after the release).</summary>
            public double StartT;
            public bool Started;
            /// <summary>The frame the clip began on: the hand-over starts in it.</summary>
            public bool JustBegan;
            /// <summary>The moment clock the clip began at (its own time 0).</summary>
            public double BeganAt;
            /// <summary>The ground point the clip's origin stands on, and the heading he stood in and the one the clip faces.</summary>
            public Vector3 Anchor;
            /// <summary>The striker's actor origin less his root, on the ground (m): the stance poses carry it in the hips, so the root never jumps to it.</summary>
            public Vector3 OriginDelta;
            public float FromYaw;
            public float Yaw;
            public Vector3 Ground0;
            public bool RootMoved;
            /// <summary>The bowler's own inertial hand-over (the striker's is FinishStrikerFrame's).</summary>
            public bool TransitionActive;
            public double TransitionElapsed;
            public double TransitionSeconds;
            public bool SourceCaptured;
            /// <summary>This clip's hand-over (s): the usual 260 ms (400 into Reduced Motion), lengthened when a bone has far to turn (see MeasureHandOver).</summary>
            public double HandOverSeconds;
            /// <summary>The visible joints' world rotations in the frame the clip began, before it was posed (to measure how far each bone has to turn).</summary>
            public Quaternion[] BeforeWorld;
        }

        private ResultMomentActor momentStriker;
        private ResultMomentActor momentBowler;
        private ResultMomentOutcome momentOutcome;
        private double momentClock;
        private bool momentPending;
        private bool momentStrikerSwitched;

        private static ResultMomentOutcome MomentOutcomeOf(PracticeChaseOutcome outcome)
        {
            switch (outcome)
            {
                case PracticeChaseOutcome.Won: return ResultMomentOutcome.Won;
                case PracticeChaseOutcome.LostWicket: return ResultMomentOutcome.LostWicket;
                case PracticeChaseOutcome.LostBalls: return ResultMomentOutcome.LostBalls;
                default: return ResultMomentOutcome.None;
            }
        }

        private bool StrikerMomentOwnsBody => momentStriker != null && momentStriker.Started;
        private bool BowlerMomentOwnsBody => momentBowler != null && momentBowler.Started;

        /// <summary>
        /// Plans the moment of a decided chase from the accepted result (called once the accept has built the playback, the stroke and the
        /// running plan). Nothing is planned for ordinary Practice or a chase still in progress, so those frames are untouched.
        /// </summary>
        private void PrepareResultMoment(PracticeResultPresentation result)
        {
            if (!ResultMomentsEnabled || result == null || result.Chase == null || !result.Chase.Decided || playback == null) return;
            var outcome = MomentOutcomeOf(result.Chase.Outcome);
            if (outcome == ResultMomentOutcome.None) return;
            var pack = ProductionMotionPacks.Get(ProductionResultMoments.Pack);
            if (pack == null) return;
            bool boundary;
            var eventT = ProductionResultMoments.EventTime(outcome, result.Dismissal, result.Trace, out boundary);
            momentOutcome = outcome;
            // The accept on the trace clock: a result that arrives late starts the moment from now, never in the past.
            momentClock = playback.Time;
            var strikerId = ProductionResultMoments.StrikerClipId(outcome);
            var strikerClip = ProductionMotionPacks.Clip(ProductionResultMoments.Pack, strikerId);
            if (strikerClip != null && batterRig != null && batterBody != null)
            {
                momentStriker = new ResultMomentActor
                {
                    ClipId = strikerId,
                    Clip = strikerClip,
                    Pose = new ProductionPackPose(pack.MaxTrackCount),
                    StartT = ProductionResultMoments.StrikerStart(outcome, boundary, eventT, StrikerOwnBusinessEndT(), momentClock)
                };
            }

            var bowlerId = ProductionResultMoments.BowlerClipId(outcome);
            var bowlerClip = ProductionMotionPacks.Clip(ProductionResultMoments.Pack, bowlerId);
            // No bowler clip (the pack was baked without his two, decision D2): he walks back as ever, no stand-in.
            if (bowlerClip != null && bowlerRig != null && bowler != null)
            {
                var start = ProductionResultMoments.BowlerStart(outcome, eventT, BowlerFollowThroughEndT(), momentClock);
                momentBowler = new ResultMomentActor
                {
                    ClipId = bowlerId,
                    Clip = bowlerClip,
                    Pose = new ProductionPackPose(pack.MaxTrackCount),
                    StartT = BowlerBuiltInCelebrationEndT(start)
                };
            }

            momentPending = momentStriker != null || momentBowler != null;
        }

        /// <summary>
        /// Where the striker's own business ends (trace s): his stroke and follow-through (the pack stroke's end, which is never before the
        /// early recovery's start), or his last run and its pull-up. Zero when he has done nothing (a leave, a miss with no bat sample).
        /// </summary>
        private double StrikerOwnBusinessEndT()
        {
            var end = 0.0;
            if (packStroke.Valid) end = Math.Max(end, packStroke.EndT);
            if (!double.IsPositiveInfinity(earlyRecoveryStartT)) end = Math.Max(end, earlyRecoveryStartT);
            if (runningPlan.Runs > 0) end = Math.Max(end, runningPlan.LastEndT + ProductionResultMoments.RunPullUpSeconds);
            return end;
        }

        /// <summary>Where the bowler's follow-through ends (trace s, from the release): the composed run-up's end, else the code-authored bowling clip's.</summary>
        private double BowlerFollowThroughEndT()
        {
            if (bowlerRunUp != null) return Math.Max(0.0, bowlerRunUp.TEnd - bowlerRunUp.TRelease);
            var release = Math.Max(0.05, (double)bowlingPresentation.ReleaseNormalized);
            var approach = Math.Max(0.1, (double)bowlingPresentation.ApproachSeconds);
            return (1.0 - release) * approach / release;
        }

        /// <summary>
        /// A start that falls inside the bowler's own built-in celebration (his arms are up) waits for it to finish rather than cutting
        /// it mid-jump (resultMoments.ts bowlerMoment).
        /// </summary>
        private double BowlerBuiltInCelebrationEndT(double start)
        {
            foreach (var pair in fielderRoleById)
            {
                if (pair.Value != "bowler") continue;
                ProductionFieldingTrack track;
                if (!fieldingTracks.TryGetValue(pair.Key, out track)) continue;
                for (var index = 0; index < track.Moves.Count; index++)
                {
                    var move = track.Moves[index];
                    if (move.Clip == ProductionFieldingClip.CelebrateJump && move.T0 < start - 0.001 && start < move.T1)
                        return move.T1;
                }
            }

            return start;
        }

        /// <summary>Drops the planned moment (a new ball, a new scene, a replay, a stop) and gives the striker's root back to the stance.</summary>
        private void ClearResultMoment()
        {
            var striker = momentStriker;
            var bowlerMoment = momentBowler;
            momentStriker = null;
            momentBowler = null;
            momentOutcome = ResultMomentOutcome.None;
            momentPending = false;
            momentStrikerSwitched = false;
            ProductionFootLock footLock;
            if (striker != null && striker.Started)
            {
                if (striker.RootMoved && batterBody != null)
                {
                    // The root stood on the clip's anchor, upright; the stance's root is turned about and rolled (PositionBatterBody).
                    batterBody.transform.rotation = Quaternion.Euler(0f, 180f, -3f * PresentationMirror);
                    RestoreNominalBatterRoot();
                }

                if (batterRig != null)
                {
                    batterRig.BatterOneHandCarry = false;
                    batterRig.ResetTorsoRateGovernor();
                    if (footLocks.TryGetValue(batterRig, out footLock)) footLock.Reset();
                }

                strikerFootLock?.Reset();
                strikerTransitionActive = false;
            }

            if (bowlerMoment != null && bowlerMoment.Started && bowlerRig != null && footLocks.TryGetValue(bowlerRig, out footLock))
                footLock.Reset();
        }

        /// <summary>The moment clock: the trace clock while the ball is played (set in the Resolved tick), real time after it.</summary>
        private void AdvanceMomentClock(double deltaSeconds)
        {
            if (momentPending && state != WorldState.Resolved && state != WorldState.Paused) momentClock += deltaSeconds;
        }

        // ---- the striker ------------------------------------------------------------------------------------------------------------

        /// <summary>
        /// Poses the striker from his clip, over what the frame drew for him (called just before FinishStrikerFrame, which hands the
        /// displayed pose over inertially on the first frame). Waits, with the clip not begun, while another hand-over is still settling.
        /// </summary>
        private void PresentStrikerResultMoment()
        {
            var actor = momentStriker;
            if (actor == null || batterRig == null || batterBody == null) return;
            var first = false;
            if (!actor.Started)
            {
                if (momentClock < actor.StartT - 1e-9) return;
                // The hand-over blends from the pose captured at the end of the last frame; while another hand-over runs there is none.
                if (strikerTransitionActive || !strikerSourceCaptured) return;
                BeginStrikerMoment(actor);
                first = true;
            }

            PlaceStrikerMoment(actor, momentClock - actor.BeganAt);
            if (first) actor.HandOverSeconds = MeasureHandOver(batterRig, actor);
        }

        /// <summary>
        /// The foot lock holds the running striker's planted feet after FinishStrikerFrame has taken the hand-over's source, so what is on screen is the source with the lock's
        /// correction (20 to 40 degrees at the thighs, shins and feet after a run) on top. While his clip waits, the source is taken again from what the lock left, so that the
        /// clip's first frame leaves the pose on screen and not the legs without the lock (a one-frame step into the walk-off after the thin edge's runs).
        /// </summary>
        private void RecaptureStrikerSourceAfterFootLocks()
        {
            var actor = momentStriker;
            if (actor == null || actor.Started || batterRig == null || strikerTransitionActive || !strikerSourceCaptured) return;
            batterRig.CaptureHeroTransitionSource();
        }

        private void BeginStrikerMoment(ResultMomentActor actor)
        {
            var leftHander = settings != null && settings.Handedness == "left";
            var stance = 90f * PresentationMirror;
            var root = batterRig.Root;
            actor.Anchor = new Vector3(root.position.x, 0f, root.position.z);
            actor.OriginDelta = Vector3.zero;
            if (strikerRunning)
            {
                // He is wherever his run left him, in the heading the gait presenter turned him to.
                actor.FromYaw = root.eulerAngles.y;
            }
            else
            {
                // He stands at his stance, side-on (the actor frame of every striker pack clip). The clip's origin is the stance's hips point, not his
                // root (they are 0.3 m apart): the root stays where it is, and the difference rides in the hips as it does for every striker pack pose.
                var origin = StrikerActorOrigin();
                actor.OriginDelta = new Vector3(origin.x - actor.Anchor.x, 0f, origin.z - actor.Anchor.z);
                actor.FromYaw = stance;
            }

            // The walk-off goes straight ahead the way he faced in his stance (his off side), never along the pitch; the celebration stays as he is.
            actor.Yaw = actor.ClipId == ProductionResultMoments.StrikerLost ? stance : actor.FromYaw;
            actor.Pose.SampleInto(actor.Clip, 0.0, leftHander);
            actor.Ground0 = actor.Pose.Ground;
            CaptureVisibleWorld(batterRig, ref actor.BeforeWorld);
            actor.HandOverSeconds = ResultMomentHandOverSeconds();
            actor.Started = true;
            actor.JustBegan = true;
            actor.BeganAt = momentClock;
            momentStrikerSwitched = true;
            // The torso governor measures rotations against the root: the root is about to stand on the clip's own anchor, so its last frame is void.
            batterRig.ResetTorsoRateGovernor();
            // His arms have stood in the follow-through since the stroke's last solve: what they remember is what is on screen, so the grip solve of the clip's first
            // frame takes the glove's turn about the handle at its own rate (a complete miss's hold left it 30 degrees from its fitting turn, which was a 46 degree step).
            batterRig.HoldArmMemory(1.0 / 60.0);
        }

        private void PlaceStrikerMoment(ResultMomentActor actor, double playedFor)
        {
            var leftHander = settings != null && settings.Handedness == "left";
            var reduced = settings != null && settings.ReducedMotion;
            var sampleT = ProductionResultMoments.SampleTime(actor.Clip, playedFor, reduced, ProductionResultMoments.ReducedMarker(actor.ClipId));
            actor.Pose.SampleInto(actor.Clip, sampleT, leftHander);
            var root = batterRig.Root;
            var walkOff = actor.ClipId == ProductionResultMoments.StrikerLost;
            var position = actor.Anchor;
            var yaw = actor.Yaw;
            if (walkOff)
            {
                // Reduced Motion: he stands where he is in the slump, no walk and no turn.
                if (reduced) yaw = actor.FromYaw;
                else
                {
                    // The clip's ground track, along his stance heading (x is already mirrored with the clip); the turn to that heading takes the standing beat.
                    var ground = actor.Pose.Ground - actor.Ground0;
                    position += Quaternion.AngleAxis(actor.Yaw, Vector3.up) * new Vector3(ground.x, 0f, ground.z) * root.localScale.x;
                    yaw = ProductionResultMoments.WalkOffYaw(actor.FromYaw, actor.Yaw, playedFor);
                }
            }

            root.SetPositionAndRotation(position, Quaternion.AngleAxis(yaw + actor.Pose.GroundYawDegrees, Vector3.up));
            actor.RootMoved = true;
            // The clip's origin stands OriginDelta from the root (a world vector, constant while the root turns): carried in the hips.
            var pose = actor.Pose.Pose;
            var clipRootOffset = pose.RootOffset;
            Vector3 cap, toe, face;
            var hasBat = actor.Pose.TryGetBatCapToe((float)BridgeConstants.CanonicalBatLengthMetres, out cap, out toe, out face);
            if (actor.OriginDelta.sqrMagnitude > 1e-10f)
            {
                var local = root.InverseTransformVector(actor.OriginDelta);
                pose.RootOffset = clipRootOffset + local;
                if (hasBat)
                {
                    cap += local;
                    toe += local;
                }
            }

            // The physics-body fit is released (the web releases the striker's body fit at the clip's start), and the bat is carried in the bottom hand.
            batterRig.ClearCanonicalBatterBodyFrame();
            batterRig.SetCanonicalBatterPosture(0f);
            batterRig.BatterOneHandCarry = true;
            batterRig.ResetBatToCharacterGrip();
            if (hasBat && ResultMomentBatFromKeys && ResultMomentReachFraction > 0f)
            {
                // The hero is posed from the clip first (its shoulder is where the clip puts it), then the bat is brought inside the arm's comfortable reach.
                batterRig.PlacedPose = ResultMomentPlacedPose;
                try
                {
                    batterRig.ApplyPose(pose);
                }
                finally
                {
                    batterRig.PlacedPose = false;
                }

                if (batterRig.VisibleHeroSkeletonActive)
                {
                    var holderLeft = batterRig.Handedness != ProductionCharacterHandedness.Right;
                    var shoulder = batterRig.HeroJointWorldPosition(holderLeft ? ProductionCharacterJoint.UpperArmLeft : ProductionCharacterJoint.UpperArmRight);
                    var elbow = batterRig.HeroJointWorldPosition(holderLeft ? ProductionCharacterJoint.ForearmLeft : ProductionCharacterJoint.ForearmRight);
                    var wrist = batterRig.HeroJointWorldPosition(holderLeft ? ProductionCharacterJoint.HandLeft : ProductionCharacterJoint.HandRight);
                    var armLength = Vector3.Distance(shoulder, elbow) + Vector3.Distance(elbow, wrist);
                    var capWorld = root.TransformPoint(cap);
                    var downWorld = (root.TransformPoint(toe) - capWorld).normalized;
                    var target = capWorld + downWorld * ProductionCharacterRig.BatterLowerHandGripOffsetMetres;
                    var distance = Vector3.Distance(shoulder, target);
                    var limit = armLength * ResultMomentReachFraction;
                    if (distance > limit && distance > 1e-4f)
                    {
                        var shift = root.InverseTransformVector((shoulder - target).normalized * (distance - limit));
                        cap += shift;
                        toe += shift;
                    }
                }
            }

            // Posed as a placed pack pose, as TRACKB's anticipation and strokes are: the grip solve keeps the clip's own elbow planes (A/B in the scanner: no difference
            // in the pops; the bat from the clip's keys was the cause of the holder arm's flips, see ResultMomentBatFromKeys).
            batterRig.PlacedPose = ResultMomentPlacedPose;
            try
            {
                batterRig.ApplyPose(pose);
                if (hasBat && ResultMomentBatFromKeys)
                {
                    batterRig.SetCanonicalBatPose(
                        root.TransformPoint(cap),
                        root.TransformPoint(toe),
                        face.sqrMagnitude > 1e-6f ? root.TransformDirection(face) : Vector3.zero,
                        1f, false, false);
                }
            }
            finally
            {
                batterRig.PlacedPose = false;
                pose.RootOffset = clipRootOffset;
            }

            // Builder evidence: how far the bat stands from where the clip's keys put it (the keys are a hint to the author's arm, not a target for the hero's).
            if (hasBat && batterRig.Bat != null)
            {
                var keyGrip = root.TransformPoint(cap);
                var keyDown = (root.TransformPoint(toe) - keyGrip).normalized;
                momentBatGripCentimetres = Vector3.Distance(batterRig.Bat.position, keyGrip) * 100f;
                momentBatAngleDegrees = Vector3.Angle(batterRig.Bat.TransformDirection(Vector3.down), keyDown);
            }

            strikerPackActive = true;
        }

        // ---- the bowler -------------------------------------------------------------------------------------------------------------

        /// <summary>Poses the bowler from his clip over what the frame drew for him, planted where he stood when it began.</summary>
        private void PresentBowlerResultMoment()
        {
            var actor = momentBowler;
            if (actor == null || bowlerRig == null || bowler == null) return;
            if (!actor.Started)
            {
                if (momentClock < actor.StartT - 1e-9) return;
                actor.Started = true;
                actor.JustBegan = true;
                actor.BeganAt = momentClock;
                actor.Anchor = new Vector3(bowler.transform.position.x, 0f, bowler.transform.position.z);
                actor.Yaw = bowler.transform.eulerAngles.y;
                CaptureVisibleWorld(bowlerRig, ref actor.BeforeWorld);
            }

            var reduced = settings != null && settings.ReducedMotion;
            var sampleT = ProductionResultMoments.SampleTime(actor.Clip, momentClock - actor.BeganAt, reduced,
                ProductionResultMoments.ReducedMarker(actor.ClipId));
            // A left-arm bowler mirrors the whole actor and raises his own left arm (the clips are right-armed).
            actor.Pose.SampleInto(actor.Clip, sampleT, bowlerArmLeft);
            bowler.transform.SetPositionAndRotation(actor.Anchor, Quaternion.AngleAxis(actor.Yaw + actor.Pose.GroundYawDegrees, Vector3.up));
            bowlerRig.ApplyPose(actor.Pose.Pose);
            UpdateCharacterPresentationDistance(bowler, bowlerRig);
            actor.RootMoved = true;
            if (actor.JustBegan) actor.HandOverSeconds = MeasureHandOver(bowlerRig, actor);
        }

        /// <summary>
        /// The bowler's inertial hand-over into his clip, and the capture of the displayed pose it blends from (every frame until the clip
        /// has begun, so the source is always the last frame's): the non-striker's mechanism (FinishNonStrikerFrame).
        /// </summary>
        private void FinishBowlerMomentFrame(float deltaSeconds)
        {
            var actor = momentBowler;
            if (actor == null || bowlerRig == null) return;
            if (actor.JustBegan)
            {
                actor.JustBegan = false;
                if (actor.SourceCaptured)
                {
                    actor.TransitionActive = true;
                    actor.TransitionElapsed = 0.0;
                    actor.TransitionSeconds = actor.HandOverSeconds;
                }
            }

            if (actor.TransitionActive)
            {
                actor.TransitionElapsed += Math.Max(0f, deltaSeconds);
                var weight = ProductionResultMoments.HandOverWeight(actor.TransitionElapsed, actor.TransitionSeconds);
                bowlerRig.ApplyHeroTransitionBlend(weight);
                if (weight >= 1f) actor.TransitionActive = false;
            }

            if (!actor.TransitionActive)
            {
                bowlerRig.CaptureHeroTransitionSource();
                actor.SourceCaptured = true;
            }
        }

        /// <summary>The hand-over into a clip at least: 260 ms, or 400 ms into Reduced Motion's held marker frame (a gentler, slower ease for a still frame).</summary>
        private double ResultMomentHandOverSeconds() =>
            settings != null && settings.ReducedMotion ? ProductionResultMoments.ReducedHandOverSeconds : ProductionResultMoments.HandOverSeconds;

        private static readonly int[] JointParent = { -1, 0, 1, 2, 3, 2, 5, 6, 2, 8, 9, 0, 11, 12, 0, 14, 15 };

        private static void CaptureVisibleWorld(ProductionCharacterRig rig, ref Quaternion[] into)
        {
            var count = (int)ProductionCharacterJoint.Count;
            if (into == null || into.Length != count) into = new Quaternion[count];
            for (var joint = 0; joint < count; joint++) into[joint] = rig.VisibleJointWorldRotation((ProductionCharacterJoint)joint);
        }

        /// <summary>
        /// The hand-over a clip needs: the usual one, lengthened until no bone's step in a frame can pass 80% of its pop floor (MOTION-SPEC section 9) however far that bone has to
        /// turn from the pose on screen to the clip's first pose (a striker who starts his walk-off after his balanced finish has his hips to turn by more than 100 degrees: at 260 ms
        /// that is a 10 degree step in the very first frame and the torso governor then holds it at its cap). Bones are compared the way the pop scan reads them: the hips in the
        /// world, every other bone against its parent.
        /// </summary>
        private double MeasureHandOver(ProductionCharacterRig rig, ResultMomentActor actor)
        {
            var seconds = ResultMomentHandOverSeconds();
            if (actor.BeforeWorld == null) return seconds;
            var count = (int)ProductionCharacterJoint.Count;
            for (var joint = 0; joint < count; joint++)
            {
                var parent = JointParent[joint];
                var before = parent < 0 ? actor.BeforeWorld[joint] : Quaternion.Inverse(actor.BeforeWorld[parent]) * actor.BeforeWorld[joint];
                var afterJoint = rig.VisibleJointWorldRotation((ProductionCharacterJoint)joint);
                var after = parent < 0
                    ? afterJoint
                    : Quaternion.Inverse(rig.VisibleJointWorldRotation((ProductionCharacterJoint)parent)) * afterJoint;
                var needed = ProductionResultMoments.HandOverSecondsFor(Quaternion.Angle(before, after), ProductionResultMoments.PopFloorDegrees(joint));
                if (needed > seconds) seconds = needed;
            }

            return Math.Min(ProductionResultMoments.MaxHandOverSeconds, seconds);
        }

        // ---- builder evidence -------------------------------------------------------------------------------------------------------

        internal double ResultMomentClockForEvidence => momentClock;
        internal float ResultMomentBatAngleForEvidence => momentBatAngleDegrees;
        internal float ResultMomentBatGripCentimetresForEvidence => momentBatGripCentimetres;
        internal ResultMomentOutcome ResultMomentOutcomeForEvidence => momentOutcome;

        /// <summary>One actor's planned moment: its clip, the earliest start, whether it has begun and the moment clock it began at. False when none is planned.</summary>
        internal bool ResultMomentForEvidence(string role, out string clipId, out double startT, out bool started, out double beganAt)
        {
            var actor = role == "bowler" ? momentBowler : momentStriker;
            clipId = actor != null ? actor.ClipId : null;
            startT = actor != null ? actor.StartT : double.NaN;
            started = actor != null && actor.Started;
            beganAt = actor != null ? actor.BeganAt : double.NaN;
            return actor != null;
        }
    }
}
