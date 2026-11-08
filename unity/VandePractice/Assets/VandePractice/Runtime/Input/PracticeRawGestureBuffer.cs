using System;
using System.Collections.Generic;
using System.Text;
using Vande.Practice.Bridge;

namespace Vande.Practice.Input
{
    public readonly struct PracticePointerSample
    {
        public PracticePointerSample(double timeMs, double x, double y)
        {
            TimeMs = timeMs;
            X = x;
            Y = y;
        }

        public double TimeMs { get; }
        public double X { get; }
        public double Y { get; }
    }

    /// <summary>
    /// Bounded, memory-only capture for the TS GestureInput contract. It does
    /// not interpret, normalize, persist or score a player's motion.
    /// </summary>
    public sealed class PracticeRawGestureBuffer
    {
        private const double MaximumDurationMs = 3000.0;
        private readonly List<PracticePointerSample> samples =
            new List<PracticePointerSample>(BridgeConstants.MaxGestureSamples);
        private string pointer;
        private double width;
        private double height;

        public bool Active => samples.Count > 0;
        public double FirstTimeMs => Active ? samples[0].TimeMs : 0.0;
        public int Count => samples.Count;

        public void Begin(string pointerKind, PracticePointerSample sample, double surfaceWidth, double surfaceHeight)
        {
            if (pointerKind != "touch" && pointerKind != "mouse" && pointerKind != "pen")
                throw new BridgeValidationException("Pointer type is unsupported for native capture.");
            RequireFinite(sample);
            if (!Finite(surfaceWidth) || !Finite(surfaceHeight) || surfaceWidth <= 0.0 || surfaceHeight <= 0.0 ||
                surfaceWidth > 16384.0 || surfaceHeight > 16384.0)
                throw new BridgeValidationException("Gesture surface dimensions are invalid.");

            Clear();
            pointer = pointerKind;
            width = surfaceWidth;
            height = surfaceHeight;
            samples.Add(sample);
        }

        /// <returns>false when the bounded three-second capture window was exceeded.</returns>
        public bool Add(PracticePointerSample sample)
        {
            if (!Active) throw new BridgeValidationException("No native gesture is active.");
            RequireFinite(sample);
            if (sample.TimeMs < samples[samples.Count - 1].TimeMs)
                throw new BridgeValidationException("Gesture sample times must be monotonic.");
            if (sample.TimeMs - samples[0].TimeMs > MaximumDurationMs) return false;

            if (samples.Count < BridgeConstants.MaxGestureSamples) samples.Add(sample);
            else samples[samples.Count - 1] = sample;
            return true;
        }

        /// <summary>
        /// A held finger may wait indefinitely before committing. Keep only its
        /// newest rest sample so the eventual ephemeral gesture remains inside
        /// the three-second wire bound without turning the wait into a shot.
        /// </summary>
        public void RestAt(PracticePointerSample sample)
        {
            if (!Active) throw new BridgeValidationException("No native gesture is active.");
            RequireFinite(sample);
            if (sample.TimeMs < samples[samples.Count - 1].TimeMs)
                throw new BridgeValidationException("Gesture sample times must be monotonic.");
            for (var index = 0; index < samples.Count; index++) samples[index] = default;
            samples.Clear();
            samples.Add(sample);
        }

        public string Finish(PracticePointerSample finalSample)
        {
            return Finish(finalSample, null);
        }

        public string Finish(PracticePointerSample finalSample, string footwork)
        {
            if (!Add(finalSample))
                throw new BridgeValidationException("Gesture capture exceeded three seconds.");
            return FinishCurrent(footwork);
        }

        /// <summary>
        /// Encodes exactly the samples already captured. Platform cancellation
        /// after the irreversible forward-stroke boundary has no additional
        /// coordinate sample, so preserving the committed stroke must not
        /// invent a release position or extend its read time.
        /// </summary>
        public string FinishCurrent(string footwork)
        {
            if (!Active)
                throw new BridgeValidationException("No native gesture is active.");
            if (footwork != null && !PracticeFootworkSelection.IsWireValue(footwork))
                throw new BridgeValidationException("Gesture footwork is unsupported.");
            var encodedSamples = new StringBuilder(samples.Count * 48);
            encodedSamples.Append('[');
            for (var index = 0; index < samples.Count; index++)
            {
                if (index > 0) encodedSamples.Append(',');
                var sample = samples[index];
                encodedSamples.Append(CanonicalJson.Object(
                    "t", CanonicalJson.Number(sample.TimeMs),
                    "x", CanonicalJson.Number(sample.X),
                    "y", CanonicalJson.Number(sample.Y)));
            }
            encodedSamples.Append(']');

            var surface = CanonicalJson.Object(
                "height", CanonicalJson.Number(height),
                "width", CanonicalJson.Number(width));
            var value = footwork == null
                ? CanonicalJson.Object(
                    "pointer", CanonicalJson.String(pointer),
                    "samples", encodedSamples.ToString(),
                    "surface", surface)
                : CanonicalJson.Object(
                    "footwork", CanonicalJson.String(footwork),
                    "pointer", CanonicalJson.String(pointer),
                    "samples", encodedSamples.ToString(),
                    "surface", surface);
            Clear();
            return value;
        }

        /// <summary>
        /// Encodes the Unity-owned desktop keyboard path into the same
        /// ephemeral GestureInput contract as the browser tracker. It does
        /// not normalize, resolve or retain the shot.
        /// </summary>
        public static string EncodeKeyboard(
            double timeMs,
            double surfaceWidth,
            double surfaceHeight,
            string footwork,
            string kind,
            double screenBearingDeg,
            bool loft)
        {
            if (!Finite(timeMs) || !Finite(screenBearingDeg))
                throw new BridgeValidationException("Keyboard gesture values must be finite.");
            if (!Finite(surfaceWidth) || !Finite(surfaceHeight) || surfaceWidth <= 0.0 ||
                surfaceHeight <= 0.0 || surfaceWidth > 16384.0 || surfaceHeight > 16384.0)
                throw new BridgeValidationException("Gesture surface dimensions are invalid.");
            if (!PracticeFootworkSelection.IsWireValue(footwork))
                throw new BridgeValidationException("Gesture footwork is unsupported.");
            if (kind != "defend" && kind != "attack")
                throw new BridgeValidationException("Keyboard gesture kind is unsupported.");

            var sample = CanonicalJson.Object(
                "t", CanonicalJson.Number(timeMs),
                "x", CanonicalJson.Number(surfaceWidth / 2.0),
                "y", CanonicalJson.Number(surfaceHeight / 2.0));
            var key = CanonicalJson.Object(
                "kind", CanonicalJson.String(kind),
                "loft", loft ? "true" : "false",
                "screenBearingDeg", CanonicalJson.Number(screenBearingDeg));
            var surface = CanonicalJson.Object(
                "height", CanonicalJson.Number(surfaceHeight),
                "width", CanonicalJson.Number(surfaceWidth));
            return CanonicalJson.Object(
                "footwork", CanonicalJson.String(footwork),
                "key", key,
                "pointer", CanonicalJson.String("keyboard"),
                "samples", "[" + sample + "]",
                "surface", surface);
        }

        public void Clear()
        {
            for (var index = 0; index < samples.Count; index++) samples[index] = default;
            samples.Clear();
            pointer = null;
            width = 0.0;
            height = 0.0;
        }

        private static void RequireFinite(PracticePointerSample value)
        {
            if (!Finite(value.TimeMs) || !Finite(value.X) || !Finite(value.Y))
                throw new BridgeValidationException("Gesture sample is not finite.");
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
