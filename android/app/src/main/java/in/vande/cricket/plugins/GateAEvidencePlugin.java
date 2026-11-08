package in.vande.cricket.plugins;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Process;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
import android.system.StructTimespec;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import org.json.JSONObject;

/**
 * Read-only native epoch evidence for the sealed Gate A first-ball/installed-size bracket.
 *
 * <p>This is local engineering evidence only. It deliberately makes no claim against a rooted device, a compromised
 * kernel/host or a malicious app process. The nonce lives for exactly this Capacitor plugin (bridge) instance, so a
 * replaced bridge cannot silently continue the same bracket.
 */
@CapacitorPlugin(name = "GateAEvidencePlugin")
public final class GateAEvidencePlugin extends Plugin {
    private static final String PACKAGE_ID = "in.vande.cricket";
    private static final int MAX_PROC_BYTES = 16 * 1024;

    private final String bridgeNonce = GateAEvidenceCore.randomNonce(new SecureRandom());

    @PluginMethod
    public void getEpoch(PluginCall call) {
        try {
            String stateSha256 = exactStateSha256(call);
            call.resolve(snapshot(stateSha256));
        } catch (Exception | LinkageError unavailable) {
            // Evidence is all-or-nothing. Do not resolve a partial or guessed epoch.
            call.reject("Gate A native epoch evidence is unavailable");
        }
    }

    private JSObject snapshot(String stateSha256) throws Exception {
        Context context = getContext();
        if (context == null || !PACKAGE_ID.equals(context.getPackageName())) {
            throw new IllegalStateException("unexpected application context");
        }

        ApplicationInfo applicationInfo = context.getApplicationInfo();
        if (
            applicationInfo == null ||
            !PACKAGE_ID.equals(applicationInfo.packageName) ||
            applicationInfo.dataDir == null ||
            applicationInfo.dataDir.isEmpty()
        ) {
            throw new IllegalStateException("application identity is unavailable");
        }

        File canonicalDataDir = new File(applicationInfo.dataDir).getCanonicalFile();
        if (!canonicalDataDir.isAbsolute()) throw new IllegalStateException("application data directory is not absolute");
        String canonicalPath = canonicalDataDir.getPath();
        StructStat stat = Os.stat(canonicalPath);
        if (stat == null || !OsConstants.S_ISDIR(stat.st_mode) || stat.st_uid < 0 || stat.st_gid < 0) {
            throw new IllegalStateException("application data directory identity is invalid");
        }
        if (stat.st_ino == 0L || stat.st_dev == 0L || stat.st_mtim == null || stat.st_ctim == null) {
            throw new IllegalStateException("application data directory epoch is incomplete");
        }

        int uid = Process.myUid();
        int pid = Process.myPid();
        if (uid < 0 || pid <= 0 || stat.st_uid != uid) {
            throw new IllegalStateException("application and process identity do not match");
        }

        String startTicks = GateAEvidenceCore.parseProcessStartTicks(
            readRequiredUtf8(new File("/proc/self/stat")),
            pid
        );
        String bootId = GateAEvidenceCore.requireBootId(
            readRequiredUtf8(new File("/proc/sys/kernel/random/boot_id"))
        );

        JSObject dataDir = new JSObject();
        dataDir.put("canonicalPath", canonicalPath);
        dataDir.put("dev", GateAEvidenceCore.unsignedLong(stat.st_dev));
        dataDir.put("inode", GateAEvidenceCore.unsignedLong(stat.st_ino));
        dataDir.put("mode", Integer.toString(stat.st_mode));
        dataDir.put("uid", Integer.toString(stat.st_uid));
        dataDir.put("gid", Integer.toString(stat.st_gid));
        dataDir.put("mtimeNs", timespecNanoseconds(stat.st_mtim));
        dataDir.put("ctimeNs", timespecNanoseconds(stat.st_ctim));

        JSObject process = new JSObject();
        process.put("packageId", PACKAGE_ID);
        process.put("uid", Integer.toString(uid));
        process.put("pid", Integer.toString(pid));
        process.put("startTicks", startTicks);
        process.put("bootId", bootId);

        JSObject result = new JSObject();
        result.put("schemaVersion", 1);
        result.put("status", "OK");
        result.put("limitation", GateAEvidenceCore.LIMITATION);
        result.put("packageId", PACKAGE_ID);
        result.put("dataDir", dataDir);
        result.put("process", process);
        result.put("bridgeNonce", bridgeNonce);
        result.put("stateSha256", stateSha256);
        result.put("stateBindingSha256", GateAEvidenceCore.stateBindingSha256(bridgeNonce, stateSha256));
        return result;
    }

    private static String exactStateSha256(PluginCall call) {
        if (call == null) throw new IllegalArgumentException("plugin call is required");
        JSObject data = call.getData();
        if (data == null || data.length() != 1 || !data.has("stateSha256")) {
            throw new IllegalArgumentException("exactly stateSha256 is required");
        }
        Object raw = data.opt("stateSha256");
        if (!(raw instanceof String) || raw == JSONObject.NULL) {
            throw new IllegalArgumentException("stateSha256 must be a string");
        }
        return GateAEvidenceCore.requireStateSha256((String) raw);
    }

    private static String timespecNanoseconds(StructTimespec timespec) {
        if (timespec == null) throw new IllegalArgumentException("timespec is required");
        return GateAEvidenceCore.nanoseconds(timespec.tv_sec, timespec.tv_nsec);
    }

    private static String readRequiredUtf8(File file) throws IOException {
        if (file == null || !file.isAbsolute()) throw new IOException("evidence path is not absolute");
        try (InputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            int total = 0;
            for (int count = input.read(buffer); count != -1; count = input.read(buffer)) {
                total += count;
                if (total > MAX_PROC_BYTES) throw new IOException("evidence file exceeds the bounded reader");
                output.write(buffer, 0, count);
            }
            if (total == 0) throw new IOException("evidence file is empty");
            return GateAEvidenceCore.decodeUtf8Strict(output.toByteArray());
        }
    }
}
