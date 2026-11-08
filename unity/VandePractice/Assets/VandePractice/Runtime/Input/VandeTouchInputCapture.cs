using System;
using System.Collections.Generic;
using UnityEngine;
using Vande.Practice.Bridge;

namespace Vande.Practice.Input
{
    /// <summary>
    /// A bounded, presentation-only view of the current raw drag. It is not a
    /// normalized swing and must never be used for delivery physics, contact,
    /// scoring or result selection. TypeScript remains the sole authority for
    /// all of those concerns.
    /// </summary>
    public readonly struct PracticeLocalBatPreview
    {
        private const double HorizontalSpanFraction = 0.28;
        private const double VerticalSpanFraction = 0.32;
        private const double ReachSpanFraction = 0.34;
        private const double BackliftPhaseShare = 0.35;

        private PracticeLocalBatPreview(
            float horizontal,
            float vertical,
            float reach,
            float backlift,
            float forward,
            string footwork)
        {
            Horizontal = horizontal;
            Vertical = vertical;
            Reach = reach;
            Backlift = backlift;
            Forward = forward;
            Footwork = PracticeFootworkSelection.IsWireValue(footwork)
                ? footwork
                : "auto";
        }

        public float Horizontal { get; }
        public float Vertical { get; }
        /// <summary>
        /// Presentation-only depth of the downward pullback. It never enters
        /// normalization, physics, scoring or result selection.
        /// </summary>
        public float Backlift { get; }
        /// <summary>
        /// Presentation-only travel back up from the deepest loaded point.
        /// It is zero throughout pullback and hold, then increases after the
        /// forward reversal.
        /// </summary>
        public float Forward { get; }
        /// <summary>
        /// Monotonic local pose phase: pullback occupies the early share and
        /// forward travel advances from that held pose. This prevents the raw
        /// preview from visually rewinding while TypeScript remains the sole
        /// gesture authority.
        /// </summary>
        public float Reach { get; }
        /// <summary>
        /// Presentation-only press intent known before normalization. It lets
        /// the stride begin with the bat; TypeScript may still replace it with
        /// the normalized provisional and canonical result.
        /// </summary>
        public string Footwork { get; }

        public static PracticeLocalBatPreview FromRawDisplacement(
            double dx,
            double dy,
            double surfaceWidth,
            double surfaceHeight,
            string footwork = "auto")
        {
            if (!Finite(dx) || !Finite(dy) || !Finite(surfaceWidth) || !Finite(surfaceHeight) ||
                surfaceWidth <= 0.0 || surfaceHeight <= 0.0)
                return default;

            return FromOneContact(
                dx,
                Math.Max(0.0, dy),
                Math.Max(0.0, -dy),
                dy,
                surfaceWidth,
                surfaceHeight,
                footwork);
        }

        /// <summary>
        /// Builds one local pose from raw path geometry only. The caller owns
        /// the deepest loaded anchor; this method does not classify a shot.
        /// </summary>
        public static PracticeLocalBatPreview FromOneContact(
            double horizontalDx,
            double pullbackDepth,
            double forwardTravel,
            double netDy,
            double surfaceWidth,
            double surfaceHeight,
            string footwork = "auto",
            double minimumReach = 0.0)
        {
            if (!Finite(horizontalDx) || !Finite(pullbackDepth) ||
                !Finite(forwardTravel) || !Finite(netDy) || !Finite(minimumReach) ||
                !Finite(surfaceWidth) || !Finite(surfaceHeight) ||
                surfaceWidth <= 0.0 || surfaceHeight <= 0.0)
                return default;

            var horizontalSpan = Math.Max(48.0, surfaceWidth * HorizontalSpanFraction);
            var verticalSpan = Math.Max(48.0, surfaceHeight * VerticalSpanFraction);
            var reachSpan = Math.Max(48.0, Math.Min(surfaceWidth, surfaceHeight) * ReachSpanFraction);
            var backlift = Clamp(Math.Max(0.0, pullbackDepth) / verticalSpan, 0.0, 1.0);
            var forward = Clamp(Math.Max(0.0, forwardTravel) / reachSpan, 0.0, 1.0);
            var loadedPhase = BackliftPhaseShare * backlift;
            var phase = Math.Max(
                Clamp(minimumReach, 0.0, 1.0),
                loadedPhase + (1.0 - loadedPhase) * forward);
            return new PracticeLocalBatPreview(
                (float)Clamp(horizontalDx / horizontalSpan, -1.0, 1.0),
                (float)Clamp(-netDy / verticalSpan, -1.0, 1.0),
                (float)Clamp(phase, 0.0, 1.0),
                (float)backlift,
                (float)forward,
                footwork);
        }

        private static double Clamp(double value, double minimum, double maximum)
        {
            return Math.Max(minimum, Math.Min(maximum, value));
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    public static class PracticeBattingInputRegion
    {
        public const double TopFraction = 0.54;

        public static bool Contains(double x, double y, double width, double height)
        {
            return Finite(x) && Finite(y) && Finite(width) && Finite(height) &&
                   width > 0.0 && height > 0.0 && x >= 0.0 && x <= width &&
                   y >= height * TopFraction && y <= height;
        }

        public static double Top(double height)
        {
            return height * TopFraction;
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    /// <summary>
    /// Touch, browser-pointer and desktop-keyboard capture. Coordinates and
    /// surface dimensions use the same density-normalized, top-left-origin
    /// unit before TypeScript performs the sole gesture normalization. Raw
    /// samples never leave memory.
    /// </summary>
    public sealed class VandeTouchInputCapture : MonoBehaviour
    {
        private const double RestingOnsetGapMs = 20.0;
        private const double RestingOnsetMinimumSpeed = 0.08;
        private const double RestingPositionEpsilon = 1.0;
        private const double DepartureRadius = 2.5;
        private const double GapOnsetMinimumSpeed = 0.4;
        private const double MaximumBufferedRunMs = 2900.0;
        private const double KeyboardChordMs = 40.0;
        private const double DownTrackDoubleMs = 350.0;
        private const double BackwardDominance = 0.72;
        private readonly PracticeRawGestureBuffer buffer = new PracticeRawGestureBuffer();
        private sealed class RestingPointer
        {
            public bool HasPosition;
            public double TimeMs;
            public double X;
            public double Y;
            public double LastTimeMs;
            public double LastX;
            public double LastY;
            public bool MovingRun;
            public readonly List<PracticePointerSample> MovingSamples =
                new List<PracticePointerSample>(BridgeConstants.MaxGestureSamples);
        }

        private readonly Dictionary<int, RestingPointer> restingPointers =
            new Dictionary<int, RestingPointer>();
        private Action<string, string, double> pointerEvent;
        private Action<string> gestureCompleted;
        private Action<double> localPreparationRequested;
        private Action localPreparationCancelled;
        private Action<Exception> runtimeFailure;
        private Action<PracticeLocalBatPreview> localPreviewChanged;
        private int activeFingerId = int.MinValue;
        private string activePointer;
        private bool deliveryEnabled;
        private bool paused;
        private bool spent;
        private bool releaseReached;
        private double inputRegionTop;
        private double movementThreshold;
        // The raw buffer may rebase its first sample while an unmoved contact
        // waits, keeping a later intentional swipe inside the three-second
        // transport bound. Hold-vs-tap semantics still belong to the physical
        // contact, so retain its original down time independently.
        private double activeContactStartTimeMs = double.NaN;
        private double firstX;
        private double firstY;
        private bool intentionalMovement;
        // This mirrors only the public one-contact commitment boundary needed
        // for cancellation parity. It does not normalize, aim, score or choose
        // an outcome: TypeScript remains the sole gesture authority.
        private bool oneContactLoaded;
        private bool forwardCommitted;
        private bool activeWaiting;
        private bool activeMovingRun;
        private double activeLastSampleTimeMs;
        private double activeLastSampleX;
        private double activeLastSampleY;
        private double previewDeepestX;
        private double previewDeepestY;
        private double previewReach;
        private double activeSurfaceWidth;
        private double activeSurfaceHeight;
        private bool localPreparationActive;
        private bool localPreviewActive;
        private string activeGestureFootwork = "auto";
        private bool pressFootworkEnabled;
        private float pixelsPerLogicalUnit = 1f;
        private string handedness = "right";
        private string keyboardFootwork;
        private double lastForwardKeyMs = double.NegativeInfinity;
        private bool keyboardChordPending;
        private string keyboardFirstCode;
        private int keyboardFirstX;
        private int keyboardFirstY;
        private double keyboardChordTimeMs;
        private bool keyboardChordLoft;
        private double keyboardSurfaceWidth;
        private double keyboardSurfaceHeight;

        public bool DeliveryEnabled => deliveryEnabled;
        public bool InputArmed => deliveryEnabled && releaseReached && !paused && !spent && !keyboardChordPending;
        public bool LocalPreviewActive => localPreviewActive;
        public string ActiveGestureFootwork => activeGestureFootwork;

        public void Configure(
            Action<string, string, double> onPointer,
            Action<string> onGesture,
            Action<double> onLocalPreparation,
            Action onLocalPreparationCancelled,
            Action<Exception> onRuntimeFailure,
            Action<PracticeLocalBatPreview> onLocalPreview = null)
        {
            pointerEvent = onPointer ?? throw new ArgumentNullException(nameof(onPointer));
            gestureCompleted = onGesture ?? throw new ArgumentNullException(nameof(onGesture));
            localPreparationRequested = onLocalPreparation ??
                                        throw new ArgumentNullException(nameof(onLocalPreparation));
            localPreparationCancelled = onLocalPreparationCancelled ??
                                        throw new ArgumentNullException(nameof(onLocalPreparationCancelled));
            runtimeFailure = onRuntimeFailure ?? throw new ArgumentNullException(nameof(onRuntimeFailure));
            localPreviewChanged = onLocalPreview;
            pixelsPerLogicalUnit = ReadPixelsPerLogicalUnit();
        }

        public void ConfigureAssistance(string assistance)
        {
            if (assistance != "learn" && assistance != "play" && assistance != "real")
                throw new BridgeValidationException("Input assistance is unsupported.");
            pressFootworkEnabled = PracticeFootworkSelection.ManualSelectionAvailable(assistance);
            activeGestureFootwork = "auto";
        }

        public void ConfigureHandedness(string value)
        {
            if (value != "right" && value != "left")
                throw new BridgeValidationException("Input handedness is unsupported.");
            handedness = value;
        }

        public void BeginDelivery()
        {
            Clear(false);
            ResetLocalPreparation();
            deliveryEnabled = true;
            paused = false;
            spent = false;
            releaseReached = false;
            activeGestureFootwork = "auto";
            keyboardFootwork = null;
            lastForwardKeyMs = double.NegativeInfinity;
            restingPointers.Clear();
        }

        public void MarkReleaseReached()
        {
            if (!deliveryEnabled || releaseReached) return;
            var present = new List<int>();
            for (var index = 0; index < UnityEngine.Input.touchCount; index++)
            {
                var touch = UnityEngine.Input.GetTouch(index);
                if (touch.phase != TouchPhase.Ended && touch.phase != TouchPhase.Canceled)
                    present.Add(touch.fingerId);
            }
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL
            MarkReleaseReached(present, UnityEngine.Input.GetMouseButton(0));
#else
            MarkReleaseReached(present, false);
#endif
            for (var index = 0; index < UnityEngine.Input.touchCount; index++)
            {
                var touch = UnityEngine.Input.GetTouch(index);
                if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled) continue;
                var position = LogicalPosition(touch.position);
                SeedRestingPointer(touch.fingerId, CurrentMilliseconds(), position.x, position.y);
            }
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL
            if (UnityEngine.Input.GetMouseButton(0))
            {
                var position = LogicalPosition(UnityEngine.Input.mousePosition);
                SeedRestingPointer(-1, CurrentMilliseconds(), position.x, position.y);
            }
#endif
        }

        public void MarkReleaseReached(IEnumerable<int> restingPointers, bool mouseIsDown)
        {
            if (!deliveryEnabled || releaseReached) return;
            if (restingPointers == null) throw new ArgumentNullException(nameof(restingPointers));
            Clear(false);
            this.restingPointers.Clear();
            foreach (var pointerId in restingPointers)
                this.restingPointers[pointerId] = new RestingPointer();
            if (mouseIsDown) this.restingPointers[-1] = new RestingPointer();
            releaseReached = true;
        }

        public void SetPaused(bool value)
        {
            if (paused == value) return;
            paused = value;
            if (!paused) return;
            if (keyboardChordPending) CancelKeyboardChord(CurrentMilliseconds(), true);
            else if (buffer.Active) CaptureCancel(CurrentMilliseconds());
            else ResetLocalPreparation();
        }

        public void EndDelivery()
        {
            Clear(false);
            ResetLocalPreparation();
            restingPointers.Clear();
            deliveryEnabled = false;
            paused = false;
            spent = true;
            keyboardFootwork = null;
            lastForwardKeyMs = double.NegativeInfinity;
        }

        public void CaptureDown(
            string pointer,
            int pointerId,
            double timeMs,
            double x,
            double y,
            double surfaceWidth,
            double surfaceHeight)
        {
            if (!deliveryEnabled || !releaseReached || paused || spent || buffer.Active || keyboardChordPending ||
                restingPointers.ContainsKey(pointerId) ||
                !PracticeBattingInputRegion.Contains(x, y, surfaceWidth, surfaceHeight)) return;
            inputRegionTop = PracticeBattingInputRegion.Top(surfaceHeight);
            var battingHeight = surfaceHeight - inputRegionTop;
            buffer.Begin(pointer, new PracticePointerSample(timeMs, x, y - inputRegionTop),
                surfaceWidth, battingHeight);
            activeFingerId = pointerId;
            activePointer = pointer;
            activeContactStartTimeMs = timeMs;
            firstX = x;
            firstY = y;
            previewDeepestX = x;
            previewDeepestY = y;
            previewReach = 0.0;
            activeSurfaceWidth = surfaceWidth;
            activeSurfaceHeight = battingHeight;
            activeGestureFootwork = FootworkForPress(y - inputRegionTop, battingHeight);
            intentionalMovement = false;
            oneContactLoaded = false;
            forwardCommitted = false;
            activeWaiting = false;
            activeMovingRun = false;
            RememberActiveSample(timeMs, x, y);
            var reference = Math.Max(180.0, Math.Min(260.0, Math.Min(surfaceWidth, battingHeight)));
            movementThreshold = Math.Max(10.0, Math.Min(16.0, reference * 0.06));
            RequestLocalPreparation(timeMs);
            pointerEvent("down", pointer, timeMs);
        }

        public void CaptureMove(int pointerId, double timeMs, double x, double y)
        {
            if (restingPointers.ContainsKey(pointerId)) return;
            if (!buffer.Active || pointerId != activeFingerId) return;
            var sample = new PracticePointerSample(timeMs, x, y - inputRegionTop);
            if (!intentionalMovement &&
                (activeWaiting || timeMs - activeContactStartTimeMs > 250.0))
            {
                CaptureWaitingSample(sample, timeMs, x, y);
                return;
            }
            UpdateMovement(x, y);
            // The first intentional movement may be the new control's pullback,
            // followed by a meaningful hold. Keep transporting the raw contact
            // until lift; TypeScript alone identifies reversal and swing intent.
            if (!buffer.Add(sample))
            {
                CaptureCancel(timeMs);
                return;
            }
            RememberActiveSample(timeMs, x, y);
            ReportLocalPreview(x, y);
        }

        public void CaptureUp(int pointerId, double timeMs, double x, double y)
        {
            if (restingPointers.Remove(pointerId)) return;
            if (!buffer.Active || pointerId != activeFingerId) return;
            string value;
            try
            {
                var durationMs = timeMs - (Finite(activeContactStartTimeMs)
                    ? activeContactStartTimeMs
                    : buffer.FirstTimeMs);
                var finalSample = new PracticePointerSample(timeMs, x, y - inputRegionTop);
                if (!intentionalMovement && (activeWaiting || durationMs > 250.0))
                {
                    if (!CaptureWaitingSample(finalSample, timeMs, x, y)) return;
                }
                else
                {
                    UpdateMovement(x, y);
                    if (!buffer.Add(finalSample))
                    {
                        CaptureCancel(timeMs);
                        return;
                    }
                    RememberActiveSample(timeMs, x, y);
                    ReportLocalPreview(x, y);
                }
                if (!intentionalMovement && durationMs > 250.0)
                {
                    var heldPointer = activePointer ?? "touch";
                    buffer.Clear();
                    activeFingerId = int.MinValue;
                    activePointer = null;
                    activeContactStartTimeMs = double.NaN;
                    ResetLocalPreparation();
                    pointerEvent("cancel", heldPointer, timeMs);
                    return;
                }
                value = buffer.FinishCurrent(activeGestureFootwork);
            }
            catch (BridgeValidationException)
            {
                CaptureCancel(timeMs);
                return;
            }

            activeFingerId = int.MinValue;
            activePointer = null;
            activeContactStartTimeMs = double.NaN;
            spent = true;
            gestureCompleted(value);
        }

        public void CaptureRestingMove(
            string pointer,
            int pointerId,
            double timeMs,
            double x,
            double y,
            double surfaceWidth,
            double surfaceHeight)
        {
            RestingPointer resting;
            if (!InputArmed || !restingPointers.TryGetValue(pointerId, out resting) ||
                !PracticeBattingInputRegion.Contains(x, y, surfaceWidth, surfaceHeight)) return;
            if (!resting.HasPosition)
            {
                SeedRestingPointer(pointerId, timeMs, x, y);
                return;
            }

            var battingTop = PracticeBattingInputRegion.Top(surfaceHeight);
            var battingHeight = surfaceHeight - battingTop;
            var reference = Math.Max(180.0, Math.Min(260.0, Math.Min(surfaceWidth, battingHeight)));
            var threshold = Math.Max(10.0, Math.Min(16.0, reference * 0.06));
            var segmentDx = x - resting.LastX;
            var segmentDy = y - resting.LastY;
            var segmentDistance = Math.Sqrt(segmentDx * segmentDx + segmentDy * segmentDy);
            var segmentDuration = timeMs - resting.LastTimeMs;
            var startsAfterGap = segmentDuration > RestingOnsetGapMs;
            if (!IntentionalRestingSegment(segmentDistance, segmentDuration))
            {
                // Match the canonical tracker: slow polling drift moves the
                // resting coordinate as well as its time, so it cannot build
                // invisibly into a compressed swipe.
                resting.TimeMs = timeMs;
                resting.X = x;
                resting.Y = y;
                resting.LastTimeMs = timeMs;
                resting.LastX = x;
                resting.LastY = y;
                resting.MovingRun = false;
                resting.MovingSamples.Clear();
                return;
            }
            // The canonical onset walk stops at a sampling gap. A moving
            // segment after one may begin a new run, but repeated sparse
            // 4 px / 50 ms drift cannot accumulate across those gaps.
            if (!resting.MovingRun || startsAfterGap)
            {
                resting.TimeMs = BoundedRestTime(
                    resting.LastTimeMs, timeMs, segmentDistance, startsAfterGap);
                resting.X = resting.LastX;
                resting.Y = resting.LastY;
                resting.MovingRun = true;
                resting.MovingSamples.Clear();
                resting.MovingSamples.Add(new PracticePointerSample(
                    resting.TimeMs, resting.X, resting.Y - battingTop));
            }
            AddBoundedRunSample(resting.MovingSamples,
                new PracticePointerSample(timeMs, x, y - battingTop));
            resting.LastTimeMs = timeMs;
            resting.LastX = x;
            resting.LastY = y;

            var dx = x - resting.X;
            var dy = y - resting.Y;
            var distance = Math.Sqrt(dx * dx + dy * dy);
            if (distance <= threshold) return;

            var departureTime = CanonicalDepartureTime(resting.MovingSamples, threshold);
            inputRegionTop = battingTop;
            movementThreshold = threshold;
            firstX = resting.X;
            firstY = resting.Y;
            previewDeepestX = resting.X;
            previewDeepestY = resting.Y;
            previewReach = 0.0;
            activeSurfaceWidth = surfaceWidth;
            activeSurfaceHeight = battingHeight;
            activeGestureFootwork = FootworkForPress(resting.Y - battingTop, battingHeight);
            buffer.Begin(pointer, resting.MovingSamples[0], surfaceWidth, battingHeight);
            for (var index = 1; index < resting.MovingSamples.Count; index++)
            {
                if (buffer.Add(resting.MovingSamples[index])) continue;
                CaptureCancel(timeMs);
                return;
            }
            restingPointers.Remove(pointerId);
            activeFingerId = pointerId;
            activePointer = pointer;
            activeContactStartTimeMs = resting.MovingSamples[0].TimeMs;
            intentionalMovement = true;
            oneContactLoaded = IsDominantPullback(dx, dy, distance);
            forwardCommitted = false;
            RequestLocalPreparation(departureTime);
            pointerEvent("down", pointer, departureTime);
            ReportLocalPreview(x, y);
        }

        public void CaptureCancel(double timeMs)
        {
            if (!buffer.Active) return;
            if (forwardCommitted)
            {
                string value;
                try
                {
                    // A platform cancellation carries no trustworthy final
                    // coordinate. Preserve the exact committed evidence already
                    // captured; adding a synthetic sample would retime the read.
                    value = buffer.FinishCurrent(activeGestureFootwork);
                }
                catch (BridgeValidationException)
                {
                    CancelUncommitted(timeMs);
                    return;
                }

                activeFingerId = int.MinValue;
                activePointer = null;
                activeContactStartTimeMs = double.NaN;
                spent = true;
                gestureCompleted(value);
                return;
            }

            CancelUncommitted(timeMs);
        }

        private void CancelUncommitted(double timeMs)
        {
            var pointer = activePointer ?? (activeFingerId == -1 ? "mouse" : "touch");
            buffer.Clear();
            activeFingerId = int.MinValue;
            activePointer = null;
            activeContactStartTimeMs = double.NaN;
            ResetLocalPreparation();
            pointerEvent("cancel", pointer, timeMs);
        }

        /// <summary>
        /// Deterministic entry point for the Unity-owned desktop keyboard.
        /// Codes match KeyboardEvent.code so the native and retained browser
        /// implementations share one documented control vocabulary.
        /// </summary>
        public void CaptureKey(string code, double timeMs, bool repeat = false, bool shift = false)
        {
            CaptureKey(code, timeMs, repeat, shift,
                Math.Max(1.0, LogicalWidth()), Math.Max(1.0, LogicalHeight()));
        }

        public void CaptureKey(
            string code,
            double timeMs,
            bool repeat,
            bool shift,
            double surfaceWidth,
            double surfaceHeight)
        {
            if (!deliveryEnabled || !releaseReached || paused || spent || string.IsNullOrEmpty(code) ||
                !Finite(timeMs) || !ValidSurface(surfaceWidth, surfaceHeight)) return;

            // A frame can arrive after the chord deadline. Close the first
            // arrow before considering that later key, exactly as the browser
            // tracker's timer would have done.
            if (keyboardChordPending && timeMs > keyboardChordTimeMs + KeyboardChordMs)
            {
                CompleteKeyboardChord();
                return;
            }

            if (code == "ShiftLeft" || code == "ShiftRight")
            {
                if (keyboardChordPending) keyboardChordLoft = true;
                return;
            }

            if (IsDefendKey(code))
            {
                if (repeat || keyboardChordPending || buffer.Active) return;
                StartKeyboardShot(timeMs, surfaceWidth, surfaceHeight);
                EmitKeyboardGesture("defend", 0.0, false, timeMs,
                    keyboardSurfaceWidth, keyboardSurfaceHeight);
                return;
            }

            int directionX;
            int directionY;
            bool immediate;
            if (TryKeyboardDirection(code, out directionX, out directionY, out immediate))
            {
                if (repeat) return;
                if (keyboardChordPending)
                {
                    if (timeMs < keyboardChordTimeMs) return;
                    keyboardChordLoft = keyboardChordLoft || shift;
                    if (code != keyboardFirstCode)
                    {
                        directionX += keyboardFirstX;
                        directionY += keyboardFirstY;
                        if (directionX == 0 && directionY == 0)
                        {
                            directionX = keyboardFirstX;
                            directionY = keyboardFirstY;
                        }
                    }
                    else
                    {
                        directionX = keyboardFirstX;
                        directionY = keyboardFirstY;
                    }
                    CompleteKeyboardChord(directionX, directionY);
                    return;
                }
                if (buffer.Active) return;

                StartKeyboardShot(timeMs, surfaceWidth, surfaceHeight);
                keyboardChordPending = true;
                keyboardFirstCode = code;
                keyboardFirstX = directionX;
                keyboardFirstY = directionY;
                keyboardChordTimeMs = timeMs;
                keyboardChordLoft = shift;
                if (immediate) CompleteKeyboardChord();
                return;
            }

            if (repeat) return;
            var offSideKey = handedness == "left" ? "KeyA" : "KeyD";
            var legSideKey = handedness == "left" ? "KeyD" : "KeyA";
            if (code == "KeyW")
            {
                var downTrack = keyboardFootwork == "forward" &&
                                timeMs >= lastForwardKeyMs &&
                                timeMs - lastForwardKeyMs <= DownTrackDoubleMs;
                SetKeyboardFootwork(downTrack ? "down_track" : "forward");
                lastForwardKeyMs = timeMs;
            }
            else if (code == "KeyS") SetKeyboardFootwork("back");
            else if (code == offSideKey) SetKeyboardFootwork("across");
            else if (code == legSideKey) SetKeyboardFootwork("auto");
        }

        /// <summary>Advances the bounded 40 ms arrow-chord window.</summary>
        public void AdvanceKeyboard(double timeMs)
        {
            if (keyboardChordPending && Finite(timeMs) &&
                timeMs >= keyboardChordTimeMs + KeyboardChordMs)
                CompleteKeyboardChord();
        }

        private void Update()
        {
            if (!deliveryEnabled || paused || spent) return;
            try
            {
                PollTouch();
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL
                PollMouse();
#endif
#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL || UNITY_ANDROID
                PollKeyboard();
#endif
            }
            catch (Exception exception)
            {
                Clear(false);
                ResetLocalPreparation();
                deliveryEnabled = false;
                runtimeFailure(exception);
            }
        }

        private void PollTouch()
        {
            for (var index = 0; index < UnityEngine.Input.touchCount; index++)
            {
                var touch = UnityEngine.Input.GetTouch(index);
                if (restingPointers.ContainsKey(touch.fingerId))
                {
                    if (touch.phase == TouchPhase.Ended || touch.phase == TouchPhase.Canceled)
                        restingPointers.Remove(touch.fingerId);
                    else
                    {
                        var restingPosition = LogicalPosition(touch.position);
                        CaptureRestingMove("touch", touch.fingerId, CurrentMilliseconds(),
                            restingPosition.x, restingPosition.y, LogicalWidth(), LogicalHeight());
                    }
                    continue;
                }
                if (buffer.Active && touch.fingerId != activeFingerId) continue;
                var position = LogicalPosition(touch.position);
                var now = CurrentMilliseconds();
                switch (touch.phase)
                {
                    case TouchPhase.Began:
                        CaptureDown("touch", touch.fingerId, now, position.x, position.y,
                            LogicalWidth(), LogicalHeight());
                        break;
                    case TouchPhase.Moved:
                    case TouchPhase.Stationary:
                        CaptureMove(touch.fingerId, now, position.x, position.y);
                        break;
                    case TouchPhase.Ended:
                        CaptureUp(touch.fingerId, now, position.x, position.y);
                        break;
                    case TouchPhase.Canceled:
                        CaptureCancel(now);
                        break;
                }
            }
        }

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL
        private void PollMouse()
        {
            if (restingPointers.ContainsKey(-1))
            {
                if (UnityEngine.Input.GetMouseButtonUp(0)) restingPointers.Remove(-1);
                else if (UnityEngine.Input.GetMouseButton(0))
                {
                    var restingPosition = LogicalPosition(UnityEngine.Input.mousePosition);
                    CaptureRestingMove("mouse", -1, CurrentMilliseconds(), restingPosition.x,
                        restingPosition.y, LogicalWidth(), LogicalHeight());
                }
                return;
            }
            var position = LogicalPosition(UnityEngine.Input.mousePosition);
            var now = CurrentMilliseconds();
            if (UnityEngine.Input.GetMouseButtonDown(0))
                CaptureDown("mouse", -1, now, position.x, position.y, LogicalWidth(), LogicalHeight());
            else if (UnityEngine.Input.GetMouseButtonUp(0))
                CaptureUp(-1, now, position.x, position.y);
            else if (UnityEngine.Input.GetMouseButton(0))
                CaptureMove(-1, now, position.x, position.y);
        }
#endif

#if UNITY_EDITOR || UNITY_STANDALONE || UNITY_WEBGL || UNITY_ANDROID
        private void PollKeyboard()
        {
            var now = CurrentMilliseconds();
            var width = Math.Max(1.0, LogicalWidth());
            var height = Math.Max(1.0, LogicalHeight());
            var shift = UnityEngine.Input.GetKey(KeyCode.LeftShift) ||
                        UnityEngine.Input.GetKey(KeyCode.RightShift);
            var command = UnityEngine.Input.GetKey(KeyCode.LeftControl) ||
                          UnityEngine.Input.GetKey(KeyCode.RightControl) ||
                          UnityEngine.Input.GetKey(KeyCode.LeftAlt) ||
                          UnityEngine.Input.GetKey(KeyCode.RightAlt) ||
                          UnityEngine.Input.GetKey(KeyCode.LeftCommand) ||
                          UnityEngine.Input.GetKey(KeyCode.RightCommand) ||
                          UnityEngine.Input.GetKey(KeyCode.LeftWindows) ||
                          UnityEngine.Input.GetKey(KeyCode.RightWindows);

            if (!command)
            {
                if (UnityEngine.Input.GetKeyDown(KeyCode.LeftShift))
                    CaptureKey("ShiftLeft", now, false, true, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.RightShift))
                    CaptureKey("ShiftRight", now, false, true, width, height);

                if (UnityEngine.Input.GetKeyDown(KeyCode.W)) CaptureKey("KeyW", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.S)) CaptureKey("KeyS", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.A)) CaptureKey("KeyA", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.D)) CaptureKey("KeyD", now, false, shift, width, height);

                if (UnityEngine.Input.GetKeyDown(KeyCode.Space)) CaptureKey("Space", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Return)) CaptureKey("Enter", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.KeypadEnter)) CaptureKey("NumpadEnter", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad5)) CaptureKey("Numpad5", now, false, shift, width, height);

                if (UnityEngine.Input.GetKeyDown(KeyCode.UpArrow)) CaptureKey("ArrowUp", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.DownArrow)) CaptureKey("ArrowDown", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.LeftArrow)) CaptureKey("ArrowLeft", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.RightArrow)) CaptureKey("ArrowRight", now, false, shift, width, height);

                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad1)) CaptureKey("Numpad1", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad2)) CaptureKey("Numpad2", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad3)) CaptureKey("Numpad3", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad4)) CaptureKey("Numpad4", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad6)) CaptureKey("Numpad6", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad7)) CaptureKey("Numpad7", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad8)) CaptureKey("Numpad8", now, false, shift, width, height);
                if (UnityEngine.Input.GetKeyDown(KeyCode.Keypad9)) CaptureKey("Numpad9", now, false, shift, width, height);
            }
            AdvanceKeyboard(now);
        }
#endif

        private void StartKeyboardShot(double timeMs, double surfaceWidth, double surfaceHeight)
        {
            keyboardSurfaceWidth = surfaceWidth;
            keyboardSurfaceHeight = surfaceHeight - PracticeBattingInputRegion.Top(surfaceHeight);
            activeGestureFootwork = keyboardFootwork ?? "auto";
            RequestLocalPreparation(timeMs);
            pointerEvent("down", "keyboard", timeMs);
        }

        private void CompleteKeyboardChord()
        {
            CompleteKeyboardChord(keyboardFirstX, keyboardFirstY);
        }

        private void CompleteKeyboardChord(int directionX, int directionY)
        {
            if (!keyboardChordPending) return;
            var timeMs = keyboardChordTimeMs;
            var loft = keyboardChordLoft;
            var width = keyboardSurfaceWidth;
            var height = keyboardSurfaceHeight;
            ResetKeyboardChordState();
            EmitKeyboardGesture("attack", KeyboardBearing(directionX, directionY), loft,
                timeMs, width, height);
        }

        private void EmitKeyboardGesture(
            string kind,
            double screenBearingDeg,
            bool loft,
            double timeMs,
            double surfaceWidth,
            double surfaceHeight)
        {
            var value = PracticeRawGestureBuffer.EncodeKeyboard(
                timeMs,
                surfaceWidth,
                surfaceHeight,
                keyboardFootwork ?? "auto",
                kind,
                screenBearingDeg,
                loft);
            activeGestureFootwork = keyboardFootwork ?? "auto";
            spent = true;
            gestureCompleted(value);
        }

        private void CancelKeyboardChord(double timeMs, bool notifyPointer)
        {
            if (!keyboardChordPending) return;
            ResetKeyboardChordState();
            ResetLocalPreparation();
            if (notifyPointer) pointerEvent("cancel", "keyboard", timeMs);
        }

        private void ResetKeyboardChordState()
        {
            keyboardChordPending = false;
            keyboardFirstCode = null;
            keyboardFirstX = 0;
            keyboardFirstY = 0;
            keyboardChordTimeMs = 0.0;
            keyboardChordLoft = false;
            keyboardSurfaceWidth = 0.0;
            keyboardSurfaceHeight = 0.0;
        }

        private void SetKeyboardFootwork(string value)
        {
            keyboardFootwork = value;
            activeGestureFootwork = value;
        }

        private static bool IsDefendKey(string code)
        {
            return code == "Space" || code == "Enter" ||
                   code == "NumpadEnter" || code == "Numpad5";
        }

        private static bool TryKeyboardDirection(
            string code,
            out int x,
            out int y,
            out bool immediate)
        {
            immediate = false;
            switch (code)
            {
                case "ArrowUp": x = 0; y = -1; return true;
                case "ArrowDown": x = 0; y = 1; return true;
                case "ArrowLeft": x = -1; y = 0; return true;
                case "ArrowRight": x = 1; y = 0; return true;
                case "Numpad8": x = 0; y = -1; immediate = true; return true;
                case "Numpad9": x = 1; y = -1; immediate = true; return true;
                case "Numpad6": x = 1; y = 0; immediate = true; return true;
                case "Numpad3": x = 1; y = 1; immediate = true; return true;
                case "Numpad2": x = 0; y = 1; immediate = true; return true;
                case "Numpad1": x = -1; y = 1; immediate = true; return true;
                case "Numpad4": x = -1; y = 0; immediate = true; return true;
                case "Numpad7": x = -1; y = -1; immediate = true; return true;
                default: x = 0; y = 0; return false;
            }
        }

        private static double KeyboardBearing(int x, int y)
        {
            if (x == 0) return y < 0 ? 0.0 : 180.0;
            if (y == 0) return x < 0 ? -90.0 : 90.0;
            if (Math.Abs(x) == Math.Abs(y))
            {
                if (x > 0) return y < 0 ? 45.0 : 135.0;
                return y < 0 ? -45.0 : -135.0;
            }
            return Math.Atan2(x, -y) * 180.0 / Math.PI;
        }

        private static bool ValidSurface(double width, double height)
        {
            return Finite(width) && Finite(height) && width > 0.0 && height > 0.0 &&
                   width <= 16384.0 && height <= 16384.0;
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private Vector2 LogicalPosition(Vector2 unityBottomLeftPosition)
        {
            return new Vector2(
                unityBottomLeftPosition.x / pixelsPerLogicalUnit,
                (Screen.height - unityBottomLeftPosition.y) / pixelsPerLogicalUnit);
        }

        private double LogicalWidth()
        {
            return Math.Min(16384.0, Screen.width / pixelsPerLogicalUnit);
        }

        private double LogicalHeight()
        {
            return Math.Min(16384.0, Screen.height / pixelsPerLogicalUnit);
        }

        private static double CurrentMilliseconds()
        {
            return Time.realtimeSinceStartupAsDouble * 1000.0;
        }

        private string FootworkForPress(double relativeY, double surfaceHeight)
        {
            if (keyboardFootwork != null) return keyboardFootwork;
            return pressFootworkEnabled
                ? PracticeFootworkSelection.FromPress(relativeY, surfaceHeight)
                : "auto";
        }

        private static float ReadPixelsPerLogicalUnit()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var resources = activity.Call<AndroidJavaObject>("getResources"))
                using (var metrics = resources.Call<AndroidJavaObject>("getDisplayMetrics"))
                {
                    var density = metrics.Get<float>("density");
                    if (density > 0f && !float.IsNaN(density) && !float.IsInfinity(density)) return density;
                }
            }
            catch (Exception)
            {
                // A density of one preserves consistent coordinates and surface
                // units; the physical-device spike must validate Android DP/CSS parity.
            }
#endif
            return 1f;
        }

        private void Clear(bool notifyCancel)
        {
            if (notifyCancel && keyboardChordPending)
                CancelKeyboardChord(CurrentMilliseconds(), true);
            else if (notifyCancel && buffer.Active)
                CaptureCancel(CurrentMilliseconds());
            else
            {
                buffer.Clear();
                ResetKeyboardChordState();
            }
            activeFingerId = int.MinValue;
            activePointer = null;
            activeContactStartTimeMs = double.NaN;
            intentionalMovement = false;
            oneContactLoaded = false;
            forwardCommitted = false;
            activeWaiting = false;
            activeMovingRun = false;
            activeLastSampleTimeMs = 0.0;
            activeLastSampleX = 0.0;
            activeLastSampleY = 0.0;
            previewDeepestX = 0.0;
            previewDeepestY = 0.0;
            previewReach = 0.0;
            movementThreshold = 0.0;
            inputRegionTop = 0.0;
            activeSurfaceWidth = 0.0;
            activeSurfaceHeight = 0.0;
            activeGestureFootwork = "auto";
        }

        private void SeedRestingPointer(int pointerId, double timeMs, double x, double y)
        {
            RestingPointer resting;
            if (!restingPointers.TryGetValue(pointerId, out resting)) return;
            resting.HasPosition = true;
            resting.TimeMs = timeMs;
            resting.X = x;
            resting.Y = y;
            resting.LastTimeMs = timeMs;
            resting.LastX = x;
            resting.LastY = y;
            resting.MovingRun = false;
            resting.MovingSamples.Clear();
        }

        private static bool IntentionalRestingSegment(double distance, double durationMs)
        {
            if (durationMs <= 0.0) return distance > 0.0;
            if (durationMs > RestingOnsetGapMs) return distance > RestingPositionEpsilon;
            return distance / durationMs >= RestingOnsetMinimumSpeed;
        }

        private static double BoundedRestTime(
            double restTimeMs,
            double movingTimeMs,
            double firstDistance,
            bool startsAfterGap)
        {
            if (!startsAfterGap) return restTimeMs;
            // Retain a >20 ms silence and enough span for the canonical 0.4
            // px/ms carry-back floor, while keeping the ephemeral packet under
            // the native transport's three-second bound.
            var requiredSpan = Math.Max(
                RestingOnsetGapMs + 0.001,
                firstDistance / GapOnsetMinimumSpeed);
            return Math.Max(restTimeMs, movingTimeMs - Math.Min(MaximumBufferedRunMs, requiredSpan));
        }

        private static void AddBoundedRunSample(
            List<PracticePointerSample> samples,
            PracticePointerSample sample)
        {
            if (samples.Count < BridgeConstants.MaxGestureSamples) samples.Add(sample);
            else samples[samples.Count - 1] = sample;
        }

        /// <summary>
        /// Presentation/authorization timestamp only. This mirrors canonical
        /// swipeStart so the local cue is neither late nor early; the complete
        /// retained sample run still goes to TypeScript for sole normalization.
        /// </summary>
        private static double CanonicalDepartureTime(
            IReadOnlyList<PracticePointerSample> samples,
            double threshold)
        {
            if (samples == null || samples.Count < 2) return 0.0;
            var rest0 = samples[0];
            var crossing = -1;
            for (var index = 1; index < samples.Count; index++)
            {
                if (SampleDistance(samples[index], rest0) <= threshold) continue;
                crossing = index;
                break;
            }
            if (crossing < 1) return samples[samples.Count - 1].TimeMs;

            var onset = crossing;
            while (onset > 0)
            {
                var previous = samples[onset - 1];
                var current = samples[onset];
                var duration = current.TimeMs - previous.TimeMs;
                var distance = SampleDistance(previous, current);
                var gap = duration > RestingOnsetGapMs;
                var moving = duration <= 0.0
                    ? distance > 0.0
                    : gap
                        ? distance > RestingPositionEpsilon
                        : distance / duration >= RestingOnsetMinimumSpeed;
                if (!moving) break;
                onset--;
                if (gap) break;
            }

            var rest = samples[onset];
            var movingIndex = onset + 1;
            while (movingIndex < crossing &&
                   SampleDistance(samples[movingIndex], rest) <= DepartureRadius)
                movingIndex++;
            var before = samples[movingIndex - 1];
            var firstMoving = samples[movingIndex];
            var beforeDistance = SampleDistance(before, rest);
            var firstDistance = SampleDistance(firstMoving, rest);
            var departure = firstDistance > beforeDistance
                ? before.TimeMs + Clamp01(
                    (DepartureRadius - beforeDistance) / (firstDistance - beforeDistance)) *
                  (firstMoving.TimeMs - before.TimeMs)
                : firstMoving.TimeMs;
            if (firstMoving.TimeMs - before.TimeMs > RestingOnsetGapMs &&
                beforeDistance <= RestingPositionEpsilon)
            {
                var followingSpeed = 0.0;
                if (movingIndex + 1 < samples.Count)
                {
                    var following = samples[movingIndex + 1];
                    if (following.TimeMs > firstMoving.TimeMs)
                        followingSpeed =
                            (SampleDistance(following, rest) - firstDistance) /
                            (following.TimeMs - firstMoving.TimeMs);
                }
                var speed = Math.Max(followingSpeed, GapOnsetMinimumSpeed);
                departure = Math.Max(
                    departure,
                    firstMoving.TimeMs - Math.Max(0.0, firstDistance - DepartureRadius) / speed);
            }
            return Math.Max(before.TimeMs, Math.Min(firstMoving.TimeMs, departure));
        }

        private static double SampleDistance(
            PracticePointerSample left,
            PracticePointerSample right)
        {
            var dx = left.X - right.X;
            var dy = left.Y - right.Y;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        private static double Clamp01(double value)
        {
            return Math.Max(0.0, Math.Min(1.0, value));
        }

        private bool CaptureWaitingSample(
            PracticePointerSample sample,
            double timeMs,
            double x,
            double y)
        {
            activeWaiting = true;
            var segmentDx = x - activeLastSampleX;
            var segmentDy = y - activeLastSampleY;
            var segmentDistance = Math.Sqrt(segmentDx * segmentDx + segmentDy * segmentDy);
            var segmentDuration = timeMs - activeLastSampleTimeMs;
            var startsAfterGap = segmentDuration > RestingOnsetGapMs;
            if (!IntentionalRestingSegment(segmentDistance, segmentDuration))
            {
                buffer.RestAt(sample);
                RebaseActiveRest(x, y);
                RememberActiveSample(timeMs, x, y);
                activeMovingRun = false;
                return true;
            }

            if (!activeMovingRun || startsAfterGap)
            {
                firstX = activeLastSampleX;
                firstY = activeLastSampleY;
                previewDeepestX = firstX;
                previewDeepestY = firstY;
                previewReach = 0.0;
                var restTime = Math.Max(activeLastSampleTimeMs, timeMs - RestingOnsetGapMs);
                buffer.RestAt(new PracticePointerSample(
                    restTime, firstX, firstY - inputRegionTop));
                activeMovingRun = true;
            }

            RememberActiveSample(timeMs, x, y);
            var dx = x - firstX;
            var dy = y - firstY;
            var distance = Math.Sqrt(dx * dx + dy * dy);
            if (distance > movementThreshold)
            {
                intentionalMovement = true;
                oneContactLoaded = IsDominantPullback(dx, dy, distance);
            }
            if (!buffer.Add(sample))
            {
                CaptureCancel(timeMs);
                return false;
            }
            if (intentionalMovement) ReportLocalPreview(x, y);
            return true;
        }

        private void RebaseActiveRest(double x, double y)
        {
            firstX = x;
            firstY = y;
            previewDeepestX = x;
            previewDeepestY = y;
            previewReach = 0.0;
        }

        private void RememberActiveSample(double timeMs, double x, double y)
        {
            activeLastSampleTimeMs = timeMs;
            activeLastSampleX = x;
            activeLastSampleY = y;
        }

        private void UpdateMovement(double x, double y)
        {
            if (intentionalMovement) return;
            var dx = x - firstX;
            var dy = y - firstY;
            var distance = Math.Sqrt(dx * dx + dy * dy);
            intentionalMovement = distance > movementThreshold;
            if (intentionalMovement)
                oneContactLoaded = IsDominantPullback(dx, dy, distance);
        }

        private static bool IsDominantPullback(double dx, double dy, double distance)
        {
            return distance > 0.0 && dy > 0.0 && dy / distance >= BackwardDominance;
        }

        private void RequestLocalPreparation(double timeMs)
        {
            localPreparationActive = true;
            localPreparationRequested(timeMs);
        }

        private void ReportLocalPreview(double x, double y)
        {
            if (!localPreparationActive || !intentionalMovement) return;
            // A lateral refinement can happen while the pullback is held at
            // exactly the loaded depth. Keep that latest held point as the
            // display-only forward anchor; otherwise the stance adjustment is
            // incorrectly folded into visible shot direction after reversal.
            if (y >= previewDeepestY)
            {
                previewDeepestX = x;
                previewDeepestY = y;
            }
            var pullbackDepth = Math.Max(0.0, previewDeepestY - firstY);
            var forwardTravel = Math.Max(0.0, previewDeepestY - y);
            if (oneContactLoaded && forwardTravel > movementThreshold)
                forwardCommitted = true;
            var horizontal = forwardTravel > 0.0
                ? x - previewDeepestX
                : x - firstX;
            var preview = PracticeLocalBatPreview.FromOneContact(
                horizontal,
                pullbackDepth,
                forwardTravel,
                y - firstY,
                activeSurfaceWidth,
                activeSurfaceHeight,
                activeGestureFootwork,
                previewReach);
            previewReach = preview.Reach;
            localPreviewActive = true;
            localPreviewChanged?.Invoke(preview);
        }

        private void ResetLocalPreparation()
        {
            if (!localPreparationActive && !localPreviewActive) return;
            localPreparationActive = false;
            localPreviewActive = false;
            localPreparationCancelled();
        }

        private void OnDisable()
        {
            Clear(false);
            ResetLocalPreparation();
        }
    }
}
