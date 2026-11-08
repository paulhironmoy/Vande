using System;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Performance
{
    /// <summary>Pairs an input timestamp with the first completed camera render after its visible state change.</summary>
    public sealed class PracticeVisibleLatencyProbe
    {
        private double? inputUnityMs;

        public bool Pending => inputUnityMs.HasValue;

        public void Begin(double value)
        {
            if (!Finite(value)) throw new BridgeValidationException("Input timestamp is not finite.");
            inputUnityMs = value;
        }

        public void Cancel()
        {
            inputUnityMs = null;
        }

        public double? Complete(double renderedUnityMs)
        {
            if (!inputUnityMs.HasValue) return null;
            var input = inputUnityMs.Value;
            inputUnityMs = null;
            if (!Finite(renderedUnityMs) || renderedUnityMs < input) return null;
            return renderedUnityMs - input;
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    /// <summary>
    /// Must live on the batter camera. OnPostRender is the earliest callback
    /// that proves a frame containing the already-applied bat transform finished.
    /// </summary>
    public sealed class PracticeRenderedFrameObserver : MonoBehaviour
    {
        public event Action<double> Rendered;

        private void OnPostRender()
        {
            Rendered?.Invoke(Time.realtimeSinceStartupAsDouble * 1000.0);
        }
    }
}
