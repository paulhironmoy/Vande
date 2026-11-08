using System;

namespace Vande.Practice.Trace
{
    [Serializable]
    public sealed class TraceVector3
    {
        public double x;
        public double y;
        public double z;
    }

    [Serializable]
    public sealed class TraceVector2
    {
        public double x;
        public double z;
    }

    [Serializable]
    public sealed class TraceBatterPosture
    {
        public double crouchM;
    }

    [Serializable]
    public sealed class TraceBatterMotion
    {
        public double startT;
        public double contactT;
        public double endT;
    }

    [Serializable]
    public sealed class BallTraceSample
    {
        public double t;
        public TraceVector3 p;
        public TraceVector3 v;
    }

    [Serializable]
    public sealed class BatTraceSample
    {
        public double t;
        public TraceVector3 grip;
        public TraceVector3 toe;
        public TraceVector3 face;
    }

    [Serializable]
    public sealed class FielderTraceSample
    {
        public double t;
        public double x;
        public double z;
        public string action;
    }

    [Serializable]
    public sealed class FielderTracePath
    {
        public string fielderId;
        public FielderTraceSample[] samples;
    }

    [Serializable]
    public sealed class CanonicalTraceEvent
    {
        public double t;
        public string kind;
        public string fielderId;
        public string contact;
        public int runs;
        public int completed;
        public TraceVector3 p;
        /// <summary>
        /// keeper_take only (contract v6, additive): how far short of the ball the keeper's reach fell (m). 0 when
        /// absent, i.e. a clean take. With shortM > 0 the ball passed beyond his reach: it is never in his gloves.
        /// </summary>
        public double shortM;
    }

    [Serializable]
    public sealed class CanonicalDeliveryTrace
    {
        public int traceVersion;
        public string deliveryId;
        public int simulationVersion;
        public double durationSeconds;
        public TraceVector2 batterRootOffset;
        public TraceBatterPosture batterPosture;
        public TraceBatterMotion batterMotion;
        public BallTraceSample[] ball;
        public BatTraceSample[] bat;
        public FielderTracePath[] fielders;
        public CanonicalTraceEvent[] events;
    }
}
