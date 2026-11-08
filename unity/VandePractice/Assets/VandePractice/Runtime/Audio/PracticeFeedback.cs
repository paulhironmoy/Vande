using System;
using Vande.Practice.Trace;

namespace Vande.Practice.Audio
{
    public enum PracticeFeedbackKind
    {
        Release,
        PitchBounce,
        BatContact,
        Pad,
        Stumps,
        KeeperTake,
        BallBounce,
        Catch,
        Field,
        Throw,
        Boundary,
        Run,
        Dead
    }

    public readonly struct PracticeFeedbackEvent
    {
        public PracticeFeedbackEvent(
            PracticeFeedbackKind kind,
            double simulationTime,
            string contact,
            int runs,
            TraceVector3 position)
        {
            Kind = kind;
            SimulationTime = simulationTime;
            Contact = contact;
            Runs = runs;
            Position = position;
        }

        public PracticeFeedbackKind Kind { get; }
        public double SimulationTime { get; }
        public string Contact { get; }
        public int Runs { get; }
        public TraceVector3 Position { get; }
    }

    public interface IPracticeFeedbackSink
    {
        void Configure(bool audioEnabled, bool hapticsEnabled, bool captionsEnabled);
        void Handle(PracticeFeedbackEvent feedback);
        void SetPaused(bool paused);
        void StopAll();
    }

    /// <summary>
    /// A sink that can take an upcoming event before its crossing frame, so a sound is heard at the physics time
    /// rather than on the next rendered frame. Captions and haptics still wait for Handle on the crossing frame.
    /// </summary>
    public interface IPracticeFeedbackLookahead
    {
        double LookaheadSeconds { get; }
        bool HandleAhead(PracticeFeedbackEvent feedback, double leadSeconds);
    }

    /// <summary>The delivery record a sink keys its take choices on (src/audio/takes.ts deliveryTakeKey).</summary>
    public interface IPracticeFeedbackTakeContext
    {
        void BeginTakeDelivery(string seed, int overIndex, int ballIndex, string pitchCondition);
        void SetContactTiming(string timing);
    }

    public sealed class PracticeFeedbackRouter
    {
        private readonly IPracticeFeedbackSink sink;
        private readonly double lateralMirror;

        public PracticeFeedbackRouter(IPracticeFeedbackSink sink, double lateralMirror = 1.0)
        {
            this.sink = sink ?? throw new ArgumentNullException(nameof(sink));
            if (double.IsNaN(lateralMirror) || double.IsInfinity(lateralMirror) ||
                Math.Abs(lateralMirror) < 0.5)
                throw new ArgumentOutOfRangeException(nameof(lateralMirror));
            this.lateralMirror = lateralMirror < 0.0 ? -1.0 : 1.0;
        }

        public void Route(CanonicalTraceEvent traceEvent)
        {
            if (traceEvent == null) throw new ArgumentNullException(nameof(traceEvent));
            sink.Handle(ToFeedback(traceEvent));
        }

        /// <summary>Zero when the sink cannot take events ahead of their crossing frame.</summary>
        public double LookaheadSeconds => sink is IPracticeFeedbackLookahead ahead ? ahead.LookaheadSeconds : 0.0;

        /// <summary>
        /// Hands an upcoming event to a look-ahead sink `leadSeconds` (wall seconds) before its physics time. Route is
        /// still called on its crossing frame. Returns false when the sink did not take it.
        /// </summary>
        public bool RouteAhead(CanonicalTraceEvent traceEvent, double leadSeconds)
        {
            if (traceEvent == null) throw new ArgumentNullException(nameof(traceEvent));
            return sink is IPracticeFeedbackLookahead ahead && ahead.HandleAhead(ToFeedback(traceEvent), leadSeconds);
        }

        public void BeginTakeDelivery(string seed, int overIndex, int ballIndex, string pitchCondition)
        {
            if (sink is IPracticeFeedbackTakeContext takes)
                takes.BeginTakeDelivery(seed, overIndex, ballIndex, pitchCondition);
        }

        public void SetContactTiming(string timing)
        {
            if (sink is IPracticeFeedbackTakeContext takes) takes.SetContactTiming(timing);
        }

        private PracticeFeedbackEvent ToFeedback(CanonicalTraceEvent traceEvent)
        {
            return new PracticeFeedbackEvent(
                Map(traceEvent.kind),
                traceEvent.t,
                traceEvent.contact,
                traceEvent.runs,
                MirrorPosition(traceEvent.p));
        }

        private TraceVector3 MirrorPosition(TraceVector3 value)
        {
            if (value == null) return null;
            return new TraceVector3
            {
                x = value.x * lateralMirror,
                y = value.y,
                z = value.z
            };
        }

        private static PracticeFeedbackKind Map(string kind)
        {
            switch (kind)
            {
                case "release": return PracticeFeedbackKind.Release;
                case "bounce": return PracticeFeedbackKind.PitchBounce;
                case "contact": return PracticeFeedbackKind.BatContact;
                case "pad": return PracticeFeedbackKind.Pad;
                case "stumps": return PracticeFeedbackKind.Stumps;
                case "keeper_take": return PracticeFeedbackKind.KeeperTake;
                case "ball_bounce": return PracticeFeedbackKind.BallBounce;
                case "catch": return PracticeFeedbackKind.Catch;
                case "field": return PracticeFeedbackKind.Field;
                case "throw": return PracticeFeedbackKind.Throw;
                case "boundary": return PracticeFeedbackKind.Boundary;
                case "run": return PracticeFeedbackKind.Run;
                case "dead": return PracticeFeedbackKind.Dead;
                default: throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unknown physics event.");
            }
        }
    }
}
