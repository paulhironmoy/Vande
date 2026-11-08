using System;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Object = UnityEngine.Object;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The Director's life pass on the production rig (breath, hip roll, posture, twist and the root's sway are added to every pose the rig applies, before the
    /// hero is synchronized and before every foot and arm solve): with no life the rig is the rig it was, bit for bit; a life of one degree turns the chest and
    /// spine by their shares; a rig whose poses go through the canonical mirror takes the mirror image; the dead-ball recovery interpolates life-free poses
    /// and adds the life of the frame, so that the balanced finish breathes and the first recovery sample is the pose on screen. Builder measurements.
    /// </summary>
    public sealed class DirectorLifeRigTests
    {
        private GameObject host;
        private ProductionCharacterRig rig;

        private static ProductionCharacterRig NewRig(ProductionCharacterHandedness hand, GameObject parent)
        {
            var spec = ProductionCharacterSpec.For(ProductionCharacterRole.Batter, ProductionCharacterDetail.Medium);
            spec.Handedness = hand;
            var r = ProductionCharacterFactory.Create(parent.transform, spec);
            r.Root.SetPositionAndRotation(new Vector3(0f, 0f, 9.25f), Quaternion.Euler(0f, 180f, 0f));
            return r;
        }

        [SetUp]
        public void SetUp()
        {
            host = new GameObject("director life rig test");
        }

        [TearDown]
        public void TearDown()
        {
            if (rig != null) rig.Dispose();
            Object.DestroyImmediate(host);
        }

        private static DirectorLife Life(float breath = 0, float swayXmm = 0, float swayZmm = 0, float roll = 0, float posture = 0, float twist = 0, double w = 1)
        {
            var ch = new float[Ch.Count];
            ch[Ch.Breath] = breath;
            ch[Ch.SwayX] = swayXmm;
            ch[Ch.SwayZ] = swayZmm;
            ch[Ch.SwayRoll] = roll;
            ch[Ch.Posture] = posture;
            ch[Ch.Twist] = twist;
            var life = new DirectorLife();
            life.Set(ch, w);
            return life;
        }

        private static float Local(ProductionCharacterRig r, ProductionCharacterJoint joint, Quaternion baseline) =>
            Quaternion.Angle(baseline, r.Joint(joint).localRotation);

        [Test]
        public void NoLife_ThePoseIsTheRigsOwn_BitForBit_AndAnInactiveLifeIsNoLife()
        {
            rig = NewRig(ProductionCharacterHandedness.Left, host);
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            var plain = Snapshot(rig);
            rig.DirectedLife = new DirectorLife(); // never set: inactive
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            AssertSame(plain, Snapshot(rig), "an inactive life");
            var zero = Life();
            Assert.That(zero.Active, Is.False);
            rig.DirectedLife = zero;
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            AssertSame(plain, Snapshot(rig), "a zero life");
            Assert.That(rig.DirectedLifeApplied, Is.False);
            // and a life that is switched off again leaves nothing behind
            rig.DirectedLife = Life(breath: 1);
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            Assert.That(rig.DirectedLifeApplied, Is.True);
            rig.DirectedLife = null;
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            AssertSame(plain, Snapshot(rig), "life taken away");
        }

        private static float[] Snapshot(ProductionCharacterRig r)
        {
            var values = new System.Collections.Generic.List<float>();
            for (int i = 0; i < (int)ProductionCharacterJoint.Count; i++)
            {
                var p = r.VisibleJointWorldPosition((ProductionCharacterJoint)i);
                var q = r.VisibleJointWorldRotation((ProductionCharacterJoint)i);
                values.AddRange(new[] { p.x, p.y, p.z, q.x, q.y, q.z, q.w });
                var l = r.Joint((ProductionCharacterJoint)i).localRotation;
                values.AddRange(new[] { l.x, l.y, l.z, l.w });
            }
            values.AddRange(new[] { r.PoseRootOffset.x, r.PoseRootOffset.y, r.PoseRootOffset.z });
            return values.ToArray();
        }

        private static void AssertSame(float[] a, float[] b, string what)
        {
            Assert.That(b.Length, Is.EqualTo(a.Length));
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) Assert.Fail(what + ": float " + i + " differs: " + a[i] + " against " + b[i]);
        }

        [TestCase(ProductionCharacterHandedness.Left)]
        [TestCase(ProductionCharacterHandedness.Right)]
        public void Breath_LeansTheChestAndSpineByTheirShares_AndTheSignFollowsTheInhale(ProductionCharacterHandedness hand)
        {
            rig = NewRig(hand, host);
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0.3f);
            var chest = rig.Joint(ProductionCharacterJoint.Chest).localRotation;
            var spine = rig.Joint(ProductionCharacterJoint.Spine).localRotation;
            var hips = rig.Joint(ProductionCharacterJoint.Hips).localRotation;
            rig.DirectedLife = Life(breath: 2f);
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0.3f);
            Assert.That(Local(rig, ProductionCharacterJoint.Chest, chest), Is.EqualTo(0.65f * 2f).Within(0.02f), "the chest's share of the breath");
            Assert.That(Local(rig, ProductionCharacterJoint.Spine, spine), Is.EqualTo(0.35f * 2f).Within(0.02f), "the spine's share");
            Assert.That(Local(rig, ProductionCharacterJoint.Hips, hips), Is.EqualTo(0f).Within(1e-3f), "the hips do not breathe");
            var up = rig.Joint(ProductionCharacterJoint.Chest).localRotation;
            rig.DirectedLife = Life(breath: -2f);
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0.3f);
            var down = rig.Joint(ProductionCharacterJoint.Chest).localRotation;
            // an inhale (+) leans the chest back (X is a lean forward in the rig): the two signs are on either side of the pose
            Assert.That(Quaternion.Angle(up, down), Is.EqualTo(4 * 0.65f).Within(0.05f));
            Assert.That(Quaternion.Angle(chest, up), Is.EqualTo(1.3f).Within(0.02f));
            Assert.That((Quaternion.Inverse(chest) * up).eulerAngles.x, Is.GreaterThan(180f), "an inhale tips the chest the way a lean back goes (the negative X of the rig)");
        }

        [Test]
        public void TheHipRollAndTheTwist_AreTheMirrorImageOnARigWhosePosesGoThroughTheCanonicalMirror()
        {
            // identical canonical life on a Left rig (mirrored poses) and a Right rig (canonical poses): the root's sideways shift and the Y and Z turns flip
            var leftRig = NewRig(ProductionCharacterHandedness.Left, host);
            var other = new GameObject("second");
            ProductionCharacterRig rightRig = null;
            try
            {
                rightRig = NewRig(ProductionCharacterHandedness.Right, other);
                foreach (var r in new[] { leftRig, rightRig }) r.SampleAndApply(ProductionCharacterMotion.Stand, 0.1f);
                var baseLeft = leftRig.Joint(ProductionCharacterJoint.Hips).localRotation;
                var baseRight = rightRig.Joint(ProductionCharacterJoint.Hips).localRotation;
                var rootLeft = leftRig.PoseRootOffset;
                var rootRight = rightRig.PoseRootOffset;
                leftRig.DirectedLife = Life(roll: 1.5f, swayXmm: 6f, twist: 2f);
                rightRig.DirectedLife = Life(roll: 1.5f, swayXmm: 6f, twist: 2f);
                foreach (var r in new[] { leftRig, rightRig }) r.SampleAndApply(ProductionCharacterMotion.Stand, 0.1f);
                var dl = Quaternion.Inverse(baseLeft) * leftRig.Joint(ProductionCharacterJoint.Hips).localRotation;
                var dr = Quaternion.Inverse(baseRight) * rightRig.Joint(ProductionCharacterJoint.Hips).localRotation;
                Assert.That(Quaternion.Angle(dr, Quaternion.AngleAxis(1.5f, Vector3.forward)), Is.LessThan(0.01f), "the Right rig takes the canonical roll");
                Assert.That(Quaternion.Angle(dl, Quaternion.AngleAxis(-1.5f, Vector3.forward)), Is.LessThan(0.01f), "the Left rig takes the mirror image");
                var shiftLeft = leftRig.PoseRootOffset - rootLeft;
                var shiftRight = rightRig.PoseRootOffset - rootRight;
                Assert.That(shiftRight.x * leftRig.Root.localScale.x, Is.EqualTo(0.006f).Within(1e-5f), "6 mm to the actor's left, in metres");
                Assert.That(shiftLeft.x, Is.EqualTo(-shiftRight.x).Within(1e-6f), "mirrored sideways");
            }
            finally
            {
                rightRig?.Dispose();
                Object.DestroyImmediate(other);
                leftRig.Dispose();
            }
        }

        [Test]
        public void TheRootSway_ShiftsTheMotionRootInTheRigsUnits_AndNothingElseMoves_WhenOnlyTheSwayIsSet()
        {
            rig = NewRig(ProductionCharacterHandedness.Right, host);
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0.3f);
            var before = rig.PoseRootOffset;
            var chest = rig.Joint(ProductionCharacterJoint.Chest).localRotation;
            rig.DirectedLife = Life(swayXmm: 3f, swayZmm: -4f);
            rig.SampleAndApply(ProductionCharacterMotion.Stand, 0.3f);
            var shift = (rig.PoseRootOffset - before) * rig.Root.localScale.x;
            Assert.That(shift.x, Is.EqualTo(0.003f).Within(1e-5f));
            Assert.That(shift.z, Is.EqualTo(-0.004f).Within(1e-5f));
            Assert.That(shift.y, Is.EqualTo(0f).Within(1e-6f));
            Assert.That(Quaternion.Angle(chest, rig.Joint(ProductionCharacterJoint.Chest).localRotation), Is.LessThan(1e-3f));
        }

        [Test]
        public void TheDeadBallRecovery_InterpolatesLifeFreePoses_AddsTheLifeOfTheFrame_AndItsFirstSampleIsThePoseOnScreen()
        {
            // a rig that has breathed through its stroke, and one that never did
            var withLife = NewRig(ProductionCharacterHandedness.Left, host);
            var other = new GameObject("control");
            ProductionCharacterRig control = null;
            try
            {
                control = NewRig(ProductionCharacterHandedness.Left, other);
                var footwork = ProductionBatterFootwork.Forward;
                var life = Life(breath: 1.2f, roll: 0.8f, posture: 0.6f, twist: 0.9f, swayXmm: 2f);
                withLife.DirectedLife = life;
                withLife.SampleBatterStroke(0.72f, footwork);
                control.SampleBatterStroke(0.72f, footwork);
                var batPosition = withLife.Bat.position;
                var batRotation = withLife.Bat.rotation;
                var controlBatPosition = control.Bat.position;
                var controlBatRotation = control.Bat.rotation;
                var shown = Snapshot(withLife);
                withLife.BeginBatterDeadBallRecovery(batPosition, batRotation, footwork);
                control.BeginBatterDeadBallRecovery(controlBatPosition, controlBatRotation, footwork);
                // amount zero with the same life: the pose that was on screen (the begin restores it exactly; the apply adds the same life to the same base)
                withLife.ApplyBatterDeadBallRecovery(batPosition, batRotation, footwork, 0f);
                var onScreenAgain = Snapshot(withLife);
                double worstJoint = 0;
                for (int j = 0; j < (int)ProductionCharacterJoint.Count; j++)
                {
                    // (the hands take the grip solve onto the bat, which is the world's own and re-solved by the recovery: 25 to 30 degrees whether
                    // or not there is any life, as the same walk without a life shows; they are not what the life pass touches)
                    if ((ProductionCharacterJoint)j == ProductionCharacterJoint.HandLeft || (ProductionCharacterJoint)j == ProductionCharacterJoint.HandRight) continue;
                    worstJoint = Math.Max(worstJoint, Quaternion.Angle(withLife.Joint((ProductionCharacterJoint)j).localRotation, new Quaternion(shown[j * 11 + 7], shown[j * 11 + 8], shown[j * 11 + 9], shown[j * 11 + 10])));
                }
                Assert.That(worstJoint, Is.LessThan(0.2), "the first sample of the recovery is the pose on screen (degrees)");
                // the life-free bases are the control's: with the life taken away the recovery of the breathing rig is the recovery of the rig that never breathed
                withLife.DirectedLife = null;
                foreach (var amount in new[] { 0.35f, 1f })
                {
                    withLife.ApplyBatterDeadBallRecovery(batPosition, batRotation, footwork, amount);
                    control.ApplyBatterDeadBallRecovery(controlBatPosition, controlBatRotation, footwork, amount);
                    // the joints the life touches (the arms are solved onto the bat by the world's own IK, which keeps a memory)
                    foreach (var j in new[] { ProductionCharacterJoint.Hips, ProductionCharacterJoint.Spine, ProductionCharacterJoint.Chest })
                        Assert.That(Quaternion.Angle(withLife.Joint(j).localRotation, control.Joint(j).localRotation), Is.LessThan(0.15f), j + " at " + amount + ": the recovery works from life-free poses");
                }
                // and the finish breathes: with a life set again the balanced finish is the control's plus the life
                withLife.DirectedLife = life;
                withLife.ApplyBatterDeadBallRecovery(batPosition, batRotation, footwork, 1f);
                var chestControl = control.Joint(ProductionCharacterJoint.Chest).localRotation;
                Assert.That(Quaternion.Angle(chestControl, withLife.Joint(ProductionCharacterJoint.Chest).localRotation), Is.GreaterThan(0.5f), "the finish carries the life of the frame");
            }
            finally
            {
                control?.Dispose();
                Object.DestroyImmediate(other);
                withLife.Dispose();
            }
        }

        [TestCase(false)]
        [TestCase(true)]
        public void TheComposedOffsets_AreTheWebsSequentialOrder(bool mirrored)
        {
            var rng = new TestRng(31);
            for (int trial = 0; trial < 60; trial++)
            {
                var ch = new float[Ch.Count];
                ch[Ch.Breath] = (float)((rng.Next() - 0.5) * 4);
                ch[Ch.SwayRoll] = rng.Next() < 0.3 ? 0f : (float)((rng.Next() - 0.5) * 3);
                ch[Ch.Posture] = rng.Next() < 0.3 ? 0f : (float)((rng.Next() - 0.5) * 6);
                ch[Ch.Twist] = rng.Next() < 0.3 ? 0f : (float)((rng.Next() - 0.5) * 6);
                var life = new DirectorLife();
                life.Set(ch, 0.8);
                var o = new GameObject("compose");
                try
                {
                    var hips = new GameObject("h").transform;
                    var spine = new GameObject("s").transform;
                    var chest = new GameObject("c").transform;
                    foreach (var t in new[] { hips, spine, chest }) t.SetParent(o.transform, false);
                    var h0 = Quaternion.Euler((float)(rng.Next() * 60), (float)(rng.Next() * 60), (float)(rng.Next() * 60));
                    var s0 = Quaternion.Euler((float)(rng.Next() * 60), (float)(rng.Next() * 60), (float)(rng.Next() * 60));
                    var c0 = Quaternion.Euler((float)(rng.Next() * 60), (float)(rng.Next() * 60), (float)(rng.Next() * 60));
                    hips.localRotation = h0; spine.localRotation = s0; chest.localRotation = c0;
                    life.ApplyRotations(hips, spine, chest, mirrored);
                    // the web's order, one rotation at a time
                    float m = mirrored ? -1f : 1f;
                    float sr = life.SwayRollDeg * m, po = life.PostureDeg, tw = life.TwistDeg * m, b = life.BreathDeg;
                    var h = h0 * Quaternion.AngleAxis(sr, Vector3.forward);
                    var s2 = s0 * Quaternion.AngleAxis(-0.6f * sr, Vector3.forward) * Quaternion.AngleAxis(-0.4f * po, Vector3.right) * Quaternion.AngleAxis(0.4f * tw, Vector3.up);
                    var c = c0 * Quaternion.AngleAxis(-0.6f * po, Vector3.right) * Quaternion.AngleAxis(0.6f * tw, Vector3.up) * Quaternion.AngleAxis(-0.65f * b, Vector3.right);
                    s2 = s2 * Quaternion.AngleAxis(-0.35f * b, Vector3.right);
                    Assert.That(Quaternion.Angle(h, hips.localRotation), Is.LessThan(0.001f), "hips, trial " + trial);
                    Assert.That(Quaternion.Angle(s2, spine.localRotation), Is.LessThan(0.001f), "spine, trial " + trial);
                    Assert.That(Quaternion.Angle(c, chest.localRotation), Is.LessThan(0.001f), "chest, trial " + trial);
                    // and the offsets the rig strips are the ones that were added
                    Assert.That(Quaternion.Angle(h0 * life.HipsOffset(mirrored), hips.localRotation), Is.LessThan(0.0005f));
                    Assert.That(Quaternion.Angle(s0 * life.SpineOffset(mirrored), spine.localRotation), Is.LessThan(0.0005f));
                    Assert.That(Quaternion.Angle(c0 * life.ChestOffset(mirrored), chest.localRotation), Is.LessThan(0.0005f));
                }
                finally
                {
                    Object.DestroyImmediate(o);
                }
            }
        }

        [Test]
        public void TheRigsLifePass_AllocatesNothing_AndAddsMicrosecondsToAPose()
        {
            // the code the rig runs for the life, per pose: scanned for allocating instructions (a class made, an array, a boxing, a delegate)
            var found = new System.Collections.Generic.List<string>();
            var seen = new System.Collections.Generic.HashSet<System.Reflection.MethodBase>();
            foreach (var name in new[] { "ApplyDirectedLifeToDrivers", "StripDirectedLife", "CaptureRecoveryBase" })
                StageAllocationScan.Scan(typeof(ProductionCharacterRig).GetMethod(name, System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance), seen, found);
            foreach (var name in new[] { "ApplyRotations", "RootShift" })
                StageAllocationScan.Scan(typeof(DirectorLife).GetMethod(name), seen, found);
            StageAllocationScan.Scan(typeof(DirectorLife).GetMethod("Set", new[] { typeof(float[]), typeof(double), typeof(StageSeam) }), seen, found);
            Assert.That(found, Is.Empty, "allocating instructions in the rig's life pass: " + string.Join("; ", found));
            // and what it adds to a pose, measured: the same pose applied with and without a life
            rig = NewRig(ProductionCharacterHandedness.Right, host);
            var life = Life(breath: 1.2f, swayXmm: 2f, swayZmm: -1f, roll: 0.5f, posture: 0.4f, twist: 0.8f);
            const int applies = 3000;
            double Time(DirectorLife l)
            {
                rig.DirectedLife = l;
                for (int i = 0; i < 200; i++) rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
                var best = double.MaxValue;
                for (int round = 0; round < 5; round++)
                {
                    var t0 = System.Diagnostics.Stopwatch.GetTimestamp();
                    for (int i = 0; i < applies; i++) rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
                    best = Math.Min(best, (System.Diagnostics.Stopwatch.GetTimestamp() - t0) * 1e6 / System.Diagnostics.Stopwatch.Frequency / applies);
                }
                return best;
            }
            var without = Time(null);
            var with = Time(life);
            Console.WriteLine("rig pose (batter stance, complete hero): " + without.ToString("0.0") + " us without a life, " + with.ToString("0.0") + " us with one; the life adds " + (with - without).ToString("0.00") + " us per pose");
            Assert.That(rig.DirectedLifeApplied, Is.True);
        }

        [Test]
        public void ThePoseSerial_CountsPosesAndSynchronizations_ForTheHeadPassUndo()
        {
            rig = NewRig(ProductionCharacterHandedness.Left, host);
            int s0 = rig.PoseSerial;
            rig.SampleAndApply(ProductionCharacterMotion.BatterStance, 0.3f);
            Assert.That(rig.PoseSerial, Is.GreaterThan(s0));
            int s1 = rig.PoseSerial;
            Assert.That(rig.PoseSerial, Is.EqualTo(s1), "reading does not count");
            Transform chest, neck, head;
            Assert.That(rig.TryGetVisibleHeadBones(out chest, out neck, out head), Is.True);
            Assert.That(head.IsChildOf(neck) && neck.IsChildOf(chest), Is.True, "the hero's chest, neck and head chain");
        }
    }
}
