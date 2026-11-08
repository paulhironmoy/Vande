using System;
using NUnit.Framework;
using UnityEngine;
using Vande.Practice.Presentation;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// The touch-down stroke's geometry (ProductionTouchDownBat, the web's bat.ts TOUCHDOWN with FEEL-1's clearance and
    /// look-ahead): the soft cap, the rigid blend, and the guard's honesty and smoothness on synthetic balls. The same
    /// rules on the real world's golden deliveries are measured by VandeHumansEvidence.TouchdownSweep.
    /// </summary>
    public sealed class ProductionTouchDownBatTests
    {
        private sealed class Source : ProductionTouchDownBat.ISource
        {
            public Func<double, ProductionTouchDownBat.BatPose> Wait;
            public Func<double, Vector3> Ball;
            public ProductionTouchDownBat.BatPose NoInputAt(double t) => Wait(t);

            public bool BallAt(double t, out Vector3 ball)
            {
                ball = Ball(t);
                return true;
            }
        }

        private static ProductionTouchDownBat.BatPose Pose(Vector3 grip, Vector3 blade, Vector3 face) =>
            new ProductionTouchDownBat.BatPose
            {
                Grip = grip,
                Toe = grip + blade.normalized * ProductionTouchDownBat.BatLengthMetres,
                Face = face
            };

        // A waiting bat in a backlift (toe up and back, rising as the bowler gathers) and a hitting pose (the blade down
        // and forward): about 150 degrees apart, like the striker's stance bat and the code-authored stroke's contact bat.
        private static ProductionTouchDownBat.BatPose Waiting(double t)
        {
            var lift = (float)(0.2 * Math.Min(1.0, Math.Max(0.0, t / 0.4)));
            return Pose(new Vector3(-0.1f, 1.08f + lift, 0.02f), new Vector3(0.12f, 0.85f, 0.5f), new Vector3(0.18f, -0.62f, -0.76f));
        }

        private static readonly ProductionTouchDownBat.BatPose Hit =
            Pose(new Vector3(-0.05f, 0.95f, 0.18f), new Vector3(0.15f, -0.92f, -0.36f), new Vector3(0.1f, 0.4f, -0.9f));

        // The production world's gap: the code-authored stroke's contact bat is 70.7 degrees (blade) from the waiting bat
        // (measured by VandeHumansEvidence.TouchdownSweep on the web's 48 flights); the hands are 0.28 m apart.
        private static readonly ProductionTouchDownBat.BatPose HitNear = HitAt70(0.4);

        private static ProductionTouchDownBat.BatPose HitAt70(double t)
        {
            var wait = Waiting(t);
            var blade = (wait.Toe - wait.Grip).normalized;
            var turn = Quaternion.AngleAxis(70.7f, Vector3.Cross(blade, Vector3.up).normalized);
            return Pose(wait.Grip + new Vector3(0.2f, -0.15f, 0.12f), turn * blade, turn * wait.Face);
        }

        [Test]
        public void Travel_IsRealTimeAtFirstAndNeverPastTheCap()
        {
            Assert.That(ProductionTouchDownBat.Travel(0.0), Is.EqualTo(0.0));
            Assert.That(ProductionTouchDownBat.Travel(-1.0), Is.EqualTo(0.0));
            Assert.That(ProductionTouchDownBat.Travel(0.004), Is.EqualTo(0.004).Within(1e-5), "real time at first");
            Assert.That(ProductionTouchDownBat.Travel(10.0), Is.EqualTo(ProductionTouchDownBat.CapSeconds).Within(1e-9));
            var previous = 0.0;
            for (var t = 0.004; t < 0.5; t += 0.004)
            {
                var travel = ProductionTouchDownBat.Travel(t);
                Assert.That(travel, Is.GreaterThan(previous), "never going back, at " + t);
                Assert.That(travel, Is.LessThan(ProductionTouchDownBat.CapSeconds));
                previous = travel;
            }
        }

        [Test]
        public void Orientation_HasTheBladeAlongXAndTheFaceAlongY()
        {
            var pose = Waiting(0.0);
            var q = ProductionTouchDownBat.Orientation(pose);
            var blade = (pose.Toe - pose.Grip).normalized;
            Assert.That(Vector3.Distance(q * Vector3.right, blade), Is.LessThan(1e-5f));
            var face = pose.Face - blade * Vector3.Dot(pose.Face, blade);
            Assert.That(Vector3.Distance(q * Vector3.up, face.normalized), Is.LessThan(1e-5f));
        }

        [Test]
        public void Rigid_KeepsTheBatTheSameLengthAndTheHandsOnAStraightLine()
        {
            var a = Waiting(0.0);
            var b = Hit;
            Assert.That(Vector3.Distance(ProductionTouchDownBat.Rigid(a, b, 0.0).Toe, a.Toe), Is.EqualTo(0f));
            Assert.That(Vector3.Distance(ProductionTouchDownBat.Rigid(a, b, 1.0).Toe, b.Toe), Is.EqualTo(0f));
            var ha = Vector3.Lerp(a.Grip, a.Toe, ProductionTouchDownBat.HandsFromCapMetres / ProductionTouchDownBat.BatLengthMetres);
            var hb = Vector3.Lerp(b.Grip, b.Toe, ProductionTouchDownBat.HandsFromCapMetres / ProductionTouchDownBat.BatLengthMetres);
            for (var u = 0.05; u < 1.0; u += 0.05)
            {
                var pose = ProductionTouchDownBat.Rigid(a, b, u);
                Assert.That(Vector3.Distance(pose.Grip, pose.Toe), Is.EqualTo(ProductionTouchDownBat.BatLengthMetres).Within(1e-5f));
                var hands = Vector3.Lerp(pose.Grip, pose.Toe, ProductionTouchDownBat.HandsFromCapMetres / ProductionTouchDownBat.BatLengthMetres);
                Assert.That(Vector3.Distance(hands, Vector3.Lerp(ha, hb, (float)u)), Is.LessThan(1e-5f), "the hands travel straight at " + u);
            }
        }

        [Test]
        public void Guard_NeverDrawsTheBatNearerTheBallThanTheWaitingBat_AndNeverPopsBy8cmInFourMilliseconds(
            [Values("production-gap-70-degrees", "harsh-gap-150-degrees")] string geometry)
        {
            var hit = geometry == "harsh-gap-150-degrees" ? Hit : HitNear;
            var clear = (float)ProductionTouchDownBat.ClearMetres;
            var guardedFrames = 0;
            var unguardedViolations = 0;
            var samples = 0;
            var worstStep = 0f;
            var worstStepWhere = "";
            foreach (var x in new[] { -0.45f, -0.2f, 0f, 0.25f, 0.5f })
            foreach (var endY in new[] { 0.25f, 0.6f, 1.0f, 1.4f })
            foreach (var arrive in new[] { 0.36, 0.45, 0.55 })
            foreach (var pressAt in new[] { arrive - 0.30, arrive - 0.22, arrive - 0.15, arrive - 0.09, arrive - 0.03, arrive + 0.04 })
            {
                var xx = x;
                var yy = endY;
                var when = arrive;
                // The ball flies along +z through the bat's region (z about 0) and meets it at `arrive`.
                Func<double, Vector3> ball = t => new Vector3(xx, (float)(2.0 + (yy - 2.0) * Math.Min(1.0, t / when)),
                    (float)(-9.0 + 9.0 * t / when));
                var source = new Source { Wait = Waiting, Ball = ball };
                var touch = new ProductionTouchDownBat();
                touch.Begin(source, hit, pressAt);
                var havePrevious = false;
                var previous = default(ProductionTouchDownBat.BatPose);
                for (var t = pressAt; t <= pressAt + 0.5 + 1e-9; t += 0.004)
                {
                    var wait = Waiting(t);
                    ProductionTouchDownBat.BatPose drawn, asked;
                    touch.Draw(t, out drawn);
                    var askedDrawn = touch.DrawUnguarded(t, out asked);
                    var b = ball(t);
                    var need = Mathf.Min(ProductionTouchDownBat.Clearance(b, wait), clear);
                    samples++;
                    Assert.That(ProductionTouchDownBat.Clearance(b, drawn), Is.GreaterThanOrEqualTo(need - 1e-4f),
                        "never nearer than the waiting bat unless 0.15 m away: x " + x + " endY " + endY + " arrive " + arrive +
                        " press " + pressAt + " t " + t);
                    if (askedDrawn && ProductionTouchDownBat.Clearance(b, asked) < need - 1e-4f) unguardedViolations++;
                    if (Vector3.Distance(asked.Toe, drawn.Toe) > 1e-5f || Vector3.Distance(asked.Grip, drawn.Grip) > 1e-5f)
                        guardedFrames++;
                    if (havePrevious)
                    {
                        var step = Mathf.Max(Vector3.Distance(previous.Grip, drawn.Grip), Vector3.Distance(previous.Toe, drawn.Toe));
                        if (step > worstStep)
                        {
                            worstStep = step;
                            worstStepWhere = "x " + x + " endY " + endY + " arrive " + arrive + " press " + pressAt + " t " + t +
                                             "; travel then " + touch.GuardedTravel(t - 0.004).ToString("0.00000") +
                                             " now " + touch.GuardedTravel(t).ToString("0.00000") + "; ball " + b +
                                             " clearance idle " + ProductionTouchDownBat.Clearance(b, wait).ToString("0.000") +
                                             " drawn " + ProductionTouchDownBat.Clearance(b, drawn).ToString("0.000") +
                                             " asked " + ProductionTouchDownBat.Clearance(b, asked).ToString("0.000");
                        }
                    }
                    previous = drawn;
                    havePrevious = true;
                }
            }
            Assert.That(guardedFrames, Is.GreaterThan(samples / 50), "the scenario puts the ball where the guard has to hold the stroke: " + geometry);
            Assert.That(unguardedViolations, Is.GreaterThan(0), "and the unguarded stroke would have drawn a contact the waiting bat does not");
            Assert.That(worstStep, Is.LessThanOrEqualTo(0.08f), "the largest 4 ms step of the bat (m), " + geometry + ", at " + worstStepWhere);
        }

        [Test]
        public void Stroke_TurnsTheBladeNoFurtherThanTheCap_AndKeepsTheWaitingBatsLength()
        {
            // The turn is Reach of the gap up to MaxTurnDegrees (the web's visible 20.1 degrees at the cap); a bat longer
            // than the standard one (the body's scale) keeps its own length, so the first frame does not jump along it.
            var wait = Waiting(0.4);
            var longer = Pose(wait.Grip, wait.Toe - wait.Grip, wait.Face);
            longer.Toe = wait.Grip + (wait.Toe - wait.Grip).normalized * (ProductionTouchDownBat.BatLengthMetres * 1.05f);
            foreach (var gap in new[] { 10f, 30f, 57.5f, 70.7f, 110f, 150f, 179f })
            {
                var blade = (longer.Toe - longer.Grip).normalized;
                var axis = Vector3.Cross(blade, Vector3.up).normalized;
                var target = Pose(wait.Grip + new Vector3(0.2f, -0.1f, 0.1f), Quaternion.AngleAxis(gap, axis) * blade,
                    Quaternion.AngleAxis(gap, axis) * wait.Face);
                var blend = new ProductionTouchDownBat.Blend(longer, target);
                Assert.That(blend.SwingDegrees, Is.EqualTo(gap).Within(0.01f), "the swing is the angle between the blades");
                var stroke = blend.Stroke(1.0);
                var turned = Vector3.Angle(stroke.Toe - stroke.Grip, longer.Toe - longer.Grip);
                var expected = Math.Min(ProductionTouchDownBat.Reach * gap, ProductionTouchDownBat.MaxTurnDegrees);
                Assert.That(turned, Is.EqualTo((float)expected).Within(0.05f), "the blade turns Reach of the gap, no more than the cap, at gap " + gap);
                Assert.That(Vector3.Distance(stroke.Grip, stroke.Toe), Is.EqualTo(Vector3.Distance(longer.Grip, longer.Toe)).Within(1e-4f),
                    "the bat keeps the waiting bat's length at gap " + gap);
                var first = blend.Stroke(0.001);
                Assert.That(Vector3.Distance(first.Toe, longer.Toe), Is.LessThan(0.005f), "the first frame hardly moves the toe at gap " + gap);
                Assert.That(Vector3.Distance(first.Grip, longer.Grip), Is.LessThan(0.005f), "nor the grip at gap " + gap);
            }
        }

        [Test]
        public void Blend_DoesNotJumpWhenTheWaitingBatsFaceRollsThroughTheFramesBeingOppositeOnes()
        {
            // The two bats' frames are 180 degrees apart for one roll of the waiting face. A slerp of the frames takes the
            // shorter way round, and there the way flips and the blade jumps to the other side (1.1 m at the toe in 4 ms
            // in the striker's backlift). The blade's path does not depend on the roll: the blade of the stroke is the
            // same however the waiting face is rolled, and the face rolls continuously.
            var wait = Waiting(0.4);
            var blade = (wait.Toe - wait.Grip).normalized;
            var target = HitNear;
            var targetBlade = (target.Toe - target.Grip).normalized;
            var reference = new ProductionTouchDownBat.Blend(wait, target).Stroke(1.0);
            var previousFace = reference.Face;
            for (var roll = 0f; roll <= 360f; roll += 1f)
            {
                var rolled = new ProductionTouchDownBat.BatPose
                {
                    Grip = wait.Grip,
                    Toe = wait.Toe,
                    Face = Quaternion.AngleAxis(roll, blade) * wait.Face
                };
                var stroke = new ProductionTouchDownBat.Blend(rolled, target).Stroke(1.0);
                Assert.That(Vector3.Distance(stroke.Toe, reference.Toe), Is.LessThan(1e-4f), "the blade is the same at roll " + roll);
                Assert.That(Vector3.Distance(stroke.Grip, reference.Grip), Is.LessThan(1e-4f), "and so is the grip at roll " + roll);
                Assert.That(Vector3.Dot(stroke.Face, stroke.Toe - stroke.Grip), Is.EqualTo(0f).Within(1e-4f), "the face stays square to the blade");
                if (roll > 0f)
                    Assert.That(Vector3.Angle(previousFace, stroke.Face), Is.EqualTo(1f).Within(0.05f),
                        "the face rolls with the waiting face (a degree for a degree) at roll " + roll);
                previousFace = stroke.Face;
            }
            Assert.That(Vector3.Angle(targetBlade, blade), Is.EqualTo(70.7f).Within(0.1f), "the hitting blade is the production gap from the waiting one");
            // The premise: a slerp of the two bat frames (the web's rigid blend) does flip in this very sweep. At the
            // stroke's turn fraction the blade it draws jumps by more than half a metre between two degrees of roll.
            var turnFraction = Mathf.Min((float)ProductionTouchDownBat.Reach, (float)ProductionTouchDownBat.MaxTurnDegrees / 70.7f);
            var qb = ProductionTouchDownBat.Orientation(target);
            var last = Vector3.zero;
            var worstJump = 0f;
            for (var roll = 0f; roll <= 360f; roll += 1f)
            {
                var rolled = new ProductionTouchDownBat.BatPose
                {
                    Grip = wait.Grip,
                    Toe = wait.Toe,
                    Face = Quaternion.AngleAxis(roll, blade) * wait.Face
                };
                var toe = rolled.Grip + (Quaternion.Slerp(ProductionTouchDownBat.Orientation(rolled), qb, turnFraction) * Vector3.right) *
                          ProductionTouchDownBat.BatLengthMetres;
                if (roll > 0f) worstJump = Mathf.Max(worstJump, Vector3.Distance(toe, last));
                last = toe;
            }
            Assert.That(worstJump, Is.GreaterThan(0.5f), "a slerp of the frames jumps the toe by this much in one degree of roll");
        }

        [Test]
        public void Rigid_EndsExactlyOnTheTargetAndStartsExactlyOnTheOrigin()
        {
            foreach (var target in new[] { Hit, HitNear })
            {
                var wait = Waiting(0.3);
                var start = ProductionTouchDownBat.Rigid(wait, target, 0.0);
                Assert.That(Vector3.Distance(start.Toe, wait.Toe), Is.EqualTo(0f));
                Assert.That(Vector3.Distance(start.Grip, wait.Grip), Is.EqualTo(0f));
                var end = ProductionTouchDownBat.Rigid(wait, target, 1.0);
                Assert.That(Vector3.Distance(end.Toe, target.Toe), Is.EqualTo(0f));
                Assert.That(Vector3.Distance(end.Grip, target.Grip), Is.EqualTo(0f));
                var previous = wait;
                for (var u = 0.01; u <= 1.0 + 1e-9; u += 0.01)
                {
                    var pose = ProductionTouchDownBat.Rigid(wait, target, u);
                    Assert.That(Mathf.Max(Vector3.Distance(pose.Toe, previous.Toe), Vector3.Distance(pose.Grip, previous.Grip)), Is.LessThan(0.12f),
                        "a hundredth of the blend moves the bat by less than 12 cm at " + u);
                    previous = pose;
                }
            }
        }

        [Test]
        public void TheBatAnswersAPressWithinOneFrame_AndStartsFromTheWaitingBat()
        {
            // A ball far away: no guard. At the press the bat is exactly the waiting bat; 16 ms later it has moved.
            var source = new Source { Wait = Waiting, Ball = t => new Vector3(0f, 2f, -9f) };
            var touch = new ProductionTouchDownBat();
            touch.Begin(source, Hit, 0.4);
            ProductionTouchDownBat.BatPose pose;
            Assert.That(touch.Draw(0.4, out pose), Is.False, "no stroke at the instant of the press");
            Assert.That(Vector3.Distance(pose.Toe, Waiting(0.4).Toe), Is.EqualTo(0f));
            Assert.That(touch.Draw(0.416, out pose), Is.True);
            var moved = Mathf.Max(Vector3.Distance(pose.Toe, Waiting(0.416).Toe), Vector3.Distance(pose.Grip, Waiting(0.416).Grip));
            Assert.That(moved, Is.GreaterThan(0.002f), "within 17 ms the bat differs from the waiting bat by more than 2 mm");
            Assert.That(moved, Is.LessThan(4 * 0.08f), "four frames of at most 8 cm");
            // A press that outlives the tap window checks back to the waiting bat.
            Assert.That(touch.Draw(0.4 + ProductionTouchDownBat.TapHoldSeconds + ProductionTouchDownBat.CheckSeconds + 0.004, out pose),
                Is.False);
            Assert.That(Vector3.Distance(pose.Toe, Waiting(0.4 + 0.25 + 0.124).Toe), Is.EqualTo(0f));
        }
    }
}
