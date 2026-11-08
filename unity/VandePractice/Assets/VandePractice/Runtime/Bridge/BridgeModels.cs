using System;

namespace Vande.Practice.Bridge
{
    [Serializable]
    public sealed class UnityPracticePacket
    {
        public string sha256;
        public string body;
    }

    /// <summary>
    /// Exact contract-v7 outer envelope from src/contracts/unityPractice.ts. PayloadJson
    /// preserves the original payload object for a message-specific adapter.
    /// </summary>
    public sealed class UnityPracticeEnvelope
    {
        public int contractVersion;
        public int simVersion;
        public string buildId;
        public string sessionId;
        public string deliveryId;
        public string messageId;
        public long sequence;
        public string sender;
        public string type;
        public string payloadJson;

        [NonSerialized] private string parsedPayloadSource;
        [NonSerialized] private StrictJsonObject parsedPayload;

        /// <summary>
        /// The canonical payload parsed once (by validation) and reused by the presentation adapter. A different
        /// payloadJson string is parsed afresh, so a mutated envelope can never reuse a stale tree.
        /// </summary>
        internal StrictJsonObject ParsedPayload()
        {
            if (parsedPayload != null && ReferenceEquals(parsedPayloadSource, payloadJson)) return parsedPayload;
            var parsed = StrictJsonObject.ParseCanonical(payloadJson);
            parsedPayload = parsed;
            parsedPayloadSource = payloadJson;
            return parsed;
        }

        /// <summary>
        /// Hands over the payload object already scanned as part of the body (the same canonical scan ParsedPayload would run on
        /// payloadJson), so validation does not scan it again. Bound to the current payloadJson string like any cached parse.
        /// </summary>
        internal void AttachParsedPayload(StrictJsonObject payload)
        {
            parsedPayload = payload;
            parsedPayloadSource = payloadJson;
        }
    }

    public sealed class DecodedUnityPracticePacket
    {
        public DecodedUnityPracticePacket(UnityPracticePacket packet, UnityPracticeEnvelope envelope)
        {
            Packet = packet;
            Envelope = envelope;
        }

        public UnityPracticePacket Packet { get; }
        public UnityPracticeEnvelope Envelope { get; }
    }

    /// <summary>
    /// One physical-framebuffer rectangle Unity asks the host HUD to keep
    /// clear. Coordinates use a top-left origin and are scoped by the packet's
    /// deliveryId and explicit viewport dimensions.
    /// </summary>
    public sealed class UnityPracticeProtectedRegion
    {
        public string Kind { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
    }

    public sealed class BridgeValidationException : Exception
    {
        public BridgeValidationException(string message) : base(message)
        {
        }
    }
}
