package tw.railisland.app;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/** Android 對應 iOS TraWaitActivity：台鐵指定班次的鎖屏／Now Bar 等站卡。 */
@CapacitorPlugin(
    name = "RailTraWait",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public final class RailTraWaitPlugin extends Plugin {
    @Override
    public void load() {
        RailWaitNotification.createChannel(getContext());
        JSONObject state = RailWaitNotification.status(getContext());
        if (state != null && RailWaitNotification.KIND_TRA.equals(state.optString("kind"))) {
            RailWaitNotification.post(getContext(), state);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT >= 33
            && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
            return;
        }
        startGranted(call);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        if (getPermissionState("notifications") != PermissionState.GRANTED) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("why", "disabled");
            call.resolve(out);
            return;
        }
        startGranted(call);
    }

    private void startGranted(PluginCall call) {
        try {
            JSONObject payload = new JSONObject();
            copyString(call, payload, "station");
            copyString(call, payload, "trainNo");
            copyString(call, payload, "trainType");
            copyString(call, payload, "dest");
            copyString(call, payload, "color");
            copyString(call, payload, "notice");
            copyDouble(call, payload, "schedSec");
            copyDouble(call, payload, "dataAt");
            copyInt(call, payload, "delayMin");
            long endAt = RailWaitNotification.startTra(getContext(), payload);
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("id", "android-tra-wait");
            out.put("endAt", endAt / 1000.0);
            call.resolve(out);
        } catch (Exception error) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("why", error.getMessage() == null ? error.toString() : error.getMessage());
            call.resolve(out);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        RailWaitNotification.stop(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSONObject state = RailWaitNotification.status(getContext());
        JSObject out = new JSObject();
        if (state == null || !RailWaitNotification.KIND_TRA.equals(state.optString("kind"))) {
            out.put("active", false);
        } else {
            RailWaitNotification.post(getContext(), state);
            out.put("active", true);
            out.put("station", state.optString("station", ""));
            out.put("trainNo", state.optString("trainNo", ""));
            out.put("schedSec", state.optDouble("schedSec", 0));
            out.put("endAt", state.optDouble("endAt", 0));
        }
        call.resolve(out);
    }

    private static void copyString(PluginCall call, JSONObject out, String key) throws Exception {
        String value = call.getString(key);
        if (value != null) out.put(key, value);
    }

    private static void copyDouble(PluginCall call, JSONObject out, String key) throws Exception {
        Double value = call.getDouble(key);
        if (value != null) out.put(key, value);
    }

    private static void copyInt(PluginCall call, JSONObject out, String key) throws Exception {
        Integer value = call.getInt(key);
        if (value != null) out.put(key, value);
    }
}
