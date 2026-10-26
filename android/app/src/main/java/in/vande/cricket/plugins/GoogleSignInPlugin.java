package in.vande.cricket.plugins;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;

/**
 * "Link / restore with Google" through Android Credential Manager. Returns only the Google ID token, which the app
 * sends to the server (POST /v1/auth/link/google or /v1/auth/google); the server verifies it and keeps an HMAC of the
 * subject, never an email or a name. `clientId` is the WEB OAuth client id (the server's audience). Cancelled, no
 * account or no network all resolve with idToken null.
 */
@CapacitorPlugin(name = "VandeGoogleSignIn")
public class GoogleSignInPlugin extends Plugin {

    @PluginMethod
    public void signIn(final PluginCall call) {
        String clientId = call.getString("clientId");
        if (clientId == null || clientId.isEmpty()) {
            call.reject("clientId is required");
            return;
        }
        if (getActivity() == null) {
            resolveNull(call);
            return;
        }
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager manager = CredentialManager.create(getContext());
        manager.getCredentialAsync(
            getActivity(),
            request,
            new CancellationSignal(),
            ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    JSObject result = new JSObject();
                    if (credential instanceof CustomCredential && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                        try {
                            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(((CustomCredential) credential).getData());
                            result.put("idToken", google.getIdToken());
                        } catch (Exception e) {
                            result.put("idToken", JSONObject.NULL);
                        }
                    } else {
                        result.put("idToken", JSONObject.NULL);
                    }
                    call.resolve(result);
                }

                @Override
                public void onError(GetCredentialException e) {
                    resolveNull(call);
                }
            }
        );
    }

    private static void resolveNull(PluginCall call) {
        JSObject result = new JSObject();
        result.put("idToken", JSONObject.NULL);
        call.resolve(result);
    }
}
