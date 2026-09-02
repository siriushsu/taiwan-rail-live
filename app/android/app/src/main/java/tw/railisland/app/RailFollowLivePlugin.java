package tw.railisland.app;

import android.Manifest;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

/** 網頁既有 RailLiveActivity API 的 Android 實作：Android 16 Live Update／Samsung Now Bar。 */
@CapacitorPlugin(
    name = "RailFollowLive",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public final class RailFollowLivePlugin extends Plugin {
    @Override
    public void load() {
        RailFollowNotification.createChannel(getContext());
        JSONObject active = RailFollowNotification.status(getContext());
        if (active != null) RailFollowNotification.post(getContext(), active);
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
            out.put("ok", false); out.put("why", "disabled");
            call.resolve(out);
            return;
        }
        startGranted(call);
    }

    private void startGranted(PluginCall call) {
        try {
            JSONObject payload = payload(call);
            RailFollowNotification.start(getContext(), payload);
            JSObject out = new JSObject();
            out.put("ok", true);
            call.resolve(out);
        } catch (Exception error) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("why", error.getMessage() == null ? error.toString() : error.getMessage());
            call.resolve(out);
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        try {
            RailFollowNotification.update(getContext(), payload(call));
            JSObject out = new JSObject(); out.put("ok", true); call.resolve(out);
        } catch (Exception error) {
            JSObject out = new JSObject(); out.put("ok", false); out.put("why", error.toString()); call.resolve(out);
        }
    }

    @PluginMethod
    public void end(PluginCall call) {
        RailFollowNotification.stop(getContext());
        JSObject out = new JSObject(); out.put("ok", true); call.resolve(out);
    }

    private static JSONObject payload(PluginCall call) throws Exception {
        JSONObject out = new JSONObject();
        copyString(call, out, "key");
        copyString(call, out, "trainNo");
        copyString(call, out, "kind");
        copyString(call, out, "sys");
        copyString(call, out, "color");
        copyString(call, out, "nextStop");
        copyString(call, out, "prevStop");
        copyString(call, out, "terminus");
        copyDouble(call, out, "arrivalAt");
        copyDouble(call, out, "departedAt");
        copyDouble(call, out, "advanceAt");
        Integer delay = call.getInt("delaySec");
        if (delay != null) out.put("delaySec", delay);
        Boolean stopping = call.getBoolean("stopping");
        if (stopping != null) out.put("stopping", stopping);
        JSArray stops = call.getArray("remainingStops");
        if (stops != null) out.put("remainingStops", new JSONArray(stops.toString()));
        JSObject staMap = call.getObject("staMap");
        if (staMap != null) out.put("staMap", new JSONObject(staMap.toString()));
        return out;
    }

    private static void copyString(PluginCall call, JSONObject out, String key) throws Exception {
        String value = call.getString(key); if (value != null) out.put(key, value);
    }

    private static void copyDouble(PluginCall call, JSONObject out, String key) throws Exception {
        Double value = call.getDouble(key); if (value != null) out.put(key, value);
    }
}
