package in.vande.cricket.plugins;

import android.app.Activity;
import android.graphics.Rect;
import android.view.View;
import androidx.core.view.ViewCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Keeps the system's inward "Back" swipe from stealing a batting stroke (request CONTROLS-3, DoD CTR-05). While a ball is being
 * played the page calls setBattingExclusion({ active: true, heightFraction }); the two side edges of the lower part of the screen
 * are then left to the app (View.setSystemGestureExclusionRects, API 29 and later; a no-op before). The rectangles go on the
 * activity's decor view, which covers the WebView and the Unity overlay alike, and are recomputed on every layout and rotation,
 * cleared while the activity is paused and applied again on resume. Everywhere else, at the dead ball, in menus and settings, Back
 * works as usual. It touches no camera, no frame and no storage. The home gesture at the bottom edge cannot be excluded by any app.
 */
@CapacitorPlugin(name = "VandeSystemGestures")
public class SystemGesturesPlugin extends Plugin {
    private final View.OnLayoutChangeListener onLayout =
        (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> apply();

    // Touched on the UI thread only.
    private boolean active;
    private boolean paused;
    private double heightFraction = 0.46;
    private View decor;
    private List<Rect> applied = Collections.emptyList();

    /** {active: boolean, heightFraction: number}. An active call with a fraction outside 0.2 to 1 is ignored. */
    @PluginMethod
    public void setBattingExclusion(PluginCall call) {
        Boolean wantActive = call.getBoolean("active");
        if (wantActive == null) {
            call.reject("active is required");
            return;
        }
        Double fraction = call.getDouble("heightFraction");
        if (wantActive && (fraction == null || !BattingExclusion.validHeightFraction(fraction))) {
            call.resolve();
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            active = wantActive;
            if (wantActive) heightFraction = fraction;
            apply();
            call.resolve();
        });
    }

    @Override
    protected void handleOnPause() {
        paused = true;
        apply();
    }

    @Override
    protected void handleOnResume() {
        paused = false;
        apply();
    }

    @Override
    protected void handleOnDestroy() {
        active = false;
        apply();
        if (decor != null) decor.removeOnLayoutChangeListener(onLayout);
        decor = null;
    }

    private void apply() {
        Activity activity = getActivity();
        if (activity == null) return;
        View view = activity.getWindow().getDecorView();
        if (view != decor) {
            if (decor != null) decor.removeOnLayoutChangeListener(onLayout);
            decor = view;
            decor.addOnLayoutChangeListener(onLayout);
            applied = Collections.emptyList();
        }
        List<Rect> rects = new ArrayList<>();
        if (active && !paused) {
            float density = activity.getResources().getDisplayMetrics().density;
            for (int[] box : BattingExclusion.rectangles(decor.getWidth(), decor.getHeight(), density, heightFraction)) {
                rects.add(new Rect(box[0], box[1], box[2], box[3]));
            }
        }
        if (rects.equals(applied)) return;
        ViewCompat.setSystemGestureExclusionRects(decor, rects);
        applied = rects;
    }
}
