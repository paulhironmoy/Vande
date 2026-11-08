using System;

namespace Vande.Practice.Presentation
{
    public readonly struct PracticePresentationProfile
    {
        public PracticePresentationProfile(
            PracticePresentationQuality quality,
            int crowdCount,
            int fielderDetail,
            bool realtimeShadows,
            bool postContactCameraFollow)
        {
            Quality = quality;
            CrowdCount = crowdCount;
            FielderDetail = fielderDetail;
            RealtimeShadows = realtimeShadows;
            PostContactCameraFollow = postContactCameraFollow;
        }

        public PracticePresentationQuality Quality { get; }
        public int CrowdCount { get; }
        public int FielderDetail { get; }
        public bool RealtimeShadows { get; }
        public bool PostContactCameraFollow { get; }

        public static PracticePresentationProfile For(
            PracticePresentationQuality quality,
            bool reducedMotion)
        {
            switch (quality)
            {
                case PracticePresentationQuality.Lite:
                    return new PracticePresentationProfile(quality, 24, 0, false, false);
                case PracticePresentationQuality.Standard:
                    return new PracticePresentationProfile(quality, 48, 1, true, !reducedMotion);
                case PracticePresentationQuality.High:
                    return new PracticePresentationProfile(quality, 72, 2, true, !reducedMotion);
                default:
                    throw new ArgumentOutOfRangeException(nameof(quality));
            }
        }
    }
}
