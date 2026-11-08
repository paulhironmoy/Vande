namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Recomputes the TypeScript replay identity without interpreting or
    /// mutating any authoritative physics/result field.
    /// </summary>
    public static class UnityPracticeReplayDigest
    {
        public static string ComputeFromResolutionPayload(string canonicalResolutionJson)
        {
            var resolution = StrictJsonObject.ParseCanonical(canonicalResolutionJson);
            resolution.Object("record");
            resolution.Object("result");
            return ComputeFromValidatedResolution(resolution);
        }

        /// <summary>
        /// SHA-256 of {"record":R,"result":S,"simVersion":3} where R and S are the raw tokens of the resolution: streamed from the
        /// resolution's own text (the same bytes CanonicalJson.Object would have framed), without building that string.
        /// </summary>
        private static string ComputeFromValidatedResolution(StrictJsonObject resolution)
        {
            string recordSource, resultSource;
            int recordStart, recordEnd, resultStart, resultEnd;
            resolution.RawSpan("record", out recordSource, out recordStart, out recordEnd);
            resolution.RawSpan("result", out resultSource, out resultStart, out resultEnd);
            using (var stream = new Sha256Stream())
            {
                stream.Append("{\"record\":");
                stream.Append(recordSource, recordStart, recordEnd - recordStart);
                stream.Append(",\"result\":");
                stream.Append(resultSource, resultStart, resultEnd - resultStart);
                stream.Append(",\"simVersion\":" + BridgeConstants.SimulationVersion.ToString(
                    System.Globalization.CultureInfo.InvariantCulture) + "}");
                return stream.Finish();
            }
        }

        public static void VerifyResolutionPayload(string canonicalResolutionJson)
        {
            var resolution = StrictJsonObject.ParseCanonical(canonicalResolutionJson);
            resolution.Object("record");
            resolution.Object("result");
            VerifyValidatedResolutionPayload(resolution);
        }

        /// <summary>
        /// Verifies a resolution object whose canonical shape has already been
        /// traversed by BridgeValidator. Keeping the parsed root prevents two
        /// additional full payload scans on every result and replay.
        /// </summary>
        internal static void VerifyValidatedResolutionPayload(StrictJsonObject resolution)
        {
            var claimed = resolution.String("replayDigest");
            if (!Sha256Digest.IsLowerHexSha256(claimed))
                throw new BridgeValidationException("replayDigest is invalid.");
            var expected = ComputeFromValidatedResolution(resolution);
            if (!Sha256Digest.FixedTimeEqualsLowerHex(claimed, expected))
                throw new BridgeValidationException("replayDigest does not match record and result.");
        }
    }
}
