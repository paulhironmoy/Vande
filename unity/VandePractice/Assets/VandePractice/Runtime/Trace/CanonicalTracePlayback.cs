using System;
using Vande.Practice.Bridge;

namespace Vande.Practice.Trace
{
    public interface ICanonicalTraceTarget
    {
        void SetBall(BallTraceSample sample);
        void SetBat(BatTraceSample sample);
        void SetFielder(string fielderId, FielderTraceSample sample);
        void EmitEvent(CanonicalTraceEvent traceEvent);
        void SetPlaybackCompleted(bool completed);
    }

    /// <summary>
    /// Deterministic sample interpolation and event dispatch only. This adapter
    /// contains no collision, score, dismissal or ball-outcome logic.
    /// </summary>
    public sealed class CanonicalTracePlayback
    {
        private readonly CanonicalDeliveryTrace trace;
        private readonly ICanonicalTraceTarget target;
        private readonly BatInterpolator batInterpolator;
        private double time;
        private int nextEvent;
        private bool completed;
        private string digest;

        public CanonicalTracePlayback(CanonicalDeliveryTrace trace, ICanonicalTraceTarget target)
        {
            CanonicalTraceValidator.Validate(trace);
            this.target = target ?? throw new ArgumentNullException(nameof(target));
            this.trace = trace;
            batInterpolator = trace.bat.Length > 0
                ? new BatInterpolator(
                    trace.bat,
                    FindExactContactKnot(trace),
                    trace.batterMotion?.contactT)
                : null;
            Reset();
        }

        /// <summary>
        /// Test seam: the exact bat interpolator this playback presents, built from raw knots with the same impulse
        /// and velocity-peak authorities the constructor passes (exact bat-contact knot; batterMotion.contactT).
        /// </summary>
        internal static Func<double, BatTraceSample> CreateBatEvaluator(
            BatTraceSample[] samples,
            double? impulseTime,
            double? velocityPeakTime)
        {
            if (samples == null || samples.Length == 0) throw new ArgumentException("Bat knots are required.", nameof(samples));
            return new BatInterpolator(samples, impulseTime, velocityPeakTime).Evaluate;
        }

        /// <summary>
        /// The canonical digest of the accepted trace. Computed when first read (it is the SHA-256 of a text built from every sample,
        /// 3 to 10 ms for a result, and nothing on the live path reads it); the value is the one the constructor used to compute.
        /// </summary>
        public string Digest
        {
            get
            {
                if (digest == null) digest = CanonicalTraceDigest.Compute(trace);
                return digest;
            }
        }
        public double Time => time;
        public bool Completed => completed;

        public void Reset()
        {
            time = 0.0;
            nextEvent = 0;
            completed = false;
            target.SetPlaybackCompleted(false);
            ApplySamples(0.0);
        }

        public void Advance(double deltaSeconds)
        {
            if (double.IsNaN(deltaSeconds) || double.IsInfinity(deltaSeconds) || deltaSeconds < 0.0)
            {
                throw new ArgumentOutOfRangeException(nameof(deltaSeconds));
            }

            if (completed)
            {
                return;
            }

            var nextTime = Math.Min(trace.durationSeconds, time + deltaSeconds);
            while (nextEvent < trace.events.Length && trace.events[nextEvent].t <= nextTime)
            {
                if (trace.events[nextEvent].t >= time)
                {
                    target.EmitEvent(trace.events[nextEvent]);
                }

                nextEvent++;
            }

            time = nextTime;
            ApplySamples(time);
            if (time >= trace.durationSeconds)
            {
                completed = true;
                target.SetPlaybackCompleted(true);
            }
        }

        /// <summary>
        /// Repositions visuals without replaying historical events. A subsequent
        /// Advance emits only events at or after the seek time.
        /// </summary>
        public void Seek(double targetSeconds)
        {
            if (double.IsNaN(targetSeconds) || double.IsInfinity(targetSeconds) ||
                targetSeconds < 0.0 || targetSeconds > trace.durationSeconds)
            {
                throw new ArgumentOutOfRangeException(nameof(targetSeconds));
            }

            time = targetSeconds;
            nextEvent = 0;
            while (nextEvent < trace.events.Length && trace.events[nextEvent].t < time)
            {
                nextEvent++;
            }

            completed = time >= trace.durationSeconds;
            ApplySamples(time);
            target.SetPlaybackCompleted(completed);
        }

        private void ApplySamples(double atTime)
        {
            target.SetBall(InterpolateBall(trace.ball, atTime));
            // A canonical bat does not exist before its authored domain. In particular, Reset/Seek must not
            // synthesize the first bat knot at t=0 when a swing starts later. The target therefore retains its
            // ordinary guard pose until the first authored sample, matching the TypeScript playback contract.
            if (batInterpolator != null && atTime >= trace.bat[0].t)
                target.SetBat(batInterpolator.Evaluate(atTime));
            for (var index = 0; index < trace.fielders.Length; index++)
            {
                var path = trace.fielders[index];
                target.SetFielder(path.fielderId, InterpolateFielder(path.samples, atTime));
            }
        }

        private static BallTraceSample InterpolateBall(BallTraceSample[] samples, double atTime)
        {
            var upper = FindUpperBall(samples, atTime);
            if (upper == 0) return Clone(samples[0]);
            if (upper >= samples.Length) return Clone(samples[samples.Length - 1]);
            var lower = upper - 1;
            var amount = Fraction(samples[lower].t, samples[upper].t, atTime);
            return new BallTraceSample
            {
                t = atTime,
                p = Lerp(samples[lower].p, samples[upper].p, amount),
                v = Lerp(samples[lower].v, samples[upper].v, amount)
            };
        }

        private static double? FindExactContactKnot(CanonicalDeliveryTrace value)
        {
            var contactCount = 0;
            var contactTime = 0.0;
            for (var index = 0; index < value.events.Length; index++)
            {
                if (!string.Equals(value.events[index].kind, "contact", StringComparison.Ordinal) ||
                    !IsBatContact(value.events[index].contact)) continue;
                contactCount++;
                contactTime = value.events[index].t;
            }

            if (contactCount != 1) return null;
            var matchingKnots = 0;
            var matchingTime = 0.0;
            for (var index = 0; index < value.bat.Length; index++)
            {
                if (Math.Abs(value.bat[index].t - contactTime) <=
                    BridgeConstants.ExactTraceTimeToleranceSeconds)
                {
                    matchingKnots++;
                    matchingTime = value.bat[index].t;
                }
            }
            if (matchingKnots == 1) return matchingTime;

            // Trace-v2 validation requires exactly one tolerance-matched contact knot. Keep this defensive null
            // path so playback can never infer an impulse boundary from the nearest fixed-grid sample.
            return null;
        }

        private static bool IsBatContact(string contact)
        {
            return string.Equals(contact, "middle", StringComparison.Ordinal) ||
                   string.Equals(contact, "inside_edge", StringComparison.Ordinal) ||
                   string.Equals(contact, "outside_edge", StringComparison.Ordinal) ||
                   string.Equals(contact, "top_edge", StringComparison.Ordinal) ||
                   string.Equals(contact, "leading_edge", StringComparison.Ordinal);
        }

        private static FielderTraceSample InterpolateFielder(FielderTraceSample[] samples, double atTime)
        {
            var upper = FindUpperFielder(samples, atTime);
            if (upper == 0) return Clone(samples[0]);
            if (upper >= samples.Length) return Clone(samples[samples.Length - 1]);
            var lower = upper - 1;
            var amount = Fraction(samples[lower].t, samples[upper].t, atTime);
            return new FielderTraceSample
            {
                t = atTime,
                x = samples[lower].x + (samples[upper].x - samples[lower].x) * amount,
                z = samples[lower].z + (samples[upper].z - samples[lower].z) * amount,
                action = amount >= 1.0 ? samples[upper].action : samples[lower].action
            };
        }

        private static int FindUpperBall(BallTraceSample[] samples, double time)
        {
            var low = 0;
            var high = samples.Length;
            while (low < high)
            {
                var middle = low + (high - low) / 2;
                if (samples[middle].t < time) low = middle + 1;
                else high = middle;
            }

            return low;
        }

        private static int FindUpperFielder(FielderTraceSample[] samples, double time)
        {
            var low = 0;
            var high = samples.Length;
            while (low < high)
            {
                var middle = low + (high - low) / 2;
                if (samples[middle].t < time) low = middle + 1;
                else high = middle;
            }

            return low;
        }

        private static double Fraction(double from, double to, double value)
        {
            var span = to - from;
            return span <= 0.0 ? 0.0 : (value - from) / span;
        }

        private static TraceVector3 Lerp(TraceVector3 from, TraceVector3 to, double amount)
        {
            return new TraceVector3
            {
                x = from.x + (to.x - from.x) * amount,
                y = from.y + (to.y - from.y) * amount,
                z = from.z + (to.z - from.z) * amount
            };
        }

        private static BallTraceSample Clone(BallTraceSample value)
        {
            return new BallTraceSample
            {
                t = value.t,
                p = Lerp(value.p, value.p, 0.0),
                v = Lerp(value.v, value.v, 0.0)
            };
        }

        private static BatTraceSample Clone(BatTraceSample value)
        {
            return new BatTraceSample
            {
                t = value.t,
                grip = Lerp(value.grip, value.grip, 0.0),
                toe = Lerp(value.toe, value.toe, 0.0),
                face = Lerp(value.face, value.face, 0.0)
            };
        }

        private static FielderTraceSample Clone(FielderTraceSample value)
        {
            return new FielderTraceSample
            {
                t = value.t,
                x = value.x,
                z = value.z,
                action = value.action
            };
        }

        /// <summary>
        /// Immutable, seek-pure rigid-bat interpolation: an exact port of the frozen TypeScript batAt (simulation v3
        /// phase 5b, src/render3d/practice/frame.ts; spec release/.../physics/phase5/5b-bat-interpolation-spec.txt).
        /// Each segment is a quintic Hermite in grip and in the rotation vector of its first knot's chart; knot
        /// velocities and accelerations are the first and second derivatives (Fornberg weights) of the polynomial
        /// through up to five knots of the knot's own smooth run. Runs end at holds, the exact blade-contact impulse
        /// and the authored velocity peak; the first and last knots are at rest. The impulse is the only velocity
        /// break; the velocity peak shares one velocity on both sides.
        /// </summary>
        private sealed class BatInterpolator
        {
            // Authoritative TypeScript geometry: BLADE_L (0.56 m) + HANDLE_L (0.30 m).
            private const double BatFull = 0.86;
            private const double VectorEpsilon = 1e-12;
            private const double QuaternionTieEpsilon = 1e-15;
            private const double HeldPoseTolerance = BridgeConstants.HeldBatPoseToleranceMetres;

            private readonly BatTraceSample[] samples;
            private readonly VectorD[] grips;
            private readonly QuaternionD[] rotations;
            private readonly Segment[] segments;

            public BatInterpolator(
                BatTraceSample[] source,
                double? impulseTime,
                double? velocityPeakTime)
            {
                samples = new BatTraceSample[source.Length];
                grips = new VectorD[source.Length];
                rotations = new QuaternionD[source.Length];

                for (var index = 0; index < source.Length; index++)
                {
                    samples[index] = Clone(source[index]);
                    grips[index] = VectorD.From(source[index].grip);
                    rotations[index] = FrameRotation(source[index]);
                    if (index == 0)
                    {
                        rotations[index] = Canonicalize(rotations[index]);
                    }
                    else
                    {
                        rotations[index] = AlignHemisphere(rotations[index - 1], rotations[index]);
                    }
                }
                for (var index = 0; index < samples.Length - 1; index++)
                {
                    if (!(samples[index + 1].t - samples[index].t > 0.0))
                        throw new BridgeValidationException("Bat interpolation requires strictly increasing sample times.");
                }

                var impulseIndex = FindExactAuthorityIndex(impulseTime, out var exactImpulseTime);
                var requestedVelocityPeakIndex =
                    FindExactAuthorityIndex(velocityPeakTime, out var exactVelocityPeakTime);
                // An early blade impulse replaces the canonical branch. A later planned timestamp remains an exact
                // contract knot, but belongs to the post-hit branch and is not that branch's velocity peak.
                var velocityPeakIndex = requestedVelocityPeakIndex >= 0 &&
                                        (impulseIndex < 0 ||
                                         exactVelocityPeakTime < exactImpulseTime -
                                         BridgeConstants.ExactTraceTimeToleranceSeconds)
                    ? requestedVelocityPeakIndex
                    : -1;

                segments = PrepareSegments(impulseIndex, velocityPeakIndex);
            }

            public BatTraceSample Evaluate(double atTime)
            {
                var upper = FindUpper(atTime);
                if (upper == 0) return Clone(samples[0]);
                if (upper >= samples.Length) return Clone(samples[samples.Length - 1]);
                if (samples[upper].t == atTime) return Clone(samples[upper]);

                var lower = upper - 1;
                var span = samples[upper].t - samples[lower].t;
                if (!(span > 0.0))
                {
                    throw new BridgeValidationException("Bat interpolation requires strictly increasing sample times.");
                }

                var amount = (atTime - samples[lower].t) / span;
                var segment = segments[lower];
                var grip = QuinticHermite(
                    grips[lower], segment.GripVelocity0, segment.GripAcceleration0,
                    grips[upper], segment.GripVelocity1, segment.GripAcceleration1,
                    span, amount);
                var r = QuinticHermite(
                    VectorD.Zero, segment.AngularVelocity0, segment.AngularAcceleration0,
                    segment.R1, segment.AngularVelocity1, segment.AngularAcceleration1,
                    span, amount);
                var rotation = (QuaternionD.FromRotationVector(r) * rotations[lower]).Normalized();
                var axis = rotation.Rotate(VectorD.UnitX).Normalized();
                var face = rotation.Rotate(VectorD.UnitY).Normalized();
                var toe = grip - axis * BatFull;
                return new BatTraceSample
                {
                    t = atTime,
                    grip = grip.ToTrace(),
                    toe = toe.ToTrace(),
                    face = face.ToTrace()
                };
            }

            /// <summary>One side's knot window [From, To] (inclusive); ZeroVelocity keeps its acceleration only.</summary>
            private sealed class Side
            {
                public int From;
                public int To;
                public bool ZeroVelocity;
                public Side[] VelocityFrom;

                public Side With(bool zeroVelocity, Side[] velocityFrom) =>
                    new Side { From = From, To = To, ZeroVelocity = zeroVelocity, VelocityFrom = velocityFrom };
            }

            private readonly struct Segment
            {
                public Segment(VectorD gripVelocity0, VectorD gripAcceleration0, VectorD gripVelocity1,
                    VectorD gripAcceleration1, VectorD r1, VectorD angularVelocity0, VectorD angularAcceleration0,
                    VectorD angularVelocity1, VectorD angularAcceleration1)
                {
                    GripVelocity0 = gripVelocity0;
                    GripAcceleration0 = gripAcceleration0;
                    GripVelocity1 = gripVelocity1;
                    GripAcceleration1 = gripAcceleration1;
                    R1 = r1;
                    AngularVelocity0 = angularVelocity0;
                    AngularAcceleration0 = angularAcceleration0;
                    AngularVelocity1 = angularVelocity1;
                    AngularAcceleration1 = angularAcceleration1;
                }

                public VectorD GripVelocity0 { get; }
                public VectorD GripAcceleration0 { get; }
                public VectorD GripVelocity1 { get; }
                public VectorD GripAcceleration1 { get; }
                public VectorD R1 { get; }
                public VectorD AngularVelocity0 { get; }
                public VectorD AngularAcceleration0 { get; }
                public VectorD AngularVelocity1 { get; }
                public VectorD AngularAcceleration1 { get; }
            }

            private Segment[] PrepareSegments(int impulseIndex, int velocityPeakIndex)
            {
                var count = samples.Length;
                if (count < 2) return Array.Empty<Segment>();
                var held = new bool[count - 1];
                for (var i = 0; i < count - 1; i++) held[i] = SameHeldPose(samples[i], samples[i + 1]);

                bool IsBreak(int k) => k == impulseIndex || k == velocityPeakIndex;
                int RunLow(int k)
                {
                    var j = k;
                    while (j > 0 && !held[j - 1])
                    {
                        j--;
                        if (IsBreak(j)) break;
                    }
                    return j;
                }
                int RunHigh(int k)
                {
                    var j = k;
                    while (j < count - 1 && !held[j])
                    {
                        j++;
                        if (IsBreak(j)) break;
                    }
                    return j;
                }
                Side Window(int k, int low, int high)
                {
                    var size = Math.Min(5, high - low + 1);
                    if (size < 2) return null;
                    var start = Math.Max(low, Math.Min(k - (size - 1) / 2, high - size + 1));
                    return new Side { From = start, To = start + size - 1 };
                }
                Side Backward(int k) => k > 0 && !held[k - 1] ? Window(k, Math.Max(RunLow(k), k - 4), k) : null;
                Side Forward(int k) => k < count - 1 && !held[k] ? Window(k, k, Math.Min(RunHigh(k), k + 4)) : null;

                var incoming = new Side[count][];
                var outgoing = new Side[count][];
                for (var k = 0; k < count; k++)
                {
                    if (k == 0 || k == count - 1)
                    {
                        var into = k == 0 ? null : Backward(k);
                        var outOf = k == 0 ? Forward(k) : null;
                        incoming[k] = into != null ? new[] { into.With(true, null) } : Array.Empty<Side>();
                        outgoing[k] = outOf != null ? new[] { outOf.With(true, null) } : Array.Empty<Side>();
                        continue;
                    }
                    if (k == impulseIndex)
                    {
                        incoming[k] = held[k - 1] ? Array.Empty<Side>() : new[] { Backward(k) };
                        outgoing[k] = held[k] ? Array.Empty<Side>() : new[] { Forward(k) };
                    }
                    else if (held[k - 1] || held[k])
                    {
                        var into = held[k - 1] ? null : Backward(k);
                        var outOf = held[k] ? null : Forward(k);
                        incoming[k] = into != null ? new[] { into.With(true, null) } : Array.Empty<Side>();
                        outgoing[k] = outOf != null ? new[] { outOf.With(true, null) } : Array.Empty<Side>();
                    }
                    else if (k == velocityPeakIndex)
                    {
                        var laterImpulse = impulseIndex > k;
                        var before = Backward(k);
                        var after = laterImpulse ? null : Forward(k);
                        var shared = laterImpulse ? new[] { before } : new[] { before, after };
                        incoming[k] = before != null ? new[] { before.With(false, shared) } : Array.Empty<Side>();
                        outgoing[k] = after != null
                            ? new[] { after.With(false, shared) }
                            : before != null ? new[] { before.With(false, shared) } : Array.Empty<Side>();
                    }
                    else
                    {
                        var centred = Window(k, RunLow(k), RunHigh(k));
                        incoming[k] = new[] { centred };
                        outgoing[k] = new[] { centred };
                    }
                }

                var result = new Segment[count - 1];
                for (var i = 0; i < count - 1; i++)
                {
                    var inverse = rotations[i].Inverse();
                    var segmentIndex = i;
                    VectorD Chart(int j) => RotationLog(rotations[j] * rotations[segmentIndex].Inverse());
                    VectorD Grip(int j) => grips[j];
                    Estimate(outgoing[i], i, Grip, out var gripVelocity0, out var gripAcceleration0);
                    Estimate(incoming[i + 1], i + 1, Grip, out var gripVelocity1, out var gripAcceleration1);
                    Estimate(outgoing[i], i, Chart, out var angularVelocity0, out var angularAcceleration0);
                    Estimate(incoming[i + 1], i + 1, Chart, out var angularVelocity1, out var angularAcceleration1);
                    result[i] = new Segment(gripVelocity0, gripAcceleration0, gripVelocity1, gripAcceleration1,
                        RotationLog(rotations[i + 1] * inverse), angularVelocity0, angularAcceleration0,
                        angularVelocity1, angularAcceleration1);
                }
                return result;
            }

            private void Estimate(Side[] sides, int k, Func<int, VectorD> value, out VectorD velocity,
                out VectorD acceleration)
            {
                velocity = VectorD.Zero;
                acceleration = VectorD.Zero;
                var valid = 0;
                foreach (var side in sides)
                {
                    if (side == null) continue;
                    valid++;
                    var size = side.To - side.From + 1;
                    var taus = new double[size];
                    var values = new VectorD[size];
                    for (var j = side.From; j <= side.To; j++)
                    {
                        taus[j - side.From] = samples[j].t - samples[k].t;
                        values[j - side.From] = value(j);
                    }
                    PolynomialDerivatives(taus, values, out var sideVelocity, out var sideAcceleration);
                    if (side.ZeroVelocity)
                    {
                        // velocity contribution zero
                    }
                    else if (side.VelocityFrom != null)
                    {
                        var plain = new Side[side.VelocityFrom.Length];
                        for (var index = 0; index < plain.Length; index++)
                            plain[index] = side.VelocityFrom[index]?.With(false, null);
                        Estimate(plain, k, value, out var sharedVelocity, out _);
                        velocity = velocity + sharedVelocity;
                    }
                    else
                    {
                        velocity = velocity + sideVelocity;
                    }
                    acceleration = acceleration + sideAcceleration;
                }
                if (valid == 0) return;
                velocity = velocity * (1.0 / valid);
                acceleration = acceleration * (1.0 / valid);
            }

            /// <summary>
            /// First and second derivatives at tau = 0 of the polynomial through (taus[j], values[j]): Fornberg's
            /// weights (Math. Comp. 51, 1988), in the same order of operations as the TypeScript.
            /// </summary>
            private static void PolynomialDerivatives(double[] taus, VectorD[] values, out VectorD velocity,
                out VectorD acceleration)
            {
                velocity = VectorD.Zero;
                acceleration = VectorD.Zero;
                var n = taus.Length;
                if (n < 2) return;
                var order = Math.Min(2, n - 1);
                var weights = new double[n, 3];
                var c1 = 1.0;
                var c4 = taus[0];
                weights[0, 0] = 1.0;
                for (var i = 1; i < n; i++)
                {
                    var mn = Math.Min(i, order);
                    var c2 = 1.0;
                    var c5 = c4;
                    c4 = taus[i];
                    for (var j = 0; j < i; j++)
                    {
                        var c3 = taus[i] - taus[j];
                        c2 *= c3;
                        if (j == i - 1)
                        {
                            for (var k = mn; k >= 1; k--)
                                weights[i, k] = (c1 * (k * weights[i - 1, k - 1] - c5 * weights[i - 1, k])) / c2;
                            weights[i, 0] = (-c1 * c5 * weights[i - 1, 0]) / c2;
                        }
                        for (var k = mn; k >= 1; k--)
                            weights[j, k] = (c4 * weights[j, k] - k * weights[j, k - 1]) / c3;
                        weights[j, 0] = (c4 * weights[j, 0]) / c3;
                    }
                    c1 = c2;
                }
                for (var j = 0; j < n; j++)
                {
                    velocity = velocity + values[j] * weights[j, 1];
                    if (order >= 2) acceleration = acceleration + values[j] * weights[j, 2];
                }
            }

            /// <summary>Quintic Hermite on [0, h] at fraction u (the TypeScript quinticHermite, same summation order).</summary>
            private static VectorD QuinticHermite(VectorD p0, VectorD v0, VectorD a0, VectorD p1, VectorD v1,
                VectorD a1, double h, double u)
            {
                var u2 = u * u;
                var u3 = u2 * u;
                var u4 = u3 * u;
                var u5 = u4 * u;
                var h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5;
                var h10 = u - 6 * u3 + 8 * u4 - 3 * u5;
                var h20 = 0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5;
                var h21 = 0.5 * u3 - u4 + 0.5 * u5;
                var h11 = -4 * u3 + 7 * u4 - 3 * u5;
                var h01 = 10 * u3 - 15 * u4 + 6 * u5;
                return ((p0 * h00 + v0 * (h10 * h)) + (a0 * (h20 * h * h) + a1 * (h21 * h * h))) +
                       (v1 * (h11 * h) + p1 * h01);
            }

            /// <summary>Rotation vector of q (the TypeScript quaternionToRotationVector, same operation order).</summary>
            private static VectorD RotationLog(QuaternionD value)
            {
                var q = value.Normalized();
                if (q.W < 0.0) q = -q;
                var sine = Math.Sqrt(q.X * q.X + q.Y * q.Y + q.Z * q.Z);
                if (sine <= VectorEpsilon) return new VectorD(q.X * 2.0, q.Y * 2.0, q.Z * 2.0);
                var angle = 2.0 * Math.Atan2(sine, Math.Max(0.0, q.W));
                return new VectorD(q.X, q.Y, q.Z) * (angle / sine);
            }

            private int FindExactAuthorityIndex(double? authorityTime, out double exactTime)
            {
                exactTime = 0.0;
                if (!authorityTime.HasValue || double.IsNaN(authorityTime.Value) ||
                    double.IsInfinity(authorityTime.Value)) return -1;
                var match = -1;
                var matches = 0;
                for (var index = 0; index < samples.Length; index++)
                {
                    if (Math.Abs(samples[index].t - authorityTime.Value) >
                        BridgeConstants.ExactTraceTimeToleranceSeconds) continue;
                    matches++;
                    match = index;
                    exactTime = samples[index].t;
                }

                return matches == 1 ? match : -1;
            }

            private static bool SameHeldPose(BatTraceSample left, BatTraceSample right)
            {
                return (VectorD.From(left.grip) - VectorD.From(right.grip)).Magnitude <= HeldPoseTolerance &&
                       (VectorD.From(left.toe) - VectorD.From(right.toe)).Magnitude <= HeldPoseTolerance &&
                       (VectorD.From(left.face) - VectorD.From(right.face)).Magnitude <= HeldPoseTolerance;
            }

            private int FindUpper(double value)
            {
                var low = 0;
                var high = samples.Length;
                while (low < high)
                {
                    var middle = low + (high - low) / 2;
                    if (samples[middle].t < value) low = middle + 1;
                    else high = middle;
                }

                return low;
            }

            private static QuaternionD FrameRotation(BatTraceSample sample)
            {
                var grip = VectorD.From(sample.grip);
                var toe = VectorD.From(sample.toe);
                var span = grip - toe;
                if (span.Magnitude <= VectorEpsilon)
                {
                    throw new BridgeValidationException("Bat grip and toe must define a rigid axis.");
                }

                var axis = span.Normalized();
                var suppliedFace = VectorD.From(sample.face);
                var projectedFace = suppliedFace - axis * VectorD.Dot(suppliedFace, axis);
                if (projectedFace.Magnitude <= VectorEpsilon)
                {
                    throw new BridgeValidationException("Bat face must be independent of its rigid axis.");
                }

                var face = projectedFace.Normalized();
                var width = VectorD.Cross(axis, face).Normalized();
                face = VectorD.Cross(width, axis).Normalized();
                return QuaternionD.FromFrame(axis, face, width);
            }

            private static QuaternionD Canonicalize(QuaternionD value)
            {
                value = value.Normalized();
                if (Math.Abs(value.W) > QuaternionTieEpsilon) return value.W < 0.0 ? -value : value;
                if (Math.Abs(value.X) > QuaternionTieEpsilon) return value.X < 0.0 ? -value : value;
                if (Math.Abs(value.Y) > QuaternionTieEpsilon) return value.Y < 0.0 ? -value : value;
                return value.Z < 0.0 ? -value : value;
            }

            private static QuaternionD AlignHemisphere(QuaternionD reference, QuaternionD candidate)
            {
                candidate = candidate.Normalized();
                var amount = QuaternionD.Dot(reference, candidate);
                if (amount < -QuaternionTieEpsilon) return -candidate;
                if (Math.Abs(amount) > QuaternionTieEpsilon) return candidate;

                // A principal pi turn has two quaternion signs. Fix its axis lexicographically so TS and C# choose
                // the same great circle even when their matrix-to-quaternion branches meet an exact tie.
                var relative = candidate * reference.Inverse();
                var x = Math.Abs(relative.X);
                var y = Math.Abs(relative.Y);
                var z = Math.Abs(relative.Z);
                var component = x >= y && x >= z ? relative.X : y >= z ? relative.Y : relative.Z;
                return component < 0.0 ? -candidate : candidate;
            }

            private readonly struct VectorD
            {
                public static readonly VectorD Zero = new VectorD(0.0, 0.0, 0.0);
                public static readonly VectorD UnitX = new VectorD(1.0, 0.0, 0.0);
                public static readonly VectorD UnitY = new VectorD(0.0, 1.0, 0.0);

                public VectorD(double x, double y, double z)
                {
                    X = x;
                    Y = y;
                    Z = z;
                }

                public double X { get; }
                public double Y { get; }
                public double Z { get; }
                public double Magnitude => Math.Sqrt(X * X + Y * Y + Z * Z);

                public VectorD Normalized()
                {
                    var magnitude = Magnitude;
                    if (magnitude <= VectorEpsilon) return Zero;
                    return this / magnitude;
                }

                public TraceVector3 ToTrace()
                {
                    return new TraceVector3 { x = X, y = Y, z = Z };
                }

                public static VectorD From(TraceVector3 value)
                {
                    return new VectorD(value.x, value.y, value.z);
                }

                public static double Dot(VectorD left, VectorD right)
                {
                    return left.X * right.X + left.Y * right.Y + left.Z * right.Z;
                }

                public static VectorD Cross(VectorD left, VectorD right)
                {
                    return new VectorD(
                        left.Y * right.Z - left.Z * right.Y,
                        left.Z * right.X - left.X * right.Z,
                        left.X * right.Y - left.Y * right.X);
                }

                public static VectorD operator +(VectorD left, VectorD right)
                {
                    return new VectorD(left.X + right.X, left.Y + right.Y, left.Z + right.Z);
                }

                public static VectorD operator -(VectorD left, VectorD right)
                {
                    return new VectorD(left.X - right.X, left.Y - right.Y, left.Z - right.Z);
                }

                public static VectorD operator *(VectorD value, double scale)
                {
                    return new VectorD(value.X * scale, value.Y * scale, value.Z * scale);
                }

                public static VectorD operator /(VectorD value, double scale)
                {
                    return new VectorD(value.X / scale, value.Y / scale, value.Z / scale);
                }
            }

            private readonly struct QuaternionD
            {
                public QuaternionD(double w, double x, double y, double z)
                {
                    W = w;
                    X = x;
                    Y = y;
                    Z = z;
                }

                public double W { get; }
                public double X { get; }
                public double Y { get; }
                public double Z { get; }

                public QuaternionD Normalized()
                {
                    var magnitude = Math.Sqrt(W * W + X * X + Y * Y + Z * Z);
                    if (magnitude <= VectorEpsilon) return new QuaternionD(1.0, 0.0, 0.0, 0.0);
                    return this * (1.0 / magnitude);
                }

                public QuaternionD Inverse()
                {
                    var lengthSquared = W * W + X * X + Y * Y + Z * Z;
                    return new QuaternionD(W / lengthSquared, -X / lengthSquared, -Y / lengthSquared, -Z / lengthSquared);
                }

                public VectorD Rotate(VectorD value)
                {
                    var q = Normalized();
                    var vector = new VectorD(q.X, q.Y, q.Z);
                    var twiceCross = VectorD.Cross(vector, value) * 2.0;
                    return value + twiceCross * q.W + VectorD.Cross(vector, twiceCross);
                }

                public VectorD ToRotationVector()
                {
                    var value = Normalized();
                    if (value.W < 0.0) value = -value;
                    var sine = Math.Sqrt(value.X * value.X + value.Y * value.Y + value.Z * value.Z);
                    if (sine <= VectorEpsilon)
                    {
                        return new VectorD(value.X * 2.0, value.Y * 2.0, value.Z * 2.0);
                    }

                    var angle = 2.0 * Math.Atan2(sine, Math.Max(0.0, value.W));
                    return new VectorD(value.X / sine, value.Y / sine, value.Z / sine) * angle;
                }

                public static QuaternionD FromRotationVector(VectorD value)
                {
                    var angle = value.Magnitude;
                    if (angle <= VectorEpsilon)
                    {
                        return new QuaternionD(1.0, value.X * 0.5, value.Y * 0.5, value.Z * 0.5).Normalized();
                    }

                    var half = angle * 0.5;
                    var scale = Math.Sin(half) / angle;
                    return new QuaternionD(Math.Cos(half), value.X * scale, value.Y * scale, value.Z * scale);
                }

                public static QuaternionD FromFrame(VectorD axis, VectorD face, VectorD width)
                {
                    // Matrix columns are local X=axis, local Y=face, local Z=width.
                    var m00 = axis.X;
                    var m01 = face.X;
                    var m02 = width.X;
                    var m10 = axis.Y;
                    var m11 = face.Y;
                    var m12 = width.Y;
                    var m20 = axis.Z;
                    var m21 = face.Z;
                    var m22 = width.Z;
                    var trace = m00 + m11 + m22;
                    QuaternionD result;
                    if (trace > 0.0)
                    {
                        var scale = Math.Sqrt(trace + 1.0) * 2.0;
                        result = new QuaternionD(
                            0.25 * scale,
                            (m21 - m12) / scale,
                            (m02 - m20) / scale,
                            (m10 - m01) / scale);
                    }
                    else if (m00 >= m11 && m00 >= m22)
                    {
                        var scale = Math.Sqrt(1.0 + m00 - m11 - m22) * 2.0;
                        result = new QuaternionD(
                            (m21 - m12) / scale,
                            0.25 * scale,
                            (m01 + m10) / scale,
                            (m02 + m20) / scale);
                    }
                    else if (m11 >= m22)
                    {
                        var scale = Math.Sqrt(1.0 + m11 - m00 - m22) * 2.0;
                        result = new QuaternionD(
                            (m02 - m20) / scale,
                            (m01 + m10) / scale,
                            0.25 * scale,
                            (m12 + m21) / scale);
                    }
                    else
                    {
                        var scale = Math.Sqrt(1.0 + m22 - m00 - m11) * 2.0;
                        result = new QuaternionD(
                            (m10 - m01) / scale,
                            (m02 + m20) / scale,
                            (m12 + m21) / scale,
                            0.25 * scale);
                    }

                    return result.Normalized();
                }

                public static double Dot(QuaternionD left, QuaternionD right)
                {
                    return left.W * right.W + left.X * right.X + left.Y * right.Y + left.Z * right.Z;
                }

                public static QuaternionD operator -(QuaternionD value)
                {
                    return new QuaternionD(-value.W, -value.X, -value.Y, -value.Z);
                }

                public static QuaternionD operator +(QuaternionD left, QuaternionD right)
                {
                    return new QuaternionD(left.W + right.W, left.X + right.X, left.Y + right.Y, left.Z + right.Z);
                }

                public static QuaternionD operator *(QuaternionD value, double scale)
                {
                    return new QuaternionD(value.W * scale, value.X * scale, value.Y * scale, value.Z * scale);
                }

                public static QuaternionD operator *(QuaternionD left, QuaternionD right)
                {
                    return new QuaternionD(
                        left.W * right.W - left.X * right.X - left.Y * right.Y - left.Z * right.Z,
                        left.W * right.X + left.X * right.W + left.Y * right.Z - left.Z * right.Y,
                        left.W * right.Y - left.X * right.Z + left.Y * right.W + left.Z * right.X,
                        left.W * right.Z + left.X * right.Y - left.Y * right.X + left.Z * right.W);
                }
            }
        }
    }
}
