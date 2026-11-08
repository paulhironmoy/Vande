package in.vande.cricket.plugins;

/**
 * What the page is told about the camera permission, kept free of Android types so plain JUnit can test it.
 *
 * Capacitor already tracks four states for a permission alias (granted, prompt, prompt-with-rationale, denied) and remembers a refusal
 * that the system will not ask about again. This class only keeps the answer inside that vocabulary and holds the one policy decision:
 * when to go back to the system.
 */
final class CameraAccessState {
    static final String GRANTED = "granted";
    static final String PROMPT = "prompt";
    static final String PROMPT_WITH_RATIONALE = "prompt-with-rationale";
    static final String DENIED = "denied";

    private CameraAccessState() {}

    /**
     * Capacitor's state name for the camera alias as one of the four values. Anything else, null included, is "prompt": asking is harmless
     * because the system itself decides whether a dialog can still be shown.
     */
    static String normalize(String capacitorState) {
        if (GRANTED.equals(capacitorState)) return GRANTED;
        if (PROMPT_WITH_RATIONALE.equals(capacitorState)) return PROMPT_WITH_RATIONALE;
        if (DENIED.equals(capacitorState)) return DENIED;
        return PROMPT;
    }

    /**
     * Whether request() goes to the system. It does in every state except granted, "denied" included: a remembered refusal can be stale
     * (Android resets the permissions of an app that was left unused), and when the system really will not ask it answers at once with
     * no dialog, which Capacitor then records again. Skipping the call on the strength of a remembered refusal could lock a player out.
     */
    static boolean needsSystemRequest(String normalizedState) {
        return !GRANTED.equals(normalizedState);
    }

    /** True if the phone reports any camera. Some phones set only one of the three feature flags, so any of them counts. */
    static boolean hasAnyCamera(boolean anyFeature, boolean frontFeature, boolean backFeature) {
        return anyFeature || frontFeature || backFeature;
    }
}
