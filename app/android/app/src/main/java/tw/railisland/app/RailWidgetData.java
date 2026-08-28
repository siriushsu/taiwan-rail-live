package tw.railisland.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;

import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;

/** 台鐵／高鐵桌面看板的單一資料層；台鐵讀內嵌班表，高鐵讀網站當日班表。 */
final class RailWidgetData {
    static final String SYS_COMPOSITE = "railboth";
    static final String AUTO = "__auto__";
    static final String PLACE_PREFIX = "place|";
    static final String PLACES_PREFS = "rail_places";
    static final String PLACES_KEY = "places";
    private static final double PLACE_MAX_METERS = 5_000.0;
    private static final double PLACE_TIE_METERS = 300.0;
    private static final String LIVE_URL = "https://railisland.tw/api/tra-live";
    private static final String THSR_SCHEDULE_URL = "https://railisland.tw/api/thsr-schedule";
    private static final TimeZone TAIPEI = TimeZone.getTimeZone("Asia/Taipei");
    private static Catalog cachedCatalog;
    private static SystemInfo cachedCurrentThsr;
    private static String cachedCurrentThsrDay;
    private static long cachedCurrentThsrAt;

    static final class Station {
        final String name;
        final double lat;
        final double lon;

        Station(String name, double lat, double lon) {
            this.name = name;
            this.lat = lat;
            this.lon = lon;
        }
    }

    static final class PlaceOption {
        final String key;
        final String label;
        final String sys;
        final String station;
        final boolean manual;
        final double distanceMeters;

        PlaceOption(String key, String label, String sys, String station, boolean manual, double distanceMeters) {
            this.key = key; this.label = label; this.sys = sys; this.station = station;
            this.manual = manual; this.distanceMeters = distanceMeters;
        }

        String displayLabel(Catalog catalog) {
            SystemInfo system = catalog.byId.get(sys);
            return "我的地點 · " + (label.isEmpty() ? "未命名地點" : label) + "（"
                + (system == null ? sys : system.label) + " " + station + "）";
        }
    }

    static final class FilterOption {
        final String key;
        final String label;
        FilterOption(String key, String label) { this.key = key; this.label = label; }
        @Override public String toString() { return label; }
    }

    static final class Stop {
        final String name;
        final int arr;
        final int dep;
        final boolean stopping;

        Stop(JSONObject raw) {
            name = raw.optString("name", "");
            arr = raw.optInt("arr", 0);
            dep = raw.optInt("dep", arr);
            stopping = raw.optBoolean("stop", true);
        }
    }

    static final class Train {
        final int index;
        final String no;
        final String type;
        final String color;
        final List<Stop> stops = new ArrayList<>();

        Train(int index, JSONObject raw) {
            this.index = index;
            no = raw.optString("no", "");
            type = raw.optString("type", "其他");
            color = raw.optString("color", "#8E44AD");
            JSONArray list = raw.optJSONArray("stops");
            if (list != null) for (int i = 0; i < list.length(); i++) {
                JSONObject stop = list.optJSONObject(i);
                if (stop != null) stops.add(new Stop(stop));
            }
        }
    }

    static final class SystemInfo {
        final String id;
        final String label;
        final boolean live;
        final String sourceDate;
        final List<Station> stations = new ArrayList<>();
        final Map<String, Station> stationByName = new LinkedHashMap<>();
        final List<Train> trains = new ArrayList<>();
        final JSONObject dates;

        SystemInfo(JSONObject raw) {
            id = raw.optString("id", "");
            label = raw.optString("label", id);
            live = raw.optBoolean("live", false);
            sourceDate = raw.optString("date", "");
            dates = raw.optJSONObject("dates");
            JSONArray stationList = raw.optJSONArray("stations");
            if (stationList != null) for (int i = 0; i < stationList.length(); i++) {
                JSONObject one = stationList.optJSONObject(i);
                if (one == null) continue;
                Station station = new Station(one.optString("name", ""), one.optDouble("lat"), one.optDouble("lon"));
                if (station.name.isEmpty()) continue;
                stations.add(station);
                stationByName.put(station.name, station);
            }
            JSONArray trainList = raw.optJSONArray("trains");
            if (trainList != null) for (int i = 0; i < trainList.length(); i++) {
                JSONObject train = trainList.optJSONObject(i);
                if (train != null) trains.add(new Train(i, train));
            }
        }
    }

    static final class Composite {
        final String key;
        final String label;
        final String tra;
        final String thsr;
        final double lat;
        final double lon;

        Composite(JSONObject raw) {
            key = raw.optString("key", "");
            label = raw.optString("label", key);
            tra = raw.optString("tra", "");
            thsr = raw.optString("thsr", "");
            lat = raw.optDouble("lat");
            lon = raw.optDouble("lon");
        }
    }

    static final class Catalog {
        final List<SystemInfo> systems = new ArrayList<>();
        final Map<String, SystemInfo> byId = new LinkedHashMap<>();
        final List<Composite> composites = new ArrayList<>();
        final Map<String, Composite> compositeByKey = new LinkedHashMap<>();
    }

    enum Relation { DEPARTURE, ARRIVAL, PASS }

    static final class Row {
        String sys;
        String no;
        String type;
        String color;
        String terminus;
        Relation relation;
        long scheduledAt;
        Long destinationAt;
        Integer delayMinutes;

        long expectedAt() {
            return scheduledAt + Math.max(0, delayMinutes == null ? 0 : delayMinutes) * 60_000L;
        }

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject()
                .put("sys", sys).put("no", no).put("type", type).put("color", color)
                .put("terminus", terminus).put("relation", relation.name()).put("scheduledAt", scheduledAt);
            if (destinationAt != null) out.put("destinationAt", destinationAt);
            if (delayMinutes != null) out.put("delayMinutes", delayMinutes);
            return out;
        }

        static Row fromJson(JSONObject raw) {
            Row row = new Row();
            row.sys = raw.optString("sys", "");
            row.no = raw.optString("no", "");
            row.type = raw.optString("type", "");
            row.color = raw.optString("color", "#8E44AD");
            row.terminus = raw.optString("terminus", "");
            try { row.relation = Relation.valueOf(raw.optString("relation", Relation.DEPARTURE.name())); }
            catch (IllegalArgumentException ignored) { row.relation = Relation.DEPARTURE; }
            row.scheduledAt = raw.optLong("scheduledAt", 0);
            if (raw.has("destinationAt")) row.destinationAt = raw.optLong("destinationAt");
            if (raw.has("delayMinutes")) row.delayMinutes = raw.optInt("delayMinutes");
            return row;
        }
    }

    static final class Snapshot {
        String sys;
        String systemLabel;
        String origin;
        String destination;
        long generatedAt;
        String scheduleNote;
        boolean failed;
        final List<Row> rows = new ArrayList<>();

        JSONObject toJson() throws JSONException {
            JSONObject out = new JSONObject().put("sys", sys).put("systemLabel", systemLabel)
                .put("origin", origin).put("destination", destination == null ? "" : destination)
                .put("generatedAt", generatedAt).put("failed", failed);
            if (scheduleNote != null) out.put("scheduleNote", scheduleNote);
            JSONArray list = new JSONArray();
            for (Row row : rows) list.put(row.toJson());
            out.put("rows", list);
            return out;
        }

        static Snapshot fromJson(JSONObject raw) {
            Snapshot out = new Snapshot();
            out.sys = raw.optString("sys", "");
            out.systemLabel = raw.optString("systemLabel", "鐵路");
            out.origin = raw.optString("origin", "");
            out.destination = raw.optString("destination", "");
            out.generatedAt = raw.optLong("generatedAt", 0);
            out.scheduleNote = raw.optString("scheduleNote", null);
            out.failed = raw.optBoolean("failed", false);
            JSONArray rows = raw.optJSONArray("rows");
            if (rows != null) for (int i = 0; i < rows.length(); i++) {
                JSONObject row = rows.optJSONObject(i);
                if (row != null) out.rows.add(Row.fromJson(row));
            }
            return out;
        }
    }

    private RailWidgetData() {}

    static synchronized Catalog catalog(Context context) throws IOException, JSONException {
        if (cachedCatalog != null) return cachedCatalog;
        JSONObject root;
        try (InputStream input = context.getAssets().open("RailWidgetData.json")) {
            root = new JSONObject(readAll(input));
        }
        if (root.optInt("version") != 1) throw new JSONException("RailWidgetData version");
        Catalog out = new Catalog();
        JSONArray systems = root.optJSONArray("systems");
        if (systems != null) for (int i = 0; i < systems.length(); i++) {
            JSONObject raw = systems.optJSONObject(i);
            if (raw == null) continue;
            SystemInfo system = new SystemInfo(raw);
            out.systems.add(system);
            out.byId.put(system.id, system);
        }
        JSONArray composites = root.optJSONArray("composites");
        if (composites != null) for (int i = 0; i < composites.length(); i++) {
            JSONObject raw = composites.optJSONObject(i);
            if (raw == null) continue;
            Composite one = new Composite(raw);
            out.composites.add(one);
            out.compositeByKey.put(one.key, one);
        }
        cachedCatalog = out;
        return out;
    }

    static List<String> destinations(Catalog catalog, String sys, String origin) {
        LinkedHashSet<String> found = new LinkedHashSet<>();
        SystemInfo system = catalog.byId.get(sys);
        if (system == null) return new ArrayList<>();
        for (Train train : system.trains) {
            int at = indexOf(train.stops, origin);
            if (at < 0) continue;
            for (int i = at + 1; i < train.stops.size(); i++) {
                Stop stop = train.stops.get(i);
                if (stop.stopping) found.add(stop.name);
            }
        }
        List<String> out = new ArrayList<>(found);
        Collections.sort(out);
        return out;
    }

    static boolean isPlace(String key) { return key != null && key.startsWith(PLACE_PREFIX); }

    static List<PlaceOption> places(Context context, Catalog catalog, String requiredSystem,
                                    Set<String> allowedStations) {
        List<JSONObject> raw = savedPlaces(context);
        List<PlaceOption> out = new ArrayList<>();
        for (JSONObject place : raw) {
            PlaceOption option = nearestPlace(catalog, place.optDouble("lat", Double.NaN),
                place.optDouble("lon", Double.NaN), place.optString("label", ""),
                place.optBoolean("manual", true), requiredSystem, allowedStations);
            if (option != null) out.add(option);
        }
        out.sort((a, b) -> {
            if (a.manual != b.manual) return a.manual ? -1 : 1;
            int distance = Double.compare(a.distanceMeters, b.distanceMeters);
            if (distance != 0) return distance;
            int label = a.label.compareTo(b.label);
            return label != 0 ? label : a.key.compareTo(b.key);
        });
        if (out.size() > 20) out.subList(20, out.size()).clear();
        return out;
    }

    static PlaceOption resolvePlace(Context context, Catalog catalog, String key, String requiredSystem,
                                    Set<String> allowedStations) {
        if (!isPlace(key)) return null;
        String[] parts = key.split("\\|", 3);
        if (parts.length != 3) return null;
        String[] coordinate = parts[1].split(",", 2);
        if (coordinate.length != 2) return null;
        double lat, lon;
        try { lat = Double.parseDouble(coordinate[0]); lon = Double.parseDouble(coordinate[1]); }
        catch (NumberFormatException ignored) { return null; }
        String label = parts[2];
        if (!label.isEmpty()) {
            JSONObject unique = null;
            for (JSONObject place : savedPlaces(context)) if (label.equals(place.optString("label", ""))) {
                if (unique != null) { unique = null; break; }
                unique = place;
            }
            if (unique != null) {
                lat = unique.optDouble("lat", lat); lon = unique.optDouble("lon", lon);
            }
        }
        return nearestPlace(catalog, lat, lon, label, true, requiredSystem, allowedStations);
    }

    private static PlaceOption nearestPlace(Catalog catalog, double lat, double lon, String label,
                                            boolean manual, String requiredSystem, Set<String> allowedStations) {
        if (!Double.isFinite(lat) || !Double.isFinite(lon)) return null;
        final class Candidate {
            String sys; Station station; double distance; int departures;
        }
        List<Candidate> candidates = new ArrayList<>();
        double closest = Double.MAX_VALUE;
        for (SystemInfo system : catalog.systems) {
            if (!("tra".equals(system.id) || "thsr".equals(system.id))) continue;
            if (requiredSystem != null && !requiredSystem.isEmpty() && !requiredSystem.equals(system.id)) continue;
            for (Station station : system.stations) {
                if (allowedStations != null && !allowedStations.contains(station.name)) continue;
                float[] result = new float[1];
                Location.distanceBetween(lat, lon, station.lat, station.lon, result);
                Candidate candidate = new Candidate();
                candidate.sys = system.id; candidate.station = station; candidate.distance = result[0];
                candidate.departures = departureCount(system, station.name);
                candidates.add(candidate);
                closest = Math.min(closest, candidate.distance);
            }
        }
        if (closest > PLACE_MAX_METERS) return null;
        final double closestDistance = closest;
        candidates.removeIf(candidate -> candidate.distance > closestDistance + PLACE_TIE_METERS);
        candidates.sort((a, b) -> {
            if (a.departures != b.departures) return Integer.compare(b.departures, a.departures);
            int distance = Double.compare(a.distance, b.distance);
            if (distance != 0) return distance;
            int system = a.sys.compareTo(b.sys);
            return system != 0 ? system : a.station.name.compareTo(b.station.name);
        });
        if (candidates.isEmpty()) return null;
        Candidate best = candidates.get(0);
        String key = PLACE_PREFIX + String.format(Locale.US, "%.6f,%.6f", lat, lon) + "|" + label;
        return new PlaceOption(key, label, best.sys, best.station.name, manual, best.distance);
    }

    private static int departureCount(SystemInfo system, String station) {
        int count = 0;
        for (Train train : system.trains) {
            int at = indexOf(train.stops, station);
            if (at >= 0 && at < train.stops.size() - 1) count++;
        }
        return count;
    }

    private static List<JSONObject> savedPlaces(Context context) {
        List<JSONObject> out = new ArrayList<>();
        String raw = context.getSharedPreferences(PLACES_PREFS, Context.MODE_PRIVATE)
            .getString(PLACES_KEY, "[]");
        try {
            JSONArray places = new JSONArray(raw);
            for (int i = 0; i < places.length(); i++) {
                JSONObject place = places.optJSONObject(i);
                if (place != null) out.add(place);
            }
        } catch (JSONException ignored) {}
        return out;
    }

    static Snapshot fetch(Context context, String sys, String origin, String destination) throws Exception {
        return fetch(context, sys, origin, destination, Collections.emptyList());
    }

    static Snapshot fetch(Context context, String sys, String origin, String destination,
                          List<String> filters) throws Exception {
        Catalog catalog = catalog(context);
        long now = System.currentTimeMillis();
        String originLabel = null, destinationLabel = null;
        if (isPlace(origin)) {
            PlaceOption place = resolvePlace(context, catalog, origin, "", null);
            if (place == null) throw new IllegalArgumentException("place origin");
            sys = place.sys; origin = place.station; originLabel = place.label;
        }
        if (isPlace(destination)) {
            Set<String> direct = new LinkedHashSet<>(destinations(catalog, sys, origin));
            PlaceOption place = resolvePlace(context, catalog, destination, sys, direct);
            if (place == null) throw new IllegalArgumentException("place destination");
            destination = place.station; destinationLabel = place.label;
        }
        Snapshot out;
        if (SYS_COMPOSITE.equals(sys)) {
            Composite pair = catalog.compositeByKey.get(origin);
            if (pair == null) throw new JSONException("unknown composite");
            Snapshot tra = prepare(catalog.byId.get("tra"), pair.tra, "", now);
            Snapshot thsr = prepare(currentThsr(catalog, now), pair.thsr, "", now);
            out = new Snapshot();
            out.sys = SYS_COMPOSITE;
            out.systemLabel = "台鐵＋高鐵";
            out.origin = pair.label;
            out.destination = "";
            out.generatedAt = now;
            out.rows.addAll(tra.rows);
            out.rows.addAll(thsr.rows);
            out.scheduleNote = tra.scheduleNote;
        } else {
            SystemInfo system = "thsr".equals(sys) ? currentThsr(catalog, now) : catalog.byId.get(sys);
            if (system == null) throw new JSONException("unknown system");
            out = prepare(system, origin, destination, now);
        }
        if (originLabel != null && !originLabel.isEmpty()) out.origin = originLabel;
        if (destinationLabel != null && !destinationLabel.isEmpty()) out.destination = destinationLabel;
        applyFilters(out.rows, filters);
        Map<String, Integer> delays = containsTra(out.rows) ? fetchDelays() : Collections.emptyMap();
        for (Row row : out.rows) if ("tra".equals(row.sys) && delays.containsKey(row.no)) {
            row.delayMinutes = delays.get(row.no);
        }
        out.rows.sort(Comparator.comparingLong(Row::expectedAt).thenComparing(row -> row.no));
        if (out.rows.size() > 12) out.rows.subList(12, out.rows.size()).clear();
        return out;
    }

    static List<FilterOption> filterOptions(Context context, Catalog catalog, String sys, String origin) {
        boolean placeOrigin = isPlace(origin);
        if (placeOrigin) {
            PlaceOption place = resolvePlace(context, catalog, origin, "", null);
            if (place == null) return Collections.emptyList();
            sys = place.sys; origin = place.station;
        }
        LinkedHashMap<String, Integer> types = new LinkedHashMap<>();
        LinkedHashSet<String> numbers = new LinkedHashSet<>(), termini = new LinkedHashSet<>();
        SystemInfo system = catalog.byId.get(sys);
        if (system == null) return Collections.emptyList();
        for (Train train : system.trains) {
            int at = indexOf(train.stops, origin);
            if (at < 0 || at >= train.stops.size() - 1) continue;
            types.put(train.type, types.getOrDefault(train.type, 0) + 1);
            if (!train.no.isEmpty()) numbers.add(train.no);
            if (!train.stops.isEmpty()) termini.add(train.stops.get(train.stops.size() - 1).name);
        }
        List<FilterOption> out = new ArrayList<>();
        if (placeOrigin) for (String terminus : termini) {
            out.add(new FilterOption("dir|" + sys + "|" + terminus, "方向 · 往 " + terminus));
        }
        List<Map.Entry<String, Integer>> typeList = new ArrayList<>(types.entrySet());
        typeList.sort((a, b) -> !a.getValue().equals(b.getValue())
            ? Integer.compare(b.getValue(), a.getValue()) : a.getKey().compareTo(b.getKey()));
        for (Map.Entry<String, Integer> entry : typeList) {
            out.add(new FilterOption("ty|" + entry.getKey(), "車種 · " + entry.getKey() + "（" + entry.getValue() + " 班）"));
        }
        List<String> numberList = new ArrayList<>(numbers); Collections.sort(numberList);
        for (String no : numberList) out.add(new FilterOption("no|" + no, "車次 · " + no));
        return out;
    }

    private static void applyFilters(List<Row> rows, List<String> keys) {
        if (keys == null || keys.isEmpty()) return;
        Set<String> types = new HashSet<>(), numbers = new HashSet<>(), directions = new HashSet<>();
        for (String key : keys) {
            if (key == null) continue;
            if (key.startsWith("ty|") && key.length() > 3) types.add(key.substring(3));
            else if (key.startsWith("no|") && key.length() > 3) numbers.add(key.substring(3));
            else if (key.startsWith("dir|") && key.length() > 4) directions.add(key.substring(4));
        }
        if (types.isEmpty() && numbers.isEmpty() && directions.isEmpty()) return;
        rows.removeIf(row -> {
            boolean trainMatch = types.isEmpty() && numbers.isEmpty()
                || types.contains(row.type) || numbers.contains(row.no);
            boolean directionMatch = directions.isEmpty() || directions.contains(row.sys + "|" + row.terminus);
            return !(trainMatch && directionMatch);
        });
    }

    private static Snapshot prepare(SystemInfo system, String origin, String destination, long now) throws ParseException {
        if (system == null || !system.stationByName.containsKey(origin)) throw new IllegalArgumentException("station");
        Snapshot out = new Snapshot();
        out.sys = system.id;
        out.systemLabel = system.label;
        out.origin = origin;
        out.destination = destination == null ? "" : destination;
        out.generatedAt = now;
        if ("thsr".equals(system.id) && !system.sourceDate.isEmpty()) {
            String date = system.sourceDate.replace("-", "");
            if (date.length() == 8) out.scheduleNote = "高鐵 " + date.substring(4, 6) + "/" + date.substring(6) + " 當日班表";
        }
        List<Row> future = new ArrayList<>();
        long horizon = now + 24 * 60 * 60_000L;
        for (int dayOffset = -1; dayOffset <= 2; dayOffset++) {
            long serviceDay = startOfToday(now) + dayOffset * 24 * 60 * 60_000L;
            ActiveDay active = activeDay(system, serviceDay);
            if (active.note != null) out.scheduleNote = active.note;
            for (Train train : system.trains) {
                if (active.indices != null && !active.indices.contains(train.index)) continue;
                Row row = rowAt(train, system.id, origin, out.destination, serviceDay);
                if (row == null || row.scheduledAt <= now) continue;
                future.add(row);
                if (row.scheduledAt <= horizon) out.rows.add(row);
            }
        }
        future.sort(Comparator.comparingLong(row -> row.scheduledAt));
        if (out.rows.isEmpty() && !future.isEmpty()) out.rows.add(future.get(0));
        out.rows.sort(Comparator.comparingLong(row -> row.scheduledAt));
        return out;
    }

    private static Row rowAt(Train train, String sys, String origin, String destination, long serviceDay) {
        int at = indexOf(train.stops, origin);
        if (at < 0) return null;
        Long destinationAt = null;
        if (destination != null && !destination.isEmpty()) {
            for (int i = at + 1; i < train.stops.size(); i++) {
                Stop stop = train.stops.get(i);
                if (stop.stopping && destination.equals(stop.name)) {
                    destinationAt = serviceDay + stop.arr * 1000L;
                    break;
                }
            }
            if (destinationAt == null) return null;
        }
        Stop originStop = train.stops.get(at);
        Row row = new Row();
        row.sys = sys;
        row.no = train.no;
        row.type = train.type;
        row.color = train.color;
        row.terminus = train.stops.isEmpty() ? "" : train.stops.get(train.stops.size() - 1).name;
        row.relation = !originStop.stopping ? Relation.PASS
            : at == train.stops.size() - 1 ? Relation.ARRIVAL : Relation.DEPARTURE;
        int second = row.relation == Relation.DEPARTURE ? originStop.dep : originStop.arr;
        row.scheduledAt = serviceDay + second * 1000L;
        row.destinationAt = destinationAt;
        return row;
    }

    private static int indexOf(List<Stop> stops, String name) {
        for (int i = 0; i < stops.size(); i++) if (name.equals(stops.get(i).name)) return i;
        return -1;
    }

    private static final class ActiveDay {
        final Set<Integer> indices;
        final String note;
        ActiveDay(Set<Integer> indices, String note) { this.indices = indices; this.note = note; }
    }

    /** 班表日期超窗時與 iOS 相同：找同星期的最近來源日，並明白在卡上標示，不假裝是當日官方表。 */
    private static ActiveDay activeDay(SystemInfo system, long actualDay) throws ParseException {
        if (system.dates == null || system.dates.length() == 0) {
            if (!system.sourceDate.isEmpty()) {
                String source = system.sourceDate.replace("-", "");
                String actual = dayKey(actualDay).replace("-", "");
                return new ActiveDay(source.equals(actual) ? null : Collections.emptySet(), null);
            }
            return new ActiveDay(null, null);
        }
        String actual = dayKey(actualDay);
        JSONArray exact = system.dates.optJSONArray(actual);
        if (exact != null) return new ActiveDay(indices(exact), null);
        SimpleDateFormat format = dayFormat();
        Calendar actualCalendar = Calendar.getInstance(TAIPEI, Locale.TAIWAN);
        actualCalendar.setTimeInMillis(actualDay);
        int actualWeekday = actualCalendar.get(Calendar.DAY_OF_WEEK);
        String best = null;
        long bestDistance = Long.MAX_VALUE;
        java.util.Iterator<String> keys = system.dates.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Date source = format.parse(key);
            if (source == null) continue;
            Calendar sourceCalendar = Calendar.getInstance(TAIPEI, Locale.TAIWAN);
            sourceCalendar.setTime(source);
            if (sourceCalendar.get(Calendar.DAY_OF_WEEK) != actualWeekday) continue;
            long distance = Math.abs(source.getTime() - actualDay);
            if (distance < bestDistance) { bestDistance = distance; best = key; }
        }
        if (best == null) return new ActiveDay(Collections.emptySet(), "班表超出涵蓋日期");
        return new ActiveDay(indices(system.dates.optJSONArray(best)), "依 " + best.substring(5).replace('-', '/') + " 同星期班表");
    }

    private static Set<Integer> indices(JSONArray raw) {
        Set<Integer> out = new HashSet<>();
        if (raw != null) for (int i = 0; i < raw.length(); i++) out.add(raw.optInt(i, -1));
        return out;
    }

    private static boolean containsTra(List<Row> rows) {
        for (Row row : rows) if ("tra".equals(row.sys)) return true;
        return false;
    }

    private static Map<String, Integer> fetchDelays() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(LIVE_URL).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestProperty("User-Agent", "RailIsland-Android-RailWidget");
            if (connection.getResponseCode() != 200) return Collections.emptyMap();
            JSONObject root = new JSONObject(readAll(connection.getInputStream()));
            JSONArray trains = root.optJSONArray("trains");
            Map<String, Integer> out = new HashMap<>();
            if (trains != null) for (int i = 0; i < trains.length(); i++) {
                JSONObject one = trains.optJSONObject(i);
                if (one == null) continue;
                String no = one.optString("no", "");
                int delay = one.optInt("delay", 0);
                Integer old = out.get(no);
                if (!no.isEmpty() && (old == null || delay > old)) out.put(no, delay);
            }
            return out;
        } catch (Exception ignored) {
            return Collections.emptyMap();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * 高鐵靜態檔只保留站名與離線幾何，班次必須讀網站現用的 /api/thsr-schedule。
     * 端點若只剩「最近一天」的降級文件，日期不等於今天就拒絕，不把舊班表偽裝成今日班次。
     */
    private static synchronized SystemInfo currentThsr(Catalog catalog, long now) throws Exception {
        String today = dayKey(now).replace("-", "");
        if (cachedCurrentThsr != null && today.equals(cachedCurrentThsrDay)
            && now - cachedCurrentThsrAt < 5 * 60_000L) return cachedCurrentThsr;

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(THSR_SCHEDULE_URL).openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", "RailIsland-Android-RailWidget");
            if (connection.getResponseCode() != 200) throw new IOException("thsr schedule unavailable");
            JSONObject dense = new JSONObject(readAll(connection.getInputStream()));
            String rawDate = dense.optString("date", "").replace("-", "");
            if (!today.equals(rawDate)) throw new IOException("thsr schedule stale: " + rawDate);
            SystemInfo base = catalog.byId.get("thsr");
            JSONObject compact = new JSONObject()
                .put("id", "thsr").put("label", "高鐵").put("live", false).put("date", rawDate);
            JSONArray stations = new JSONArray();
            if (base != null) for (Station station : base.stations) {
                stations.put(new JSONObject().put("name", station.name).put("lat", station.lat).put("lon", station.lon));
            }
            compact.put("stations", stations);
            JSONArray compactTrains = new JSONArray();
            JSONArray trains = dense.optJSONArray("trains");
            if (trains != null) for (int i = 0; i < trains.length(); i++) {
                JSONObject train = trains.optJSONObject(i);
                if (train == null) continue;
                JSONObject one = new JSONObject()
                    .put("no", train.optString("train", ""))
                    .put("type", train.optString("typeName", "高鐵"))
                    .put("color", train.optString("color", "#E85D0D"));
                JSONArray compactStops = new JSONArray();
                JSONArray stops = train.optJSONArray("stops");
                if (stops != null) for (int j = 0; j < stops.length(); j++) {
                    JSONObject stop = stops.optJSONObject(j);
                    if (stop == null) continue;
                    compactStops.put(new JSONObject()
                        .put("name", stop.optString("name", ""))
                        .put("arr", stop.optInt("arrSec", 0))
                        .put("dep", stop.optInt("depSec", stop.optInt("arrSec", 0)))
                        .put("stop", stop.optBoolean("stop", true)));
                }
                one.put("stops", compactStops);
                compactTrains.put(one);
            }
            if (compactTrains.length() == 0) throw new IOException("empty thsr schedule");
            compact.put("trains", compactTrains);
            cachedCurrentThsr = new SystemInfo(compact);
            cachedCurrentThsrDay = today;
            cachedCurrentThsrAt = now;
            return cachedCurrentThsr;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static void cache(Context context, String prefsName, int id, Snapshot snapshot) {
        try {
            context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).edit()
                .putString("snapshot_" + id, snapshot.toJson().toString()).apply();
        } catch (JSONException ignored) {}
    }

    static Snapshot cached(Context context, String prefsName, int id) {
        String raw = context.getSharedPreferences(prefsName, Context.MODE_PRIVATE).getString("snapshot_" + id, null);
        if (raw == null) return null;
        try { return Snapshot.fromJson(new JSONObject(raw)); }
        catch (JSONException ignored) { return null; }
    }

    static String nearest(Context context, Catalog catalog, String sys) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
            && ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
        LocationManager manager = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return null;
        Location here = null;
        for (String provider : manager.getProviders(true)) {
            try {
                Location candidate = manager.getLastKnownLocation(provider);
                if (candidate != null && (here == null || candidate.getTime() > here.getTime())) here = candidate;
            } catch (SecurityException ignored) {}
        }
        if (here == null) return null;
        double best = Double.MAX_VALUE;
        String bestKey = null;
        if (SYS_COMPOSITE.equals(sys)) {
            for (Composite pair : catalog.composites) {
                float[] distance = new float[1];
                Location.distanceBetween(here.getLatitude(), here.getLongitude(), pair.lat, pair.lon, distance);
                if (distance[0] < best) { best = distance[0]; bestKey = pair.key; }
            }
        } else {
            SystemInfo system = catalog.byId.get(sys);
            if (system != null) for (Station station : system.stations) {
                float[] distance = new float[1];
                Location.distanceBetween(here.getLatitude(), here.getLongitude(), station.lat, station.lon, distance);
                if (distance[0] < best) { best = distance[0]; bestKey = station.name; }
            }
        }
        return bestKey;
    }

    private static long startOfToday(long now) {
        java.util.Calendar calendar = java.util.Calendar.getInstance(TAIPEI, Locale.TAIWAN);
        calendar.setTimeInMillis(now);
        calendar.set(java.util.Calendar.HOUR_OF_DAY, 0);
        calendar.set(java.util.Calendar.MINUTE, 0);
        calendar.set(java.util.Calendar.SECOND, 0);
        calendar.set(java.util.Calendar.MILLISECOND, 0);
        return calendar.getTimeInMillis();
    }

    private static String dayKey(long millis) { return dayFormat().format(new Date(millis)); }

    private static SimpleDateFormat dayFormat() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        format.setTimeZone(TAIPEI);
        return format;
    }

    private static String readAll(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = input.read(buffer)) >= 0) out.write(buffer, 0, read);
        return out.toString(StandardCharsets.UTF_8.name());
    }
}
