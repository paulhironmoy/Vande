using System;
using UnityEngine;

namespace Vande.Practice.Presentation.Production.Characters
{
    /// <summary>
    /// The bat a committed swing draws until the host's result arrives (UNITY-7 task B). The physics bat is built round the
    /// ball's ideal contact: its sweet spot meets the ball there (the golden cases, within 5 cm), the hands sit 0.737 m above it
    /// (HANDLE_L + BLADE_L x (1 - SWEET_U)) and barely move from the input to the contact (3 cm over a drive), the blade is turned
    /// back about them by 26 to 38 degrees until about 40 ms before the contact and then swings down to near vertical. The
    /// code-authored stroke the swing used to draw has its hands 0.96 m high and a path of its own, so the physics bat was 62 to
    /// 90 cm from the committed bat in the frame the result arrived. This is the same bat predicted from what the committed swing
    /// and the delivery already say (the swing's kind and power give its travel; the ball's ideal arrival at the footwork's contact
    /// plane gives the contact): the bat leaves the waiting bat as the presented bat does (the hands straight, half linear and half
    /// smoothstep over the swing's time), holds the blade turned back, and swings down in the last 40 ms.
    ///
    /// Presentation only: nothing moves before the input (the bat is the waiting bat at the swing's start), nothing is read from the
    /// result, and from the result on the physics bat takes over as it always did (the carry). It is a prediction, not the physics:
    /// a lofted shot or a miss puts the physics hands 20 to 45 cm from it.
    /// </summary>
    internal sealed class ProductionPredictedSwingBat
    {
        /// <summary>The blade swings down over this long before the arrival (the physics bat's last knots).</summary>
        public const double DownswingSeconds = 0.040;

        /// <summary>The blade is held this far back of the contact pose until the downswing (degrees; the physics 26 to 38).</summary>
        public const float HoldBackDegrees = 30f;

        /// <summary>The hands' height above the sweet spot at contact, for the canonical bat (m): HANDLE_L + BLADE_L (1 - SWEET_U).</summary>
        public const float SweetFromCapMetres = 0.7368f;

        /// <summary>The blade at contact: nearly vertical, the toe a little behind the hands (the golden contact poses lean 4 to 11 degrees).</summary>
        public static readonly Vector3 ContactDirection = new Vector3(0f, -0.99f, 0.08f).normalized;

        private ProductionTouchDownBat.Blend toContact;
        private float turnHeld;
        private double startT;
        private double holdEndT;
        private double arriveT;

        public bool Valid { get; private set; }

        /// <summary>The swing's travel from its start to the contact zone (src/physics/bat.ts batTravelMs).</summary>
        public static double TravelSeconds(string kind, double power) =>
            kind == "defend" ? 0.120 : 0.120 + 0.030 * Math.Min(1.0, Math.Max(0.0, power));

        /// <summary>
        /// The contact bat for a ball meeting the sweet spot at `aim`: the waiting bat's length and face, turned to the contact
        /// direction by the shortest way (no roll), the sweet spot on `aim`.
        /// </summary>
        public static ProductionTouchDownBat.BatPose ContactPose(ProductionTouchDownBat.BatPose waiting, Vector3 aim)
        {
            var along = waiting.Toe - waiting.Grip;
            var length = along.magnitude;
            var from = length > 1e-6f ? along / length : Vector3.down;
            var sweet = SweetFromCapMetres * (length / ProductionTouchDownBat.BatLengthMetres);
            var grip = aim - ContactDirection * sweet;
            var turn = Quaternion.FromToRotation(from, ContactDirection);
            return new ProductionTouchDownBat.BatPose
            {
                Grip = grip,
                Toe = grip + ContactDirection * length,
                Face = turn * waiting.Face
            };
        }

        /// <summary>
        /// Plans the swing: it begins at `start` from the waiting bat, and its sweet spot is at `aim` at `start + travelSeconds`.
        /// </summary>
        public void Plan(ProductionTouchDownBat.BatPose waiting, Vector3 aim, double start, double travelSeconds)
        {
            var contact = ContactPose(waiting, aim);
            toContact = new ProductionTouchDownBat.Blend(waiting, contact);
            var swing = toContact.SwingDegrees;
            turnHeld = swing > HoldBackDegrees ? 1f - HoldBackDegrees / swing : 0f;
            startT = start;
            arriveT = start + Math.Max(travelSeconds, 2.0 * DownswingSeconds);
            holdEndT = arriveT - DownswingSeconds;
            Valid = true;
        }

        public void Clear() => Valid = false;

        /// <summary>The bat at simulation time t: the waiting bat at the start, the contact bat from the arrival on.</summary>
        public ProductionTouchDownBat.BatPose At(double t)
        {
            var x = Math.Min(1.0, Math.Max(0.0, (t - startT) / (holdEndT - startT)));
            // The presented bat's easing for a far start: half linear (it moves from the first frame), half smoothstep.
            var eased = 0.5 * x + 0.5 * (x * x * (3.0 - 2.0 * x));
            double turn;
            if (t <= holdEndT) turn = turnHeld * eased;
            else
            {
                var y = Math.Min(1.0, (t - holdEndT) / DownswingSeconds);
                turn = turnHeld + (1.0 - turnHeld) * y * y;
            }
            return toContact.At(eased, turn, turn, false);
        }
    }
}
