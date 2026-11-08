using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Original deterministic cricket motion. The sampler is deliberately explicit: it can be sought for replay,
    /// has named causal markers and does not depend on Animator state, frame rate or random input.
    /// </summary>
    public static class ProductionCharacterMotionSampler
    {
        public const float PaceRunUpComplete = 0.35f;
        public const float PaceGather = 0.43f;
        public const float PaceFrontFootPlant = 0.51f;
        public const float PaceRelease = 0.56f;
        public const float PaceFollowThrough = 0.76f;
        public const float SpinApproachComplete = 0.34f;
        public const float SpinGather = 0.45f;
        public const float SpinFrontFootPlant = 0.55f;
        public const float SpinRelease = 0.61f;
        public const float SpinFollowThrough = 0.81f;
        public const float BatterBacklift = 0.24f;
        public const float BatterFootPlant = 0.43f;
        public const float BatterContact = 0.58f;
        public const float BatterFollowThrough = 0.78f;
        public const float KeeperCollection = 0.34f;
        public const float FielderDiveLand = 0.52f;
        public const float FielderThrowRelease = 0.49f;

        // The locked rear-shoulder camera needs a recognisable batting profile without forcing a licensed human
        // mesh through an extreme corkscrew.  The former 64-degree guard required 34 degrees of neck yaw plus 28
        // degrees at the head; at gameplay distance that deformed the jaw/helmet join and collapsed the shoulders
        // into a robotic diagonal.  Fifty degrees still exposes the shoulder, back-pad and bat relationship while
        // keeping every cervical joint inside a 21-degree anatomical presentation bound.  BatterStance and
        // BatterStroke both consume these constants so their shared t=0 pose cannot drift apart.
        private const float BatterGuardHipsYaw = 32f;
        private const float BatterGuardSpineYaw = 10f;
        private const float BatterGuardChestYaw = 8f;
        private const float BatterGuardNeckYaw = -21f;
        private const float BatterGuardHeadYaw = -21f;
        // Keep both leg chains on the previously admitted 30-degree ground plane while the pelvis opens further.
        // This preserves foot and grounded-bat-toe placement instead of dragging the stance around the hips.
        private const float BatterGuardLegCounterYaw = 30f - BatterGuardHipsYaw;

        public static float DurationSeconds(ProductionCharacterMotion motion)
        {
            switch (motion)
            {
                case ProductionCharacterMotion.PaceBowling: return 2.40f;
                case ProductionCharacterMotion.SpinBowling: return 1.90f;
                case ProductionCharacterMotion.BatterStance: return 2.40f;
                case ProductionCharacterMotion.BatterStroke: return 1.15f;
                case ProductionCharacterMotion.KeeperCrouch: return 1.20f;
                case ProductionCharacterMotion.KeeperCollection: return 0.95f;
                case ProductionCharacterMotion.FielderReady: return 2.40f;
                case ProductionCharacterMotion.FielderRun: return 0.62f;
                case ProductionCharacterMotion.FielderDive: return 1.20f;
                case ProductionCharacterMotion.FielderThrow: return 0.95f;
                case ProductionCharacterMotion.UmpireStand: return 3.00f;
                default: return 1.00f;
            }
        }

        public static bool IsLooping(ProductionCharacterMotion motion)
        {
            return motion == ProductionCharacterMotion.Stand ||
                   motion == ProductionCharacterMotion.BatterStance ||
                   motion == ProductionCharacterMotion.KeeperCrouch ||
                   motion == ProductionCharacterMotion.FielderReady ||
                   motion == ProductionCharacterMotion.FielderRun ||
                   motion == ProductionCharacterMotion.UmpireStand;
        }

        /// <summary>
        /// Returns a process-stable presentation phase for one fielding slot. This deliberately avoids
        /// string.GetHashCode and random state so configuring the same field always produces the same static pose.
        /// </summary>
        public static float StableFielderReadyPhase(string stableId, int stableIndex)
        {
            if (string.IsNullOrEmpty(stableId))
                throw new ArgumentException("A stable fielder id is required.", nameof(stableId));
            if (stableIndex < 0) throw new ArgumentOutOfRangeException(nameof(stableIndex));

            unchecked
            {
                var hash = 2166136261u;
                for (var characterIndex = 0; characterIndex < stableId.Length; characterIndex++)
                {
                    hash ^= stableId[characterIndex];
                    hash *= 16777619u;
                }
                var slot = (uint)stableIndex;
                for (var byteIndex = 0; byteIndex < 4; byteIndex++)
                {
                    hash ^= (slot >> (byteIndex * 8)) & 0xffu;
                    hash *= 16777619u;
                }
                return (hash & 0x00ffffffu) / 16777216f;
            }
        }

        public static bool TryGetMarkerNormalized(ProductionCharacterMotion motion,
            ProductionCharacterMarker marker, out float normalizedTime)
        {
            normalizedTime = 0f;
            if (motion == ProductionCharacterMotion.PaceBowling)
            {
                switch (marker)
                {
                    case ProductionCharacterMarker.RunUpComplete: normalizedTime = PaceRunUpComplete; return true;
                    case ProductionCharacterMarker.Gather: normalizedTime = PaceGather; return true;
                    case ProductionCharacterMarker.FrontFootPlant: normalizedTime = PaceFrontFootPlant; return true;
                    case ProductionCharacterMarker.Release: normalizedTime = PaceRelease; return true;
                    case ProductionCharacterMarker.FollowThrough: normalizedTime = PaceFollowThrough; return true;
                }
            }
            else if (motion == ProductionCharacterMotion.SpinBowling)
            {
                switch (marker)
                {
                    case ProductionCharacterMarker.RunUpComplete: normalizedTime = SpinApproachComplete; return true;
                    case ProductionCharacterMarker.Gather: normalizedTime = SpinGather; return true;
                    case ProductionCharacterMarker.FrontFootPlant: normalizedTime = SpinFrontFootPlant; return true;
                    case ProductionCharacterMarker.Release: normalizedTime = SpinRelease; return true;
                    case ProductionCharacterMarker.FollowThrough: normalizedTime = SpinFollowThrough; return true;
                }
            }
            else if (motion == ProductionCharacterMotion.BatterStroke)
            {
                switch (marker)
                {
                    case ProductionCharacterMarker.Backlift: normalizedTime = BatterBacklift; return true;
                    case ProductionCharacterMarker.FootPlant: normalizedTime = BatterFootPlant; return true;
                    case ProductionCharacterMarker.Contact: normalizedTime = BatterContact; return true;
                    case ProductionCharacterMarker.FollowThrough: normalizedTime = BatterFollowThrough; return true;
                }
            }
            else if (motion == ProductionCharacterMotion.KeeperCollection &&
                     marker == ProductionCharacterMarker.Collection)
            {
                normalizedTime = KeeperCollection;
                return true;
            }
            else if (motion == ProductionCharacterMotion.FielderDive &&
                     marker == ProductionCharacterMarker.Land)
            {
                normalizedTime = FielderDiveLand;
                return true;
            }
            else if (motion == ProductionCharacterMotion.FielderThrow &&
                     marker == ProductionCharacterMarker.Release)
            {
                normalizedTime = FielderThrowRelease;
                return true;
            }
            return false;
        }

        public static void SampleInto(ProductionCharacterMotion motion, float normalizedTime,
            ProductionCharacterHandedness handedness, ProductionCharacterPose output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));

            var time = Mathf.Clamp01(normalizedTime);
            output.Clear();
            switch (motion)
            {
                case ProductionCharacterMotion.PaceBowling:
                    PaceBowling(time, handedness, output);
                    break;
                case ProductionCharacterMotion.SpinBowling:
                    SpinBowling(time, handedness, output);
                    break;
                case ProductionCharacterMotion.BatterStance:
                    BatterStance(time, handedness, output);
                    break;
                case ProductionCharacterMotion.BatterStroke:
                    BatterStroke(time, handedness, ProductionBatterFootwork.Balanced, output);
                    break;
                case ProductionCharacterMotion.KeeperCrouch:
                    KeeperCrouch(time, handedness, output);
                    break;
                case ProductionCharacterMotion.KeeperCollection:
                    KeeperCollectionMotion(time, handedness, output);
                    break;
                case ProductionCharacterMotion.FielderReady:
                    FielderReady(time, handedness, output);
                    break;
                case ProductionCharacterMotion.FielderRun:
                    FielderRun(time, handedness, output);
                    break;
                case ProductionCharacterMotion.FielderDive:
                    FielderDive(time, handedness, output);
                    break;
                case ProductionCharacterMotion.FielderThrow:
                    FielderThrow(time, handedness, output);
                    break;
                case ProductionCharacterMotion.UmpireStand:
                    UmpireStand(time, handedness, output);
                    break;
                default:
                    Stand(time, handedness, output);
                    break;
            }

            if (motion == ProductionCharacterMotion.PaceBowling ||
                motion == ProductionCharacterMotion.SpinBowling)
            {
                var plantAt = motion == ProductionCharacterMotion.PaceBowling
                    ? PaceFrontFootPlant
                    : SpinFrontFootPlant;
                ApplyFrontFootBrace(motion, time, time, plantAt, output);
            }
        }

        /// <summary>
        /// Samples one deterministic bowling action with a subtle host-derived
        /// read cue. The release marker is invariant: cadence can change inside
        /// the approach, but both 0 and the authored release time map exactly to
        /// themselves. Only the pose changes; the caller still places the hand
        /// on the canonical host release point.
        /// </summary>
        public static void SampleBowlingInto(
            ProductionCharacterMotion motion,
            float normalizedTime,
            ProductionCharacterHandedness handedness,
            ProductionBowlingCueProfile cue,
            ProductionCharacterPose output)
        {
            if (motion != ProductionCharacterMotion.PaceBowling &&
                motion != ProductionCharacterMotion.SpinBowling)
                throw new ArgumentException("A bowling motion is required.", nameof(motion));
            if (cue.Motion != motion)
                throw new ArgumentException("The bowling cue does not match the motion family.", nameof(cue));
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));

            var presentationTime = Mathf.Clamp01(normalizedTime);
            var time = RemapBowlingCadence(motion, presentationTime, cue.CadenceWarp);
            SampleInto(motion, time, handedness, output);
            var plantAt = motion == ProductionCharacterMotion.PaceBowling
                ? PaceFrontFootPlant
                : SpinFrontFootPlant;
            var authoredPlantAt = RemapBowlingCadence(motion, plantAt, cue.CadenceWarp);
            // SampleInto applies the uncued brace. Override only its forward root using the stable presentation
            // timeline so a cadence read-cue cannot move the planted interval or the release closure.
            ApplyFrontFootBrace(motion, presentationTime, time, authoredPlantAt, output);
            ApplyBowlingCue(motion, time, handedness, cue, output);
        }

        public static void SampleBatterStrokeInto(float normalizedTime,
            ProductionCharacterHandedness handedness,
            ProductionBatterFootwork footwork,
            ProductionCharacterPose output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (float.IsNaN(normalizedTime) || float.IsInfinity(normalizedTime))
                throw new ArgumentOutOfRangeException(nameof(normalizedTime));
            if (!Enum.IsDefined(typeof(ProductionBatterFootwork), footwork))
                throw new ArgumentOutOfRangeException(nameof(footwork));
            output.Clear();
            BatterStroke(Mathf.Clamp01(normalizedTime), handedness, footwork, output);
        }

        private static void Stand(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var breath = Mathf.Sin(time * Mathf.PI * 2f);
            pose.RootOffset = new Vector3(0f, -0.003f + breath * 0.003f, 0f);
            Set(pose, ProductionCharacterJoint.Spine, 2f + breath, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest, 1f, breath * 0.8f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck, -2f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft, 2f, 0f, 7f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -12f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight, 2f, 0f, -7f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -12f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighLeft, 0f, 0f, 2f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight, 0f, 0f, -2f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 2f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 2f, 0f, 0f, hand);
        }

        private static void PaceBowling(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            // The run-up decays smoothly into a braced gather. The front foot is stable before the release arm
            // reaches its vertical maximum, then the torso and rear leg continue through the crease.
            var run = 1f - Smooth(PaceRunUpComplete - 0.05f, PaceGather, time);
            // Seven grounded steps across the visible approach read as a real run-up; the old three-step cycle
            // translated several metres per planted foot and made the figure skate towards the crease.
            var runPhase = time / PaceRunUpComplete * Mathf.PI * 7f;
            var stride = Mathf.Sin(runPhase) * run;
            var bounce = Mathf.Abs(Mathf.Sin(runPhase)) * 0.055f * run;
            var gather = Pulse(time, PaceRunUpComplete - 0.02f, PaceGather, PaceRelease);
            var plant = Smooth(PaceGather - 0.02f, PaceFrontFootPlant, time);
            var release = Pulse(time, PaceGather, PaceRelease, PaceFollowThrough);
            var follow = Smooth(PaceRelease, PaceFollowThrough, time);
            var settle = Smooth(0.84f, 1f, time);

            pose.RootOffset = Mirror(new Vector3(0f, bounce + 0.10f * gather - 0.05f * plant,
                BowlingAuthoredRootForward(ProductionCharacterMotion.PaceBowling, time)), hand);

            Set(pose, ProductionCharacterJoint.Hips,
                Mathf.Lerp(0f, 10f, follow) * (1f - settle),
                stride * -6f * (1f - gather) - 44f * gather + 16f * release + 32f * follow,
                0f, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                12f * run + gather * -10f + release * 32f + follow * 20f,
                stride * -7f - 10f * gather + 18f * release + 14f * follow,
                0f, hand);
            Set(pose, ProductionCharacterJoint.Chest,
                4f * run + release * 10f + follow * 9f,
                -4f * gather + release * 8f + follow * 8f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck,
                -8f * run - release * 14f - follow * 10f,
                gather * 42f - release * 28f - follow * 36f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, -4f - release * 5f,
                gather * 12f - release * 10f - follow * 18f, 0f, hand);

            var deliveryArm = Mathf.Lerp(-34f + stride * 30f, 24f, gather);
            deliveryArm = Mathf.Lerp(deliveryArm, -178f, release);
            deliveryArm = Mathf.Lerp(deliveryArm, -28f, follow);
            deliveryArm = Mathf.Lerp(deliveryArm, 2f, settle);
            Set(pose, ProductionCharacterJoint.UpperArmRight, deliveryArm,
                -8f + release * 4f, -6f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight,
                Mathf.Lerp(-108f, -4f, gather + release) - follow * 18f,
                release * 3f, 0f, hand);
            Set(pose, ProductionCharacterJoint.HandRight, -release * 8f,
                release * 12f, -release * 8f, hand);
            var supportArm = Mathf.Lerp(36f - stride * 28f, -112f, gather);
            supportArm = Mathf.Lerp(supportArm, -34f, release);
            supportArm = Mathf.Lerp(supportArm, 12f, follow);
            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                supportArm, 0f, 8f + release * 18f, hand);
            var supportForearm = Mathf.Lerp(-42f, -22f, gather);
            supportForearm = Mathf.Lerp(supportForearm, -104f, release);
            supportForearm = Mathf.Lerp(supportForearm, -38f, follow);
            Set(pose, ProductionCharacterJoint.ForearmLeft,
                supportForearm, 0f, 0f, hand);

            Set(pose, ProductionCharacterJoint.ThighLeft,
                stride * -42f * run - plant * 34f + follow * 42f,
                0f, 4f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft,
                (1f - stride) * 38f * run + plant * 6f + follow * 20f,
                0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -plant * 7f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                stride * 34f * run + plant * 39f - follow * 86f,
                0f, -5f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight,
                (1f + stride) * 44f * run + plant * 54f,
                0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight, follow * 18f,
                release * 30f + follow * 38f, 0f, hand);
        }

        private static void SpinBowling(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            // A spinner approaches compactly, gathers side-on, pivots over a braced front leg and imparts visible
            // wrist/finger rotation. The root travel remains presentation-only; the host trace owns release/flight.
            var approach = 1f - Smooth(SpinApproachComplete - 0.04f, SpinGather, time);
            // A compact spinner uses four deliberate approach steps before the gather rather than one sliding cycle.
            var stepPhase = time / SpinApproachComplete * Mathf.PI * 4f;
            var step = Mathf.Sin(stepPhase) * approach;
            var rise = Mathf.Abs(Mathf.Sin(stepPhase)) * 0.032f * approach;
            var gather = Pulse(time, SpinApproachComplete - 0.02f, SpinGather, SpinRelease);
            var plant = Smooth(SpinGather - 0.02f, SpinFrontFootPlant, time);
            var release = Pulse(time, SpinGather, SpinRelease, SpinFollowThrough);
            var follow = Smooth(SpinRelease, SpinFollowThrough, time);
            var settle = Smooth(0.88f, 1f, time);

            pose.RootOffset = Mirror(new Vector3(
                -0.12f * gather + 0.18f * follow,
                rise + 0.07f * gather - 0.035f * plant,
                BowlingAuthoredRootForward(ProductionCharacterMotion.SpinBowling, time)), hand);

            Set(pose, ProductionCharacterJoint.Hips,
                2f * approach + 7f * plant + 8f * follow,
                step * -5f * (1f - gather) - gather * 34f + release * 42f + follow * 46f,
                gather * 4f - follow * 5f, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                8f * approach - gather * 7f + release * 24f + follow * 18f,
                step * -5f - gather * 15f + release * 16f + follow * 14f,
                gather * 5f, hand);
            Set(pose, ProductionCharacterJoint.Chest,
                3f + release * 8f + follow * 7f,
                -gather * 8f + release * 8f + follow * 6f,
                gather * 3f, hand);
            Set(pose, ProductionCharacterJoint.Neck,
                -5f - release * 10f - follow * 7f,
                gather * 42f - release * 44f - follow * 52f,
                0f, hand);
            Set(pose, ProductionCharacterJoint.Head,
                -2f - release * 3f,
                gather * 15f - release * 18f - follow * 16f,
                0f, hand);

            var deliveryArm = Mathf.Lerp(-26f + step * 20f, 18f, gather);
            deliveryArm = Mathf.Lerp(deliveryArm, -162f, release);
            deliveryArm = Mathf.Lerp(deliveryArm, -42f, follow);
            deliveryArm = Mathf.Lerp(deliveryArm, 2f, settle);
            Set(pose, ProductionCharacterJoint.UpperArmRight, deliveryArm,
                -10f + gather * 8f + release * 6f,
                -8f + gather * 5f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight,
                Mathf.Lerp(-96f, -18f, gather + release) - follow * 16f,
                release * 12f,
                release * -5f, hand);
            Set(pose, ProductionCharacterJoint.HandRight,
                -release * 18f,
                release * 34f + follow * 12f,
                -release * 26f, hand);
            var supportArm = Mathf.Lerp(24f - step * 18f, -100f, gather);
            supportArm = Mathf.Lerp(supportArm, -30f, release);
            supportArm = Mathf.Lerp(supportArm, 8f, follow);
            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                supportArm, gather * -8f, 12f + release * 13f, hand);
            var supportForearm = Mathf.Lerp(-48f, -22f, gather);
            supportForearm = Mathf.Lerp(supportForearm, -98f, release);
            supportForearm = Mathf.Lerp(supportForearm, -42f, follow);
            Set(pose, ProductionCharacterJoint.ForearmLeft,
                supportForearm, 0f, 0f, hand);

            Set(pose, ProductionCharacterJoint.ThighLeft,
                step * -28f * approach - plant * 28f + follow * 34f,
                0f,
                7f + gather * 4f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft,
                (1f - step) * 28f * approach + plant * 10f + follow * 15f,
                0f,
                0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -plant * 5f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                step * 25f * approach + plant * 31f - follow * 62f,
                0f,
                -6f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight,
                (1f + step) * 30f * approach + plant * 42f,
                0f,
                0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight, follow * 13f,
                release * 24f + follow * 32f, 0f, hand);
        }

        private static void BatterStance(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            // One normalized loop is the declared 2.4-second address cycle.  The 2 mm half-range below is a
            // deliberate interpretation of the audited 4-8 mm lateral-pelvis range: 4 mm total peak-to-peak,
            // leaving enough of the 3 mm world-space foot-drift budget for the closed-chain leg settling.
            // Every term is zero at t=0/1 so the stance still joins the stroke without a pose pop.
            var address = Mathf.Sin(time * Mathf.PI * 2f);
            var lateralPelvis = address * 0.002f;
            var hipTurn = address * 0.35f;
            var kneeFlex = address;
            ApplyBatterBase(pose, hand);
            // Keep vertical root height fixed. Breathing belongs in the sternum; moving the whole character up
            // and down made both planted feet and the grounded bat toe skate.
            pose.RootOffset = Mirror(new Vector3(lateralPelvis, -0.07f, 0f), hand);

            // Pelvis and sternum counter-rotate by only 0.35 degrees each.  Equal-and-opposite local yaw leaves
            // the down-pitch chest/head read intact while preventing a frozen mannequin silhouette.  Breathing
            // lives in the articulated torso rather than the root: the 1.3-degree combined spine/chest half-range
            // is readable in the rear-shoulder view, while opposing neck/head pitch keeps attention on the bowler.
            // Every offset is driven by the same closed loop, so the ready pose still joins BatterStroke at t=0
            // without a pop and neither planted foot inherits a translation.
            Set(pose, ProductionCharacterJoint.Hips, 0f, BatterGuardHipsYaw + hipTurn, 0f, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                8f + address * 0.45f, BatterGuardSpineYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest,
                3f + address * 0.85f, BatterGuardChestYaw - hipTurn, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck,
                -5f - address * 0.40f, BatterGuardNeckYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head,
                -2f - address * 0.25f, BatterGuardHeadYaw, 0f, hand);

            // The thigh counter-rotation is half the opposing one-degree shin flex. With near-equal upper/lower
            // leg lengths this is a bounded two-segment settling solve: the knees alternate while the ankle
            // endpoints remain planted. Foot pitch cancels the residual chain angle; thigh yaw cancels hip yaw.
            Set(pose, ProductionCharacterJoint.ThighLeft,
                -18f - kneeFlex * 0.5f, BatterGuardLegCounterYaw - hipTurn, 12f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft,
                30f + kneeFlex, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft,
                -12f - kneeFlex * 0.5f, -12f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                -18f + kneeFlex * 0.5f, BatterGuardLegCounterYaw - hipTurn, -12f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight,
                30f - kneeFlex, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight,
                -12f + kneeFlex * 0.5f, 6f, 0f, hand);

            SetBatterArms(pose, hand, 0f, 0f, 0f, 1f);
            // Small opposing elbow settles feed the existing analytic two-hand grip solve.  No wrist target or
            // bat endpoint is authored here; hero clavicle reach and both hand closures remain downstream.
            Offset(pose, ProductionCharacterJoint.UpperArmLeft,
                address * 0.35f, 0f, 0f, hand);
            Offset(pose, ProductionCharacterJoint.ForearmLeft,
                address * -0.45f, 0f, 0f, hand);
            Offset(pose, ProductionCharacterJoint.UpperArmRight,
                address * -0.35f, 0f, 0f, hand);
            Offset(pose, ProductionCharacterJoint.ForearmRight,
                address * 0.45f, 0f, 0f, hand);
            pose.BatRotation = BatterReadyBatRotation(pose, hand);
        }

        private static void BatterStroke(float time, ProductionCharacterHandedness hand,
            ProductionBatterFootwork footwork, ProductionCharacterPose pose)
        {
            ApplyBatterBase(pose, hand);
            var backlift = Smooth(0.02f, BatterBacklift, time) *
                           (1f - Smooth(BatterFootPlant, BatterContact, time));
            // The address-only hand placement fades completely before the named backlift marker.  This gives the
            // ready pose a readable outside-pad silhouette without changing backlift, contact or follow endpoints.
            var address = 1f - Smooth(0.02f, BatterBacklift, time);
            var foot = Smooth(BatterBacklift - 0.04f, BatterFootPlant, time);
            var recovery = Smooth(BatterFollowThrough, 1f, time);
            // Contact remains on the declared marker, then the stroke resolves instead of holding one extreme
            // split pose for the final quarter of the clip. Sixty-eight percent of the planted stride returns by
            // the terminal frame: enough to put the centre of mass back between flexed knees, while retaining a
            // visible 32 percent weight-transfer offset instead of snapping to address. The drive and peak follow
            // settle still farther so the dead-ball silhouette is balanced rather than a frozen impact lever.
            // SmoothStep gives zero velocity at peak follow and clip end.
            var settledFoot = foot * (1f - 0.68f * recovery);
            // Begin the visual downswing after the named backlift, before the front-foot plant. This mirrors the
            // kinetic chain of a real stroke, keeps the same contact endpoint and authoritative marker, and spreads
            // bat/arm acceleration over enough 60 Hz samples to avoid a one-frame snap around the plant.
            var swing = Smooth(BatterBacklift + 0.06f, BatterContact, time) *
                        (1f - 0.68f * recovery);
            var follow = Smooth(BatterContact, BatterFollowThrough, time) *
                         (1f - 0.90f * recovery);

            float lateralStride;
            float forwardStride;
            float frontLegDrive;
            float rearLegLoad;
            float torsoLean;
            BatterFootworkShape(footwork, out lateralStride, out forwardStride,
                out frontLegDrive, out rearLegLoad, out torsoLean);

            pose.RootOffset = Mirror(new Vector3(lateralStride * settledFoot,
                -0.07f - 0.06f * settledFoot, forwardStride * settledFoot), hand);
            Set(pose, ProductionCharacterJoint.Hips,
                torsoLean * 0.35f * settledFoot,
                BatterGuardHipsYaw + 8f * settledFoot + 7f * follow,
                lateralStride * -12f * settledFoot, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                8f + torsoLean * settledFoot - 4f * swing + 9f * follow,
                BatterGuardSpineYaw - 4f * backlift + 8f * follow, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest,
                3f + torsoLean * 0.45f * settledFoot - 2f * swing + 7f * follow,
                BatterGuardChestYaw - 2f * backlift + 5f * follow, 0f, hand);
            // The eyes remain with the ball through contact and the early follow-through.  Counter-rotation is
            // distributed across neck and head and never asks either cervical joint for an extreme late twist.
            Set(pose, ProductionCharacterJoint.Neck, -5f - 2f * follow,
                BatterGuardNeckYaw - 3f * follow, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, -2f - follow,
                BatterGuardHeadYaw - 2f * follow, 0f, hand);

            Set(pose, ProductionCharacterJoint.ThighLeft,
                -18f - frontLegDrive * settledFoot + 20f * follow,
                BatterGuardLegCounterYaw + forwardStride * -18f * settledFoot,
                12f + 10f * settledFoot + lateralStride * 10f * settledFoot - 3f * recovery, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft,
                30f + frontLegDrive * 0.72f * settledFoot - 12f * follow, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -12f - 3f * settledFoot,
                -12f - forwardStride * 28f * settledFoot,
                -lateralStride * 12f * settledFoot, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                -18f + rearLegLoad * settledFoot,
                BatterGuardLegCounterYaw + forwardStride * 14f * settledFoot,
                -12f - 7f * settledFoot - lateralStride * 6f * settledFoot + 3f * recovery, hand);
            Set(pose, ProductionCharacterJoint.ShinRight,
                30f - rearLegLoad * 0.38f * settledFoot, 0f, 0f, hand);

            SetBatterArms(pose, hand, backlift, swing, follow, address);
            // The limbs settle farther than the bat face: keeping a bounded 54 percent of the drive rotation in the
            // terminal bat avoids snapping the blade back towards address while the player is still completing the
            // shot. The separate dead-ball beat then lowers the joined grip without recreating the overhead hold.
            var settledBatSwing = Mathf.Lerp(swing, 0.54f, recovery);
            var authoredBatRotation = MirrorRotation(Quaternion.Euler(
                Mathf.Lerp(-8f, 48f, backlift) - settledBatSwing * 94f - follow * 38f,
                4f + settledBatSwing * 18f + follow * 22f,
                -9f - backlift * 16f + settledBatSwing * 30f + follow * 18f), hand);
            pose.BatRotation = Quaternion.Slerp(
                BatterReadyBatRotation(pose, hand),
                authoredBatRotation,
                Smooth(0.02f, BatterBacklift, time));
        }

        private static void BatterFootworkShape(ProductionBatterFootwork footwork,
            out float lateralStride,
            out float forwardStride,
            out float frontLegDrive,
            out float rearLegLoad,
            out float torsoLean)
        {
            switch (footwork)
            {
                case ProductionBatterFootwork.Forward:
                    lateralStride = 0.10f;
                    forwardStride = 0.24f;
                    frontLegDrive = 27f;
                    rearLegLoad = 17f;
                    torsoLean = 7f;
                    return;
                case ProductionBatterFootwork.Back:
                    lateralStride = 0.06f;
                    forwardStride = -0.18f;
                    frontLegDrive = 8f;
                    rearLegLoad = 30f;
                    torsoLean = -4f;
                    return;
                case ProductionBatterFootwork.Across:
                    lateralStride = 0.22f;
                    forwardStride = -0.02f;
                    frontLegDrive = 16f;
                    rearLegLoad = 22f;
                    torsoLean = 1f;
                    return;
                case ProductionBatterFootwork.DownTrack:
                    lateralStride = 0.12f;
                    forwardStride = 0.48f;
                    frontLegDrive = 31f;
                    rearLegLoad = 23f;
                    torsoLean = 10f;
                    return;
                default:
                    lateralStride = 0.11f;
                    forwardStride = 0.025f;
                    frontLegDrive = 18f;
                    rearLegLoad = 20f;
                    torsoLean = 0f;
                    return;
            }
        }

        private static void ApplyBatterBase(ProductionCharacterPose pose,
            ProductionCharacterHandedness hand)
        {
            // Cricket guard: a distributed fifty-degree pelvis/torso turn gives the locked rear-shoulder camera a
            // readable three-quarter shoulder line while retaining a small athletic forward inclination. Neck and
            // head share the counter-turn inside a 21-degree per-joint bound; their eight-degree residual keeps the
            // eyes down-pitch while exposing a readable face profile without twisting the face, helmet and collar
            // into separate silhouettes.
            Set(pose, ProductionCharacterJoint.Hips, 0f, BatterGuardHipsYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Spine, 8f, BatterGuardSpineYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest, 3f, BatterGuardChestYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck, -5f, BatterGuardNeckYaw, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, -2f, BatterGuardHeadYaw, 0f, hand);

            // A small, symmetric knee flex reads as a balanced guard rather than locked mannequin legs.  Foot
            // counter-rotation keeps both soles planted while preserving the mirrored back-foot bat-toe contract.
            Set(pose, ProductionCharacterJoint.ThighLeft,
                -18f, BatterGuardLegCounterYaw, 12f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 30f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -12f, -12f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                -18f, BatterGuardLegCounterYaw, -12f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 30f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight, -12f, 6f, 0f, hand);
        }

        private static void SetBatterArms(ProductionCharacterPose pose,
            ProductionCharacterHandedness hand, float backlift, float swing, float follow,
            float address)
        {
            // Address starts with relaxed elbows below the shoulder line.  Backlift, drive and follow-through each
            // contribute bounded rotations, so neither shoulder becomes a straight hyperextended lever.  The rig's
            // analytic two-hand grip solve remains the final presentation-only coupling authority.
            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                -34f - backlift * 32f + swing * 52f + follow * 14f,
                8f - swing * 18f - follow * 6f,
                -16f + swing * 6f + follow * 4f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft,
                -42f + backlift * 18f - swing * 16f + follow * 10f,
                follow * -5f, follow * -4f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight,
                -10f + address * 20f - backlift * 48f + swing * 42f + follow * 14f,
                25f + address * 20f - backlift * 20f - swing * 6f + follow * 8f,
                10f + backlift * 4f - swing * 4f - follow * 5f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight,
                -55f + address * 20f + backlift * 28f - swing * 10f - follow * 6f,
                follow * 6f, address * 35f + follow * 4f, hand);
            Set(pose, ProductionCharacterJoint.HandLeft,
                follow * -3f, follow * -5f, -6f * swing - 7f * follow, hand);
            Set(pose, ProductionCharacterJoint.HandRight,
                follow * 3f, follow * 5f, 6f * swing + 7f * follow, hand);
        }

        private static Quaternion BatterReadyBatRotation(
            ProductionCharacterPose pose,
            ProductionCharacterHandedness hand)
        {
            var upper = hand == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.UpperArmRight
                : ProductionCharacterJoint.UpperArmLeft;
            var forearm = hand == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.ForearmRight
                : ProductionCharacterJoint.ForearmLeft;
            var wrist = hand == ProductionCharacterHandedness.Right
                ? ProductionCharacterJoint.HandRight
                : ProductionCharacterJoint.HandLeft;
            var handFromRoot = pose.Rotation(ProductionCharacterJoint.Hips) *
                               pose.Rotation(ProductionCharacterJoint.Spine) *
                               pose.Rotation(ProductionCharacterJoint.Chest) *
                               pose.Rotation(upper) *
                               pose.Rotation(forearm) *
                               pose.Rotation(wrist);
            // Preserve the grounded bat's vertical component and law-scale length while keeping the toe beside
            // the back foot in the bounded three-quarter guard. The 0.12 down-pitch component replaces the old
            // 0.095 component, which left the toe 0.256 m behind the back foot after the torso was untwisted.
            // This address-only rotation does not alter canonical contact or trace authority.
            var down = new Vector3(
                hand == ProductionCharacterHandedness.Right ? -0.199646270f : 0.199646270f,
                -0.975219649f,
                0.120000000f).normalized;
            var up = -down;
            var face = Vector3.forward - up * Vector3.Dot(Vector3.forward, up);
            var batFromRoot = Quaternion.LookRotation(face.normalized, up);
            return Quaternion.Inverse(handFromRoot) * batFromRoot;
        }

        /// <summary>
        /// Cancels the final presentation-root advance while the front leg is braced. The world still owns the
        /// approach position and the host still owns the ball; this only provides equal-and-opposite local motion
        /// between plant and release. After release the offset is held while authored follow-through resumes.
        /// </summary>
        private static void ApplyFrontFootBrace(
            ProductionCharacterMotion motion,
            float presentationTime,
            float authoredTime,
            float authoredPlantTime,
            ProductionCharacterPose pose)
        {
            var pace = motion == ProductionCharacterMotion.PaceBowling;
            var plantAt = pace ? PaceFrontFootPlant : SpinFrontFootPlant;
            var releaseAt = pace ? PaceRelease : SpinRelease;
            var approachDistance = pace
                ? ProductionBowlingPresentation.PaceApproachDistanceMetres
                : ProductionBowlingPresentation.SpinApproachDistanceMetres;
            var plantRootTravel = pace
                ? ProductionBowlingPresentation.PaceFrontFootPlantRootTravelNormalized
                : ProductionBowlingPresentation.SpinFrontFootPlantRootTravelNormalized;
            var worldPlantToReleaseMetres = approachDistance * (1f - plantRootTravel);
            var authoredForward = BowlingAuthoredRootForward(motion, authoredTime);
            var authoredAtPlant = BowlingAuthoredRootForward(motion, authoredPlantTime);
            var authoredAtRelease = BowlingAuthoredRootForward(motion, releaseAt);
            float bracedForward;
            if (presentationTime <= plantAt)
            {
                bracedForward = authoredForward;
            }
            else if (presentationTime < releaseAt)
            {
                var brace = (presentationTime - plantAt) / (releaseAt - plantAt);
                bracedForward = authoredAtPlant - worldPlantToReleaseMetres * brace;
            }
            else
            {
                var heldOffset = authoredAtRelease - authoredAtPlant + worldPlantToReleaseMetres;
                bracedForward = authoredForward - heldOffset;
            }

            pose.RootOffset = new Vector3(pose.RootOffset.x, pose.RootOffset.y, bracedForward);
        }

        private static float BowlingAuthoredRootForward(
            ProductionCharacterMotion motion,
            float time)
        {
            return motion == ProductionCharacterMotion.PaceBowling
                ? 1.65f * Smooth(0f, 1f, time)
                : 0.82f * Smooth(0f, 1f, time);
        }

        private static void KeeperCrouch(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var breath = Mathf.Sin(time * Mathf.PI * 2f);
            ApplyKeeperBase(pose, hand);
            pose.RootOffset = new Vector3(0f, -0.48f + breath * 0.008f, 0f);
            Set(pose, ProductionCharacterJoint.Neck, -26f + breath * 2f, 0f, 0f, hand);
        }

        private static void KeeperCollectionMotion(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            ApplyKeeperBase(pose, hand);
            var collect = Pulse(time, 0.02f, KeeperCollection, 0.72f);
            var rise = Smooth(KeeperCollection, 1f, time);
            pose.RootOffset = new Vector3(0f, -0.48f + 0.22f * collect + 0.34f * rise, 0.06f * collect);
            Set(pose, ProductionCharacterJoint.ThighLeft,
                -98f + 30f * collect + 54f * rise, 0f, 24f - 13f * rise, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                -98f + 30f * collect + 54f * rise, 0f, -24f + 13f * rise, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 128f - 32f * collect - 70f * rise, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 128f - 32f * collect - 70f * rise, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Spine, 30f - 8f * collect - 14f * rise, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft, -52f - 28f * collect, 0f,
                10f - 7f * collect, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight, -52f - 28f * collect, 0f,
                -10f + 7f * collect, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -32f - 28f * collect - 22f * rise, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -32f - 28f * collect - 22f * rise, 0f, 0f, hand);
        }

        private static void ApplyKeeperBase(ProductionCharacterPose pose,
            ProductionCharacterHandedness hand)
        {
            Set(pose, ProductionCharacterJoint.ThighLeft, -98f, 0f, 24f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight, -98f, 0f, -24f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 128f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 128f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -28f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight, -28f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Spine, 30f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest, 6f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck, -26f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, -10f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft, -52f, 0f, 10f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight, -52f, 0f, -10f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -32f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -32f, 0f, 0f, hand);
        }

        private static void FielderReady(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            // ConfigureScene samples one stable identity-derived phase and holds it. The loop therefore supplies
            // bounded stance variation across the ring without creating decorative random idle animation.
            var weight = Mathf.Sin(time * Mathf.PI * 2f);
            var settle = Mathf.Cos(time * Mathf.PI * 2f);
            pose.RootOffset = Mirror(new Vector3(
                weight * 0.016f,
                -0.18f + settle * 0.005f,
                0f), hand);
            Set(pose, ProductionCharacterJoint.Hips,
                8f + settle * 1.2f, weight * 2.4f, weight * -1.5f, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                20f + settle * 1.4f, weight * -1.6f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest,
                5f + settle * 0.6f, weight * -0.8f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Neck,
                -16f - settle * 0.8f, weight * 0.6f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, -8f, weight * 0.4f, 0f, hand);

            Set(pose, ProductionCharacterJoint.ThighLeft,
                -36f - weight * 2f, 0f, 12f + settle, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft,
                62f + weight * 3f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootLeft, -18f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight,
                -36f + weight * 2f, 0f, -12f - settle, hand);
            Set(pose, ProductionCharacterJoint.ShinRight,
                62f - weight * 3f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.FootRight, -18f, 0f, 0f, hand);

            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                -38f - settle, weight * 1.2f, 10f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft,
                -60f + weight * 2f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight,
                -38f + settle, weight * -1.2f, -10f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight,
                -60f - weight * 2f, 0f, 0f, hand);
        }

        private static void FielderRun(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var cycle = Mathf.Sin(time * Mathf.PI * 2f);
            var liftLeft = Mathf.Max(0f, cycle);
            var liftRight = Mathf.Max(0f, -cycle);
            // Canonical fielder traces own travel. This loop stays in-place so a trace position is never applied twice.
            pose.RootOffset = new Vector3(0f, Mathf.Abs(cycle) * 0.055f - 0.03f, 0f);
            Set(pose, ProductionCharacterJoint.Spine, 13f, -cycle * 7f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest, 4f, -cycle * 4f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighLeft, -44f * cycle, 0f, 2f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 14f + liftRight * 76f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight, 44f * cycle, 0f, -2f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 14f + liftLeft * 76f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft, 46f * cycle, 0f, 8f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -74f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight, -46f * cycle, 0f, -8f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -74f, 0f, 0f, hand);
        }

        private static void FielderDive(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var launch = Smooth(0f, 0.28f, time);
            var land = Smooth(0.28f, FielderDiveLand, time);
            var recover = Smooth(0.74f, 1f, time);
            pose.RootOffset = Mirror(new Vector3(-1.30f * Smooth(0f, 0.72f, time),
                -0.74f * land + 0.25f * recover, 0.2f * launch), hand);
            Set(pose, ProductionCharacterJoint.Hips, 0f, 0f,
                86f * land - 46f * recover, hand);
            Set(pose, ProductionCharacterJoint.Spine, 24f - 18f * land + 34f * recover,
                0f, 10f * launch, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight,
                -70f - 102f * launch + 28f * recover, 0f, -10f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -10f - 32f * recover, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                -60f - 90f * launch + 40f * recover, 0f, 20f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -26f - 28f * recover, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighLeft, -10f - 24f * recover, 0f, 12f, hand);
            Set(pose, ProductionCharacterJoint.ShinLeft, 20f + 76f * recover, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight, 12f, 0f, -8f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 16f + 74f * recover, 0f, 0f, hand);
        }

        private static void FielderThrow(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var load = Smooth(0f, 0.30f, time) * (1f - Smooth(0.34f, FielderThrowRelease, time));
            var release = Smooth(0.30f, FielderThrowRelease, time);
            var follow = Smooth(FielderThrowRelease, 0.78f, time);
            pose.RootOffset = Mirror(new Vector3(0f, -0.05f - 0.04f * release,
                0.45f * Smooth(0f, 1f, time)), hand);
            Set(pose, ProductionCharacterJoint.Hips, 0f,
                -62f * load - 10f * release + 28f * follow, 0f, hand);
            Set(pose, ProductionCharacterJoint.Spine,
                6f - 12f * load + 22f * release + 20f * follow,
                -10f * load + 26f * release + 20f * follow, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight,
                -94f * load - 174f * release + 110f * follow,
                0f, -12f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight,
                -30f - 54f * load + 72f * release - 18f * follow, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft,
                -38f - 40f * release + 90f * follow, 0f, 18f, hand);
            Set(pose, ProductionCharacterJoint.ThighLeft, -22f - 18f * release, 0f, 12f, hand);
            Set(pose, ProductionCharacterJoint.ThighRight, 10f + 18f * release, 0f, -12f, hand);
            Set(pose, ProductionCharacterJoint.ShinRight, 20f + 22f * release, 0f, 0f, hand);
        }

        private static void UmpireStand(float time, ProductionCharacterHandedness hand,
            ProductionCharacterPose pose)
        {
            var shift = Mathf.Sin(time * Mathf.PI * 2f);
            pose.RootOffset = new Vector3(shift * 0.006f, 0f, 0f);
            Set(pose, ProductionCharacterJoint.Spine, 8f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Chest, 1f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.Head, 1f, shift * 4f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmLeft, -16f, 0f, -14f, hand);
            Set(pose, ProductionCharacterJoint.ForearmLeft, -62f, 0f, 0f, hand);
            Set(pose, ProductionCharacterJoint.UpperArmRight, -16f, 0f, 14f, hand);
            Set(pose, ProductionCharacterJoint.ForearmRight, -62f, 0f, 0f, hand);
        }

        private static float RemapBowlingCadence(ProductionCharacterMotion motion, float time,
            float cadenceWarp)
        {
            var release = motion == ProductionCharacterMotion.PaceBowling
                ? PaceRelease
                : SpinRelease;
            if (time <= 0f || time >= release || Mathf.Abs(cadenceWarp) <= 0.000001f)
                return time;
            var phase = time / release;
            var shaped = phase + cadenceWarp * Mathf.Sin(phase * Mathf.PI * 2f) *
                         phase * (1f - phase);
            return Mathf.Clamp01(shaped) * release;
        }

        private static void ApplyBowlingCue(
            ProductionCharacterMotion motion,
            float time,
            ProductionCharacterHandedness hand,
            ProductionBowlingCueProfile cue,
            ProductionCharacterPose pose)
        {
            var runComplete = motion == ProductionCharacterMotion.PaceBowling
                ? PaceRunUpComplete
                : SpinApproachComplete;
            var gatherAt = motion == ProductionCharacterMotion.PaceBowling
                ? PaceGather
                : SpinGather;
            var releaseAt = motion == ProductionCharacterMotion.PaceBowling
                ? PaceRelease
                : SpinRelease;
            var followAt = motion == ProductionCharacterMotion.PaceBowling
                ? PaceFollowThrough
                : SpinFollowThrough;

            // Gather differences are deliberately gone at release, preserving
            // the authored arm/hand marker. The remaining wrist cue is small
            // enough to keep the fingertip anchor inside the 5 cm visual gate.
            var gather = Pulse(time, runComplete * 0.82f, gatherAt, releaseAt);
            var release = Smooth(gatherAt, releaseAt, time) *
                          (1f - Smooth(releaseAt, followAt, time));
            var wristCock = cue.WristCockDegrees * (gather + 0.22f * release);

            pose.RootOffset += Mirror(
                new Vector3(0f, cue.GatherHeightMetres * gather, 0f), hand);
            Offset(pose, ProductionCharacterJoint.Spine,
                cue.GatherLeanDegrees * gather,
                cue.GatherTurnDegrees * gather,
                0f,
                hand);
            Offset(pose, ProductionCharacterJoint.Chest,
                cue.GatherLeanDegrees * 0.45f * gather,
                cue.GatherTurnDegrees * 0.65f * gather,
                0f,
                hand);
            Offset(pose, ProductionCharacterJoint.ForearmRight,
                -wristCock * 0.38f,
                wristCock * 0.20f,
                wristCock * 0.28f,
                hand);
            Offset(pose, ProductionCharacterJoint.HandRight,
                wristCock * 0.55f + cue.ReleaseWristEuler.x * release,
                cue.ReleaseWristEuler.y * release,
                cue.ReleaseWristEuler.z * release,
                hand);
        }

        private static void Offset(ProductionCharacterPose pose, ProductionCharacterJoint joint,
            float x, float y, float z, ProductionCharacterHandedness hand)
        {
            var target = joint;
            if (hand == ProductionCharacterHandedness.Left)
            {
                target = MirrorJoint(joint);
                y = -y;
                z = -z;
            }
            var index = (int)target;
            pose.Rotations[index] *= Quaternion.Euler(x, y, z);
        }

        private static void Set(ProductionCharacterPose pose, ProductionCharacterJoint joint,
            float x, float y, float z, ProductionCharacterHandedness hand)
        {
            var target = joint;
            if (hand == ProductionCharacterHandedness.Left)
            {
                target = MirrorJoint(joint);
                y = -y;
                z = -z;
            }
            pose.Rotations[(int)target] = Quaternion.Euler(x, y, z);
        }

        private static ProductionCharacterJoint MirrorJoint(ProductionCharacterJoint joint)
        {
            switch (joint)
            {
                case ProductionCharacterJoint.UpperArmLeft: return ProductionCharacterJoint.UpperArmRight;
                case ProductionCharacterJoint.ForearmLeft: return ProductionCharacterJoint.ForearmRight;
                case ProductionCharacterJoint.HandLeft: return ProductionCharacterJoint.HandRight;
                case ProductionCharacterJoint.UpperArmRight: return ProductionCharacterJoint.UpperArmLeft;
                case ProductionCharacterJoint.ForearmRight: return ProductionCharacterJoint.ForearmLeft;
                case ProductionCharacterJoint.HandRight: return ProductionCharacterJoint.HandLeft;
                case ProductionCharacterJoint.ThighLeft: return ProductionCharacterJoint.ThighRight;
                case ProductionCharacterJoint.ShinLeft: return ProductionCharacterJoint.ShinRight;
                case ProductionCharacterJoint.FootLeft: return ProductionCharacterJoint.FootRight;
                case ProductionCharacterJoint.ThighRight: return ProductionCharacterJoint.ThighLeft;
                case ProductionCharacterJoint.ShinRight: return ProductionCharacterJoint.ShinLeft;
                case ProductionCharacterJoint.FootRight: return ProductionCharacterJoint.FootLeft;
                default: return joint;
            }
        }

        private static Vector3 Mirror(Vector3 value, ProductionCharacterHandedness hand)
        {
            if (hand == ProductionCharacterHandedness.Left) value.x = -value.x;
            return value;
        }

        private static Quaternion MirrorRotation(Quaternion value, ProductionCharacterHandedness hand)
        {
            return hand == ProductionCharacterHandedness.Left
                ? new Quaternion(value.x, -value.y, -value.z, value.w)
                : value;
        }

        private static float Smooth(float from, float to, float value)
        {
            if (to <= from) return value >= to ? 1f : 0f;
            var t = Mathf.Clamp01((value - from) / (to - from));
            return t * t * (3f - 2f * t);
        }

        private static float Pulse(float value, float riseStart, float peak, float fallEnd)
        {
            return Smooth(riseStart, peak, value) * (1f - Smooth(peak, fallEnd, value));
        }
    }
}
