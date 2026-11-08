using System;
using System.Collections.Generic;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Pure C# bridge session. It validates every packet before state mutation,
    /// owns Unity's outbound sequence, and never computes gameplay outcomes.
    /// </summary>
    public sealed class UnityPracticeBridgeSession
    {
        private readonly Action<string> emitPacket;
        private readonly Action<string> emitReadyPacket;
        private readonly Func<double> unityRealtimeMilliseconds;
        private readonly string unityVersion;
        private readonly Action<UnityPracticeEnvelope> acceptedHostMessage;
        private readonly Action<string> reportDiagnostic;
        private readonly BridgeLifecycleCoordinator lifecycle = new BridgeLifecycleCoordinator();
        private long nextUnitySequence;
        private string activeDeliveryId;
        private string clockSampleId;

        // Background decode of large packets (see BackgroundPacketDecoder.cs for the threading model).
        private sealed class PendingPacket
        {
            public string Packet;
            public double ReceiveMs;
            public DecodeJob Job;
        }

        /// <summary>The longest a barrier waits for one background decode (a decode takes 10-20 ms; this is a bound against a stuck worker).</summary>
        internal static int FlushTimeoutMilliseconds = 10000;

        private readonly Queue<PendingPacket> pending = new Queue<PendingPacket>();
        private IDecodeScheduler decodeScheduler;
        private WorkerThreadScheduler ownedWorker;
        private bool applying;

        public UnityPracticeBridgeSession(
            Action<string> emitPacket,
            Action<string> emitReadyPacket,
            Func<double> unityRealtimeMilliseconds,
            string unityVersion,
            Action<UnityPracticeEnvelope> acceptedHostMessage,
            Action<string> reportDiagnostic = null)
        {
            this.emitPacket = emitPacket ?? throw new ArgumentNullException(nameof(emitPacket));
            this.emitReadyPacket = emitReadyPacket ?? throw new ArgumentNullException(nameof(emitReadyPacket));
            this.unityRealtimeMilliseconds = unityRealtimeMilliseconds ??
                                              throw new ArgumentNullException(nameof(unityRealtimeMilliseconds));
            if (string.IsNullOrEmpty(unityVersion)) throw new ArgumentException("Unity version is required.", nameof(unityVersion));
            this.unityVersion = unityVersion;
            this.acceptedHostMessage = acceptedHostMessage ??
                                       throw new ArgumentNullException(nameof(acceptedHostMessage));
            this.reportDiagnostic = reportDiagnostic;
        }

        public BridgeLifecycleState State => lifecycle.State;
        public bool ClockSynchronized => lifecycle.ClockSynchronized && lifecycle.ClockSelected;

        /// <summary>
        /// Starts decoding large packets on a background thread (BackgroundPacketDecoder.cs). False, and the session stays
        /// synchronous, when the kill-switch is off or the platform has no threads (WebGL) or the worker cannot start.
        /// </summary>
        public bool EnableBackgroundDecode()
        {
            if (decodeScheduler != null) return true;
            if (!BackgroundDecodeSupport.Available) return false;
            try
            {
                var worker = new WorkerThreadScheduler();
                decodeScheduler = worker;
                ownedWorker = worker;
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Test seam: decode through the given scheduler instead of the worker thread.</summary>
        internal void EnableBackgroundDecode(IDecodeScheduler scheduler)
        {
            if (scheduler == null) throw new ArgumentNullException(nameof(scheduler));
            decodeScheduler = scheduler;
        }

        public bool BackgroundDecodeActive => decodeScheduler != null;

        /// <summary>Packets received and not yet applied.</summary>
        public int PendingPackets => pending.Count;

        public void ReceivePacket(string packetJson)
        {
            var unityReceiveMs = unityRealtimeMilliseconds();
            var large = decodeScheduler != null && packetJson != null &&
                        packetJson.Length >= BridgeConstants.BackgroundDecodeMinimumCharacters;
            if (large || pending.Count > 0)
            {
                // Behind an earlier pending packet nothing may overtake it, large or small.
                var item = new PendingPacket { Packet = packetJson, ReceiveMs = unityReceiveMs };
                if (large)
                {
                    try
                    {
                        var job = new DecodeJob(packetJson);
                        decodeScheduler.Schedule(job.Run);
                        item.Job = job;
                    }
                    catch (Exception)
                    {
                        // The worker cannot run it (a thread that will not start): this packet is decoded inline at its
                        // turn, and the session goes back to decoding everything on the main thread.
                        item.Job = null;
                        DisableBackgroundDecode();
                    }
                }

                pending.Enqueue(item);
                Pump();
                return;
            }

            Process(packetJson, null, unityReceiveMs);
        }

        private void DisableBackgroundDecode()
        {
            var worker = ownedWorker;
            ownedWorker = null;
            decodeScheduler = null;
            if (worker != null) worker.Dispose();
        }

        /// <summary>
        /// Applies, in arrival order, every pending packet whose decode is finished; stops at the first one still decoding.
        /// Called once per frame (VandeBridgeBehaviour.Update) and after each ReceivePacket. Main thread only.
        /// </summary>
        public void Pump()
        {
            if (applying) return;
            while (pending.Count > 0)
            {
                var head = pending.Peek();
                if (head.Job != null && !head.Job.IsDone) return;
                pending.Dequeue();
                Apply(head);
            }
        }

        /// <summary>Waits for and applies every pending packet, in order: the barrier before any call that depends on the lifecycle state.</summary>
        internal void Flush()
        {
            if (applying) return;
            while (pending.Count > 0)
            {
                var head = pending.Dequeue();
                // A decode that has not finished in FlushTimeoutMilliseconds is abandoned and fails the session closed.
                if (head.Job != null && !head.Job.Wait(FlushTimeoutMilliseconds)) head.Job.Abandon();
                Apply(head);
            }
        }

        /// <summary>Test seam: every decode still pending fails with this exception when it runs.</summary>
        internal void ForceDecodeFailureForTests(Exception exception)
        {
            foreach (var item in pending)
                if (item.Job != null) item.Job.ForceFailure(exception);
        }

        /// <summary>Teardown: drops the pending packets without applying them; a decode that finishes later is ignored.</summary>
        public void CancelPending()
        {
            pending.Clear();
        }

        private void Apply(PendingPacket item)
        {
            applying = true;
            try { Process(item.Packet, item.Job, item.ReceiveMs); }
            finally { applying = false; }
        }

        /// <summary>
        /// One packet, decoded (here, or by its finished background job) and then taken through the lifecycle: the synchronous
        /// path of old, unchanged. Every failure is reported and fails the session closed; nothing escapes but the diagnostic.
        /// </summary>
        private void Process(string packetJson, DecodeJob job, double unityReceiveMs)
        {
            UnityPracticeEnvelope envelope = null;
            try
            {
                envelope = job != null ? job.GetEnvelope() : UnityPracticePacketCodec.Decode(packetJson).Envelope;
                // Decode is the single native trust boundary and has already
                // validated integrity, canonical JSON, payload shape and the
                // replay digest. Do not repeat that O(payload) work internally.
                var result = lifecycle.AcceptValidatedHost(envelope);
                if (result == BridgeTransitionResult.Duplicate)
                {
                    EmitAck(envelope);
                    return;
                }

                if (result == BridgeTransitionResult.Superseded)
                {
                    // A localized insight may already be queued when the
                    // player consumes either dead-ball action. Settle that
                    // exact same-ball update without resurrecting its UI.
                    EmitAck(envelope);
                    return;
                }

                if (result == BridgeTransitionResult.OutOfOrder)
                {
                    ReportDiagnostic("bridge_out_of_order",
                        new BridgeValidationException(lifecycle.FailureReason));
                    EmitError("out_of_order", false, "A host message arrived out of order.", "return_to_practice");
                    return;
                }

                if (result != BridgeTransitionResult.Accepted)
                {
                    ReportDiagnostic("bridge_rejected",
                        new BridgeValidationException(lifecycle.FailureReason));
                    EmitError("lifecycle", false, "The host message is invalid for the current state.",
                        "return_to_practice");
                    return;
                }

                switch (envelope.type)
                {
                    case "host.initialize":
                        NotifyAcceptedHost(envelope);
                        EmitAck(envelope);
                        if (!lifecycle.MarkUnityReady())
                            throw new BridgeValidationException("Unity could not enter ready state.");
                        Emit("unity.ready", null,
                            UnityPracticePacketCodec.ReadyPayload("unity-practice-foundation", unityVersion));
                        return;
                    case "host.clock_sync":
                        HandleClockSync(envelope, unityReceiveMs);
                        return;
                    case "host.clock_selected":
                        HandleClockSelected(envelope);
                        return;
                    case "host.delivery":
                    case "host.replay":
                    case "host.demonstration":
                        activeDeliveryId = envelope.deliveryId;
                        NotifyAcceptedHost(envelope);
                        EmitAck(envelope);
                        return;
                    case "host.demonstration_cancel":
                        NotifyAcceptedHost(envelope);
                        EmitAck(envelope);
                        activeDeliveryId = null;
                        return;
                    case "host.dispose":
                        NotifyAcceptedHost(envelope);
                        EmitAck(envelope);
                        return;
                    case "bridge.ack":
                        return;
                    default:
                        NotifyAcceptedHost(envelope);
                        EmitAck(envelope);
                        return;
                }
            }
            catch (BridgeValidationException exception)
            {
                ReportDiagnostic("bridge_validation", exception);
                lifecycle.Fail(exception.Message);
                if (lifecycle.SessionId != null)
                    EmitError("invalid_message", false, "Unity rejected an invalid bridge message.",
                        "return_to_practice");
            }
            catch (Exception exception)
            {
                ReportDiagnostic("bridge_runtime", exception);
                lifecycle.Fail("Unexpected Unity bridge failure.");
                if (lifecycle.SessionId != null)
                    EmitError("unity_runtime", false, "Unity could not process the bridge message.",
                        "return_to_practice");
            }
        }

        /// <summary>Stops the background worker, if any. Pending packets are dropped.</summary>
        public void Dispose()
        {
            CancelPending();
            DisableBackgroundDecode();
        }

        public void ReportRelease()
        {
            Flush();
            RequirePlayingAndClock();
            Emit("unity.release", activeDeliveryId,
                UnityPracticePacketCodec.ReleasePayload(clockSampleId, unityRealtimeMilliseconds()));
        }

        public void ReportPointer(string phase, string pointer)
        {
            ReportPointer(phase, pointer, unityRealtimeMilliseconds());
        }

        public void ReportPointer(string phase, string pointer, double atUnityMs)
        {
            Flush();
            RequirePlayingAndClock();
            Emit("unity.pointer", activeDeliveryId,
                UnityPracticePacketCodec.PointerPayload(
                    phase, atUnityMs, clockSampleId, pointer));
        }

        /// <summary>
        /// `canonicalInputJson` must be a GestureInput whose sample `t` values
        /// were captured from UnityRealtimeMilliseconds, not the host clock.
        /// Raw input remains in memory only and is never written by this class.
        /// </summary>
        public void ReportGesture(string canonicalInputJson)
        {
            Flush();
            RequirePlayingAndClock();
            StrictJsonObject.ParseCanonical(canonicalInputJson);
            var payload = CanonicalJson.Object(
                "clockSampleId", CanonicalJson.String(clockSampleId),
                "input", canonicalInputJson,
                "retention", CanonicalJson.String("memory-until-resolution"));
            Emit("unity.gesture", activeDeliveryId, payload);
        }

        public void ReportDeliveryDead(double deadT, string replayDigest)
        {
            Flush();
            RequireResolvedDeliveryAndClock();
            if (!Sha256Digest.IsLowerHexSha256(replayDigest))
                throw new BridgeValidationException("replayDigest is invalid.");
            if (!lifecycle.MarkDeliveryDead(deadT, replayDigest))
            {
                lifecycle.Fail("Unity delivery completion did not match the authoritative result.");
                EmitError("invalid_message", false,
                    "Unity rejected a delivery completion that did not match the authoritative result.",
                    "return_to_practice");
                throw new BridgeValidationException("Unity could not complete the active delivery.");
            }
            var payload = CanonicalJson.Object(
                "deadT", CanonicalJson.Number(deadT),
                "replayDigest", CanonicalJson.String(replayDigest));
            Emit("unity.dead", activeDeliveryId, payload);
            activeDeliveryId = null;
        }

        public void ReportStats(
            string quality,
            int sampleCount,
            int spikes,
            double fps,
            double averageFrameMs,
            double p95FrameMs,
            double p99FrameMs,
            double worstFrameMs,
            double? inputToVisibleBatMs,
            double? memoryMb,
            string thermalState)
        {
            Flush();
            RequireActiveSession();
            Emit("unity.stats", null,
                UnityPracticePacketCodec.StatsPayload(
                    quality, sampleCount, spikes, fps, averageFrameMs,
                    p95FrameMs, p99FrameMs, worstFrameMs,
                    inputToVisibleBatMs, memoryMb, thermalState));
        }

        public void ReportQuiet(bool quiet)
        {
            Flush();
            RequireActiveSession();
            Emit("unity.quiet", null, UnityPracticePacketCodec.QuietPayload(quiet));
        }

        public void ReportPauseRequest()
        {
            if (!TryReportPauseRequest())
                throw new BridgeValidationException("Pause is unavailable for the current presentation state.");
        }

        /// <summary>
        /// Requests pause from the on-screen Unity HUD. A retained dead ball is
        /// supported in addition to a live delivery; unresolved ready scenes,
        /// result consequence playback and replays fail without emitting a packet.
        /// </summary>
        public bool TryReportPauseRequest()
        {
            Flush();
            if (!lifecycle.TryMarkPauseRequest(false)) return false;
            Emit("unity.pause_request", null, UnityPracticePacketCodec.PauseRequestPayload());
            return true;
        }

        /// <summary>
        /// Android native Back entry point. It is intentionally narrower than
        /// the HUD request and accepts only the exact retained dead-ball surface.
        /// </summary>
        public bool TryReportDeadBallPauseRequest()
        {
            Flush();
            if (!lifecycle.TryMarkPauseRequest(true)) return false;
            Emit("unity.pause_request", null, UnityPracticePacketCodec.PauseRequestPayload());
            return true;
        }

        /// <summary>
        /// Emits one request for a currently visible dead-ball action. This never advances gameplay locally; the
        /// host validates the delivery/digest again and remains the sole innings and Coach authority.
        /// </summary>
        public bool TryReportDeadBallAction(string deliveryId, string replayDigest, string action)
        {
            Flush();
            if (action != "practice_ball" && action != "next_ball") return false;
            if (!Sha256Digest.IsLowerHexSha256(replayDigest)) return false;
            if (!lifecycle.TryMarkDeadBallAction(deliveryId, replayDigest, action)) return false;
            Emit("unity.dead_ball_action", deliveryId,
                UnityPracticePacketCodec.DeadBallActionPayload(action, replayDigest));
            return true;
        }

        /// <summary>
        /// Publishes a bounded snapshot of the exact Unity framebuffer areas
        /// that the host HUD must not cover. It is presentation metadata only
        /// and is valid solely for the current acknowledged live delivery.
        /// </summary>
        public bool TryReportProtectedRegions(
            string deliveryId,
            int viewportWidth,
            int viewportHeight,
            UnityPracticeProtectedRegion[] regions)
        {
            Flush();
            if ((lifecycle.State != BridgeLifecycleState.Delivery &&
                 lifecycle.State != BridgeLifecycleState.Demonstrating) ||
                string.IsNullOrEmpty(deliveryId) ||
                !string.Equals(deliveryId, activeDeliveryId, StringComparison.Ordinal))
                return false;
            var payload = UnityPracticePacketCodec.ProtectedRegionsPayload(
                viewportWidth, viewportHeight, regions);
            Emit("unity.protected_regions", deliveryId, payload);
            return true;
        }

        public void ReportBenchmark(
            string benchmarkId,
            string quality,
            double[] frameIntervalsMs,
            int warmupFrames,
            double warmupDurationMs,
            bool shaderWarmupCompleted,
            double? shaderWarmupMs,
            string graphicsApi,
            string graphicsDevice,
            long? contextGeneration,
            long? contextLosses,
            double? memoryMb,
            string thermalState)
        {
            Flush();
            RequireActiveSession();
            Emit("unity.benchmark", null,
                UnityPracticePacketCodec.BenchmarkPayload(
                    benchmarkId, quality, frameIntervalsMs, warmupFrames, warmupDurationMs,
                    shaderWarmupCompleted, shaderWarmupMs,
                    graphicsApi, graphicsDevice, contextGeneration, contextLosses, memoryMb, thermalState));
        }

        /// <summary>
        /// Converts an asynchronous presentation/input callback exception into
        /// one bounded fatal protocol error instead of allowing the host to wait.
        /// </summary>
        public void ReportRuntimeFailure()
        {
            Flush();
            if (lifecycle.State == BridgeLifecycleState.Failed ||
                lifecycle.State == BridgeLifecycleState.Unloaded) return;
            lifecycle.Fail("Unity presentation callback failed.");
            EmitError("unity_runtime", false, "Unity presentation stopped after a runtime callback failed.",
                "return_to_practice");
        }

        /// <summary>
        /// Called immediately before the native host invokes Unity unload. This
        /// is the final packet; it does not claim that process memory was freed.
        /// </summary>
        public void PrepareForUnload(double? retainedMemoryMb)
        {
            // Teardown, not a barrier: whatever is still decoding is dropped (a late decode is ignored), then the worker stops.
            CancelPending();
            Dispose();
            if (lifecycle.State != BridgeLifecycleState.Disposing &&
                lifecycle.State != BridgeLifecycleState.Failed)
                throw new BridgeValidationException("Unload was not requested by the host.");
            Emit("unity.unloaded", null, UnityPracticePacketCodec.UnloadedPayload(retainedMemoryMb));
            if (!lifecycle.MarkUnityUnloaded())
                throw new BridgeValidationException("Unity could not enter unloaded state.");
        }

        private void HandleClockSync(UnityPracticeEnvelope envelope, double unityReceiveMs)
        {
            var payload = envelope.ParsedPayload();
            var sampleId = payload.String("sampleId");
            var hostSendPerfMs = payload.Number("hostSendPerfMs");
            EmitAck(envelope);
            var unitySendMs = unityRealtimeMilliseconds();
            if (!lifecycle.MarkClockSynchronized(sampleId))
                throw new BridgeValidationException("Clock sync is invalid for the current state.");
            Emit("unity.clock_sync", null,
                UnityPracticePacketCodec.ClockSyncPayload(
                    sampleId, hostSendPerfMs, unityReceiveMs, unitySendMs));
        }

        private void HandleClockSelected(UnityPracticeEnvelope envelope)
        {
            var selected = envelope.ParsedPayload().String("sampleId");
            if (!lifecycle.SelectClockSample(selected))
                throw new BridgeValidationException("Selected clock sample was not accepted.");
            clockSampleId = selected;
            EmitAck(envelope);
        }

        private void EmitAck(UnityPracticeEnvelope envelope)
        {
            Emit("bridge.ack", envelope.deliveryId,
                UnityPracticePacketCodec.AckPayload(envelope.messageId));
        }

        private void NotifyAcceptedHost(UnityPracticeEnvelope envelope)
        {
            acceptedHostMessage(envelope);
        }

        private void ReportDiagnostic(string category, Exception exception)
        {
            if (reportDiagnostic == null) return;
            var message = exception == null ? null : exception.Message;
            if (string.IsNullOrEmpty(message)) message = "no-message";
            message = message.Replace('\r', ' ').Replace('\n', ' ');
            if (message.Length > 160) message = message.Substring(0, 160);
            var detail = category + "|" +
                         (exception == null ? "UnknownException" : exception.GetType().Name) + "|" + message;
            try { reportDiagnostic(detail); }
            catch (Exception) { /* Diagnostics must never alter protocol behavior. */ }
        }

        private void EmitError(string code, bool recoverable, string detail, string fallback)
        {
            // There is no valid error envelope before an initialize packet
            // establishes build/session identity; the native timeout handles it.
            if (lifecycle.SessionId == null) return;
            Emit("unity.error", activeDeliveryId,
                UnityPracticePacketCodec.ErrorPayload(code, recoverable, detail, fallback));
        }

        private void Emit(string type, string deliveryId, string payloadJson)
        {
            var messageId = lifecycle.SessionId + ".unity." + nextUnitySequence;
            var packet = UnityPracticePacketCodec.EncodeUnityPacket(
                lifecycle.BuildId,
                lifecycle.SessionId,
                deliveryId,
                messageId,
                nextUnitySequence,
                type,
                payloadJson);
            nextUnitySequence++;
            if (type == "unity.ready") emitReadyPacket(packet);
            else emitPacket(packet);
        }

        private void RequirePlayingAndClock()
        {
            if (lifecycle.State != BridgeLifecycleState.Delivery || !lifecycle.ClockSynchronized ||
                string.IsNullOrEmpty(activeDeliveryId) || string.IsNullOrEmpty(clockSampleId))
            {
                throw new BridgeValidationException("A clock-synchronized delivery is not active.");
            }
        }

        private void RequireResolvedDeliveryAndClock()
        {
            if ((lifecycle.State != BridgeLifecycleState.Resolved &&
                 lifecycle.State != BridgeLifecycleState.Replaying &&
                 lifecycle.State != BridgeLifecycleState.Demonstrating) ||
                !lifecycle.ClockSynchronized || string.IsNullOrEmpty(activeDeliveryId))
            {
                throw new BridgeValidationException("A resolved delivery or replay is not active.");
            }
        }

        private void RequireActiveSession()
        {
            if (lifecycle.State == BridgeLifecycleState.Cold ||
                lifecycle.State == BridgeLifecycleState.Loading ||
                lifecycle.State == BridgeLifecycleState.Disposing ||
                lifecycle.State == BridgeLifecycleState.Unloaded ||
                lifecycle.State == BridgeLifecycleState.Failed)
            {
                throw new BridgeValidationException("The Unity Practice session is not active.");
            }
        }
    }
}
