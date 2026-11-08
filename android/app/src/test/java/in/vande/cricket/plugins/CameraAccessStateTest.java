package in.vande.cricket.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class CameraAccessStateTest {
    @Test
    public void keepsTheFourValuesTheStatusAnswerUses() {
        assertEquals("granted", CameraAccessState.normalize("granted"));
        assertEquals("prompt", CameraAccessState.normalize("prompt"));
        assertEquals("prompt-with-rationale", CameraAccessState.normalize("prompt-with-rationale"));
        assertEquals("denied", CameraAccessState.normalize("denied"));
    }

    @Test
    public void anythingUnexpectedIsPromptBecauseTheSystemDecidesWhetherToAsk() {
        assertEquals("prompt", CameraAccessState.normalize(null));
        assertEquals("prompt", CameraAccessState.normalize(""));
        assertEquals("prompt", CameraAccessState.normalize("GRANTED"));
        assertEquals("prompt", CameraAccessState.normalize("blocked"));
    }

    @Test
    public void goesBackToTheSystemInEveryStateExceptGranted() {
        assertFalse(CameraAccessState.needsSystemRequest(CameraAccessState.GRANTED));
        assertTrue(CameraAccessState.needsSystemRequest(CameraAccessState.PROMPT));
        assertTrue(CameraAccessState.needsSystemRequest(CameraAccessState.PROMPT_WITH_RATIONALE));
        // A remembered refusal can be stale after Android resets the permissions of an unused app, so the system is still asked.
        assertTrue(CameraAccessState.needsSystemRequest(CameraAccessState.DENIED));
    }

    @Test
    public void aPhoneWithAnyOneOfTheThreeFeatureFlagsHasACamera() {
        assertTrue(CameraAccessState.hasAnyCamera(true, false, false));
        assertTrue(CameraAccessState.hasAnyCamera(false, true, false));
        assertTrue(CameraAccessState.hasAnyCamera(false, false, true));
        assertTrue(CameraAccessState.hasAnyCamera(true, true, true));
        assertFalse(CameraAccessState.hasAnyCamera(false, false, false));
    }
}
