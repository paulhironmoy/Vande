package in.vande.cricket.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class UnityPracticePluginInstrumentedTest {
    @Test
    public void missingActivityRejectsBeforeReservingTheLaunchCall() throws Exception {
        UnityPracticePlugin plugin = new UnityPracticePlugin();
        JSObject data = new JSObject();
        data.put("packet", "unused");
        data.put("operationId", "plugin-null-activity-1");
        RecordingCall call = new RecordingCall(data);

        plugin.launchWithActivity(call, null);

        assertEquals(1, call.rejections.get());
        assertEquals("lifecycle", call.code.get());
        assertNull(field(plugin, "pendingLaunch"));
        assertNull(field(plugin, "pendingLaunchOperationId"));
    }

    @Test
    public void unloadCannotReportSuccessBetweenPluginReservationAndNativeAttach() throws Exception {
        UnityPracticePlugin plugin = new UnityPracticePlugin();
        JSObject launchData = new JSObject();
        launchData.put("packet", "unused");
        launchData.put("operationId", "plugin-race-1");
        RecordingCall launch = new RecordingCall(launchData);
        setField(plugin, "pendingLaunch", launch);
        setField(plugin, "pendingLaunchOperationId", "plugin-race-1");

        JSObject unloadData = new JSObject();
        unloadData.put("operationId", "plugin-race-1");
        RecordingCall unload = new RecordingCall(unloadData);
        plugin.unload(unload);

        assertEquals(1, unload.rejections.get());
        assertEquals("lifecycle", unload.code.get());
        assertEquals(0, unload.resolutions.get());
        assertEquals(launch, field(plugin, "pendingLaunch"));
        assertEquals("plugin-race-1", field(plugin, "pendingLaunchOperationId"));
    }

    private static Object field(Object owner, String name) throws ReflectiveOperationException {
        Field field = owner.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(owner);
    }

    private static void setField(Object owner, String name, Object value) throws ReflectiveOperationException {
        Field field = owner.getClass().getDeclaredField(name);
        field.setAccessible(true);
        field.set(owner, value);
    }

    private static final class RecordingCall extends PluginCall {
        final AtomicInteger rejections = new AtomicInteger();
        final AtomicInteger resolutions = new AtomicInteger();
        final AtomicReference<String> code = new AtomicReference<>();

        RecordingCall(JSObject data) {
            super(null, "VandeUnityPractice", "test-callback", "launch", data);
        }

        @Override
        public void reject(String message, String rejectionCode) {
            code.set(rejectionCode);
            rejections.incrementAndGet();
        }

        @Override
        public void resolve(JSObject data) {
            resolutions.incrementAndGet();
        }
    }
}
