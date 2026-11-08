using System;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;
using Vande.Practice.Runtime;

namespace Vande.Practice.Bridge
{
    /// <summary>
    /// Native/web host endpoint. The GameObject name and public methods must
    /// remain aligned with UnityPracticeHost.java and the WebGL host adapter.
    /// </summary>
    // Before the frame's other scripts: a packet whose background decode has finished is applied first thing, so the runtime
    // controller's Tick of the same frame already sees it.
    [DefaultExecutionOrder(-500)]
    public sealed class VandeBridgeBehaviour : MonoBehaviour
    {
        private const string ObjectName = "VandeBridge";
        private const string AndroidHostClass = "in.vande.cricket.unity.UnityPracticeHost";
        private static VandeBridgeBehaviour instance;
        private UnityPracticeBridgeSession session;
        private VandePracticeRuntimeController runtime;
        private string operationId;

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern string VandePracticeWebPendingOperationId();

        [DllImport("__Internal")]
        private static extern void VandePracticeWebRuntimeLoaded(string operationId);

        [DllImport("__Internal")]
        private static extern void VandePracticeWebEmit(string method, string operationId, string packet);
#endif

        public static double UnityRealtimeMilliseconds => Time.realtimeSinceStartupAsDouble * 1000.0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            if (instance != null) return;
            var bridgeObject = new GameObject(ObjectName);
            DontDestroyOnLoad(bridgeObject);
            instance = bridgeObject.AddComponent<VandeBridgeBehaviour>();
        }

        private void Awake()
        {
            if (instance != null && instance != this)
            {
                Destroy(gameObject);
                return;
            }

            instance = this;
            DontDestroyOnLoad(gameObject);
            operationId = ReadPendingOperationId();
#if (UNITY_ANDROID || UNITY_WEBGL) && !UNITY_EDITOR
            if (string.IsNullOrEmpty(operationId))
            {
                Debug.LogError("VANDE Unity bridge has no valid pending host operation; refusing to start.");
                instance = null;
                Destroy(gameObject);
                return;
            }
#endif
            runtime = gameObject.AddComponent<VandePracticeRuntimeController>();
            session = new UnityPracticeBridgeSession(
                packet => EmitToHost("emitFromUnity", packet),
                packet => EmitToHost("readyFromUnity", packet),
                () => UnityRealtimeMilliseconds,
                Application.unityVersion,
                runtime.AcceptHostMessage,
                detail => Debug.LogError("VANDE Unity diagnostic: " + detail));
            runtime.Bind(session);
            // Large result and replay packets are decoded off the main thread (BackgroundPacketDecoder.cs). False when the
            // kill-switch (BridgeConstants.BackgroundDecodeEnabled) is off or the platform has no threads: then it is all synchronous.
            session.EnableBackgroundDecode();
            NotifyHostRuntimeLoaded();
        }

        private void Update()
        {
            if (session != null) session.Pump();
        }

        public void ReceivePacket(string packetJson)
        {
            session.ReceivePacket(packetJson);
        }

        public void ReportRelease(string ignored)
        {
            Safely(() => session.ReportRelease());
        }

        /// <summary>Format: `down|touch`, `cancel|touch`, or another contract pointer type.</summary>
        public void ReportPointer(string phaseAndPointer)
        {
            Safely(() =>
            {
                var separator = phaseAndPointer == null ? -1 : phaseAndPointer.IndexOf('|');
                if (separator <= 0)
                    throw new BridgeValidationException("Pointer payload is invalid.");
                session.ReportPointer(
                    phaseAndPointer.Substring(0, separator),
                    phaseAndPointer.Substring(separator + 1));
            });
        }

        public void ReportGesture(string canonicalGestureInputJson)
        {
            Safely(() => session.ReportGesture(canonicalGestureInputJson));
        }

        /// <summary>
        /// UnitySendMessage target for Android's native Back callback. Invalid,
        /// stale, replaying, paused or already-consumed dead-ball state is a
        /// deliberate no-op rather than a fatal bridge failure.
        /// </summary>
        public void RequestDeadBallPauseFromNativeBack(string ignored)
        {
            try { session?.TryReportDeadBallPauseRequest(); }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity native Back request rejected: " + BoundedException(exception));
            }
        }

        /// <summary>Format: invariant deadT, a pipe, then lowercase replay SHA-256.</summary>
        public void ReportDeliveryDead(string deadTAndReplayDigest)
        {
            Safely(() =>
            {
                var separator = deadTAndReplayDigest == null ? -1 : deadTAndReplayDigest.IndexOf('|');
                double deadT;
                if (separator <= 0 || !double.TryParse(deadTAndReplayDigest.Substring(0, separator),
                        NumberStyles.Float, CultureInfo.InvariantCulture, out deadT))
                    throw new BridgeValidationException("Delivery completion payload is invalid.");
                session.ReportDeliveryDead(deadT, deadTAndReplayDigest.Substring(separator + 1));
            });
        }

        /// <summary>Called by the native host before UnityPlayer.unload().</summary>
        public void PrepareForUnload(string retainedMemoryMb)
        {
            Safely(() =>
            {
                double parsed;
                double? memory = string.IsNullOrEmpty(retainedMemoryMb) || retainedMemoryMb == "null"
                    ? (double?)null
                    : (double.TryParse(retainedMemoryMb, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed)
                        ? parsed
                        : throw new BridgeValidationException("Retained memory value is invalid."));
                CompleteNativeUnload(
                    () => runtime?.PrepareForNativeUnload(),
                    () => session.PrepareForUnload(memory));
            });
        }

        private static void CompleteNativeUnload(Action stopSurface, Action emitUnloaded)
        {
            try { stopSurface?.Invoke(); }
            finally { emitUnloaded?.Invoke(); }
        }

        private string ReadPendingOperationId()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var host = new AndroidJavaClass(AndroidHostClass))
                    return host.CallStatic<string>("pendingOperationIdFromUnity");
            }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity bridge could not read its operation id: " + exception.GetType().Name);
                return null;
            }
#elif UNITY_WEBGL && !UNITY_EDITOR
            try
            {
                return VandePracticeWebPendingOperationId();
            }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity Web bridge could not read its operation id: " +
                               exception.GetType().Name);
                return null;
            }
#else
            return "editor-operation";
#endif
        }

        private void NotifyHostRuntimeLoaded()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var host = new AndroidJavaClass(AndroidHostClass))
                    host.CallStatic("runtimeLoadedFromUnity", operationId);
            }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity bridge could not signal runtime load: " + exception.GetType().Name);
            }
#elif UNITY_WEBGL && !UNITY_EDITOR
            try
            {
                VandePracticeWebRuntimeLoaded(operationId);
            }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity Web bridge could not signal runtime load: " +
                               exception.GetType().Name);
            }
#endif
        }

        private void EmitToHost(string method, string packet)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var host = new AndroidJavaClass(AndroidHostClass))
                host.CallStatic(method, operationId, packet);
#elif UNITY_WEBGL && !UNITY_EDITOR
            VandePracticeWebEmit(method, operationId, packet);
#else
            Debug.Log("VANDE Unity bridge packet emitted without a native or WebGL host.");
#endif
        }

        private void Safely(Action action)
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                Debug.LogError("VANDE Unity bridge callback rejected: " + BoundedException(exception));
                try { session?.ReportRuntimeFailure(); }
                catch (Exception) { Debug.LogError("VANDE Unity bridge could not emit its fatal packet."); }
            }
        }

        private static string BoundedException(Exception exception)
        {
            if (exception == null) return "UnknownException|no-message";
            var message = string.IsNullOrEmpty(exception.Message) ? "no-message" : exception.Message;
            message = message.Replace('\r', ' ').Replace('\n', ' ');
            if (message.Length > 160) message = message.Substring(0, 160);
            return exception.GetType().Name + "|" + message;
        }

        private void OnDestroy()
        {
            try { session?.Dispose(); }
            catch (Exception) { /* a teardown must not throw */ }
            try { runtime?.PrepareForNativeUnload(); }
            catch (Exception) { /* Native lifecycle remains the sole physical-unload authority. */ }
            if (instance == this) instance = null;
        }
    }
}
