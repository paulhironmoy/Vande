package in.vande.cricket.plugins;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/**
 * Session storage backed by the Android Keystore (the SecureStore adapter in src/platform/secureStore.ts). Every value
 * is AES-256-GCM encrypted with a non-exportable Keystore key and kept in private SharedPreferences, which the app
 * excludes from backups (android:allowBackup="false"). The value's name is the GCM associated data, so a ciphertext
 * cannot be moved under another name. Uses only the Android SDK (no deprecated security-crypto library).
 */
@CapacitorPlugin(name = "VandeSecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "vande_secure_storage_v1";
    private static final String PREFS = "vande_secure_storage";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private synchronized SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String name = call.getString("key");
        if (name == null) {
            call.reject("key is required");
            return;
        }
        JSObject result = new JSObject();
        String stored = prefs().getString(name, null);
        if (stored == null) {
            result.put("value", JSONObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, all, 0, IV_BYTES));
            cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            byte[] plain = cipher.doFinal(all, IV_BYTES, all.length - IV_BYTES);
            result.put("value", new String(plain, StandardCharsets.UTF_8));
        } catch (Exception e) {
            // Unreadable (the Keystore key is gone after a device restore, or the value is corrupt): treat as missing.
            result.put("value", JSONObject.NULL);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String name = call.getString("key");
        String value = call.getString("value");
        if (name == null || value == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] all = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
            // commit(), not apply(): a token must be on disk before the call resolves.
            boolean ok = prefs().edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).commit();
            if (ok) call.resolve();
            else call.reject("secure storage write failed");
        } catch (Exception e) {
            call.reject("secure storage unavailable", e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("key");
        if (name == null) {
            call.reject("key is required");
            return;
        }
        prefs().edit().remove(name).commit();
        call.resolve();
    }
}
