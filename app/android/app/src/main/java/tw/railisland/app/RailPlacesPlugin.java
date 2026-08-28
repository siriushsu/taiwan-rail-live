package tw.railisland.app;

import android.content.Context;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/** 把 WebView 內的「我的地點」同步給 Android 桌面小工具。 */
@CapacitorPlugin(name = "RailPlaces")
public final class RailPlacesPlugin extends Plugin {
    @PluginMethod
    public void sync(PluginCall call) {
        JSArray raw = call.getArray("places");
        JSONArray clean = new JSONArray();
        if (raw != null) for (int i = 0; i < raw.length(); i++) {
            JSONObject item = raw.optJSONObject(i);
            if (item == null) continue;
            String label = item.optString("label", "").trim();
            double lat = item.optDouble("lat", Double.NaN);
            double lon = item.optDouble("lon", Double.NaN);
            if (!Double.isFinite(lat) || !Double.isFinite(lon)
                || lat < 21.88 || lat > 25.35 || lon < 119.9 || lon > 122.05) continue;
            try {
                clean.put(new JSONObject()
                    .put("label", label).put("lat", lat).put("lon", lon)
                    .put("manual", item.optBoolean("manual", true)));
            } catch (Exception ignored) {}
        }
        getContext().getSharedPreferences(RailWidgetData.PLACES_PREFS, Context.MODE_PRIVATE)
            .edit().putString(RailWidgetData.PLACES_KEY, clean.toString()).apply();
        RailBoardWidgetProvider.updateAll(getContext());
        MixedBoardWidgetProvider.updateAll(getContext());
        JSObject out = new JSObject(); out.put("ok", true); out.put("count", clean.length()); call.resolve(out);
    }
}
