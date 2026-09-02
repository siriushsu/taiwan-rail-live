package tw.railisland.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.drawable.IconCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.Locale;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;

/** 跟隨列車的鎖屏卡：Android 16 是 Live Update／Samsung Now Bar，舊版是持續通知。 */
final class RailFollowNotification {
    static final String CHANNEL_ID = "rail_follow_live_v1";
    static final int NOTIFICATION_ID = 46401;
    static final int STOP_REQUEST_CODE = 46402;
    static final int ADVANCE_REQUEST_CODE = 46403;
    static final int REFRESH_REQUEST_CODE = 46404;
    static final String PREFS = "rail_follow_live";
    static final String KEY_STATE = "active_state";
    private static final String LIVE_URL = "https://railisland.tw/api/tra-live";

    private RailFollowNotification() {}

    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, RailNativeL10n.text(context, "跟隨列車"), NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(RailNativeL10n.text(context, "在鎖定畫面與 Now Bar 顯示正在跟隨列車的下一站"));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        channel.enableVibration(false);
        manager.createNotificationChannel(channel);
    }

    static void start(Context context, JSONObject payload) throws JSONException {
        stop(context);
        payload.put("active", true);
        save(context, payload);
        post(context, payload);
        scheduleAdvance(context, payload);
        scheduleRefresh(context);
    }

    static void update(Context context, JSONObject payload) throws JSONException {
        JSONObject state = load(context);
        if (state == null) {
            start(context, payload);
            return;
        }
        Iterator<String> keys = payload.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            state.put(key, payload.get(key));
        }
        state.put("active", true);
        save(context, state);
        post(context, state);
        scheduleAdvance(context, state);
        scheduleRefresh(context);
    }

    static JSONObject status(Context context) {
        JSONObject state = load(context);
        return state != null && state.optBoolean("active", false) ? state : null;
    }

    static void post(Context context, JSONObject state) {
        if (!canNotify(context)) return;
        createChannel(context);
        long now = System.currentTimeMillis();
        String trainNo = state.optString("trainNo", "");
        String kind = RailNativeL10n.name(context, state.optString("kind", "列車"));
        String nextStop = RailNativeL10n.name(context, state.optString("nextStop", "下一站"));
        String terminus = RailNativeL10n.name(context, state.optString("terminus", ""));
        String prevStop = RailNativeL10n.name(context, state.optString("prevStop", ""));
        boolean stopping = state.optBoolean("stopping", false);
        long arrival = (long) (state.optDouble("arrivalAt", 0) * 1000);
        long departed = (long) (state.optDouble("departedAt", 0) * 1000);
        int delay = state.optInt("delaySec", 0);

        String title = RailNativeL10n.text(context, "{kind} {trainNo}", "kind", kind, "trainNo", trainNo).trim();
        String status = RailNativeL10n.text(context, stopping ? "停靠 {station}" : "下一站 {station}",
            "station", nextStop);
        String route = terminus.isEmpty() ? status : RailNativeL10n.text(context, "{status} · 往 {station}",
            "status", status, "station", terminus);
        String detail = route;
        if (!prevStop.isEmpty() && !stopping) detail += "\n" + prevStop + " → " + nextStop;
        if (delay != 0) detail += "\n" + delayText(context, delay);

        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(context, 46400, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(context, RailFollowStopReceiver.class).setAction(RailFollowStopReceiver.ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getBroadcast(context, STOP_REQUEST_CODE, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Integer accent = null;
        try {
            String color = state.optString("color", "");
            if (!color.isEmpty()) accent = Color.parseColor(color);
        } catch (IllegalArgumentException ignored) {}

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_train)
            .setContentTitle(title.isEmpty() ? RailNativeL10n.text(context, "跟隨列車") : title)
            .setContentText(route)
            .setSubText(RailNativeL10n.text(context, "軌島 · {status}", "status",
                delay == 0 ? RailNativeL10n.text(context, "準點") : delayText(context, delay)))
            .setContentIntent(openPending)
            .addAction(R.drawable.ic_stop, RailNativeL10n.text(context, "結束跟車"), stopPending)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setRequestPromotedOngoing(true)
            .setShortCriticalText(shortText(stopping ? RailNativeL10n.text(context, "停靠中") : nextStop))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        if (accent != null) builder.setColor(accent);

        boolean timed = !stopping && arrival > now;
        int progress = 0;
        if (timed) {
            builder.setWhen(arrival).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true);
            long start = departed > 0 && departed < arrival ? departed : now;
            long total = Math.max(1, arrival - start);
            progress = (int) Math.max(0, Math.min(1000, (now - start) * 1000 / total));
            builder.setProgress(1000, progress, false);
        } else builder.setShowWhen(false);

        if (Build.VERSION.SDK_INT >= 36) {
            NotificationCompat.ProgressStyle style = new NotificationCompat.ProgressStyle()
                .setStyledByProgress(true)
                .setProgressTrackerIcon(IconCompat.createWithResource(context, R.drawable.ic_stat_train));
            NotificationCompat.ProgressStyle.Segment segment =
                new NotificationCompat.ProgressStyle.Segment(1000).setId(1);
            NotificationCompat.ProgressStyle.Point destination =
                new NotificationCompat.ProgressStyle.Point(1000).setId(1);
            if (accent != null) { segment.setColor(accent); destination.setColor(accent); }
            style.addProgressSegment(segment).addProgressPoint(destination);
            if (timed) style.setProgress(progress);
            else style.setProgress(stopping ? 1000 : 0).setProgressIndeterminate(!stopping);
            builder.setStyle(style);
        } else {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(detail));
        }
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // 權限可能在上方 canNotify() 檢查後立刻被使用者從系統設定撤回。
        }
    }

    /** App 退到背景後依前端交來的完整停靠序列，自行把卡片推進到下一站。 */
    static void advance(Context context) {
        JSONObject state = load(context);
        if (state == null) return;
        long nowSec = System.currentTimeMillis() / 1000;
        JSONArray stops = state.optJSONArray("remainingStops");
        JSONObject next = null;
        if (stops != null) for (int i = 0; i < stops.length(); i++) {
            JSONObject candidate = stops.optJSONObject(i);
            if (candidate != null && candidate.optLong("advanceAt", candidate.optLong("arrivalAt")) > nowSec) {
                next = candidate; break;
            }
        }
        if (next == null) { stop(context); return; }
        try {
            state.put("nextStop", next.optString("name", ""));
            state.put("arrivalAt", next.optDouble("arrivalAt", 0));
            state.put("departedAt", next.optDouble("departedAt", 0));
            state.put("advanceAt", next.optDouble("advanceAt", next.optDouble("arrivalAt", 0)));
            state.put("prevStop", next.optString("prevStop", ""));
            state.put("stopping", false);
            save(context, state);
            post(context, state);
            scheduleAdvance(context, state);
        } catch (JSONException ignored) { stop(context); }
    }

    /** WebView 已被系統收掉時，仍每分鐘讀台鐵官方動態，更新誤點、觀測站與停靠狀態。 */
    static void refreshOfficial(Context context) {
        JSONObject state = load(context);
        if (state == null) return;
        try {
            if (!"tra_sched".equals(state.optString("sys", ""))) {
                advance(context);
                return;
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(LIVE_URL).openConnection();
            try {
                connection.setConnectTimeout(8_000); connection.setReadTimeout(8_000);
                connection.setUseCaches(false);
                connection.setRequestProperty("User-Agent", "RailIsland-Android-RailFollow");
                if (connection.getResponseCode() != 200) { advance(context); return; }
                JSONObject root = new JSONObject(readAll(connection.getInputStream()));
                if (!fresh(root.optString("at", ""))) { advance(context); return; }
                JSONArray trains = root.optJSONArray("trains");
                JSONObject live = null;
                if (trains != null) for (int i = 0; i < trains.length(); i++) {
                    JSONObject candidate = trains.optJSONObject(i);
                    if (candidate != null && state.optString("trainNo", "")
                        .equals(candidate.optString("no", ""))) { live = candidate; break; }
                }
                if (live == null) { advance(context); return; }
                if (!applyOfficial(state, live)) { stop(context); return; }
                save(context, state); post(context, state); scheduleAdvance(context, state);
            } finally { connection.disconnect(); }
        } catch (Exception ignored) {
            advance(context);
        } finally {
            if (load(context) != null) scheduleRefresh(context);
        }
    }

    /** 純資料轉換另開成 package-private，instrumentation 可用造測官方列驗證，不必碰正式網路。 */
    static boolean applyOfficial(JSONObject state, JSONObject live) throws JSONException {
        JSONArray stops = state.optJSONArray("remainingStops");
        if (stops == null || stops.length() == 0) return false;
        int oldDelay = state.optInt("delaySec", 0);
        int newDelay = Math.round((float) live.optDouble("delay", oldDelay / 60.0) * 60f);
        int delta = newDelay - oldDelay;
        if (delta != 0) for (int i = 0; i < stops.length(); i++) {
            JSONObject stop = stops.optJSONObject(i); if (stop == null) continue;
            shift(stop, "arrivalAt", delta); shift(stop, "departedAt", delta); shift(stop, "advanceAt", delta);
        }
        state.put("delaySec", newDelay);

        String stationCode = live.optString("sta", "");
        int status = live.optInt("status", -1), observed = -1;
        for (int i = 0; i < stops.length(); i++) {
            JSONObject stop = stops.optJSONObject(i);
            if (stop != null && stationCode.equals(stop.optString("code", ""))) {
                observed = status == 2 ? i + 1 : i; break;
            }
        }
        if (observed < 0) {
            JSONObject map = state.optJSONObject("staMap");
            if (map != null && map.has(stationCode)) observed = map.optInt(stationCode, -1);
        }
        int floor = state.optInt("lastObservedIndex", -1);
        if (observed >= 0) observed = Math.max(observed, floor);
        if (observed >= stops.length()) return false;
        if (observed >= 0) {
            JSONObject next = stops.optJSONObject(observed);
            if (next != null) {
                state.put("lastObservedIndex", observed);
                state.put("nextStop", next.optString("name", ""));
                state.put("arrivalAt", next.optDouble("arrivalAt", 0));
                state.put("departedAt", next.optDouble("departedAt", 0));
                state.put("advanceAt", next.optDouble("advanceAt", next.optDouble("arrivalAt", 0)));
                state.put("prevStop", next.optString("prevStop", ""));
                state.put("stopping", status == 1 && stationCode.equals(next.optString("code", "")));
            }
        } else {
            shift(state, "arrivalAt", delta); shift(state, "departedAt", delta); shift(state, "advanceAt", delta);
        }
        state.put("officialUpdatedAt", System.currentTimeMillis() / 1000);
        return true;
    }

    private static void shift(JSONObject object, String key, int seconds) throws JSONException {
        if (seconds != 0 && object.has(key) && object.optDouble(key, 0) != 0) {
            object.put(key, object.optDouble(key, 0) + seconds);
        }
    }

    static void stop(Context context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        cancelAdvance(context);
        cancelRefresh(context);
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_STATE).apply();
    }

    /** 手動切換語言後以原狀態重貼，不等待下一次列車資料更新。 */
    static void refreshLanguage(Context context) {
        JSONObject state = load(context);
        if (state != null) post(context, state);
    }

    private static boolean canNotify(Context context) {
        return Build.VERSION.SDK_INT < 33
            || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static void save(Context context, JSONObject state) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_STATE, state.toString()).apply();
    }

    private static JSONObject load(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_STATE, null);
        if (raw == null) return null;
        try { return new JSONObject(raw); }
        catch (JSONException ignored) { return null; }
    }

    private static PendingIntent advanceIntent(Context context, int flags) {
        Intent intent = new Intent(context, RailFollowStopReceiver.class).setAction(RailFollowStopReceiver.ACTION_ADVANCE);
        return PendingIntent.getBroadcast(context, ADVANCE_REQUEST_CODE, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent refreshIntent(Context context, int flags) {
        Intent intent = new Intent(context, RailFollowStopReceiver.class).setAction(RailFollowStopReceiver.ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, REFRESH_REQUEST_CODE, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void scheduleAdvance(Context context, JSONObject state) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) return;
        long now = System.currentTimeMillis();
        long advance = (long) (state.optDouble("advanceAt", state.optDouble("arrivalAt", 0)) * 1000);
        long when = Math.max(now + 30_000L, advance + 15_000L);
        alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, when,
            advanceIntent(context, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static void cancelAdvance(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = advanceIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (alarm != null && pending != null) alarm.cancel(pending);
    }

    private static void scheduleRefresh(Context context) {
        JSONObject state = load(context);
        if (state == null || !"tra_sched".equals(state.optString("sys", ""))) {
            cancelRefresh(context);
            return;
        }
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + 60_000L, refreshIntent(context, PendingIntent.FLAG_UPDATE_CURRENT));
    }

    private static void cancelRefresh(Context context) {
        AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pending = refreshIntent(context, PendingIntent.FLAG_NO_CREATE);
        if (alarm != null && pending != null) alarm.cancel(pending);
    }

    private static boolean fresh(String value) {
        if (value == null || value.isEmpty()) return false;
        for (String pattern : new String[] { "yyyy-MM-dd'T'HH:mm:ss.SSSXXX", "yyyy-MM-dd'T'HH:mm:ssXXX" }) {
            try {
                SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
                Date date = format.parse(value);
                if (date != null) return Math.abs(System.currentTimeMillis() - date.getTime()) <= 5 * 60_000L;
            } catch (Exception ignored) {}
        }
        return false;
    }

    private static String readAll(InputStream input) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int read;
        while ((read = input.read(buffer)) >= 0) out.write(buffer, 0, read);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static String delayText(Context context, int seconds) {
        int minutes = Math.round(Math.abs(seconds) / 60f);
        if (minutes == 0) return RailNativeL10n.text(context, seconds > 0 ? "稍有延誤" : "提早");
        return RailNativeL10n.text(context, seconds > 0 ? "晚 {n} 分" : "早 {n} 分",
            "n", String.valueOf(minutes));
    }

    private static String shortText(String value) {
        if (value == null) return "";
        return value.length() <= 7 ? value : value.substring(0, 7);
    }
}
