using System;
using UnityEngine;
using Vande.Practice.Presentation;

namespace Vande.Practice.UI.Production
{
    public enum ProductionBallMarkerState
    {
        Upcoming,
        Current,
        Dot,
        Runs,
        Boundary,
        Wicket
    }

    public static class ProductionFieldPipProjection
    {
        public const float FieldRadiusMetres = 75f;

        public static Vector2 Project(double x, double z, bool leftHanded, Rect bounds)
        {
            if (!Finite(x) || !Finite(z)) throw new ArgumentOutOfRangeException(nameof(x));
            var shownX = leftHanded ? -(float)x : (float)x;
            var normalizedX = Mathf.Clamp01(0.5f + shownX / (FieldRadiusMetres * 2f));
            // The radar reads like the rear batting view: bowler's end at the top, striker at the bottom, and the
            // striker's off side on the right for a right-hander (left for a left-hander). Physics +z points to the
            // striker, so it maps downwards (HUD pixels are bottom-left origin).
            var normalizedY = Mathf.Clamp01(0.5f - (float)z / (FieldRadiusMetres * 2f));
            return new Vector2(
                bounds.xMin + normalizedX * bounds.width,
                bounds.yMin + normalizedY * bounds.height);
        }

        private static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    internal static class ProductionHudCopy
    {
        private enum Language
        {
            English,
            Hindi,
            Hinglish
        }

        public static string Outcome(int runs, string dismissal, string locale)
        {
            var language = Resolve(locale);
            if (!string.IsNullOrEmpty(dismissal))
                return language == Language.Hindi ? "आउट" : "OUT";
            if (language == Language.Hindi)
            {
                switch (runs)
                {
                    case 0: return "डॉट";
                    case 4: return "चौका";
                    case 6: return "छक्का";
                    default: return runs + " रन";
                }
            }
            if (language == Language.Hinglish)
            {
                switch (runs)
                {
                    case 0: return "DOT";
                    case 4: return "CHAUKA";
                    case 6: return "CHHAKKA";
                    default: return runs + (runs == 1 ? " RUN" : " RUNS");
                }
            }
            switch (runs)
            {
                case 0: return "DOT";
                case 4: return "FOUR";
                case 6: return "SIX";
                case 1: return "1 RUN";
                default: return runs + " RUNS";
            }
        }

        public static string TimelineLabel(ProductionBallMarkerState state, int runs)
        {
            switch (state)
            {
                case ProductionBallMarkerState.Current: return "•";
                case ProductionBallMarkerState.Dot: return "0";
                case ProductionBallMarkerState.Runs:
                case ProductionBallMarkerState.Boundary: return runs.ToString();
                case ProductionBallMarkerState.Wicket: return "W";
                default: return string.Empty;
            }
        }

        public static string SetupBrief(
            PracticeScenePresentation scene,
            string assistance,
            int? coachStage,
            string locale)
        {
            if (scene == null) return string.Empty;
            var language = Resolve(locale);
            var status = coachStage.HasValue
                ? language == Language.Hindi
                    ? "कोच · चरण " + coachStage.Value
                    : language == Language.Hinglish
                        ? "Coach · stage " + coachStage.Value
                        : "Coach · stage " + coachStage.Value
                : language == Language.Hindi ? "अभ्यास" : "Practice";
            var assist = Localize(assistance, locale);
            var pitch = Localize(scene.Conditions, locale);
            var ball = Localize(scene.BallAge, locale) + " " +
                       Localize(scene.BallColour, locale).ToLowerInvariant();
            var bowler = Localize(scene.BowlerArm, locale) + " " +
                         Localize(scene.BowlerFamily, locale).ToLowerInvariant();
            var style = string.Equals(scene.BowlerFamily, "spin", StringComparison.OrdinalIgnoreCase)
                ? Localize(scene.BowlerSpinType, locale)
                : Localize(scene.BowlerPaceBand, locale);
            if (!string.IsNullOrEmpty(style)) bowler += " · " + style;
            var field = FieldIntent(scene.FieldIntent, language);
            var objective = Objective(scene.TrainingObjective, language);

            if (language == Language.Hindi)
                return status + " · " + assist + "\n" +
                       "परिस्थिति: " + pitch + " · " + ball + "\n" +
                       "गेंदबाज़: " + bowler + "\n" +
                       "फ़ील्ड: " + field + "\n" +
                       "लक्ष्य: " + objective;
            if (language == Language.Hinglish)
                return status + " · " + assist + "\n" +
                       "Pitch: " + pitch + " · " + ball + "\n" +
                       "Bowler: " + bowler + "\n" +
                       "Field: " + field + "\n" +
                       "Maqsad: " + objective;
            return status + " · " + assist + "\n" +
                   "Conditions: " + pitch + " · " + ball + "\n" +
                   "Bowler: " + bowler + "\n" +
                   "Field: " + field + "\n" +
                   "Objective: " + objective;
        }

        public static string SetupTrigger(string locale)
        {
            switch (Resolve(locale))
            {
                case Language.Hindi: return "सेटअप";
                case Language.Hinglish: return "Setup";
                default: return "Setup";
            }
        }

        public static string SetupClose(string locale)
        {
            switch (Resolve(locale))
            {
                case Language.Hindi: return "बंद ×";
                case Language.Hinglish: return "Band ×";
                default: return "Close ×";
            }
        }

        public static string Localize(string value, string locale)
        {
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;
            var key = value.Trim().ToLowerInvariant();
            switch (Resolve(locale))
            {
                case Language.Hindi:
                    switch (key)
                    {
                        case "balanced": return "संतुलित";
                        case "green": return "हरी";
                        case "hard": return "सख्त";
                        case "turning": return "टर्निंग";
                        case "right": return "दायाँ";
                        case "left": return "बायाँ";
                        case "pace": return "पेस";
                        case "spin": return "स्पिन";
                        case "controlled": return "नियंत्रित";
                        case "fast": return "तेज़";
                        case "express": return "एक्सप्रेस";
                        case "finger": return "फिंगर स्पिन";
                        case "wrist": return "कलाई स्पिन";
                        case "new": return "नई";
                        case "worn": return "पुरानी";
                        case "white": return "सफेद";
                        case "red": return "लाल";
                        case "learn": return "सीखें";
                        case "play": return "खेलें";
                        case "real": return "रियल";
                        case "attack_outside_off": return "आक्रामक फ़ील्ड";
                        case "attack_the_stumps": return "स्टंप वाली फ़ील्ड";
                        case "short_ball_trap": return "शॉर्ट गेंद फ़ील्ड";
                        case "yorker_and_boundaries": return "डेथ फ़ील्ड";
                        case "spin_close_catchers": return "पास की फ़ील्ड";
                        case "save_singles": return "रिंग फ़ील्ड";
                        case "protect_boundaries": return "बाउंड्री फ़ील्ड";
                    }
                    break;
                case Language.Hinglish:
                    switch (key)
                    {
                        case "balanced": return "Santulit";
                        case "green": return "Hari";
                        case "hard": return "Sakht";
                        case "turning": return "Turning";
                        case "right": return "Daaya";
                        case "left": return "Baaya";
                        case "pace": return "pace";
                        case "spin": return "spin";
                        case "controlled": return "Controlled";
                        case "fast": return "Tez";
                        case "express": return "Express";
                        case "finger": return "Finger spin";
                        case "wrist": return "Wrist spin";
                        case "new": return "Nayi";
                        case "worn": return "Purani";
                        case "white": return "safed";
                        case "red": return "laal";
                        case "learn": return "Seekho";
                        case "play": return "Khelo";
                        case "real": return "Real";
                        case "attack_outside_off": return "Attacking field";
                        case "attack_the_stumps": return "Stumps field";
                        case "short_ball_trap": return "Short ball field";
                        case "yorker_and_boundaries": return "Death field";
                        case "spin_close_catchers": return "Close field";
                        case "save_singles": return "Ring field";
                        case "protect_boundaries": return "Boundary field";
                    }
                    break;
                default:
                    // The web's short field-plan labels (src/i18n/practice/en/field.ts practice.intent.short.*); every
                    // other English value reads as its humanized key.
                    switch (key)
                    {
                        case "attack_outside_off": return "Attacking field";
                        case "attack_the_stumps": return "Stumps field";
                        case "short_ball_trap": return "Short-ball field";
                        case "yorker_and_boundaries": return "Death field";
                        case "spin_close_catchers": return "Close field";
                        case "save_singles": return "Ring field";
                        case "protect_boundaries": return "Boundary field";
                    }
                    break;
            }
            return HumanizeEnglish(value);
        }

        private static string FieldIntent(string value, Language language)
        {
            return Localize(
                string.IsNullOrWhiteSpace(value) ? "field" : value,
                language == Language.Hindi ? "hi" : language == Language.Hinglish ? "hi-Latn" : "en-IN");
        }

        private static string Objective(string value, Language language)
        {
            switch (value)
            {
                case "reference":
                    return language == Language.Hindi
                        ? "छह मानक गेंदों को पढ़ें"
                        : language == Language.Hinglish
                            ? "Chhah reference balls ko padhein"
                            : "Read six reference balls";
                case "built":
                    return language == Language.Hindi
                        ? "अपनी तय की हुई ओवर का अभ्यास करें"
                        : language == Language.Hinglish
                            ? "Apni banayi over practice karein"
                            : "Practice your planned over";
                case "random":
                    return language == Language.Hindi
                        ? "अनजान ओवर को गेंद-दर-गेंद पढ़ें"
                        : language == Language.Hinglish
                            ? "Anjaan over ko ball-by-ball padhein"
                            : "Read an unknown over ball by ball";
                default:
                    return string.Empty;
            }
        }

        private static string HumanizeEnglish(string value)
        {
            var normalized = value.Trim().Replace('_', ' ').Replace('-', ' ');
            var words = normalized.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            for (var index = 0; index < words.Length; index++)
            {
                var word = words[index];
                words[index] = word.Length == 1
                    ? word.ToUpperInvariant()
                    : char.ToUpperInvariant(word[0]) + word.Substring(1).ToLowerInvariant();
            }
            return string.Join(" ", words);
        }

        private static Language Resolve(string locale)
        {
            if (string.IsNullOrWhiteSpace(locale)) return Language.English;
            if (locale.StartsWith("hi-Latn", StringComparison.OrdinalIgnoreCase)) return Language.Hinglish;
            if (locale.StartsWith("hi", StringComparison.OrdinalIgnoreCase)) return Language.Hindi;
            return Language.English;
        }

    }
}
