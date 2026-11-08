using System;
using System.Collections.Generic;
using System.Runtime.ExceptionServices;
using System.Threading;

namespace Vande.Practice.Bridge
{
    // THREADING MODEL (UNITY-6, decode latency)
    //
    // What moves: only the pure-managed decode of one packet, UnityPracticePacketCodec.Decode: the outer split, the SHA-256 of
    // the body, the canonical scan, the schema validation and the replay digest. It reads one string and returns an immutable
    // result (the envelope and the document it was scanned into). It touches no Unity API and no shared mutable state (the
    // scratch buffers it reuses are [ThreadStatic]); an exception on the worker is captured and rethrown on the main thread.
    //
    // What does not move: everything after the decode. The sequence guard, the lifecycle transition, the acknowledgement, the
    // accepted-message callback (adapter, world) all run on the Unity main thread, in packet arrival order, exactly as the
    // synchronous path ran them, because they run the very same code: UnityPracticeBridgeSession.Process.
    //
    // Ordering: ReceivePacket (main thread only) puts every packet that arrives while an earlier one is still pending in one
    // FIFO queue behind it, large or small. Pump (VandeBridgeBehaviour.Update, before the frame's other scripts) applies the
    // head of the queue as soon as its decode is done, and never past an unfinished head. So no packet overtakes another, and
    // duplicate / out-of-order / lifecycle decisions are taken at apply time, in order, against the state the earlier packets left.
    //
    // Barriers: any session call that reads or changes lifecycle state (a Report..., a TryReport...) first Flush()es the queue
    // (waits for the decodes, applies them in order), so it sees the state the synchronous path would have had. The wait for
    // one decode is bounded (UnityPracticeBridgeSession.FlushTimeoutMilliseconds, 10 s): a decode that has not finished by then
    // is abandoned and its packet fails the session closed like any other decode failure. Teardown (native unload, behaviour
    // destroyed) calls CancelPending() and Dispose() instead: pending packets are dropped without any effect, and a decode
    // that finishes later is ignored. Re-entrant Pump/Flush from inside an apply are no-ops (the apply is already running).
    //
    // Fallbacks: a packet below BridgeConstants.BackgroundDecodeMinimumCharacters is decoded inline (when nothing is queued
    // ahead of it); WebGL (no threads) never starts the worker; BridgeConstants.BackgroundDecodeEnabled = false turns the whole
    // mechanism off; a worker that cannot start leaves the session synchronous.
    //
    internal interface IDecodeScheduler
    {
        /// <summary>Runs <paramref name="work"/> off the main thread, at some point; the work never throws.</summary>
        void Schedule(Action work);
    }

    internal static class BackgroundDecodeSupport
    {
        /// <summary>Test seam: null follows BridgeConstants.BackgroundDecodeEnabled (a compile-time constant), false or true stands in for it.</summary>
        internal static bool? SwitchOverrideForTests;

        /// <summary>Threads exist everywhere but WebGL (compile-time) and the kill-switch in BridgeConstants.</summary>
        public static bool Available
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                return false;
#else
                return SwitchOverrideForTests ?? BridgeConstants.BackgroundDecodeEnabled;
#endif
            }
        }
    }

    /// <summary>One dedicated background thread running scheduled work in order.</summary>
    internal sealed class WorkerThreadScheduler : IDecodeScheduler, IDisposable
    {
        private readonly object gate = new object();
        private readonly Queue<Action> queue = new Queue<Action>();
        private Thread thread;
        private bool disposed;

        public void Schedule(Action work)
        {
            lock (gate)
            {
                if (disposed) throw new ObjectDisposedException(nameof(WorkerThreadScheduler));
                if (thread == null)
                {
                    thread = new Thread(Run) { IsBackground = true, Name = "VandeBridgeDecode" };
                    thread.Start();
                }

                queue.Enqueue(work);
                Monitor.Pulse(gate);
            }
        }

        private void Run()
        {
            while (true)
            {
                Action work;
                lock (gate)
                {
                    while (queue.Count == 0 && !disposed) Monitor.Wait(gate);
                    if (queue.Count == 0) return;
                    work = queue.Dequeue();
                }

                try { work(); }
                catch (Exception) { /* the work captures its own failures */ }
            }
        }

        public void Dispose()
        {
            lock (gate)
            {
                disposed = true;
                Monitor.PulseAll(gate);
            }
        }
    }

    /// <summary>Runs the work on the calling thread, immediately (a deterministic stand-in for tests).</summary>
    internal sealed class ImmediateScheduler : IDecodeScheduler
    {
        public void Schedule(Action work)
        {
            work();
        }
    }

    /// <summary>One packet's decode: run once on the scheduler, read once on the main thread.</summary>
    internal sealed class DecodeJob
    {
        private readonly string packet;
        private readonly ManualResetEventSlim finished = new ManualResetEventSlim(false);
        private DecodedUnityPracticePacket result;
        private Exception error;
        private Exception forcedFailure;

        public DecodeJob(string packet)
        {
            this.packet = packet;
        }

        public bool IsDone
        {
            get { return finished.IsSet; }
        }

        /// <summary>The decode, for the scheduler. Everything it can throw is captured.</summary>
        public void Run()
        {
            try
            {
                if (forcedFailure != null) throw forcedFailure;
                var decoded = UnityPracticePacketCodec.Decode(packet);
                if (!finished.IsSet) result = decoded;
            }
            catch (Exception exception) { if (!finished.IsSet) error = exception; }
            finally { finished.Set(); }
        }

        /// <summary>Waits for the decode; false when it has not finished within <paramref name="milliseconds"/>.</summary>
        public bool Wait(int milliseconds)
        {
            return finished.Wait(milliseconds);
        }

        /// <summary>
        /// Gives up on a decode that never finished: the job now reports a failure (so the session fails closed, exactly as for any
        /// decode that throws) and a late result of the worker is ignored.
        /// </summary>
        public void Abandon()
        {
            error = new BridgeValidationException("Background packet decode did not finish.");
            result = null;
            finished.Set();
        }

        /// <summary>Test seam: the decode fails with this exception instead of decoding.</summary>
        internal void ForceFailure(Exception exception)
        {
            forcedFailure = exception;
        }

        /// <summary>The decoded envelope, or the exception the decode raised, rethrown as itself.</summary>
        public UnityPracticeEnvelope GetEnvelope()
        {
            finished.Wait();
            if (error != null) ExceptionDispatchInfo.Capture(error).Throw();
            return result.Envelope;
        }
    }
}
