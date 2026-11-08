package in.vande.cricket;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import android.graphics.Rect;
import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class MainActivityViewportInstrumentedTest {

    @Test
    public void webViewFillsWindowWhileSystemBarsRemainTransient() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();

            scenario.onActivity(activity -> {
                Window window = activity.getWindow();
                assertEquals(
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES,
                    window.getAttributes().layoutInDisplayCutoutMode
                );

                WebView webView = activity.getBridge().getWebView();
                assertNotNull(webView);
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(window.getDecorView());
                assertNotNull(insets);
                assertFalse(insets.isVisible(WindowInsetsCompat.Type.statusBars()));
                assertFalse(insets.isVisible(WindowInsetsCompat.Type.navigationBars()));

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    Rect bounds = activity.getWindowManager().getCurrentWindowMetrics().getBounds();
                    View content = activity.findViewById(android.R.id.content);
                    assertEquals(bounds.width(), content.getWidth());
                    assertEquals(bounds.height(), content.getHeight());
                    assertEquals(bounds.width(), webView.getWidth());
                    assertEquals(bounds.height(), webView.getHeight());
                }
            });
        }
    }
}
