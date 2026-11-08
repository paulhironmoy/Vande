using System;
using Vande.Practice.UI.Production;

namespace Vande.Practice.Audio.Production.Outputs
{
    /// <summary>
    /// Allocation-bounded adapter from causal feedback captions to the one
    /// retained Practice HUD caption surface. The surface is prepared with the
    /// HUD and repeated cues replace one another rather than creating a queue.
    /// </summary>
    public sealed class ProductionHudCaptionOutput : IProductionCaptionOutput
    {
        private const float PhysicalCueSeconds = 1.35f;
        private const float CrowdCueSeconds = 1.6f;

        private readonly ProductionHudView hud;

        public ProductionHudCaptionOutput(ProductionHudView hudView)
        {
            hud = hudView != null
                ? hudView
                : throw new ArgumentNullException(nameof(hudView));
        }

        public void Present(ProductionCaptionCue cue)
        {
            if (cue.Id == ProductionCaptionId.None || string.IsNullOrWhiteSpace(cue.Text))
            {
                Clear();
                return;
            }

            hud.PresentCaption(
                cue.Text,
                cue.Emotion == ProductionCrowdEmotion.None
                    ? PhysicalCueSeconds
                    : CrowdCueSeconds);
        }

        public void Clear()
        {
            hud.ClearCaption();
        }
    }
}
