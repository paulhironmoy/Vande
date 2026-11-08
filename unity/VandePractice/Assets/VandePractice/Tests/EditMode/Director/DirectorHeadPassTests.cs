using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation.Production.Director;
using Vande.Practice.Presentation.Production.Director.Stage;
using Ch = Vande.Practice.Presentation.Production.Director.DirectorChannels;

namespace Vande.Practice.Tests.DirectorTests
{
    /// <summary>
    /// The head pass on a plain bone hierarchy (root, hips, spine, chest, neck, head; no rig, no world): it points the head where the plan's head
    /// in space is (as far as the neck can turn), for both roles and both of the world's reflections (a right-hander's x is mirrored, a left-hander's
    /// is not); it holds the neck and head to the section 9 caps through cuts, fast turns of the body and a body that turns right round (the
    /// heading crossing +-180 degrees: the web's finding of 2026-11-07, a 106 to 116 degree head step in one frame); it takes the turn off the bones
    /// again; and it moves no other bone. Builder measurements, never a player's or an evaluator's result.
    /// </summary>
    public sealed class DirectorHeadPassTests
    {
        private const double Step = 1000.0 / 60.0;
        private const double Deg = 180.0 / Math.PI;

        private sealed class HeadRig : IDisposable
        {
            public GameObject Root;
            public Transform Hips, Spine, Chest, Neck, Head;
            public Quaternion SpineBase, ChestBase, NeckBase, HeadBase;

            public static HeadRig Create(Vector3 spine, Vector3 chest, Vector3 neck, Vector3 head)
            {
                var r = new HeadRig { Root = new GameObject("head pass rig") };
                r.Hips = Child(r.Root.transform, "hips", new Vector3(0, 1.0f, 0));
                r.Spine = Child(r.Hips, "spine", new Vector3(0, 0.15f, 0));
                r.Chest = Child(r.Spine, "chest", new Vector3(0, 0.2f, 0));
                r.Neck = Child(r.Chest, "neck", new Vector3(0, 0.235f, 0));
                r.Head = Child(r.Neck, "head", new Vector3(0, 0.085f, 0.012f));
                r.SpineBase = Quaternion.Euler(spine);
                r.ChestBase = Quaternion.Euler(chest);
                r.NeckBase = Quaternion.Euler(neck);
                r.HeadBase = Quaternion.Euler(head);
                r.Repose();
                return r;
            }

            private static Transform Child(Transform parent, string name, Vector3 position)
            {
                var o = new GameObject(name);
                o.transform.SetParent(parent, false);
                o.transform.localPosition = position;
                return o.transform;
            }

            /// <summary>The world poses the rig afresh (the pose source writes every bone).</summary>
            public void Repose()
            {
                Spine.localRotation = SpineBase;
                Chest.localRotation = ChestBase;
                Neck.localRotation = NeckBase;
                Head.localRotation = HeadBase;
            }

            public void SetHeading(double yawDeg)
            {
                Root.transform.rotation = Quaternion.Euler(0, (float)Wrap(yawDeg), 0);
            }

            public void Dispose()
            {
                if (Root != null) UnityEngine.Object.DestroyImmediate(Root);
            }
        }

        private static double Wrap(double x)
        {
            x %= 360;
            return x > 180 ? x - 360 : x <= -180 ? x + 360 : x;
        }

        private static DirectedFrame Frame(float headYaw, float headPitch, float headRoll, double w = 1, bool rm = false, bool brake = false, StageSeam seam = null)
        {
            var ch = new float[Ch.Count];
            ch[Ch.HeadYaw] = headYaw;
            ch[Ch.HeadPitch] = headPitch;
            ch[Ch.HeadRoll] = headRoll;
            return new DirectedFrame { On = true, HasChannels = true, Ch = ch, W = w, Reduced = rm, Brake = brake, Seam = seam };
        }

        /// <summary>Where the plan's role yaw and pitch point, as a Unity world direction (the physics frame reflected in x by the world's mirror).</summary>
        private static Vector3 Expected(DirectorRole role, double yaw, double pitch, float mirror)
        {
            double cy = Math.Cos(yaw / Deg), sy = Math.Sin(yaw / Deg), cp = Math.Cos(pitch / Deg), sp = Math.Sin(pitch / Deg);
            double sgn = role == DirectorRole.Bowler ? 1 : -1;
            return new Vector3((float)(mirror * sgn * sy * cp), (float)-sp, (float)(sgn * cy * cp));
        }

        private static double Angle(Vector3 a, Vector3 b)
        {
            return Vector3.Angle(a, b);
        }

        private static double LocalStep(Quaternion a, Quaternion b)
        {
            return Quaternion.Angle(a, b);
        }

        // ------------------------------------------------------------------------------------------------ pointing

        [TestCase(DirectorRole.Bowler, -1f)]
        [TestCase(DirectorRole.Bowler, 1f)]
        [TestCase(DirectorRole.Striker, -1f)]
        [TestCase(DirectorRole.Striker, 1f)]
        public void Head_PointsWhereThePlanSays_WhateverTheTrunkDoes_ForBothRolesAndBothReflections(DirectorRole role, float mirror)
        {
            var rng = new TestRng(77);
            double worst = 0;
            for (int trial = 0; trial < 120; trial++)
            {
                // the trunk faces the opponent within +-40 degrees, leans a little and rolls a little; the clip's head is wherever
                double heading = (role == DirectorRole.Bowler ? 0 : 180) + (rng.Next() - 0.5) * 80 * (mirror < 0 ? -1 : 1);
                using (var rig = HeadRig.Create(new Vector3((float)(rng.Next() * 12), (float)((rng.Next() - 0.5) * 10), (float)((rng.Next() - 0.5) * 6)),
                           new Vector3((float)(rng.Next() * 8), (float)((rng.Next() - 0.5) * 14), 0),
                           new Vector3((float)(-5 + (rng.Next() - 0.5) * 10), (float)((rng.Next() - 0.5) * 30), 0),
                           new Vector3((float)((rng.Next() - 0.5) * 8), (float)((rng.Next() - 0.5) * 30), (float)((rng.Next() - 0.5) * 8))))
                {
                    rig.SetHeading(heading);
                    var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                    double yaw = (rng.Next() - 0.5) * 70;
                    double pitch = (rng.Next() - 0.2) * 40;
                    // a target the neck can reach relative to the chest: check it, otherwise the test is about the range
                    pass.Turn(Frame((float)yaw, (float)pitch, 0).Ch, false, 1, null, mirror);
                    var d = rig.Head.rotation * Vector3.forward;
                    var chestLocal = Quaternion.Inverse(rig.Chest.rotation) * Expected(role, yaw, pitch, mirror);
                    double rel = Math.Atan2(chestLocal.x, chestLocal.z) * Deg;
                    if (Math.Abs(rel) > 80 || Math.Abs(Math.Atan2(-chestLocal.y, Math.Sqrt(chestLocal.x * chestLocal.x + chestLocal.z * chestLocal.z)) * Deg - 2.5) > 45) continue;
                    double err = Angle(d, Expected(role, yaw, pitch, mirror));
                    worst = Math.Max(worst, err);
                    Assert.That(err, Is.LessThan(0.05), role + " mirror " + mirror + " trial " + trial + ": the head points " + err.ToString("0.000") + " degrees off the plan's head in space");
                }
            }
            Console.WriteLine("head pass pointing, " + role + " mirror " + mirror + ": worst error " + worst.ToString("0.0000") + " degrees");
        }

        [Test]
        public void Neck_TakesAThirdOfTheTurn_AndTheHeadTheRest_AboutOneAxis()
        {
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                pass.Turn(Frame(30, 0, 0).Ch, false, 1, null, 1f);
                double neck = LocalStep(rig.NeckBase, rig.Neck.localRotation);
                double head = LocalStep(rig.HeadBase, rig.Head.localRotation);
                Assert.That(neck, Is.EqualTo(30 * 0.35).Within(0.05), "the neck's share");
                Assert.That(head, Is.EqualTo(30 * 0.65).Within(0.05), "the head's share");
            }
        }

        [Test]
        public void ReducedMotion_TurnsHalfTheWay()
        {
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                pass.Turn(Frame(30, 0, 0, 1, true).Ch, true, 1, null, 1f);
                double total = Angle(rig.Head.rotation * Vector3.forward, Vector3.forward);
                Assert.That(total, Is.EqualTo(15).Within(0.05), "in Reduced Motion the head closes half the distance to the head in space");
            }
        }

        [Test]
        public void TheFade_ScalesTheTurn()
        {
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                pass.Turn(Frame(30, 0, 0).Ch, false, 0.25, null, -1f);
                Assert.That(Angle(rig.Head.rotation * Vector3.forward, Vector3.forward), Is.EqualTo(7.5).Within(0.05));
            }
        }

        [Test]
        public void OnlyTheNeckAndTheHeadMove()
        {
            using (var rig = HeadRig.Create(new Vector3(8, 0, 0), new Vector3(4, 10, 0), Vector3.zero, Vector3.zero))
            {
                var all = new[] { rig.Root.transform, rig.Hips, rig.Spine, rig.Chest };
                var before = new List<Quaternion>();
                var positions = new List<Vector3>();
                foreach (var t in all) { before.Add(t.rotation); positions.Add(t.position); }
                var neckPos = rig.Neck.position;
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Striker);
                pass.Apply(Frame(-20, 12, 3), 100, -1f, new StageDrawnHead());
                for (int i = 0; i < all.Length; i++)
                {
                    Assert.That(all[i].rotation, Is.EqualTo(before[i]), "bone " + all[i].name + " rotation");
                    Assert.That(all[i].position, Is.EqualTo(positions[i]), "bone " + all[i].name + " position");
                }
                Assert.That(rig.Neck.position, Is.EqualTo(neckPos), "the neck's own origin (it turns about it)");
            }
        }

        // ------------------------------------------------------------------------------------------------ undo

        [Test]
        public void Undo_PutsTheWorldsBonesBack_ExactlyWhileTheRigIsNotPosedAgain_AndNotAfter()
        {
            using (var rig = HeadRig.Create(new Vector3(8, 0, 0), new Vector3(4, 10, 0), new Vector3(-4, 6, 0), new Vector3(2, -3, 1)))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                var neck = rig.Neck.localRotation;
                var head = rig.Head.localRotation;
                pass.Apply(Frame(25, 15, 4), 100, -1f, new StageDrawnHead(), 7);
                Assert.That(rig.Neck.localRotation, Is.Not.EqualTo(neck));
                pass.Undo(7);
                Assert.That(rig.Neck.localRotation, Is.EqualTo(neck), "neck back exactly");
                Assert.That(rig.Head.localRotation, Is.EqualTo(head), "head back exactly");
                // a rig that has been posed since: the pose replaced the bones, the undo must not put stale ones over them
                pass.Apply(Frame(25, 15, 4), 117, -1f, new StageDrawnHead(), 8);
                var posed = Quaternion.Euler(1, 2, 3);
                rig.Neck.localRotation = posed;
                pass.Undo(9);
                Assert.That(rig.Neck.localRotation, Is.EqualTo(posed), "no undo over a pose written since");
            }
        }

        [Test]
        public void Redo_GivesTheTurnBackOnTheNewBase_OnlyOnceAndOnlyForTheFrameThatRan()
        {
            using (var rig = HeadRig.Create(new Vector3(8, 0, 0), new Vector3(4, 10, 0), new Vector3(-4, 6, 0), new Vector3(2, -3, 1)))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                var drawn = new StageDrawnHead();
                Assert.That(pass.Redo(1, 100), Is.False, "nothing to give back before the pass has run");
                pass.Apply(Frame(25, 15, 4), 100, -1f, drawn, 3);
                var neck = rig.Neck.localRotation;
                var head = rig.Head.localRotation;
                Assert.That(pass.Redo(3, 100), Is.False, "the turn is still on the bones");
                pass.Undo(3);
                Assert.That(pass.Redo(3, 100 + Step), Is.False, "a later frame's clock: the turn belongs to the frame that ran");
                // the bones as the world left them (not posed again): the same turn, bit for bit
                Assert.That(pass.Redo(3, 100), Is.True);
                Assert.That(Quaternion.Angle(rig.Neck.localRotation, neck), Is.LessThan(0.0005f), "neck as it was");
                Assert.That(Quaternion.Angle(rig.Head.localRotation, head), Is.LessThan(0.0005f), "head as it was");
                Assert.That(pass.Redo(3, 100), Is.False, "only once");
                // undo still takes it off after a redo
                var world = Quaternion.Euler(0, 0, 0);
                pass.Undo(3);
                Assert.That(rig.Neck.localRotation, Is.Not.EqualTo(neck));
                // the rig is posed afresh (the accept): a slightly different base gets the same local turn on top
                rig.NeckBase = Quaternion.Euler(-3.5f, 6.4f, 0.2f);
                rig.Repose();
                var bare = rig.Head.rotation * Vector3.forward;
                Assert.That(pass.Redo(4, 100), Is.True);
                var turned = rig.Head.rotation * Vector3.forward;
                Assert.That(Vector3.Angle(bare, turned), Is.GreaterThan(5f), "the head is turned again (it was 25/15 degrees away)");
                pass.Undo(4);
                Assert.That(Quaternion.Angle(rig.Head.localRotation, rig.HeadBase), Is.LessThan(0.0005f), "and the next frame's undo puts the base back");
            }
        }

        [TestCase(DirectorRole.Striker, -1f)]
        [TestCase(DirectorRole.Striker, 1f)]
        public void Hold_KeepsTheHeadStillInSpace_WhilePlanAndBodyMove_ThenCatchesUpUnderTheCaps(DirectorRole role, float mirror)
        {
            using (var rig = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 0, 0), new Vector3(-4, 0, 0), Vector3.zero))
            {
                rig.SetHeading(180);
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                var drawn = new StageDrawnHead();
                double t = 0;
                // the head follows a ball that comes down: the plan's pitch rises 2.8 degrees a frame
                double pitch = 6;
                for (int i = 0; i < 8; i++)
                {
                    rig.Repose();
                    pass.Apply(Frame(-2, (float)pitch, 0, 1, false, true), t, mirror, drawn, 1);
                    t += Step;
                    pitch += 2.8;
                }
                Assert.That(pass.Holding, Is.False);
                double y0, p0, r0;
                pass.Measure(mirror, out y0, out p0, out r0);
                var d0 = rig.Head.rotation * Vector3.forward;
                // the stroke begins: ten frames held; the plan keeps going down, the trunk's load drifts by 4 degrees. The head, turning at
                // 168 deg/s, stops within the 2.4 degrees the brake needs (not in the frame), and then it is still in space.
                double travel = 0, settled = 0, lastStep = 0;
                Vector3 previous = d0;
                for (int i = 0; i < 10; i++)
                {
                    rig.ChestBase = Quaternion.Euler(3 + 0.4f * (i + 1), 0.2f * i, 0);
                    rig.Repose();
                    pass.Apply(Frame(-2, (float)pitch, 0, 1, false, true), t, mirror, drawn, 1, true);
                    t += Step;
                    pitch += 1.5;
                    Assert.That(pass.Holding, Is.True);
                    var d = rig.Head.rotation * Vector3.forward;
                    travel = Vector3.Angle(d0, d);
                    if (i >= 4) settled = Math.Max(settled, Vector3.Angle(previous, d));
                    lastStep = Vector3.Angle(previous, d);
                    previous = d;
                }
                Console.WriteLine("hold " + role + " mirror " + mirror + ": the head stopped " + travel.ToString("0.00") + " degrees on, and moved " + settled.ToString("0.0000") + " degrees a frame once it had (the plan moved 15 more)");
                Assert.That(travel, Is.LessThan(3.5), "it stops where the brake stops it (2.4 degrees at this speed)");
                Assert.That(settled, Is.LessThan(0.05), "and then the head is still in space");
                Assert.That(lastStep, Is.LessThan(0.05));
                // the result arrives: the hold ends; the head goes to the plan under the caps (no step over the cap, no overshoot, and it arrives)
                Quaternion pn = rig.Neck.localRotation, ph = rig.Head.localRotation;
                double worstSpeed = 0, worstChange = 0, pnSpeed = 0, phSpeed = 0, y, p, r = 0;
                for (int i = 0; i < 40; i++)
                {
                    rig.Repose();
                    pass.Apply(Frame(-2, (float)pitch, 0, 1, false, true), t, mirror, drawn, 1, false);
                    t += Step;
                    double sn = LocalStep(pn, rig.Neck.localRotation) * 60, sh = LocalStep(ph, rig.Head.localRotation) * 60;
                    worstSpeed = Math.Max(worstSpeed, Math.Max(sn, sh));
                    if (i > 0) worstChange = Math.Max(worstChange, Math.Max(Math.Abs(sn - pnSpeed), Math.Abs(sh - phSpeed)));
                    pnSpeed = sn;
                    phSpeed = sh;
                    pn = rig.Neck.localRotation;
                    ph = rig.Head.localRotation;
                }
                pass.Measure(mirror, out y, out p, out r);
                Console.WriteLine("catch-up " + role + " mirror " + mirror + ": worst local speed " + worstSpeed.ToString("0.0") + " deg/s, change of speed " + worstChange.ToString("0.0") + " deg/s per frame, arrived at pitch " + p.ToString("0.00") + " of " + pitch.ToString("0.00"));
                Assert.That(pass.Holding, Is.False);
                Assert.That(worstSpeed, Is.LessThan(720), "the speed cap holds through the catch-up");
                Assert.That(worstChange, Is.LessThan(300), "and the change of speed");
                Assert.That(p, Is.EqualTo(pitch).Within(0.2), "the head arrives at the plan");
            }
        }

        [Test]
        public void Hold_WithoutAHeadToKeep_TurnsAsThePlanSays_AndALapseOfThePassEndsIt()
        {
            using (var rig = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 0, 0), new Vector3(-4, 0, 0), Vector3.zero))
            {
                rig.SetHeading(180);
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Striker);
                var drawn = new StageDrawnHead();
                // the very first frame is a hold: there is no head to keep (nothing was drawn before), so the plan's head is drawn
                pass.Apply(Frame(0, 20, 0, 1, false, true), 0, -1f, drawn, 1, true);
                Assert.That(pass.Holding, Is.False);
                double y, p, r;
                pass.Measure(-1f, out y, out p, out r);
                Assert.That(p, Is.GreaterThan(1.0), "turned towards the plan");
                pass.Apply(Frame(0, 20, 0, 1, false, true), Step, -1f, drawn, 1, true);
                Assert.That(pass.Holding, Is.True);
                // the frame is off (no plan): the hold lapses
                pass.Apply(new DirectedFrame { On = false }, 2 * Step, -1f, drawn, 1, true);
                Assert.That(pass.Holding, Is.False);
            }
        }

        [TestCase(DirectorRole.Bowler, -1f, 1200.0)]
        [TestCase(DirectorRole.Bowler, 1f, 700.0)]
        [TestCase(DirectorRole.Striker, -1f, 900.0)]
        [TestCase(DirectorRole.Striker, 1f, 300.0)]
        public void WorldGuard_OnABodyThatTurnsFasterThanTheCap_TheDirectorNeverAddsToTheSpeedOfTheHeadTheWorldDrew(DirectorRole role, float mirror, double bodyDegPerS)
        {
            // a body that turns right round (the bowler's walk-back: over 1,000 deg/s in the clips) while the plan keeps asking for the opponent
            using (var rig = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 10, 0), new Vector3(-4, 4, 0), Vector3.zero))
            using (var bare = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 10, 0), new Vector3(-4, 4, 0), Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                var drawn = new StageDrawnHead();
                double heading = role == DirectorRole.Bowler ? 0 : 180;
                double t = 0;
                Quaternion previousBare = bare.Head.rotation, previousHead = rig.Head.rotation, previousBareNeck = bare.Neck.rotation, previousNeck = rig.Neck.rotation;
                double worstExcess = -1000, worstHeadSpeed = 0;
                double perFrame = bodyDegPerS / 60.0;
                for (int i = 0; i < 90; i++)
                {
                    // the body turns for 40 frames, then rests
                    if (i < 40) heading += perFrame;
                    rig.SetHeading(heading);
                    bare.SetHeading(heading);
                    rig.Repose();
                    bare.Repose();
                    pass.Apply(Frame(role == DirectorRole.Bowler ? 5 : -5, 12, 0, 1, false, true), t, mirror, drawn, 1);
                    t += Step;
                    if (i > 2)
                    {
                        double headStep = Quaternion.Angle(previousHead, rig.Head.rotation), baseStep = Quaternion.Angle(previousBare, bare.Head.rotation);
                        double neckStep = Quaternion.Angle(previousNeck, rig.Neck.rotation), baseNeckStep = Quaternion.Angle(previousBareNeck, bare.Neck.rotation);
                        double cap = 600.0 / 60.0;
                        // (where the base head itself turns faster than the cap; below it the bone caps alone apply)
                        if (baseStep > cap) worstExcess = Math.Max(worstExcess, headStep - baseStep);
                        worstHeadSpeed = Math.Max(worstHeadSpeed, headStep * 60);
                    }
                    previousBare = bare.Head.rotation;
                    previousHead = rig.Head.rotation;
                    previousBareNeck = bare.Neck.rotation;
                    previousNeck = rig.Neck.rotation;
                }
                Console.WriteLine("world guard " + role + " mirror " + mirror + " body " + bodyDegPerS + " deg/s: the head's world speed at most " + worstHeadSpeed.ToString("0") + " deg/s; the most it ever exceeded the base head's own step by " + worstExcess.ToString("0.000") + " deg");
                Assert.That(worstExcess, Is.LessThan(0.05), "the head never turned in the world by more than the head the world drew, where that was past the cap");
            }
        }

        // ------------------------------------------------------------------------------------------------ F3: the head of a bowler who has turned away

        // The web's finding of 2026-11-07 (WEB-FIX-B, F3), and its three rules, ported: a plan target behind the chest is pulled to the chest's front, but
        // the pitch stayed the chest-frame pitch measured BEHIND it (64 degrees for a plan of 24); clamped to the neck's range plus the chest's lean the
        // head hung 85 to 89 degrees down, a near-vertical look whose yaw flips by 180 degrees, and the one ~180 degree rotation the neck and head share
        // flipped its axis at exactly 180: 61 degrees of the neck and 106 of the head in ONE frame. (1) the pulled look keeps the world pitch the plan
        // wants (weighted by how far behind the chest it is); (2) a turn within 29 degrees of 180 is eased to nothing as it nears it; (3) a frame posed
        // twice is the frame posed once.

        private static HeadRig LeanedRig(double lean)
        {
            // the spine and the chest leaned about x by half the lean each (the web's chain(lean))
            return HeadRig.Create(new Vector3((float)(lean / 2), 0, 0), new Vector3((float)(lean / 2), 0, 0), Vector3.zero, Vector3.zero);
        }

        /// <summary>The heading sweep of the web's test: -150 to -210 and back in half degrees (the body passes -180, the plan stays on the batter).</summary>
        private static IEnumerable<double> HeadingSweep()
        {
            for (int k = 0; k < 121; k++) yield return -150 - k * 0.5;
            for (int k = 0; k < 120; k++) yield return -210 + (k + 1) * 0.5;
        }

        [TestCase(0, -1f)]
        [TestCase(35, -1f)]
        [TestCase(55, -1f)]
        [TestCase(0, 1f)]
        [TestCase(35, 1f)]
        [TestCase(55, 1f)]
        public void F3_TheHeadPassAlone_OnAHeadingSweepThroughPlusMinus180_StepsNoMoreThanEightDegreesForAHalfDegreeOfHeading_AndTheHeadNeverHangsDown(int lean, float mirror)
        {
            using (var rig = LeanedRig(lean))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                var plan = Frame(-1.3f, 24f, 0);
                double worstStep = 0, lowest = -90;
                int pulled = 0;
                Quaternion pn = default, ph = default;
                bool have = false;
                foreach (var heading in HeadingSweep())
                {
                    rig.SetHeading(heading);
                    rig.Repose();
                    pass.Turn(plan.Ch, false, 1, null, mirror);
                    if (pass.Clamped) pulled++;
                    double yaw, pitch, roll;
                    pass.Measure(mirror, out yaw, out pitch, out roll);
                    lowest = Math.Max(lowest, pitch);
                    if (have) worstStep = Math.Max(worstStep, Math.Max(LocalStep(pn, rig.Neck.localRotation), LocalStep(ph, rig.Head.localRotation)));
                    pn = rig.Neck.localRotation;
                    ph = rig.Head.localRotation;
                    have = true;
                }
                Console.WriteLine("F3 head pass alone, chest leaned " + lean + " mirror " + mirror + ": worst neck/head step " + worstStep.ToString("0.00") + " deg per half degree of heading; the head's lowest look " + lowest.ToString("0.0") + " deg down; pulled in " + pulled + " of 241");
                Assert.That(pulled, Is.GreaterThan(50), "the sweep reaches the pulled range");
                Assert.That(worstStep, Is.LessThan(8), "no step of the neck or head over 8 degrees for a half degree of heading (it was up to 126 with a chest leaned 55)");
                Assert.That(lowest, Is.LessThan(55), "and the head never hangs down");
            }
        }

        [TestCase(0, -1f, 4.0, false)]
        [TestCase(35, -1f, 4.0, true)]
        [TestCase(55, -1f, 4.0, true)]
        [TestCase(55, 1f, 6.0, false)]
        [TestCase(55, 1f, 12.0, true)]
        [TestCase(35, 1f, 12.0, false)]
        public void F3_AsDrawn_TheBowlerWhoTurnsAwayOnALeanedChest_NeckAndHeadStepNoMoreThanTwelveDegreesAFrame_AndTheHeadLooksNoMoreThanSixtyDegreesDown(int lean, float mirror, double degPerFrame, bool brake)
        {
            using (var rig = LeanedRig(lean))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                var drawn = new StageDrawnHead();
                var plan = Frame(-1.3f, 24f, 0, 1, false, brake);
                double heading = -150, t = 0, worstStep = 0, lowest = -90, finalPitch = 0, finalRel = 0;
                Quaternion pn = default, ph = default;
                bool have = false;
                // the body turns from -150 to -210 and back, then rests turned away (the plan stays on the batter behind him)
                for (int i = 0; i < 400; i++)
                {
                    double target = i < 60 / degPerFrame * 2 ? (i < 60 / degPerFrame ? -150 - degPerFrame * i : -210 + degPerFrame * (i - 60 / degPerFrame)) : -150;
                    heading = target;
                    rig.SetHeading(heading);
                    rig.Repose();
                    pass.Apply(plan, t, mirror, drawn, 1);
                    t += Step;
                    double yaw, pitch, roll;
                    pass.Measure(mirror, out yaw, out pitch, out roll);
                    lowest = Math.Max(lowest, pitch);
                    if (have) worstStep = Math.Max(worstStep, Math.Max(LocalStep(pn, rig.Neck.localRotation), LocalStep(ph, rig.Head.localRotation)));
                    pn = rig.Neck.localRotation;
                    ph = rig.Head.localRotation;
                    have = true;
                    finalPitch = pitch;
                }
                Console.WriteLine("F3 as drawn, chest leaned " + lean + " mirror " + mirror + " body " + degPerFrame + " deg/frame brake " + brake + ": worst neck/head step " + worstStep.ToString("0.00") + " deg a frame; lowest look " + lowest.ToString("0.0") + " deg down; at rest " + finalPitch.ToString("0.0"));
                Assert.That(worstStep, Is.LessThanOrEqualTo(12.0 + 1e-3), "neck and head keep to 720 deg/s");
                Assert.That(lowest, Is.LessThan(60), "the head never looks more than 60 degrees below the horizon");
                Assert.That(finalPitch, Is.InRange(-10, 50), "and at rest it is a sensible pose");
            }
        }

        [Test]
        public void F3_AFramePosedTwice_IsTheFramePosedOnce_BitForBit()
        {
            // Undo and Repose between the two passes: the rig is posed afresh and the pass runs again for the same frame time (a Tick of no time, a camera
            // pass, a probe). The bone caps and the world guard start from where the frame began.
            foreach (var role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                foreach (var mirror in new[] { -1f, 1f })
                {
                    using (var once = LeanedRig(30))
                    using (var twice = LeanedRig(30))
                    {
                        var p1 = new DirectorHeadPass(once.Chest, once.Neck, once.Head, role);
                        var p2 = new DirectorHeadPass(twice.Chest, twice.Neck, twice.Head, role);
                        var d1 = new StageDrawnHead();
                        var d2 = new StageDrawnHead();
                        var rng = new TestRng(11);
                        double t = 0, heading = role == DirectorRole.Bowler ? 0 : 180;
                        int identical = 0, held = 0;
                        for (int i = 0; i < 160; i++)
                        {
                            // the body turns fast now and then and the plan jumps, so that the caps hold something back
                            if (i % 30 == 10) heading += 70;
                            if (i % 30 == 20) heading -= 70;
                            var plan = Frame((float)((i / 17 % 2 == 0 ? 1 : -1) * (15 + 30 * rng.Next())), (float)(5 + 25 * rng.Next()), 0, 1, false, true);
                            foreach (var rig in new[] { once, twice }) { rig.SetHeading(heading); rig.Repose(); }
                            p1.Apply(plan, t, mirror, d1, 1);
                            p2.Apply(plan, t, mirror, d2, 1);
                            // the second pass of the same frame on the second rig
                            p2.Undo(1);
                            twice.Repose();
                            p2.Apply(plan, t, mirror, d2, 1);
                            if (p1.Limited) held++;
                            bool same = once.Neck.localRotation == twice.Neck.localRotation && once.Head.localRotation == twice.Head.localRotation;
                            Assert.That(same, Is.True, role + " mirror " + mirror + " frame " + i + ": the frame posed twice is not the frame posed once");
                            identical++;
                            t += Step;
                        }
                        Console.WriteLine("F3 posed twice, " + role + " mirror " + mirror + ": " + identical + " frames bit-equal, " + held + " of them with a bone held back (the comparison is not vacuous)");
                        Assert.That(held, Is.GreaterThan(5));
                    }
                }
        }

        private static double OldYawReach(double x)
        {
            double t = x < 0 ? -x : x;
            if (t <= 85) return x;
            double u = Math.Min(1, (t - 85) / (165 - 85));
            double y = t * (1 - u * u * (3 - 2 * u));
            return x < 0 ? -y : y;
        }

        private static double OldKnee(double x, double limit)
        {
            double a = 0.9 * limit;
            double t = x < 0 ? -x : x;
            if (t <= a) return x;
            double y = a + (limit - a) * Math.Tanh((t - a) / (limit - a));
            return x < 0 ? -y : y;
        }

        [TestCase(DirectorRole.Bowler, -1f)]
        [TestCase(DirectorRole.Bowler, 1f)]
        [TestCase(DirectorRole.Striker, -1f)]
        [TestCase(DirectorRole.Striker, 1f)]
        public void F3_InsideTheFreeRange_ThePoseIsTheOldRulesBitForBit(DirectorRole role, float mirror)
        {
            var rng = new TestRng(2026);
            int inside = 0, pulledOutside = 0;
            for (int trial = 0; trial < 600; trial++)
            {
                double lean = rng.Next() * 40;
                using (var rig = HeadRig.Create(new Vector3((float)(lean / 2), (float)((rng.Next() - 0.5) * 20), 0), new Vector3((float)(lean / 2), (float)((rng.Next() - 0.5) * 60), (float)((rng.Next() - 0.5) * 10)), Vector3.zero, Vector3.zero))
                {
                    rig.SetHeading((role == DirectorRole.Bowler ? 0 : 180) + (rng.Next() - 0.5) * 360);
                    var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                    // (the channels are floats: the pass sees the plan's head as the plan stores it)
                    double yaw = (float)((rng.Next() - 0.5) * 360), pitch = (float)((rng.Next() - 0.2) * 80);
                    pass.Turn(Frame((float)yaw, (float)pitch, 0).Ch, false, 1, null, mirror);
                    // the old rule, from the same chest
                    double cy = Math.Cos(yaw / Deg), sy = Math.Sin(yaw / Deg), cp = Math.Cos(pitch / Deg), sp = Math.Sin(pitch / Deg);
                    double sgn = role == DirectorRole.Bowler ? 1 : -1;
                    var cq = new Quaternion(rig.Chest.rotation.x, mirror * rig.Chest.rotation.y, mirror * rig.Chest.rotation.z, rig.Chest.rotation.w);
                    // (the pass has turned the neck and head, not the chest: the chest is where it was)
                    Vector3 v = Quaternion.Inverse(cq) * new Vector3((float)(sgn * sy * cp), (float)(-sp), (float)(sgn * cy * cp));
                    double yc = Math.Atan2(v.x, v.z) * Deg;
                    double pc = Math.Atan2(-v.y, Math.Sqrt((double)v.x * v.x + (double)v.z * v.z)) * Deg;
                    if (Math.Abs(yc) > 85) { if (pass.Clamped) pulledOutside++; continue; }
                    double mid = (55 - 60) / 2.0, half = (55 + 60) / 2.0;
                    double y2 = OldYawReach(yc), p2 = OldKnee(pc - mid, half) + mid;
                    double expectedYaw, expectedPitch;
                    if (Math.Abs(y2 - yc) < 1e-9 && Math.Abs(p2 - pc) < 1e-9) { expectedYaw = yaw; expectedPitch = pitch; }
                    else
                    {
                        double cy2 = Math.Cos(y2 / Deg), sy2 = Math.Sin(y2 / Deg), cp2 = Math.Cos(p2 / Deg), sp2 = Math.Sin(p2 / Deg);
                        Vector3 a = cq * new Vector3((float)(sy2 * cp2), (float)(-sp2), (float)(cy2 * cp2));
                        expectedYaw = (role == DirectorRole.Bowler ? Math.Atan2(a.x, a.z) : Math.Atan2(-a.x, -a.z)) * Deg;
                        expectedPitch = Math.Atan2(-a.y, Math.Sqrt((double)a.x * a.x + (double)a.z * a.z)) * Deg;
                    }
                    inside++;
                    Assert.That(pass.ReachableYaw, Is.EqualTo(expectedYaw), "trial " + trial + " yaw inside the free range (|yc| " + yc.ToString("0.0") + ")");
                    Assert.That(pass.ReachablePitch, Is.EqualTo(expectedPitch), "trial " + trial + " pitch inside the free range");
                }
            }
            Console.WriteLine("F3 free range, " + role + " mirror " + mirror + ": " + inside + " trials inside |yc| <= 85 bit-equal to the old rule");
            Assert.That(inside, Is.GreaterThan(100));
        }

        // ------------------------------------------------------------------------------------------------ the caps

        [TestCase(false)]
        [TestCase(true)]
        public void Limiter_HoldsTheSectionNineCaps_ThroughCutsOfTheTargetAndOfTheClip(bool brakeBowler)
        {
            foreach (var role in new[] { DirectorRole.Bowler, DirectorRole.Striker })
                foreach (var mirror in new[] { -1f, 1f })
                {
                    var rng = new TestRng(5);
                    using (var rig = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 0, 0), new Vector3(-4, 0, 0), Vector3.zero))
                    {
                        rig.SetHeading(role == DirectorRole.Bowler ? 0 : 180);
                        var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                        var drawn = new StageDrawnHead();
                        double t = 0;
                        Quaternion pn = rig.Neck.localRotation, ph = rig.Head.localRotation;
                        double pnSpeed = 0, phSpeed = 0, worstSpeed = 0, worstChange = 0;
                        for (int i = 0; i < 600; i++)
                        {
                            // the clip's own neck and head cut (30 degrees) every 40 frames, the plan's target jumps every 25
                            if (i % 40 == 0) { rig.NeckBase = Quaternion.Euler(-4 + (float)((rng.Next() - 0.5) * 30), (float)((rng.Next() - 0.5) * 50), 0); rig.HeadBase = Quaternion.Euler((float)((rng.Next() - 0.5) * 20), (float)((rng.Next() - 0.5) * 40), 0); }
                            rig.Repose();
                            double yaw = ((i / 25) % 2 == 0 ? 1 : -1) * (10 + 40 * rng.Next() * 0 + 25);
                            pass.Apply(Frame((float)yaw, (float)(5 + (i / 25) % 3 * 8), 0, 1, false, role == DirectorRole.Striker || brakeBowler), t, mirror, drawn);
                            t += Step;
                            if (i > 0)
                            {
                                double sn = LocalStep(pn, rig.Neck.localRotation) * 60, sh = LocalStep(ph, rig.Head.localRotation) * 60;
                                if (i > 2)
                                {
                                    worstSpeed = Math.Max(worstSpeed, Math.Max(sn, sh));
                                    worstChange = Math.Max(worstChange, Math.Max(Math.Abs(sn - pnSpeed), Math.Abs(sh - phSpeed)));
                                }
                                pnSpeed = sn;
                                phSpeed = sh;
                            }
                            pn = rig.Neck.localRotation;
                            ph = rig.Head.localRotation;
                        }
                        Console.WriteLine("limiter " + role + " mirror " + mirror + ": worst local speed " + worstSpeed.ToString("0.0") + " deg/s, worst change of speed " + worstChange.ToString("0.0") + " deg/s per frame");
                        Assert.That(worstSpeed, Is.LessThan(720), role + " mirror " + mirror + ": neck/head speed cap");
                        // the striker's neck and head brake on arrival; the bowler's only after the release (before it they hold him on the batter, which
                        // a trunk turning at 500 deg/s asks them to follow: the web accepted that, MOTION-SPEC section 9 change of speed is held with the brake)
                        if (role == DirectorRole.Striker || brakeBowler) Assert.That(worstChange, Is.LessThan(300), role + " mirror " + mirror + ": change of speed per frame cap");
                    }
                }
        }

        [Test]
        public void Brake_TheStrikersHeadNeverOvershootsItsTarget()
        {
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                rig.SetHeading(180);
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Striker);
                var drawn = new StageDrawnHead();
                double t = 0;
                double max = 0;
                for (int i = 0; i < 80; i++)
                {
                    rig.Repose();
                    pass.Apply(Frame(40, 0, 0, 1, false, true), t, -1f, drawn);
                    t += Step;
                    double yaw, pitch, roll;
                    pass.Measure(-1f, out yaw, out pitch, out roll);
                    max = Math.Max(max, yaw);
                }
                Assert.That(max, Is.LessThan(40.3), "the head arrives without passing the target");
                double finalYaw, p2, r2;
                pass.Measure(-1f, out finalYaw, out p2, out r2);
                Assert.That(finalYaw, Is.EqualTo(40).Within(0.1), "and it arrives");
            }
        }

        // ------------------------------------------------------------------------------------------------ the wrap

        /// <summary>
        /// The body turns right round twice (the heading crosses +-180 degrees, as the clips' walk-back turn does) while the plan keeps asking for the
        /// opponent. Neither the neck nor the head may change by more than 40 degrees in a frame (the cap is 12), nothing may be non-finite, and
        /// when the body rests again the head is on the opponent if the body faces him (within the neck's range), else back at the front of the chest.
        /// </summary>
        [TestCase(DirectorRole.Bowler, -1f, 0.0, 5.0, true)]
        [TestCase(DirectorRole.Bowler, 1f, 0.0, 5.0, true)]
        [TestCase(DirectorRole.Bowler, -1f, 40.0, 12.0, true)]
        [TestCase(DirectorRole.Bowler, 1f, -170.0, 3.0, false)]
        [TestCase(DirectorRole.Bowler, -1f, 178.0, 4.0, false)]
        [TestCase(DirectorRole.Striker, -1f, 180.0, 5.0, true)]
        [TestCase(DirectorRole.Striker, 1f, 180.0, 12.0, true)]
        [TestCase(DirectorRole.Striker, -1f, 10.0, 7.0, false)]
        [TestCase(DirectorRole.Striker, 1f, -179.0, 6.0, true)]
        public void TheBodyTurnsRightRound_HeadingCrossingPlusOrMinus180_NoStepOverFortyDegrees_AndTheHeadIsSensibleAfterwards(DirectorRole role, float mirror, double startHeading, double degPerFrame, bool facesTheOpponent)
        {
            foreach (var direction in new[] { 1.0, -1.0 })
            using (var rig = HeadRig.Create(new Vector3(8, 0, 0), new Vector3(4, 0, 0), new Vector3(-5, 0, 0), new Vector3(0, 0, 0)))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, role);
                var drawn = new StageDrawnHead();
                double t = 0;
                Quaternion pn = rig.NeckBase, ph = rig.HeadBase;
                double worstNeck = 0, worstHead = 0;
                int turnFrames = (int)Math.Ceiling(2 * 360 / degPerFrame);
                int frames = turnFrames + 120;
                for (int i = 0; i < frames; i++)
                {
                    // two turns right round, then the body rests at the heading it started with
                    double heading = i < turnFrames ? startHeading + direction * Math.Min(i * degPerFrame, 720) : startHeading;
                    rig.SetHeading(heading);
                    rig.Repose();
                    var frame = Frame(-1.5f, 3f, 0, 1, false, role == DirectorRole.Striker || i > 30);
                    pass.Apply(frame, t, mirror, drawn);
                    t += Step;
                    var n = rig.Neck.localRotation;
                    var h = rig.Head.localRotation;
                    Assert.That(float.IsNaN(n.x) || float.IsNaN(h.x), Is.False, "finite at frame " + i);
                    if (i > 0)
                    {
                        worstNeck = Math.Max(worstNeck, LocalStep(pn, n));
                        worstHead = Math.Max(worstHead, LocalStep(ph, h));
                    }
                    pn = n;
                    ph = h;
                    Assert.That(LocalStep(rig.NeckBase, n), Is.LessThan(100), "the neck's turn from the clip at frame " + i + " (heading " + Wrap(heading).ToString("0") + ")");
                }
                Console.WriteLine("wrap sweep " + role + " mirror " + mirror + " start " + startHeading + " " + degPerFrame + " deg/frame dir " + direction + ": worst neck step " + worstNeck.ToString("0.00") + ", head " + worstHead.ToString("0.00") + " deg/frame");
                Assert.That(worstNeck, Is.LessThan(40), "neck step per frame");
                Assert.That(worstHead, Is.LessThan(40), "head step per frame");
                Assert.That(worstNeck, Is.LessThan(12.0), "neck step per frame against the 720 deg/s cap");
                Assert.That(worstHead, Is.LessThan(12.0), "head step per frame against the 720 deg/s cap");
                var dHead = Quaternion.Inverse(rig.Chest.rotation) * (rig.Head.rotation * Vector3.forward);
                double rel = Math.Atan2(dHead.x, dHead.z) * Deg;
                if (facesTheOpponent)
                    Assert.That(Angle(rig.Head.rotation * Vector3.forward, Expected(role, -1.5, 3, mirror)), Is.LessThan(0.5), "the head after the turn is on the opponent again (heading " + Wrap(startHeading).ToString("0") + ")");
                else
                    Assert.That(Math.Abs(rel), Is.LessThan(12), "the opponent is behind the chest: the head is back at the front of it, not twisted round the neck (relative yaw " + rel.ToString("0.0") + ")");
            }
        }

        [Test]
        public void TheBodyFacingAwayFromTheOpponent_TheHeadReturnsToTheFront_NotWrappedRoundTheNeck()
        {
            // a bowler walking away: the opponent is behind the chest. The head must sit within the neck's range of the chest, never twisted
            // right round, and must stay put (no flip) as the heading wobbles across 180 degrees.
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                var drawn = new StageDrawnHead();
                double t = 0;
                Quaternion previous = Quaternion.identity;
                for (int i = 0; i < 240; i++)
                {
                    double heading = 180 + 12 * Math.Sin(i * 0.17);
                    rig.SetHeading(heading);
                    rig.Repose();
                    pass.Apply(Frame(0, 2, 0, 1, false, true), t, -1f, drawn);
                    t += Step;
                    var d = Quaternion.Inverse(rig.Chest.rotation) * (rig.Head.rotation * Vector3.forward);
                    double rel = Math.Abs(Math.Atan2(d.x, d.z) * Deg);
                    Assert.That(rel, Is.LessThan(95), "head relative to the chest at frame " + i + " (heading " + Wrap(heading).ToString("0") + ")");
                    if (i > 0) Assert.That(LocalStep(previous, rig.Head.localRotation), Is.LessThan(12), "head step at frame " + i);
                    previous = rig.Head.localRotation;
                }
            }
        }

        // ------------------------------------------------------------------------------------------------ the seam

        [Test]
        public void Seam_ContinuesFromTheHeadTheSceneBeforeEndedAndGivesItBack()
        {
            using (var rig = HeadRig.Create(Vector3.zero, Vector3.zero, Vector3.zero, Vector3.zero))
            {
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Bowler);
                // the scene before ended with the head 20 degrees down and 10 to the left of straight ahead; the delivery's first frame finds it at 0, 0
                var seam = new StageSeam { Pending = true, H0Yaw = 10, H0Pitch = 20, H0Roll = 0, K = 1, T0 = 16.7 };
                var drawn = new StageDrawnHead();
                var frame = new DirectedFrame { On = true, HasChannels = false, W = 0, Seam = seam, Brake = false };
                rig.Repose();
                pass.Apply(frame, 0, -1f, drawn);
                double y, p, r;
                pass.Measure(-1f, out y, out p, out r);
                Assert.That(y, Is.EqualTo(10).Within(0.1), "the first frame has the head the scene before ended with (yaw)");
                Assert.That(p, Is.EqualTo(20).Within(0.1), "(pitch)");
                // the share falls away: at 400 ms nothing is left
                seam.K = 0;
                rig.Repose();
                frame.Seam = seam;
                pass.Reset();
                pass.Apply(frame, 1000, -1f, drawn);
                pass.Measure(-1f, out y, out p, out r);
                Assert.That(Math.Abs(y), Is.LessThan(0.1), "given back (yaw)");
                Assert.That(Math.Abs(p), Is.LessThan(0.1), "given back (pitch)");
            }
        }

        // ------------------------------------------------------------------------------------------------ cost and allocation

        private static object ControlThatAllocates()
        {
            return new List<int>();
        }

        [Test]
        public void HeadPass_AllocatesNothing_AndIsCheap()
        {
            using (var rig = HeadRig.Create(new Vector3(6, 0, 0), new Vector3(3, 5, 0), new Vector3(-4, 0, 0), Vector3.zero))
            {
                rig.SetHeading(10);
                var pass = new DirectorHeadPass(rig.Chest, rig.Neck, rig.Head, DirectorRole.Striker);
                var drawn = new StageDrawnHead();
                var frame = Frame(-10, 8, 2, 1, false, true);
                double t = 0;
                for (int i = 0; i < 2000; i++)
                {
                    rig.Repose();
                    frame.Ch[Ch.HeadYaw] = (float)(20 * Math.Sin(i * 0.05));
                    pass.Apply(frame, t, -1f, drawn);
                    t += Step;
                }
                // IL: no allocating instruction reachable from the pass
                var found = new List<string>();
                var seen = new HashSet<System.Reflection.MethodBase>();
                foreach (var m in new[] { "Apply", "Turn", "Limit", "Undo", "Measure", "Note" })
                    StageAllocationScan.Scan(typeof(DirectorHeadPass).GetMethod(m), seen, found);
                Assert.That(found, Is.Empty, "allocating instructions in the head pass: " + string.Join("; ", found));
                Assert.That(seen.Count, Is.GreaterThan(8), "the scan reached the pass's helpers");
                // the scan is not blind: it finds a class being constructed
                var control = new List<string>();
                StageAllocationScan.Scan(typeof(DirectorHeadPassTests).GetMethod("ControlThatAllocates", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static), new HashSet<System.Reflection.MethodBase>(), control);
                Assert.That(control.Count, Is.GreaterThan(0), "positive control");
                // run time: the profiler's managed heap over many frames
                const int n = 20000;
                int gen0 = GC.CollectionCount(0);
                long bytes0 = DirectorSamplerTests.TryAllocatedBytes();
                long watch = System.Diagnostics.Stopwatch.GetTimestamp();
                for (int i = 0; i < n; i++)
                {
                    rig.Repose();
                    frame.Ch[Ch.HeadYaw] = (float)(20 * Math.Sin(i * 0.05));
                    pass.Apply(frame, t, -1f, drawn);
                    t += Step;
                }
                double us = (System.Diagnostics.Stopwatch.GetTimestamp() - watch) * 1e6 / System.Diagnostics.Stopwatch.Frequency / n;
                long bytes1 = DirectorSamplerTests.TryAllocatedBytes();
                Console.WriteLine("head pass: " + us.ToString("0.00") + " microseconds a frame with the Repose of the bones included (Unity Editor Mono); allocation counter delta " + (bytes1 - bytes0) + " B, gen-0 collections " + (GC.CollectionCount(0) - gen0));
                Assert.That(GC.CollectionCount(0) - gen0, Is.EqualTo(0), "gen-0 collections over " + n + " frames");
                if (DirectorSamplerTests.ExactCounterAvailable) Assert.That(bytes1 - bytes0, Is.EqualTo(0), "bytes allocated");
                Assert.That(us, Is.LessThan(200), "loose bound; the measured figure is in the log");
            }
        }
    }
}
