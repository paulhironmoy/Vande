using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using Vande.Practice.Bridge;
using Vande.Practice.Presentation;
using Vande.Practice.Trace;

namespace Vande.Practice.Tests.Equivalence
{
    /// <summary>
    /// Per-leg timing and allocation profile of the result-packet arrival chain on the managed side (UNITY-6): bytes to string,
    /// outer parse, SHA-256, canonical parse, schema validation, replay digest, the session's ReceivePacket, the adapter, the
    /// trace digest. Pure managed code so the same file runs in the Unity Editor (Mono) and in the standalone Mono harness.
    /// Method: every leg starts cold (number memo cleared, a collection forced before), median of N runs after two warm-ups,
    /// bytes from GC.GetAllocatedBytesForCurrentThread (exact, independent of when the collector runs).
    /// </summary>
    public static class BridgeLatencyProfile
    {
        private sealed class NullTarget : ICanonicalTraceTarget
        {
            public void SetBall(BallTraceSample sample) { }
            public void SetBat(BatTraceSample sample) { }
            public void SetFielder(string fielderId, FielderTraceSample sample) { }
            public void EmitEvent(CanonicalTraceEvent traceEvent) { }
            public void SetPlaybackCompleted(bool completed) { }
        }

        private sealed class Leg
        {
            public List<double> Ms = new List<double>();
            public List<long> Bytes = new List<long>();
            public List<int> GcPerRun = new List<int>();
        }

        public static string Uptime()
        {
            try
            {
                var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("/usr/bin/uptime")
                    { RedirectStandardOutput = true, UseShellExecute = false });
                return process.StandardOutput.ReadToEnd().Trim();
            }
            catch (Exception) { return "n/a"; }
        }

        private static bool? exactCounter;

        /// <summary>
        /// Bytes allocated so far by this thread: the runtime's own counter. Standalone Mono implements it; the Unity Editor's
        /// Mono (Boehm collector) answers 0, and a managed-heap delta is meaningless while collections run inside a leg, so
        /// there the answer is -1 and the table says so (the standalone table carries the exact figures; the code is identical).
        /// </summary>
        public static long AllocatedBytes()
        {
            if (!exactCounter.HasValue)
            {
                var before = GC.GetAllocatedBytesForCurrentThread();
                var block = new byte[100000];
                exactCounter = GC.GetAllocatedBytesForCurrentThread() - before >= 100000 && block.Length == 100000;
            }
            return exactCounter.Value ? GC.GetAllocatedBytesForCurrentThread() : -1;
        }

        public static string AllocationMethod()
        {
            AllocatedBytes();
            return exactCounter.Value ? "GC.GetAllocatedBytesForCurrentThread (exact)" : "n/a in this runtime (no per-thread counter; collections per leg are shown instead)";
        }

        private static void Measure(Dictionary<string, Leg> legs, List<string> order, string name, Action action)
        {
            Leg leg;
            if (!legs.TryGetValue(name, out leg)) { leg = new Leg(); legs[name] = leg; order.Add(name); }
            var gc = GC.CollectionCount(0);
            var bytes = AllocatedBytes();
            var watch = System.Diagnostics.Stopwatch.StartNew();
            action();
            watch.Stop();
            leg.Bytes.Add(bytes < 0 ? -1 : AllocatedBytes() - bytes);
            leg.Ms.Add(watch.Elapsed.TotalMilliseconds);
            leg.GcPerRun.Add(GC.CollectionCount(0) - gc);
        }

        private static void Record(Dictionary<string, Leg> legs, List<string> order, string name, double milliseconds)
        {
            Leg leg;
            if (!legs.TryGetValue(name, out leg)) { leg = new Leg(); legs[name] = leg; order.Add(name); }
            leg.Ms.Add(milliseconds);
            leg.Bytes.Add(-1);
            leg.GcPerRun.Add(0);
        }

        public static double Median(List<double> values)
        {
            var copy = values.ToList();
            copy.Sort();
            return copy[copy.Count / 2];
        }

        private static UnityPracticeEnvelope Copy(UnityPracticeEnvelope envelope)
        {
            return new UnityPracticeEnvelope
            {
                contractVersion = envelope.contractVersion, simVersion = envelope.simVersion, buildId = envelope.buildId,
                sessionId = envelope.sessionId, deliveryId = envelope.deliveryId, messageId = envelope.messageId,
                sequence = envelope.sequence, sender = envelope.sender, type = envelope.type,
                payloadJson = new string(envelope.payloadJson.ToCharArray())
            };
        }

        /// <summary>
        /// <paramref name="packet"/> is the result packet as the host sends it; <paramref name="prefix"/> are the session
        /// messages before it (initialize ... provisional swing) and <paramref name="resultStep"/> the packet that follows them.
        /// </summary>
        public static List<string> Run(string name, string packet, IList<string> prefix, string sessionResultPacket, int runs)
        {
            var legs = new Dictionary<string, Leg>();
            var order = new List<string>();
            var bytes = Encoding.UTF8.GetBytes(packet);
            for (var run = -2; run < runs; run++)
            {
                CanonicalJson.ClearNumberMemo();
                GC.Collect();
                string text = null, body = null, sha = null, digest = null;
                Measure(legs, order, "01 bytes -> string (UTF-8 decode; the real hop is native)", () => { text = Encoding.UTF8.GetString(bytes); });
                Measure(legs, order, "02 length check + UTF-8 byte count of the packet", () =>
                {
                    if (Encoding.UTF8.GetByteCount(packet) < 0) throw new Exception();
                });
                Measure(legs, order, "03 outer split (OuterPacket.TryParse; the general reader for any other shape)", () =>
                {
                    if (!OuterPacket.TryParse(packet, out sha, out body))
                    {
                        var outer = StrictJsonObject.Parse(packet);
                        sha = outer.String("sha256");
                        body = outer.String("body");
                    }
                });
                Measure(legs, order, "04 SHA-256 of the body (OfUtf8)", () => { digest = Sha256Digest.OfUtf8(body); });
                StrictJsonObject root = null;
                Measure(legs, order, "05 envelope ParseCanonical(body) (one scan of the whole body)", () => { root = StrictJsonObject.ParseCanonical(body); });
                var payloadText = root.Raw("payload");
                StrictJsonObject payload = null;
                Measure(legs, order, "06 payload ParseCanonical (what ParsedPayload does)", () => { payload = StrictJsonObject.ParseCanonical(payloadText); });
                DecodedUnityPracticePacket decoded = null;
                CanonicalJson.ClearNumberMemo();
                Measure(legs, order, "07 UnityPracticePacketCodec.Decode (everything above + schema validation + replay digest)", () => { decoded = UnityPracticePacketCodec.Decode(packet); });
                var envelope = decoded.Envelope;
                Measure(legs, order, "07w Decode again, number memo warm (UNITY-5's measurement condition; 0 on a new ball's numbers)", () => { UnityPracticePacketCodec.Decode(packet); });
                var copy = Copy(envelope);
                CanonicalJson.ClearNumberMemo();
                Measure(legs, order, "08 ValidateEnvelope on a fresh envelope (payload scan + schema + replay digest)", () => { BridgeValidator.ValidateEnvelope(copy); });
                Measure(legs, order, "08b ValidateEnvelope on the decoded envelope (payload already scanned: schema + replay digest)", () => { BridgeValidator.ValidateEnvelope(envelope); });
                Measure(legs, order, "09 replay digest only (ComputeFromResolutionPayload)", () => { UnityPracticeReplayDigest.ComputeFromResolutionPayload(copy.payloadJson); });
                PracticeResultPresentation result = null;
                Measure(legs, order, "10 adapter ResultFromValidated (what the runtime calls)", () => { result = PracticePresentationContractAdapter.ResultFromValidated(envelope); });
                Measure(legs, order, "11   of which CanonicalTraceValidator.Validate(trace)", () => { CanonicalTraceValidator.Validate(result.Trace); });
                var cold = Copy(envelope);
                Measure(legs, order, "12 adapter Result (ValidateEnvelope + ResultFromValidated; UNITY-5's 'adapt')", () => { PracticePresentationContractAdapter.Result(cold); });
                Measure(legs, order, "13 CanonicalTraceDigest.Compute(trace)", () => { CanonicalTraceDigest.Compute(result.Trace); });
                Measure(legs, order, "14 new CanonicalTracePlayback(trace) (validate + bat interpolator + digest)", () => { new CanonicalTracePlayback(result.Trace, new NullTarget()); });

                // The whole ReceivePacket, as the bridge behaviour calls it: a session in the delivery state, the result arrives.
                var accepted = 0.0;
                var session = new UnityPracticeBridgeSession(packetOut => { }, packetOut => { }, () => 1000.0, "6000.3.27f1",
                    message =>
                    {
                        if (message.type != "host.result") return;
                        var watch = System.Diagnostics.Stopwatch.StartNew();
                        PracticePresentationContractAdapter.ResultFromValidated(message);
                        accepted = watch.Elapsed.TotalMilliseconds;
                    });
                foreach (var step in prefix) session.ReceivePacket(step);
                CanonicalJson.ClearNumberMemo();
                GC.Collect();
                Measure(legs, order, "15 session.ReceivePacket(result) in the delivery state (decode + lifecycle + ack + adapter callback)", () => { session.ReceivePacket(sessionResultPacket); });
                if (session.State != BridgeLifecycleState.Resolved) throw new InvalidOperationException("the profile session did not accept the result: " + session.State);
                Leg callback;
                const string callbackName = "16   of which the accepted-message callback (adapter ResultFromValidated)";
                if (!legs.TryGetValue(callbackName, out callback)) { callback = new Leg(); legs[callbackName] = callback; order.Add(callbackName); }
                callback.Ms.Add(accepted);
                callback.Bytes.Add(-1);
                callback.GcPerRun.Add(0);

                // The same arrival with the background decode on a real worker thread. Measured on the main thread: the ReceivePacket
                // call, the Pump call that applies the result (lifecycle + acknowledgement + adapter callback), and the wall time from
                // the call to "accepted" polling Pump continuously and polling it once per 60 Hz frame (what Update does).
                foreach (var framePaced in new[] { false, true })
                {
                    var background = new UnityPracticeBridgeSession(packetOut => { }, packetOut => { }, () => 1000.0, "6000.3.27f1",
                        message => { if (message.type == "host.result") PracticePresentationContractAdapter.ResultFromValidated(message); });
                    if (!background.EnableBackgroundDecode()) throw new InvalidOperationException("no worker thread on this platform");
                    foreach (var step in prefix) background.ReceivePacket(step);
                    CanonicalJson.ClearNumberMemo();
                    GC.Collect();
                    var clock = System.Diagnostics.Stopwatch.StartNew();
                    background.ReceivePacket(sessionResultPacket);
                    var callMs = clock.Elapsed.TotalMilliseconds;
                    double applyMs = 0.0;
                    const double frameMs = 1000.0 / 60.0;
                    while (background.PendingPackets > 0)
                    {
                        if (framePaced)
                        {
                            var nextFrame = Math.Ceiling(clock.Elapsed.TotalMilliseconds / frameMs) * frameMs;
                            while (clock.Elapsed.TotalMilliseconds < nextFrame) { }
                        }
                        var before = clock.Elapsed.TotalMilliseconds;
                        background.Pump();
                        if (background.PendingPackets == 0) applyMs = clock.Elapsed.TotalMilliseconds - before;
                    }
                    var wallMs = clock.Elapsed.TotalMilliseconds;
                    if (background.State != BridgeLifecycleState.Resolved) throw new InvalidOperationException("the background session did not accept the result: " + background.State);
                    background.Dispose();
                    if (!framePaced)
                    {
                        Record(legs, order, "17 background decode: main-thread time of the ReceivePacket call that hands the packet over", callMs);
                        Record(legs, order, "18 background decode: main-thread time of the Pump that applies it (lifecycle + ack + adapter callback)", applyMs);
                        Record(legs, order, "19 background decode: wall from ReceivePacket to accepted, Pump polled continuously", wallMs);
                    }
                    else
                    {
                        Record(legs, order, "20 background decode: wall from ReceivePacket to accepted, Pump once per 60 Hz frame", wallMs);
                    }
                }
            }
            var lines = new List<string>();
            foreach (var key in order)
            {
                var leg = legs[key];
                // The first two runs are warm-ups: drop them (the callback leg has no warm-up rows of its own beyond the same count).
                var ms = leg.Ms.Skip(2).ToList();
                var allocated = leg.Bytes.Skip(2).OrderBy(x => x).ToList();
                var collections = leg.GcPerRun.Skip(2).OrderBy(x => x).ToList();
                var allocatedText = allocated[allocated.Count / 2] < 0 ? "n/a".PadLeft(7) : (allocated[allocated.Count / 2] / 1024).ToString(CultureInfo.InvariantCulture).PadLeft(7);
                lines.Add(key.PadRight(104) + " " + Median(ms).ToString("F3", CultureInfo.InvariantCulture).PadLeft(9) + " ms   alloc " + allocatedText +
                          " KB   collections/run (median) " + collections[collections.Count / 2].ToString(CultureInfo.InvariantCulture));
            }
            return lines;
        }
    }
}
