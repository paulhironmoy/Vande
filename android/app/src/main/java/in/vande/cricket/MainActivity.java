package in.vande.cricket;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import in.vande.cricket.plugins.GoogleSignInPlugin;
import in.vande.cricket.plugins.InstallReferrerPlugin;
import in.vande.cricket.plugins.SecureStoragePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(InstallReferrerPlugin.class);
        registerPlugin(SecureStoragePlugin.class);
        registerPlugin(GoogleSignInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
