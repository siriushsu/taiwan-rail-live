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

    /**
     * App 在【前景】取到一次座標就寫進原生偏好設定，給桌面小工具的「自動（最近的站）」用。
     *
     * 🔴 這是 issue #55 的修法本體。小工具刷新跑在背景，而我們不申請
     *    ACCESS_BACKGROUND_LOCATION（Google Play 高風險審查，判準是「沒有這個功能 App 就不能用」，
     *    而軌島少了自動選站照樣能手動釘站；否決會擋更新並涵蓋所有測試軌道）。所以原生端
     *    唯一拿得到新鮮座標的時機就是 App 在前景的時候——由 WebView 把它已經有的那一筆推進來。
     * 🔴 形狀照抄上面的 {@code sync}：收 lat/lon、驗台灣範圍、寫原生、刷新小工具。
     *    不新寫任何定位程式碼——權限、逾時、精度全部還是 WebView 那一套。
     * 🔴 時戳取【WebView 量到那一刻】而不是這裡的 System.currentTimeMillis()：那才是這筆座標
     *    的年齡；用收到的時間會讓一筆放了兩小時的舊座標看起來像剛取的。
     */
    @PluginMethod
    public void fix(PluginCall call) {
        double lat = call.getDouble("lat", Double.NaN);
        double lon = call.getDouble("lon", Double.NaN);
        long at = call.getLong("at", 0L);
        if (at <= 0) at = System.currentTimeMillis();
        boolean ok = WidgetNearest.rememberFix(getContext(), lat, lon, at);
        if (ok) {
            MetroWidgetProvider.updateAll(getContext());
            RailBoardWidgetProvider.updateAll(getContext());
            MixedBoardWidgetProvider.updateAll(getContext());
        }
        JSObject out = new JSObject(); out.put("ok", ok); call.resolve(out);
    }
}
