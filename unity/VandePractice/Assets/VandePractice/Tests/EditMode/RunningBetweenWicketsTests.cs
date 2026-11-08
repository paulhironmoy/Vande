using System.Linq;
using NUnit.Framework;
using Vande.Practice.Presentation.Production.Characters;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests
{
    /// <summary>
    /// HUM U10: the batters' running is reconstructed exactly from the frozen physics running model
    /// (src/physics/running.ts) and the trace's own "run" events, and fails closed when they do not reproduce.
    /// </summary>
    public sealed class RunningBetweenWicketsTests
    {
        private static CanonicalDeliveryTrace Trace(double contactT, params double[] runs)
        {
            var events = new System.Collections.Generic.List<CanonicalTraceEvent>
            {
                new CanonicalTraceEvent { t = 0.0, kind = "release" },
                new CanonicalTraceEvent { t = contactT, kind = "contact", contact = "outside_edge" }
            };
            events.AddRange(runs.Select(t => new CanonicalTraceEvent { t = t, kind = "run" }));
            return new CanonicalDeliveryTrace { events = events.ToArray() };
        }

        [Test]
        public void GoldenThinEdgeSingle_ReproducesThePhysicsRunTimes()
        {
            // practice-v3 golden thin-edge (FROZEN-5d): contact 0.47449282665940484, run completed 3.706311008477587.
            var plan = ProductionRunningBetweenWickets.FromTrace(Trace(0.47449282665940484, 3.706311008477587));
            Assert.That(plan.Runs, Is.EqualTo(1));
            Assert.That(plan.FirstStartT, Is.EqualTo(0.47449282665940484 + ProductionRunningBetweenWickets.StartSeconds)
                .Within(1e-9));
            Assert.That(plan.RunEndT(0), Is.EqualTo(3.706311008477587).Within(1e-12));
            double speed;
            bool running;
            Assert.That(plan.Progress(plan.FirstStartT - 0.01, out speed, out running), Is.EqualTo(0.0));
            Assert.That(running, Is.False);
            Assert.That(plan.Progress(plan.RunEndT(0) + 0.5, out speed, out running), Is.EqualTo(1.0).Within(1e-12));
            var previous = 0.0;
            for (var t = plan.FirstStartT; t <= plan.RunEndT(0); t += 0.01)
            {
                var progress = plan.Progress(t, out speed, out running);
                Assert.That(progress, Is.GreaterThanOrEqualTo(previous - 1e-12), "monotone at " + t);
                Assert.That(speed, Is.LessThanOrEqualTo(ProductionRunningBetweenWickets.TopSpeed + 1e-9));
                Assert.That(progress - previous, Is.LessThan(0.0101 * ProductionRunningBetweenWickets.TopSpeed /
                                                              ProductionRunningBetweenWickets.RunMetres + 1e-9),
                    "no jump at " + t);
                previous = progress;
            }
        }

        [Test]
        public void ThreeRuns_TurnAtEachEndAndAlternateDirection()
        {
            var sprint = ProductionRunningBetweenWickets.SprintSeconds();
            var contact = 0.5;
            var one = contact + ProductionRunningBetweenWickets.StartSeconds + sprint;
            var two = one + sprint + ProductionRunningBetweenWickets.TurnSeconds;
            var three = two + sprint + ProductionRunningBetweenWickets.TurnSeconds;
            var plan = ProductionRunningBetweenWickets.FromTrace(Trace(contact, one, two, three));
            Assert.That(plan.Runs, Is.EqualTo(3));
            double speed;
            bool running;
            Assert.That(plan.Progress(one, out speed, out running), Is.EqualTo(1.0).Within(1e-9));
            Assert.That(plan.Progress(two, out speed, out running), Is.EqualTo(0.0).Within(1e-9));
            Assert.That(plan.Progress(three, out speed, out running), Is.EqualTo(1.0).Within(1e-9));
            Assert.That(plan.Progress(one + ProductionRunningBetweenWickets.TurnSeconds * 0.5, out speed, out running),
                Is.EqualTo(1.0).Within(1e-9), "standing at the far end during the turn");
            Assert.That(running, Is.False);
        }

        [Test]
        public void RunsThatDoNotReproduce_FailClosed()
        {
            Assert.That(ProductionRunningBetweenWickets.FromTrace(Trace(0.5, 3.0)).Runs, Is.Zero);
            Assert.That(ProductionRunningBetweenWickets.FromTrace(Trace(0.5)).Runs, Is.Zero);
            var noBat = new CanonicalDeliveryTrace
            {
                events = new[]
                {
                    new CanonicalTraceEvent { t = 0.0, kind = "release" },
                    new CanonicalTraceEvent { t = 3.7, kind = "run" }
                }
            };
            Assert.That(ProductionRunningBetweenWickets.FromTrace(noBat).Runs, Is.Zero);
        }
    }
}
