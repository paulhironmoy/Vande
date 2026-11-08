using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Motion;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The composed bowler run-up (ProductionBowlerRunUp, a port of the web's bowlerRunup.ts and of plan()/compose() in
    /// scripts/blender/motion/bowler_runup.py). Expected plans are bowler_runup.py's on the cleared sources
    /// (2026-11-04): pace D 2.40 s is a rolling start (exitR, 3 strides, preRoll 0.5799 s), off-spin D 1.55 s is exitR,
    /// 1 stride, k 1.0211, preRoll 0.64 s. The release lands exactly at the visible D, and the ground never jumps.
    /// The visible run-up is the owner's rolling start (2026-11-04), as on the web (choreo.ts composedBowlerRun,
    /// RUN_START): it opens mid-walk, PreRoll seconds into the plan, at the clips' own rate 1.0; the root launches from
    /// rest over LaunchSeconds and the standing idle is handed over to the clip inertially over InertialSeconds.
    /// </summary>
    public sealed class BowlerRunUpTests
    {
        [TestCase("pace", 2.40, "exitR", 3, 0.5799, 1.0)]
        [TestCase("off", 1.55, "exitR", 1, 0.64, 1.0211)]
        [TestCase("leg", 1.55, "exitR", 1, 0.64, 1.0211)]
        public void Plan_MatchesTheReferenceComposer(string action, double d, string exit, int steps, double preRoll,
            double k)
        {
            var runUp = ProductionBowlerRunUp.TryCreate(action, d, false);
            Assert.That(runUp, Is.Not.Null, "the bowler pack is shipped");
            Assert.That(runUp.Plan.Exit, Is.EqualTo(exit));
            Assert.That(runUp.Plan.Steps, Is.EqualTo(steps));
            Assert.That(runUp.Plan.PreRoll, Is.EqualTo(preRoll).Within(0.01));
            Assert.That(runUp.Plan.K, Is.EqualTo(k).Within(0.005));
            Assert.That(runUp.TRelease - runUp.Plan.PreRoll, Is.EqualTo(d).Within(1e-6), "release at the visible D");
            Assert.That(runUp.VisibleRelease, Is.EqualTo(d).Within(1e-6));
            Assert.That(runUp.ComposedTime(d), Is.EqualTo(runUp.TRelease).Within(1e-6), "the release is not moved");
            // The owner's rolling-start decision (2026-11-04), which replaces "starts standing at the top of the mark":
            // the old Warp opened the run-up from composed frame 0 and fast-forwarded the lead-in, which put the first
            // steps up to 1.52x over the MOTION-SPEC 9 cadence band and the root's peak acceleration at 14 m/s^2.
            // The visible run-up now opens mid-walk, PreRoll seconds in, and plays at the clips' own rate; the standing
            // look is the idle hand-over and the root's launch from rest (the two tests below).
            Assert.That(runUp.ComposedTime(0.0), Is.EqualTo(runUp.Plan.PreRoll).Within(1e-9),
                "the visible run-up opens PreRoll seconds into the plan");
            Assert.That(runUp.ComposedTime(1.0) - runUp.ComposedTime(0.0), Is.EqualTo(1.0).Within(1e-9),
                "the clips play at their own rate 1.0 (no fast-forward)");
        }

        [TestCase("pace", false)]
        [TestCase("pace", true)]
        [TestCase("off", false)]
        public void Ground_RunsTowardsTheStumpsWithoutJumps(string action, bool leftArm)
        {
            var d = action == "pace" ? 2.40 : 1.55;
            var runUp = ProductionBowlerRunUp.TryCreate(action, d, leftArm);
            Assert.That(runUp, Is.Not.Null);
            float px, pz, yaw;
            runUp.GroundVisible(0.0, out px, out pz, out yaw);
            var pose = new ProductionCharacterPose();
            for (var visible = 1.0 / 60.0; visible <= d + 1e-9; visible += 1.0 / 60.0)
            {
                float x, z;
                runUp.GroundVisible(visible, out x, out z, out yaw);
                var step = Mathf.Sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
                Assert.That(step, Is.LessThan(8.5f / 60f + 0.02f), "ground step at " + visible);
                Assert.That(z - pz, Is.GreaterThan(-0.01f), "never runs backwards at " + visible);
                runUp.SampleVisible(visible, pose);
                px = x;
                pz = z;
            }
            float rx, rz, ryaw;
            runUp.Ground(runUp.TRelease, out rx, out rz, out ryaw);
            Assert.That(rz, Is.GreaterThan(4f), "a real run-up, not a standing release");
            runUp.GroundVisible(d, out px, out pz, out yaw);
            Assert.That(px, Is.EqualTo(rx).Within(1e-4f), "the launch is over by the release: the clip's own ground");
            Assert.That(pz, Is.EqualTo(rz).Within(1e-4f));
        }

        [TestCase("pace", false)]
        [TestCase("pace", true)]
        [TestCase("off", false)]
        public void RootLaunch_LeavesRestWithoutSteppingInSpeedAndArrivesOnTheClipsGround(string action, bool leftArm)
        {
            var d = action == "pace" ? 2.40 : 1.55;
            var runUp = ProductionBowlerRunUp.TryCreate(action, d, leftArm);
            Assert.That(runUp, Is.Not.Null);
            const double step = 1.0 / 60.0;
            float px, pz, yaw;
            runUp.GroundVisible(0.0, out px, out pz, out yaw);
            var previousSpeed = 0.0;
            var firstSpeed = -1.0;
            for (var frame = 1; frame * step <= 1.2 + 1e-9; frame++)
            {
                float x, z;
                runUp.GroundVisible(frame * step, out x, out z, out yaw);
                var speed = Mathf.Sqrt((x - px) * (x - px) + (z - pz) * (z - pz)) / step;
                if (firstSpeed < 0.0) firstSpeed = speed;
                Assert.That(System.Math.Abs(speed - previousSpeed), Is.LessThan(0.3),
                    "the root's speed never steps by 0.3 m/s in a frame (frame " + frame + ")");
                previousSpeed = speed;
                px = x;
                pz = z;
            }
            Assert.That(firstSpeed, Is.LessThan(0.2), "he leaves rest: the first frame's speed is near zero");
            for (var visible = ProductionBowlerRunUp.LaunchSeconds; visible <= d; visible += 0.1)
            {
                float gx, gz, cx, cz, cyaw;
                runUp.GroundVisible(visible, out gx, out gz, out yaw);
                runUp.Ground(runUp.ComposedTime(visible), out cx, out cz, out cyaw);
                Assert.That(gx, Is.EqualTo(cx).Within(1e-4f), "on the clip's own ground track after the launch");
                Assert.That(gz, Is.EqualTo(cz).Within(1e-4f));
            }
        }

        [TestCase("pace", false)]
        [TestCase("pace", true)]
        [TestCase("off", false)]
        public void HandOver_StartsOnTheStandingIdleAndSettlesOnTheClipWithoutAPop(string action, bool leftArm)
        {
            var d = action == "pace" ? 2.40 : 1.55;
            var runUp = ProductionBowlerRunUp.TryCreate(action, d, leftArm);
            Assert.That(runUp, Is.Not.Null);
            var stand = new ProductionCharacterPose();
            ProductionFieldingClips.Sample(ProductionFieldingClip.Idle, 0.0, stand);
            var pose = new ProductionCharacterPose();
            var previous = new ProductionCharacterPose();
            var clip = new ProductionCharacterPose();
            runUp.SampleVisible(0.0, pose);
            for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                Assert.That(Quaternion.Angle(pose.Rotations[joint], stand.Rotations[joint]), Is.LessThan(0.05f),
                    "frame 0 is the standing idle: " + (ProductionCharacterJoint)joint);
            Assert.That(Vector3.Distance(pose.RootOffset, stand.RootOffset), Is.LessThan(1e-3f));
            // No bone steps over its MOTION-SPEC 9 angular-speed cap in the first 0.6 s (shins and thighs 1,200 deg/s:
            // the web's stand-leg fix, no snap on the first frame), and from InertialSeconds on the pose is the clip's.
            for (var frame = 0; frame <= 36; frame++)
            {
                var visible = frame / 60.0;
                runUp.SampleVisible(visible, pose);
                if (frame > 0)
                    for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                    {
                        var speed = Quaternion.Angle(pose.Rotations[joint], previous.Rotations[joint]) * 60.0;
                        Assert.That(speed, Is.LessThanOrEqualTo(Cap((ProductionCharacterJoint)joint)),
                            (ProductionCharacterJoint)joint + " at frame " + frame + " (deg/s)");
                    }
                for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                    previous.Rotations[joint] = pose.Rotations[joint];
                if (visible >= ProductionBowlerRunUp.InertialSeconds)
                {
                    runUp.Sample(runUp.ComposedTime(visible), clip);
                    for (var joint = 0; joint < (int)ProductionCharacterJoint.Count; joint++)
                        Assert.That(Quaternion.Angle(pose.Rotations[joint], clip.Rotations[joint]), Is.LessThan(0.01f),
                            "settled on the clip: " + (ProductionCharacterJoint)joint);
                }
            }
        }

        private static double Cap(ProductionCharacterJoint joint)
        {
            switch (joint)
            {
                case ProductionCharacterJoint.UpperArmLeft: case ProductionCharacterJoint.UpperArmRight:
                case ProductionCharacterJoint.ForearmLeft: case ProductionCharacterJoint.ForearmRight:
                case ProductionCharacterJoint.HandLeft: case ProductionCharacterJoint.HandRight:
                    return 1800.0;
                case ProductionCharacterJoint.Hips: case ProductionCharacterJoint.Spine: case ProductionCharacterJoint.Chest:
                    return 600.0;
                case ProductionCharacterJoint.Neck: case ProductionCharacterJoint.Head:
                    return 720.0;
                default:
                    return 1200.0;
            }
        }

        [TestCase("pace", false)]
        [TestCase("off", true)]
        public void RootLaunch_StandsAheadOfTheClipsTrackByTheWebsLag(string action, bool leftArm)
        {
            var d = action == "pace" ? 2.40 : 1.55;
            var runUp = ProductionBowlerRunUp.TryCreate(action, d, leftArm);
            Assert.That(runUp, Is.Not.Null);
            // choreo.ts composedBowlerRun: trackSpeed (a central difference over 12 ms), launchShare (a smoothstep over
            // the launch) and lag (Simpson over 24 intervals), re-derived here from the public composed ground. The
            // root stands that far ahead of the clip's track (along it: the direction is this port's smoother one).
            var end = System.Math.Min(ProductionBowlerRunUp.LaunchSeconds, runUp.TEnd - runUp.Plan.PreRoll - 0.001);
            System.Func<double, double> speed = visible =>
            {
                float ax, az, ay, bx, bz, by;
                var from = System.Math.Max(0.0, visible - 0.006);
                var to = visible + 0.006;
                runUp.Ground(runUp.ComposedTime(from), out ax, out az, out ay);
                runUp.Ground(runUp.ComposedTime(to), out bx, out bz, out by);
                return System.Math.Sqrt((bx - ax) * (bx - ax) + (bz - az) * (bz - az)) / (to - from);
            };
            System.Func<double, double> share = visible =>
            {
                var u = System.Math.Min(1.0, System.Math.Max(0.0, visible / end));
                return u * u * (3.0 - 2.0 * u);
            };
            foreach (var visible in new[] { 0.0, 0.1, 0.25, 0.4, 0.6, 0.85 })
            {
                var h = (end - visible) / 24;
                var sum = 0.0;
                for (var i = 0; i <= 24; i++)
                {
                    var at = visible + i * h;
                    sum += speed(at) * (1.0 - share(at)) * (i == 0 || i == 24 ? 1 : i % 2 == 1 ? 4 : 2);
                }
                var lag = sum * h / 3.0;
                float px, pz, pyaw, gx, gz, gyaw;
                runUp.Ground(runUp.ComposedTime(visible), out px, out pz, out pyaw);
                runUp.GroundVisible(visible, out gx, out gz, out gyaw);
                var ahead = System.Math.Sqrt((gx - px) * (gx - px) + (gz - pz) * (gz - pz));
                if (visible <= 0.6) Assert.That(lag, Is.GreaterThan(0.05), "he starts behind the clip's own track at " + visible);
                Assert.That(ahead, Is.EqualTo(lag).Within(3e-3), "the lag at " + visible);
                Assert.That(gz - pz, Is.GreaterThan(0f), "ahead of the track, towards the stumps, at " + visible);
            }
        }

        [Test]
        public void LeftArm_IsTheMirrorOfRightArm()
        {
            var right = ProductionBowlerRunUp.TryCreate("pace", 2.40, false);
            var left = ProductionBowlerRunUp.TryCreate("pace", 2.40, true);
            Assert.That(right, Is.Not.Null);
            Assert.That(left, Is.Not.Null);
            foreach (var t in new[] { 0.5, 1.5, right.TRelease, right.TEnd })
            {
                float xr, zr, yr, xl, zl, yl;
                right.Ground(t, out xr, out zr, out yr);
                left.Ground(t, out xl, out zl, out yl);
                Assert.That(xl, Is.EqualTo(-xr).Within(1e-4f));
                Assert.That(zl, Is.EqualTo(zr).Within(1e-4f));
                Assert.That(yl, Is.EqualTo(-yr).Within(1e-3f));
            }
            foreach (var visible in new[] { 0.0, 0.2, 0.5 })
            {
                float xr, zr, yr, xl, zl, yl;
                right.GroundVisible(visible, out xr, out zr, out yr);
                left.GroundVisible(visible, out xl, out zl, out yl);
                Assert.That(xl, Is.EqualTo(-xr).Within(1e-4f), "the launch mirrors too at " + visible);
                Assert.That(zl, Is.EqualTo(zr).Within(1e-4f));
            }
        }
    }
}
