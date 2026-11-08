using System;
using UnityEngine;
using Vande.Practice.Presentation.Production.Motion;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// Presentation-only locomotion for one rig whose ground position is given every frame (a physics path, a run
    /// between the wickets, a walk back): the stride phase advances with distance travelled, not time (no treadmill
    /// feet), the step length grows with speed, the gait weight follows a rate-limited speed (no pose pops at starts
    /// and stops), heading turns at a bounded rate, and a blend-in from the rig's current driver pose removes the
    /// switch-over pop. It never chooses where the rig is: the caller passes the position the physics implies.
    /// The gait is MOTION's locomotion pack (walk, jog, run, sprint, speed-blended, through the rig mirror) when it is
    /// shipped, else the code-authored Run clip; the standing pose is the caller's code-authored idle clip.
    /// </summary>
    public sealed class ProductionGaitPresenter
    {
        private const float SpeedRateMps2 = 9f;
        private const float WalkTurnDegreesPerSecond = 300f;
        private const float RunTurnDegreesPerSecond = 540f;
        private readonly ProductionCharacterRig rig;
        private readonly ProductionCharacterPose idle = new ProductionCharacterPose();
        private readonly ProductionCharacterPose gait = new ProductionCharacterPose();
        private readonly ProductionCharacterPose blendFrom = new ProductionCharacterPose();
        private Vector3 position;
        private float yaw;
        private float speed;
        private double cycles;
        private double clock;
        private float blendRemaining;
        private float blendDuration;
        private bool placed;
        private bool hasIdleClip;
        private ProductionFieldingClip lastIdleClip;
        private readonly ProductionLocomotionCycle locomotion;

        public ProductionGaitPresenter(ProductionCharacterRig rig)
        {
            this.rig = rig ?? throw new ArgumentNullException(nameof(rig));
            locomotion = ProductionLocomotionCycle.TryCreate();
        }

        /// <summary>True when the gait comes from MOTION's locomotion pack.</summary>
        public bool UsesLocomotionPack => locomotion != null;

        public ProductionCharacterRig Rig => rig;
        public Vector3 Position => position;
        public float Speed => speed;
        public bool Placed => placed;

        /// <summary>Distance per step (m) at a ground speed (m/s): ~0.8 m walking, ~2 m sprinting.</summary>
        public static float StepLength(float metresPerSecond) =>
            Mathf.Clamp(0.55f + 0.19f * metresPerSecond, 0.7f, 2.1f);

        /// <summary>Places the rig without locomotion (construction, or a cut between balls).</summary>
        public void Snap(Vector3 worldPosition, float headingDegrees)
        {
            position = new Vector3(worldPosition.x, 0f, worldPosition.z);
            yaw = headingDegrees;
            speed = 0f;
            placed = true;
            rig.Root.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
        }

        /// <summary>
        /// Blends from the rig's current driver pose into this presenter over `seconds` (no pop). With `rebaseOnHips`
        /// the presenter starts under the hips instead (a striker whose stride carried his body 0.7 m from his root):
        /// the source's horizontal root offset moves into the position, so the caller's path starts where he is.
        /// </summary>
        public void BlendFromCurrent(float seconds, bool rebaseOnHips = false)
        {
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                blendFrom.Rotations[joint] = rig.Joint((ProductionCharacterJoint)joint).localRotation;
            // The source's root offset blends out too (a pack throw ends with the hips 0.44 m forward of the root:
            // zeroing it here was the 23.5 m/s single-frame hips step at third man's hand-over, r4c).
            blendFrom.RootOffset = rig.PoseRootOffset;
            blendDuration = Mathf.Max(0.001f, seconds);
            blendRemaining = blendDuration;
            position = new Vector3(rig.Root.position.x, 0f, rig.Root.position.z);
            if (rebaseOnHips)
            {
                var offset = rig.Root.TransformVector(blendFrom.RootOffset);
                position += new Vector3(offset.x, 0f, offset.z);
                var local = rig.Root.InverseTransformVector(new Vector3(offset.x, 0f, offset.z));
                blendFrom.RootOffset -= local;
            }
            yaw = rig.Root.eulerAngles.y;
            placed = true;
        }

        /// <summary>
        /// Presents one frame at `worldPosition` (ground), facing `headingDegrees` when standing or the direction of
        /// travel when moving. `idleClip` is the standing pose (looping); `gaitWeightCap` limits the run blend.
        /// </summary>
        public void Present(Vector3 worldPosition, float headingDegrees, float deltaSeconds,
            ProductionFieldingClip idleClip = ProductionFieldingClip.Idle, float gaitWeightCap = 1f,
            bool faceTravel = true)
        {
            if (!placed) Snap(worldPosition, headingDegrees);
            // A change of standing clip (stand -> keeper crouch, ready -> idle) blends instead of popping.
            if (hasIdleClip && idleClip != lastIdleClip && blendRemaining <= 0f) BlendFromCurrent(0.35f);
            hasIdleClip = true;
            lastIdleClip = idleClip;
            var dt = Mathf.Max(1e-4f, deltaSeconds);
            var target = new Vector3(worldPosition.x, 0f, worldPosition.z);
            var step = target - position;
            var stepDistance = step.magnitude;
            var instantaneous = stepDistance / dt;
            speed = Mathf.MoveTowards(speed, instantaneous, SpeedRateMps2 * dt);
            cycles += stepDistance / (2f * StepLength(Mathf.Max(speed, instantaneous)));
            locomotion?.Advance(stepDistance, Mathf.Max(speed, instantaneous));
            clock += dt;
            position = target;

            var desiredYaw = faceTravel && stepDistance > 0.002f
                ? Mathf.Atan2(step.x, step.z) * Mathf.Rad2Deg
                : headingDegrees;
            var turnRate = Mathf.Lerp(WalkTurnDegreesPerSecond, RunTurnDegreesPerSecond, Mathf.Clamp01(speed / 6f));
            yaw = Mathf.MoveTowardsAngle(yaw, desiredYaw, turnRate * dt);

            ProductionFieldingClips.Sample(idleClip, clock, idle);
            if (locomotion != null) locomotion.Sample(speed, gait);
            else
                ProductionFieldingClips.Sample(ProductionFieldingClip.Run,
                    cycles * ProductionFieldingClips.Duration(ProductionFieldingClip.Run), gait);
            // The pack's slowest cycle is a 1.5 m/s walk, so it reaches full weight sooner than the code-authored run.
            var fullAt = locomotion != null ? 1.2f : 2.4f;
            var weight = Mathf.Min(gaitWeightCap, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((speed - 0.15f) / fullAt)));
            ProductionFieldingClips.Blend(idle, gait, weight);
            if (blendRemaining > 0f)
            {
                blendRemaining = Mathf.Max(0f, blendRemaining - dt);
                var keep = Mathf.SmoothStep(0f, 1f, blendRemaining / blendDuration);
                ProductionFieldingClips.Blend(idle, blendFrom, keep);
            }
            rig.Root.SetPositionAndRotation(position, Quaternion.Euler(0f, yaw, 0f));
            rig.ResetBatToCharacterGrip();
            rig.ApplyPose(idle);
        }
    }
}
