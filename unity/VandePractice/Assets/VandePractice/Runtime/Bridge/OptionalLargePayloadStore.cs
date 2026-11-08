using System;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Optional future optimization for payloads proven too large for the
    /// in-process packet. It is not part of the v1 launch protocol.
    /// Implementations must root names under app-private storage, reject links
    /// and traversal, and use sibling-temp plus atomic rename for writes.
    /// </summary>
    public interface IPrivateLargePayloadStore
    {
        bool TryRead(string baseFileName, out byte[] contents);
        bool TryWriteAtomic(string baseFileName, byte[] contents);
    }

    public sealed class LargePayloadReference
    {
        public string fileName;
        public int byteLength;
        public string sha256;
    }

    public static class OptionalLargePayloadStore
    {
        public static byte[] ReadVerified(LargePayloadReference reference, IPrivateLargePayloadStore store)
        {
            if (reference == null) throw new ArgumentNullException(nameof(reference));
            if (store == null) throw new ArgumentNullException(nameof(store));
            ValidateFileName(reference.fileName);
            if (reference.byteLength <= 0 || reference.byteLength > BridgeConstants.MaxLargePayloadBytes)
                throw new BridgeValidationException("Large payload byte length is invalid.");
            if (!Sha256Digest.IsLowerHexSha256(reference.sha256))
                throw new BridgeValidationException("Large payload digest is invalid.");

            byte[] contents;
            if (!store.TryRead(reference.fileName, out contents) || contents == null)
                throw new BridgeValidationException("Large payload is unavailable.");
            if (contents.Length != reference.byteLength)
                throw new BridgeValidationException("Large payload byte length does not match.");
            if (!Sha256Digest.FixedTimeEqualsLowerHex(reference.sha256, Sha256Digest.OfBytes(contents)))
                throw new BridgeValidationException("Large payload digest does not match.");
            return contents;
        }

        public static void ValidateFileName(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 128 ||
                value == "." || value == ".." || value.IndexOf("..", StringComparison.Ordinal) >= 0 ||
                value.IndexOf('/') >= 0 || value.IndexOf('\\') >= 0 || value.IndexOf(':') >= 0)
            {
                throw new BridgeValidationException("Large payload filename must be a safe basename.");
            }

            BridgeValidator.ValidateRestrictedText(value, 128, "fileName");
        }
    }
}
