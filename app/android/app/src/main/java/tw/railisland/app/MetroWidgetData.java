package tw.railisland.app;

import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;

import androidx.core.content.ContextCompat;

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
    static final String AUTO = "__auto__";
    private static Catalog cachedCatalog;

    static final class StationInfo {
        final String name;
        final double lat;
        final double lon;
        final List<String> destinations = new ArrayList<>();
        final List<String> colors = new ArrayList<>();
        final List<String> lineIds = new ArrayList<>();

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

        Catalog(JSONObject alias, JSONObject lastTrain) {
            this.alias = alias;
            this.lastTrain = lastTrain;
        }
    }

    static final class Row {
        String dest;
        Double eta;
        Integer minutes;
        int[] crowd;
        String color;
        String lineLabel;

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject().put("dest", dest);
            if (eta != null) out.put("eta", eta);
            if (minutes != null) out.put("minutes", minutes);
            if (color != null) out.put("color", color);
            if (lineLabel != null) out.put("lineLabel", lineLabel);
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
        boolean failed;
        final List<Row> rows = new ArrayList<>();

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject()
                .put("sys", sys).put("systemLabel", systemLabel).put("station", station)
                .put("precision", precision).put("dataAt", dataAt).put("failed", failed);
            if (stationColor != null) out.put("stationColor", stationColor);
            if (lastTrain != null) out.put("lastTrain", lastTrain);
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
            out.failed = raw.optBoolean("failed", false);
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
        Catalog out = new Catalog(root.optJSONObject("alias") == null ? new JSONObject() : root.optJSONObject("alias"),
            root.optJSONObject("lastTrain") == null ? new JSONObject() : root.optJSONObject("lastTrain"));
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
                for (int k = 0; k < stations.length(); k++) {
                    JSONObject rawStation = stations.getJSONObject(k);
                    String name = rawStation.optString("name");
                    StationInfo station = system.stationByName.get(name);
                    if (station == null) {
                        station = new StationInfo(name, rawStation.optDouble("lat", Double.NaN),
                            rawStation.optDouble("lon", Double.NaN));
                        system.stationByName.put(name, station);
                        system.stations.add(station);
                    }
                    if (!color.isEmpty() && !station.colors.contains(color)) station.colors.add(color);
                    if (!lineId.isEmpty() && !station.lineIds.contains(lineId)) station.lineIds.add(lineId);
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
        if ("trtc".equals(sys.id)) parseTrtc(catalog, sys, root, stationName, direction, out);
        else parseMinute(catalog, sys, root, stationName, direction, out);
        out.lastTrain = lastTrain(catalog, sys.id, stationName, System.currentTimeMillis());
        return out;
    }

    static Snapshot cached(Context context, int widgetId) {
        String raw = context.getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE)
            .getString("snapshot_" + widgetId, null);
        if (raw == null) return null;
        try { return Snapshot.fromJson(new JSONObject(raw)); }
        catch (JSONException ignored) { return null; }
    }

    static void cache(Context context, int widgetId, Snapshot snapshot) {
        try {
            context.getSharedPreferences(MetroWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
                .putString("snapshot_" + widgetId, snapshot.toJson().toString()).apply();
        } catch (JSONException ignored) {}
    }

    static StationInfo nearest(Context context, Catalog catalog) {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) return null;
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return null;
        Location last = null;
        try {
            for (String provider : manager.getProviders(true)) {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate != null && (last == null || candidate.getTime() > last.getTime())) last = candidate;
            }
        } catch (SecurityException ignored) { return null; }
        if (last == null) return null;
        StationInfo best = null;
        float bestMeters = Float.MAX_VALUE;
        for (SystemInfo system : catalog.systems) for (StationInfo station : system.stations) {
            if (Double.isNaN(station.lat) || Double.isNaN(station.lon)) continue;
            float[] result = new float[1];
            Location.distanceBetween(last.getLatitude(), last.getLongitude(), station.lat, station.lon, result);
            if (result[0] < bestMeters) { bestMeters = result[0]; best = station; }
        }
        return best;
    }

    static SystemInfo systemForStation(Catalog catalog, StationInfo station) {
        if (station == null) return null;
        for (SystemInfo system : catalog.systems) if (system.stationByName.get(station.name) == station) return system;
        return null;
    }

    private static void parseTrtc(Catalog catalog, SystemInfo sys, JSONObject root, String station,
                                  String direction, Snapshot out) throws JSONException {
        Map<String, JSONObject> trains = new LinkedHashMap<>();
        JSONArray trainList = root.optJSONArray("trains");
        if (trainList != null) for (int i = 0; i < trainList.length(); i++) {
            JSONObject train = trainList.optJSONObject(i);
            if (train == null) continue;
            String no = train.optString("no", "");
            if (!no.isEmpty() && !trains.containsKey(no)) trains.put(no, train);
        }
        JSONObject alias = catalog.alias.optJSONObject(sys.id);
        double now = System.currentTimeMillis() / 1000.0;
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
                }
            }
            out.rows.add(row);
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

    private static String lastTrain(Catalog catalog, String sys, String station, long nowMillis) {
        String prefix = sys + "|" + station + "|";
        String best = null;
        long bestAt = Long.MAX_VALUE;
        java.util.Iterator<String> keys = catalog.lastTrain.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.startsWith(prefix)) continue;
            String hhmm = catalog.lastTrain.optString(key, "");
            long occurrence = nextOccurrence(hhmm, nowMillis);
            if (occurrence >= nowMillis && occurrence - nowMillis <= 3_600_000L && occurrence < bestAt) {
                String dest = key.substring(prefix.length());
                best = "往 " + dest + " " + hhmm;
                bestAt = occurrence;
            }
        }
        return best;
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
