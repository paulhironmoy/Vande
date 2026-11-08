using System;
using UnityEngine;

namespace Vande.Practice.UI.Production
{
    /// <summary>
    /// Immutable pixel-space layout for the live Practice overlay. Unity screen
    /// coordinates are used (origin at the bottom-left) so the same rectangles
    /// drive rendering, hit testing and deterministic EditMode assertions.
    /// </summary>
    public sealed class ProductionHudLayoutSnapshot
    {
        internal ProductionHudLayoutSnapshot(
            Rect safeArea,
            float dpScale,
            float touchDpScale,
            Rect score,
            Rect timeline,
            Rect conditions,
            Rect caption,
            Rect fieldPip,
            Rect pause,
            Rect setupBriefTarget,
            Rect setupBriefSurface,
            Rect setupBriefCopy,
            Rect setupBriefClose,
            Rect outcome,
            Rect deadBallSurface,
            Rect deadBallOutcome,
            Rect deadBallReason,
            Rect deadBallRecommendation,
            Rect deadBallPrimaryAction,
            Rect deadBallPrimaryActionWithSecondary,
            Rect deadBallSecondaryAction,
            bool deadBallActionsStacked)
        {
            SafeArea = safeArea;
            DpScale = dpScale;
            TouchDpScale = touchDpScale;
            Score = score;
            Timeline = timeline;
            Conditions = conditions;
            Caption = caption;
            FieldPip = fieldPip;
            Pause = pause;
            SetupBriefTarget = setupBriefTarget;
            SetupBriefSurface = setupBriefSurface;
            SetupBriefCopy = setupBriefCopy;
            SetupBriefClose = setupBriefClose;
            Outcome = outcome;
            DeadBallSurface = deadBallSurface;
            DeadBallOutcome = deadBallOutcome;
            DeadBallReason = deadBallReason;
            DeadBallRecommendation = deadBallRecommendation;
            DeadBallPrimaryAction = deadBallPrimaryAction;
            DeadBallPrimaryActionWithSecondary = deadBallPrimaryActionWithSecondary;
            DeadBallSecondaryAction = deadBallSecondaryAction;
            DeadBallActionsStacked = deadBallActionsStacked;
        }

        public Rect SafeArea { get; }
        /// <summary>
        /// Visual density after the complete peripheral rail has been fitted to
        /// the viewport. This may be smaller than the device density on short
        /// screens and must not be used to size an interactive target.
        /// </summary>
        public float DpScale { get; }
        /// <summary>
        /// Uncapped device-density scale used by the pause hit target. Keeping
        /// it separate prevents rail fitting from silently shrinking 48 dp.
        /// </summary>
        public float TouchDpScale { get; }
        public Rect Score { get; }
        public Rect Timeline { get; }
        public Rect Conditions { get; }
        public Rect Caption { get; }
        public Rect FieldPip { get; }
        /// <summary>The compact one-line conditions indicator shown during Delivery Quiet Mode.</summary>
        public Rect ConditionsQuiet { get; internal set; }

        /// <summary>
        /// Fraction of the screen the live (Delivery Quiet Mode) rail covers: score, compact conditions, field radar
        /// and pause. M5 budget: at most 0.08 at 100% text.
        /// </summary>
        public float LiveQuietRailCoverage(int pixelWidth, int pixelHeight)
        {
            if (pixelWidth <= 0 || pixelHeight <= 0) throw new ArgumentOutOfRangeException(nameof(pixelWidth));
            var area = Score.width * Score.height + ConditionsQuiet.width * ConditionsQuiet.height +
                       FieldPip.width * FieldPip.height + Pause.width * Pause.height;
            return area / (pixelWidth * (float)pixelHeight);
        }
        public Rect Pause { get; }
        /// <summary>Density-correct hit target on the conditions capsule, available only between balls.</summary>
        public Rect SetupBriefTarget { get; }
        /// <summary>Temporary complete-setup disclosure shown only in safe non-delivery phases.</summary>
        public Rect SetupBriefSurface { get; }
        public Rect SetupBriefCopy { get; }
        public Rect SetupBriefClose { get; }
        /// <summary>Compact acknowledgement used when no coaching copy exists.</summary>
        public Rect Outcome { get; }
        /// <summary>Bounded dead-ball coaching surface; never used during a delivery.</summary>
        public Rect DeadBallSurface { get; }
        public Rect DeadBallOutcome { get; }
        public Rect DeadBallReason { get; }
        public Rect DeadBallRecommendation { get; }
        /// <summary>Full-width primary target used when there is no secondary action.</summary>
        public Rect DeadBallPrimaryAction { get; }
        /// <summary>Dominant primary target used beside an optional quiet secondary.</summary>
        public Rect DeadBallPrimaryActionWithSecondary { get; }
        public Rect DeadBallSecondaryAction { get; }
        public bool DeadBallActionsStacked { get; }
    }

    public static class ProductionHudLayout
    {
        public const float PauseTargetDp = 48f;
        public const float ReferenceScoreWidth = 126f;
        public const float ReferenceScoreHeight = 46f;
        public const float ReferenceConditionsWidth = 146f;
        public const float ReferenceConditionsHeight = 28f;
        public const float ReferenceFieldPipSize = 84f;
        /// <summary>Maximum live Delivery Quiet Mode occupancy at 100% text (product decision 2026-11-04).</summary>
        public const float LiveQuietMaximumOccupancy = 0.08f;
        /// <summary>The conditions copy's font size (dp at 100% text) and its two explicit lines.</summary>
        public const float ConditionsFontDp = 10.5f;
        /// <summary>
        /// Line height per em of the HUD's licensed fonts, the larger of Manrope (122.94/90) and Noto Sans Devanagari
        /// (about 1.476). The conditions rail holds its two lines at the requested size; the TextMesh-era 28 dp rail
        /// did not once measured with UI Toolkit shaping (Hindi fell to 7.9 px; wedge phase 3).
        /// </summary>
        public const float ConditionsLineHeightEm = 1.48f;

        private static float ConditionsHeightDp(float scale)
        {
            return Mathf.Max(ReferenceConditionsHeight, 2f * ConditionsLineHeightEm * ConditionsFontDp * scale + 6f);
        }
        private const float ReferenceDpi = 160f;

        public static float PixelsPerDp(float dpi)
        {
            if (float.IsNaN(dpi) || float.IsInfinity(dpi) || dpi <= 0f) return 1f;
            // WebGL commonly reports 96 dpi even though its interaction unit is
            // a CSS pixel. Never make the 48 dp floor smaller than 48 pixels.
            return Mathf.Clamp(dpi / ReferenceDpi, 1f, 4f);
        }

        public static ProductionHudLayoutSnapshot Calculate(
            int pixelWidth,
            int pixelHeight,
            Rect reportedSafeArea,
            float dpi,
            float textScale,
            float? authoritativePixelsPerDp = null)
        {
            if (pixelWidth <= 0) throw new ArgumentOutOfRangeException(nameof(pixelWidth));
            if (pixelHeight <= 0) throw new ArgumentOutOfRangeException(nameof(pixelHeight));

            var safe = ClampSafeArea(reportedSafeArea, pixelWidth, pixelHeight);
            var scale = Mathf.Clamp(textScale, 1f, 2f);
            var touchDp = authoritativePixelsPerDp.HasValue
                ? Mathf.Clamp(authoritativePixelsPerDp.Value, 1f, 8f)
                : PixelsPerDp(dpi);
            // Desktop browsers often report no DPI, which made the HUD tiny at
            // 1080p, while a high-DPI value on a short viewport could make the
            // mandatory rail overlap itself. Grow gently with the viewport and
            // cap against the complete score/conditions/caption stack.
            var desiredDp = Mathf.Max(touchDp, VisualScale(safe));
            // Include both the top and bottom safe-area margins. Without the
            // second margin, clamping the final caption rail upward could make
            // it overlap the conditions rail on a short, high-density screen.
            // Score and six-ball progress are one compact information capsule
            // in the frozen Gate-A composition. Only the conditions and the
            // reserved caption surface consume additional vertical rail space.
            var requiredHeightDp = 20f +
                Mathf.Max(ReferenceScoreHeight, 38f * scale) + 6f +
                Mathf.Max(ReferenceConditionsHeight, 26f * scale) + 6f +
                Mathf.Max(36f, 36f * scale);
            var dp = Mathf.Min(desiredDp, safe.height / requiredHeightDp);
            dp = Mathf.Max(1f, dp);
            var margin = Mathf.Max(10f, 10f * dp);
            var gap = Mathf.Max(6f, 6f * dp);
            var pauseSize = PauseTargetDp * touchDp;

            // The locked 844x390 direction uses one 84px field radar in the
            // upper-right and the 48dp pause target immediately below it. The
            // old wide oval plus a top pause disc read as two competing radars.
            var maximumPipSize = Mathf.Max(
                ReferenceFieldPipSize,
                Mathf.Min(168f, safe.height * 0.26f));
            var pipSize = Mathf.Clamp(
                ReferenceFieldPipSize * dp,
                ReferenceFieldPipSize,
                maximumPipSize);
            var fieldPip = new Rect(
                safe.xMax - margin - pipSize,
                safe.yMax - margin - pipSize,
                pipSize,
                pipSize);
            var pause = new Rect(
                fieldPip.xMax - pauseSize,
                fieldPip.yMin - gap - pauseSize,
                pauseSize,
                pauseSize);

            var availableLeftWidth = Mathf.Max(1f, fieldPip.xMin - safe.xMin - margin - gap);
            var scoreWidth = Mathf.Min(
                availableLeftWidth,
                Mathf.Clamp(
                    ReferenceScoreWidth * dp * Mathf.Lerp(1f, 1.35f, scale - 1f),
                    ReferenceScoreWidth,
                    252f * dp));
            var scoreHeight = Mathf.Max(
                ReferenceScoreHeight * dp,
                38f * dp * scale);
            var score = new Rect(
                safe.xMin + margin,
                safe.yMax - margin - scoreHeight,
                scoreWidth,
                scoreHeight);

            // This is an internal lane, not a second panel. Retaining a named
            // rectangle keeps marker geometry and accessibility evidence
            // deterministic while matching the frozen score-card hierarchy.
            var timelineInset = Mathf.Min(10f * dp, score.width * 0.10f);
            var timelineHeight = Mathf.Min(
                score.height * 0.27f,
                Mathf.Max(10f * dp, 7f * dp * scale));
            var timelineWidth = Mathf.Min(
                Mathf.Max(1f, score.width - timelineInset * 2f),
                72f * dp * Mathf.Lerp(1f, 1.25f, scale - 1f));
            var timeline = new Rect(
                score.xMin + timelineInset,
                score.yMin + Mathf.Min(3f * dp, score.height * 0.08f),
                timelineWidth,
                timelineHeight);

            // The rail grows to hold its two lines at the requested size where the safe height has room for the
            // whole stack (score, conditions, caption); the visual scale budget above is unchanged, so touch targets
            // never shrink for it. On a screen too short for that, the copy is fitted to the smaller rail instead.
            var minimumConditionsHeight = Mathf.Max(ReferenceConditionsHeight * dp, 26f * dp * scale);
            var roomForConditions = scoreHeight > 0f
                ? safe.yMax - margin - scoreHeight - gap - (safe.yMin + margin) -
                  Mathf.Max(36f * dp, 36f * dp * scale) - gap -
                  Mathf.Max(0f, PauseTargetDp * touchDp - minimumConditionsHeight) * 0.5f
                : minimumConditionsHeight;
            var conditionsHeight = Mathf.Max(
                minimumConditionsHeight,
                Mathf.Min(ConditionsHeightDp(scale) * dp, roomForConditions));
            var conditionsWidthLimit = Mathf.Max(1f, availableLeftWidth);
            var conditionsWidth = Mathf.Min(
                conditionsWidthLimit,
                Mathf.Clamp(
                    ReferenceConditionsWidth * dp * Mathf.Lerp(1f, 1.35f, scale - 1f),
                    ReferenceConditionsWidth,
                    360f * dp));
            var conditions = new Rect(
                safe.xMin + margin,
                Mathf.Max(safe.yMin + margin,
                    score.yMin - gap - conditionsHeight),
                conditionsWidth,
                conditionsHeight);

            // Causal audio captions are part of accessibility, but must not
            // become a centre-screen modal during a delivery. Reserve the next
            // segment of the same left peripheral rail instead.
            var captionHeight = Mathf.Max(36f * dp, 36f * dp * scale);

            var setupTargetWidth = Mathf.Max(conditions.width, pauseSize);
            var setupTargetHeight = pauseSize;
            var setupTargetY = Mathf.Clamp(
                conditions.center.y - setupTargetHeight * 0.5f,
                safe.yMin,
                Mathf.Max(safe.yMin, safe.yMax - setupTargetHeight));
            var setupBriefTarget = new Rect(
                conditions.xMin,
                setupTargetY,
                Mathf.Min(setupTargetWidth, safe.xMax - conditions.xMin),
                Mathf.Min(setupTargetHeight, safe.height));

            // The caption keeps the setup target usable while it shows (a caption never removes a control): it sits
            // below the target's 48dp hit area, not merely below the conditions panel. Where the safe area is too
            // short for that, it moves beside the target instead of under it.
            var captionTop = Mathf.Min(conditions.yMin, setupBriefTarget.yMin) - gap;
            var caption = new Rect(
                conditions.xMin,
                Mathf.Max(safe.yMin + margin, captionTop - captionHeight),
                conditions.width,
                captionHeight);
            if (caption.Overlaps(setupBriefTarget))
            {
                var besideX = setupBriefTarget.xMax + gap;
                var besideWidth = Mathf.Max(1f, Mathf.Min(conditions.width, pause.xMin - gap - besideX));
                caption = new Rect(
                    besideX,
                    Mathf.Max(safe.yMin + margin, conditions.yMin - gap - captionHeight),
                    besideWidth,
                    captionHeight);
            }

            var setupWidth = Mathf.Min(
                Mathf.Max(1f, safe.width - margin * 2f),
                Mathf.Max(520f * dp, pauseSize + 32f * dp));
            var setupHeight = Mathf.Min(
                Mathf.Max(1f, safe.height - margin * 2f),
                Mathf.Max(260f * dp, pauseSize + 120f * dp));
            var setupBriefSurface = new Rect(
                safe.center.x - setupWidth * 0.5f,
                safe.center.y - setupHeight * 0.5f,
                setupWidth,
                setupHeight);
            var setupPadding = Mathf.Min(18f * dp, setupBriefSurface.width * 0.06f);
            var setupBriefClose = new Rect(
                setupBriefSurface.xMax - setupPadding - pauseSize,
                setupBriefSurface.yMax - setupPadding - pauseSize,
                pauseSize,
                pauseSize);
            // Keep the five-line brief at its accessible type size by using a
            // full-height copy column beside the density-correct close target.
            // Reserving the complete top row for Close made Hindi at 200% fit
            // into less than half the surface height on 640 x 360 devices.
            var setupCopyGap = Mathf.Max(6f, 8f * dp);
            var setupCopyRight = Mathf.Max(
                setupBriefSurface.xMin + setupPadding + 1f,
                setupBriefClose.xMin - setupCopyGap);
            var setupBriefCopy = new Rect(
                setupBriefSurface.xMin + setupPadding,
                setupBriefSurface.yMin + setupPadding,
                Mathf.Max(1f, setupCopyRight - setupBriefSurface.xMin - setupPadding),
                Mathf.Max(1f, setupBriefSurface.height - setupPadding * 2f));

            // Dead-ball acknowledgement stays in a quiet lower-left lane.
            // Keeping its right edge left of the viewport centre protects the
            // delivery corridor and the embodied batter.
            var peripheralLaneWidth = Mathf.Max(1f, safe.width * 0.44f - margin);
            var bottomCorridorLimit = Mathf.Max(1f, safe.height * 0.22f - margin);
            var outcomeWidth = Mathf.Min(190f * dp, peripheralLaneWidth);
            var outcomeHeight = Mathf.Min(
                bottomCorridorLimit,
                Mathf.Max(54f * dp, 42f * dp * scale));
            var outcome = new Rect(
                safe.xMin + margin,
                safe.yMin + margin,
                outcomeWidth,
                outcomeHeight);

            // The durable coaching hierarchy appears only after dead ball, so
            // it may use more of the lower-left lane without competing with
            // release, bounce or contact. One shared 48 dp action row keeps an
            // optional secondary target accessible even on short high-DPI
            // screens while the filled primary remains visually dominant.
            var baseDeadBallWidth = Mathf.Min(
                peripheralLaneWidth,
                Mathf.Clamp(
                    286f * dp * Mathf.Lerp(1f, 1.18f, scale - 1f),
                    252f,
                    420f * dp));
            var minimumActionPixels = PauseTargetDp * touchDp;
            // The quiet secondary receives 36% of a horizontal pair. Expand
            // the dead-ball-only surface beyond the live peripheral lane when
            // necessary so that density-correct targets are not silently
            // reduced on small high-DPI Android screens.
            var provisionalGap = Mathf.Max(4f, 6f * dp);
            var provisionalPadding = 14f * dp;
            var minimumHorizontalWidth = minimumActionPixels / 0.36f +
                                         provisionalGap + provisionalPadding * 2f;
            var deadBallWidth = Mathf.Min(
                Mathf.Max(1f, safe.width - margin * 2f),
                Mathf.Max(baseDeadBallWidth, minimumHorizontalWidth));
            var deadBallPadding = Mathf.Min(14f * dp, deadBallWidth * 0.06f);
            var deadBallGap = Mathf.Max(4f, 6f * dp);
            var actionGap = Mathf.Max(7f, 8f * dp);
            // At 200% text a translated action may wrap to two lines. Grow the
            // dead-ball-only target instead of auto-sizing its label downward;
            // the 48 dp interaction floor remains independently authoritative.
            var actionHeight = Mathf.Max(
                minimumActionPixels,
                36f * dp * scale);
            var actionWidth = Mathf.Max(1f, deadBallWidth - deadBallPadding * 2f);
            var splitGap = Mathf.Min(deadBallGap, actionWidth * 0.08f);
            var splitWidth = Mathf.Max(1f, actionWidth - splitGap);
            var deadBallActionsStacked = splitWidth * 0.64f < minimumActionPixels ||
                                         splitWidth * 0.36f < minimumActionPixels;
            // One line of the dead-ball result at its requested 22 dp size in either licensed font (wedge phase 3).
            var desiredOutcomeHeight = Mathf.Max(28f * dp, ConditionsLineHeightEm * 22f * dp * scale);
            var desiredReasonHeight = Mathf.Max(24f * dp, 20f * dp * scale);
            var desiredRecommendationHeight = Mathf.Max(30f * dp, 24f * dp * scale);
            var actionRegionHeight = actionHeight +
                                     (deadBallActionsStacked ? actionHeight + splitGap : 0f);
            var desiredDeadBallHeight = deadBallPadding * 2f + actionRegionHeight + actionGap +
                                        deadBallGap * 2f + desiredOutcomeHeight +
                                        desiredReasonHeight + desiredRecommendationHeight;
            var deadBallHeight = Mathf.Min(
                desiredDeadBallHeight,
                Mathf.Max(1f, safe.height - margin * 2f));
            var deadBallSurface = new Rect(
                safe.xMin + margin,
                safe.yMin + margin,
                deadBallWidth,
                deadBallHeight);

            var boundedActionHeight = Mathf.Min(
                actionHeight,
                Mathf.Max(1f,
                    (deadBallSurface.height - deadBallPadding * 2f -
                     (deadBallActionsStacked ? splitGap : 0f)) /
                    (deadBallActionsStacked ? 2f : 1f)));
            var deadBallPrimaryAction = new Rect(
                deadBallSurface.xMin + deadBallPadding,
                deadBallSurface.yMin + deadBallPadding,
                actionWidth,
                boundedActionHeight);
            Rect deadBallPrimaryActionWithSecondary;
            Rect deadBallSecondaryAction;
            if (deadBallActionsStacked)
            {
                deadBallSecondaryAction = deadBallPrimaryAction;
                deadBallPrimaryActionWithSecondary = new Rect(
                    deadBallPrimaryAction.xMin,
                    deadBallSecondaryAction.yMax + splitGap,
                    actionWidth,
                    boundedActionHeight);
            }
            else
            {
                var primarySplitWidth = splitWidth * 0.64f;
                deadBallPrimaryActionWithSecondary = new Rect(
                    deadBallPrimaryAction.xMin,
                    deadBallPrimaryAction.yMin,
                    primarySplitWidth,
                    deadBallPrimaryAction.height);
                deadBallSecondaryAction = new Rect(
                    deadBallPrimaryActionWithSecondary.xMax + splitGap,
                    deadBallPrimaryAction.yMin,
                    Mathf.Max(1f, splitWidth - primarySplitWidth),
                    deadBallPrimaryAction.height);
            }

            var actionTop = deadBallActionsStacked
                ? deadBallPrimaryActionWithSecondary.yMax
                : deadBallPrimaryAction.yMax;
            var copyBottom = actionTop + actionGap;
            var copyTop = deadBallSurface.yMax - deadBallPadding;
            var copyHeight = Mathf.Max(3f, copyTop - copyBottom - deadBallGap * 2f);
            // The result line keeps its height first (it does not scroll); the reason and recommendation scroll, so
            // they take what is left.
            var outcomeHeaderHeight = Mathf.Max(1f, Mathf.Min(desiredOutcomeHeight, copyHeight * 0.5f));
            var copyScale = Mathf.Min(1f, Mathf.Max(0f, copyHeight - outcomeHeaderHeight) /
                                          (desiredReasonHeight + desiredRecommendationHeight));
            var recommendationHeight = Mathf.Max(1f, desiredRecommendationHeight * copyScale);
            var reasonHeight = Mathf.Max(1f, desiredReasonHeight * copyScale);
            var copyX = deadBallSurface.xMin + deadBallPadding;
            var copyWidth = Mathf.Max(1f, deadBallSurface.width - deadBallPadding * 2f);
            var deadBallRecommendation = new Rect(
                copyX,
                copyBottom,
                copyWidth,
                recommendationHeight);
            var deadBallReason = new Rect(
                copyX,
                deadBallRecommendation.yMax + deadBallGap,
                copyWidth,
                reasonHeight);
            var deadBallOutcome = new Rect(
                copyX,
                deadBallReason.yMax + deadBallGap,
                copyWidth,
                outcomeHeaderHeight);

            // Delivery Quiet Mode keeps a compact conditions indicator (interface constitution section 4): one line
            // of the rail, held at the top edge so it stays docked under the score. Keep the frozen 28 dp visual
            // floor: the earlier half-height floor produced a 21.54 px capsule at the 844x390 reference viewport,
            // contradicting the exact-screen contract even though the aggregate rail remained below the 8% budget.
            // Accessibility may grow this floor; the full two-line rail still bounds it above.
            var quietConditionsHeight = Mathf.Min(
                conditions.height,
                Mathf.Max(ReferenceConditionsHeight * dp, (ConditionsLineHeightEm * ConditionsFontDp * scale + 6f) * dp));

            // Preserve the exact 84 px PIP at the frozen 844x390/160 dpi viewport, but responsively reduce a larger
            // density-scaled inset when it alone would push the live rail over the 8% ceiling. Interactive targets
            // never shrink. If even the 84 px visual floor cannot fit, ProductionHudView hides the inset during the
            // delivery as required by the product decision. Flooring prevents floating-point rounding above 8%.
            var fixedQuietArea = score.width * score.height +
                                 conditions.width * quietConditionsHeight +
                                 pause.width * pause.height;
            var maximumPipArea = pixelWidth * (float)pixelHeight * LiveQuietMaximumOccupancy - fixedQuietArea;
            var budgetPipSize = maximumPipArea > 0f
                ? Mathf.Floor(Mathf.Sqrt(maximumPipArea) * 100f) / 100f
                : 0f;
            if (pipSize > budgetPipSize && budgetPipSize >= ReferenceFieldPipSize)
            {
                pipSize = budgetPipSize;
                fieldPip = new Rect(
                    safe.xMax - margin - pipSize,
                    safe.yMax - margin - pipSize,
                    pipSize,
                    pipSize);
                pause = new Rect(
                    fieldPip.xMax - pauseSize,
                    fieldPip.yMin - gap - pauseSize,
                    pauseSize,
                    pauseSize);
            }
            var conditionsQuiet = new Rect(
                conditions.xMin,
                conditions.yMax - quietConditionsHeight,
                conditions.width,
                quietConditionsHeight);

            return new ProductionHudLayoutSnapshot(
                safe, dp, touchDp, score, timeline, conditions, caption, fieldPip, pause,
                setupBriefTarget, setupBriefSurface, setupBriefCopy, setupBriefClose,
                outcome, deadBallSurface, deadBallOutcome, deadBallReason,
                deadBallRecommendation, deadBallPrimaryAction,
                deadBallPrimaryActionWithSecondary, deadBallSecondaryAction,
                deadBallActionsStacked)
            {
                ConditionsQuiet = conditionsQuiet
            };
        }

        private static float VisualScale(Rect safeArea)
        {
            var widthScale = safeArea.width / 844f;
            var heightScale = safeArea.height / 390f;
            var fit = Mathf.Sqrt(Mathf.Max(0f, Mathf.Min(widthScale, heightScale)));
            return Mathf.Clamp(fit, 1f, 1.5f);
        }

        private static Rect ClampSafeArea(Rect value, int width, int height)
        {
            if (!Finite(value.xMin) || !Finite(value.yMin) ||
                !Finite(value.width) || !Finite(value.height) ||
                value.width <= 0f || value.height <= 0f)
            {
                return new Rect(0f, 0f, width, height);
            }

            var xMin = Mathf.Clamp(value.xMin, 0f, width);
            var yMin = Mathf.Clamp(value.yMin, 0f, height);
            var xMax = Mathf.Clamp(value.xMax, xMin, width);
            var yMax = Mathf.Clamp(value.yMax, yMin, height);
            if (xMax - xMin < 1f || yMax - yMin < 1f)
                return new Rect(0f, 0f, width, height);
            return Rect.MinMaxRect(xMin, yMin, xMax, yMax);
        }

        private static bool Finite(float value)
        {
            return !float.IsNaN(value) && !float.IsInfinity(value);
        }
    }
}
