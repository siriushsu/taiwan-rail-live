package tw.railisland.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * 「最近的站」解析的 Android 接線層：取位、取半徑、記／清快取。判定本身在
 * {@link WidgetNearestMath}（純層，javac 驗得到）。捷運、台鐵、(單元 C 之後的)公車共用。
 *
 * 🔴 為什麼要有這一層（issue #55 的根因）：改版前兩支小工具都只讀
 *    {@code LocationManager.getLastKnownLocation}，而小工具刷新跑在背景、App 從來沒有主動
 *    要過定位 ⇒ 沒開過 App 的那段時間裡系統快取就是空的或很舊，「自動（最近的站）」結構上
 *    讀不到位置。修法【不是】申請背景定位（ACCESS_BACKGROUND_LOCATION 是 Google Play 高風險
 *    審查，判準是「沒有這個功能 App 就不能用」，而軌島少了自動選站照樣能手動釘站；否決會擋
 *    更新並涵蓋所有測試軌道），而是：App 在前景時把座標主動寫進來，加上「退快取並標示」。
 */
final class WidgetNearest {
    private WidgetNearest() {}

    /** App 前景推進來的座標。與「我的地點」(RailWidgetData.PLACES_PREFS) 刻意分開檔案。 */
    static final String FIX_PREFS = "rail_widget_fix";
    static final String FIX_LAT = "lat";
    static final String FIX_LON = "lon";
    static final String FIX_AT = "at";

    /** 上次解析出來的站鍵。逐運具一個槽（捷運存 "sys|站名"，台鐵存站名或共站鍵）。 */
    private static final String CACHE_PREFS = "rail_widget_nearest";

    /** 台灣範圍。與 RailPlacesPlugin.sync 同一組字面值（那支是既有的「WebView 給座標」形狀）。 */
    static final double LAT_MIN = 21.88, LAT_MAX = 25.35, LON_MIN = 119.9, LON_MAX = 122.05;

    static boolean inTaiwan(double lat, double lon) {
        return !Double.isNaN(lat) && !Double.isNaN(lon) && !Double.isInfinite(lat) && !Double.isInfinite(lon)
            && lat >= LAT_MIN && lat <= LAT_MAX && lon >= LON_MIN && lon <= LON_MAX;
    }

    // ── 半徑：唯一來源是產生的資料檔，不是程式碼 ────────────────────────────────────

    private static Map<String, Double> cachedRadii;

    /**
     * 逐運具的服務半徑，讀 assets 的 {@code MetroWidgetData.json} → {@code serviceRadii}。
     *
     * 🔴 唯一來源是 app/scripts/build_metro_widget_data.mjs 的 SERVICE_RADII，iOS 的
     *    WidgetServiceRadius 讀的是同一把。這裡【不准】寫死字面值——寫死就是兩端各一份，
     *    而它們會無聲分岔（改版前正是 iOS 12000／Android 5000 兩份，公車進來會變第三份）。
     * 🔴 那個檔由 app/android/app/build.gradle 的 syncMetroWidgetData 在 preBuild 複製進 assets，
     *    與 iOS bundle 的是同一份產物。
     */
    static double radiusMeters(Context context, String modality) {
        return WidgetNearestMath.radiusOf(radii(context), modality);
    }

    private static synchronized Map<String, Double> radii(Context context) {
        if (cachedRadii != null) return cachedRadii;
        Map<String, Double> out = new HashMap<>();
        try (InputStream input = context.getAssets().open("MetroWidgetData.json")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            int read;
            while ((read = input.read(chunk)) >= 0) buffer.write(chunk, 0, read);
            JSONObject table = new JSONObject(buffer.toString(StandardCharsets.UTF_8.name()))
                .optJSONObject("serviceRadii");
            if (table != null) for (Iterator<String> it = table.keys(); it.hasNext(); ) {
                String key = it.next();
                double value = table.optDouble(key, Double.NaN);
                if (!Double.isNaN(value)) out.put(key, value);
            }
        } catch (Exception ignored) {}
        cachedRadii = Collections.unmodifiableMap(out);
        return cachedRadii;
    }

    // ── 取位 ──────────────────────────────────────────────────────────────────────

    /** App 在前景取到的那一筆。沒有就回 null。 */
    static WidgetNearestMath.Fix appFix(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(FIX_PREFS, Context.MODE_PRIVATE);
        double lat = Double.longBitsToDouble(prefs.getLong(FIX_LAT, Double.doubleToRawLongBits(Double.NaN)));
        double lon = Double.longBitsToDouble(prefs.getLong(FIX_LON, Double.doubleToRawLongBits(Double.NaN)));
        long at = prefs.getLong(FIX_AT, 0L);
        if (at <= 0 || !inTaiwan(lat, lon)) return null;
        return new WidgetNearestMath.Fix(lat, lon, at, true);
    }

    /** 系統快取裡最新的一筆。沒有權限、沒有 provider、沒有值都回 null。 */
    static WidgetNearestMath.Fix systemFix(Context context) {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION)
                != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return null;
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return null;
        Location best = null;
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate != null && (best == null || candidate.getTime() > best.getTime())) best = candidate;
            }
        } catch (SecurityException ignored) { return null; }
        if (best == null || !inTaiwan(best.getLatitude(), best.getLongitude())) return null;
        return new WidgetNearestMath.Fix(best.getLatitude(), best.getLongitude(), best.getTime(), false);
    }

    /** 兩個來源取比較新的。App 前景那一筆通常比系統快取新，但不保證，所以比時戳不比來源。 */
    static WidgetNearestMath.Fix fix(Context context) {
        return WidgetNearestMath.fresher(systemFix(context), appFix(context));
    }

    /** App 前景取到座標時寫進來（RailPlacesPlugin.fix）。範圍外的座標不留。 */
    static boolean rememberFix(Context context, double lat, double lon, long at) {
        if (!inTaiwan(lat, lon) || at <= 0) return false;
        context.getSharedPreferences(FIX_PREFS, Context.MODE_PRIVATE).edit()
            .putLong(FIX_LAT, Double.doubleToRawLongBits(lat))
            .putLong(FIX_LON, Double.doubleToRawLongBits(lon))
            .putLong(FIX_AT, at)
            .apply();
        return true;
    }

    // ── 上次解析出的站 ────────────────────────────────────────────────────────────

    static String cachedStation(Context context, String slot) {
        return context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).getString(slot, null);
    }

    private static void rememberStation(Context context, String slot, String key) {
        context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit().putString(slot, key).apply();
    }

    private static void clearStation(Context context, String slot) {
        context.getSharedPreferences(CACHE_PREFS, Context.MODE_PRIVATE).edit().remove(slot).apply();
    }

    // ── 解析 ──────────────────────────────────────────────────────────────────────

    /** 呼叫端只提供「掃自己的目錄」。三個運具各自的目錄形狀不同，判定則共用。 */
    interface Scan {
        WidgetNearestMath.Hit nearest(double lat, double lon);
    }

    /**
     * 取位 → 掃目錄 → 判定 → 落快取。四項變更（前景取位、快取站不快取座標、範圍外清快取、
     * 退快取標示）在這一支裡收斂成一條路徑，三個小工具不各寫一份。
     *
     * @param slot 快取槽名，逐運具一個（"metro" / "rail|tra" …）
     */
    static WidgetNearestMath.Outcome resolve(Context context, String modality, String slot, Scan scan) {
        WidgetNearestMath.Fix fix = fix(context);
        long now = System.currentTimeMillis();
        WidgetNearestMath.Hit hit = fix != null && WidgetNearestMath.fresh(fix, now)
            ? scan.nearest(fix.lat, fix.lon) : null;
        WidgetNearestMath.Outcome outcome = WidgetNearestMath.decide(
            fix, now, hit, radiusMeters(context, modality), cachedStation(context, slot));
        if (outcome.clearCache) clearStation(context, slot);
        else if (!outcome.stale && outcome.key != null) rememberStation(context, slot, outcome.key);
        return outcome;
    }
}
