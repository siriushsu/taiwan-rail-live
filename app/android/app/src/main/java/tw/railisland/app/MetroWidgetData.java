package tw.railisland.app;

import android.content.Context;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/** 捷運小工具的共用目錄與官方看板解析。顯示精度與 iOS MetroBoardModel 相同。 */
final class MetroWidgetData {
    /** 「自動（最近的站）」哨兵。字面值只有 WidgetNearestMath 一份（兩個小工具共用同一個哨兵）。 */
    static final String AUTO = WidgetNearestMath.AUTO;
    private static Catalog cachedCatalog;

    static final class StationInfo {
        final String name;
        final double lat;
        final double lon;
        String en;                                          // 官方英文站名（設計稿的站名牌字樣）
        final List<String> destinations = new ArrayList<>();
        final List<String> colors = new ArrayList<>();
        final List<String> lineIds = new ArrayList<>();
        /** 官方站號，index 與 lineIds 對齊——同一座轉乘站在不同線上是不同站號（台北車站 R10／BL12）。 */
        final List<String> codes = new ArrayList<>();

        String codeForLine(String lineId) {
            int i = lineIds.indexOf(lineId);
            String code = i < 0 || i >= codes.size() ? null : codes.get(i);
            return code == null || code.isEmpty() ? null : code;
        }

        StationInfo(String name, double lat, double lon) {
            this.name = name;
            this.lat = lat;
            this.lon = lon;
        }
    }

    static final class SystemInfo {
        final String id;
        final String label;
        final String precision;
        final boolean crowd;
        final List<StationInfo> stations = new ArrayList<>();
        final Map<String, StationInfo> stationByName = new LinkedHashMap<>();
        final Map<String, String> lineColors = new LinkedHashMap<>();
        final Map<String, String> lineLabels = new LinkedHashMap<>();
        /** lineId → 該線的站序（目錄本來就有序）。設計稿 4×3 的前後站帶要用。 */
        final Map<String, List<String>> lineOrder = new LinkedHashMap<>();

        /** 同一條線上的鄰站；轉乘站有多條線時取第一條有序列的（設計稿只畫一組前後站）。 */
        String[] neighbors(String stationName, String preferLineId) {
            List<String> order = preferLineId == null ? null : lineOrder.get(preferLineId);
            if (order == null || order.indexOf(stationName) < 0) {
                order = null;
                StationInfo station = stationByName.get(stationName);
                if (station != null) for (String lineId : station.lineIds) {
                    List<String> candidate = lineOrder.get(lineId);
                    if (candidate != null && candidate.indexOf(stationName) >= 0) { order = candidate; break; }
                }
            }
            if (order == null) return new String[] { null, null };
            int i = order.indexOf(stationName);
            return new String[] {
                i > 0 ? order.get(i - 1) : null,
                i >= 0 && i + 1 < order.size() ? order.get(i + 1) : null,
            };
        }

        SystemInfo(String id, String label, String precision, boolean crowd) {
            this.id = id;
            this.label = label;
            this.precision = precision;
            this.crowd = crowd;
        }
    }

    static final class Catalog {
        final List<SystemInfo> systems = new ArrayList<>();
        final Map<String, SystemInfo> byId = new LinkedHashMap<>();
        final JSONObject alias;
        final JSONObject lastTrain;
        /** 官方首班時刻，鍵同 lastTrain（sys|站|終點）。官方值分歧的鍵在資料建置階段就不輸出。 */
        final JSONObject firstTrain;

        Catalog(JSONObject alias, JSONObject lastTrain, JSONObject firstTrain) {
            this.alias = alias;
            this.lastTrain = lastTrain;
            this.firstTrain = firstTrain;
        }

        /** 首班時刻的字面值；查不到（或官方值分歧）就 null，不准挑一個。 */
        String firstTrainAt(String sys, String station, String dest) {
            String exact = firstTrain.optString(sys + "|" + station + "|" + dest, "");
            if (!exact.isEmpty()) return exact;
            String prefix = sys + "|" + station + "|";
            String best = null;
            java.util.Iterator<String> keys = firstTrain.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!key.startsWith(prefix)) continue;
                String value = firstTrain.optString(key, "");
                if (value.isEmpty()) continue;
                if (best == null || value.compareTo(best) < 0) best = value;   // 同站多終點 ⇒ 取最早那班
            }
            return best;
        }
    }

    static final class Row {
        String dest;
        Double eta;
        Integer minutes;
        int[] crowd;
        String color;
        String lineLabel;
        String lineId;          // 這一列是哪條線 ⇒ provider 才查得到該線的官方站號（轉乘站每線不同）
        boolean approx;         // eta2 推導列；只准畫「約 N 分」，快取 round-trip 不可掉

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject().put("dest", dest);
            if (eta != null) out.put("eta", eta);
            if (minutes != null) out.put("minutes", minutes);
            if (color != null) out.put("color", color);
            if (lineLabel != null) out.put("lineLabel", lineLabel);
            if (lineId != null) out.put("lineId", lineId);
            if (approx) out.put("approx", true);
            if (crowd != null) {
                JSONArray a = new JSONArray();
                for (int v : crowd) a.put(v);
                out.put("crowd", a);
            }
            return out;
        }

        static Row fromJson(JSONObject raw) {
            Row row = new Row();
            row.dest = raw.optString("dest", "—");
            if (raw.has("eta")) row.eta = raw.optDouble("eta");
            if (raw.has("minutes")) row.minutes = raw.optInt("minutes");
            row.color = raw.optString("color", null);
            row.lineLabel = raw.optString("lineLabel", null);
            row.lineId = raw.optString("lineId", null);
            row.approx = raw.optBoolean("approx", false);
            JSONArray crowd = raw.optJSONArray("crowd");
            if (crowd != null && crowd.length() > 0) {
                row.crowd = new int[crowd.length()];
                for (int i = 0; i < crowd.length(); i++) row.crowd[i] = crowd.optInt(i, 1);
            }
            return row;
        }
    }

    static final class Snapshot {
        String sys;
        String systemLabel;
        String station;
        String stationColor;
        String precision;
        double dataAt;
        String lastTrain;
        String lastTrainAt;      // 末班的官方時刻字面值 HH:MM（lastTrain 是「往 X HH:MM」整句）
        boolean failed;
        /**
         * 這一格的站是【上次】解析出來的（這一輪沒拿到新鮮定位）。
         * 🔴 刻意【不】進 toJson／fromJson：它是「這一輪的定位新不新鮮」，不是這份班次資料的屬性。
         *    寫進快取的話，下一輪明明定位好好的、卻會把上一輪的標示一起讀回來。
         *    provider 每一輪都重新指派（見 MetroWidgetProvider.updateOne）。
         */
        boolean autoStale;
        String alertTitle;       // 官方通阻公告標題，照抄字面
        boolean alertFromOperator;
        final List<Row> rows = new ArrayList<>();

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject()
                .put("sys", sys).put("systemLabel", systemLabel).put("station", station)
                .put("precision", precision).put("dataAt", dataAt).put("failed", failed)
                .put("alertFromOperator", alertFromOperator);
            if (stationColor != null) out.put("stationColor", stationColor);
            if (lastTrain != null) out.put("lastTrain", lastTrain);
            if (lastTrainAt != null) out.put("lastTrainAt", lastTrainAt);
            if (alertTitle != null) out.put("alertTitle", alertTitle);
            JSONArray list = new JSONArray();
            for (Row row : rows) list.put(row.toJson());
            out.put("rows", list);
            return out;
        }

        static Snapshot fromJson(JSONObject raw) {
            Snapshot out = new Snapshot();
            out.sys = raw.optString("sys", "");
            out.systemLabel = raw.optString("systemLabel", "捷運");
            out.station = raw.optString("station", "捷運看板");
            out.stationColor = raw.optString("stationColor", null);
            out.precision = raw.optString("precision", "min");
            out.dataAt = raw.optDouble("dataAt", 0);
            out.lastTrain = raw.optString("lastTrain", null);
            out.lastTrainAt = raw.optString("lastTrainAt", null);
            out.failed = raw.optBoolean("failed", false);
            out.alertTitle = raw.optString("alertTitle", null);
            out.alertFromOperator = raw.optBoolean("alertFromOperator", false);
            JSONArray rows = raw.optJSONArray("rows");
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) out.rows.add(Row.fromJson(row));
            }
            return out;
        }
    }

    private MetroWidgetData() {}

    static synchronized Catalog catalog(Context context) throws IOException, JSONException {
        if (cachedCatalog != null) return cachedCatalog;
        JSONObject root;
        try (InputStream input = context.getAssets().open("MetroWidgetData.json")) {
            root = new JSONObject(readAll(input));
        }
        Catalog out = new Catalog(
            root.optJSONObject("alias") == null ? new JSONObject() : root.optJSONObject("alias"),
            root.optJSONObject("lastTrain") == null ? new JSONObject() : root.optJSONObject("lastTrain"),
            root.optJSONObject("firstTrain") == null ? new JSONObject() : root.optJSONObject("firstTrain"));
        JSONArray systems = root.optJSONArray("systems");
        if (systems != null) for (int i = 0; i < systems.length(); i++) {
            JSONObject rawSystem = systems.getJSONObject(i);
            SystemInfo system = new SystemInfo(rawSystem.optString("id"), rawSystem.optString("label"),
                rawSystem.optString("precision", "min"), rawSystem.optBoolean("crowd", false));
            JSONArray lines = rawSystem.optJSONArray("lines");
            if (lines != null) for (int j = 0; j < lines.length(); j++) {
                JSONObject line = lines.getJSONObject(j);
                String lineId = line.optString("id");
                String color = line.optString("color", "");
                String lineLabel = line.optString("name", "");
                if (!lineId.isEmpty()) {
                    system.lineColors.put(lineId, color);
                    system.lineLabels.put(lineId, lineLabel);
                }
                JSONArray stations = line.optJSONArray("stations");
                if (stations == null) continue;
                List<String> order = new ArrayList<>();
                if (!lineId.isEmpty()) system.lineOrder.put(lineId, order);
                for (int k = 0; k < stations.length(); k++) {
                    JSONObject rawStation = stations.getJSONObject(k);
                    String name = rawStation.optString("name");
                    order.add(name);
                    StationInfo station = system.stationByName.get(name);
                    if (station == null) {
                        station = new StationInfo(name, rawStation.optDouble("lat", Double.NaN),
                            rawStation.optDouble("lon", Double.NaN));
                        system.stationByName.put(name, station);
                        system.stations.add(station);
                    }
                    if (!color.isEmpty() && !station.colors.contains(color)) station.colors.add(color);
                    if (!lineId.isEmpty() && !station.lineIds.contains(lineId)) {
                        station.lineIds.add(lineId);
                        station.codes.add(rawStation.optString("code", ""));   // 與 lineIds 同 index
                    }
                    if (station.en == null || station.en.isEmpty()) station.en = rawStation.optString("en", null);
                    JSONArray dests = rawStation.optJSONArray("dests");
                    if (dests != null) for (int d = 0; d < dests.length(); d++) {
                        String dest = dests.optString(d);
                        if (!dest.isEmpty() && !station.destinations.contains(dest)) station.destinations.add(dest);
                    }
                }
            }
            out.systems.add(system);
            out.byId.put(system.id, system);
        }
        cachedCatalog = out;
        return out;
    }

    static Snapshot fetch(Context context, String sysId, String stationName, String direction) throws Exception {
        Catalog catalog = catalog(context);
        SystemInfo sys = catalog.byId.get(sysId);
        if (sys == null) throw new IOException("unknown metro system");
        String endpoint = "trtc".equals(sysId)
            ? "https://railisland.tw/api/trtc-live"
            : "https://railisland.tw/api/metro-live?sys=" + sysId;
        JSONObject root = new JSONObject(download(endpoint));
        Snapshot out = new Snapshot();
        out.sys = sys.id;
        out.systemLabel = sys.label;
        out.station = stationName;
        out.precision = sys.precision;
        out.dataAt = payloadTime(root.optString("at", null), System.currentTimeMillis() / 1000.0);
        StationInfo station = sys.stationByName.get(stationName);
        if (station != null && station.colors.size() == 1) out.stationColor = station.colors.get(0);
        if ("trtc".equals(sys.id)) parseTrtc(catalog, sys, root, stationName, direction, out,
            System.currentTimeMillis() / 1000.0);
        else parseMinute(catalog, sys, root, stationName, direction, out);
        lastTrain(catalog, sys.id, stationName, System.currentTimeMillis(), out);
        applyAlert(sys, station, out);
        return out;
    }

    /**
     * 官方通阻公告（api/metro-alert 聚合五家，Worker 已標好 status/sys/self）。
     * 抓不到就整段略過——公告是加分資訊，不能讓它拖掉看板本體（與網站同一條：失敗保留舊資料）。
     *
     * 🔴 標題照抄官方字面，不做關鍵字判斷（不從「停駛」二字自己推論服務中斷）。
     *    紅／琥珀的分野只用 Worker 給的 self 旗標：營運方公告 ⇒ 紅，本站觀測 ⇒ 琥珀。
     */
    private static void applyAlert(SystemInfo sys, StationInfo station, Snapshot out) {
        JSONArray alerts;
        try {
            alerts = new JSONObject(download("https://railisland.tw/api/metro-alert")).optJSONArray("alerts");
        } catch (Exception ignored) { return; }
        if (alerts == null) return;
        Set<String> myLines = new LinkedHashSet<>();
        if (station != null) for (String lineId : station.lineIds) {
            String label = sys.lineLabels.get(lineId);
            if (label != null && !label.isEmpty()) myLines.add(label);
        }
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject alert = alerts.optJSONObject(i);
            if (alert == null || alert.optInt("status", 1) == 1) continue;
            if (!sys.id.equals(alert.optString("sys", ""))) continue;
            JSONArray lines = alert.optJSONArray("lines");
            if (lines != null && lines.length() > 0 && !myLines.isEmpty()) {
                boolean hit = false;
                for (int j = 0; j < lines.length(); j++) if (myLines.contains(lines.optString(j))) { hit = true; break; }
                if (!hit) continue;   // 這則公告影響的是別條線
            }
            String title = alert.optString("title", "");
            out.alertTitle = title.isEmpty() ? "營運通阻公告" : title;
            out.alertFromOperator = !alert.optBoolean("self", false) && !alert.optBoolean("hazard", false);
            return;   // 一格只放得下一條
        }
    }

    static Snapshot cached(Context context, int widgetId) {
        return cached(context, MetroWidgetProvider.PREFS, widgetId);
    }

    static Snapshot cached(Context context, String prefsName, int widgetId) {
        String raw = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            .getString("snapshot_" + widgetId, null);
        if (raw == null) return null;
        try { return Snapshot.fromJson(new JSONObject(raw)); }
        catch (JSONException ignored) { return null; }
    }

    static void cache(Context context, int widgetId, Snapshot snapshot) {
        cache(context, MetroWidgetProvider.PREFS, widgetId, snapshot);
    }

    static void cache(Context context, String prefsName, int widgetId, Snapshot snapshot) {
        try {
            context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
                .putString("snapshot_" + widgetId, snapshot.toJson().toString()).apply();
        } catch (JSONException ignored) {}
    }

    /** 自動選站的快取槽名（逐運具一個）。 */
    static final String NEAREST_SLOT = "metro";

    /**
     * 自動選站。取位／服務範圍／快取語意全在 {@link WidgetNearest} 與 {@link WidgetNearestMath}，
     * 這裡只負責「掃捷運目錄」這一件事——台鐵與（單元 C 之後的）公車走的是同一支 resolve。
     *
     * 🔴 改版前這裡自己讀 {@code getLastKnownLocation} 且【不套服務範圍】：沒開過 App 的
     *    那段時間系統快取是空的 ⇒ 「自動（最近的站）」在背景刷新時結構上讀不到位置（issue #55）；
     *    而真的讀到一筆很舊的遠方座標時，卡上會照常畫出幾百公里外那一站的倒數。
     */
    static WidgetNearestMath.Outcome nearest(Context context, Catalog catalog) {
        return WidgetNearest.resolve(context, WidgetNearestMath.METRO, NEAREST_SLOT, (lat, lon) -> {
            StationInfo best = null;
            SystemInfo bestSystem = null;
            float bestMeters = Float.MAX_VALUE;
            for (SystemInfo system : catalog.systems) for (StationInfo station : system.stations) {
                if (Double.isNaN(station.lat) || Double.isNaN(station.lon)) continue;
                float[] result = new float[1];
                Location.distanceBetween(lat, lon, station.lat, station.lon, result);
                if (result[0] < bestMeters) { bestMeters = result[0]; best = station; bestSystem = system; }
            }
            return best == null || bestSystem == null ? null
                : new WidgetNearestMath.Hit(bestSystem.id + "|" + best.name, bestMeters);
        });
    }

    /** "sys|站名" → 目錄物件。解析結果與退快取都走這一支，兩條路徑不各拆一次字串。 */
    static StationInfo stationForKey(Catalog catalog, String key) {
        SystemInfo system = systemForKey(catalog, key);
        return system == null ? null : system.stationByName.get(key.substring(key.indexOf('|') + 1));
    }

    static SystemInfo systemForKey(Catalog catalog, String key) {
        int at = key == null ? -1 : key.indexOf('|');
        return at <= 0 ? null : catalog.byId.get(key.substring(0, at));
    }

    /** "sys|站名" → 站名。範圍外的卡面只要講得出「最近的是誰」，不必查得到目錄物件。 */
    static String stationNameOf(String key) {
        int at = key == null ? -1 : key.indexOf('|');
        return at < 0 ? (key == null ? "" : key) : key.substring(at + 1);
    }

    static void parseTrtc(Catalog catalog, SystemInfo sys, JSONObject root, String station,
                          String direction, Snapshot out, double now) throws JSONException {
        Map<String, JSONObject> trains = new LinkedHashMap<>();
        JSONArray trainList = root.optJSONArray("trains");
        if (trainList != null) for (int i = 0; i < trainList.length(); i++) {
            JSONObject train = trainList.optJSONObject(i);
            if (train == null) continue;
            String no = train.optString("no", "");
            if (!no.isEmpty() && !trains.containsKey(no)) trains.put(no, train);
        }
        JSONObject alias = catalog.alias.optJSONObject(sys.id);
        JSONArray board = root.optJSONArray("board");
        if (board == null) return;
        for (int i = 0; i < board.length(); i++) {
            JSONObject raw = board.optJSONObject(i);
            if (raw == null) continue;
            String mine = normalize(alias, raw.optString("name"));
            double eta = raw.optDouble("eta", 0);
            if (!station.equals(mine) || eta <= now) continue;
            String dest = normalize(alias, raw.optString("dest"));
            if (direction != null && !direction.isEmpty() && !direction.equals(dest)) continue;
            Row row = new Row();
            row.dest = dest;
            row.eta = eta;
            String no = raw.optString("no", "");
            JSONObject train = no.isEmpty() ? null : trains.get(no);
            if (train != null) {
                String stn = train.optString("stn", "");
                String lineId = leadingLetters(stn);
                row.color = sys.lineColors.get(lineId);
                row.lineLabel = sys.lineLabels.get(lineId);
                if (row.color != null) row.lineId = lineId;
                JSONArray cars = train.optJSONArray("cars");
                if (cars != null && cars.length() > 0) {
                    row.crowd = new int[cars.length()];
                    for (int c = 0; c < cars.length(); c++) row.crowd[c] = cars.optInt(c, 1);
                }
            }
            if (row.color == null) {
                StationInfo here = sys.stationByName.get(station);
                StationInfo there = sys.stationByName.get(dest);
                String lineId = uniqueShared(here, there);
                if (lineId != null) {
                    row.color = sys.lineColors.get(lineId);
                    row.lineLabel = sys.lineLabels.get(lineId);
                    row.lineId = lineId;
                }
            }
            out.rows.add(row);
            // eta2 是伺服端從已發車列車推導的「再下一班」投影，不是官方站牌原文。
            // 合成列繼承同線同向的識別，但不冒用第一班的擁擠度；approx 旗標會一路進快取與渲染。
            double eta2 = raw.optDouble("eta2", 0);
            if (eta2 > now && eta2 > eta) {
                Row projected = new Row();
                projected.dest = row.dest;
                projected.eta = eta2;
                projected.color = row.color;
                projected.lineLabel = row.lineLabel;
                projected.lineId = row.lineId;
                projected.approx = true;
                out.rows.add(projected);
            }
        }
        out.rows.sort(Comparator.comparingDouble((Row r) -> r.eta).thenComparing(r -> r.dest));
    }

    private static void parseMinute(Catalog catalog, SystemInfo sys, JSONObject root, String station,
                                    String direction, Snapshot out) {
        JSONObject alias = catalog.alias.optJSONObject(sys.id);
        JSONArray rows = root.optJSONArray("rows");
        if (rows == null) return;
        for (int i = 0; i < rows.length(); i++) {
            JSONObject raw = rows.optJSONObject(i);
            if (raw == null || !raw.has("e") || raw.isNull("e")) continue;
            if (!station.equals(normalize(alias, raw.optString("s")))) continue;
            String dest = normalize(alias, raw.optString("d"));
            if (direction != null && !direction.isEmpty() && !direction.equals(dest)) continue;
            Row row = new Row();
            row.dest = dest;
            row.minutes = raw.optInt("e");
            String lineId = raw.optString("l", "");
            row.color = sys.lineColors.get(lineId);
            row.lineLabel = sys.lineLabels.get(lineId);
            row.lineId = row.color == null ? null : lineId;
            out.rows.add(row);
        }
        out.rows.sort(Comparator.comparingInt((Row r) -> r.minutes).thenComparing(r -> r.dest));
    }

    private static String uniqueShared(StationInfo here, StationInfo there) {
        if (here == null || there == null) return null;
        List<String> shared = new ArrayList<>(here.lineIds);
        shared.retainAll(there.lineIds);
        return shared.size() == 1 ? shared.get(0) : null;
    }

    private static String leadingLetters(String value) {
        int i = 0;
        while (i < value.length() && Character.isLetter(value.charAt(i))) i++;
        return value.substring(0, i);
    }

    private static String normalize(JSONObject alias, String raw) {
        if (alias != null && alias.has(raw)) return alias.optString(raw, raw);
        if (raw.endsWith("站") && raw.length() > 1) return raw.substring(0, raw.length() - 1);
        return raw.replace('臺', '台');
    }

    private static void lastTrain(Catalog catalog, String sys, String station, long nowMillis, Snapshot out) {
        String prefix = sys + "|" + station + "|";
        long bestAt = Long.MAX_VALUE;
        java.util.Iterator<String> keys = catalog.lastTrain.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.startsWith(prefix)) continue;
            String hhmm = catalog.lastTrain.optString(key, "");
            long occurrence = nextOccurrence(hhmm, nowMillis);
            if (occurrence >= nowMillis && occurrence - nowMillis <= 3_600_000L && occurrence < bestAt) {
                String dest = key.substring(prefix.length());
                out.lastTrain = "往 " + dest + " " + hhmm;
                out.lastTrainAt = hhmm;
                bestAt = occurrence;
            }
        }
    }

    /**
     * 這一站現在還在營運時間內嗎——只用官方首末班字面值推，沒有官方值就回 null（讓上層走「暫無資料」，
     * 不要編一個營運時段出來；全專案唯一手寫營運時段的線是三鶯線，那是刻意的例外）。
     *
     * 服務日慣例：末班早於 04:00 的算「昨日的深夜班」⇒ +1440 分，否則 23:55 會贏過 00:30。
     */
    static boolean serviceClosed(Catalog catalog, String sys, String station, double nowEpochSec) {
        int first = Integer.MAX_VALUE, last = Integer.MIN_VALUE;
        String prefix = sys + "|" + station + "|";
        for (int pass = 0; pass < 2; pass++) {
            JSONObject table = pass == 0 ? catalog.firstTrain : catalog.lastTrain;
            java.util.Iterator<String> keys = table.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                if (!key.startsWith(prefix)) continue;
                int minute = minuteOfDay(table.optString(key, ""));
                if (minute < 0) continue;
                if (pass == 0) first = Math.min(first, minute);
                else last = Math.max(last, minute < 240 ? minute + 1440 : minute);
            }
        }
        if (first == Integer.MAX_VALUE || last == Integer.MIN_VALUE) return false;
        int now = (int) (((long) (nowEpochSec + 8 * 3600) % 86400) / 60);
        boolean open = now >= first && now <= last;
        if (!open && last > 1440) open = now <= last - 1440;   // 跨午夜的深夜班
        return !open;
    }

    private static int minuteOfDay(String hhmm) {
        if (hhmm == null || hhmm.indexOf(':') < 0) return -1;
        String[] parts = hhmm.split(":");
        if (parts.length != 2) return -1;
        try { return Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]); }
        catch (NumberFormatException error) { return -1; }
    }

    private static long nextOccurrence(String hhmm, long nowMillis) {
        String[] parts = hhmm.split(":");
        if (parts.length != 2) return Long.MAX_VALUE;
        try {
            int hour = Integer.parseInt(parts[0]);
            int minute = Integer.parseInt(parts[1]);
            java.util.Calendar cal = java.util.Calendar.getInstance(TimeZone.getTimeZone("Asia/Taipei"), Locale.TAIWAN);
            cal.setTimeInMillis(nowMillis);
            cal.set(java.util.Calendar.HOUR_OF_DAY, 0);
            cal.set(java.util.Calendar.MINUTE, 0);
            cal.set(java.util.Calendar.SECOND, 0);
            cal.set(java.util.Calendar.MILLISECOND, 0);
            long value = cal.getTimeInMillis() + (hour * 60L + minute) * 60_000L;
            if (value < nowMillis) value += 86_400_000L;
            return value;
        } catch (NumberFormatException error) { return Long.MAX_VALUE; }
    }

    private static double payloadTime(String raw, double fallback) {
        if (raw == null || raw.isEmpty()) return fallback;
        String[] patterns = { "yyyy-MM-dd'T'HH:mm:ss.SSSX", "yyyy-MM-dd'T'HH:mm:ssX" };
        for (String pattern : patterns) {
            SimpleDateFormat f = new SimpleDateFormat(pattern, Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            try { return f.parse(raw).getTime() / 1000.0; }
            catch (ParseException ignored) {}
        }
        return fallback;
    }

    private static String download(String rawUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(rawUrl).openConnection();
        connection.setConnectTimeout(8_000);
        connection.setReadTimeout(8_000);
        connection.setRequestProperty("Cache-Control", "no-cache");
        connection.setRequestProperty("User-Agent", "RailIsland-Android-Widget");
        connection.setUseCaches(false);
        int code = connection.getResponseCode();
        if (code != 200) throw new IOException("HTTP " + code);
        try (InputStream input = new BufferedInputStream(connection.getInputStream())) {
            return readAll(input);
        } finally { connection.disconnect(); }
    }

    private static String readAll(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) >= 0) out.write(buffer, 0, count);
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
