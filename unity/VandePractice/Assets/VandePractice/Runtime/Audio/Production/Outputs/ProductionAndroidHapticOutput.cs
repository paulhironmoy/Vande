using System;
using UnityEngine;

namespace Vande.Practice.Audio.Production.Outputs
{
    /// <summary>
    /// Permission-free Android haptics through View.performHapticFeedback.
    /// It honours the device's haptic setting, prepares the Java view before a
    /// delivery and becomes a safe no-op on unsupported platforms or hosts.
    /// No vibration permission, plugin, service or API key is required.
    /// </summary>
    public sealed class ProductionAndroidHapticOutput : IProductionHapticOutput, IDisposable
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        // Stable HapticFeedbackConstants present below VANDE's minSdk 28.
        private const int VirtualKey = 1;
        private const int KeyboardTap = 3;
        private const int ClockTick = 4;
        private const int ContextClick = 6;

        private readonly object[] virtualKeyArguments = { VirtualKey };
        private readonly object[] keyboardTapArguments = { KeyboardTap };
        private readonly object[] clockTickArguments = { ClockTick };
        private readonly object[] contextClickArguments = { ContextClick };
        private AndroidJavaObject activity;
        private AndroidJavaObject feedbackView;
        private AndroidJavaRunnable virtualKeyRunnable;
        private AndroidJavaRunnable keyboardTapRunnable;
        private AndroidJavaRunnable clockTickRunnable;
        private AndroidJavaRunnable contextClickRunnable;
        private object[] virtualKeyRunnableArguments;
        private object[] keyboardTapRunnableArguments;
        private object[] clockTickRunnableArguments;
        private object[] contextClickRunnableArguments;
#endif
        private bool disposed;

        public ProductionAndroidHapticOutput()
        {
            TryPrepare();
        }

        public bool IsAvailable { get; private set; }

        /// <summary>
        /// Resolves the attached Android decor view once, outside the feedback
        /// callback. Calling this again is idempotent.
        /// </summary>
        public bool TryPrepare()
        {
            if (disposed) return false;
#if UNITY_ANDROID && !UNITY_EDITOR
            if (feedbackView != null)
            {
                IsAvailable = true;
                return true;
            }

            try
            {
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                {
                    activity = player.GetStatic<AndroidJavaObject>("currentActivity");
                    if (activity == null)
                    {
                        ReleaseAndroidView();
                        return false;
                    }
                    using (var window = activity.Call<AndroidJavaObject>("getWindow"))
                    {
                        if (window == null)
                        {
                            ReleaseAndroidView();
                            return false;
                        }
                        feedbackView = window.Call<AndroidJavaObject>("getDecorView");
                    }
                }
                if (feedbackView == null)
                {
                    ReleaseAndroidView();
                    return false;
                }
                PrepareUiThreadCallbacks();
                IsAvailable = true;
            }
            catch (Exception)
            {
                ReleaseAndroidView();
            }
#endif
            return IsAvailable;
        }

        public void Emit(ProductionHapticCue cue)
        {
            if (disposed || !IsAvailable || cue.Kind == ProductionHapticKind.None ||
                cue.Strength <= 0f || float.IsNaN(cue.Strength) ||
                float.IsInfinity(cue.Strength)) return;

#if UNITY_ANDROID && !UNITY_EDITOR
            var arguments = RunnableArgumentsFor(cue.Kind, Mathf.Clamp01(cue.Strength));
            if (arguments == null) return;
            try
            {
                // The one-argument overload honours both global and view-level
                // haptic preferences. Android view work is dispatched on its
                // UI thread; cached delegates and argument arrays avoid per-cue
                // C# collection growth. JNI internals remain platform-owned.
                activity.Call("runOnUiThread", arguments);
            }
            catch (Exception)
            {
                // A detached Unity-as-a-Library host must not break a delivery.
                ReleaseAndroidView();
            }
#endif
        }

        public void CancelAll()
        {
            // View haptics are short, discrete system effects and expose no
            // cancellation handle. Future cues are suppressed by the sink while
            // paused; no background loop or queued vibration exists here.
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
#if UNITY_ANDROID && !UNITY_EDITOR
            ReleaseAndroidView();
#else
            IsAvailable = false;
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        private object[] RunnableArgumentsFor(ProductionHapticKind kind, float strength)
        {
            switch (kind)
            {
                case ProductionHapticKind.Release:
                    return clockTickRunnableArguments;
                case ProductionHapticKind.Block:
                    return strength >= 0.45f
                        ? virtualKeyRunnableArguments
                        : keyboardTapRunnableArguments;
                case ProductionHapticKind.Edge:
                    return keyboardTapRunnableArguments;
                case ProductionHapticKind.Pad:
                    return strength >= 0.5f
                        ? virtualKeyRunnableArguments
                        : keyboardTapRunnableArguments;
                case ProductionHapticKind.Middle:
                    return strength >= 0.75f
                        ? contextClickRunnableArguments
                        : virtualKeyRunnableArguments;
                case ProductionHapticKind.Catch:
                    return strength >= 0.65f
                        ? virtualKeyRunnableArguments
                        : keyboardTapRunnableArguments;
                case ProductionHapticKind.Boundary:
                    return virtualKeyRunnableArguments;
                case ProductionHapticKind.Six:
                case ProductionHapticKind.Wicket:
                    return strength >= 0.75f
                        ? contextClickRunnableArguments
                        : virtualKeyRunnableArguments;
                default:
                    return null;
            }
        }

        private void PrepareUiThreadCallbacks()
        {
            if (feedbackView == null) return;
            virtualKeyRunnable = () => PerformFeedback(virtualKeyArguments);
            keyboardTapRunnable = () => PerformFeedback(keyboardTapArguments);
            clockTickRunnable = () => PerformFeedback(clockTickArguments);
            contextClickRunnable = () => PerformFeedback(contextClickArguments);
            virtualKeyRunnableArguments = new object[] { virtualKeyRunnable };
            keyboardTapRunnableArguments = new object[] { keyboardTapRunnable };
            clockTickRunnableArguments = new object[] { clockTickRunnable };
            contextClickRunnableArguments = new object[] { contextClickRunnable };
        }

        private void PerformFeedback(object[] arguments)
        {
            if (disposed || feedbackView == null) return;
            try
            {
                feedbackView.Call<bool>("performHapticFeedback", arguments);
            }
            catch (Exception)
            {
                ReleaseAndroidView();
            }
        }

        private void ReleaseAndroidView()
        {
            IsAvailable = false;
            virtualKeyRunnableArguments = null;
            keyboardTapRunnableArguments = null;
            clockTickRunnableArguments = null;
            contextClickRunnableArguments = null;
            virtualKeyRunnable = null;
            keyboardTapRunnable = null;
            clockTickRunnable = null;
            contextClickRunnable = null;
            if (feedbackView != null) feedbackView.Dispose();
            feedbackView = null;
            if (activity != null) activity.Dispose();
            activity = null;
        }
#endif
    }
}
