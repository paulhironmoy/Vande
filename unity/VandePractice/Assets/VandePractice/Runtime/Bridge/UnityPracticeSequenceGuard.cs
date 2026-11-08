using System;
using System.Collections.Generic;

namespace Vande.Practice.Bridge
{
    public enum SequenceAcceptResult
    {
        Accept,
        Duplicate,
        OutOfOrder
    }

    /// <summary>
    /// Mirrors UnityPracticeSequenceGuard in TypeScript. The recent-id window is
    /// bounded; an older replay is still rejected by its non-increasing sequence.
    /// </summary>
    public sealed class UnityPracticeSequenceGuard
    {
        private readonly int capacity;
        private readonly HashSet<string> seen;
        private readonly Queue<string> order;
        private long lastSequence = -1;

        public UnityPracticeSequenceGuard(int capacity = BridgeConstants.MaxSeenMessages)
        {
            if (capacity < 1 || capacity > 65_536)
                throw new ArgumentOutOfRangeException(nameof(capacity));
            this.capacity = capacity;
            seen = new HashSet<string>(StringComparer.Ordinal);
            order = new Queue<string>(Math.Min(capacity, 4096));
        }

        public long LastSequence => lastSequence;

        public SequenceAcceptResult Accept(UnityPracticeEnvelope message)
        {
            var decision = Classify(message);
            if (decision != SequenceAcceptResult.Accept) return decision;

            seen.Add(message.messageId);
            order.Enqueue(message.messageId);
            if (order.Count > capacity) seen.Remove(order.Dequeue());
            lastSequence = message.sequence;
            return SequenceAcceptResult.Accept;
        }

        public SequenceAcceptResult Classify(UnityPracticeEnvelope message)
        {
            if (message == null) throw new ArgumentNullException(nameof(message));
            BridgeValidator.ValidateRestrictedText(
                message.messageId, BridgeConstants.MaxIdentifierLength, "messageId");
            if (seen.Contains(message.messageId)) return SequenceAcceptResult.Duplicate;
            if (message.sequence <= lastSequence) return SequenceAcceptResult.OutOfOrder;
            return SequenceAcceptResult.Accept;
        }
    }
}
