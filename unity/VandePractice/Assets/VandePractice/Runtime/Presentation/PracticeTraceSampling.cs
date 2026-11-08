using System;
using Vande.Practice.Bridge;
using Vande.Practice.Trace;

namespace Vande.Practice.Presentation
{
    public static class PracticeTraceSampling
    {
        public static BallTraceSample BallAt(BallTraceSample[] samples, double time)
        {
            if (samples == null || samples.Length == 0)
                throw new BridgeValidationException("A flight trace requires at least one ball sample.");
            if (double.IsNaN(time) || double.IsInfinity(time))
                throw new BridgeValidationException("Flight sample time must be finite.");
            if (time <= samples[0].t) return Clone(samples[0]);
            if (time >= samples[samples.Length - 1].t) return Clone(samples[samples.Length - 1]);

            var low = 0;
            var high = samples.Length - 1;
            while (low + 1 < high)
            {
                var middle = low + (high - low) / 2;
                if (samples[middle].t <= time) low = middle;
                else high = middle;
            }

            var span = samples[high].t - samples[low].t;
            var amount = span <= 0.0 ? 0.0 : (time - samples[low].t) / span;
            return new BallTraceSample
            {
                t = time,
                p = Lerp(samples[low].p, samples[high].p, amount),
                v = Lerp(samples[low].v, samples[high].v, amount)
            };
        }

        private static BallTraceSample Clone(BallTraceSample value)
        {
            if (value == null || value.p == null || value.v == null)
                throw new BridgeValidationException("Flight sample is incomplete.");
            return new BallTraceSample
            {
                t = value.t,
                p = Lerp(value.p, value.p, 0.0),
                v = Lerp(value.v, value.v, 0.0)
            };
        }

        private static TraceVector3 Lerp(TraceVector3 from, TraceVector3 to, double amount)
        {
            if (from == null || to == null)
                throw new BridgeValidationException("Flight vector is missing.");
            return new TraceVector3
            {
                x = from.x + (to.x - from.x) * amount,
                y = from.y + (to.y - from.y) * amount,
                z = from.z + (to.z - from.z) * amount
            };
        }
    }
}
