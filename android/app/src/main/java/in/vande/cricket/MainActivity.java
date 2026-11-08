package in.vande.cricket;

import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import in.vande.cricket.plugins.CameraAccessPlugin;
import in.vande.cricket.plugins.GateAEvidencePlugin;
import in.vande.cricket.plugins.GoogleSignInPlugin;
import in.vande.cricket.plugins.InstallReferrerPlugin;
import in.vande.cricket.plugins.SecureStoragePlugin;
import in.vande.cricket.plugins.SystemGesturesPlugin;
import in.vande.cricket.plugins.UnityPracticePlugin;
import in.vande.cricket.unity.UnityPracticeHost;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(InstallReferrerPlugin.class);
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(GoogleSignInPlugin.class);
        registerPlugin(UnityPracticePlugin.class);
        registerPlugin(GateAEvidencePlugin.class);
        registerPlugin(CameraAccessPlugin.class);
        registerPlugin(SystemGesturesPlugin.class);
        super.onCreate(savedInstanceState);
        configureFullDisplayViewport();
        preserveWebViewSafeAreaInsets();
        enterImmersiveMode();
    }

    /**
     * Keep both Capacitor's WebView and the full-screen Unity overlay laid out against the complete display bounds.
     * System bars and cutouts remain represented as insets rather than shrinking the host from 844 px to 796 px.
     */
    private void configureFullDisplayViewport() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // VANDE's supported floor is API 28, where SHORT_EDGES is available. Android 15+ interprets this as ALWAYS
        // for a non-floating window; critical Web/Unity controls still consume their safe-area/cutout insets.
        WindowManager.LayoutParams attributes = window.getAttributes();
        attributes.layoutInDisplayCutoutMode =
            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        window.setAttributes(attributes);
    }

    /**
     * Do not consume or replace the platform insets that Chromium forwards to viewport-fit=cover safe-area CSS.
     * The WebView fills the window; its player-facing controls remain responsible for the supplied safe area.
     */
    private void preserveWebViewSafeAreaInsets() {
        if (getBridge() == null) return;
        WebView webView = getBridge().getWebView();
        if (webView == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, insets) -> insets);
        ViewCompat.requestApplyInsets(webView);
    }

    /** Hide bars without reserving their former navigation inset; an edge swipe reveals transient overlay bars. */
    private void enterImmersiveMode() {
        Window window = getWindow();
        View decorView = window.getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, decorView);
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        controller.hide(WindowInsetsCompat.Type.systemBars());
        ViewCompat.requestApplyInsets(decorView);
    }

    @Override
    public void onStart() {
        super.onStart();
        UnityPracticeHost.onHostStart();
    }

    @Override
    public void onResume() {
        super.onResume();
        UnityPracticeHost.onHostResume();
        enterImmersiveMode();
    }

    @Override
    public void onPause() {
        // Mark the host paused before Capacitor dispatches its JavaScript app-state event so host.pause can be
        // operation-scoped and ACKed before Unity receives the native onPause callback.
        UnityPracticeHost.onHostPause();
        super.onPause();
    }

    @Override
    public void onStop() {
        super.onStop();
        UnityPracticeHost.onHostStop();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        UnityPracticeHost.onWindowFocusChanged(hasFocus);
        // Unity can receive its first focus callback after the Activity's original callback. Apply last so either
        // renderer keeps a full-size content root while focused, without changing Android's rotation policy.
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        UnityPracticeHost.onConfigurationChanged(newConfig);
        configureFullDisplayViewport();
        preserveWebViewSafeAreaInsets();
        enterImmersiveMode();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        UnityPracticeHost.onNewIntent(intent);
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        UnityPracticeHost.onLowMemory();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        UnityPracticeHost.onTrimMemory(level);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (!UnityPracticeHost.onBackPressed()) super.onBackPressed();
    }

    @Override
    public void onDestroy() {
        UnityPracticeHost.onHostDestroyed(this);
        super.onDestroy();
    }
}
