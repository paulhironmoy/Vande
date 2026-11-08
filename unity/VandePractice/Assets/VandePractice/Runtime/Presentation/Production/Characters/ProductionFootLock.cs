using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Presentation-only planted-foot layer for a physics-driven body (a fielder, the keeper, the bowler after his
    /// release), after the web's planted-foot plan (src/render3d/core/locomotion.ts FootPlan). A foot its clip keeps
    /// down is held where it landed (the visible hero's leg IK), so a standing turn to watch the ball, or the planner's
    /// sub-0.3 m/s "standing" drift, no longer skates it (UNITY-2 r1: the bowler's Ready hold slid 7.8 cm while his
    /// heading turned; fielders 4-18 cm). When the clip's own foot has drifted more than StepMetres from the hold (lead
    /// ruling 2026-11-04: about 8 cm) or the body has turned more than StepYawRadians over it, the foot takes a lifted
    /// step to where the clip has it, one foot at a time; when the clip lifts the foot (a run, a dive, a stride) the hold
    /// hands it back over ReleaseSeconds. A held foot keeps the clip's own height (a heel may lift). Nothing else moves:
    /// the root, the hips, the arms, the physics path and every event time are untouched.
    /// </summary>
    public sealed class ProductionFootLock
    {
        /// <summary>A foot is down while its ankle is within this height (m, scale 1) of its lowest so far.</summary>
        public const float ContactBandMetres = 0.07f;
        /// <summary>A down foot lands (is held) only while its clip moves it slower than this (m/s).</summary>
        public const float LandSpeedMetresPerSecond = 0.35f;
        public const float StepMetres = 0.08f;
        public const float StepYawRadians = 0.6f;
        public const float StepSeconds = 0.24f;
        public const float StepLiftMetres = 0.07f;
        public const float ReleaseSeconds = 0.09f;

        private enum FootState { Free, Planted, Stepping }

        private struct Foot
        {
            public FootState State;
            public Vector3 Anchor;
            public float AnchorYaw;
            public Vector3 From;
            public float Elapsed;
            public float Duration;
            public float Lift;
            public Vector3 Last;
            public bool HasLast;
            public float LowestY;
        }

        private readonly ProductionCharacterRig rig;
        private Foot left;
        private Foot right;

        public ProductionFootLock(ProductionCharacterRig rig)
        {
            this.rig = rig ?? throw new ArgumentNullException(nameof(rig));
            Reset();
        }

        public ProductionCharacterRig Rig => rig;

        /// <summary>The largest horizontal distance (m) a held or stepping foot was drawn from its clip foot.</summary>
        public float LastHoldOffsetMetres { get; private set; }

        /// <summary>Forgets every hold (a new ball, a cut, a teleport).</summary>
        public void Reset()
        {
            left = new Foot { LowestY = float.PositiveInfinity };
            right = new Foot { LowestY = float.PositiveInfinity };
            LastHoldOffsetMetres = 0f;
        }

        /// <summary>Call once a frame after the pose is final (clips, reaches, the held ball).</summary>
        public void Apply(float deltaSeconds)
        {
            if (!rig.HasCompleteHero) return;
            var dt = Mathf.Max(1e-4f, deltaSeconds);
            var scale = Mathf.Max(0.1f, rig.Root.lossyScale.x);
            var yaw = rig.Root.eulerAngles.y * Mathf.Deg2Rad;
            var leftNow = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootLeft);
            var rightNow = rig.HeroJointWorldPosition(ProductionCharacterJoint.FootRight);
            var leftTarget = Advance(ref left, right.State == FootState.Stepping, leftNow, yaw, scale, dt);
            var rightTarget = Advance(ref right, left.State == FootState.Stepping, rightNow, yaw, scale, dt);
            LastHoldOffsetMetres = Mathf.Max(Horizontal(leftTarget - leftNow), Horizontal(rightTarget - rightNow));
            if ((leftTarget - leftNow).sqrMagnitude < 1e-10f && (rightTarget - rightNow).sqrMagnitude < 1e-10f) return;
            rig.PlantHeroFeetOn(leftTarget, rightTarget);
        }

        private static float Horizontal(Vector3 v) => Mathf.Sqrt(v.x * v.x + v.z * v.z);

        private static Vector3 Advance(ref Foot foot, bool otherStepping, Vector3 clip, float yaw, float scale, float dt)
        {
            var speed = foot.HasLast ? Horizontal(clip - foot.Last) / dt : 0f;
            foot.Last = clip;
            foot.HasLast = true;
            foot.LowestY = Mathf.Min(foot.LowestY, clip.y);
            var down = clip.y <= foot.LowestY + ContactBandMetres * scale;
            switch (foot.State)
            {
                case FootState.Stepping:
                {
                    foot.Elapsed += dt;
                    var x = Mathf.Clamp01(foot.Elapsed / Mathf.Max(1e-4f, foot.Duration));
                    if (x < 1f)
                    {
                        var u = x * x * (3f - 2f * x);
                        var at = Vector3.Lerp(foot.From, clip, u);
                        at.y = Mathf.Lerp(foot.From.y, clip.y, u) + foot.Lift * Mathf.Sin(Mathf.PI * x);
                        return at;
                    }
                    // Landed where the clip has the foot now: held there if it is down.
                    foot.State = down ? FootState.Planted : FootState.Free;
                    foot.Anchor = clip;
                    foot.AnchorYaw = yaw;
                    return clip;
                }
                case FootState.Planted:
                {
                    var hold = new Vector3(foot.Anchor.x, clip.y, foot.Anchor.z);
                    if (!down)
                    {
                        // The clip lifts the foot itself (a run, a dive, a stride): hand it back without a pop.
                        Begin(ref foot, hold, ReleaseSeconds, 0f);
                        return hold;
                    }
                    var twist = Mathf.Abs(Mathf.DeltaAngle(foot.AnchorYaw * Mathf.Rad2Deg, yaw * Mathf.Rad2Deg)) *
                                Mathf.Deg2Rad;
                    if ((Horizontal(clip - foot.Anchor) > StepMetres * scale || twist > StepYawRadians) && !otherStepping)
                    {
                        // Turned or drifted too far over the held foot: a lifted step to where the clip has it.
                        Begin(ref foot, hold, StepSeconds, StepLiftMetres * scale);
                        return hold;
                    }
                    return hold;
                }
                default:
                    if (down && speed <= LandSpeedMetresPerSecond)
                    {
                        foot.State = FootState.Planted;
                        foot.Anchor = clip;
                        foot.AnchorYaw = yaw;
                    }
                    return clip;
            }
        }

        private static void Begin(ref Foot foot, Vector3 from, float seconds, float lift)
        {
            foot.State = FootState.Stepping;
            foot.From = from;
            foot.Elapsed = 0f;
            foot.Duration = seconds;
            foot.Lift = lift;
        }
    }
}
