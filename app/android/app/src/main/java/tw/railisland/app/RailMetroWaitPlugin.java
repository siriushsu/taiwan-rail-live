package tw.railisland.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

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
import org.json.JSONException;
import org.json.JSONObject;

import java.lang.ref.WeakReference;

@CapacitorPlugin(
    name = "RailMetroWait",
    permissions = @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
)
public final class RailMetroWaitPlugin extends Plugin {
    private static WeakReference<RailMetroWaitPlugin> shared = new WeakReference<>(null);
    private static Uri pendingUri;

    static void handleIntent(Intent intent) {
        Uri uri = intent == null ? null : intent.getData();
        if (uri == null || !"railisland".equals(uri.getScheme())) return;
        String host = uri.getHost();
        if (!"metro-wait".equals(host) && !"pass".equals(host)) return;
        RailMetroWaitPlugin plugin = shared.get();
        if (plugin == null) pendingUri = uri;
        else plugin.forwardOpen(uri);
    }

    @Override
    public void load() {
        shared = new WeakReference<>(this);
        RailWaitNotification.createChannel(getContext());
        JSONObject activeWait = RailWaitNotification.status(getContext());
        if (activeWait != null) RailWaitNotification.post(getContext(), activeWait);
        if (pendingUri != null) {
            Uri uri = pendingUri;
            pendingUri = null;
            forwardOpen(uri);
        }
    }

    private void forwardOpen(Uri uri) {
        JSObject data = new JSObject();
        if ("pass".equals(uri.getHost())) data.put("view", "pass");
        for (String name : uri.getQueryParameterNames()) data.put(name, uri.getQueryParameter(name));
        notifyListeners("waitOpen", data, true);
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
            copyString(call, payload, "sys");
            copyString(call, payload, "station");
            copyString(call, payload, "lineLabel");
            copyString(call, payload, "color");
            copyString(call, payload, "nextDest");
            copyString(call, payload, "secondDest");
            copyString(call, payload, "selectedDest");
            copyString(call, payload, "notice");
            copyDouble(call, payload, "nextEta");
            copyDouble(call, payload, "secondEta");
            copyDouble(call, payload, "dataAt");
            copyInt(call, payload, "nextMinutes");
            copyInt(call, payload, "secondMinutes");
            Integer duration = call.getInt("durationMin");
            payload.put("durationMin", duration == null ? 30 : duration);
            JSArray crowd = call.getArray("crowd");
            if (crowd != null) payload.put("crowd", new JSONArray(crowd.toString()));
            long endAt = RailWaitNotification.start(getContext(), payload);
            JSObject out = new JSObject();
            out.put("ok", true);
            out.put("id", "android-metro-wait");
            out.put("endAt", endAt / 1000.0);
            out.put("liveUpdate", JSObject.fromJSONObject(RailWaitNotification.promotionStatus(getContext())));
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
        if (state == null) {
            out.put("active", false);
        } else {
            // 從 Android 16 的即時通知設定返回 App 時，JS 會立刻呼叫 status；重貼一次讓
            // 已經存在的普通鎖屏卡有機會立即升成 Live Update／Samsung Now Bar。
            RailWaitNotification.post(getContext(), state);
            out.put("active", true);
            out.put("sys", state.optString("sys", ""));
            out.put("station", state.optString("station", ""));
            if (state.has("endAt")) out.put("endAt", state.optDouble("endAt"));
        }
        try {
            out.put("liveUpdate", JSObject.fromJSONObject(RailWaitNotification.promotionStatus(getContext())));
        } catch (JSONException ignored) {}
        call.resolve(out);
    }

    @PluginMethod
    public void liveUpdateStatus(PluginCall call) {
        try {
            call.resolve(JSObject.fromJSONObject(RailWaitNotification.promotionStatus(getContext())));
        } catch (JSONException error) {
            JSObject out = new JSObject();
            out.put("supported", android.os.Build.VERSION.SDK_INT >= 36);
            out.put("allowed", false);
            out.put("eligible", false);
            out.put("promoted", false);
            call.resolve(out);
        }
    }

    @PluginMethod
    public void openLiveUpdateSettings(PluginCall call) {
        JSObject out = new JSObject();
        out.put("opened", RailWaitNotification.openPromotionSettings(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void setPlus(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active"));
        getContext().getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean("plus_active", active).apply();
        MetroWidgetProvider.updateAll(getContext());
        JSObject out = new JSObject();
        out.put("ok", true);
        call.resolve(out);
    }

    private static void copyString(PluginCall call, JSONObject out, String key) throws JSONException {
        String value = call.getString(key);
        if (value != null) out.put(key, value);
    }

    private static void copyDouble(PluginCall call, JSONObject out, String key) throws JSONException {
        Double value = call.getDouble(key);
        if (value != null) out.put(key, value);
    }

    private static void copyInt(PluginCall call, JSONObject out, String key) throws JSONException {
        Integer value = call.getInt(key);
        if (value != null) out.put(key, value);
    }
}
