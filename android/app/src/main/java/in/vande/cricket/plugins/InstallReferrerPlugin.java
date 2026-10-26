package in.vande.cricket.plugins;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * Play Install Referrer: the referrer string the Play Store kept from the link the app was installed from
 * ("vc_invite=<token>&vc_a=<code>" for invites). src/platform/installReferrer.ts asks once, on the first launch, so
 * installing the app keeps the pending match. No personal data passes through here.
 */
@CapacitorPlugin(name = "VandeInstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getReferrer(final PluginCall call) {
        final AtomicBoolean answered = new AtomicBoolean(false);
        final InstallReferrerClient client;
        try {
            client = InstallReferrerClient.newBuilder(getContext()).build();
        } catch (Exception e) {
            resolve(call, answered, null);
            return;
        }
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    String referrer = null;
                    if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try {
                            ReferrerDetails details = client.getInstallReferrer();
                            referrer = details.getInstallReferrer();
                        } catch (Exception ignored) {
                            referrer = null;
                        }
                    }
                    try {
                        client.endConnection();
                    } catch (Exception ignored) {
                        // already closed
                    }
                    resolve(call, answered, referrer);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    resolve(call, answered, null);
                }
            });
        } catch (Exception e) {
            resolve(call, answered, null);
        }
    }

    private static void resolve(PluginCall call, AtomicBoolean answered, String referrer) {
        if (!answered.compareAndSet(false, true)) return;
        JSObject result = new JSObject();
        result.put("referrer", referrer != null ? referrer : JSONObject.NULL);
        call.resolve(result);
    }
}
